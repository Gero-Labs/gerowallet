import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/api/governance-api', () => ({
  default: {
    listProposals: vi.fn(),
    getProposal: vi.fn(),
    getVotingSummary: vi.fn(),
    getProposalVotes: vi.fn(),
  },
}));

import governanceApi from '@/api/governance-api';
import store, { awaitingVoteCount, MAX_VOTE_SCAN } from '@/stores/governanceActionsStore';

beforeEach(() => {
  vi.clearAllMocks();
  store.reset();
});

describe('loadActions', () => {
  it('stores the page and clears loading', async () => {
    vi.mocked(governanceApi.listProposals).mockResolvedValue({
      items: [{ govActionId: 'a#0', type: 'InfoAction' } as never],
      page: 1,
      pageSize: 50,
      total: 1,
    });

    await store.loadActions('Preprod');

    expect(store.state.actions).toHaveLength(1);
    expect(store.state.loading).toBe(false);
    expect(store.state.error).toBeNull();
  });

  it('records an error message and does not throw', async () => {
    vi.mocked(governanceApi.listProposals).mockRejectedValue(new Error('upstream down'));

    await expect(store.loadActions('Preprod')).resolves.toBeUndefined();

    expect(store.state.error).toBe('upstream down');
    expect(store.state.loading).toBe(false);
    expect(store.state.actions).toEqual([]);
  });

  it('passes the type and status filters through', async () => {
    vi.mocked(governanceApi.listProposals).mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
    store.setFilters({ type: 'TreasuryWithdrawals', status: 'active' });

    await store.loadActions('Mainnet');

    expect(governanceApi.listProposals).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'TreasuryWithdrawals', status: 'active' }),
    );
  });
});

describe('loadAction', () => {
  it('loads the detail and its voting summary together', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue({ govActionId: 'a#0' } as never);
    vi.mocked(governanceApi.getVotingSummary).mockResolvedValue({ yesVotePower: '1' } as never);

    await store.loadAction('a#0', 'Mainnet');

    expect(store.state.currentAction?.govActionId).toBe('a#0');
    expect(store.state.currentSummary?.yesVotePower).toBe('1');
    expect(store.state.actionError).toBeNull();
  });

  it('keeps the action when only the summary fails — a tally outage must not blank the page', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue({ govActionId: 'a#0' } as never);
    vi.mocked(governanceApi.getVotingSummary).mockRejectedValue(new Error('no summary'));

    await store.loadAction('a#0', 'Mainnet');

    expect(store.state.currentAction?.govActionId).toBe('a#0');
    expect(store.state.currentSummary).toBeNull();
    expect(store.state.actionError).toBeNull();
  });

  it('sets actionError when the action itself is missing', async () => {
    vi.mocked(governanceApi.getProposal).mockResolvedValue(null);
    vi.mocked(governanceApi.getVotingSummary).mockResolvedValue(null);

    await store.loadAction('a#0', 'Mainnet');

    expect(store.state.currentAction).toBeNull();
    expect(store.state.actionError).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// loadYourVotes — the "awaiting your vote" join
// ---------------------------------------------------------------------------
//
// This is an N+1 over the action list, so the two things worth pinning down are
// that it stays capped, and that a votes endpoint which is not there yet reads
// as UNKNOWN rather than as "you have nothing to vote on". `/api/governance/*`
// still 404s in production, so the unavailable path is the live one.

/** One real mainnet DRep, in the two forms the wallet actually sees. */
const DREP_HEX = 'e4466cb4391d2b069e49ddb8dfac9795fc6a91587dd92d6632f495a3';
const DREP_BECH32 = 'drep1ytjyvm958ywjkp57f8wm3havj72lc653tp7ajttxxt6ftgcmcmdk2';

/** N open actions, `a0#0`…, plus one settled action that must never be scanned. */
function seedActions(openCount: number, extra: Array<Record<string, unknown>> = []): void {
  store.state.actions = [
    ...Array.from({ length: openCount }, (_, i) => ({
      govActionId: `a${i}#0`,
      status: 'active',
    })),
    ...extra,
  ] as never;
}

function votesPage(rows: Array<{ drepId: string; vote: string }>) {
  return {
    items: rows.map(r => ({ voterRole: 'DRep', voterHash: null, txHash: null, ...r })),
    page: 1,
    pageSize: 100,
    total: rows.length,
  };
}

describe('loadYourVotes', () => {
  it('makes no request at all without a DRep identity', async () => {
    seedActions(3);

    await store.loadYourVotes('Mainnet', null);

    expect(governanceApi.getProposalVotes).not.toHaveBeenCalled();
    expect(store.state.yourVotes.status).toBe('idle');
    expect(awaitingVoteCount(store.state.yourVotes)).toBeNull();
  });

  it('counts the open actions this DRep has not voted on', async () => {
    seedActions(3);
    vi.mocked(governanceApi.getProposalVotes).mockImplementation(async govActionId =>
      govActionId === 'a1#0' ? votesPage([{ drepId: DREP_BECH32, vote: 'Yes' }]) : votesPage([]),
    );

    await store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'self' });

    expect(store.state.yourVotes.status).toBe('ready');
    expect(store.state.yourVotes.byAction).toEqual({ 'a1#0': 'Yes' });
    expect(awaitingVoteCount(store.state.yourVotes)).toBe(2);
    expect(store.state.yourVotes.identityKind).toBe('self');
  });

  it('matches the DRep across id forms, not by string equality', async () => {
    seedActions(1);
    // The wallet holds the CIP-129 form; the vote row carries the bare
    // credential. String equality would report "has not voted" here.
    vi.mocked(governanceApi.getProposalVotes).mockResolvedValue(
      votesPage([{ drepId: DREP_HEX, vote: 'Abstain' }]),
    );

    await store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'delegated' });

    expect(store.state.yourVotes.byAction).toEqual({ 'a0#0': 'Abstain' });
    expect(awaitingVoteCount(store.state.yourVotes)).toBe(0);
  });

  it('reports UNKNOWN, never zero, when every votes lookup fails', async () => {
    seedActions(3);
    vi.mocked(governanceApi.getProposalVotes).mockRejectedValue(new Error('404 Not Found'));

    await expect(store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'self' })).resolves
      .toBeUndefined();

    expect(store.state.yourVotes.status).toBe('unavailable');
    // The whole point: an endpoint that is not deployed must not render as
    // "0 actions awaiting your vote".
    expect(awaitingVoteCount(store.state.yourVotes)).toBeNull();
  });

  it('counts only what came back when the lookup partly fails', async () => {
    seedActions(3);
    vi.mocked(governanceApi.getProposalVotes).mockImplementation(async govActionId => {
      if (govActionId === 'a2#0') throw new Error('upstream down');
      return votesPage([]);
    });

    await store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'self' });

    expect(store.state.yourVotes.status).toBe('partial');
    // The failed action is absent from `resolved`, so the row badge reads
    // UNKNOWN for it rather than "has not voted".
    expect(store.state.yourVotes.resolved).toEqual(['a0#0', 'a1#0']);
    // Two known-unvoted, and the third is not guessed at.
    expect(awaitingVoteCount(store.state.yourVotes)).toBe(2);
  });

  it('scans open actions only, and never more than the cap', async () => {
    seedActions(MAX_VOTE_SCAN + 5, [{ govActionId: 'settled#0', status: 'enacted' }]);
    vi.mocked(governanceApi.getProposalVotes).mockResolvedValue(votesPage([]));

    await store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'self' });

    expect(governanceApi.getProposalVotes).toHaveBeenCalledTimes(MAX_VOTE_SCAN);
    expect(store.state.yourVotes.scanned).toBe(MAX_VOTE_SCAN);
    const scanned = vi.mocked(governanceApi.getProposalVotes).mock.calls.map(c => c[0]);
    expect(scanned).not.toContain('settled#0');
  });

  it('is ready with nothing awaiting when no action is open', async () => {
    seedActions(0, [{ govActionId: 'settled#0', status: 'expired' }]);

    await store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'self' });

    expect(governanceApi.getProposalVotes).not.toHaveBeenCalled();
    expect(store.state.yourVotes.status).toBe('ready');
    expect(awaitingVoteCount(store.state.yourVotes)).toBe(0);
  });

  it('clears a previous scan on reset', async () => {
    seedActions(1);
    vi.mocked(governanceApi.getProposalVotes).mockResolvedValue(
      votesPage([{ drepId: DREP_BECH32, vote: 'No' }]),
    );
    await store.loadYourVotes('Mainnet', { drepId: DREP_BECH32, kind: 'self' });
    expect(store.state.yourVotes.byAction).not.toEqual({});

    store.reset();

    expect(store.state.yourVotes.status).toBe('idle');
    expect(store.state.yourVotes.byAction).toEqual({});
    expect(store.state.yourVotes.identityKind).toBeNull();
  });
});
