// Two guarantees about the Overview tab's prose and its reference list, both of
// which were broken and both of which are invisible to a unit test of the
// renderer alone, because they only exist where the two meet in the DOM:
//
//  1. An inline `[n]` marker is a CONTROL, not a `#gov-ref-n` link. The
//     extension runs a hash-mode router, so a bare fragment href does not
//     scroll — it overwrites the route in the address bar, and reloading that
//     address hits the catch-all and redirects to the wallet home with the
//     proposal gone.
//  2. The list renders the ORIGINAL reference numbers. A `<ol>` counting 1..n
//     renumbers the survivors, so with reference 1 dropped as unsafe a prose
//     [2] marker points at an entry the reader sees labelled "1.".
//
// Everything with a network call, a router or a heavy child behind it is
// mocked; the prose, the reference list and the click wiring are the subject.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const getProposal = vi.fn();
const getVotingSummary = vi.fn();
const getProposalVotes = vi.fn();
const getCommittee = vi.fn();

vi.mock('@/api/governance-api', () => ({
  default: {
    listProposals: vi.fn(),
    getProposal: (...args: unknown[]) => getProposal(...args),
    getVotingSummary: (...args: unknown[]) => getVotingSummary(...args),
    getProposalVotes: (...args: unknown[]) => getProposalVotes(...args),
    getCommittee: (...args: unknown[]) => getCommittee(...args),
  },
}));

vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: vi.fn() } }));

/** Which tab the mocked route is on. Mutable so a case can open the Votes tab. */
const routeQuery = vi.hoisted(() => ({ value: {} as Record<string, string> }));

vi.mock('vue-router/composables', () => ({
  useRoute: () => ({ params: { txHash: 'aa'.repeat(32), index: '0' }, query: routeQuery.value }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Every child that would drag a store, an API or a dialog in. Each factory is
// spelled out rather than sharing a helper: vi.mock factories are hoisted above
// every binding in this file, so a shared `stubSfc` would not exist yet.
vi.mock('@/modules/governance/components/actions/PositionsPanel.vue', () => ({
  default: { name: 'PositionsPanel', props: ['presetRole', 'committeeNames', 'votes'], render: () => null },
}));
// This one renders a real element rather than null: where the cards SIT is what
// the layout cases are about, and a component that renders nothing cannot be
// found inside the rail.
vi.mock('@/modules/governance/components/actions/BodyTallyCard.vue', () => ({
  default: {
    name: 'BodyTallyCard',
    props: ['result', 'composition', 'counts', 'thresholdNote'],
    render(h: (tag: string, data: Record<string, unknown>) => unknown) {
      return h('div', { class: 'body-card' });
    },
  },
}));
vi.mock('@/modules/governance/components/actions/StatusPill.vue', () => ({
  default: { name: 'StatusPill', props: ['status'], render: () => null },
}));
vi.mock('@/modules/governance/components/actions/AnchorBadge.vue', () => ({
  default: { name: 'AnchorBadge', render: () => null },
}));
vi.mock('@/modules/governance/components/actions/AsOf.vue', () => ({
  default: { name: 'AsOf', props: ['timestamp'], render: () => null },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import ActionDetail from './ActionDetail.vue';
import governanceActionsStore, { resetCommitteeCache } from '@/stores/governanceActionsStore';
import { walletStore } from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';

const $t = (key: string): string => key;

// Read beside this spec, not via `new URL('./x', import.meta.url)`: the
// happy-dom environment resolves that against the document base and hands back
// an http: URL.
const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ActionDetail.vue'), 'utf8');

/** The declaration block of one top-level rule in the scoped stylesheet. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(SOURCE);
  expect(match, `no CSS rule for ${selector}`).not.toBeNull();
  return (match as RegExpExecArray)[1];
}

/**
 * Everything inside one `@media` block. Read as a slice rather than by regex:
 * the block holds whole rules, so the first `}` is the end of a rule, not of the
 * block — it ends at the brace that closes it in column 0.
 */
function mediaBlock(query: string): string {
  const start = SOURCE.indexOf(`@media ${query}`);
  expect(start, `no @media ${query} block`).toBeGreaterThan(-1);
  const rest = SOURCE.slice(start);
  return rest.slice(0, rest.indexOf('\n}'));
}

/**
 * Reference 1 is `ipfs://`, which the safe-URL guard drops, so only reference 2
 * survives — the exact shape both bugs need to be visible.
 */
function detail(over: Record<string, unknown> = {}) {
  return {
    govActionId: 'gov_action1test#0',
    txHash: 'aa'.repeat(32),
    index: 0,
    type: 'InfoAction',
    status: 'active',
    submittedEpoch: 650,
    expiresEpoch: 660,
    anchorUrl: null,
    title: 'A test action',
    deposit: null,
    govAction: null,
    rawMetadata: {},
    abstractText: 'Backed by [1] and by [2].',
    motivation: null,
    rationale: null,
    references: [
      { uri: 'ipfs://QmDropped', label: 'Dropped as unsafe' },
      { uri: 'https://b.test/paper', label: 'The paper' },
    ],
    authors: null,
    hashValid: null,
    ...over,
  };
}

/** Enough of a voting summary for the recorded-positions card to have something to say. */
function summary(over: Record<string, unknown> = {}) {
  return { yesVotesCast: 3, noVotesCast: 1, abstainVotesCast: 0, ...over } as never;
}

function mountPage(): Wrapper<Vue> {
  return mount(ActionDetail, {
    attachTo: document.body,
    mocks: { $t },
    stubs: {
      'v-icon': true,
      'v-skeleton-loader': true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

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
  // The committee is cached for the session, so one case's committee would
  // otherwise still be in hand for the next.
  resetCommitteeCache();
  routeQuery.value = {};
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet' } as never;
  walletStore.keys = null;
  walletStore.account = null as never;
  getProposal.mockResolvedValue(detail());
  getVotingSummary.mockResolvedValue(null);
  getProposalVotes.mockResolvedValue({ items: [], page: 1, pageSize: 200, total: 0 });
  getCommittee.mockResolvedValue(null);
  vi.spyOn(NetworkStore, 'getCurrentEpoch').mockReturnValue(650);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  vi.restoreAllMocks();
});

describe('ActionDetail references', () => {
  it('renders the original reference number, not a renumbered 1', async () => {
    wrapper = mountPage();
    await settle();

    const items = wrapper.findAll('.action-detail__reference');
    expect(items).toHaveLength(1);
    // The one survivor is the author's SECOND reference, and says so, so the
    // prose marker and the list label agree.
    expect(items.at(0).attributes('value')).toBe('2');
    expect(items.at(0).attributes('id')).toBe('gov-ref-2');
  });

  it('renders a [n] marker as a button, never as a fragment link', async () => {
    wrapper = mountPage();
    await settle();

    const marker = wrapper.find('.md-ref');
    expect(marker.exists()).toBe(true);
    expect(marker.element.tagName).toBe('BUTTON');
    expect(marker.attributes('data-md-ref')).toBe('2');
    // A hash-mode router would read this as a route, not a fragment.
    expect(wrapper.html()).not.toContain('#gov-ref-2');
  });

  it('leaves the marker of a dropped reference as plain text', async () => {
    wrapper = mountPage();
    await settle();

    // Reference 1 was ipfs:// and never became a link, so [1] must not look
    // pressable — exactly one control in the prose, and it is [2].
    expect(wrapper.findAll('.md-ref')).toHaveLength(1);
    expect(wrapper.find('.g-prose').text()).toContain('[1]');
  });

  it('jumps to the entry on activation without touching the address bar', async () => {
    wrapper = mountPage();
    await settle();

    const before = window.location.hash;
    const target = document.getElementById('gov-ref-2') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    // Dispatched rather than called directly: the listener is DELEGATED to the
    // view root, which is the whole point — the markers live inside `v-html`,
    // where the renderer may not emit an inline handler. A <button> also turns
    // Enter and Space into this same click, with no key handler of our own.
    wrapper.find('.md-ref').element.dispatchEvent(new Event('click', { bubbles: true }));
    await Vue.nextTick();

    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(target);
    expect(target.classList.contains('action-detail__reference--jumped')).toBe(true);
    expect(window.location.hash).toBe(before);
  });
});

// The Overview tab is prose on the left and a rail on the right, and the rail is
// one vertical stack: every voting body's tally, then the recorded positions
// with their jump into the Votes tab. The layout lives in the scoped stylesheet,
// which vitest does not apply in happy-dom, so the grid itself is asserted
// against the file — after the DOM has confirmed what is inside the rail.
describe('ActionDetail overview rail', () => {
  it('stacks every voting body in the rail, above the recorded positions', async () => {
    // A treasury withdrawal is decided by DReps AND the committee.
    getProposal.mockResolvedValue(detail({ type: 'TreasuryWithdrawals' }));
    getVotingSummary.mockResolvedValue(summary());
    wrapper = mountPage();
    await settle();

    const rail = wrapper.find('.action-detail__rail');
    expect(rail.exists()).toBe(true);
    // Both cards are IN the rail, not in a band above the prose.
    expect(wrapper.findAllComponents({ name: 'BodyTallyCard' })).toHaveLength(2);
    expect(rail.findAll('.body-card')).toHaveLength(2);
    expect(wrapper.find('.action-detail__tallies').exists()).toBe(false);

    // Tallies first, the positions card last: the summary is read before the
    // buttons that lead away from it.
    const order = wrapper.findAll('.action-detail__rail > *').wrappers.map(cell => cell.classes().join(' '));
    expect(order).toEqual(['body-card', 'body-card', 'action-detail__rail-card glass-panel']);

    const grid = rule('.action-detail__overview-grid');
    expect(grid).toMatch(/display:\s*grid/);
    // A fixed narrow track for the rail, so the prose takes the extra width.
    expect(grid).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+300px/);
    expect(rule('.action-detail__rail')).toMatch(/flex-direction:\s*column/);
  });

  it('keeps the rail in view while a long proposal scrolls past', async () => {
    const declarations = rule('.action-detail__rail');
    expect(declarations).toMatch(/position:\s*sticky/);
    // A three-body action's stack can be taller than the window, and a sticky
    // element taller than the viewport strands its own foot.
    expect(declarations).toMatch(/max-height:\s*calc\(100vh/);
    expect(declarations).toMatch(/overflow-y:\s*auto/);
  });

  it('collapses to one column and leads with the rail on a narrow viewport', async () => {
    // The popup and the side panel are ~380px wide. One column there, with the
    // rail ABOVE the prose: stacked after it, the tally and the "see the votes"
    // buttons would sit below the entire proposal document.
    const narrow = mediaBlock('(max-width: 1100px)');
    expect(narrow).toMatch(/\.action-detail__overview-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(narrow).toMatch(/\.action-detail__rail\s*\{[^}]*order:\s*-1/);
    // Nothing to stick beside once the second column is gone.
    expect(narrow).toMatch(/\.action-detail__rail\s*\{[^}]*position:\s*static/);
  });

  it('keeps the advisory panel, and no tally at all, for an info action', async () => {
    // InfoAction has no threshold and can never ratify, so there is nothing to
    // tally and no rail to reserve a gutter for.
    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.action-detail__advisory').exists()).toBe(true);
    expect(wrapper.findAllComponents({ name: 'BodyTallyCard' })).toHaveLength(0);
    expect(wrapper.find('.action-detail__rail').exists()).toBe(false);
    expect(wrapper.find('.action-detail__tallies').exists()).toBe(false);
    // A 300px empty gutter would read as something that failed to load.
    expect(wrapper.find('.action-detail__overview-grid').classes()).toContain(
      'action-detail__overview-grid--single',
    );
    expect(rule('.action-detail__overview-grid--single')).toMatch(
      /grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  it('still shows the tallies when an action has no recorded positions card', async () => {
    // A summary that never came back costs the positions card, not the rail.
    getProposal.mockResolvedValue(detail({ type: 'TreasuryWithdrawals' }));
    getVotingSummary.mockResolvedValue(null);
    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.action-detail__rail').exists()).toBe(true);
    expect(wrapper.findAll('.action-detail__rail-card')).toHaveLength(0);
    expect(wrapper.findAllComponents({ name: 'BodyTallyCard' })).toHaveLength(2);
  });

  it('states the rough expiry day beside the epoch count', async () => {
    wrapper = mountPage();
    await settle();

    // Current epoch 650, expires 660: ten epochs, and a date to go with them.
    expect(wrapper.html()).toContain('governance.epochsRemaining');
    expect(wrapper.html()).toContain('governance.approxExpiryDate');
  });

  it('states no expiry day when the current epoch is unknown', async () => {
    (NetworkStore.getCurrentEpoch as unknown as Mock).mockReturnValue(null);
    wrapper = mountPage();
    await settle();

    expect(wrapper.html()).not.toContain('governance.approxExpiryDate');
    // The epoch the chain published is still a fact and still renders.
    expect(wrapper.html()).toContain('governance.expiresEpochLabel');
  });
});

// A committee row on the Votes tab shows a hash unless the committee names the
// member. The view loads that committee for the network it is on, once, and
// hands the votes panel an index — never a placeholder, and never a name it
// inferred from anything else.
describe('ActionDetail committee names', () => {
  /** A real mainnet member: cold credential, script-based, mid-term. */
  const MEMBER = {
    hash: '1980dbf1ad624b0cb5410359b5ab14d008561994a6c2b6c53fabec00',
    credType: 'SCRIPTHASH',
    startEpoch: 581,
    expiredEpoch: 726,
  };

  function openVotesTab(): void {
    routeQuery.value = { tab: 'positions' };
  }

  function panelNames(): ReadonlyMap<string, string> {
    return wrapper?.findComponent({ name: 'PositionsPanel' }).props('committeeNames') as ReadonlyMap<
      string,
      string
    >;
  }

  it('hands the votes panel the name of a member the committee names', async () => {
    openVotesTab();
    getCommittee.mockResolvedValue({
      thresholdNumerator: 2,
      thresholdDenominator: 3,
      members: [{ ...MEMBER, displayName: 'Tingvard' }],
    });
    wrapper = mountPage();
    await settle();

    // The wallet's own network value; the client maps it to Nexus's slug.
    expect(getCommittee).toHaveBeenCalledWith('Mainnet');
    expect(panelNames().get(MEMBER.hash)).toBe('Tingvard');
  });

  it('hands it nothing when the projection carries no names', async () => {
    // The live shape today: four fields, no `displayName`. Every committee row
    // then renders its hash, which is the honest answer.
    openVotesTab();
    getCommittee.mockResolvedValue({ thresholdNumerator: 2, thresholdDenominator: 3, members: [MEMBER] });
    wrapper = mountPage();
    await settle();

    expect(panelNames().size).toBe(0);
  });

  it('asks for the committee once however many actions are opened', async () => {
    // It changes at most once a term, and the detail view asks on every action.
    wrapper = mountPage();
    await settle();
    wrapper.destroy();
    wrapper = mountPage();
    await settle();

    expect(getCommittee).toHaveBeenCalledTimes(1);
  });

  it('costs only the names when the committee cannot be read', async () => {
    openVotesTab();
    getCommittee.mockRejectedValue(new Error('committee endpoint down'));
    wrapper = mountPage();
    await settle();

    expect(panelNames().size).toBe(0);
    // The action itself is unaffected: names are a courtesy on this surface.
    expect(wrapper.find('.action-detail__title').text()).toBe('A test action');
    expect(wrapper.find('.action-detail__body').exists()).toBe(true);
  });
});
