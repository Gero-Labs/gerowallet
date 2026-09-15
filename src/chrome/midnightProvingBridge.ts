// Midnight DApp Connector — page-context `ProvingProvider` returned by
// `getProvingProvider(keyMaterialProvider)`.
//
// Runs in the page's MAIN world (inject bundle). It owns the two things
// only the page can do: call the dapp's own `KeyMaterialProvider` for its
// contract-circuit artifacts, and hand the resulting bytes to the wallet
// through the content-script relay (`send`). Proving itself happens in the
// background against the user's configured proof server — this file never
// learns the server URL or any auth header (see `midnightDappProving.ts`).
//
// `send` is injected so the provider can be unit-tested without a browser
// messaging stack; `midnightWebpage.ts` wires it to `Messaging.sendToContent`.

import { MIDNIGHT_METHOD } from '@/chrome/config';
import {
  PROVING_UPLOAD_CHUNK_CHARS,
  encodeBase64,
  decodeBase64,
  isBuiltinKeyLocation,
} from '@/chrome/midnightProvingWire';
import type {
  ProvingCheckReply,
  ProvingCheckRequest,
  ProvingProveReply,
  ProvingProveRequest,
  ProvingUploadChunkRequest,
  ProvingUploadPart,
} from '@/chrome/midnightProvingWire';
import type { KeyMaterialProvider, ProvingProvider } from '@midnight-ntwrk/dapp-connector-api';

/** One connector round-trip; resolves with the reply's `data`, rejects with its `error`. */
export type ProvingBridgeSend = (method: string, data: unknown) => Promise<unknown>;

/** Above this, base64-encode through `FileReader` (native, off the JS heap) instead of `btoa`. */
const FILE_READER_THRESHOLD_BYTES = 256 * 1024;

/**
 * Base64-encode `bytes`, using the browser's native data-URL encoder for
 * large inputs (an 80 MB prover key through `btoa` means an 80 MB binary
 * string first). Falls back to the sync encoder where `FileReader` is
 * unavailable.
 */
export async function encodeBase64Async(bytes: Uint8Array): Promise<string> {
  if (
    bytes.length < FILE_READER_THRESHOLD_BYTES
    || typeof FileReader !== 'function'
    || typeof Blob !== 'function'
  ) {
    return encodeBase64(bytes);
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    // The typed-array view is a valid BlobPart at runtime; the cast only
    // bridges lib.dom's stricter `ArrayBufferView<ArrayBuffer>` typing.
    reader.readAsDataURL(new Blob([bytes as unknown as BlobPart]));
  });
}

function newUploadId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Ask the dapp for a contract circuit's artifacts. Wrapped so a failing
 * dapp-side provider reads as "your key material provider failed for
 * circuit X", not as a wallet error.
 */
async function loadFromDapp(
  keyMaterialProvider: KeyMaterialProvider,
  keyLocation: string,
  what: 'getZKIR' | 'getProverKey' | 'getVerifierKey',
): Promise<Uint8Array> {
  try {
    const bytes = await keyMaterialProvider[what](keyLocation);
    if (!(bytes instanceof Uint8Array)) {
      throw new Error(`${what} returned ${bytes === null ? 'null' : typeof bytes}, expected Uint8Array`);
    }
    return bytes;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`GeroWallet could not load key material for circuit '${keyLocation}' from the dapp's KeyMaterialProvider.${what}: ${message}`);
  }
}

export interface DappProvingProviderOptions {
  /** Base64 characters per chunk; must be a multiple of 4. Overridable for tests. */
  chunkChars?: number;
}

/**
 * Build the `ProvingProvider` handed back to the dapp. Each `check`/`prove`
 * call is self-contained: it uploads exactly the blobs that proof needs and
 * the background discards them once the proof server has answered, so no
 * key material lingers in the service worker between proofs.
 */
export function createDappProvingProvider(
  keyMaterialProvider: KeyMaterialProvider,
  send: ProvingBridgeSend,
  options: DappProvingProviderOptions = {},
): ProvingProvider {
  const chunkChars = options.chunkChars ?? PROVING_UPLOAD_CHUNK_CHARS;
  if (chunkChars <= 0 || chunkChars % 4 !== 0) {
    throw new Error('chunkChars must be a positive multiple of 4');
  }

  async function uploadPart(uploadId: string, part: ProvingUploadPart, bytes: Uint8Array): Promise<void> {
    const encoded = await encodeBase64Async(bytes);
    const total = Math.max(1, Math.ceil(encoded.length / chunkChars));
    for (let index = 0; index < total; index += 1) {
      const request: ProvingUploadChunkRequest = {
        uploadId,
        part,
        index,
        total,
        chunk: encoded.slice(index * chunkChars, (index + 1) * chunkChars),
      };
      await send(MIDNIGHT_METHOD.provingUpload, request);
    }
  }

  async function upload(parts: Partial<Record<ProvingUploadPart, Uint8Array>>): Promise<string> {
    const uploadId = newUploadId();
    // Sequential on purpose: chunks of one upload share a relay + a
    // background map entry, and the prover key dominates anyway.
    for (const [part, bytes] of Object.entries(parts) as Array<[ProvingUploadPart, Uint8Array | undefined]>) {
      if (bytes) await uploadPart(uploadId, part, bytes);
    }
    return uploadId;
  }

  return {
    async check(serializedPreimage, keyLocation) {
      const ir = isBuiltinKeyLocation(keyLocation)
        ? undefined
        : await loadFromDapp(keyMaterialProvider, keyLocation, 'getZKIR');
      const uploadId = await upload({ preimage: serializedPreimage, ir });
      const request: ProvingCheckRequest = { uploadId, keyLocation };
      const reply = (await send(MIDNIGHT_METHOD.provingCheck, request)) as ProvingCheckReply;
      return reply.result.map((value) => (value === null ? undefined : BigInt(value)));
    },

    async prove(serializedPreimage, keyLocation, overwriteBindingInput) {
      let keyMaterial: Partial<Record<ProvingUploadPart, Uint8Array>> = {};
      if (!isBuiltinKeyLocation(keyLocation)) {
        const [ir, proverKey, verifierKey] = await Promise.all([
          loadFromDapp(keyMaterialProvider, keyLocation, 'getZKIR'),
          loadFromDapp(keyMaterialProvider, keyLocation, 'getProverKey'),
          loadFromDapp(keyMaterialProvider, keyLocation, 'getVerifierKey'),
        ]);
        keyMaterial = { ir, proverKey, verifierKey };
      }
      const uploadId = await upload({ preimage: serializedPreimage, ...keyMaterial });
      const request: ProvingProveRequest = {
        uploadId,
        keyLocation,
        overwriteBindingInput: overwriteBindingInput === undefined ? undefined : overwriteBindingInput.toString(),
      };
      const reply = (await send(MIDNIGHT_METHOD.provingProve, request)) as ProvingProveReply;
      return decodeBase64(reply.proof);
    },
  };
}
