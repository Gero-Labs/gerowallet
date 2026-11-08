// Bounds DUST fee preparation by silence and by the transaction's TTL instead of a flat time
// (gero-ios#241: a flat 120 s stopped every NIGHT send on a slow device). Shared by the ledger 8
// builder (midnightTxBuilder.ts) and its Stagenet ledger 9 twin (midnightLedger9.ts). It imports
// no Midnight SDK, so neither stack loads the other's.

/**
 * Longest silence allowed while preparing a DUST fee: no reply from Nexus and no sync step.
 * A slow device on a long DUST history can need many minutes for one pass, and every attempt
 * starts from zero, so the sync is bounded by silence and by the transaction's TTL rather than
 * by a flat time. Keep this well under the mobile apps' 150 s watchdog
 * (`dustSyncInactivityLimit`) so the sync reports its own timeout first.
 */
export const DUST_SYNC_INACTIVITY_MS = 60_000;

/**
 * While replies keep arriving, repeat the last progress step at most this often. A pass can
 * spend minutes between steps, and callers watching progress for silence (the mobile apps'
 * watchdogs) must still see a live sync.
 */
const DUST_SYNC_PROGRESS_REPEAT_MS = 10_000;

export interface DustSyncWatchdog {
  /** Something happened: a reply, a sync step, or local work finished. */
  activity(): void;
  /** Stop watching; the caller aborts its controller itself. */
  stop(): void;
}

/** Aborts `controller` after `inactivityMs` without activity, or at `deadline`, whichever comes first. */
export function watchDustSync(controller: AbortController, inactivityMs: number, deadline: number): DustSyncWatchdog {
  let lastActivity = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Measured from the last activity when the timer fires, not from when it was set: long
  // synchronous ledger work holds the timer back, and the activity just before it counts.
  const check = () => {
    const now = Date.now();
    const remaining = Math.min(lastActivity + inactivityMs, deadline) - now;
    if (remaining <= 0) { timer = undefined; controller.abort(); return; }
    timer = setTimeout(check, remaining);
  };
  check();
  return {
    activity: () => { lastActivity = Date.now(); },
    stop: () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; },
  };
}

/**
 * The progress sink for `reconstructDustState` and the `onActivity` callback for
 * `createDustLightTransport`. Both count as activity. Steps are forwarded to `onProgress`, and
 * while replies keep arriving the last step is repeated every {@link DUST_SYNC_PROGRESS_REPEAT_MS},
 * never before the first one. A throwing `onProgress` cannot break preparation.
 */
export function dustSyncReporting(
  watchdog: DustSyncWatchdog,
  onProgress?: (percent: number, detail: string) => void,
): { progress: (percent: number, detail: string) => void; reply: () => void } {
  let lastStep: { percent: number; detail: string } | undefined;
  let lastReportAt = 0;
  const report = (percent: number, detail: string) => {
    lastReportAt = Date.now();
    try { onProgress?.(percent, detail); } catch { /* advisory */ }
  };
  return {
    progress: (percent, detail) => {
      watchdog.activity();
      lastStep = { percent, detail };
      report(percent, detail);
    },
    reply: () => {
      watchdog.activity();
      if (lastStep && Date.now() - lastReportAt >= DUST_SYNC_PROGRESS_REPEAT_MS) report(lastStep.percent, lastStep.detail);
    },
  };
}
