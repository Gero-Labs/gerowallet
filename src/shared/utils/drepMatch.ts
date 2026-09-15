/**
 * The DRep matcher.
 *
 * Every criterion is a plain boolean test against `drepStats`. There is no
 * composite score, no weighting, and no ranking — deliberately. A wallet that
 * ordered DReps by "fit" would be making an editorial choice on the user's
 * behalf, and any ordering correlated with voting power would quietly turn the
 * feature into an advertisement for the largest holders. So:
 *
 *   - every DRep clearing all active criteria lands in one flat pool;
 *   - the pool is ordered by a seeded shuffle, giving equal matches equal
 *     exposure;
 *   - the shuffle is seeded by the CALLER (stake key + epoch), so the order is
 *     stable for one user within an epoch, differs between users, and reshuffles
 *     when the epoch rolls over;
 *   - the pool is canonicalised by DRep identity BEFORE shuffling, so the output
 *     order cannot depend on the order the directory happened to fetch rows in.
 *     `drepMatch.spec.ts` asserts exactly that against a power-sorted input.
 *
 * A criterion the data cannot answer (a focus area with no type resolver, a
 * `outsideTopN` with no cutoff) FAILS. Passing on missing evidence would let the
 * UI claim a match it cannot support.
 */

import { drepStats, type DRepRecord, type DRepStats, type DRepStatsContext } from '@/shared/utils/drepStats';

export interface DRepMatchCriteria {
  /** Minimum participation, in percent. */
  participationMin?: number | null;
  /** Minimum share of votes carrying a rationale anchor, in percent. */
  rationaleMin?: number | null;
  /** Governance action type the DRep must have voted on at least once. */
  focusArea?: string | null;
  /** Restrict to DReps below the caller's top-N power cutoff. */
  outsideTopN?: boolean | null;
  /** Drop DReps the chain marks inactive. */
  excludeInactive?: boolean | null;
}

export type DRepCriterionName = keyof DRepMatchCriteria;

export interface DRepMatchEntry {
  record: DRepRecord;
  stats: DRepStats;
  /** Empty for a full match; otherwise every criterion this DRep failed. */
  failing: DRepCriterionName[];
}

export interface DRepMatchResult {
  /** Full matches, seeded-shuffled. */
  matches: DRepMatchEntry[];
  /** Everything that failed at least one criterion, fewest failures first. */
  nearMisses: DRepMatchEntry[];
  /** Size of the full-match pool — the "N DReps match all your priorities" figure. */
  poolSize: number;
  /** Which criteria were actually applied, in evaluation order. */
  activeCriteria: DRepCriterionName[];
  /** Records that could not be read as a DRep at all. */
  skipped: number;
}

export interface DRepMatchOptions extends DRepStatsContext {
  /** Stable per-user, per-epoch shuffle seed, e.g. `${stakeKey}:${epoch}`. */
  seed?: string | null;
}

/** Evaluation order — also the order failures are reported in. */
const CRITERIA_ORDER: DRepCriterionName[] = [
  'participationMin',
  'rationaleMin',
  'focusArea',
  'outsideTopN',
  'excludeInactive',
];

/** FNV-1a, 32-bit. Any string seed becomes a well-distributed PRNG state. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Never hand mulberry32 a zero state.
  return (hash >>> 0) || 0x9e3779b9;
}

/** mulberry32 — small, fast, and deterministic across engines. */
function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Identity key used to canonicalise the pool before shuffling. Credential hex
 * first (the only form-independent identity), then the raw fields. DRep ids are
 * unique per row, so this is a total order.
 */
function identityKey(entry: DRepMatchEntry): string {
  return (
    entry.stats.credentialHex ??
    (typeof entry.record.hex === 'string' ? entry.record.hex.toLowerCase() : null) ??
    entry.stats.drepId ??
    ''
  );
}

/**
 * Sort by identity, then Fisher-Yates with the seeded PRNG. Sorting first is
 * what makes the result independent of the caller's input ordering.
 */
function seededShuffle(entries: DRepMatchEntry[], seed: string): DRepMatchEntry[] {
  const out = [...entries].sort((a, b) => identityKey(a).localeCompare(identityKey(b)));
  const random = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function isSet(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.trim().length > 0;
  return false;
}

function passes(name: DRepCriterionName, criteria: DRepMatchCriteria, stats: DRepStats): boolean {
  switch (name) {
    case 'participationMin': {
      const pct = stats.participation.pct;
      return pct !== null && pct >= Number(criteria.participationMin);
    }
    case 'rationaleMin': {
      const pct = stats.rationaleRate.pct;
      return pct !== null && pct >= Number(criteria.rationaleMin);
    }
    case 'focusArea': {
      // Unknown focus areas fail: an unanswerable criterion is not a pass.
      if (stats.focusAreas === null) return false;
      const wanted = String(criteria.focusArea).trim().toLowerCase();
      return stats.focusAreas.some(area => area.type.toLowerCase() === wanted && area.voted > 0);
    }
    case 'outsideTopN':
      return stats.powerRankBucket === 'outsideTopN';
    case 'excludeInactive':
      return stats.active;
    default:
      return true;
  }
}

/**
 * Split `records` into full matches and near misses against `criteria`.
 *
 * @param seedOrOptions a bare seed string, or an options object carrying the
 *   seed alongside the `drepStats` context (eligible actions, type resolver,
 *   power denominators).
 */
export function drepMatch(
  criteria: DRepMatchCriteria,
  records: unknown,
  seedOrOptions: string | DRepMatchOptions = {},
): DRepMatchResult {
  const options: DRepMatchOptions =
    typeof seedOrOptions === 'string' ? { seed: seedOrOptions } : seedOrOptions ?? {};
  const seed = typeof options.seed === 'string' ? options.seed : '';

  const activeCriteria = CRITERIA_ORDER.filter(name => isSet(criteria?.[name]));

  const matches: DRepMatchEntry[] = [];
  const nearMisses: DRepMatchEntry[] = [];
  let skipped = 0;

  const list = Array.isArray(records) ? records : [];
  for (const raw of list) {
    const stats = drepStats(raw, options);
    if (!stats) {
      skipped += 1;
      continue;
    }
    const failing = activeCriteria.filter(name => !passes(name, criteria, stats));
    const entry: DRepMatchEntry = { record: raw as DRepRecord, stats, failing };
    if (failing.length === 0) matches.push(entry);
    else nearMisses.push(entry);
  }

  return {
    matches: seededShuffle(matches, seed),
    // Shuffled on the same seed, then grouped by how close they came. This
    // counts unmet criteria — it is not a quality score and never reads power.
    nearMisses: seededShuffle(nearMisses, seed).sort((a, b) => a.failing.length - b.failing.length),
    poolSize: matches.length,
    activeCriteria,
    skipped,
  };
}
