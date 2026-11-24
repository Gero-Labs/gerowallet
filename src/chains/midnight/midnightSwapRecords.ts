// The maker's own swap offers: what the wallet remembers about each one and
// how its status is read from the wallet's synced coins.
//
// Records live in the extension's private store (privateStore.ts), keyed by
// network and wallet id, never in chrome.storage.local.
// The worker is their only writer.
//
// Status, from the coins alone (no server):
//   - an output of the maker's own intent is held → TAKEN (the merged
//     transaction landed: only it creates outputs under that intent hash);
//   - every offered coin is still held → OPEN, or EXPIRED once past its TTL;
//   - an offered coin is gone and nothing arrived → CANCELLED (withdrawn, or
//     spent by something else), or EXPIRED if that was first seen after expiry.
// A terminal status is kept once seen: the coins that proved it can move on.
//
// Pure: no ledger, no storage.

import type { MidnightUnshieldedUtxo } from './midnightTypes';

export type MidnightSwapStatus = 'open' | 'taken' | 'cancelled' | 'expired';

/** One side of an offer: a public token and an amount. */
export interface MidnightSwapLeg {
  /** Raw 32-byte token type, lower-case hex (all zeros for NIGHT). */
  readonly tokenType: string;
  /** Base units, decimal string. */
  readonly amount: string;
}

export interface MidnightSwapOfferRecord {
  /** MIP-0005 content address. */
  readonly offerId: string;
  /** The `swapoffer1…` string, so the maker can show it again. */
  readonly offer: string;
  readonly network: string;
  /** The maker's unshielded bech32m address. */
  readonly owner: string;
  /** What the maker gives (the taker receives). */
  readonly gives: MidnightSwapLeg[];
  /** What the maker asks for (the taker pays). */
  readonly wants: MidnightSwapLeg[];
  readonly createdAt: number;
  /** The intent's TTL, epoch ms. */
  readonly expiresAt: number;
  /** The coins the offer spends, `intentHash#outputNo` (lower-case hash). */
  readonly inputs: string[];
  /** The hash the maker intent's outputs (what the maker receives, and change) are created under (midnightSwap9.ts). */
  readonly intentHash: string;
  /** Last status the worker saw; `open` until a terminal one is seen. */
  status: MidnightSwapStatus;
  /** When the terminal status was first seen. */
  settledAt?: number;
  /** Set when this wallet sent the withdrawal (a self-send of the offered coins). */
  withdrawTxHash?: string;
  /** Whether it was listed with Gero (POST swap-offers). */
  listed?: boolean;
}

/** How long a settled offer stays in the list. */
export const MIDNIGHT_SWAP_RECORD_KEEP_MS = 7 * 24 * 3_600_000;
/** The most offers kept per wallet; the oldest settled ones go first. */
export const MIDNIGHT_SWAP_RECORD_MAX = 50;

/** Private-store key of one wallet's offers on one network (each account is its own wallet record). */
export function midnightSwapRecordsKey(network: string, walletId: number | string): string {
  return `midnightSwapOffers:${network}:${walletId}`;
}

export function utxoRef(utxo: Pick<MidnightUnshieldedUtxo, 'intentHash' | 'outputIndex'>): string {
  return `${utxo.intentHash.toLowerCase()}#${utxo.outputIndex}`;
}

export interface MidnightSwapCoinView {
  /** `null` until a validated sync of the logged wallet has applied its coins. */
  readonly lastSync: number | null;
  readonly utxos: ReadonlyArray<Pick<MidnightUnshieldedUtxo, 'intentHash' | 'outputIndex'>>;
}

/** The status of `record` against the wallet's coins at `now`. */
export function deriveSwapOfferStatus(record: MidnightSwapOfferRecord, view: MidnightSwapCoinView, now: number): MidnightSwapStatus {
  if (record.status !== 'open') return record.status;
  const expired = now >= record.expiresAt;
  // Before a sync the coins say nothing: only the clock does.
  if (view.lastSync === null) return expired ? 'expired' : 'open';
  const intent = record.intentHash.toLowerCase();
  if (view.utxos.some(utxo => utxo.intentHash.toLowerCase() === intent)) return 'taken';
  const held = new Set(view.utxos.map(utxoRef));
  if (record.inputs.every(ref => held.has(ref))) return expired ? 'expired' : 'open';
  return expired && !record.withdrawTxHash ? 'expired' : 'cancelled';
}

/**
 * Re-read every record's status; returns the records (terminal ones stamped
 * with `settledAt`) and whether any changed, so the caller writes only then.
 * Drops settled records older than {@link MIDNIGHT_SWAP_RECORD_KEEP_MS} and
 * keeps at most {@link MIDNIGHT_SWAP_RECORD_MAX}, newest first.
 */
export function refreshSwapOfferRecords(
  records: readonly MidnightSwapOfferRecord[],
  view: MidnightSwapCoinView,
  now: number,
): { records: MidnightSwapOfferRecord[]; changed: boolean } {
  let changed = false;
  const next: MidnightSwapOfferRecord[] = [];
  for (const record of records) {
    const status = deriveSwapOfferStatus(record, view, now);
    if (status !== record.status) {
      changed = true;
      next.push({ ...record, status, settledAt: now });
      continue;
    }
    if (status !== 'open' && (record.settledAt ?? record.expiresAt) + MIDNIGHT_SWAP_RECORD_KEEP_MS < now) {
      changed = true;
      continue;
    }
    next.push(record);
  }
  next.sort((a, b) => b.createdAt - a.createdAt);
  if (next.length > MIDNIGHT_SWAP_RECORD_MAX) {
    changed = true;
    next.length = MIDNIGHT_SWAP_RECORD_MAX;
  }
  return { records: next, changed };
}

/**
 * The coins set aside for open offers: every offered coin of an offer that is
 * still open (not expired). Normal Send and the wallet's own coin selection
 * leave them alone, because spending one cancels the offer.
 */
export function reservedSwapCoins(records: readonly MidnightSwapOfferRecord[], now: number): Set<string> {
  const reserved = new Set<string>();
  for (const record of records) {
    if (record.status !== 'open' || now >= record.expiresAt) continue;
    for (const ref of record.inputs) reserved.add(ref.toLowerCase());
  }
  return reserved;
}

/** `utxos` without the reserved coins. */
export function withoutReservedCoins<U extends Pick<MidnightUnshieldedUtxo, 'intentHash' | 'outputIndex'>>(
  utxos: readonly U[],
  reserved: ReadonlySet<string>,
): U[] {
  if (!reserved.size) return [...utxos];
  return utxos.filter(utxo => !reserved.has(utxoRef(utxo)));
}

/** Validates a stored value as a record list; anything malformed is dropped, not trusted. */
export function readSwapOfferRecords(value: unknown): MidnightSwapOfferRecord[] {
  if (!Array.isArray(value)) return [];
  const isLeg = (leg: unknown): leg is MidnightSwapLeg => !!leg && typeof leg === 'object'
    && typeof (leg as MidnightSwapLeg).tokenType === 'string' && /^[0-9a-f]{64}$/.test((leg as MidnightSwapLeg).tokenType)
    && typeof (leg as MidnightSwapLeg).amount === 'string' && /^[0-9]{1,80}$/.test((leg as MidnightSwapLeg).amount);
  const statuses: readonly string[] = ['open', 'taken', 'cancelled', 'expired'];
  return value.filter((r): r is MidnightSwapOfferRecord => {
    if (!r || typeof r !== 'object') return false;
    const record = r as MidnightSwapOfferRecord;
    return typeof record.offerId === 'string' && /^[0-9a-f]{64}$/.test(record.offerId)
      && typeof record.offer === 'string' && typeof record.network === 'string' && typeof record.owner === 'string'
      && Array.isArray(record.gives) && record.gives.every(isLeg)
      && Array.isArray(record.wants) && record.wants.every(isLeg)
      && Number.isFinite(record.createdAt) && Number.isFinite(record.expiresAt)
      && Array.isArray(record.inputs) && record.inputs.every(ref => typeof ref === 'string' && /^[0-9a-f]+#[0-9]+$/.test(ref))
      && typeof record.intentHash === 'string' && /^[0-9a-f]+$/.test(record.intentHash)
      && statuses.includes(record.status);
  });
}
