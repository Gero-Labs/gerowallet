// Midnight DApp Connector — background side of `getProvingProvider`.
//
// The page (`midnightProvingBridge.ts`) streams a proof's preimage and, for
// contract circuits, the dapp's key material here in base64 chunks, then
// asks for `/check` or `/prove`. This module owns the in-memory upload
// store and runs the proof against the user's configured proof server via
// the same `makeLocalProvingProvider` the wallet's own shielded sends use —
// so the dapp never learns the server URL or the user's zkPaaS credentials.
//
// PRIVACY: preimages carry the exact private inputs the proof hides. Never
// log a chunk, an assembled part, a payload, or a proof body — sizes,
// key locations, origins and durations only (matches midnightLocalProver's
// file-header rule).
//
// Kept free of ledger/WASM imports (only type imports) so it can be unit
// tested with a fake provider and so background.ts can import it lazily
// without pulling the ledger into the request path before it is needed.

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type { ProverRequestOptions } from '@/chains/midnight/midnightLocalProver';
import {
  DappProvingUnavailableError,
  describeDappProvingFailure,
  resolveDappProvingTarget,
} from '@/chains/midnight/midnightProvingTarget';
import type { DappProvingTarget, ProofServerPreference } from '@/chains/midnight/midnightProvingTarget';
import { MidnightErrorCode } from '@/chrome/config';
import type { ProvingPark } from '@/chrome/midnightProvingPark';
import { PROVING_UPLOAD_PARTS, decodeBase64, encodeBase64 } from '@/chrome/midnightProvingWire';
import type {
  ProvingCheckReply,
  ProvingProveReply,
  ProvingUploadPart,
} from '@/chrome/midnightProvingWire';
import { debugLog } from '@/utils/debug';

/** An upload nobody has finished within this window is dropped. */
export const PROVING_UPLOAD_TTL_MS = 10 * 60_000;
/** Per-upload decoded-byte cap. The spec warns of 80 MB+ prover keys; leave headroom. */
export const PROVING_UPLOAD_MAX_BYTES = 256 * 1024 * 1024;
/** In-flight uploads one origin may hold (a tx proves several circuits concurrently). */
export const PROVING_UPLOAD_MAX_PER_ORIGIN = 16;
/** A single chunk message larger than this is malformed, not just big. */
export const PROVING_UPLOAD_MAX_CHUNK_CHARS = 8 * 1024 * 1024;
const MAX_CHUNKS_PER_PART = 100_000;
const UPLOAD_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** Malformed or out-of-policy request from the page → `InvalidRequest`. */
export class ProvingUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvingUploadError';
  }
}

/** The proof server refused or failed → `InternalError` with a next-step hint. */
export class DappProvingFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DappProvingFailedError';
  }
}

/** Connector error code for anything thrown by this module. */
export function dappProvingErrorCode(error: unknown): string {
  return error instanceof ProvingUploadError ? MidnightErrorCode.InvalidRequest : MidnightErrorCode.InternalError;
}

interface UploadPartState {
  chunks: Array<Uint8Array | undefined>;
  received: number;
  total: number;
}

interface UploadState {
  origin: string;
  parts: Map<ProvingUploadPart, UploadPartState>;
  bytes: number;
  touchedAt: number;
}

export type AssembledUpload = Partial<Record<ProvingUploadPart, Uint8Array>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUploadPart(value: unknown): value is ProvingUploadPart {
  return typeof value === 'string' && (PROVING_UPLOAD_PARTS as readonly string[]).includes(value);
}

function requireUploadId(value: unknown): string {
  if (typeof value !== 'string' || !UPLOAD_ID_PATTERN.test(value)) {
    throw new ProvingUploadError('uploadId must be a short alphanumeric string');
  }
  return value;
}

/** Overridable for tests; production uses the module constants. */
export interface ProvingUploadStoreOptions {
  now?: () => number;
  ttlMs?: number;
  maxBytes?: number;
  maxPerOrigin?: number;
  maxChunkChars?: number;
}

/**
 * Origin-scoped, size- and time-bounded store for in-flight proof uploads.
 * Lives in the service worker's memory only: if the worker is restarted
 * mid-upload the next `check`/`prove` fails with a clear "upload not
 * found" and the dapp simply retries the proof.
 */
export class ProvingUploadStore {
  private readonly uploads = new Map<string, UploadState>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxBytes: number;
  private readonly maxPerOrigin: number;
  private readonly maxChunkChars: number;

  constructor(options: ProvingUploadStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.ttlMs = options.ttlMs ?? PROVING_UPLOAD_TTL_MS;
    this.maxBytes = options.maxBytes ?? PROVING_UPLOAD_MAX_BYTES;
    this.maxPerOrigin = options.maxPerOrigin ?? PROVING_UPLOAD_MAX_PER_ORIGIN;
    this.maxChunkChars = options.maxChunkChars ?? PROVING_UPLOAD_MAX_CHUNK_CHARS;
  }

  get size(): number {
    return this.uploads.size;
  }

  private static key(origin: string, uploadId: string): string {
    return `${origin}\u0000${uploadId}`;
  }

  private countForOrigin(origin: string): number {
    let count = 0;
    for (const state of this.uploads.values()) if (state.origin === origin) count += 1;
    return count;
  }

  /** Drop uploads idle for longer than the TTL ({@link PROVING_UPLOAD_TTL_MS} by default). */
  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, state] of this.uploads) {
      if (state.touchedAt < cutoff) this.uploads.delete(key);
    }
  }

  /**
   * Forget everything `origin` has in flight — called when the origin is no
   * longer connected, so a dapp the user just disconnected cannot keep
   * feeding an upload it started while approved.
   */
  dropOrigin(origin: string): void {
    for (const [key, state] of this.uploads) {
      if (state.origin === origin) this.uploads.delete(key);
    }
  }

  /** Validate and store one chunk message from `origin`. */
  addChunk(origin: string, data: unknown): void {
    this.sweep();
    if (!isRecord(data)) throw new ProvingUploadError('chunk request must be an object');
    const uploadId = requireUploadId(data['uploadId']);
    const { part, index, total, chunk } = data;
    if (!isUploadPart(part)) throw new ProvingUploadError(`unknown upload part '${String(part)}'`);
    if (!Number.isInteger(total) || (total as number) < 1 || (total as number) > MAX_CHUNKS_PER_PART) {
      throw new ProvingUploadError('total must be an integer between 1 and 100000');
    }
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= (total as number)) {
      throw new ProvingUploadError('index must be an integer in [0, total)');
    }
    if (typeof chunk !== 'string' || chunk.length > this.maxChunkChars) {
      throw new ProvingUploadError(`chunk must be a base64 string of at most ${this.maxChunkChars} characters`);
    }
    // Whole quanta only — see the invariant on PROVING_UPLOAD_CHUNK_CHARS.
    if (chunk.length % 4 !== 0) {
      throw new ProvingUploadError('chunk length must be a multiple of 4 (whole base64 quanta)');
    }
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(chunk);
    } catch {
      throw new ProvingUploadError('chunk is not valid base64');
    }

    const key = ProvingUploadStore.key(origin, uploadId);
    let state = this.uploads.get(key);
    if (!state) {
      if (this.countForOrigin(origin) >= this.maxPerOrigin) {
        throw new ProvingUploadError(`too many in-flight proof uploads (max ${this.maxPerOrigin} per site)`);
      }
      state = { origin, parts: new Map(), bytes: 0, touchedAt: this.now() };
      this.uploads.set(key, state);
    }
    if (state.bytes + bytes.length > this.maxBytes) {
      this.uploads.delete(key);
      throw new ProvingUploadError(`proof upload exceeds ${this.maxBytes} bytes`);
    }

    let partState = state.parts.get(part);
    if (!partState) {
      partState = { chunks: new Array<Uint8Array | undefined>(total as number), received: 0, total: total as number };
      state.parts.set(part, partState);
    } else if (partState.total !== total) {
      this.uploads.delete(key);
      throw new ProvingUploadError(`chunk total for '${part}' changed mid-upload`);
    }
    if (partState.chunks[index as number] !== undefined) {
      this.uploads.delete(key);
      throw new ProvingUploadError(`duplicate chunk ${index} for '${part}'`);
    }
    partState.chunks[index as number] = bytes;
    partState.received += 1;
    state.bytes += bytes.length;
    state.touchedAt = this.now();
  }

  /**
   * Assemble and remove `uploadId` for `origin`. Throws if it is unknown
   * (never started, expired, swept, or owned by another origin — all
   * indistinguishable on purpose) or any part is still missing chunks.
   */
  take(origin: string, uploadId: unknown): AssembledUpload {
    this.sweep();
    const key = ProvingUploadStore.key(origin, requireUploadId(uploadId));
    const state = this.uploads.get(key);
    if (!state) throw new ProvingUploadError('proof upload not found or expired. Retry the proof');
    this.uploads.delete(key);
    const assembled: AssembledUpload = {};
    for (const [part, partState] of state.parts) {
      if (partState.received !== partState.total) {
        throw new ProvingUploadError(`'${part}' is incomplete (${partState.received}/${partState.total} chunks)`);
      }
      const size = partState.chunks.reduce((sum, c) => sum + (c?.length ?? 0), 0);
      const out = new Uint8Array(size);
      let offset = 0;
      for (const c of partState.chunks) {
        if (!c) continue;
        out.set(c, offset);
        offset += c.length;
      }
      assembled[part] = out;
    }
    return assembled;
  }
}

/**
 * Upper bound for one `/prove` round-trip. Contract circuits are far larger
 * than the wallet's own transfer circuits, so this matches midnight-js's
 * proof-provider default rather than the prover client's 120 s.
 */
export const DAPP_PROVING_TIMEOUT_MS = 300_000;

/** Who is asking, on which network, with which stored proof-server preference. */
export interface DappProvingContext {
  origin: string;
  network: string;
  /** SDK network id (`mainnet` / `preprod` / `stagenet`) — selects the ledger 8 vs 9 payload codec. */
  sdkNetworkId: string;
  proofServer: ProofServerPreference;
  /** Sender tab; needed to park a "proof server needed" prompt. Absent → no parking. */
  tabId?: number;
}

/** Injected so tests (and a future in-extension WASM prover) can swap the transport. */
export interface DappProvingDeps {
  makeProvider: (baseUrl: string, options?: ProverRequestOptions) => ledger.ProvingProvider;
  /** When present (and the context has a tab), an unreachable server prompts instead of failing. */
  park?: ProvingPark;
}

/**
 * `getProvingProvider()` preflight: throws {@link DappProvingUnavailableError}
 * when the stored preference cannot serve dapp proofs at all. Returns the
 * resolved source for logging; the page never receives the URL/headers.
 */
export function assertDappProvingAvailable(ctx: DappProvingContext): DappProvingTarget['source'] {
  return resolveDappProvingTarget(ctx.network, ctx.proofServer).source;
}

function requireKeyLocation(data: Record<string, unknown>): string {
  const { keyLocation } = data;
  if (typeof keyLocation !== 'string' || keyLocation.length === 0 || keyLocation.length > 512) {
    throw new ProvingUploadError('keyLocation must be a non-empty string');
  }
  return keyLocation;
}

function requireRequest(data: unknown): Record<string, unknown> {
  if (!isRecord(data)) throw new ProvingUploadError('request must be an object');
  return data;
}

/** The dapp either sends all three contract artifacts or none (builtin circuit). */
function keyMaterialFor(upload: AssembledUpload, keyLocation: string): Partial<ledger.ProvingKeyMaterial> | undefined {
  const { ir, proverKey, verifierKey } = upload;
  if (!ir && !proverKey && !verifierKey) return undefined;
  if (ir && proverKey && verifierKey) return { ir, proverKey, verifierKey };
  throw new ProvingUploadError(`incomplete key material for circuit '${keyLocation}' (prover key, verifier key and ZKIR are all required)`);
}

/** Zero the assembled buffers when a proof is given up (a parked retry may have held them for minutes): preimages are the private inputs. */
function wipeUpload(upload: AssembledUpload): void {
  for (const part of PROVING_UPLOAD_PARTS) upload[part]?.fill(0);
}

async function withProvingTarget<T>(
  ctx: DappProvingContext,
  deps: DappProvingDeps,
  op: 'check' | 'prove',
  keyLocation: string,
  run: (target: DappProvingTarget) => Promise<T>,
): Promise<T> {
  const target = resolveDappProvingTarget(ctx.network, ctx.proofServer);
  const startedAt = Date.now();
  debugLog(`🌙 connector ${op}: start`, { origin: ctx.origin, keyLocation, source: target.source });
  try {
    // With a park and a tab, an unreachable server prompts the user (retry /
    // cancel) instead of failing; ProvingParkCancelled carries the last
    // failure detail as its message, so the wording below stays the same.
    const result = deps.park && typeof ctx.tabId === 'number'
      ? await deps.park.run({ origin: ctx.origin, tabId: ctx.tabId, target }, () => run(target))
      : await run(target);
    debugLog(`🌙 connector ${op}: ok (${Date.now() - startedAt}ms)`, { origin: ctx.origin, keyLocation });
    return result;
  } catch (error) {
    if (error instanceof ProvingUploadError || error instanceof DappProvingUnavailableError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    debugLog(`🌙 connector ${op}: failed (${Date.now() - startedAt}ms)`, { origin: ctx.origin, keyLocation, detail });
    throw new DappProvingFailedError(describeDappProvingFailure(target, detail));
  }
}

/** `/check`: which of the proof's public inputs the circuit leaves unconstrained. */
export async function runDappProvingCheck(
  store: ProvingUploadStore,
  deps: DappProvingDeps,
  ctx: DappProvingContext,
  data: unknown,
): Promise<ProvingCheckReply> {
  const request = requireRequest(data);
  const keyLocation = requireKeyLocation(request);
  const upload = store.take(ctx.origin, request['uploadId']);
  if (!upload.preimage) throw new ProvingUploadError('preimage was not uploaded');
  const ir = upload.ir;
  return withProvingTarget(ctx, deps, 'check', keyLocation, async (target) => {
    const provider = deps.makeProvider(target.url, {
      headers: target.headers,
      sdkNetworkId: ctx.sdkNetworkId,
      timeoutMs: DAPP_PROVING_TIMEOUT_MS,
      resolveKeyMaterial: async () => (ir ? { ir } : undefined),
    });
    const result = await provider.check(upload.preimage!, keyLocation);
    return { result: result.map((value) => (value === undefined ? null : value.toString())) };
  }).catch((error: unknown) => {
    wipeUpload(upload);
    throw error;
  });
}

/** `/prove`: generate the proof for one preimage. */
export async function runDappProvingProve(
  store: ProvingUploadStore,
  deps: DappProvingDeps,
  ctx: DappProvingContext,
  data: unknown,
): Promise<ProvingProveReply> {
  const request = requireRequest(data);
  const keyLocation = requireKeyLocation(request);
  let overwriteBindingInput: bigint | undefined;
  const rawBindingInput = request['overwriteBindingInput'];
  if (rawBindingInput !== undefined) {
    if (typeof rawBindingInput !== 'string' || !/^-?\d+$/.test(rawBindingInput)) {
      throw new ProvingUploadError('overwriteBindingInput must be a decimal string');
    }
    overwriteBindingInput = BigInt(rawBindingInput);
  }
  const upload = store.take(ctx.origin, request['uploadId']);
  if (!upload.preimage) throw new ProvingUploadError('preimage was not uploaded');
  const keyMaterial = keyMaterialFor(upload, keyLocation);
  return withProvingTarget(ctx, deps, 'prove', keyLocation, async (target) => {
    const provider = deps.makeProvider(target.url, {
      headers: target.headers,
      sdkNetworkId: ctx.sdkNetworkId,
      timeoutMs: DAPP_PROVING_TIMEOUT_MS,
      resolveKeyMaterial: async () => keyMaterial,
    });
    const proof = await provider.prove(upload.preimage!, keyLocation, overwriteBindingInput);
    return { proof: encodeBase64(proof) };
  }).catch((error: unknown) => {
    wipeUpload(upload);
    throw error;
  });
}
