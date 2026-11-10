/**
 * "Data paused": the Midnight data the wallet reads has stopped advancing.
 *
 * The wallet polls the latest block every 30 s and stores its block time in
 * `midnightStore.tip.timestamp` (epoch ms). Midnight blocks are about 6 s
 * apart, so a tip whose block time is more than 10 minutes old means the data
 * behind balances, the DUST battery and history is not moving, even while the
 * sync socket is connected.
 *
 * Device clock: the age is the local clock minus the block time, so a clock
 * that runs a few minutes fast makes a fresh tip look a few minutes old, which
 * stays well under the threshold; a clock that runs slow makes it look newer.
 * Only a clock more than ~10 minutes off could flip the state on its own.
 */

/** A tip older than this is "paused". */
export const MIDNIGHT_DATA_PAUSED_AFTER_MS = 10 * 60_000;

/** The fields of a chain tip the check reads. */
export interface MidnightTipSnapshot {
  hash?: string | null;
  height: number;
  /** Block time, epoch ms; 0 when unknown. */
  timestamp: number;
}

/** How old the tip's block is at `now`, or null when the tip or its time is unknown. */
export function midnightTipAgeMs(tip: MidnightTipSnapshot | null | undefined, now: number): number | null {
  if (!tip || !tip.hash || !Number.isFinite(tip.timestamp) || tip.timestamp <= 0) return null;
  return Math.max(0, now - tip.timestamp);
}

/** True when the tip's block time is more than {@link MIDNIGHT_DATA_PAUSED_AFTER_MS} old. Unknown is never paused. */
export function isMidnightDataPaused(tip: MidnightTipSnapshot | null | undefined, now: number): boolean {
  const age = midnightTipAgeMs(tip, now);
  return age !== null && age > MIDNIGHT_DATA_PAUSED_AFTER_MS;
}

export type MidnightNetworkChipState = 'online' | 'paused' | 'connecting' | 'offline';

/**
 * The header chip for a Midnight wallet. A connected socket alone is not
 * "online": when the blocks it delivers are old, the chip says "paused".
 */
export function midnightNetworkChipState(networkStatus: string, paused: boolean): MidnightNetworkChipState {
  if (networkStatus === 'connected') return paused ? 'paused' : 'online';
  if (networkStatus === 'connecting') return 'connecting';
  return 'offline';
}
