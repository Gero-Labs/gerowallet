import { toLovelace, pctOf } from '@/shared/utils/lovelace';
import type { Committee, GovVotingSummary } from '@/api/governance.types';

/**
 * Tally composition for a governance action.
 *
 * The single rule that matters: a yes-share is denominated over ELIGIBLE power,
 * which is yes + no. Abstaining stake is removed from the denominator by the
 * ledger — it is not counted against the proposal. Dividing by total stake
 * produces percentages that disagree with gov.tools.
 *
 * What "no" holds: everything that counts AGAINST ratification, which is more
 * than the ballots marked No. Koios's `*_no_vote_power` includes stake that has
 * not voted at all (live mainnet, Sep 2026: DRep active-No 1.07e15 lovelace
 * inside a "no" of 5.02e15; SPO active-No 0 inside 9.25e15 on a hard fork),
 * because CIP-1694 counts it against. The maths is right for the threshold; the
 * UI must label that side "no or not voted", never plain "No".
 *
 * `available: false` means "we do not have this number", which is different
 * from 0%. Callers must render the two differently or they imply a tally that
 * does not exist.
 */

export interface Composition {
  yesPct: number | null;
  /** No votes AND not-voted power: everything counted against. */
  noPct: number | null;
  /**
   * The yes share UNROUNDED (0..100), for comparing against a ratification
   * threshold. `yesPct` is rounded to two decimals for display, and 66.996%
   * must not read as clearing a 67% threshold. When only the server's rounded
   * pct is known, this is that pct.
   */
  yesShare?: number | null;
  /** False when there is no data, or when nobody has voted yet. */
  available: boolean;
}

const UNAVAILABLE: Composition = { yesPct: null, noPct: null, yesShare: null, available: false };

/** `num / den` as a percentage to ten decimals, in BigInt so huge stake stays exact. */
function sharePct(num: bigint, den: bigint): number {
  return Number((num * 1_000_000_000_000n) / den) / 10_000_000_000;
}

/**
 * Shares of eligible power. `abstain` is accepted for symmetry and is
 * deliberately NOT part of the denominator.
 */
export function composition(
  yes: string | null | undefined,
  no: string | null | undefined,
  _abstain?: string | null,
): Composition {
  if ((yes === null || yes === undefined) && (no === null || no === undefined)) return UNAVAILABLE;

  const yesPower = toLovelace(yes);
  const noPower = toLovelace(no);
  const eligible = yesPower + noPower;
  if (eligible === 0n) return UNAVAILABLE;

  return {
    yesPct: pctOf(yesPower, eligible),
    noPct: pctOf(noPower, eligible),
    yesShare: sharePct(yesPower, eligible),
    available: true,
  };
}

/**
 * DRep composition. Prefers computing from the raw power fields — those are
 * lossless decimal strings — and falls back to the server-supplied percentages
 * only when the powers are absent.
 */
export function drepTallies(summary: GovVotingSummary | null | undefined): Composition {
  if (!summary) return UNAVAILABLE;

  const computed = composition(summary.yesVotePower, summary.noVotePower, summary.abstainVotePower);
  if (computed.available) return computed;

  if (typeof summary.yesPct === 'number' || typeof summary.noPct === 'number') {
    const yesPct = typeof summary.yesPct === 'number' ? summary.yesPct : null;
    return {
      yesPct,
      noPct: typeof summary.noPct === 'number' ? summary.noPct : null,
      yesShare: yesPct,
      available: true,
    };
  }
  return UNAVAILABLE;
}

/** SPO composition, same rules against the spo* fields. */
export function spoTallies(summary: GovVotingSummary | null | undefined): Composition {
  if (!summary) return UNAVAILABLE;

  const computed = composition(summary.spoYesVotePower, summary.spoNoVotePower, summary.spoAbstainVotePower);
  if (computed.available) return computed;

  if (typeof summary.spoYesPct === 'number' || typeof summary.spoNoPct === 'number') {
    const yesPct = typeof summary.spoYesPct === 'number' ? summary.spoYesPct : null;
    return {
      yesPct,
      noPct: typeof summary.spoNoPct === 'number' ? summary.spoNoPct : null,
      yesShare: yesPct,
      available: true,
    };
  }
  return UNAVAILABLE;
}

/**
 * Committee seats that can vote in `epoch`: seated, not yet expired, and —
 * when the projection lists hot keys — holding one. The ledger counts an
 * expired member, or one with no hot key, as ABSTAINING, so neither belongs in
 * the denominator. Null when the committee or the epoch is unknown.
 *
 * Only meaningful for an action that is still open: the committee in hand is
 * the CURRENT one, which may not be the one that voted on a closed action.
 */
export function activeCommitteeSize(
  committee: Committee | null | undefined,
  epoch: number | null | undefined,
): number | null {
  if (!committee || !Array.isArray(committee.members) || typeof epoch !== 'number') return null;
  return committee.members.filter(member => {
    if (typeof member.startEpoch === 'number' && member.startEpoch > epoch) return false;
    if (typeof member.expiredEpoch === 'number' && member.expiredEpoch < epoch) return false;
    return !(Array.isArray(member.hotHashes) && member.hotHashes.length === 0);
  }).length;
}

/**
 * Committee shares by MEMBER COUNT, as the ledger ratifies them: yes over
 * (active seats − abstentions). A seated member who has not voted counts
 * against, so `noPct` is "no or not voted", the same convention as the DRep
 * and SPO bars.
 *
 * Computed here from the counts rather than taken from `ccYesPct`, because the
 * server's pct has been wrong while the counts beside it were right: on
 * 2026-09-24 Gero's Koios answered 14.29% (2 of 14) for two yes votes on a
 * seven-seat committee, where api.koios.rest answered 28.57% (2 of 7). The
 * server pct is the fallback only when the active seat count is unknown, or
 * when the counts cannot fit it (votes from seats that have since expired).
 */
export function ccTallies(
  summary: GovVotingSummary | null | undefined,
  activeMembers: number | null,
): Composition {
  if (!summary) return UNAVAILABLE;
  const yes = summary.ccYesVotes;
  const no = summary.ccNoVotes ?? 0;
  const abstain = summary.ccAbstainVotes ?? 0;
  if (typeof yes === 'number' && typeof activeMembers === 'number') {
    const eligible = activeMembers - abstain;
    if (eligible > 0 && yes + no <= eligible) {
      return {
        yesPct: pctOf(yes, eligible),
        noPct: pctOf(eligible - yes, eligible),
        // Plain division on purpose: the quorum is computed the same way
        // (ccProgress), so an exact tie (4 of 6 against 2/3) compares equal.
        yesShare: (yes / eligible) * 100,
        available: true,
      };
    }
  }
  if (typeof summary.ccYesPct === 'number' || typeof summary.ccNoPct === 'number') {
    const yesPct = typeof summary.ccYesPct === 'number' ? summary.ccYesPct : null;
    return {
      yesPct,
      noPct: typeof summary.ccNoPct === 'number' ? summary.ccNoPct : null,
      yesShare: yesPct,
      available: true,
    };
  }
  return UNAVAILABLE;
}

/**
 * Committee progress is a MEMBER COUNT against a quorum, not a stake share —
 * so it is deliberately not a Composition. Returns null when the counts are
 * absent. The quorum comes from the committee (`thresholdNumerator` /
 * `thresholdDenominator`); the summary's own `ccThreshold` is always null
 * upstream. `notVoted` needs the active seat count and is null without it.
 */
export function ccProgress(
  summary: GovVotingSummary | null | undefined,
  quorumNumerator: number | null | undefined,
  quorumDenominator: number | null | undefined,
  activeMembers: number | null = null,
): { yes: number; no: number; abstain: number; notVoted: number | null; requiredPct: number | null } | null {
  if (!summary) return null;
  const yes = summary.ccYesVotes;
  if (yes === null || yes === undefined) return null;
  const no = summary.ccNoVotes ?? 0;
  const abstain = summary.ccAbstainVotes ?? 0;

  const requiredPct =
    quorumNumerator && quorumDenominator ? (quorumNumerator / quorumDenominator) * 100 : null;
  const notVoted = typeof activeMembers === 'number' ? activeMembers - yes - no - abstain : null;

  return { yes, no, abstain, notVoted: notVoted !== null && notVoted >= 0 ? notVoted : null, requiredPct };
}
