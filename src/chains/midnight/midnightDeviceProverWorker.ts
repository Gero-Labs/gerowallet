/**
 * The on-device Midnight prover: a module Worker started by the offscreen
 * prover document (src/offscreen/midnightProverOffscreen.ts). It runs zkir-v2,
 * the same single-threaded WASM prover Gero Cloud's sidecar uses, against the
 * pinned keys of midnightZkKeys.ts. A request may ask for the multi-threaded
 * build of the same prover (midnightZkirThreads.ts): it is used when this
 * browser can run it and its files match their pins, else the standard one is.
 *
 * zkir is imported lazily so `onmessage` is registered before any await: a
 * module worker with top-level await in its graph drops messages posted while
 * it is still evaluating.
 *
 * PRIVACY: requests carry proof preimages (secret keys inside). Nothing here
 * logs them or sends them anywhere; errors carry messages only.
 */

/// <reference lib="webworker" />

import {
  base64ToBytes,
  bytesToBase64,
  encodeCheckResult,
  type MidnightProverReply,
  type MidnightProverRequest,
} from './midnightDeviceProverProtocol';
import { makePinnedKeyMaterial, MidnightZkKeyError, readVerifiedZkFile, type PinnedKeyMaterial } from './midnightZkKeyMaterial';
import { MIDNIGHT_ZK_BUNDLED_PATH, MIDNIGHT_ZK_KEY_VERSION, type MidnightZkFile } from './midnightZkKeys';
import {
  MIDNIGHT_ZKIR_MT,
  MIDNIGHT_ZKIR_MT_PATH,
  threadedProvingPlan,
  type ThreadedProvingUnavailable,
} from './midnightZkirThreads';
import { startThreadedZkir, type ThreadedZkirModule } from './midnightZkirThreadsLoader';

declare const self: DedicatedWorkerGlobalScope;

type Zkir = typeof import('@midnight-ntwrk/zkir-v2');

let zkirModule: Promise<Zkir> | undefined;
function loadZkir(): Promise<Zkir> {
  if (!zkirModule) {
    zkirModule = import('@midnight-ntwrk/zkir-v2').catch((error) => {
      zkirModule = undefined;
      throw error;
    });
  }
  return zkirModule;
}

/** `zkir` and `threads` when the threaded build started; else `reason`. */
interface ThreadedLoad {
  zkir?: Zkir;
  threads?: number;
  reason?: ThreadedProvingUnavailable;
}

let threadedLoad: Promise<ThreadedLoad> | undefined;

/**
 * The multi-threaded prover, started once per worker, or why it cannot be
 * used (midnightZkirThreadsLoader.ts: every file of the package is hashed
 * against its pin before any of it runs). It never throws, so a browser or a
 * build without it simply proves with the standard one.
 */
function loadThreadedZkir(): Promise<ThreadedLoad> {
  threadedLoad ??= (async (): Promise<ThreadedLoad> => {
    const base = new URL(MIDNIGHT_ZKIR_MT_PATH, self.location.origin);
    const loaded = await startThreadedZkir<Zkir & ThreadedZkirModule>({
      pkg: MIDNIGHT_ZKIR_MT,
      plan: threadedProvingPlan(self.navigator?.hardwareConcurrency),
      readFile: (name) => fetchBytes(new URL(name, base).toString()),
      // Its own origin, a path fixed at build time: the glue runs unbundled so that
      // the thread helper beside it resolves as upstream wrote it.
      importGlue: (name) => import(/* @vite-ignore */ new URL(name, base).toString()),
    });
    return loaded.ok === true ? { zkir: loaded.zkir, threads: loaded.threads } : { reason: loaded.reason };
  })();
  return threadedLoad;
}

const HOSTED_CACHE = `gero-midnight-zk-${MIDNIGHT_ZK_KEY_VERSION}`;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new MidnightZkKeyError(`Proving key download failed (HTTP ${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * The shielded key set is not shipped in the package (about 29 MB). It comes
 * from Gero's own key host, is verified against its pin and kept in Cache
 * Storage. A cached copy that no longer verifies is dropped and fetched again.
 */
async function fetchHosted(file: MidnightZkFile): Promise<Uint8Array> {
  // Dot access, so Vite inlines the build-time value (a worker bundle gets no env object).
  const base = (import.meta.env as { VITE_MIDNIGHT_ZK_KEYS_URL?: string }).VITE_MIDNIGHT_ZK_KEYS_URL?.replace(/\/+$/, '');
  if (!base) throw new MidnightZkKeyError('Shielded proving keys are not available in this build');
  const url = `${base}/${file.name}`;
  const cache = await caches.open(HOSTED_CACHE);
  const cached = await cache.match(url);
  if (cached) {
    try {
      return await readVerifiedZkFile(async () => new Uint8Array(await cached.arrayBuffer()), file);
    } catch {
      await cache.delete(url);
    }
  }
  const bytes = await readVerifiedZkFile(() => fetchBytes(url), file);
  await cache.put(url, new Response(new Uint8Array(bytes)));
  return bytes;
}

function fetchZkFile(file: MidnightZkFile): Promise<Uint8Array> {
  if (file.source === 'bundled') {
    return fetchBytes(new URL(`${MIDNIGHT_ZK_BUNDLED_PATH}${file.name}`, self.location.origin).toString());
  }
  return fetchHosted(file);
}

/** One provider per prover build and scope, so verified key bytes are reused across proofs. */
const materials = new Map<string, PinnedKeyMaterial>();

interface Prover {
  zkir: Zkir;
  km: PinnedKeyMaterial;
  /** 1 for the standard build. */
  threads: number;
  /** Set when the threaded build was asked for and the standard one is used. */
  threadsUnavailable?: ThreadedProvingUnavailable;
}

async function proverFor(shielded: boolean, threaded: boolean): Promise<Prover> {
  const mt = threaded ? await loadThreadedZkir() : undefined;
  const zkir = mt?.zkir ?? await loadZkir();
  const threads = mt?.zkir ? mt.threads ?? 1 : 1;
  const key = `${threads > 1 ? 'mt' : 'st'}:${shielded}`;
  let km = materials.get(key);
  if (!km) {
    km = makePinnedKeyMaterial(fetchZkFile, zkir, { shielded });
    materials.set(key, km);
  }
  return { zkir, km, threads, ...(mt && !mt.zkir && mt.reason ? { threadsUnavailable: mt.reason } : {}) };
}

function reply(message: MidnightProverReply): void {
  self.postMessage(message);
}

self.onmessage = async (event: MessageEvent<MidnightProverRequest>) => {
  const request = event.data;
  if (!request || (request.type !== 'prove' && request.type !== 'check')) return;
  try {
    const { zkir, km, threads, threadsUnavailable } = await proverFor(request.shielded, request.threaded === true);
    // Every key file is verified before the witness reaches zkir.
    await km.preload(request.keyLocation);
    const provider = zkir.provingProvider(km);
    const preimage = base64ToBytes(request.preimage);
    if (request.type === 'check') {
      const result = await provider.check(preimage, request.keyLocation);
      reply({ type: 'result', id: request.id, ok: true, check: encodeCheckResult(result) });
      return;
    }
    const started = performance.now();
    const overwrite = request.overwriteBindingInput === undefined ? undefined : BigInt(request.overwriteBindingInput);
    const proof = await provider.prove(preimage, request.keyLocation, overwrite);
    preimage.fill(0);
    reply({
      type: 'result',
      id: request.id,
      ok: true,
      proof: bytesToBase64(proof),
      proveMs: Math.round(performance.now() - started),
      threads,
      ...(threadsUnavailable ? { threadsUnavailable } : {}),
    });
  } catch (error) {
    reply({ type: 'result', id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
