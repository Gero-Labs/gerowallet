/**
 * Pure CIP-1694 threshold evaluation.
 *
 * Maps a governance action type to the bodies that vote on it and the fraction
 * each must clear, then checks the observed yes-shares against them.
 *
 * Two conventions, and getting either wrong makes every number wrong:
 *  - Protocol thresholds arrive as FRACTIONS (0..1); tallies arrive as
 *    PERCENTAGES (0..100). This module converts once, at the boundary.
 *  - A missing protocol parameter yields `thresholdPct: null` and `met: false`.
 *    We never guess a threshold, and "unknown" is never "cleared".
 *
 * InfoAction is advisory: it carries no on-chain threshold and can never
 * ratify. Rendering it as pass/fail is a correctness bug, so votingBodies()
 * returns an empty list for it.
 */

export type VotingBody = 'DRep' | 'SPO' | 'CC';

/** The four DRep parameter groups a ParameterChange can touch. */
export type ParamGroup = 'network' | 'economic' | 'technical' | 'gov';

export interface ParamChangeScope {
  /** Which DRep groups the change touches. */
  groups: ParamGroup[];
  /** Whether any changed parameter is security-relevant, which adds the SPO vote. */
  touchesSecurity: boolean;
}

/** Protocol thresholds, as FRACTIONS 0..1. Undefined means "not synced". */
export interface GovThresholdParams {
  dvtMotionNoConfidence?: number;
  dvtCommitteeNormal?: number;
  dvtCommitteeNoConfidence?: number;
  dvtUpdateConstitution?: number;
  dvtHardFork?: number;
  dvtPpNetwork?: number;
  dvtPpEconomic?: number;
  dvtPpTechnical?: number;
  dvtPpGov?: number;
  dvtTreasuryWithdrawal?: number;
  pvtMotionNoConfidence?: number;
  pvtCommitteeNormal?: number;
  pvtCommitteeNoConfidence?: number;
  pvtHardFork?: number;
  pvtSecurityGroup?: number;
  committeeMinSize?: number;
}

export interface BodyThreshold {
  body: VotingBody;
  /** 0..100, or null when the protocol parameter is not available. */
  thresholdPct: number | null;
}

export interface BodyResult extends BodyThreshold {
  /** 0..100, or null when the tally is not available. */
  yesPct: number | null;
  met: boolean;
}

export interface ObservedTallies {
  drepYesPct: number | null;
  spoYesPct: number | null;
  ccYesPct: number | null;
}

/** Fraction (0..1) → percentage (0..100), preserving "unknown". */
function pct(fraction: number | undefined): number | null {
  return typeof fraction === 'number' ? fraction * 100 : null;
}

/** The strictest (highest) of a set of thresholds; null when none are known. */
function strictest(values: (number | null)[]): number | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? Math.max(...known) : null;
}

/**
 * Only InfoAction is advisory. Every other action type carries an on-chain
 * ratification threshold.
 */
export function hasOnchainThreshold(type: string): boolean {
  return type !== 'InfoAction';
}

/**
 * ParameterChange: DReps vote at the strictest threshold of the groups the
 * change actually touches; SPOs vote only when a security-relevant parameter
 * changes. With no payload we cannot prove either, so DReps fall back to the
 * strictest of all four groups and the SPO row is OMITTED rather than invented.
 * The committee always votes.
 */
function parameterChangeBodies(params: GovThresholdParams, scope: ParamChangeScope | null | undefined): BodyThreshold[] {
  const byGroup: Record<ParamGroup, number | null> = {
    network: pct(params.dvtPpNetwork),
    economic: pct(params.dvtPpEconomic),
    technical: pct(params.dvtPpTechnical),
    gov: pct(params.dvtPpGov),
  };

  const drepPct = scope?.groups?.length
    ? strictest(scope.groups.map(g => byGroup[g]))
    : strictest([byGroup.network, byGroup.economic, byGroup.technical, byGroup.gov]);

  const bodies: BodyThreshold[] = [{ body: 'DRep', thresholdPct: drepPct }];
  if (scope?.touchesSecurity) bodies.push({ body: 'SPO', thresholdPct: pct(params.pvtSecurityGroup) });
  bodies.push({ body: 'CC', thresholdPct: null });
  return bodies;
}

/**
 * Which bodies vote on this action type, and at what threshold.
 *
 * The committee's threshold is a MEMBER-COUNT quorum, not a stake fraction, so
 * its `thresholdPct` is always null — callers render committee progress from
 * `CommitteeDto.thresholdNumerator/Denominator` instead.
 */
export function votingBodies(
  type: string,
  params: GovThresholdParams,
  paramScope?: ParamChangeScope | null,
): BodyThreshold[] {
  switch (type) {
    case 'InfoAction':
      return [];
    case 'NoConfidence':
      return [
        { body: 'DRep', thresholdPct: pct(params.dvtMotionNoConfidence) },
        { body: 'SPO', thresholdPct: pct(params.pvtMotionNoConfidence) },
      ];
    case 'NewCommittee':
      return [
        { body: 'DRep', thresholdPct: pct(params.dvtCommitteeNormal) },
        { body: 'SPO', thresholdPct: pct(params.pvtCommitteeNormal) },
      ];
    case 'NewConstitution':
      return [
        { body: 'DRep', thresholdPct: pct(params.dvtUpdateConstitution) },
        { body: 'CC', thresholdPct: null },
      ];
    case 'TreasuryWithdrawals':
      return [
        { body: 'DRep', thresholdPct: pct(params.dvtTreasuryWithdrawal) },
        { body: 'CC', thresholdPct: null },
      ];
    case 'HardForkInitiation':
      return [
        { body: 'DRep', thresholdPct: pct(params.dvtHardFork) },
        { body: 'SPO', thresholdPct: pct(params.pvtHardFork) },
        { body: 'CC', thresholdPct: null },
      ];
    case 'ParameterChange':
      return parameterChangeBodies(params, paramScope);
    default:
      return [];
  }
}

/** Pair each voting body with its observed yes-share and whether it has cleared. */
export function evaluateThresholds(
  type: string,
  params: GovThresholdParams,
  observed: ObservedTallies,
  paramScope?: ParamChangeScope | null,
): BodyResult[] {
  const observedFor: Record<VotingBody, number | null> = {
    DRep: observed.drepYesPct,
    SPO: observed.spoYesPct,
    CC: observed.ccYesPct,
  };

  return votingBodies(type, params, paramScope).map(b => {
    const yesPct = observedFor[b.body];
    // Unknown threshold or unknown tally can never be "met" — we do not imply
    // progress we cannot prove.
    const met = b.thresholdPct !== null && yesPct !== null && yesPct >= b.thresholdPct;
    return { ...b, yesPct, met };
  });
}
