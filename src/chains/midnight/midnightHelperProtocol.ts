/**
 * Wire protocol between the background and Gero Prover, the desktop helper that
 * makes Midnight proofs natively on this computer (midnightHelperProver.ts).
 *
 * `prove` and `check` are the shapes the offscreen prover already uses
 * (midnightDeviceProverProtocol.ts), so the helper is a drop-in alternative to
 * the WASM worker. Everything else is what a separate program needs: a version
 * handshake, pinned key files, the graphics-processor switch and its status.
 *
 * Messages are JSON, one object each, so bytes travel as base64 and bigints as
 * decimal strings. The transport frames them: Chrome native messaging here
 * (a 32-bit length before each message; at most 64 MiB to the helper and 1 MB
 * back), which is why key files go out in chunks and nothing large comes back.
 *
 * The helper is another program, so every reply is parsed here before it is
 * believed (`parseHelperReply`).
 *
 * Dependency-free on purpose: imported by the background, extension pages and tests.
 */

import type { MidnightProverReply, MidnightProverRequest } from './midnightDeviceProverProtocol';

/** Native messaging host name. Chrome allows lowercase letters, digits, dots and underscores. */
export const GERO_PROVER_HOST = 'io.gerowallet.prover';

/** The protocol this build speaks. A helper answering another number is refused. */
export const GERO_PROVER_PROTOCOL = 1;

/** The oldest helper release this build proves with. */
export const GERO_PROVER_MIN_VERSION = '1.0.0';

/** Raw bytes per `keyChunk`: 4 MiB is 5.6 MB of base64, far under the 64 MiB a message may be. */
export const HELPER_KEY_CHUNK_BYTES = 4 * 1024 * 1024;

/** A key file as the helper is asked to hold it: the pin of midnightZkKeys.ts. */
export interface HelperKeyFile {
  name: string;
  bytes: number;
  sha256: string;
}

/** A circuit, by the names of its key files. */
export interface HelperCircuit {
  keyLocation: string;
  k: number;
  prover: string;
  verifier: string;
  ir: string;
  /** The public parameters for `k`. */
  srs: string;
}

type ProofRequest = Extract<MidnightProverRequest, { type: 'prove' } | { type: 'check' }>;

export type HelperRequest =
  /** First message of every connection. */
  | { type: 'hello'; id: number; protocol: number; client: string }
  /**
   * The circuits this connection may prove and the pins of their files. The
   * helper answers which files it holds (each one hashed again against its
   * pin) and which are missing. It proves with nothing that is not listed here.
   */
  | { type: 'configure'; id: number; files: HelperKeyFile[]; circuits: HelperCircuit[] }
  /**
   * One piece of a missing key file. The helper has no network access: the
   * extension reads the file (verified against its pin first) and hands it
   * over. The helper keeps the file only if the whole of it matches the pin
   * from `configure`.
   */
  | { type: 'keyChunk'; id: number; name: string; offset: number; total: number; data: string }
  | ProofRequest
  | { type: 'status'; id: number }
  /** The user's "Use the graphics processor" switch. Turning it on also clears a trip. */
  | { type: 'setAccelerator'; id: number; enabled: boolean }
  /** Proves a fixture the helper ships (a throwaway key), and verifies the proof. No wallet data. */
  | { type: 'selfTest'; id: number; keyLocation: string }
  /** Deletes the key files the helper holds. */
  | { type: 'removeKeys'; id: number }
  /** Give memory back. The helper exits when the connection closes. */
  | { type: 'release' };

/** Why the graphics processor is or is not used. */
export type HelperAcceleratorState =
  /** Proofs use the graphics processor where it helps. */
  | 'active'
  /** Switched off by the user. */
  | 'off'
  /** This build of the helper has a backend, but found no usable device. */
  | 'no-device'
  /** This build of the helper has no backend for this computer. */
  | 'unsupported'
  /**
   * A proof made on the graphics processor did not verify. The helper made it
   * again on the main processor and stays there until the user turns the
   * switch back on.
   */
  | 'tripped';

export interface HelperStatus {
  accelerator: {
    enabled: boolean;
    state: HelperAcceleratorState;
    /** The device's own name ("Apple M3 Pro"). */
    device?: string;
    /** Proof steps taken by each processor since the helper started. */
    gpuOps: number;
    cpuOps: number;
  };
  /** Verified key files on disk. */
  keys: { files: number; bytes: number };
  /** Threads the main processor proves with. */
  threads: number;
}

export interface HelperHello {
  protocol: number;
  version: string;
  os: 'macos' | 'windows' | 'linux';
}

export interface HelperConfigured {
  /** Names of the listed files the helper holds and has verified. */
  ready: string[];
  /** Names it needs sent. */
  missing: string[];
}

export interface HelperSelfTest {
  proveMs: number;
  accelerated: boolean;
}

/** Why the helper refused a request. Text for people comes from the extension, not the helper. */
export type HelperErrorCode =
  | 'bad-request'
  | 'unsupported-protocol'
  | 'not-configured'
  | 'key-mismatch'
  | 'circuit-not-allowed'
  | 'prove-failed'
  | 'internal';

const ERROR_CODES: readonly HelperErrorCode[] = [
  'bad-request', 'unsupported-protocol', 'not-configured', 'key-mismatch', 'circuit-not-allowed', 'prove-failed', 'internal',
];

type ProofResult = Extract<MidnightProverReply, { type: 'result'; ok: true }>;

export type HelperReply =
  | (ProofResult & {
    /** `prove`: whether the graphics processor took part. */
    accelerated?: boolean;
    /** `prove`: the graphics processor's proof did not verify, so this one is the main processor's. */
    cpuRetry?: boolean;
    hello?: HelperHello;
    configured?: HelperConfigured;
    status?: HelperStatus;
    selfTest?: HelperSelfTest;
  })
  | { type: 'result'; id: number; ok: false; error: string; code: HelperErrorCode }
  /** Sent while a proof runs. */
  | { type: 'busy' };

export type HelperSuccess = Extract<HelperReply, { type: 'result'; ok: true }>;

// ── Parsing what the helper says ────────────────────────────────────────────

const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const FIELD = /^\d{1,100}$/;
const FILE_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const ACCELERATOR_STATES: readonly HelperAcceleratorState[] = ['active', 'off', 'no-device', 'unsupported', 'tripped'];
/** A proof is a few kilobytes; a reply cannot exceed 1 MB at all. */
const MAX_PROOF_BASE64 = 1_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Text the helper names something with, as it may be shown: printable, single line, short. */
function label(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/[^\x20-\x7e]/g, '').trim().slice(0, 60);
  return text || undefined;
}

function names(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 64) return undefined;
  return value.every((v) => typeof v === 'string' && FILE_NAME.test(v)) ? value as string[] : undefined;
}

function parseHello(value: unknown): HelperHello | undefined {
  if (!isRecord(value)) return undefined;
  const protocol = count(value['protocol']);
  const version = value['version'];
  const os = value['os'];
  if (protocol === undefined || typeof version !== 'string' || !VERSION.test(version)) return undefined;
  if (os !== 'macos' && os !== 'windows' && os !== 'linux') return undefined;
  return { protocol, version, os };
}

function parseConfigured(value: unknown): HelperConfigured | undefined {
  if (!isRecord(value)) return undefined;
  const ready = names(value['ready']);
  const missing = names(value['missing']);
  return ready && missing ? { ready, missing } : undefined;
}

export function parseHelperStatus(value: unknown): HelperStatus | undefined {
  if (!isRecord(value)) return undefined;
  const accelerator = value['accelerator'];
  const keys = value['keys'];
  if (!isRecord(accelerator) || !isRecord(keys)) return undefined;
  const state = accelerator['state'] as HelperAcceleratorState;
  const gpuOps = count(accelerator['gpuOps']);
  const cpuOps = count(accelerator['cpuOps']);
  const files = count(keys['files']);
  const bytes = count(keys['bytes']);
  const threads = count(value['threads']);
  if (!ACCELERATOR_STATES.includes(state) || typeof accelerator['enabled'] !== 'boolean') return undefined;
  if (gpuOps === undefined || cpuOps === undefined || files === undefined || bytes === undefined || threads === undefined) return undefined;
  const device = label(accelerator['device']);
  return {
    accelerator: { enabled: accelerator['enabled'], state, ...(device ? { device } : {}), gpuOps, cpuOps },
    keys: { files, bytes },
    threads,
  };
}

function parseSelfTest(value: unknown): HelperSelfTest | undefined {
  if (!isRecord(value)) return undefined;
  const proveMs = count(value['proveMs']);
  return proveMs !== undefined && typeof value['accelerated'] === 'boolean' ? { proveMs, accelerated: value['accelerated'] } : undefined;
}

/**
 * A reply as this build understands it, or undefined for anything else. A
 * field that is present must be well formed: a reply with a broken proof or
 * status is dropped whole, and the request it answers then times out or fails
 * on the missing field.
 */
export function parseHelperReply(message: unknown): HelperReply | undefined {
  if (!isRecord(message)) return undefined;
  if (message['type'] === 'busy') return { type: 'busy' };
  const id = count(message['id']);
  if (message['type'] !== 'result' || id === undefined) return undefined;
  if (message['ok'] === false) {
    const code = ERROR_CODES.includes(message['code'] as HelperErrorCode) ? message['code'] as HelperErrorCode : 'internal';
    return { type: 'result', id, ok: false, error: label(message['error']) ?? code, code };
  }
  if (message['ok'] !== true) return undefined;
  const reply: HelperSuccess = { type: 'result', id, ok: true };
  if (message['proof'] !== undefined) {
    if (typeof message['proof'] !== 'string' || message['proof'].length > MAX_PROOF_BASE64 || !BASE64.test(message['proof'])) return undefined;
    reply.proof = message['proof'];
  }
  if (message['check'] !== undefined) {
    if (!Array.isArray(message['check']) || message['check'].length > 4096) return undefined;
    if (!message['check'].every((v) => v === null || (typeof v === 'string' && FIELD.test(v)))) return undefined;
    reply.check = message['check'] as (string | null)[];
  }
  if (message['proveMs'] !== undefined) {
    const proveMs = count(message['proveMs']);
    if (proveMs === undefined) return undefined;
    reply.proveMs = proveMs;
  }
  if (message['accelerated'] !== undefined) {
    if (typeof message['accelerated'] !== 'boolean') return undefined;
    reply.accelerated = message['accelerated'];
  }
  if (message['cpuRetry'] !== undefined) {
    if (typeof message['cpuRetry'] !== 'boolean') return undefined;
    reply.cpuRetry = message['cpuRetry'];
  }
  if (message['hello'] !== undefined) {
    const hello = parseHello(message['hello']);
    if (!hello) return undefined;
    reply.hello = hello;
  }
  if (message['configured'] !== undefined) {
    const configured = parseConfigured(message['configured']);
    if (!configured) return undefined;
    reply.configured = configured;
  }
  if (message['status'] !== undefined) {
    const status = parseHelperStatus(message['status']);
    if (!status) return undefined;
    reply.status = status;
  }
  if (message['selfTest'] !== undefined) {
    const selfTest = parseSelfTest(message['selfTest']);
    if (!selfTest) return undefined;
    reply.selfTest = selfTest;
  }
  return reply;
}

/** Whether helper release `version` is at least `minimum` (both `major.minor.patch`). */
export function helperVersionAtLeast(version: string, minimum: string): boolean {
  if (!VERSION.test(version) || !VERSION.test(minimum)) return false;
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

// ── Failures ────────────────────────────────────────────────────────────────
//
// The background's error text for a helper failure IS one of these codes; the
// pages say it in the user's language (geroProverState.ts).

export const GERO_PROVER_NOT_ALLOWED = 'GERO_PROVER_NOT_ALLOWED';
export const GERO_PROVER_NOT_FOUND = 'GERO_PROVER_NOT_FOUND';
export const GERO_PROVER_FORBIDDEN = 'GERO_PROVER_FORBIDDEN';
export const GERO_PROVER_WRONG_VERSION = 'GERO_PROVER_WRONG_VERSION';
export const GERO_PROVER_CLOSED = 'GERO_PROVER_CLOSED';
export const GERO_PROVER_TIMEOUT = 'GERO_PROVER_TIMEOUT';
export const GERO_PROVER_KEYS = 'GERO_PROVER_KEYS';
export const GERO_PROVER_PROOF_FAILED = 'GERO_PROVER_PROOF_FAILED';
export const GERO_PROVER_UNSUPPORTED_CIRCUIT = 'GERO_PROVER_UNSUPPORTED_CIRCUIT';

export type HelperFailureCode =
  | typeof GERO_PROVER_NOT_ALLOWED
  | typeof GERO_PROVER_NOT_FOUND
  | typeof GERO_PROVER_FORBIDDEN
  | typeof GERO_PROVER_WRONG_VERSION
  | typeof GERO_PROVER_CLOSED
  | typeof GERO_PROVER_TIMEOUT
  | typeof GERO_PROVER_KEYS
  | typeof GERO_PROVER_PROOF_FAILED
  | typeof GERO_PROVER_UNSUPPORTED_CIRCUIT;

// ── What the pages are told ─────────────────────────────────────────────────

/** Whether the helper can be used right now, and why not. */
export type GeroProverConnection =
  | 'connected'
  /** The browser has not been allowed to talk to apps on this computer (the optional permission). */
  | 'not-allowed'
  /** The browser found no Gero Prover registered. */
  | 'not-found'
  /** A Gero Prover is registered, but not for this copy of the extension. */
  | 'forbidden'
  /** It answered with a protocol or release this build does not prove with. */
  | 'wrong-version'
  /** It could not be started, closed early or answered nonsense. */
  | 'error';

/** The helper as the Proof server page and the send dialogs see it. Crosses extension messaging as JSON. */
export interface GeroProverSnapshot {
  connection: GeroProverConnection;
  /** The helper's release, when it said. */
  version?: string;
  os?: HelperHello['os'];
  status?: HelperStatus;
}

/** A snapshot from the background, or `error` for anything that is not one. */
export function parseGeroProverSnapshot(value: unknown): GeroProverSnapshot {
  if (!isRecord(value)) return { connection: 'error' };
  const connections: readonly GeroProverConnection[] = ['connected', 'not-allowed', 'not-found', 'forbidden', 'wrong-version', 'error'];
  const connection = connections.includes(value['connection'] as GeroProverConnection)
    ? value['connection'] as GeroProverConnection : 'error';
  const status = value['status'] === undefined ? undefined : parseHelperStatus(value['status']);
  const version = typeof value['version'] === 'string' && VERSION.test(value['version']) ? value['version'] : undefined;
  const os = value['os'] === 'macos' || value['os'] === 'windows' || value['os'] === 'linux' ? value['os'] : undefined;
  return {
    connection: connection === 'connected' && !status ? 'error' : connection,
    ...(version ? { version } : {}),
    ...(os ? { os } : {}),
    ...(status ? { status } : {}),
  };
}

/** Whether proofs are being made on the graphics processor. */
export function helperUsesGraphicsProcessor(snapshot: GeroProverSnapshot | null | undefined): boolean {
  return snapshot?.connection === 'connected' && snapshot.status?.accelerator.state === 'active';
}
