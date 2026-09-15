/**
 * Which of the user's wallets can actually pay a Midnight fee for another one.
 *
 * WHY THIS IS NOT "READ THE DUST BALANCE". Three things learned the hard way
 * while proving sponsorship works on mainnet, each of which produced a wrong
 * answer at least once:
 *
 *  1. The dashboard's DUST battery is `useMidnightDustLive`, whose polled
 *     values live in MODULE-SCOPED refs and are deliberately retained across a
 *     failed poll. They therefore survive a wallet switch, and a wallet with no
 *     DUST at all can display a full battery inherited from the previously
 *     viewed wallet. A picker built on that signal offers unusable sponsors.
 *  2. `dust/account-state` answers for Path A only (native NIGHT registered on
 *     Midnight) and returns a ZERO-FILLED object — not an error — for an
 *     address it does not recognise. A `0` from it is "unknown", never "empty".
 *  3. DUST mostly arrives by Path B: cNIGHT held on Cardano, paired to ONE
 *     specific Midnight dust address through the mapping validator. That
 *     `dustAddress` is the only thing that says who can spend the DUST, and it
 *     is frequently NOT the wallet whose dashboard displays it.
 *
 * So eligibility is resolved structurally: take the live registration rows,
 * read each row's dust destination, and match it against the dust address a
 * wallet actually stores. A wallet is a sponsor because a registration pays
 * into its dust address — not because a number looked big somewhere.
 *
 * This module is pure: no Dexie, no API client, no composables. The caller
 * fetches the rows and passes stored wallet records in.
 */

/** A wallet, reduced to what eligibility needs. `dustAddress` comes from the stored `publicKey` blob. */
export interface SponsorWalletRef {
  readonly id: number;
  readonly name: string;
  readonly network: string;
  /** Bech32m `mn_dust…` address, or '' when the record predates address storage. */
  readonly dustAddress: string;
}

/** One row of Nexus's `dust/status` batch, narrowed to the fields that decide eligibility. */
export interface DustStatusRow {
  readonly cardanoRewardAddress: string;
  readonly dustAddress: string | null;
  readonly registered: boolean;
  readonly currentCapacity?: string;
  readonly maxCapacity?: string;
  readonly registrationUtxoTxHash?: string | null;
}

/**
 * - `ready`     — a live registration pays into this wallet and it has capacity now.
 * - `relaying`  — a registration UTxO exists on Cardano but the Midnight indexer
 *                 has not relayed it yet (~2.5h). It will become spendable; it
 *                 is NOT the same as "no DUST", and must not be rendered as zero.
 * - `unknown`   — no row mentions this wallet. Absence of evidence only: the
 *                 registration may live on a Cardano wallet outside this
 *                 profile, so never present this as "has no DUST".
 */
export type SponsorState = 'ready' | 'relaying' | 'unknown';

export interface SponsorCandidate {
  readonly walletId: number;
  readonly name: string;
  readonly dustAddress: string;
  readonly state: SponsorState;
  /** Spendable capacity in base units, or null when not known. Never 0-as-unknown. */
  readonly capacity: bigint | null;
  /**
   * Full capacity in base units, or null when not known. Needed to draw the
   * sponsor's battery as a proportion — the design shows "0.4821 tDUST · 72%",
   * and a percentage cannot be invented from the balance alone.
   */
  readonly cap: bigint | null;
  /** Cardano stake addresses whose cNIGHT feeds this wallet. */
  readonly fundedBy: readonly string[];
}

function norm(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Parse a capacity string, returning null (not 0n) for anything unparseable. */
function toCapacity(value: string | undefined): bigint | null {
  if (value == null || value === '') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

/**
 * Resolve one wallet's sponsor state from the registration rows pointing at it.
 *
 * Exported for the single-wallet case (e.g. rendering "this wallet sponsors
 * another" on the sponsor's own dashboard).
 */
export function sponsorStateFor(
  wallet: SponsorWalletRef,
  rows: readonly DustStatusRow[],
): SponsorCandidate {
  const dust = norm(wallet.dustAddress);
  const mine = dust ? rows.filter((r) => norm(r.dustAddress) === dust) : [];

  if (mine.length === 0) {
    return {
      walletId: wallet.id,
      name: wallet.name,
      dustAddress: wallet.dustAddress,
      state: 'unknown',
      capacity: null,
      cap: null,
      fundedBy: [],
    };
  }

  const fundedBy = mine.map((r) => r.cardanoRewardAddress).filter(Boolean);
  const live = mine.filter((r) => r.registered);

  if (live.length > 0) {
    // Sum across registrations: several Cardano stakes may pay one dust address.
    // If every row's capacity is unparseable the total stays null rather than
    // collapsing to a confident zero.
    let total: bigint | null = null;
    let capTotal: bigint | null = null;
    for (const row of live) {
      const c = toCapacity(row.currentCapacity);
      if (c != null) total = (total ?? 0n) + c;
      const m = toCapacity(row.maxCapacity);
      if (m != null) capTotal = (capTotal ?? 0n) + m;
    }
    return {
      walletId: wallet.id,
      name: wallet.name,
      dustAddress: wallet.dustAddress,
      // Capacity known and zero means genuinely drained, not merely unknown —
      // but a drained registration is still relaying value in, so it is not
      // "ready" to pay a fee right now.
      state: total != null && total === 0n ? 'relaying' : 'ready',
      capacity: total,
      cap: capTotal,
      fundedBy,
    };
  }

  // Not relayed yet. A registration UTxO on Cardano is the evidence that this
  // WILL become spendable; without one we only know a row mentioned us.
  const pending = mine.some((r) => !!r.registrationUtxoTxHash);
  return {
    walletId: wallet.id,
    name: wallet.name,
    dustAddress: wallet.dustAddress,
    state: pending ? 'relaying' : 'unknown',
    capacity: null,
    cap: null,
    fundedBy,
  };
}

/**
 * Sponsor candidates for a send, best first.
 *
 * Excludes the sending wallet (sponsoring yourself is a pointless extra unlock)
 * and anything on another network — DUST is per-network and a mainnet fee
 * cannot pay for a preprod transaction.
 *
 * `unknown` candidates are RETAINED, deliberately. The registration may live on
 * a Cardano wallet this profile cannot enumerate, so hiding them would hide the
 * only working sponsor — which is exactly what happened during the mainnet
 * investigation. The UI shows them as "not checked", never as "no DUST".
 */
export function sponsorCandidates(
  wallets: readonly SponsorWalletRef[],
  rows: readonly DustStatusRow[],
  senderWalletId: number,
  network: string,
): SponsorCandidate[] {
  const order: Record<SponsorState, number> = { ready: 0, relaying: 1, unknown: 2 };
  return wallets
    .filter((w) => w.id !== senderWalletId && w.network === network)
    .map((w) => sponsorStateFor(w, rows))
    .sort((a, b) => {
      if (order[a.state] !== order[b.state]) return order[a.state] - order[b.state];
      // Larger known capacity first; unknown capacity sorts after known.
      const ac = a.capacity ?? -1n;
      const bc = b.capacity ?? -1n;
      if (ac !== bc) return bc > ac ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
}

/** True when at least one candidate can pay a fee right now. */
export function hasReadySponsor(candidates: readonly SponsorCandidate[]): boolean {
  return candidates.some((c) => c.state === 'ready');
}

/**
 * Charge as a whole-number percentage, or null when it cannot be known.
 *
 * Returns null rather than 0 for an unknown capacity or cap: the design draws
 * "not checked yet" as a hatched track with an em dash, and a confident 0%
 * would claim the sponsor is empty when it has simply not been read.
 */
export function chargePercent(candidate: SponsorCandidate): number | null {
  const { capacity, cap } = candidate;
  if (capacity == null || cap == null || cap <= 0n) return null;
  const pct = Number((capacity * 100n) / cap);
  return Math.max(0, Math.min(100, pct));
}
