/**
 * Push listeners, added in the worker's FIRST evaluation.
 *
 * Chrome wakes a stopped MV3 worker for a push, a notification click or a push
 * subscription change, and dispatches the event once the script's first
 * evaluation is over. Only listeners added by then receive it.
 *
 * The background bundle is one iife that rollup-plugin-tla makes async, so its
 * first evaluation ends at the first top-level `await __vite__initWasm(...)`.
 * `notifyBackground.ts` (and everything it needs) is placed after that await,
 * so a listener added there is too late: the push that woke the worker was
 * dropped with "Event handler of 'push' event must be added on the initial
 * evaluation of worker script".
 *
 * This module imports nothing and is imported first by `background.ts`, so
 * Rollup emits it ahead of every wasm await. It adds the listeners at once and
 * holds each event, inside `waitUntil`, until `notifyBackground.ts` installs the
 * real handler (`setWorkerEventHandler`). `scripts/worker-listener-guard.mjs`
 * fails the build if any of these listeners is added later.
 */

export type GatedWorkerEvent = 'push' | 'notificationclick' | 'pushsubscriptionchange';

type ExtendableEvent = { waitUntil?: (p: Promise<unknown>) => void };

/** The real handler. Its promise is what the event waits for; it should not reject. */
export type GatedWorkerHandler = (event: never) => Promise<unknown>;

export interface WorkerEventGate {
  /** The listener to add for `type`. */
  listener(type: GatedWorkerEvent): (event: ExtendableEvent) => void;
  /** Installs the real handler and releases the events held for it. */
  setHandler(type: GatedWorkerEvent, handler: GatedWorkerHandler): void;
}

export function createWorkerEventGate(): WorkerEventGate {
  const handlers = new Map<GatedWorkerEvent, GatedWorkerHandler>();
  const waiting = new Map<GatedWorkerEvent, Array<(handler: GatedWorkerHandler) => void>>();

  const handlerFor = (type: GatedWorkerEvent): Promise<GatedWorkerHandler> => new Promise((resolve) => {
    const list = waiting.get(type) ?? [];
    list.push(resolve);
    waiting.set(type, list);
  });

  return {
    listener: (type) => (event) => {
      const ready = handlers.get(type);
      // Installed: start the work in this turn, as before (a synthetic PushEvent
      // has no usable waitUntil). Not yet: wait for it, kept alive by waitUntil.
      const work = ready
        ? ready(event as never)
        : handlerFor(type).then((handler) => handler(event as never));
      const settled = work.then(() => undefined, () => undefined);
      try { event.waitUntil?.(settled); } catch { /* synthetic or no longer extendable */ }
    },
    setHandler: (type, handler) => {
      handlers.set(type, handler);
      const held = waiting.get(type) ?? [];
      waiting.delete(type);
      for (const release of held) release(handler);
    },
  };
}

const gate = createWorkerEventGate();

export const setWorkerEventHandler: WorkerEventGate['setHandler'] = gate.setHandler;

// Literal event names, at module top level: the build guard looks for exactly these calls.
declare const self: { addEventListener?: (type: string, listener: (event: never) => void) => void } | undefined;
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('push', gate.listener('push') as (event: never) => void);
  self.addEventListener('notificationclick', gate.listener('notificationclick') as (event: never) => void);
  self.addEventListener('pushsubscriptionchange', gate.listener('pushsubscriptionchange') as (event: never) => void);
}
