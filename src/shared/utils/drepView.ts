/**
 * Presentation helpers for the DRep directory, profile and match panel.
 *
 * `drepStats.ts` owns the behaviour maths; this module owns the two jobs that
 * sit either side of it: reading CIP-119 metadata safely, and BUILDING the
 * `DRepStatsContext` from data the wallet actually holds.
 *
 * The context builders exist because two different services name the same
 * governance action differently. gero-backend's `/api/dreps` stamps a vote with
 * a `proposal_id`; Nexus's `/api/governance` lists the same action as
 * `govActionId` (`{txHash}#{index}`) alongside `govActionIdCip129` (bech32).
 * Handing `drepStats` a denominator built from the wrong form would score every
 * DRep 0% participation — a false accusation, and the loudest possible bug. So
 * `eligibleActionIdsFor` only returns a list when it can PROVE both sides speak
 * the same form, and returns null otherwise; the caller then falls back to the
 * bare count and the UI renders the honest "pending" state.
 *
 * Everything here is pure and total: nothing fetches, nothing throws. Lovelace
 * goes through `toLovelace`/`pctOf` — `Number()` on lovelace is a defect.
 */

import { parseGovActionId, toDisplayGovActionId } from '@/shared/utils/govActionId';
import { pctOf, toLovelace } from '@/shared/utils/lovelace';
import type { ActionTypeResolver } from '@/shared/utils/drepStats';

/** The subset of a Nexus governance action this module reads. */
export interface ActionIdentity {
  govActionId?: string | null;
  govActionIdCip129?: string | null;
  type?: string | null;
}

/** The subset of a `/api/dreps` delegator row this module reads. */
export interface DelegatorRow {
  /** Lovelace as a decimal string. */
  amount?: string | null;
  epoch_no?: number | null;
}

/** The subset of a `/api/dreps` row this module reads. Deliberately loose — the endpoint is untyped upstream. */
export interface DRepViewRecord {
  drep_id?: string | null;
  display_name?: string | null;
  url?: string | null;
  hash?: string | null;
  metadata?: {
    meta_url?: string | null;
    meta_hash?: string | null;
    is_valid?: boolean | null;
    meta_json?: { body?: Record<string, unknown> | null } | null;
  } | null;
  /** Lovelace as a decimal string. */
  amount?: string | null;
}

/**
 * Anchor trust, in four states that must never collapse into two.
 *
 * `unverified` is NOT `mismatch`: a DRep who published a document nobody has
 * checked has done nothing wrong, and painting them as invalid would be a
 * defamatory default. Only an explicit `is_valid: false` is a mismatch.
 */
export type DRepAnchorState = 'verified' | 'mismatch' | 'unverified' | 'none';

function body(record: unknown): Record<string, unknown> | null {
  if (!record || typeof record !== 'object') return null;
  const meta = (record as DRepViewRecord).metadata;
  const json = meta && typeof meta === 'object' ? meta.meta_json : null;
  const inner = json && typeof json === 'object' ? json.body : null;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : null;
}

/** CIP-119 values are sometimes bare strings and sometimes JSON-LD `{'@value': …}`. */
function cipValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (value && typeof value === 'object' && '@value' in (value as object)) {
    const inner = (value as Record<string, unknown>)['@value'];
    return typeof inner === 'string' ? inner.trim() || null : null;
  }
  return null;
}

function nonEmpty(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** The DRep's published name, or null. Never an empty string, never a placeholder. */
export function drepDisplayName(record: unknown): string | null {
  const fields = body(record);
  const given = cipValue(fields?.['givenName']);
  if (given) return given;
  if (record && typeof record === 'object') {
    return cipValue((record as DRepViewRecord).display_name);
  }
  return null;
}

/** The DRep's own description of what they are for, or null. */
export function drepBio(record: unknown): string | null {
  const fields = body(record);
  return cipValue(fields?.['objectives']) ?? cipValue(fields?.['motivations']) ?? null;
}

/** Classify the DRep's CIP-119 anchor. See `DRepAnchorState`. */
export function drepAnchorState(record: unknown): DRepAnchorState {
  if (!record || typeof record !== 'object') return 'none';
  const row = record as DRepViewRecord;
  const meta = row.metadata ?? null;
  const hasAnchor =
    nonEmpty(row.url) || nonEmpty(row.hash) || nonEmpty(meta?.meta_url) || nonEmpty(meta?.meta_hash);
  if (!hasAnchor) return 'none';
  if (meta?.is_valid === true) return 'verified';
  if (meta?.is_valid === false) return 'mismatch';
  return 'unverified';
}

/**
 * Lovelace delegated to this DRep in the CURRENT epoch, or null when that
 * cannot be told apart from a snapshot.
 *
 * `delegators[].epoch_no` is not documented as a delegation date, and on some
 * providers every row simply carries the snapshot epoch. In that case the
 * "inflow" would equal the DRep's entire voting power, and the UI would print a
 * spectacular invented number. So: if every row carries the current epoch, the
 * field is telling us nothing and this returns null. A genuine 0 (the field
 * varies, nothing landed this epoch) is a fact and is returned as 0n.
 */
export function epochInflow(delegators: unknown, currentEpoch: number | null | undefined): bigint | null {
  if (typeof currentEpoch !== 'number' || !Number.isFinite(currentEpoch)) return null;
  if (!Array.isArray(delegators) || delegators.length === 0) return null;

  const epochs: number[] = [];
  for (const row of delegators) {
    const epoch = (row as DelegatorRow)?.epoch_no;
    if (typeof epoch === 'number' && Number.isFinite(epoch)) epochs.push(epoch);
  }
  if (epochs.length === 0) return null;
  if (epochs.every(epoch => epoch === currentEpoch)) return null;

  let total = 0n;
  for (const row of delegators) {
    const entry = row as DelegatorRow;
    if (entry?.epoch_no === currentEpoch) total += toLovelace(entry.amount);
  }
  return total;
}

/**
 * `{txHash}#{index}`, or null when the id is not a governance action id at all.
 *
 * The one join key between a DRep's `proposal_id` and a Nexus action row, in
 * whichever form either side happens to use.
 */
export function canonicalActionKey(raw: unknown): string | null {
  const parsed = parseGovActionId(typeof raw === 'string' ? raw : null);
  return parsed ? toDisplayGovActionId(parsed) : null;
}

const canonicalActionId = canonicalActionKey;

/**
 * A `proposal_id` → action-type resolver over the loaded governance actions.
 *
 * Both sides are canonicalised, so a vote stamped in bech32 still resolves
 * against an action listed in `{txHash}#{index}` form. An id that is not in the
 * loaded window resolves to null — the type is unknown, never guessed.
 */
export function actionTypeResolverFor(actions: readonly ActionIdentity[] | null | undefined): ActionTypeResolver {
  const byId = new Map<string, string>();
  for (const action of Array.isArray(actions) ? actions : []) {
    const type = typeof action?.type === 'string' ? action.type.trim() : '';
    if (!type) continue;
    for (const raw of [action.govActionId, action.govActionIdCip129]) {
      const canonical = canonicalActionId(raw);
      if (canonical) byId.set(canonical, type);
    }
  }
  return (proposalId: string) => {
    const canonical = canonicalActionId(proposalId);
    return canonical ? byId.get(canonical) ?? null : null;
  };
}

/**
 * The eligible action ids, written in the SAME literal form the DRep feed uses
 * for `proposal_id` — or null when that form cannot be established.
 *
 * `drepStats` matches eligible ids literally (it has no parser), so the form has
 * to agree or every participation figure collapses to 0%. `sampleProposalId` is
 * any one `proposal_id` off a loaded DRep; its form decides the output form. A
 * bech32 feed additionally requires every action to carry a `govActionIdCip129`,
 * because a partial list would silently shrink the denominator.
 */
export function eligibleActionIdsFor(
  sampleProposalId: string | null | undefined,
  actions: readonly ActionIdentity[] | null | undefined,
): string[] | null {
  const list = Array.isArray(actions) ? actions : [];
  if (list.length === 0) return null;

  const sample = typeof sampleProposalId === 'string' ? sampleProposalId.trim() : '';
  if (!canonicalActionId(sample)) return null;

  const useBech32 = sample.toLowerCase().startsWith('gov_action');
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const action of list) {
    const id = useBech32
      ? typeof action?.govActionIdCip129 === 'string'
        ? action.govActionIdCip129.trim()
        : ''
      : canonicalActionId(action?.govActionId) ?? canonicalActionId(action?.govActionIdCip129) ?? '';
    // One unusable row means the denominator would be short. Refuse the whole list.
    if (!id) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }

  return ids;
}

export interface PowerConcentration {
  /** How many records the figures were computed over. */
  sampleSize: number;
  /**
   * Whether the sample really arrived ordered by power, descending. The caller
   * asked the server to sort; this is the proof it did. Without it, `cutoffPower`
   * describes only the sample and must not be presented as a network-wide rank.
   */
  sortedDesc: boolean;
  /** Percent of the SAMPLE's power held by its largest N. Null when the sample holds none. */
  topShare: number | null;
  /** Power of the Nth-largest record. Null when the sample is shorter than N. */
  cutoffPower: bigint | null;
}

/**
 * Concentration facts over a sample of DRep records, with BigInt sums.
 *
 * Nothing here ranks the DReps a user sees — it produces two denominators (the
 * top-N power cutoff and the largest-N share) that the match panel states as
 * facts and uses as a neutral filter boundary.
 */
export function powerConcentration(records: unknown, topN: number): PowerConcentration {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) return { sampleSize: 0, sortedDesc: false, topShare: null, cutoffPower: null };

  const powers = list.map(record => toLovelace((record as DRepViewRecord)?.amount));

  let sortedDesc = true;
  for (let i = 1; i < powers.length; i += 1) {
    if (powers[i] > powers[i - 1]) {
      sortedDesc = false;
      break;
    }
  }

  const descending = [...powers].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  const n = Math.max(0, Math.trunc(topN));

  let total = 0n;
  for (const power of descending) total += power;
  let head = 0n;
  for (const power of descending.slice(0, n)) head += power;

  return {
    sampleSize: list.length,
    sortedDesc,
    topShare: total > 0n ? pctOf(head, total) : null,
    cutoffPower: n > 0 && descending.length >= n ? descending[n - 1] : null,
  };
}
