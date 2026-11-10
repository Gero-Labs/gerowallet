/**
 * "Refreshing": the wallet's Midnight data is being rebuilt after a chain reset
 * (a new chain generation, for example after a network upgrade) or a forced
 * resync, and the balances and history on screen are the last ones the wallet
 * knew, not the rebuild's partial state.
 *
 * The store keeps a snapshot of what was on screen (`refreshSnapshot`) and a
 * small status (`refreshing`); browser views show the snapshot, greyed, until
 * the background ends the refresh and the rebuilt state replaces it in one
 * step. This module holds the pure parts: what to keep, how the rebuild's end
 * is recognised, and how the frames are read.
 *
 * When does a rebuild end? gero-sync sends no "caught up" marker for the
 * Midnight history stream (its progress markers stay on the server), so the
 * wallet decides from what it has:
 * - Same chain (the reset kept the genesis hash: a re-index or an upgrade):
 *   the newest confirmed public transaction the wallet showed before the reset
 *   is back in the rebuilt history. Everything up to it has been replayed.
 * - A new chain, or nothing to wait for: no transaction has arrived for
 *   {@link REFRESH_QUIET_MS}.
 * - Waiting for a transaction that doesn't come back: none has arrived for
 *   {@link REFRESH_TARGET_WAIT_MS}; the rebuilt state is what the server has.
 * While no frame at all has arrived for {@link REFRESH_STALL_MS}, or the socket
 * has been down for {@link REFRESH_OFFLINE_GRACE_MS}, the refresh is "stalled": the old values stay, with a line that says
 * to check the connection.
 */
import type { MidnightBalances, MidnightDustState, MidnightTransaction, MidnightUnshieldedUtxo } from './midnightTypes';
import { normalizeMidnightTxHash } from './midnightTxHash';

/** With nothing to wait for, the rebuild is done once transactions stop arriving for this long. */
export const REFRESH_QUIET_MS = 15_000;
/** Waiting for a transaction that doesn't come back: give up after this long without one. */
export const REFRESH_TARGET_WAIT_MS = 5 * 60_000;
/** No frame at all for this long (keep-alives included) reads as a stalled connection. */
export const REFRESH_STALL_MS = 60_000;
/** The socket down for this long (a reconnect is shorter) also reads as stalled. */
export const REFRESH_OFFLINE_GRACE_MS = 10_000;
/** How often the background re-checks a refresh in progress. */
export const REFRESH_CHECK_MS = 5_000;

/** The tip fields the "As of block N · age" caption reads. */
export interface MidnightRefreshTip {
  hash: string | null;
  height: number;
  timestamp: number;
  observedAt?: number;
}

/** What the wallet showed before the reset, shown again (greyed) until the rebuild ends. */
export interface MidnightRefreshSnapshot {
  balances: MidnightBalances;
  transactions: MidnightTransaction[];
  /** Custom tokens' balances come from the UTxO set: without it USDM and the like would vanish. */
  utxos: MidnightUnshieldedUtxo[];
  dustState: MidnightDustState | null;
  tip: MidnightRefreshTip;
}

/** Why the wallet is refreshing, when the server said: only a network upgrade changes the wording. */
export type MidnightRefreshReason = 'upgrade' | null;

/** The small, broadcast part of a refresh in progress. */
export interface MidnightRefreshStatus {
  /** Epoch ms. */
  startedAt: number;
  reason: MidnightRefreshReason;
  /** No frame for a while, or the socket is down: "Still refreshing. Check your connection." */
  stalled: boolean;
  /** 0-99 when the sync service reports progress, else null. */
  progress: number | null;
}

/** The background's bookkeeping for a refresh in progress (never broadcast). */
export interface MidnightRefreshTracker {
  startedAt: number;
  /** Last frame of any kind (keep-alives included). */
  lastFrameAt: number;
  /** Last frame that carried transactions. */
  lastTxAt: number;
  /** The newest confirmed public transaction from before the reset, normalized; null = nothing to wait for. */
  target: string | null;
  /** The reset kept the chain (same genesis), so the old transactions come back. */
  sameChain: boolean;
}

/** True when there is something on screen worth keeping through a rebuild. */
export function hasDataToKeep(balances: MidnightBalances | null | undefined, transactions: readonly MidnightTransaction[]): boolean {
  if (transactions.length > 0) return true;
  if (!balances) return false;
  return (balances.nightUnshielded ?? 0n) > 0n || (balances.nightShielded ?? 0n) > 0n
    || (balances.nightRegistered ?? 0n) > 0n || (balances.dust ?? 0n) > 0n
    || Object.values(balances.shieldedTokens ?? {}).some((v) => v > 0n);
}

/** True when the snapshot shows private (shielded) figures, which only the on-device scan rebuilds. */
export function hasShieldedFigures(balances: MidnightBalances | null | undefined): boolean {
  return !!balances && ((balances.nightShielded ?? 0n) > 0n || Object.values(balances.shieldedTokens ?? {}).some((v) => v > 0n));
}

/**
 * The transaction whose return marks the rebuild's end: the newest confirmed
 * public row. Shielded rows come from the on-device scan and pending rows were
 * never on chain, so neither is replayed by the history stream.
 */
export function refreshTargetOf(transactions: readonly MidnightTransaction[]): string | null {
  let newest: MidnightTransaction | null = null;
  for (const tx of transactions) {
    if (tx.status !== 'confirmed' || tx.isShielded || !tx.hash) continue;
    if (!newest || tx.timestamp > newest.timestamp) newest = tx;
  }
  return newest ? normalizeMidnightTxHash(newest.hash) : null;
}

/**
 * The reason on a sync identity frame, when gero-sync sends one: `network_upgrade`
 * reads as an upgrade; `reindex`, `chain_reset` or nothing get the plain wording.
 */
export function refreshReasonOf(data: Record<string, unknown> | null | undefined): MidnightRefreshReason {
  return data?.['midnight_chain_generation_reason'] === 'network_upgrade' ? 'upgrade' : null;
}

/** Progress from a frame's `catch_up_sent` / `catch_up_total`, when present, as 0-99. */
export function refreshProgressOf(data: Record<string, unknown> | null | undefined): number | null {
  const sent = data?.['catch_up_sent'];
  const total = data?.['catch_up_total'];
  if (typeof sent !== 'number' || typeof total !== 'number' || !Number.isFinite(sent) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.max(0, Math.min(99, Math.floor((Math.min(sent, total) / total) * 100)));
}

/** Where a refresh stands at `now`. */
export function refreshVerdict(
  tracker: MidnightRefreshTracker,
  transactions: readonly MidnightTransaction[],
  now: number,
  connected: boolean,
): 'done' | 'stalled' | 'refreshing' {
  if (tracker.target && tracker.sameChain
    && transactions.some((tx) => tx.status === 'confirmed' && normalizeMidnightTxHash(tx.hash) === tracker.target)) {
    return 'done';
  }
  const sinceFrame = now - tracker.lastFrameAt;
  if (sinceFrame >= REFRESH_STALL_MS || (!connected && sinceFrame >= REFRESH_OFFLINE_GRACE_MS)) return 'stalled';
  const waitingForTarget = !!tracker.target && tracker.sameChain;
  if (now - tracker.lastTxAt >= (waitingForTarget ? REFRESH_TARGET_WAIT_MS : REFRESH_QUIET_MS)) return 'done';
  return 'refreshing';
}
