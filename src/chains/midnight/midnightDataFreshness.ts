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
/**
 * A tip the wallet has not seen in this long is unknown, not paused: for
 * example one restored from storage after the worker restarted, before the
 * first tip read of the new session lands. The read repeats every 30 s.
 */
export const MIDNIGHT_TIP_OBSERVED_WITHIN_MS = 3 * 60_000;

/** The fields of a chain tip the check reads. */
export interface MidnightTipSnapshot {
  hash?: string | null;
  height: number;
  /** Block time, epoch ms; 0 when unknown. */
  timestamp: number;
  /** Local clock (epoch ms) when the wallet last saw this tip; absent = never in this session. */
  observedAt?: number;
}

/**
 * A block time as epoch milliseconds. `/api/blocks/latest` `time` is epoch
 * seconds; sync frames may carry milliseconds. Values below 1e12 are seconds
 * (1e12 ms is in 2001). Anything else is 0, "unknown".
 */
export function blockTimeToMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value < 1e12 ? value * 1000 : value);
}

/**
 * How old the tip's block is at `now`, or null when it is unknown: no tip, no
 * block time, never seen in this session, or not seen for a while and fresh
 * when it was. A tip that was already paused when last seen stays paused: a
 * frozen chain must not flip back to Online because the wallet stopped seeing
 * new tips.
 */
export function midnightTipAgeMs(tip: MidnightTipSnapshot | null | undefined, now: number): number | null {
  if (!tip || !tip.hash || !Number.isFinite(tip.timestamp) || tip.timestamp <= 0) return null;
  const observedAt = tip.observedAt;
  if (typeof observedAt !== 'number') return null;
  if (now - observedAt > MIDNIGHT_TIP_OBSERVED_WITHIN_MS
    && observedAt - tip.timestamp <= MIDNIGHT_DATA_PAUSED_AFTER_MS) return null;
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
