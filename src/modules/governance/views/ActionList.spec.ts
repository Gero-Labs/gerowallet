// The stat strip is a projection of the votes join, and the only thing worth
// pinning down about it is HONESTY: an unreachable votes endpoint must read as
// "not available", never as "0 actions awaiting your vote". That difference is
// the whole reason the store distinguishes `unavailable` from `ready`, and this
// file proves the view actually carries the distinction through to the DOM.
//
// Everything with a network call or a router behind it is mocked. The Vuetify
// layer is stubbed; GButton / EmptyState / ErrorState are `<script setup>`
// imports that Vue 2.7 resolves lexically, so they render for real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const listProposals = vi.fn();
const getProposalVotes = vi.fn();

vi.mock('@/api/governance-api', () => ({
  default: {
    listProposals: (...args: unknown[]) => listProposals(...args),
    getProposal: vi.fn(),
    getVotingSummary: vi.fn(),
    getProposalVotes: (...args: unknown[]) => getProposalVotes(...args),
  },
}));

const getDRepById = vi.fn();
vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepById: (...args: unknown[]) => getDRepById(...args) },
}));

vi.mock('@/modules/governance/dialogs/CastVoteDialog.vue', () => ({
  default: { name: 'CastVoteDialog', props: ['isOpen', 'actions'], render: () => null },
}));

vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: vi.fn() }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import ActionList from './ActionList.vue';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { walletStore } from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import { toCip129 } from '@/shared/utils/drepId';

/** Echoes params so a wrong interpolated number cannot hide inside the key. */
const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const DREP = 'drep1ytjyvm958ywjkp57f8wm3havj72lc653tp7ajttxxt6ftgcmcmdk2';

/**
 * This wallet's OWN DRep key, deliberately a different credential from the one
 * it delegated to, so the identity assertions below can only pass by picking
 * the right one rather than by the two ids happening to coincide.
 */
const OWN_DREP = toCip129('11'.repeat(28)) as string;

/** Give the wallet a derived DRep key, as a real Cardano wallet always has. */
function withOwnDRepKey(): void {
  walletStore.keys = { drep129: [{ address: OWN_DREP }] } as never;
}

function proposal(id: string, over: Record<string, unknown> = {}) {
  return {
    govActionId: id,
    txHash: id.split('#')[0].padEnd(64, '0'),
    index: 0,
    type: 'InfoAction',
    status: 'active',
    expiresEpoch: 660,
    anchorUrl: 'https://example.test/a.json',
    title: `Action ${id}`,
    ...over,
  };
}

function votesPage(rows: Array<{ drepId: string; vote: string }>) {
  return {
    items: rows.map(r => ({ voterRole: 'DRep', voterHash: null, txHash: null, ...r })),
    page: 1,
    pageSize: 200,
    total: rows.length,
  };
}

function mountPage(): Wrapper<Vue> {
  return mount(ActionList, {
    mocks: { $t },
    stubs: {
      'v-icon': true,
      'v-chip': true,
      'v-chip-group': true,
      'v-skeleton-loader': true,
      'v-pagination': true,
      AsOf: true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/** Let the mounted list fetch and the votes join that follows it both settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Vue.nextTick();
  }
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  governanceActionsStore.reset();
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet', stakeAddress: 'stake1uexample' } as never;
  walletStore.keys = null;
  walletStore.account = { drep_id: DREP } as never;
  getDRepById.mockResolvedValue(null);
  // Current epoch 650 against expiry 660 = 10 epochs = about 50 days.
  vi.spyOn(NetworkStore, 'getCurrentEpoch').mockReturnValue(650);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('ActionList stat strip', () => {
  it('reports the awaiting count as not available when the votes endpoint is down', async () => {
    listProposals.mockResolvedValue({
      items: [proposal('a#0'), proposal('b#0')],
      page: 1,
      pageSize: 50,
      total: 2,
    });
    // This is the live production case: /api/governance/* still 404s.
    getProposalVotes.mockRejectedValue(new Error('404 Not Found'));

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.stats.voteCheckUnavailable');
    // The open count is real and must still render...
    expect(html).toContain('governance.stats.open');
    // ...but the awaiting figure must NOT have become a zero.
    expect(governanceActionsStore.state.yourVotes.status).toBe('unavailable');
    expect(html).toContain('common.notAvailable');
  });

  it('counts the open actions this wallet has not voted on', async () => {
    listProposals.mockResolvedValue({
      items: [proposal('a#0'), proposal('b#0'), proposal('c#0', { status: 'enacted' })],
      page: 1,
      pageSize: 50,
      total: 3,
    });
    getProposalVotes.mockImplementation(async (govActionId: string) =>
      govActionId === 'a#0' ? votesPage([{ drepId: DREP, vote: 'Yes' }]) : votesPage([]),
    );

    wrapper = mountPage();
    await settle();

    expect(governanceActionsStore.state.yourVotes.status).toBe('ready');
    // Two open, one voted, so exactly one awaits. The settled action is neither
    // scanned nor counted as open.
    expect(governanceActionsStore.state.yourVotes.scanned).toBe(2);
    const html = wrapper.html();
    expect(html).toContain('governance.stats.awaitingYourDRep');
    expect(html).not.toContain('governance.stats.voteCheckUnavailable');
  });

  it('labels the badge for the delegating wallet, not for a self-DRep', async () => {
    listProposals.mockResolvedValue({ items: [proposal('a#0')], page: 1, pageSize: 50, total: 1 });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    // The wallet delegated to someone: it is the DRep that has not voted.
    expect(html).toContain('governance.yourDRepHasntVoted');
    expect(html).not.toContain('governance.youHaventVoted');
  });

  it('says nothing about votes at all when the wallet has no DRep', async () => {
    walletStore.account = { drep_id: '' } as never;
    listProposals.mockResolvedValue({ items: [proposal('a#0')], page: 1, pageSize: 50, total: 1 });

    wrapper = mountPage();
    await settle();

    expect(getProposalVotes).not.toHaveBeenCalled();
    const html = wrapper.html();
    expect(html).toContain('governance.stats.noVotingIdentity');
    // No badge is claimed on the row either way.
    expect(html).not.toContain('governance.yourDRepHasntVoted');
    expect(html).not.toContain('governance.youHaventVoted');
  });

  it('makes no votes request for the predefined always-abstain DRep', async () => {
    walletStore.account = { drep_id: 'drep_always_abstain' } as never;
    listProposals.mockResolvedValue({ items: [proposal('a#0')], page: 1, pageSize: 50, total: 1 });

    wrapper = mountPage();
    await settle();

    // The keyword DReps cast no votes, so there is nothing to join against.
    expect(getProposalVotes).not.toHaveBeenCalled();
  });

  it('tints the days-left chip only once the action is actually closing soon', async () => {
    listProposals.mockResolvedValue({
      items: [
        // 651 - 650 = 1 epoch = about 5 days: closing soon.
        proposal('soon#0', { expiresEpoch: 651 }),
        // 660 - 650 = 10 epochs = about 50 days: not soon.
        proposal('later#0', { expiresEpoch: 660 }),
      ],
      page: 1,
      pageSize: 50,
      total: 2,
    });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    expect(wrapper.findAll('.action-row__chip--warn')).toHaveLength(1);
    const html = wrapper.html();
    expect(html).toContain('governance.approxDaysLeft:{"n":5}');
    expect(html).toContain('governance.approxDaysLeft:{"n":50}');
    // One of the two is inside the 15-day window.
    expect(html).toContain('governance.stats.closingWithin:{"n":15}');
  });

  // A DRep that retired still returns a row, carrying `registered: false`.
  // Treating the row's mere presence as registration would hand a retired user
  // the self-DRep identity and the batch-voting affordance that goes with it,
  // for votes the chain would reject.
  it('votes as itself when this wallet\'s own DRep is registered', async () => {
    withOwnDRepKey();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    listProposals.mockResolvedValue({ items: [proposal('a#0')], page: 1, pageSize: 50, total: 1 });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    expect(governanceActionsStore.state.yourVotes.identityKind).toBe('self');
    // The join runs against the wallet's OWN key, not the one it delegated to.
    expect(wrapper.html()).toContain('governance.youHaventVoted');
    expect(wrapper.html()).not.toContain('governance.yourDRepHasntVoted');
  });

  it('does not treat a RETIRED own DRep as a voting identity', async () => {
    withOwnDRepKey();
    // The retirement case: a row comes back, but registration is gone.
    getDRepById.mockResolvedValue({ registered: false, votes: [] });
    listProposals.mockResolvedValue({ items: [proposal('a#0')], page: 1, pageSize: 50, total: 1 });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    // Falls through to the DRep this wallet delegated to, which is the honest
    // remaining fact about where its stake stands.
    expect(governanceActionsStore.state.yourVotes.identityKind).toBe('delegated');
    const html = wrapper.html();
    expect(html).toContain('governance.yourDRepHasntVoted');
    expect(html).not.toContain('governance.youHaventVoted');
    // Batch selection hangs off this same flag, so it is withheld too. Not
    // asserted here: `isGovernanceVotingEnabled` defaults to false in tests, so
    // a checkbox assertion would pass no matter what this fix did.
  });

  it('does not treat an own DRep with no registration field as registered', async () => {
    withOwnDRepKey();
    // The endpoint is untyped upstream and every field has been seen absent.
    // Absent must not read as registered.
    getDRepById.mockResolvedValue({ votes: [] });
    listProposals.mockResolvedValue({ items: [proposal('a#0')], page: 1, pageSize: 50, total: 1 });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    expect(governanceActionsStore.state.yourVotes.identityKind).toBe('delegated');
  });

  // The board's job is "what needs you next", so the page is reordered for
  // reading: live first, soonest to close at the top. `orderActions` owns the
  // rule (ordering.spec.ts); this proves the view actually applies it, and says
  // so to the reader rather than letting it look like the chain's own order.
  it('lists live actions above concluded ones, soonest to expire first', async () => {
    listProposals.mockResolvedValue({
      items: [
        proposal('decided#0', { status: 'enacted', submittedEpoch: 640, title: 'Decided' }),
        proposal('later#0', { expiresEpoch: 680, title: 'Later' }),
        proposal('soonest#0', { expiresEpoch: 652, title: 'Soonest' }),
      ],
      page: 1,
      pageSize: 50,
      total: 3,
    });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    const titles = wrapper.findAll('.action-row__title').wrappers.map(row => row.text());
    expect(titles).toEqual(['Soonest', 'Later', 'Decided']);
    // The ordering is only ever this PAGE's ordering, and the note says so.
    expect(wrapper.html()).toContain('governance.actionsOrderNote');
  });

  it('quiets the concluded rows and leaves the live ones at full weight', async () => {
    listProposals.mockResolvedValue({
      items: [
        proposal('live#0'),
        proposal('gone#0', { status: 'expired' }),
        proposal('done#0', { status: 'enacted' }),
      ],
      page: 1,
      pageSize: 50,
      total: 3,
    });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    expect(wrapper.findAll('.action-row')).toHaveLength(3);
    const quiet = wrapper.findAll('.action-row--concluded');
    expect(quiet).toHaveLength(2);
    // Never tone alone: each quiet row still carries its status in words.
    // (`$t` echoes the key here, which StatusPill reads as a missing
    // translation and falls back to the raw status — still a word.)
    const labels = quiet.wrappers.map(row => row.find('.status-pill').text()).sort();
    expect(labels).toEqual(['enacted', 'expired']);
  });

  it('shows an approximate expiry date beside the epoch count, and none without an epoch', async () => {
    listProposals.mockResolvedValue({
      items: [proposal('dated#0'), proposal('undated#0', { expiresEpoch: null })],
      page: 1,
      pageSize: 50,
      total: 2,
    });
    getProposalVotes.mockResolvedValue(votesPage([]));

    wrapper = mountPage();
    await settle();

    // One row knows when it expires; the other must state nothing at all.
    const dates = wrapper.findAll('.action-row__expires');
    expect(dates).toHaveLength(1);
    expect(dates.at(0).text()).toMatch(/\d{4}/);
    expect(wrapper.html()).toContain('governance.epochsRemaining:{"n":10}');
  });

  it('surfaces a retryable error instead of a strip full of zeroes', async () => {
    listProposals.mockRejectedValue(new Error('upstream down'));

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    expect(html).toContain('upstream down');
    // The strip is gone rather than reporting 0 open / 0 decided.
    expect(html).not.toContain('governance.stats.open');
  });
});
