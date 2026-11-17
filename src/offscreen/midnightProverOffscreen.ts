/**
 * Offscreen prover document: a relay between the background's prover port
 * and the Worker that runs zkir (chains/midnight/midnightDeviceProverWorker.ts).
 * See chains/midnight/midnightDeviceProver.ts for why it exists.
 *
 * It opens the port itself (the background accepts only this document's URL)
 * and never listens to `runtime.onMessage`, so no other context can reach the
 * prover or read a preimage. While a proof runs it pings the background every
 * few seconds, which keeps the MV3 service worker from being suspended mid-send.
 */

import {
  MIDNIGHT_PROVER_PORT,
  type MidnightProverReply,
  type MidnightProverRequest,
} from '@/chains/midnight/midnightDeviceProverProtocol';

const BUSY_PING_MS = 10_000;

let port: chrome.runtime.Port | undefined;
let worker: Worker | undefined;
let busyTimer: ReturnType<typeof setInterval> | undefined;
const inflight = new Set<number>();

function send(message: MidnightProverReply): void {
  try { port?.postMessage(message); } catch { /* background gone; its proofs are gone too */ }
}

function updateBusy(): void {
  if (inflight.size > 0 && !busyTimer) {
    busyTimer = setInterval(() => send({ type: 'busy' }), BUSY_PING_MS);
  } else if (inflight.size === 0 && busyTimer) {
    clearInterval(busyTimer);
    busyTimer = undefined;
  }
}

/** Fail every running proof and drop the worker (and its wasm heap). */
function stopWorker(reason: string): void {
  for (const id of inflight) send({ type: 'result', id, ok: false, error: reason });
  inflight.clear();
  worker?.terminate();
  worker = undefined;
  updateBusy();
}

function startWorker(): Worker {
  const started = new Worker(new URL('../chains/midnight/midnightDeviceProverWorker.ts', import.meta.url), { type: 'module' });
  started.onmessage = (event: MessageEvent<MidnightProverReply>) => {
    const message = event.data;
    if (message?.type === 'result') inflight.delete(message.id);
    send(message);
    updateBusy();
  };
  started.onerror = (event) => {
    event.preventDefault();
    stopWorker(`the prover stopped (${event.message || 'worker error'})`);
  };
  return started;
}

function onRequest(request: MidnightProverRequest): void {
  if (request?.type === 'release') {
    stopWorker('released');
    return;
  }
  if (request?.type !== 'prove' && request?.type !== 'check') return;
  inflight.add(request.id);
  worker ??= startWorker();
  worker.postMessage(request);
  updateBusy();
}

function connect(): void {
  try {
    port = chrome.runtime.connect({ name: MIDNIGHT_PROVER_PORT });
  } catch {
    return; // extension reloaded: this document is about to go away
  }
  port.onMessage.addListener(onRequest);
  port.onDisconnect.addListener(() => {
    port = undefined;
    // The background restarted (or closed us): nobody waits for these proofs.
    stopWorker('the background restarted');
    setTimeout(connect, 1_000);
  });
}

connect();
