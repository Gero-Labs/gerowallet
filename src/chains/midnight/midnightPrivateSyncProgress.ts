/**
 * Percent shown for a running private-note scan. Deliberately 0–99: 100 is
 * what `privateSyncStatus === 'synced'` means, and the scan can be at or
 * past the last known relevant event and still be waiting on the indexer.
 */
export interface PrivateSyncProgressLike {
  applied: number;
  highest: number;
}

export function privateSyncPercent(progress: PrivateSyncProgressLike | null | undefined): number {
  if (!progress || !Number.isFinite(progress.applied) || !Number.isFinite(progress.highest) || progress.highest <= 0) return 0;
  const pct = Math.floor((Math.max(0, progress.applied) / progress.highest) * 100);
  return Math.min(99, Math.max(0, pct));
}
