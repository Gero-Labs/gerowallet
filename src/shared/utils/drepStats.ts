/**
 * Behaviour statistics for a single DRep, computed from the record that
 * gero-backend's `/api/dreps` already returns (snake_case, verified against
 * mainnet 2026-08-23).
 *
 * Three rules shape every number in here:
 *
 * 1. **Absent is not zero.** A DRep with no eligible action has `pending`
 *    participation, not 0%. Rendering "0%" for "we have nothing to judge yet"
 *    is a false accusation, and this module refuses to make it — every ratio
 *    carries a `state` and a nullable `pct`.
 * 2. **Never guess a category.** Focus areas group votes by governance action
 *    TYPE, and the record does not carry the type — only a `proposal_id`. So
 *    they are computed only when the caller supplies a resolver, and are `null`
 *    otherwise. Inferring a type from an id would be an invented fact.
 * 3. **Lovelace is BigInt.** `amount` arrives as a decimal string and routinely
 *    exceeds 2^53. It goes through `toLovelace()`, and shares through `pctOf()`.
 *
 * Vote de-duplication: a DRep may vote more than once on the same proposal (a
 * changed vote — 4 of the 20 records on page 1 of mainnet do this). Only the
 * latest revision by `block_time` counts, in every statistic.
 *
 * Nothing here throws. A governance table must render even when one row is junk,
 * so malformed input yields `null` (record level) or is counted in
 * `skippedVotes` (vote level).
 */

import type { VoteChoice } from '@/api/governance.types';
import type {
  DelegatedDRepRecord,
  DRepVoteRecord as DelegationVoteRecord,
} from '@/shared/composables/useDelegationHealth';
import { parseDRepId } from '@/shared/utils/drepId';
import { pctOf, toLovelace, type LovelaceLike } from '@/shared/utils/lovelace';

/**
 * The vote row as `/api/dreps` returns it.
 *
 * `useDelegationHealth` owns the canonical shape — the subset a health check
 * needs. This EXTENDS it rather than redeclaring it, so the repo keeps exactly
 * one definition of a DRep vote while the directory and profile still get the
 * transaction-identity fields they need for explorer links.
 */
export interface DRepVoteRecord extends DelegationVoteRecord {
  proposal_tx_hash?: string | null;
  proposal_index?: number | null;
  vote_tx_hash?: string | null;
}

export interface DRepDelegatorRecord {
  stake_address?: string | null;
  stake_address_hex?: string | null;
  script_hash?: string | null;
  /** Lovelace as a decimal string. */
  amount?: string | null;
  epoch_no?: number | null;
}

export interface DRepMetadata {
  meta_url?: string | null;
  meta_hash?: string | null;
  /** CIP-119 document. `body` is null for the majority of registered DReps. */
  meta_json?: { body?: Record<string, unknown> | null } | null;
  is_valid?: boolean | null;
}

/**
 * A full `/api/dreps` row, extending the delegation-health record with the
 * fields the directory needs (identity, power, deposit, anchor). Every field is
 * optional because the endpoint nulls most of them — `deposit`,
 * `expires_epoch_no`, `url`, `hash` and `metadata.meta_json` are all null on a
 * majority of live rows.
 */
export interface DRepRecord extends DelegatedDRepRecord {
  hex?: string | null;
  has_script?: boolean | null;
  /** Lovelace as a decimal string. */
  deposit?: string | null;
  /** Voting power in lovelace, as a decimal string. */
  amount?: string | null;
  url?: string | null;
  hash?: string | null;
  votes?: DRepVoteRecord[] | null;
  metadata?: DRepMetadata | null;
  delegators?: DRepDelegatorRecord[] | null;
  display_name?: string | null;
}

/** Maps a `proposal_id` (bech32 gov action id) to its governance action type. */
export type ActionTypeResolver = (proposalId: string) => string | null | undefined;

export interface DRepStatsContext {
  /**
   * How many governance actions this DRep could have voted on. The caller owns
   * this window (the directory footer calls it "the last 24 governance
   * actions"); the DRep record cannot know it.
   */
  totalEligibleActions?: number | null;
  /**
   * The exact eligible `proposal_id`s. Strictly better than the count above: it
   * lets participation ignore votes outside the window and unlocks the
   * per-type `eligible` denominator on focus areas.
   */
  eligibleActionIds?: readonly string[] | null;
  typeResolver?: ActionTypeResolver | null;
  /** Total active DRep voting power, for `shareOfActivePower`. */
  activeDRepPower?: LovelaceLike;
  /** Voting power of the Nth DRep. At or above it is `topN`. */
  topNCutoffPower?: LovelaceLike;
}

export type RatioState = 'ok' | 'pending';

export interface RatioStat {
  numerator: number;
  denominator: number;
  /** null when the denominator is 0 — "nothing to judge yet", never "0%". */
  pct: number | null;
  state: RatioState;
}

export interface VotePattern {
  yes: number;
  no: number;
  abstain: number;
  total: number;
  yesPct: number | null;
  noPct: number | null;
  abstainPct: number | null;
}

export interface FocusArea {
  /** Governance action type as the resolver spells it, e.g. `TreasuryWithdrawals`. */
  type: string;
  voted: number;
  /** null when the eligible set for this type is unknown. */
  eligible: number | null;
}

export type PowerRankBucket = 'topN' | 'outsideTopN';

export interface DRepStats {
  drepId: string | null;
  /** 56-char credential hex — the only safe cross-form match key (see drepId.ts). */
  credentialHex: string | null;
  participation: RatioStat;
  rationaleRate: RatioStat;
  votePattern: VotePattern;
  /** null when no type resolver was supplied. Never inferred. */
  focusAreas: FocusArea[] | null;
  /** null when the endpoint omitted `delegators` — distinct from a real 0. */
  delegatorCount: number | null;
  votingPower: bigint;
  /** null when the denominator is unknown or zero. */
  shareOfActivePower: number | null;
  /** null when no cutoff was supplied. */
  powerRankBucket: PowerRankBucket | null;
  lastVoteBlockTime: number | null;
  active: boolean;
  registered: boolean;
  /** Vote rows dropped as unusable. Surfaced so a broken feed is visible, not silent. */
  skippedVotes: number;
}

const CHOICES: Record<string, VoteChoice> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstain',
};

function isPlainObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normaliseChoice(value: unknown): VoteChoice | null {
  if (typeof value !== 'string') return null;
  return CHOICES[value.trim().toLowerCase()] ?? null;
}

function ratio(numerator: number, denominator: number): RatioStat {
  if (denominator <= 0) {
    return { numerator, denominator: Math.max(0, denominator), pct: null, state: 'pending' };
  }
  const capped = Math.min(numerator, denominator);
  return {
    numerator: capped,
    denominator,
    pct: Math.round((capped * 10000) / denominator) / 100,
    state: 'ok',
  };
}

function share(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part * 10000) / total) / 100;
}

/**
 * Latest revision per proposal, newest `block_time` wins. Rows without a usable
 * `proposal_id` or an unrecognised choice are dropped and counted.
 */
function dedupeVotes(raw: unknown): { votes: DRepVoteRecord[]; skipped: number } {
  if (!Array.isArray(raw)) return { votes: [], skipped: 0 };

  const latest = new Map<string, DRepVoteRecord>();
  let skipped = 0;

  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      skipped += 1;
      continue;
    }
    const candidate = entry as DRepVoteRecord;
    const proposalId = typeof candidate.proposal_id === 'string' ? candidate.proposal_id.trim() : '';
    if (!proposalId || normaliseChoice(candidate.vote) === null) {
      skipped += 1;
      continue;
    }
    const existing = latest.get(proposalId);
    if (!existing || (candidate.block_time ?? 0) >= (existing.block_time ?? 0)) {
      latest.set(proposalId, candidate);
    }
  }

  return { votes: [...latest.values()], skipped };
}

function focusAreasFor(
  votes: DRepVoteRecord[],
  context: DRepStatsContext,
): FocusArea[] | null {
  const resolver = context.typeResolver;
  if (typeof resolver !== 'function') return null;

  const votedByType = new Map<string, number>();
  for (const v of votes) {
    const type = resolver(String(v.proposal_id));
    if (!type) continue;
    votedByType.set(type, (votedByType.get(type) ?? 0) + 1);
  }

  const eligibleIds = Array.isArray(context.eligibleActionIds) ? context.eligibleActionIds : null;
  const eligibleByType = new Map<string, number>();
  if (eligibleIds) {
    for (const id of eligibleIds) {
      const type = resolver(String(id));
      if (!type) continue;
      eligibleByType.set(type, (eligibleByType.get(type) ?? 0) + 1);
    }
  }

  const types = new Set<string>([...votedByType.keys(), ...eligibleByType.keys()]);
  return [...types]
    .map(type => ({
      type,
      voted: votedByType.get(type) ?? 0,
      eligible: eligibleIds ? eligibleByType.get(type) ?? 0 : null,
    }))
    // Ordering is within ONE DRep's own activity, so it ranks nothing across DReps.
    .sort((a, b) => b.voted - a.voted || a.type.localeCompare(b.type));
}

/**
 * Compute the stats for one DRep record. Returns null when the input cannot be
 * identified as a DRep at all — callers treat that as "skip this row".
 */
export function drepStats(record: unknown, context: DRepStatsContext = {}): DRepStats | null {
  if (!isPlainObject(record)) return null;
  const row = record as DRepRecord;

  const drepId = typeof row.drep_id === 'string' && row.drep_id.trim() ? row.drep_id.trim() : null;
  const hex = typeof row.hex === 'string' && row.hex.trim() ? row.hex.trim().toLowerCase() : null;
  if (!drepId && !hex) return null;

  const credentialHex =
    parseDRepId(drepId)?.credentialHex ?? (hex && /^[0-9a-f]{56}$/.test(hex) ? hex : null);

  const { votes, skipped } = dedupeVotes(row.votes);

  const eligibleIds = Array.isArray(context.eligibleActionIds) ? context.eligibleActionIds : null;
  const eligibleSet = eligibleIds ? new Set(eligibleIds.map(String)) : null;
  const eligibleCount = eligibleIds
    ? eligibleSet!.size
    : Math.max(0, Math.trunc(Number(context.totalEligibleActions ?? 0)) || 0);
  const votedEligible = eligibleSet
    ? votes.filter(v => eligibleSet.has(String(v.proposal_id))).length
    : votes.length;

  const withRationale = votes.filter(
    v => typeof v.meta_url === 'string' && v.meta_url.trim().length > 0,
  ).length;

  const tally = { Yes: 0, No: 0, Abstain: 0 };
  let lastVoteBlockTime: number | null = null;
  for (const v of votes) {
    const choice = normaliseChoice(v.vote);
    if (choice) tally[choice] += 1;
    if (typeof v.block_time === 'number' && Number.isFinite(v.block_time)) {
      lastVoteBlockTime = lastVoteBlockTime === null ? v.block_time : Math.max(lastVoteBlockTime, v.block_time);
    }
  }

  const votingPower = toLovelace(row.amount);
  const activePower = toLovelace(context.activeDRepPower);
  const hasCutoff = context.topNCutoffPower !== undefined && context.topNCutoffPower !== null;

  return {
    drepId,
    credentialHex,
    participation: ratio(votedEligible, eligibleCount),
    rationaleRate: ratio(withRationale, votes.length),
    votePattern: {
      yes: tally.Yes,
      no: tally.No,
      abstain: tally.Abstain,
      total: votes.length,
      yesPct: share(tally.Yes, votes.length),
      noPct: share(tally.No, votes.length),
      abstainPct: share(tally.Abstain, votes.length),
    },
    focusAreas: focusAreasFor(votes, context),
    delegatorCount: Array.isArray(row.delegators) ? row.delegators.length : null,
    votingPower,
    shareOfActivePower: activePower > 0n ? pctOf(votingPower, activePower) : null,
    powerRankBucket: hasCutoff
      ? votingPower >= toLovelace(context.topNCutoffPower)
        ? 'topN'
        : 'outsideTopN'
      : null,
    lastVoteBlockTime,
    active: row.active === true,
    registered: row.registered === true,
    skippedVotes: skipped,
  };
}
