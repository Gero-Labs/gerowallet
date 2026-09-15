/**
 * Last-known DUST balance per wallet, surviving wallet switches.
 *
 * WHY THIS EXISTS. Choosing a wallet to pay your fees means comparing their
 * DUST, but nothing in the app can read another wallet's DUST balance:
 *
 *  - `midnightStore` persists under a single `midnightStore` storage key and
 *    `setActive` resets its per-wallet chain state, so it only ever holds the
 *    ACTIVE wallet's `dustState`.
 *  - The dust-wallet SDK state cache is keyed by identity seed
 *    (`storageKey(network, kind, identitySeed)`), and the seed requires
 *    decrypting that wallet's mnemonic — i.e. an unlock.
 *
 * Without a snapshot the sponsor picker can only offer "not checked yet" for
 * every candidate, which asks the user to pick blind and then pay an unlock to
 * discover the answer.
 *
 * So: while a wallet is active and its DUST state is known, record it here
 * under its own storage key. The picker then shows a real figure with an
 * explicit "as of" — a stale number the user can reason about beats no number.
 *
 * This is a DISPLAY AID ONLY. It is never used to decide whether a send can
 * pay its fee: the authoritative check happens at send time against freshly
 * synced state. A snapshot going stale can mislead a picker; it can never
 * produce a bad transaction.
 */
import type { MidnightDustState } from './midnightTypes';

/** Storage key, deliberately separate from `midnightStore` so a wallet switch doesn't wipe it. */
export const DUST_SNAPSHOT_KEY = 'midnightDustSnapshots';

export interface DustSnapshot {
  readonly walletId: number;
  /** Wallet network, so a picker never offers a cross-network sponsor. */
  readonly network: string;
  /** DUST balance in base units, as a decimal string (chrome.storage can't carry bigint). */
  readonly current: string;
  /** Capacity in base units, for rendering a battery. */
  readonly cap: string;
  /** Epoch ms the snapshot was taken. */
  readonly at: number;
}

export type DustSnapshotMap = Record<string, DustSnapshot>;

/**
 * How old a snapshot may be before the UI should present it as unknown rather
 * than as a figure.
 *
 * DUST regenerates toward a cap over roughly a week and decays once its
 * backing NIGHT moves, so a month-old number carries no information. This is a
 * display threshold only — see the file header.
 */
export const SNAPSHOT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export function isSnapshotFresh(snap: DustSnapshot, now = Date.now()): boolean {
  return now - snap.at < SNAPSHOT_STALE_AFTER_MS;
}

/**
 * Build the snapshot for a wallet whose DUST state is currently known.
 * Returns null when the state is absent or malformed — recording a zero we
 * merely failed to read would later render as "no DUST" on a funded wallet.
 */
export function toSnapshot(
  walletId: number,
  network: string,
  dustState: MidnightDustState | null | undefined,
  now = Date.now(),
): DustSnapshot | null {
  if (!dustState) return null;
  if (typeof dustState.current !== 'bigint' || typeof dustState.cap !== 'bigint') return null;
  return {
    walletId,
    network,
    current: dustState.current.toString(),
    cap: dustState.cap.toString(),
    at: now,
  };
}

/** Merge one snapshot into the map, keyed by wallet id. */
export function withSnapshot(map: DustSnapshotMap, snap: DustSnapshot): DustSnapshotMap {
  return { ...map, [String(snap.walletId)]: snap };
}

/** Drop a wallet's snapshot — call when a wallet is deleted. */
export function withoutWallet(map: DustSnapshotMap, walletId: number): DustSnapshotMap {
  const next = { ...map };
  delete next[String(walletId)];
  return next;
}

/**
 * The snapshot for a wallet, or null when absent, stale, or on another
 * network. Callers render null as "not checked yet", never as zero.
 */
export function snapshotFor(
  map: DustSnapshotMap,
  walletId: number,
  network: string,
  now = Date.now(),
): DustSnapshot | null {
  const snap = map[String(walletId)];
  if (!snap) return null;
  if (snap.network !== network) return null;
  return isSnapshotFresh(snap, now) ? snap : null;
}

/** Parse the balance back to bigint. Returns null on anything unparseable. */
export function snapshotBalance(snap: DustSnapshot): bigint | null {
  try {
    return BigInt(snap.current);
  } catch {
    return null;
  }
}
