import { toLovelace, pctOf } from '@/shared/utils/lovelace';
import type { GovVotingSummary } from '@/api/governance.types';

/**
 * Tally composition for a governance action.
 *
 * The single rule that matters: a yes-share is denominated over ELIGIBLE power,
 * which is yes + no. Abstaining stake is removed from the denominator by the
 * ledger — it is not counted against the proposal. Dividing by total stake
 * produces percentages that disagree with gov.tools.
 *
 * `available: false` means "we do not have this number", which is different
 * from 0%. Callers must render the two differently or they imply a tally that
 * does not exist.
 */

export interface Composition {
  yesPct: number | null;
  noPct: number | null;
  /** False when there is no data, or when nobody has voted yet. */
  available: boolean;
}

const UNAVAILABLE: Composition = { yesPct: null, noPct: null, available: false };

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
    return {
      yesPct: typeof summary.yesPct === 'number' ? summary.yesPct : null,
      noPct: typeof summary.noPct === 'number' ? summary.noPct : null,
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
    return {
      yesPct: typeof summary.spoYesPct === 'number' ? summary.spoYesPct : null,
      noPct: typeof summary.spoNoPct === 'number' ? summary.spoNoPct : null,
      available: true,
    };
  }
  return UNAVAILABLE;
}

/**
 * Committee progress is a MEMBER COUNT against a quorum, not a stake share —
 * so it is deliberately not a Composition. Returns null when the counts are
 * absent (`ccThreshold` is one of the fields Nexus leaves null upstream).
 */
export function ccProgress(
  summary: GovVotingSummary | null | undefined,
  quorumNumerator: number | null,
  quorumDenominator: number | null,
): { yes: number; no: number; abstain: number; requiredPct: number | null } | null {
  if (!summary) return null;
  const yes = summary.ccYesVotes;
  const no = summary.ccNoVotes;
  const abstain = summary.ccAbstainVotes;
  if (yes === null || yes === undefined) return null;

  const requiredPct =
    quorumNumerator && quorumDenominator ? (quorumNumerator / quorumDenominator) * 100 : null;

  return { yes, no: no ?? 0, abstain: abstain ?? 0, requiredPct };
}
