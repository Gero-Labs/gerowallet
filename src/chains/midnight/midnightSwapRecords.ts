// The maker's own swap offers: what the wallet remembers about each one and
// how its status is read from the wallet's synced coins.
//
// Records live in the extension's private store (privateStore.ts), keyed by
// network and wallet id, never in chrome.storage.local.
// The worker is their only writer.
//
// Status, from the coins alone (no server):
//   - an output of the maker's own intent is held, or (private legs) a coin
//     whose commitment the offer created → TAKEN (the merged transaction
//     landed: only it creates those coins);
//   - every offered coin is still held (public by `intentHash#outputNo`,
//     private by nullifier) → OPEN, or EXPIRED once past its expiry;
//   - an offered coin is gone and nothing arrived → CANCELLED (withdrawn, or
//     spent by something else), or EXPIRED if that was first seen after expiry.
// A private offer's coins are read from the private sync
// (midnightPrivateCoins.ts); until it has a complete state, only the clock speaks.
// TAKEN is stored once seen (the received coins can move on) and wins over
// any other status. CANCELLED and EXPIRED are only shown until the offer is
// past its TTL plus a grace period, then stored: right after a wallet switch
// or a sync the spent coin can be gone before the swap's outputs arrive
// (seen on preprod), and storing that moment would mark a taken offer
// cancelled for good.
//
// Pure: no ledger, no storage.

import type { MidnightUnshieldedUtxo } from './midnightTypes';

export type MidnightSwapStatus = 'open' | 'taken' | 'cancelled' | 'expired';

/** One side of an offer: a token and an amount. */
export interface MidnightSwapLeg {
  /** Raw 32-byte token type, lower-case hex (all zeros for NIGHT). */
  readonly tokenType: string;
  /** Base units, decimal string. */
  readonly amount: string;
  /** A private (shielded) leg; absent or false for a public one. NIGHT is always public. */
  readonly shielded?: boolean;
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
  /**
   * When it stops being takeable, epoch ms: the intent's TTL, or for an offer
   * with no public leg an estimate (`expiry: 'root-window'`).
   */
  readonly expiresAt: number;
  /** `root-window`: {@link expiresAt} is an estimate (a fully private offer has no TTL). Absent: the TTL. */
  readonly expiry?: 'ttl' | 'root-window';
  /** The public coins the offer spends, `intentHash#outputNo` (lower-case hash). */
  readonly inputs: string[];
  /**
   * The hash the maker intent's outputs (what the maker receives, and change)
   * are created under (midnightSwap9.ts); empty for an offer with no public leg.
   */
  readonly intentHash: string;
  /** Nullifiers of the private coins the offer spends (lower-case hex). */
  readonly nullifiers?: string[];
  /** Commitments of the private coins the maker receives once taken, change included (lower-case hex). */
  readonly commitments?: string[];
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
  /** The private coins held, from a complete private sync; absent until there is one. */
  readonly privateCoins?: {
    readonly nullifiers: ReadonlySet<string>;
    readonly commitments: ReadonlySet<string>;
  };
}

/** Whether `record` has a private leg (and so private coins to watch). */
export function hasPrivateLeg(record: Pick<MidnightSwapOfferRecord, 'gives' | 'wants'>): boolean {
  return [...record.gives, ...record.wants].some(leg => leg.shielded === true);
}

/** How long after its TTL a cancelled or expired offer is shown before that status is stored. */
export const MIDNIGHT_SWAP_SETTLE_GRACE_MS = 10 * 60_000;

/** The status of `record` against the wallet's coins at `now`. */
export function deriveSwapOfferStatus(record: MidnightSwapOfferRecord, view: MidnightSwapCoinView, now: number): MidnightSwapStatus {
  if (record.status === 'taken') return 'taken';
  const expired = now >= record.expiresAt;
  const publicKnown = view.lastSync !== null;
  const privateCoins = view.privateCoins;
  const intent = record.intentHash.toLowerCase();
  if (publicKnown && intent && view.utxos.some(utxo => utxo.intentHash.toLowerCase() === intent)) return 'taken';
  if (privateCoins && (record.commitments ?? []).some(commitment => privateCoins.commitments.has(commitment))) return 'taken';
  if (record.status !== 'open') return record.status;
  // Before a sync the coins say nothing: only the clock does.
  const needsPublic = record.inputs.length > 0 || !!intent;
  const needsPrivate = (record.nullifiers?.length ?? 0) > 0 || (record.commitments?.length ?? 0) > 0;
  if ((needsPublic && !publicKnown) || (needsPrivate && !privateCoins)) return expired ? 'expired' : 'open';
  const held = new Set(view.utxos.map(utxoRef));
  const publicHeld = record.inputs.every(ref => held.has(ref));
  const privateHeld = (record.nullifiers ?? []).every(nullifier => privateCoins?.nullifiers.has(nullifier));
  if (publicHeld && privateHeld) return expired ? 'expired' : 'open';
  return expired && !record.withdrawTxHash ? 'expired' : 'cancelled';
}

/**
 * Re-read every record's status against `view`. `records` carry the status to
 * show; `stored` is what to keep, written only when `changed`: TAKEN at once,
 * CANCELLED and EXPIRED once {@link MIDNIGHT_SWAP_SETTLE_GRACE_MS} past the TTL.
 * Drops settled records older than {@link MIDNIGHT_SWAP_RECORD_KEEP_MS} and
 * keeps at most {@link MIDNIGHT_SWAP_RECORD_MAX}, newest first.
 */
export function refreshSwapOfferRecords(
  records: readonly MidnightSwapOfferRecord[],
  view: MidnightSwapCoinView,
  now: number,
): { records: MidnightSwapOfferRecord[]; stored: MidnightSwapOfferRecord[]; changed: boolean } {
  let changed = false;
  const shown: MidnightSwapOfferRecord[] = [];
  const stored: MidnightSwapOfferRecord[] = [];
  for (const record of records) {
    const status = deriveSwapOfferStatus(record, view, now);
    const settles = status !== record.status
      && (status === 'taken' || (status !== 'open' && now >= record.expiresAt + MIDNIGHT_SWAP_SETTLE_GRACE_MS));
    const kept = settles ? { ...record, status, settledAt: now } : record;
    if (settles) changed = true;
    if (kept.status !== 'open' && (kept.settledAt ?? kept.expiresAt) + MIDNIGHT_SWAP_RECORD_KEEP_MS < now) {
      changed = true;
      continue;
    }
    stored.push(kept);
    shown.push(status === kept.status ? kept : { ...kept, status });
  }
  const newestFirst = (a: MidnightSwapOfferRecord, b: MidnightSwapOfferRecord) => b.createdAt - a.createdAt;
  stored.sort(newestFirst);
  shown.sort(newestFirst);
  if (stored.length > MIDNIGHT_SWAP_RECORD_MAX) {
    changed = true;
    stored.length = MIDNIGHT_SWAP_RECORD_MAX;
    shown.length = Math.min(shown.length, MIDNIGHT_SWAP_RECORD_MAX);
  }
  return { records: shown, stored, changed };
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

/**
 * The private coins set aside for open offers, by nullifier: a second offer
 * and a take never select them. A private Send can still spend one (the
 * wallet's private sends pick their own coins), which cancels that offer.
 */
export function reservedSwapNullifiers(records: readonly MidnightSwapOfferRecord[], now: number): Set<string> {
  const reserved = new Set<string>();
  for (const record of records) {
    if (record.status !== 'open' || now >= record.expiresAt) continue;
    for (const nullifier of record.nullifiers ?? []) reserved.add(nullifier.toLowerCase());
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
    && typeof (leg as MidnightSwapLeg).amount === 'string' && /^[0-9]{1,80}$/.test((leg as MidnightSwapLeg).amount)
    && ((leg as MidnightSwapLeg).shielded === undefined || typeof (leg as MidnightSwapLeg).shielded === 'boolean');
  const hexList = (value: unknown) => value === undefined
    || (Array.isArray(value) && value.every(item => typeof item === 'string' && /^[0-9a-f]{64}$/.test(item)));
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
      && typeof record.intentHash === 'string' && /^[0-9a-f]*$/.test(record.intentHash)
      && (record.expiry === undefined || record.expiry === 'ttl' || record.expiry === 'root-window')
      && hexList(record.nullifiers) && hexList(record.commitments)
      // An offer with nothing to watch could never be read as taken or cancelled.
      && (!!record.intentHash || !!record.nullifiers?.length)
      && statuses.includes(record.status);
  });
}
