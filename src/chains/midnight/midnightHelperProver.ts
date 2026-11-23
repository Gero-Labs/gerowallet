/**
 * Proving with Gero Prover, background side.
 *
 * Gero Prover is a small desktop app that makes Midnight proofs natively on
 * this computer (all processor cores, and the graphics processor where it has
 * a backend), instead of the single-threaded WASM prover of
 * midnightDeviceProver.ts. `makeHelperProvingProvider()` is a
 * `ledger.ProvingProvider` backed by it, so a transaction proves the same way
 * whichever of the two makes the proofs.
 *
 * Transport: Chrome native messaging. The browser starts the helper when this
 * module connects and stops it when the port closes; there is no open port for
 * another program or page to reach, and the helper's own manifest lists this
 * extension as the only caller. An open native port keeps the service worker
 * alive (Chrome 105), so a proof is not cut off. The transport is injected
 * (`HelperConnect`) so tests drive a fake helper.
 *
 * The rules of the device prover hold here too:
 *   - Scope: the ledger 9 built-in circuits only. Any other key location is
 *     refused before a preimage leaves this module.
 *   - Keys: the helper is told the pins of midnightZkKeys.ts and must report
 *     every file of a circuit as held and verified before it is sent a
 *     witness. A file it lacks is read here, checked against its pin, and
 *     handed over; the helper needs no network access.
 *   - One clear error per failure (`HelperProvingError`, a code the pages
 *     translate), and never a switch to another prover: the caller decides.
 *
 * PRIVACY: a preimage carries the DUST secret key (and, for Zswap spends, the
 * coin secret key). It goes only down the native port to the helper on this
 * computer. Never log preimages or proofs; sizes and durations only.
 */

import type * as ledger from '@midnightntwrk/ledger-v9';
import { debugLog } from '@/utils/debug';
import { base64ToBytes, bytesToBase64, decodeCheckResult } from './midnightDeviceProverProtocol';
import {
  GERO_PROVER_CLOSED,
  GERO_PROVER_FORBIDDEN,
  GERO_PROVER_HOST,
  GERO_PROVER_KEYS,
  GERO_PROVER_MIN_VERSION,
  GERO_PROVER_NOT_ALLOWED,
  GERO_PROVER_NOT_FOUND,
  GERO_PROVER_PROOF_FAILED,
  GERO_PROVER_PROTOCOL,
  GERO_PROVER_TIMEOUT,
  GERO_PROVER_UNSUPPORTED_CIRCUIT,
  GERO_PROVER_WRONG_VERSION,
  HELPER_KEY_CHUNK_BYTES,
  helperVersionAtLeast,
  parseHelperReply,
  type GeroProverConnection,
  type GeroProverSnapshot,
  type HelperCircuit,
  type HelperFailureCode,
  type HelperHello,
  type HelperKeyFile,
  type HelperRequest,
  type HelperSelfTest,
  type HelperStatus,
  type HelperSuccess,
} from './midnightHelperProtocol';
import { readVerifiedZkFile } from './midnightZkKeyMaterial';
import {
  allowedMidnightZkCircuits,
  DUST_SPEND_CIRCUIT,
  MIDNIGHT_SRS_FILES,
  MIDNIGHT_ZK_BUNDLED_PATH,
  midnightZkFilesFor,
  type MidnightZkCircuit,
  type MidnightZkFile,
} from './midnightZkKeys';

// ── Failures ────────────────────────────────────────────────────────────────

/**
 * Proving with the helper failed or is unavailable. The message IS the code:
 * it crosses to the pages as the background's error text, and they say it in
 * the user's language (midnight-tx.service.ts `backgroundError`).
 */
export class HelperProvingError extends Error {
  constructor(public readonly code: HelperFailureCode) {
    super(code);
    this.name = 'HelperProvingError';
  }
}

/** The failures that mean "the helper cannot be used", as the status the pages show. */
const CONNECTION_OF: Partial<Record<HelperFailureCode, GeroProverConnection>> = {
  [GERO_PROVER_NOT_ALLOWED]: 'not-allowed',
  [GERO_PROVER_NOT_FOUND]: 'not-found',
  [GERO_PROVER_FORBIDDEN]: 'forbidden',
  [GERO_PROVER_WRONG_VERSION]: 'wrong-version',
};

// ── Transport ───────────────────────────────────────────────────────────────

export interface HelperTransportEvents {
  onMessage(message: unknown): void;
  /** The helper went away. `reason` is the browser's own text, when it gave one. */
  onClose(reason?: string): void;
}

export interface HelperTransport {
  post(message: HelperRequest): void;
  /** Ends the connection (and with it the helper). Does not call `onClose`. */
  close(): void;
}

/** Opens a connection, or throws {@link HelperProvingError} when it cannot be tried at all. */
export type HelperConnect = (events: HelperTransportEvents) => Promise<HelperTransport>;

/**
 * Chrome native messaging. `nativeMessaging` is an optional permission the
 * user grants on the Proof server page; without it there is no API to call.
 */
const connectNative: HelperConnect = async (events) => {
  const allowed = typeof chrome !== 'undefined' && !!chrome.permissions?.contains
    && await chrome.permissions.contains({ permissions: ['nativeMessaging'] });
  if (!allowed || typeof chrome.runtime.connectNative !== 'function') {
    throw new HelperProvingError(GERO_PROVER_NOT_ALLOWED);
  }
  const port = chrome.runtime.connectNative(GERO_PROVER_HOST);
  port.onMessage.addListener((message: unknown) => events.onMessage(message));
  port.onDisconnect.addListener(() => events.onClose(chrome.runtime.lastError?.message));
  return {
    post: (message) => port.postMessage(message),
    close: () => { try { port.disconnect(); } catch { /* already gone */ } },
  };
};

/** The browser's reason for a port that closed before the helper said hello. */
function failureOfClose(reason: string | undefined): HelperFailureCode {
  // Chrome's own strings ("Specified native messaging host not found.",
  // "Access to the specified native messaging host is forbidden.").
  if (reason && /not found/i.test(reason)) return GERO_PROVER_NOT_FOUND;
  if (reason && /forbidden/i.test(reason)) return GERO_PROVER_FORBIDDEN;
  return GERO_PROVER_CLOSED;
}

/** Reads a key file's bytes. Integrity is checked by the caller, against the pin. */
type ReadKeyFile = (file: MidnightZkFile) => Promise<Uint8Array>;

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { redirect: 'error' });
  if (!response.ok) throw new Error(`key file HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** The same two sources the offscreen prover reads: the package, and Gero's key host for the Zswap set. */
const readKeyFile: ReadKeyFile = (file) => {
  if (file.source === 'bundled') {
    return fetchBytes(chrome.runtime.getURL(`${MIDNIGHT_ZK_BUNDLED_PATH.replace(/^\//, '')}${file.name}`));
  }
  // Dot access, so Vite inlines the build-time value.
  const base = (import.meta.env as { VITE_MIDNIGHT_ZK_KEYS_URL?: string }).VITE_MIDNIGHT_ZK_KEYS_URL?.replace(/\/+$/, '');
  if (!base) throw new Error('shielded proving keys are not available in this build');
  return fetchBytes(`${base}/${file.name}`);
};

let connect: HelperConnect = connectNative;
let readFile: ReadKeyFile = readKeyFile;

// ── Session ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = {
  hello: 10_000,
  control: 15_000,
  keyChunk: 60_000,
  /** Native proofs take seconds; the deadline only stops a helper that is stuck. */
  dust: 120_000,
  shielded: 300_000,
  selfTest: 120_000,
} as const;

/** Close the helper this long after the last proof, and sooner after a status read. */
const IDLE_CLOSE_MS = { proof: 60_000, status: 3_000 } as const;

/** A preimage is kilobytes. Far under what one message may carry (64 MiB). */
const MAX_PREIMAGE_BYTES = 8 * 1024 * 1024;

type Pending = {
  resolve: (reply: HelperSuccess) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

interface Session {
  transport: HelperTransport;
  hello: HelperHello;
  /** Key files the helper reported as held and verified, for the pins of this build. */
  ready: Set<string>;
  /** The widest scope `configure` was sent for. */
  shielded: boolean | undefined;
}

let session: Session | undefined;
let opening: Promise<Session> | undefined;
let pending = new Map<number, Pending>();
let nextId = 1;
let queue: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let proofsInFlight = 0;
/** The last status the helper gave, for a read that arrives while it is proving. */
let lastSnapshot: GeroProverSnapshot | undefined;

/** How the helper made the proofs since the last `takeHelperProofStats()`. */
export interface HelperProofStats {
  /** Proofs the graphics processor took part in. */
  gpu: number;
  /** Proofs made by the main processor alone. */
  cpu: number;
  /** A graphics-processor proof did not verify and was made again on the main processor. */
  cpuRetry: boolean;
}
let proofStats: HelperProofStats = { gpu: 0, cpu: 0, cpuRetry: false };

/** The stats of the proofs made since the last call, for the proving history. */
export function takeHelperProofStats(): HelperProofStats {
  const stats = proofStats;
  proofStats = { gpu: 0, cpu: 0, cpuRetry: false };
  return stats;
}

/**
 * Which processor made the proofs of the transaction just proved, for its
 * proving-history row. Reads the stats, and so clears them: call it once per
 * transaction, failed ones included, so the next row is its own.
 */
export function helperProofProcessor(): { processor: 'gpu' | 'cpu'; cpuRetry?: true } {
  const stats = takeHelperProofStats();
  return {
    // Small proofs stay on the main processor even with the graphics processor on.
    processor: stats.gpu > 0 ? 'gpu' : 'cpu',
    ...(stats.cpuRetry ? { cpuRetry: true as const } : {}),
  };
}

function failPending(code: HelperFailureCode): void {
  const entries = pending;
  pending = new Map();
  for (const entry of entries.values()) {
    clearTimeout(entry.timer);
    entry.reject(new HelperProvingError(code));
  }
}

function dropSession(code: HelperFailureCode, close: boolean): void {
  const current = session;
  session = undefined;
  if (close && current) current.transport.close();
  failPending(code);
}

function onMessage(message: unknown): void {
  const reply = parseHelperReply(message);
  if (!reply || reply.type !== 'result') return; // 'busy', or nothing this build understands
  const entry = pending.get(reply.id);
  if (!entry) return;
  pending.delete(reply.id);
  clearTimeout(entry.timer);
  if (reply.ok !== false) {
    entry.resolve(reply);
    return;
  }
  debugLog(`🌙 Gero Prover refused a request: ${reply.code}`);
  const code = reply.code === 'key-mismatch' || reply.code === 'not-configured' ? GERO_PROVER_KEYS
    : reply.code === 'circuit-not-allowed' ? GERO_PROVER_UNSUPPORTED_CIRCUIT
      : reply.code === 'unsupported-protocol' ? GERO_PROVER_WRONG_VERSION
        : GERO_PROVER_PROOF_FAILED;
  entry.reject(new HelperProvingError(code));
}

/** Sends one request and waits for its reply. The caller holds the queue. */
function request(
  transport: HelperTransport,
  message: Record<string, unknown> & { type: HelperRequest['type'] },
  timeoutMs: number,
): Promise<HelperSuccess> {
  const id = nextId;
  nextId += 1;
  return new Promise<HelperSuccess>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A stuck helper cannot be interrupted any other way.
      dropSession(GERO_PROVER_TIMEOUT, true);
      reject(new HelperProvingError(GERO_PROVER_TIMEOUT));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      transport.post({ ...message, id } as HelperRequest);
    } catch {
      pending.delete(id);
      clearTimeout(timer);
      reject(new HelperProvingError(GERO_PROVER_CLOSED));
    }
  });
}

async function open(): Promise<Session> {
  // What happened to THIS connection; a later one must not be failed by its late close.
  const early: { closed: boolean; reason?: string; greeted: boolean; transport?: HelperTransport } = { closed: false, greeted: false };
  const opened = await connect({
    onMessage,
    onClose: (reason) => {
      if (session && session.transport === early.transport) {
        dropSession(GERO_PROVER_CLOSED, false);
        return;
      }
      if (early.greeted) return;
      // Before hello: the browser says why (no such host, or not for this extension).
      early.closed = true;
      early.reason = reason;
      failPending(failureOfClose(reason));
    },
  });
  early.transport = opened;
  if (early.closed) throw new HelperProvingError(failureOfClose(early.reason));
  let reply: HelperSuccess;
  try {
    reply = await request(opened, {
      type: 'hello', protocol: GERO_PROVER_PROTOCOL, client: `gerowallet/${chrome.runtime.getManifest?.().version ?? '0'}`,
    }, TIMEOUT_MS.hello);
  } catch (error) {
    early.greeted = true;
    opened.close();
    throw error;
  }
  early.greeted = true;
  const hello = reply.hello;
  if (!hello || hello.protocol !== GERO_PROVER_PROTOCOL || !helperVersionAtLeast(hello.version, GERO_PROVER_MIN_VERSION)) {
    opened.close();
    // Remembered so the page can name the release that answered.
    lastSnapshot = { connection: 'wrong-version', ...(hello ? { version: hello.version, os: hello.os } : {}) };
    throw new HelperProvingError(GERO_PROVER_WRONG_VERSION);
  }
  session = { transport: opened, hello, ready: new Set(), shielded: undefined };
  return session;
}

async function ensureSession(): Promise<Session> {
  if (session) return session;
  if (!opening) opening = open().finally(() => { opening = undefined; });
  return opening;
}

function scheduleIdleClose(ms: number): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (pending.size > 0 || proofsInFlight > 0 || !session) return;
    try { session.transport.post({ type: 'release' }); } catch { /* closing anyway */ }
    dropSession(GERO_PROVER_CLOSED, true);
  }, ms);
}

/** One request at a time: a proof uses every core, and replies are matched in order of asking. */
function enqueue<T>(run: () => Promise<T>, idleMs: number): Promise<T> {
  const task = async () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    try {
      return await run();
    } finally {
      scheduleIdleClose(idleMs);
    }
  };
  const result = queue.then(task, task);
  queue = result.catch(() => undefined);
  return result;
}

// ── Keys ────────────────────────────────────────────────────────────────────

function circuitFor(keyLocation: string, shielded: boolean): MidnightZkCircuit {
  const circuit = allowedMidnightZkCircuits(shielded).find((c) => c.keyLocation === keyLocation);
  if (!circuit) throw new HelperProvingError(GERO_PROVER_UNSUPPORTED_CIRCUIT);
  return circuit;
}

function describeCircuit(circuit: MidnightZkCircuit): HelperCircuit {
  return {
    keyLocation: circuit.keyLocation,
    k: circuit.k,
    prover: circuit.prover.name,
    verifier: circuit.verifier.name,
    ir: circuit.ir.name,
    srs: MIDNIGHT_SRS_FILES[circuit.k].name,
  };
}

async function configure(current: Session, shielded: boolean): Promise<Set<string>> {
  const circuits = allowedMidnightZkCircuits(shielded);
  const files: HelperKeyFile[] = midnightZkFilesFor(circuits).map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 }));
  const reply = await request(current.transport, { type: 'configure', files, circuits: circuits.map(describeCircuit) }, TIMEOUT_MS.control);
  if (!reply.configured) throw new HelperProvingError(GERO_PROVER_KEYS);
  const listed = new Set(files.map((f) => f.name));
  // Only names this build pinned count, whatever else the helper lists.
  return new Set(reply.configured.ready.filter((name) => listed.has(name)));
}

async function sendKeyFile(current: Session, file: MidnightZkFile): Promise<void> {
  let bytes: Uint8Array;
  try {
    // Checked against its pin here, and again by the helper once it has the whole file.
    bytes = await readVerifiedZkFile(readFile, file);
  } catch (error) {
    debugLog(`🌙 Gero Prover: key file ${file.name} unavailable`, error instanceof Error ? error.message : String(error));
    throw new HelperProvingError(GERO_PROVER_KEYS);
  }
  for (let offset = 0; offset < bytes.length; offset += HELPER_KEY_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + HELPER_KEY_CHUNK_BYTES);
    await request(current.transport, {
      type: 'keyChunk', name: file.name, offset, total: bytes.length, data: bytesToBase64(chunk),
    }, TIMEOUT_MS.keyChunk);
  }
}

/**
 * Makes sure the helper holds, verified, every file of `circuit` before a
 * witness is sent. The widest scope asked for is configured once per
 * connection; files the helper lacks are handed over and it is asked again.
 */
async function ensureKeys(current: Session, circuit: MidnightZkCircuit, shielded: boolean): Promise<void> {
  const needed = midnightZkFilesFor([circuit]);
  const held = () => needed.every((f) => current.ready.has(f.name));
  if (current.shielded === undefined || (shielded && !current.shielded)) {
    current.ready = await configure(current, shielded);
    current.shielded = shielded;
  }
  if (held()) return;
  for (const file of needed) {
    if (!current.ready.has(file.name)) await sendKeyFile(current, file);
  }
  current.ready = await configure(current, current.shielded ?? shielded);
  if (!held()) throw new HelperProvingError(GERO_PROVER_KEYS);
}

// ── Proving ─────────────────────────────────────────────────────────────────

function encodePreimage(serializedPreimage: Uint8Array): string {
  if (serializedPreimage.length > MAX_PREIMAGE_BYTES) throw new HelperProvingError(GERO_PROVER_PROOF_FAILED);
  return bytesToBase64(serializedPreimage);
}

async function proofRequest(
  message: Record<string, unknown> & { type: 'prove' | 'check'; keyLocation: string; shielded: boolean },
): Promise<HelperSuccess> {
  // Refused here, before anything is connected or sent.
  const circuit = circuitFor(message.keyLocation, message.shielded);
  proofsInFlight += 1;
  try {
    return await enqueue(async () => {
      const current = await ensureSession();
      await ensureKeys(current, circuit, message.shielded);
      return request(current.transport, message, message.shielded ? TIMEOUT_MS.shielded : TIMEOUT_MS.dust);
    }, IDLE_CLOSE_MS.proof);
  } finally {
    proofsInFlight -= 1;
  }
}

/**
 * A `ProvingProvider` for `tx.prove(provider, costModel)` on a ledger 9 chain,
 * backed by Gero Prover. `shielded` admits the Zswap circuits, as for the
 * device prover.
 */
export function makeHelperProvingProvider(options: { shielded: boolean }): ledger.ProvingProvider {
  return {
    // The built-in keys are the helper's to load, against this build's pins.
    lookupKey: async () => undefined,
    async check(serializedPreimage, keyLocation) {
      const reply = await proofRequest({
        type: 'check', keyLocation, shielded: options.shielded, preimage: encodePreimage(serializedPreimage),
      });
      if (!reply.check) throw new HelperProvingError(GERO_PROVER_PROOF_FAILED);
      return decodeCheckResult(reply.check);
    },
    async prove(serializedPreimage, keyLocation, overwriteBindingInput) {
      const started = Date.now();
      const reply = await proofRequest({
        type: 'prove',
        keyLocation,
        shielded: options.shielded,
        preimage: encodePreimage(serializedPreimage),
        overwriteBindingInput: overwriteBindingInput === undefined ? undefined : overwriteBindingInput.toString(),
      });
      if (!reply.proof) throw new HelperProvingError(GERO_PROVER_PROOF_FAILED);
      const proof = base64ToBytes(reply.proof);
      if (reply.accelerated) proofStats.gpu += 1;
      else proofStats.cpu += 1;
      if (reply.cpuRetry) proofStats.cpuRetry = true;
      debugLog(`🌙 helper prove ${keyLocation}: ${proof.length}B in ${Date.now() - started}ms (helper ${reply.proveMs ?? '?'}ms, ${reply.accelerated ? 'gpu' : 'cpu'})`);
      return proof;
    },
  };
}

// ── Status and controls (the Proof server page) ─────────────────────────────

function snapshotOfFailure(error: unknown): GeroProverSnapshot {
  const code = error instanceof HelperProvingError ? error.code : undefined;
  const connection = (code && CONNECTION_OF[code]) || 'error';
  // A wrong-version answer keeps the release it named (set in `open`).
  if (connection === 'wrong-version' && lastSnapshot?.connection === 'wrong-version') return lastSnapshot;
  return { connection };
}

function snapshotOf(current: Session, status: HelperStatus): GeroProverSnapshot {
  return { connection: 'connected', version: current.hello.version, os: current.hello.os, status };
}

async function control(
  message: Record<string, unknown> & { type: 'status' | 'setAccelerator' | 'removeKeys' },
): Promise<GeroProverSnapshot> {
  try {
    lastSnapshot = await enqueue(async () => {
      const current = await ensureSession();
      const reply = await request(current.transport, message, TIMEOUT_MS.control);
      if (message.type === 'removeKeys') {
        // Nothing is held any more: the next proof sends its files again.
        current.ready = new Set();
        current.shielded = undefined;
      }
      if (!reply.status) throw new HelperProvingError(GERO_PROVER_CLOSED);
      return snapshotOf(current, reply.status);
    }, IDLE_CLOSE_MS.status);
  } catch (error) {
    lastSnapshot = snapshotOfFailure(error);
  }
  return lastSnapshot;
}

/**
 * Whether the helper can be used and how it is proving. Never throws. Starts
 * the helper to ask (and lets it close again); while a proof is running it
 * answers with what the helper last said rather than wait behind the proof.
 */
export function helperStatus(): Promise<GeroProverSnapshot> {
  if (proofsInFlight > 0 && lastSnapshot) return Promise.resolve(lastSnapshot);
  return control({ type: 'status' });
}

/** The "Use the graphics processor" switch. Turning it on also clears a trip. */
export function setHelperAccelerator(enabled: boolean): Promise<GeroProverSnapshot> {
  return control({ type: 'setAccelerator', enabled });
}

/** Deletes the key files the helper holds; the next proof hands them over again. */
export function removeHelperKeys(): Promise<GeroProverSnapshot> {
  return control({ type: 'removeKeys' });
}

/**
 * Proves the helper's own DUST fixture end to end (keys handed over first if
 * it lacks them) and reports how long it took. Uses no wallet data.
 */
export function runHelperSelfTest(): Promise<HelperSelfTest> {
  return enqueue(async () => {
    const current = await ensureSession();
    await ensureKeys(current, DUST_SPEND_CIRCUIT, false);
    const reply = await request(current.transport, { type: 'selfTest', keyLocation: DUST_SPEND_CIRCUIT.keyLocation }, TIMEOUT_MS.selfTest);
    if (!reply.selfTest) throw new HelperProvingError(GERO_PROVER_PROOF_FAILED);
    return reply.selfTest;
  }, IDLE_CLOSE_MS.proof);
}

/** Test seam: a fake helper and key reader, and a clean slate. */
export function resetHelperProverForTests(deps: { connect?: HelperConnect; readFile?: ReadKeyFile } = {}): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  const current = session;
  session = undefined;
  current?.transport.close();
  failPending(GERO_PROVER_CLOSED);
  opening = undefined;
  queue = Promise.resolve();
  nextId = 1;
  proofsInFlight = 0;
  lastSnapshot = undefined;
  proofStats = { gpu: 0, cpu: 0, cpuRetry: false };
  connect = deps.connect ?? connectNative;
  readFile = deps.readFile ?? readKeyFile;
}
