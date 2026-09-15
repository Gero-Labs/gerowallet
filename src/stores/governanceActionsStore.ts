import Vue from 'vue';
import governanceApi from '@/api/governance-api';
import { sameDRep } from '@/shared/utils/drepId';
import { isOpen } from '@/shared/utils/govLifecycle';
import type {
  Committee,
  GovProposal,
  GovProposalDetail,
  GovVote,
  GovVotingSummary,
} from '@/api/governance.types';

/**
 * Governance actions (CIP-1694 proposals).
 *
 * Deliberately separate from `governanceStore`, which owns DReps and is fed by
 * gero-backend's own snake_case /api/dreps. These two talk to different
 * services with different response shapes; keeping one store per service stops
 * that difference leaking into components.
 */

/**
 * Whose vote the "awaiting your vote" join is looking for: this wallet's own
 * registered DRep, or the DRep it delegated to. The two read differently in the
 * UI ("You haven't voted" vs "Your DRep hasn't voted"), so the kind travels
 * with the result rather than being re-derived at render time.
 */
export type VoterIdentityKind = 'self' | 'delegated';

export interface VoterIdentity {
  /** Any DRep id form. Matched through `sameDRep`, never by string equality. */
  drepId: string;
  kind: VoterIdentityKind;
}

/**
 * `unavailable` is the one that matters: `/api/governance/*` still 404s in
 * production, and a votes endpoint that is not there yet must read as UNKNOWN,
 * never as "nothing awaits your vote". `partial` means some lookups came back
 * and the count covers only those.
 */
export type YourVotesStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

/**
 * What the join established for ONE action. `unknown` is not a failure state at
 * the row level: it covers "outside the capped scan" as well as "the lookup did
 * not come back", and both mean the row must stay silent rather than claim the
 * vote was not cast.
 */
export type RowVoteStatus = 'unknown' | 'voted' | 'awaiting';

export interface YourVotesState {
  status: YourVotesStatus;
  identityKind: VoterIdentityKind | null;
  /** govActionId -> the vote this identity cast. Absent means they did not vote. */
  byAction: Record<string, string>;
  /** Open actions the scan covered, after the cap. */
  scanned: number;
  /**
   * govActionIds whose votes actually came back. Absence from this list means
   * UNKNOWN, not "did not vote" — the per-row badge needs that distinction, so
   * the ids are kept rather than just their count.
   */
  resolved: string[];
}

/**
 * The join is one request per open action, so it is capped rather than run over
 * the whole page. The first screenful of open actions is what the stat strip
 * and the row badges can show anyway.
 */
export const MAX_VOTE_SCAN = 10;

/** Requests in flight at once while scanning. */
const VOTE_SCAN_CONCURRENCY = 4;

/**
 * Vote rows per request. 100 is the upstream maximum: larger values are clamped
 * server-side, which is why this is not simply set "well past any real action's
 * voter count" — real mainnet actions carry 238, 211, 191 votes, so ONE page is
 * never enough and the scan has to follow pages.
 */
export const VOTES_PAGE_SIZE = 100;

/**
 * Pages any one action's votes may cost. 500 rows covers every action observed
 * on mainnet with room to spare; past it the list is TRUNCATED and says so,
 * because silently showing a prefix of the voters is a claim about who voted.
 */
export const MAX_VOTE_PAGES = 5;

/**
 * Fetch a whole action's votes, following pages until `total` is covered or the
 * cap is hit.
 *
 * This exists because a single page is a WRONG ANSWER, not just a short one: a
 * DRep who voted early on a 238-vote action falls off page 1, and the board
 * would then tell the user "awaiting your vote" about a vote they already cast.
 */
async function fetchVotePages(
  govActionId: string,
  network: string,
  maxPages: number,
): Promise<{ items: GovVote[]; total: number | null; truncated: boolean }> {
  const first = await governanceApi.getProposalVotes(govActionId, network, 1, VOTES_PAGE_SIZE);
  const items = [...(first.items ?? [])];
  const total = first.total ?? null;

  // A null total means the server does not count this list mode, so there is no
  // page count to walk towards. One page is all that can honestly be claimed.
  if (total === null) return { items, total, truncated: items.length >= VOTES_PAGE_SIZE };

  let page = 1;
  while (items.length < total && page < maxPages) {
    page += 1;
    const next = await governanceApi.getProposalVotes(govActionId, network, page, VOTES_PAGE_SIZE);
    const rows = next.items ?? [];
    if (!rows.length) break;
    items.push(...rows);
  }

  return { items, total, truncated: items.length < total };
}

export interface GovernanceActionsState {
  actions: GovProposal[];
  page: number;
  pageSize: number;
  total: number | null;
  loading: boolean;
  error: string | null;

  currentAction: GovProposalDetail | null;
  currentSummary: GovVotingSummary | null;
  currentVotes: GovVote[];
  actionLoading: boolean;
  actionError: string | null;

  /** How many votes the action has in total, or null when upstream does not count. */
  votesTotal: number | null;
  votesLoading: boolean;
  /**
   * Whether a votes fetch has been ATTEMPTED for the current action. Distinct
   * from `currentVotes.length`: an action nobody voted on would otherwise
   * re-fetch on every visit to the tab.
   */
  votesLoaded: boolean;
  /**
   * A votes failure is its own state. The old code caught and set `[]`, which
   * made an outage indistinguishable from an action nobody voted on.
   */
  votesError: string | null;
  /** True when the page cap stopped the fetch short of `votesTotal`. */
  votesTruncated: boolean;

  /**
   * The constitutional committee of the network on screen, or null when it has
   * not been read (yet, or at all). Null is NOT an empty committee: it is the
   * absence of an answer, and the votes list must fall back to hashes rather
   * than report a member as unknown on the strength of it.
   */
  committee: Committee | null;

  filters: { type: string | null; status: string | null };

  /** Result of the "has my DRep voted on this yet" join. */
  yourVotes: YourVotesState;

  /**
   * Which action `currentAction` is about, as `network:govActionId`.
   *
   * What lets a re-open of the SAME action keep the page it already has, and a
   * different one clear it. Without it the store cannot tell those apart, so it
   * had to assume the worst and blank on every load.
   */
  actionKey: string | null;

  /**
   * When `currentAction` was fetched. Separate from `fetchedAt`, which the LIST
   * load also writes: sharing one field let a list refresh make a stale action
   * look freshly loaded.
   */
  actionFetchedAt: number | null;

  /** When the currently displayed data was fetched — every cached number is stamped. */
  fetchedAt: number | null;
}

/** How long a loaded action stays fresh. Tallies move per block, not per click. */
export const ACTION_TTL_MS = 60 * 1000;

function isFresh(fetchedAt: number | null): boolean {
  return fetchedAt !== null && Date.now() - fetchedAt < ACTION_TTL_MS;
}

function emptyYourVotes(): YourVotesState {
  return { status: 'idle', identityKind: null, byAction: {}, scanned: 0, resolved: [] };
}

/**
 * Open actions this identity has not voted on, or `null` when that is not
 * knowable. Null is NOT zero, and callers must render the two differently: an
 * unreachable votes endpoint means "we cannot tell", which is the opposite of
 * "you are all caught up".
 */
export function awaitingVoteCount(yourVotes: YourVotesState): number | null {
  if (yourVotes.status !== 'ready' && yourVotes.status !== 'partial') return null;
  return Math.max(0, yourVotes.resolved.length - Object.keys(yourVotes.byAction).length);
}

const state = Vue.observable<GovernanceActionsState>({
  actions: [],
  page: 1,
  pageSize: 50,
  total: null,
  loading: false,
  error: null,
  currentAction: null,
  currentSummary: null,
  currentVotes: [],
  actionLoading: false,
  actionError: null,
  votesTotal: null,
  votesLoading: false,
  votesLoaded: false,
  votesError: null,
  votesTruncated: false,
  committee: null,
  filters: { type: null, status: null },
  yourVotes: emptyYourVotes(),
  actionKey: null,
  actionFetchedAt: null,
  fetchedAt: null,
});

function message(error: unknown, fallback: string): string {
  return (error as { message?: string })?.message || fallback;
}

/**
 * Generation counter for the votes slice.
 *
 * `loadActionVotes` follows up to `MAX_VOTE_PAGES` pages, so it is in flight for
 * five sequential round trips. Without a token, a scroll back to action A that
 * resolves after the user has opened action B writes A's voters, A's total and
 * A's truncation flag under B's heading — a list of voters attributed to the
 * wrong action, which is exactly the claim this tab must never make. Only the
 * newest request may write, and switching the displayed action invalidates
 * whatever is still running.
 */
let votesRequest = 0;

/**
 * One committee request per network per session, shared by every caller.
 *
 * The committee changes at most once a term, and the detail view asks for it on
 * every action it opens — so this is a promise cache rather than a fetch: ten
 * actions read in a row cost one request, and a second view mounting mid-flight
 * joins the one already running instead of starting another.
 *
 * A failure resolves to null and is CACHED as null: committee names are a
 * courtesy on this surface, and retrying them on every action open would spend
 * the user's bandwidth on something no row depends on.
 */
const committeeCache = new Map<string, Promise<Committee | null>>();

/**
 * Which network's committee the store is currently interested in. A wallet
 * switched to preprod mid-flight must not have mainnet's committee written under
 * it — the names would be attached to the wrong chain's members.
 */
let committeeNetwork = '';

/** Test seam: forget the cached committees (mirrors `resetDRepNameIndex`). */
export function resetCommitteeCache(): void {
  committeeCache.clear();
  committeeNetwork = '';
}

/** Invalidate any votes fetch in flight and blank the slice it would have written. */
function resetVotes(): void {
  votesRequest += 1;
  state.currentVotes = [];
  state.votesTotal = null;
  state.votesLoading = false;
  state.votesLoaded = false;
  state.votesError = null;
  state.votesTruncated = false;
}

const actions = {
  state,

  setFilters(next: Partial<GovernanceActionsState['filters']>): void {
    Object.assign(state.filters, next);
  },

  async loadActions(network: string, page = 1): Promise<void> {
    state.loading = true;
    state.error = null;
    try {
      const result = await governanceApi.listProposals({
        network,
        page,
        pageSize: state.pageSize,
        type: state.filters.type ?? undefined,
        status: state.filters.status ?? undefined,
      });
      state.actions = result.items ?? [];
      state.page = result.page ?? page;
      state.total = result.total ?? null;
      state.fetchedAt = Date.now();
    } catch (error) {
      state.error = message(error, 'Failed to load governance actions');
      state.actions = [];
    } finally {
      state.loading = false;
    }
  },

  /**
   * Load one action plus its tally. The two are fetched together but fail
   * independently: a tally outage leaves the action readable rather than
   * blanking the page.
   */
  async loadAction(govActionId: string, network: string): Promise<void> {
    const key = `${network}:${govActionId}`;

    // Re-opening the action already on screen: keep it. Nulling it first meant
    // going back to an action you had just read blanked the page to a skeleton
    // and rebuilt it from the network, every time. Inside the window the reader
    // sees what they left, immediately.
    if (state.actionKey === key && state.currentAction && isFresh(state.actionFetchedAt)) {
      state.actionLoading = false;
      state.actionError = null;
      // The stamp stays the one the data was actually fetched at, so the "as of"
      // line keeps telling the truth about a page served from memory.
      state.fetchedAt = state.actionFetchedAt;
      return;
    }

    // A DIFFERENT action, so what is on screen now is about to be wrong.
    if (state.actionKey !== key) {
      state.currentAction = null;
      state.currentSummary = null;
      // The displayed action is changing, so the previous action's votes —
      // loaded or still arriving — stop being about anything on screen.
      resetVotes();
    }
    state.actionKey = key;
    state.actionLoading = true;
    state.actionError = null;

    const [detail, summary] = await Promise.allSettled([
      governanceApi.getProposal(govActionId, network),
      governanceApi.getVotingSummary(govActionId, network),
    ]);

    if (detail.status === 'fulfilled' && detail.value) {
      state.currentAction = detail.value;
    } else {
      state.actionError =
        detail.status === 'rejected'
          ? message(detail.reason, 'Failed to load this governance action')
          : 'Governance action not found';
    }

    state.currentSummary = summary.status === 'fulfilled' ? summary.value : null;
    state.actionFetchedAt = Date.now();
    state.fetchedAt = state.actionFetchedAt;
    state.actionLoading = false;
  },

  /**
   * The constitutional committee of one network, for naming the committee rows
   * on the votes list.
   *
   * Never rejects, and never blanks a committee already in hand: names are a
   * courtesy, and an outage must cost nothing but the names.
   */
  async loadCommittee(network: string): Promise<void> {
    const key = String(network ?? '');
    committeeNetwork = key;

    let request = committeeCache.get(key);
    if (!request) {
      request = governanceApi.getCommittee(key).catch(() => null);
      committeeCache.set(key, request);
    }

    const committee = await request;
    // The wallet may have switched networks while this was in flight; one
    // chain's members must never be published under another's. Written even
    // when it is null, for the same reason: whatever committee was in hand
    // belonged to the previous network and cannot name a row on this one.
    if (committeeNetwork !== key) return;
    state.committee = committee;
  },

  /**
   * Join this wallet's DRep identity against the votes cast on each OPEN action
   * currently loaded, so the board can say which ones still await a vote.
   *
   * Deliberately best-effort and capped. This is an N+1 over the action list,
   * one `getProposalVotes` per open action, so it runs over at most
   * `MAX_VOTE_SCAN` actions in small batches. Individual failures are absorbed:
   * what they cost is CERTAINTY, not the page, and that loss is reported
   * through `status` so the UI can show "unknown" rather than a wrong number.
   */
  async loadYourVotes(
    network: string,
    identity: VoterIdentity | null,
    options: { max?: number; concurrency?: number } = {},
  ): Promise<void> {
    const max = options.max ?? MAX_VOTE_SCAN;
    const concurrency = options.concurrency ?? VOTE_SCAN_CONCURRENCY;

    // A watch-only wallet, or one that has delegated to nobody, has no identity
    // to join against. That is not a failure and must not cost a request.
    if (!identity?.drepId) {
      state.yourVotes = emptyYourVotes();
      return;
    }

    const open = state.actions.filter(action => isOpen(action.status)).slice(0, max);

    state.yourVotes = {
      status: open.length ? 'loading' : 'ready',
      identityKind: identity.kind,
      byAction: {},
      scanned: open.length,
      resolved: [],
    };
    if (!open.length) return;

    const byAction: Record<string, string> = {};
    const resolved: string[] = [];

    for (let i = 0; i < open.length; i += concurrency) {
      const batch = open.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(action => fetchVotePages(action.govActionId, network, MAX_VOTE_PAGES)),
      );
      results.forEach((result, j) => {
        if (result.status !== 'fulfilled') return;
        const govActionId = batch[j].govActionId;
        // A truncated scan cannot prove a vote is ABSENT, so the action is left
        // unresolved — unknown, rather than a false "awaiting your vote".
        const match = result.value.items.find(vote => sameDRep(vote.drepId, identity.drepId));
        if (!match && result.value.truncated) return;
        resolved.push(govActionId);
        // Match on the credential, never on the display string: the wallet holds
        // one id form and the vote row may carry another.
        if (match) byAction[govActionId] = String(match.vote);
      });
    }

    state.yourVotes = {
      status:
        resolved.length === 0 ? 'unavailable' : resolved.length < open.length ? 'partial' : 'ready',
      identityKind: identity.kind,
      byAction,
      scanned: open.length,
      resolved,
    };
  },

  /**
   * Every vote on one action, up to the page cap.
   *
   * A failure sets `votesError` rather than an empty list: votes are
   * supplementary to the tally, so this must not blank the page, but "the
   * lookup failed" and "nobody voted" are different facts and the UI has to be
   * able to tell them apart.
   */
  async loadActionVotes(govActionId: string, network: string): Promise<void> {
    const token = ++votesRequest;
    state.votesLoading = true;
    state.votesError = null;
    try {
      const result = await fetchVotePages(govActionId, network, MAX_VOTE_PAGES);
      // Superseded: another action is on screen now, so not even `votesLoading`
      // may be touched — that flag belongs to the newer request.
      if (token !== votesRequest) return;
      state.currentVotes = result.items;
      state.votesTotal = result.total;
      state.votesTruncated = result.truncated;
    } catch (error) {
      if (token !== votesRequest) return;
      state.currentVotes = [];
      state.votesTotal = null;
      state.votesTruncated = false;
      state.votesError = message(error, 'Failed to load the positions for this action');
    } finally {
      if (token === votesRequest) {
        state.votesLoading = false;
        state.votesLoaded = true;
      }
    }
  },

  reset(): void {
    state.actions = [];
    state.page = 1;
    state.total = null;
    state.loading = false;
    state.error = null;
    state.currentAction = null;
    state.currentSummary = null;
    state.actionLoading = false;
    state.actionError = null;
    resetVotes();
    state.committee = null;
    state.filters.type = null;
    state.filters.status = null;
    state.yourVotes = emptyYourVotes();
    // Both stamps and the action identity go with it: a reset that left
    // `actionKey` behind would let the next load of that same id serve the
    // action this reset just cleared.
    state.actionKey = null;
    state.actionFetchedAt = null;
    state.fetchedAt = null;
  },
};

export default actions;
