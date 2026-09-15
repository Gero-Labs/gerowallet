// Midnight DApp Connector — proving-delegation wire protocol.
//
// Shared by the page-context bridge (`midnightProvingBridge.ts`, bundled
// into inject.js) and the background handlers (`midnightDappProving.ts`).
// Keep it dependency-free: it ships in the page bundle.
//
// Why chunks: `chrome.runtime.sendMessage` JSON-serializes every message and
// caps its size (tens of MB), while the connector spec warns a circuit's
// prover key "might reach 80MB and more". So each proof's inputs are
// base64-encoded and streamed as fixed-size chunks under one `uploadId`,
// then a single small `check`/`prove` request references the upload.

/** Byte blobs a proof request can carry. `preimage` is always present. */
export type ProvingUploadPart = 'preimage' | 'ir' | 'proverKey' | 'verifierKey';

export const PROVING_UPLOAD_PARTS: readonly ProvingUploadPart[] = ['preimage', 'ir', 'proverKey', 'verifierKey'];

/**
 * Base64 characters per chunk message (~3 MiB of bytes). Comfortably under
 * Chrome's extension-message limit even after the relay adds its envelope.
 *
 * INVARIANT: every chunk is decoded on its own as it arrives, so a chunk
 * must be a whole number of base64 quanta — its length a multiple of 4.
 * Slicing a padded base64 string at multiples of 4 guarantees that (the
 * final slice carries the padding). The background rejects anything else,
 * because `atob` silently accepts an unpadded tail and would decode a
 * mid-quantum split to wrong bytes instead of failing.
 */
export const PROVING_UPLOAD_CHUNK_CHARS = 4 * 1024 * 1024;

/**
 * Key locations the proof server resolves from its own bundled circuits
 * (`midnight/zswap/spend|output|sign`, `midnight/dust/spend`). The wallet
 * must NOT ask the dapp's `KeyMaterialProvider` for these — a
 * `midnight-js` `ZKConfigRegistry` throws for locations it has no bundle
 * for — mirroring `httpClientProvingProvider`'s builtin/contract split.
 */
export const PROVING_BUILTIN_KEY_PREFIX = 'midnight/';

export function isBuiltinKeyLocation(keyLocation: string): boolean {
  return keyLocation.startsWith(PROVING_BUILTIN_KEY_PREFIX);
}

export interface ProvingUploadChunkRequest {
  uploadId: string;
  part: ProvingUploadPart;
  /** 0-based chunk index within `part`. */
  index: number;
  /** Total chunks for `part` (>= 1; an empty blob is one empty chunk). */
  total: number;
  /** Base64 slice of the blob. */
  chunk: string;
}

export interface ProvingCheckRequest {
  uploadId: string;
  keyLocation: string;
}

/** `(bigint | undefined)[]` with bigints as decimal strings and `undefined` as null. */
export interface ProvingCheckReply {
  result: Array<string | null>;
}

export interface ProvingProveRequest {
  uploadId: string;
  keyLocation: string;
  /** `overwriteBindingInput` as a decimal string; absent when not given. */
  overwriteBindingInput?: string;
}

export interface ProvingProveReply {
  /** Base64 proof bytes returned by the proof server. */
  proof: string;
}

/** Synchronous base64 encoder; chunked so `fromCharCode` never sees a huge arg list. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** Throws (a DOMException from `atob`) on malformed input. */
export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}
