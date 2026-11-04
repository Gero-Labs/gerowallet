/**
 * On-device Midnight proving, background side.
 *
 * `makeDeviceProvingProvider()` is a `ledger.ProvingProvider` whose proofs are
 * made on this computer, with the pinned built-in keys of midnightZkKeys.ts,
 * instead of by Gero Cloud. Gero then receives only the finished, witness-free
 * transaction (`/tx/submit-proven`).
 *
 * Why an offscreen document: the background is an MV3 service worker. It
 * cannot start a Worker, and a 6-60 s proof on its own thread would stall
 * every message the wallet handles. So the proof runs in a Worker inside an
 * offscreen document (reason WORKERS), created on first use and closed after
 * a minute idle, which also returns the prover's wasm heap (76 MB for a DUST
 * proof, up to 670 MB for a Zswap spend: wasm memory never shrinks).
 *
 * Scope: the ledger-8 built-in circuits only. `midnight/dust/spend` (the fee
 * of every send) always; the Zswap circuits only when the caller passes
 * `shielded: true` (an off-by-default flag, see midnight-tx.service.ts). Any
 * other key location is refused here, before a preimage leaves the
 * background.
 *
 * PRIVACY: the preimage carries the DUST secret key (and, for Zswap spends,
 * the coin secret key). It travels only over the dedicated port to our own
 * offscreen document. Never log preimages or proofs; sizes and durations only.
 */

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import { debugLog } from '@/utils/debug';
import { allowedMidnightZkCircuits } from './midnightZkKeys';
import {
  base64ToBytes,
  bytesToBase64,
  decodeCheckResult,
  MIDNIGHT_PROVER_DOCUMENT,
  MIDNIGHT_PROVER_PORT,
  type MidnightProverReply,
  type MidnightProverRequest,
} from './midnightDeviceProverProtocol';

/** How long the offscreen document has to connect back after it is created. */
const CONNECT_TIMEOUT_MS = 15_000;
/** Close the offscreen document (and its heap) this long after the last proof. */
const IDLE_CLOSE_MS = 60_000;
/**
 * Per-proof deadline. A DUST proof takes about 6 s on an Apple M-series and
 * should stay under 30 s on slow laptops; Zswap spends take 30-60 s on a fast
 * one. The deadline is generous and only stops a prover that is truly stuck.
 */
const PROOF_TIMEOUT_MS = { dust: 180_000, shielded: 600_000 } as const;

/** On-device proving failed or is unavailable. The message is safe to show. */
export class DeviceProvingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeviceProvingError';
  }
}

type Pending = {
  resolve: (reply: Extract<MidnightProverReply, { type: 'result'; ok: true }>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

let proverPort: chrome.runtime.Port | undefined;
let portWaiters: Array<(port: chrome.runtime.Port) => void> = [];
let creating: Promise<void> | undefined;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<unknown> = Promise.resolve();
let nextId = 1;
const pending = new Map<number, Pending>();

function documentUrl(): string {
  return chrome.runtime.getURL(MIDNIGHT_PROVER_DOCUMENT);
}

function failPending(message: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.reject(new DeviceProvingError(message));
    pending.delete(id);
  }
}

function onReply(message: MidnightProverReply): void {
  if (!message || message.type !== 'result') return; // 'busy' only keeps the worker alive
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timer);
  if (message.ok === false) entry.reject(new DeviceProvingError(`On-device proving failed: ${message.error}`));
  else entry.resolve(message);
}

/**
 * Background `runtime.onConnect` hook. Takes the port only when it is our own
 * offscreen prover document (exact URL, no tab: a content script shares the
 * extension id but never the URL). Returns whether the port was ours to take.
 */
export function acceptMidnightProverPort(port: chrome.runtime.Port): boolean {
  if (port.name !== MIDNIGHT_PROVER_PORT) return false;
  const sender = port.sender;
  if (!sender || sender.id !== chrome.runtime.id || sender.tab || sender.url !== documentUrl()) {
    try { port.disconnect(); } catch { /* already gone */ }
    return true;
  }
  if (proverPort && proverPort !== port) {
    try { proverPort.disconnect(); } catch { /* already gone */ }
  }
  proverPort = port;
  port.onMessage.addListener(onReply);
  port.onDisconnect.addListener(() => {
    if (proverPort !== port) return;
    proverPort = undefined;
    failPending('the proving document closed');
  });
  const waiters = portWaiters;
  portWaiters = [];
  waiters.forEach((resolve) => resolve(port));
  return true;
}

async function hasProverDocument(): Promise<boolean> {
  const runtime = chrome.runtime as unknown as {
    getContexts?: (filter: { contextTypes: string[]; documentUrls: string[] }) => Promise<unknown[]>;
  };
  if (!runtime.getContexts) return false;
  const contexts = await runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [documentUrl()] });
  return contexts.length > 0;
}

async function closeProverDocument(): Promise<void> {
  proverPort = undefined;
  try { await chrome.offscreen.closeDocument(); } catch { /* none open */ }
}

async function createProverDocument(): Promise<void> {
  if (!chrome.offscreen?.createDocument) {
    throw new DeviceProvingError('This browser cannot run the Midnight prover (offscreen documents are unavailable)');
  }
  // A document left over from a previous service-worker life reconnects by
  // itself; one that does not within the deadline is replaced below.
  if (!await hasProverDocument()) {
    await chrome.offscreen.createDocument({
      url: MIDNIGHT_PROVER_DOCUMENT,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Generates Midnight zero-knowledge proofs in a worker, so wallet secrets never leave this device.',
    });
  }
}

function waitForPort(timeoutMs: number): Promise<chrome.runtime.Port | undefined> {
  if (proverPort) return Promise.resolve(proverPort);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      portWaiters = portWaiters.filter((w) => w !== onPort);
      resolve(undefined);
    }, timeoutMs);
    const onPort = (port: chrome.runtime.Port) => { clearTimeout(timer); resolve(port); };
    portWaiters.push(onPort);
  });
}

async function ensurePort(): Promise<chrome.runtime.Port> {
  if (proverPort) return proverPort;
  if (!creating) {
    creating = createProverDocument().finally(() => { creating = undefined; });
  }
  await creating;
  let port = await waitForPort(CONNECT_TIMEOUT_MS);
  if (!port) {
    // A stale document that never reconnected: start over once.
    await closeProverDocument();
    await createProverDocument();
    port = await waitForPort(CONNECT_TIMEOUT_MS);
  }
  if (!port) throw new DeviceProvingError('The Midnight prover did not start');
  return port;
}

function scheduleIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    idleTimer = undefined;
    if (pending.size === 0) void closeProverDocument();
  }, IDLE_CLOSE_MS);
}

type ProofRequest = Extract<MidnightProverRequest, { type: 'prove' } | { type: 'check' }>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** One request at a time: zkir is single-threaded, and so is the worker. */
function send(request: DistributiveOmit<ProofRequest, 'id'>): Promise<Extract<MidnightProverReply, { type: 'result'; ok: true }>> {
  const run = async () => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; }
    const port = await ensurePort();
    const id = nextId;
    nextId += 1;
    const timeoutMs = request.shielded ? PROOF_TIMEOUT_MS.shielded : PROOF_TIMEOUT_MS.dust;
    try {
      return await new Promise<Extract<MidnightProverReply, { type: 'result'; ok: true }>>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new DeviceProvingError('On-device proving took too long'));
          // A stuck proof cannot be interrupted any other way.
          void closeProverDocument();
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        port.postMessage({ ...request, id } as MidnightProverRequest);
      });
    } finally {
      scheduleIdleClose();
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

function assertAllowed(keyLocation: string, shielded: boolean): void {
  if (!allowedMidnightZkCircuits(shielded).some((c) => c.keyLocation === keyLocation)) {
    throw new DeviceProvingError(`Circuit ${keyLocation} cannot be proven on this device`);
  }
}

/**
 * A `ProvingProvider` for `tx.prove(provider, costModel)` on a ledger-8
 * network. `shielded` admits the Zswap circuits; without it a transaction
 * that needs any proof other than its DUST fee fails here, before any
 * preimage is sent anywhere.
 */
export function makeDeviceProvingProvider(options: { shielded: boolean }): ledger.ProvingProvider {
  return {
    async check(serializedPreimage, keyLocation) {
      assertAllowed(keyLocation, options.shielded);
      const reply = await send({
        type: 'check', keyLocation, shielded: options.shielded, preimage: bytesToBase64(serializedPreimage),
      });
      if (!reply.check) throw new DeviceProvingError('On-device proving returned no check result');
      return decodeCheckResult(reply.check);
    },
    async prove(serializedPreimage, keyLocation, overwriteBindingInput) {
      assertAllowed(keyLocation, options.shielded);
      const started = Date.now();
      const reply = await send({
        type: 'prove',
        keyLocation,
        shielded: options.shielded,
        preimage: bytesToBase64(serializedPreimage),
        overwriteBindingInput: overwriteBindingInput === undefined ? undefined : overwriteBindingInput.toString(),
      });
      if (!reply.proof) throw new DeviceProvingError('On-device proving returned no proof');
      const proof = base64ToBytes(reply.proof);
      debugLog(`🌙 device prove ${keyLocation}: ${proof.length}B in ${Date.now() - started}ms (worker ${reply.proveMs ?? '?'}ms)`);
      return proof;
    },
  };
}

/** Test seam: forget the port and every queued proof. */
export function resetDeviceProverForTests(): void {
  failPending('reset');
  proverPort = undefined;
  portWaiters = [];
  creating = undefined;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
  queue = Promise.resolve();
  nextId = 1;
}
