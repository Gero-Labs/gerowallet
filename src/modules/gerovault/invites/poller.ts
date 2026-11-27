/**
 * A slow fallback poll for the invitation screens. gero-sync allows 120 reads an hour per device
 * (`PROTOCOL.md` 7.6), and the routes live inside `<keep-alive>`, so a plain `setInterval` kept
 * asking after the page was left and spent the whole allowance. This one:
 *
 * - runs only while nothing paused it (`pause(reason)` / `resume(reason)`: the page was
 *   deactivated, the document is hidden), and stops for good on `stop()`;
 * - waits out a rate limit (`holdUntil`) before it asks again;
 * - on `resume` reads once at most (when the last read is older than `minGapMs`), so coming back
 *   to a page shows current state without a burst;
 * - never overlaps itself: the next wait starts when a read has finished.
 *
 * The push (`vault_response`, `vault_invite`) is what refreshes at once (`useVaultPush.ts`); this
 * only covers a push that never arrived.
 */
export interface PollerDeps {
  /** One read. A rejection is the caller's to handle; the poller only waits for it to settle. */
  run(): Promise<unknown> | unknown;
  /** The wait between reads, read before every wait (a dialog may shorten it for a while). */
  intervalMs(): number;
  /** Do not read again on `resume` or `kick` sooner than this after the last read. Default 5 s. */
  minGapMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface Poller {
  start(): void;
  stop(): void;
  pause(reason: string): void;
  resume(reason: string): void;
  /** No read before this time (a 429's Retry-After). */
  holdUntil(at: number): void;
  /** The interval changed: wait the new one from now. */
  reschedule(): void;
  /** Running, with nothing pausing it. */
  readonly active: boolean;
}

export function createPoller(deps: PollerDeps): Poller {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const minGapMs = deps.minGapMs ?? 5_000;
  const paused = new Set<string>();
  let started = false;
  let timer: unknown;
  let heldUntil = 0;
  let lastRun = 0;
  let running = false;

  const isActive = () => started && paused.size === 0;

  function cancel(): void {
    if (timer !== undefined) clearTimer(timer);
    timer = undefined;
  }

  function schedule(delay: number): void {
    cancel();
    if (!isActive()) return;
    timer = setTimer(() => { timer = undefined; void tick(); }, Math.max(delay, heldUntil - now(), 0));
  }

  async function tick(): Promise<void> {
    if (!isActive() || running) return;
    if (now() < heldUntil) {
      schedule(0);
      return;
    }
    running = true;
    lastRun = now();
    try {
      await deps.run();
    } catch {
      // The caller shows its own problem; the next read is tried after the usual wait.
    } finally {
      running = false;
    }
    schedule(deps.intervalMs());
  }

  return {
    start() {
      if (started) return;
      started = true;
      lastRun = now();
      schedule(deps.intervalMs());
    },
    stop() {
      started = false;
      cancel();
    },
    pause(reason) {
      paused.add(reason);
      cancel();
    },
    resume(reason) {
      if (!paused.delete(reason) || !isActive()) return;
      // Back on the page: one read now if the last one is old, then the usual wait.
      const since = now() - lastRun;
      schedule(since >= minGapMs ? 0 : deps.intervalMs() - since);
    },
    holdUntil(at) {
      heldUntil = Math.max(heldUntil, at);
      if (timer !== undefined) schedule(deps.intervalMs());
    },
    reschedule() {
      if (timer !== undefined) schedule(deps.intervalMs());
    },
    get active() {
      return isActive();
    },
  };
}

/** Pauses a poller while the document is hidden. Returns the remover. No-op without a document. */
export function pauseWhileHidden(poller: Pick<Poller, 'pause' | 'resume'>, doc: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> | undefined = typeof document === 'undefined' ? undefined : document): () => void {
  if (!doc) return () => undefined;
  const sync = () => (doc.hidden ? poller.pause('hidden') : poller.resume('hidden'));
  sync();
  doc.addEventListener('visibilitychange', sync);
  return () => doc.removeEventListener('visibilitychange', sync);
}
