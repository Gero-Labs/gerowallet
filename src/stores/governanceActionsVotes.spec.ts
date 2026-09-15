// One page of votes was a WRONG answer, not merely a short one. Real mainnet
// actions carry 238 / 211 / 191 / 154 votes against a server-clamped page size
// of 100, so a DRep who voted early fell off page 1 and the board reported
// "awaiting your vote" about a vote the user had already cast.
//
// These cases pin the fix: follow pages until `total` is covered, and where the
// cap stops short, say so rather than treating a prefix as the whole list.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getProposalVotes = vi.fn();
vi.mock('@/api/governance-api', () => ({
  default: {
    listProposals: vi.fn(),
    getProposal: vi.fn(),
    getVotingSummary: vi.fn(),
    getProposalVotes: (...args: unknown[]) => getProposalVotes(...args),
  },
}));

import governanceActionsStore, { MAX_VOTE_PAGES, VOTES_PAGE_SIZE } from './governanceActionsStore';
import { toCip129 } from '@/shared/utils/drepId';

const state = governanceActionsStore.state;

const CRED = 'aa'.repeat(28);
const DREP = toCip129(CRED) as string;

function row(drepId: string | null) {
  return { voterRole: 'DRep', voterHash: null, drepId, vote: 'Yes', txHash: null };
}

/** A server page: `total` is the whole action, `items` only this slice. */
function pageOf(items: unknown[], page: number, total: number | null) {
  return { items, page, pageSize: VOTES_PAGE_SIZE, total };
}

/** `total` rows, served `VOTES_PAGE_SIZE` at a time, with `needle` at `needleAt`. */
function servePages(total: number, needleAt = -1) {
  const all = Array.from({ length: total }, (_, i) => row(i === needleAt ? DREP : toCip129(String(i % 100).padStart(2, '0').repeat(28))));
  return async (_id: string, _network: string, page: number, pageSize: number) =>
    pageOf(all.slice((page - 1) * pageSize, page * pageSize), page, total);
}

beforeEach(() => {
  vi.clearAllMocks();
  governanceActionsStore.reset();
});

describe('loadActionVotes', () => {
  it('follows pages until the whole action is loaded', async () => {
    getProposalVotes.mockImplementation(servePages(238));

    await governanceActionsStore.loadActionVotes('a#0', 'Mainnet');

    // 238 rows at 100 per page is three requests, not one.
    expect(getProposalVotes).toHaveBeenCalledTimes(3);
    expect(state.currentVotes).toHaveLength(238);
    expect(state.votesTotal).toBe(238);
    expect(state.votesTruncated).toBe(false);
  });

  it('stops at the page cap and flags the list as truncated', async () => {
    getProposalVotes.mockImplementation(servePages(5000));

    await governanceActionsStore.loadActionVotes('a#0', 'Mainnet');

    expect(getProposalVotes).toHaveBeenCalledTimes(MAX_VOTE_PAGES);
    expect(state.currentVotes).toHaveLength(MAX_VOTE_PAGES * VOTES_PAGE_SIZE);
    // The UI needs this to withhold "your DRep has not voted".
    expect(state.votesTruncated).toBe(true);
    expect(state.votesTotal).toBe(5000);
  });

  it('does not walk pages it cannot count towards', async () => {
    // A null total means the server does not count this list mode; one page is
    // all that can honestly be claimed.
    getProposalVotes.mockResolvedValue(pageOf([row(DREP)], 1, null));

    await governanceActionsStore.loadActionVotes('a#0', 'Mainnet');

    expect(getProposalVotes).toHaveBeenCalledTimes(1);
    expect(state.votesTotal).toBeNull();
    expect(state.votesTruncated).toBe(false);
  });

  it('drops the previous action\'s positions the moment the displayed action changes', async () => {
    getProposalVotes.mockImplementation(servePages(3));
    await governanceActionsStore.loadActionVotes('a#0', 'Mainnet');
    expect(state.currentVotes).toHaveLength(3);

    await governanceActionsStore.loadAction('b#0', 'Mainnet');

    // Leaving A's voters under B's heading would attribute them to B.
    expect(state.currentVotes).toEqual([]);
    expect(state.votesTotal).toBeNull();
    expect(state.votesTruncated).toBe(false);
    expect(state.votesLoaded).toBe(false);
  });

  it('refuses a late write from the action the reader navigated away from', async () => {
    // A follows up to five pages, so it is in flight for five round trips. If it
    // lands after the reader opens B, its voters must not appear under B.
    let releaseA: (() => void) | null = null;
    getProposalVotes.mockImplementation((id: string, _network: string, page: number) => {
      if (id === 'a#0') {
        return new Promise(resolve => {
          releaseA = () => resolve(pageOf([row(DREP), row(DREP)], page, 2));
        });
      }
      return Promise.resolve(pageOf([row(null)], page, 1));
    });

    const late = governanceActionsStore.loadActionVotes('a#0', 'Mainnet');
    await governanceActionsStore.loadAction('b#0', 'Mainnet');
    await governanceActionsStore.loadActionVotes('b#0', 'Mainnet');

    expect(state.currentVotes).toHaveLength(1);
    expect(state.votesTotal).toBe(1);

    releaseA?.();
    await late;

    // B's list, B's count, B's flags — untouched by A's late arrival.
    expect(state.currentVotes).toHaveLength(1);
    expect(state.currentVotes[0].drepId).toBeNull();
    expect(state.votesTotal).toBe(1);
    expect(state.votesLoading).toBe(false);
    expect(state.votesLoaded).toBe(true);
  });

  it('keeps a late FAILURE from erasing the action now on screen', async () => {
    let rejectA: (() => void) | null = null;
    getProposalVotes.mockImplementation((id: string, _network: string, page: number) => {
      if (id === 'a#0') {
        return new Promise((_resolve, reject) => {
          rejectA = () => reject(new Error('upstream down'));
        });
      }
      return Promise.resolve(pageOf([row(null)], page, 1));
    });

    const late = governanceActionsStore.loadActionVotes('a#0', 'Mainnet');
    await governanceActionsStore.loadAction('b#0', 'Mainnet');
    await governanceActionsStore.loadActionVotes('b#0', 'Mainnet');

    rejectA?.();
    await late;

    expect(state.votesError).toBeNull();
    expect(state.currentVotes).toHaveLength(1);
  });

  it('keeps a failure distinguishable from an action nobody voted on', async () => {
    getProposalVotes.mockRejectedValue(new Error('upstream down'));

    await governanceActionsStore.loadActionVotes('a#0', 'Mainnet');

    expect(state.currentVotes).toEqual([]);
    // An empty list plus a null error would have read as "no votes recorded".
    expect(state.votesError).toBe('upstream down');
    expect(state.votesLoaded).toBe(true);
    expect(state.votesLoading).toBe(false);
  });
});

describe('loadYourVotes', () => {
  const identity = { drepId: DREP, kind: 'delegated' as const };

  beforeEach(() => {
    state.actions = [
      { govActionId: 'a#0', status: 'active' },
      { govActionId: 'b#0', status: 'active' },
    ] as never;
  });

  it('finds a vote that page 1 alone would have missed', async () => {
    // The exact live failure: 238 voters, this wallet's DRep at position 150.
    getProposalVotes.mockImplementation(servePages(238, 150));

    await governanceActionsStore.loadYourVotes('Mainnet', identity);

    expect(state.yourVotes.status).toBe('ready');
    expect(state.yourVotes.byAction['a#0']).toBe('Yes');
    expect(state.yourVotes.byAction['b#0']).toBe('Yes');
  });

  it('leaves an action UNRESOLVED when the cap stopped the scan short', async () => {
    // No match found, but the list was cut off, so absence proves nothing: the
    // action must read as unknown rather than "awaiting your vote".
    getProposalVotes.mockImplementation(servePages(5000));

    await governanceActionsStore.loadYourVotes('Mainnet', identity);

    expect(state.yourVotes.resolved).toEqual([]);
    expect(state.yourVotes.status).toBe('unavailable');
  });

  it('still resolves a truncated action when the vote WAS found in it', async () => {
    // A found vote is a positive fact; truncation cannot take it away.
    getProposalVotes.mockImplementation(servePages(5000, 10));

    await governanceActionsStore.loadYourVotes('Mainnet', identity);

    expect(state.yourVotes.resolved).toContain('a#0');
    expect(state.yourVotes.byAction['a#0']).toBe('Yes');
  });
});
