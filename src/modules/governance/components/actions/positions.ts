/**
 * Pure logic behind the positions (cast votes) explorer.
 *
 * Kept out of the component so the honesty rules below are testable on their
 * own. Three of them are load-bearing:
 *
 *  1. Every optional field on `GovVote` is treated as ABSENT until proven
 *     present. Production's projection is not confirmed to carry `votedAt`,
 *     `rationaleUrl`, `hasScript` or the role-agnostic `voterId`, so absence
 *     hides the affordance rather than rendering a blank or a zero.
 *  2. Identity is matched on the DRep CREDENTIAL, never on the display string.
 *     The wallet holds one id form and a vote row may carry another.
 *  3. A truncated list cannot prove a vote is absent. "Your DRep has not voted"
 *     is a claim about the user, and it is only made from a complete list.
 *
 * EXISTENCE and RENDERABILITY are also kept apart, because conflating them
 * publishes a false number: roughly a quarter of published rationales are
 * `ipfs://`, which is a real rationale that this wallet cannot turn into a safe
 * href. Counting only the linkable ones reported those voters as having
 * published nothing.
 */

import type { CommitteeMember, GovVote } from '@/api/governance.types';
import { KEYWORD_DREPS, parseDRepId, sameDRep } from '@/shared/utils/drepId';

/** Whose position the callout is about. Mirrors the store's `VoterIdentityKind`. */
export type PositionOwner = 'self' | 'delegated';

export interface PositionIdentity {
  /** Any DRep id form, or a keyword DRep. */
  drepId: string;
  kind: PositionOwner;
}

/** One vote row, normalised for rendering. Nothing here is ever a placeholder. */
export interface PositionRow {
  /** Stable v-for key. */
  key: string;
  role: string;
  /** Best identifier available: bech32 where upstream gave one, hex otherwise. */
  id: string;
  /** 28-byte credential of a DRep row — the only safe name-index key. Null otherwise. */
  credentialHex: string | null;
  /**
   * 28-byte credential of a COMMITTEE row, lower-case hex — the HOT one, which
   * is what the member signed this vote with. Kept apart from `credentialHex` on
   * purpose: the two are looked up in different indexes, and a shared field
   * would let a committee hash collide with a DRep credential and borrow that
   * DRep's name.
   */
  committeeHex: string | null;
  /**
   * The same member's COLD credential, when the projection resolved one.
   *
   * A SECOND field rather than a swap, because the two hashes are different
   * facts and both are wanted: the hot one is what signed the vote and is what a
   * reader may have copied from another explorer, so it stays searchable, while
   * only the cold one can be looked up in the committee index. See
   * `GovVote.committeeColdHash` for why they never match.
   */
  committeeColdHex: string | null;
  drepId: string | null;
  vote: string;
  /** Unix seconds, or null when the projection does not carry a block time. */
  votedAt: number | null;
  /** Did this voter publish a rationale at all? The anchor URL is non-empty. */
  hasRationale: boolean;
  /**
   * The CIP-136 anchor as recorded on chain, for the rationale dialog to fetch
   * (http(s) directly, `ipfs://` through the backend proxy) and hash-check.
   * Scheme-checking is the dialog's job, not the row's.
   */
  rationaleUrl: string | null;
  rationaleHash: string | null;
  /** Only ever true from an explicit `true`. Unknown is not "not a script". */
  hasScript: boolean;
  isDRep: boolean;
}

export interface PositionSummary {
  total: number;
  yes: number;
  no: number;
  abstain: number;
  /** Counts per role, in a fixed order, omitting roles with no rows. */
  byRole: Array<{ role: string; count: number }>;
  /** Voters who published a rationale. This is the head count. */
  withRationale: number;
  /** True when at least one row carries a block time, so ordering by date means something. */
  anyVotedAt: boolean;
  /** True when at least one row does NOT, so "newest first" needs a caveat. */
  anyMissingVotedAt: boolean;
}

export interface PositionFilters {
  search: string;
  role: string;
  choice: string;
  rationaleOnly: boolean;
}

export type PositionSort = 'newest' | 'oldest';

export type YourPosition =
  /** No delegation and no DRep of our own: nothing on this list is the user's. */
  | { kind: 'none' }
  /**
   * The wallet's own delegation has not been read yet. NOT the same as `none`:
   * one is a fact about the user, the other is a gap in what we loaded.
   */
  | { kind: 'identityUnknown' }
  /** Delegated to always-abstain / always-no-confidence: a standing position, never a row. */
  | { kind: 'keyword'; who: PositionOwner }
  | { kind: 'voted'; who: PositionOwner; row: PositionRow }
  | { kind: 'notVoted'; who: PositionOwner }
  /** The list is incomplete, so absence proves nothing. */
  | { kind: 'unknown'; who: PositionOwner };

/** Fixed display order. Not a ranking — all three bodies are equally common. */
export const ROLE_ORDER = ['DRep', 'SPO', 'ConstitutionalCommittee'] as const;

export const VOTE_CHOICES = ['Yes', 'No', 'Abstain'] as const;

function roleRank(role: string): number {
  const index = (ROLE_ORDER as readonly string[]).indexOf(role);
  return index === -1 ? ROLE_ORDER.length : index;
}

/** A positive unix-seconds timestamp, or null. Epoch 0 is not a date, it is a missing field. */
function toVotedAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Did the voter publish a rationale anchor? Any non-empty string counts. */
function toHasRationale(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** How the votes feed spells the committee, matching `ROLE_ORDER` above. */
const COMMITTEE_ROLE = 'ConstitutionalCommittee';

/**
 * Whether this row belongs to the committee register.
 *
 * The ROLE, not the presence of a hash. A caller that gates the name lookup on
 * `committeeHex` instead is asserting "is this a committee row" from a value
 * that may legitimately be absent — a hot credential the projection sent in a
 * form `toCredentialHex` rejects would then skip the lookup entirely, even with
 * a cold hash resolved and a name sitting in the index. Which register a row
 * belongs to is a fact about the voter, so it is read from the voter.
 */
export function isCommitteeRow(row: PositionRow): boolean {
  return row.role === COMMITTEE_ROLE;
}

/**
 * A 28-byte credential as lower-case hex, or null.
 *
 * Shape-checked rather than trusted: `voterHash` is whatever upstream sent, and
 * a value that is not a credential must not become a map key that could collide
 * with one.
 */
function toCredentialHex(value: unknown): string | null {
  const hex = String(value ?? '').trim().toLowerCase();
  return /^[0-9a-f]{56}$/.test(hex) ? hex : null;
}

/**
 * A credential -> published-name index over the current committee.
 *
 * Members with no `displayName` are LEFT OUT rather than indexed as an empty
 * name, so a lookup miss and a nameless member are the same answer: render the
 * hash. Nothing here fills a gap — see `CommitteeMember` for why a vote may not
 * join to any member at all (the feed carries the hot credential; the committee
 * lists the cold one), and why guessing by position would be a fabrication.
 */
export function committeeNameIndex(
  members: readonly CommitteeMember[] | null | undefined,
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const member of members ?? []) {
    const hex = toCredentialHex(member?.hash);
    const name = typeof member?.displayName === 'string' ? member.displayName.trim() : '';
    if (!hex || !name) continue;
    index.set(hex, name);
  }
  return index;
}

/**
 * This committee row's published name, or null when nothing in the index is it.
 *
 * Keyed on the COLD credential, because that is what the committee endpoint
 * lists. The hot credential is tried second only so that behaviour is unchanged
 * where no join was resolved — it has never matched anything and is not expected
 * to, but a lookup that silently stopped happening would be harder to notice
 * than one that keeps returning null.
 */
export function committeeNameOf(
  row: PositionRow,
  index: ReadonlyMap<string, string> | null | undefined,
): string | null {
  if (!index) return null;
  const key = row.committeeColdHex ?? row.committeeHex;
  return key ? (index.get(key) ?? null) : null;
}

export function toPositionRows(votes: GovVote[]): PositionRow[] {
  return (votes ?? []).map((vote, i) => {
    const role = String(vote.voterRole ?? '');
    const isDRep = role === 'DRep';
    const id = String(vote.voterId || vote.drepId || vote.voterHash || '');
    // Only DRep rows get a credential: an SPO's `voterHash` is 56 hex too and
    // would parse, which would let a pool collide with a DRep in the name index.
    const credentialHex = isDRep ? (parseDRepId(vote.drepId || vote.voterHash)?.credentialHex ?? null) : null;
    return {
      key: `${role}:${id}:${i}`,
      role,
      id,
      credentialHex,
      committeeHex: role === COMMITTEE_ROLE ? toCredentialHex(vote.voterHash) : null,
      committeeColdHex: role === COMMITTEE_ROLE ? toCredentialHex(vote.committeeColdHash) : null,
      drepId: vote.drepId ?? null,
      vote: String(vote.vote ?? ''),
      votedAt: toVotedAt(vote.votedAt),
      hasRationale: toHasRationale(vote.rationaleUrl),
      rationaleUrl: toHasRationale(vote.rationaleUrl) ? String(vote.rationaleUrl).trim() : null,
      rationaleHash: typeof vote.rationaleHash === 'string' && vote.rationaleHash.trim() ? vote.rationaleHash.trim() : null,
      hasScript: vote.hasScript === true,
      isDRep,
    };
  });
}

/**
 * Head counts, one per voter.
 *
 * These are NOT the tally. Stake weight decides the outcome and lives on the
 * Overview tab; this counts voters. The two must never be presented as the same
 * number, which is why nothing here produces a percentage or a bar.
 */
export function summarizePositions(rows: PositionRow[]): PositionSummary {
  const byRole = new Map<string, number>();
  let yes = 0;
  let no = 0;
  let abstain = 0;
  let withRationale = 0;
  let anyVotedAt = false;
  let anyMissingVotedAt = false;

  for (const row of rows) {
    if (row.vote === 'Yes') yes += 1;
    else if (row.vote === 'No') no += 1;
    else if (row.vote === 'Abstain') abstain += 1;
    if (row.hasRationale) withRationale += 1;
    if (row.votedAt !== null) anyVotedAt = true;
    else anyMissingVotedAt = true;
    if (row.role) byRole.set(row.role, (byRole.get(row.role) ?? 0) + 1);
  }

  return {
    total: rows.length,
    yes,
    no,
    abstain,
    byRole: [...byRole.entries()]
      .map(([role, count]) => ({ role, count }))
      .sort((a, b) => roleRank(a.role) - roleRank(b.role)),
    withRationale,
    anyVotedAt,
    anyMissingVotedAt,
  };
}

/** Case-insensitive substring match over the voter's name and every id form it has. */
function matchesSearch(row: PositionRow, needle: string, name: string | null): boolean {
  const haystack = [name, row.id, row.drepId, row.credentialHex, row.committeeHex, row.committeeColdHex]
    .filter((v): v is string => !!v)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterPositions(
  rows: PositionRow[],
  filters: PositionFilters,
  nameOf: (row: PositionRow) => string | null = () => null,
): PositionRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(row => {
    if (filters.role !== 'all' && row.role !== filters.role) return false;
    if (filters.choice !== 'all' && row.vote !== filters.choice) return false;
    // Existence, not linkability: filtering on the href would hide every voter
    // whose rationale lives on IPFS.
    if (filters.rationaleOnly && !row.hasRationale) return false;
    if (needle && !matchesSearch(row, needle, nameOf(row))) return false;
    return true;
  });
}

/**
 * Order by when the position was cast.
 *
 * Ordering by voting power is forbidden, permanently: it would make the list a
 * ranking. The data does not even carry per-voter power, so the rule is
 * enforced by absence as well as by policy. Rows with no timestamp sort LAST as
 * a block rather than being interleaved by guess.
 */
export function sortPositions(rows: PositionRow[], order: PositionSort): PositionRow[] {
  const direction = order === 'oldest' ? -1 : 1;
  return [...rows].sort((a, b) => {
    if (a.votedAt === null && b.votedAt === null) return roleRank(a.role) - roleRank(b.role) || a.id.localeCompare(b.id);
    if (a.votedAt === null) return 1;
    if (b.votedAt === null) return -1;
    if (a.votedAt !== b.votedAt) return (b.votedAt - a.votedAt) * direction;
    return roleRank(a.role) - roleRank(b.role) || a.id.localeCompare(b.id);
  });
}

/**
 * The i18n key that describes how `sortPositions` ACTUALLY ordered the list.
 *
 * The footnote used to assert "newest first" unconditionally, which was false
 * as soon as the reader picked oldest first and meaningless on a list where no
 * row carries a block time. Same pattern as `useGovernanceStatus.copyKey`: the
 * claim is chosen where the ordering is known, not at render time.
 */
export function orderNoteKey(
  order: PositionSort,
  summary: Pick<PositionSummary, 'anyVotedAt'>,
): string {
  if (!summary.anyVotedAt) return 'governance.positionsOrderUntimed';
  return order === 'oldest' ? 'governance.positionsOrderOldest' : 'governance.positionsOrderNewest';
}

/** True when this row is the DRep the wallet votes through. */
export function isYourRow(row: PositionRow, identity: PositionIdentity | null): boolean {
  if (!identity || !row.isDRep) return false;
  if ((KEYWORD_DREPS as readonly string[]).includes(identity.drepId)) return false;
  return sameDRep(row.drepId || row.id, identity.drepId);
}

/**
 * What can honestly be said about the user's own position on this action.
 *
 * Two guards keep this from lying, and they are separate facts:
 *
 *  - `complete` — with a truncated list, a missing row means "not found in the
 *    part we loaded", not "did not vote".
 *  - `identityUnknown` — a null identity while the wallet's delegation is still
 *    being read is NOT "you have not delegated". Rendering that as a statement
 *    about the user is the same conflation the other branches exist to avoid.
 */
export function resolveYourPosition(
  rows: PositionRow[],
  identity: PositionIdentity | null,
  complete: boolean,
  identityUnknown = false,
): YourPosition {
  // An identity in hand settles the question whatever the caller says, so the
  // flag is only consulted when there is none.
  if (!identity?.drepId) return identityUnknown ? { kind: 'identityUnknown' } : { kind: 'none' };
  if ((KEYWORD_DREPS as readonly string[]).includes(identity.drepId)) {
    return { kind: 'keyword', who: identity.kind };
  }
  const row = rows.find(candidate => isYourRow(candidate, identity));
  if (row) return { kind: 'voted', who: identity.kind, row };
  return complete ? { kind: 'notVoted', who: identity.kind } : { kind: 'unknown', who: identity.kind };
}
