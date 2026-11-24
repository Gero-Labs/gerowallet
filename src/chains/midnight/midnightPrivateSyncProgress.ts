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

/** The counters a wallet SDK sync state carries (wallet SDK 1 and 2 alike). */
export interface SdkSyncProgressLike {
  appliedIndex: bigint | number;
  highestRelevantWalletIndex: bigint | number;
  isConnected: boolean;
}

/** What the dashboard and mini-Gero show for a running scan (`MidnightPrivateSyncProgress`). */
export interface PrivateSyncProgressView extends PrivateSyncProgressLike {
  connected: boolean;
}

export function privateSyncProgressOf(progress: SdkSyncProgressLike): PrivateSyncProgressView {
  return {
    applied: Number(progress.appliedIndex),
    highest: Number(progress.highestRelevantWalletIndex),
    connected: progress.isConnected,
  };
}

/** True when nothing a reader shows would change, so a store write can be skipped. */
export function sameSyncProgress(a: PrivateSyncProgressView | null | undefined, b: PrivateSyncProgressView): boolean {
  return !!a && a.applied === b.applied && a.highest === b.highest && a.connected === b.connected;
}
