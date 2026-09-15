// The product complaint this panel answers was "just a list of drep hashes".
// What is pinned below is the part that must not regress into a wrong CLAIM:
// the four your-DRep states, absent optional fields rendering as nothing rather
// than as a blank or a zero, and a capped list saying so out loud.
//
// The Vuetify layer is stubbed; GButton / EmptyState / ErrorState / VoteRow are
// `<script setup>` imports that Vue 2.7 resolves lexically, so they render for
// real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

const getDRepsPaginated = vi.fn();
// The dialog fetches from an author's host; these cases are about the panel,
// so it is a stub that records its props.
vi.mock('@/modules/governance/dialogs/RationaleDialog.vue', () => ({
  default: { name: 'RationaleDialog', props: ['isOpen', 'url', 'hash', 'subtitle'], render: () => null },
}));

vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepsPaginated: (...args: unknown[]) => getDRepsPaginated(...args) },
}));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import PositionsPanel from './PositionsPanel.vue';
import { resetDRepNameIndex } from './drepNames';
import { toCip129 } from '@/shared/utils/drepId';
import type { GovVote } from '@/api/governance.types';

/** Echoes params so a wrong interpolated number cannot hide inside the key. */
const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

const CRED_A = 'aa'.repeat(28);
const CRED_B = 'bb'.repeat(28);
const DREP_A = toCip129(CRED_A) as string;
const DREP_B = toCip129(CRED_B) as string;

function vote(over: Partial<GovVote> = {}): GovVote {
  return { voterRole: 'DRep', voterHash: CRED_A, drepId: DREP_A, vote: 'Yes', txHash: null, ...over };
}

/** A real mainnet committee hot credential — what a committee vote actually carries. */
const CC_HOT = '2ea7a78eb914d988b9d368ed88906f3bc9fc5421667dea6a366710ec';
/** A real CID, so the avatar's IPFS mapping is exercised rather than a stubbed one. */
const CID_V1 = 'bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u';

function committeeVote(over: Partial<GovVote> = {}): GovVote {
  return {
    voterRole: 'ConstitutionalCommittee',
    voterHash: CC_HOT,
    drepId: null,
    vote: 'Yes',
    txHash: null,
    ...over,
  };
}

function mountPanel(props: Record<string, unknown> = {}): Wrapper<Vue> {
  return mount(PositionsPanel, {
    mocks: { $t },
    // `loaded` defaults to false on the component, because an unfetched list
    // must not read as "nobody voted". Every case below that is ABOUT the
    // fetched list therefore says so; the not-yet-loaded case passes false.
    propsData: { votes: [vote()], total: 1, loaded: true, chain: 'Cardano', network: 'Mainnet', ...props },
    stubs: {
      'v-icon': true,
      'v-chip': true,
      'v-chip-group': true,
      'v-text-field': true,
      'v-skeleton-loader': true,
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/** Let the mounted panel's name lookup settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Vue.nextTick();
  }
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  resetDRepNameIndex();
  getDRepsPaginated.mockResolvedValue({ items: [], meta: { page: 1, total_items: 0, per_page: 500, total_pages: 1 } });
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
});

describe('PositionsPanel summary', () => {
  it('counts voters and says out loud that these are not the tally', async () => {
    wrapper = mountPanel({
      votes: [vote(), vote({ drepId: DREP_B, vote: 'No' }), vote({ drepId: null, voterRole: 'SPO', vote: 'Abstain' })],
      total: 3,
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsTitle');
    // The honesty line that keeps head counts from being read as stake weight.
    expect(html).toContain('governance.positionsCountsNote');
    // No percentage and no tally bar on this tab.
    expect(html).not.toContain('tally-bar');
  });

  it('offers no rationale affordance at all when the projection carries none', async () => {
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    const html = wrapper.html();
    expect(html).not.toContain('governance.rationaleCoverage');
    expect(html).not.toContain('governance.readWhy');
    // An absent field is silent — never "0 of 2 carry a rationale".
    expect(html).not.toContain('governance.rationaleExternalNote');
  });

  it('surfaces the rationale count and the external-fetch note once rationales exist', async () => {
    wrapper = mountPanel({
      votes: [vote({ rationaleUrl: 'https://example.test/why.json' }), vote({ drepId: DREP_B })],
      total: 2,
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.rationaleCoverage:{"n":1,"total":2}');
    expect(html).toContain('governance.rationaleExternalNote');
  });

  it('states the cap instead of silently showing a prefix', async () => {
    wrapper = mountPanel({ votes: [vote()], total: 238, truncated: true });
    await settle();

    expect(wrapper.html()).toContain('governance.positionsCapped:{"n":1,"total":238}');
  });

  it('finishes the sentence when upstream reports no total', async () => {
    // The store produces this state deliberately (a null total is "the server
    // does not count this list"), and "of ." is not something to render.
    wrapper = mountPanel({ votes: [vote()], total: null, truncated: true });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsCappedUnknownTotal:{"n":1}');
    expect(html).not.toContain('governance.positionsCapped:{');
  });

  it('offers an ipfs:// rationale like any other, since the dialog proxies it', async () => {
    // About a quarter of published rationales are ipfs://. The dialog fetches
    // those through gero-backend's proxy, so the affordance and the fetch note
    // apply to every published rationale, not only the http(s) ones.
    wrapper = mountPanel({
      votes: [vote({ rationaleUrl: 'ipfs://QmSomething' }), vote({ drepId: DREP_B })],
      total: 2,
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.rationaleCoverage:{"n":1,"total":2}');
    expect(html).toContain('governance.readWhy');
    expect(html).toContain('governance.rationaleExternalNote');
  });

  it('mounts the rationale dialog for the clicked row only, and only once clicked', async () => {
    // A request to an author's host must follow a click, never a render.
    wrapper = mountPanel({
      votes: [
        vote({ rationaleUrl: 'https://example.test/why.json', rationaleHash: 'ab'.repeat(32) }),
        vote({ drepId: DREP_B }),
      ],
      total: 2,
    });
    await settle();
    expect(wrapper.findComponent({ name: 'RationaleDialog' }).exists()).toBe(false);

    await wrapper.find('.vote-row__rationale').trigger('click');
    await Vue.nextTick();

    const dialog = wrapper.findComponent({ name: 'RationaleDialog' });
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('url')).toBe('https://example.test/why.json');
    expect(dialog.props('hash')).toBe('ab'.repeat(32));
    // No published name in this fixture, so the voter is named by id.
    expect(String(dialog.props('subtitle'))).toContain(DREP_A.slice(0, 6));

    dialog.vm.$emit('close');
    await Vue.nextTick();
    expect(wrapper.findComponent({ name: 'RationaleDialog' }).exists()).toBe(false);
  });
});

describe('PositionsPanel your-DRep callout', () => {
  it('shows the position when the delegated DRep is on the list', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_A, vote: 'Yes' })],
      total: 1,
      // Deliberately the raw credential: the wallet holds one id form and the
      // vote row carries another, and they must still match.
      identity: { drepId: CRED_A, kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.yourDRepPosition');
    expect(html).toContain('governance.yourStakeFollowed');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('says the DRep has not voted, and what that costs', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_B })],
      total: 1,
      identity: { drepId: DREP_A, kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.yourDRepNotVoted');
    expect(html).toContain('governance.uncastCountsAgainst');
  });

  it('refuses to claim "has not voted" from a truncated list', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_B })],
      total: 238,
      truncated: true,
      identity: { drepId: DREP_A, kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionUnknown');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('reads as first person when the wallet votes as its own DRep', async () => {
    wrapper = mountPanel({
      votes: [vote({ drepId: DREP_B })],
      total: 1,
      identity: { drepId: DREP_A, kind: 'self' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.yourPosition');
    expect(html).toContain('governance.youHaventVoted');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('calls a keyword delegation a standing position, not a missing vote', async () => {
    wrapper = mountPanel({
      votes: [vote()],
      total: 1,
      identity: { drepId: 'drep_always_abstain', kind: 'delegated' },
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.keywordNoPosition');
    expect(html).not.toContain('governance.yourDRepNotVoted');
  });

  it('renders one plain line, not an empty box, when nothing here is the user\'s', async () => {
    wrapper = mountPanel({ votes: [vote()], total: 1, identity: null });
    await settle();

    expect(wrapper.html()).toContain('governance.noDelegationNoPosition');
    expect(wrapper.find('.your-position').exists()).toBe(false);
  });

  it('does not state a delegation it has not read yet', async () => {
    // Same null identity, different fact: the account has not arrived. Saying
    // "you have not delegated" here is a claim about the user, made blind.
    wrapper = mountPanel({ votes: [vote()], total: 1, identity: null, identityUnknown: true });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.delegationNotLoaded');
    expect(html).not.toContain('governance.noDelegationNoPosition');
    expect(wrapper.find('.your-position').exists()).toBe(false);
  });
});

describe('PositionsPanel rows', () => {
  it('renders a date only where a block time actually arrived', async () => {
    wrapper = mountPanel({
      votes: [vote({ votedAt: 1787463005 }), vote({ drepId: DREP_B })],
      total: 2,
    });
    await settle();

    // One row has a date cell; the undated row has no cell at all rather than a
    // dash or an epoch-0 date.
    expect(wrapper.findAll('.vote-row__when')).toHaveLength(1);
    expect(wrapper.html()).not.toContain('1970');
  });

  it('marks a script voter only on an explicit true', async () => {
    wrapper = mountPanel({
      votes: [vote({ hasScript: true }), vote({ drepId: DREP_B, hasScript: null })],
      total: 2,
    });
    await settle();

    expect(wrapper.html().match(/governance\.scriptVoter\b/g) ?? []).toHaveLength(1);
  });

  it('shows a published name and keeps the id, falling back to the id alone', async () => {
    getDRepsPaginated.mockResolvedValue({
      items: [{ drep_id: DREP_A, metadata: { meta_json: { body: { givenName: 'CryptoCrow' } } } }],
      meta: { page: 1, total_items: 1, per_page: 500, total_pages: 1 },
    });
    wrapper = mountPanel({ votes: [vote({ drepId: DREP_A }), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    const rows = wrapper.findAll('.vote-row');
    expect(rows.at(0).text()).toContain('CryptoCrow');
    // The named row keeps its id on the second line...
    expect(rows.at(0).find('.vote-row__id').exists()).toBe(true);
    // ...and the unnamed one is the truncated id alone, never a placeholder
    // identity and never a second name line standing empty.
    expect(rows.at(1).find('.vote-row__id').exists()).toBe(false);
    expect(rows.at(1).find('.vote-row__name').text()).toMatch(/^drep1.*…?.*$/);
    expect(rows.at(1).text()).not.toContain('CryptoCrow');
    // One directory request for the whole list, never one per row.
    expect(getDRepsPaginated).toHaveBeenCalledTimes(1);
  });

  it('walks the whole directory so a name past page 1 still resolves', async () => {
    // Mainnet passed 1,682 registered DReps against a 500-row page, so one page
    // left most voters unnamed and the rows fell back to the hex ids this index
    // exists to remove. The walk is per PAGE, never per row.
    getDRepsPaginated.mockImplementation((params: { page?: number }) =>
      Promise.resolve({
        items:
          (params?.page ?? 1) === 1
            ? [{ drep_id: DREP_B, metadata: { meta_json: { body: { givenName: 'FirstPage' } } } }]
            : [{ drep_id: DREP_A, metadata: { meta_json: { body: { givenName: 'CryptoCrow' } } } }],
        meta: { page: params?.page ?? 1, total_items: 600, per_page: 500, total_pages: 2 },
      }),
    );
    wrapper = mountPanel({ votes: [vote({ drepId: DREP_A })], total: 1 });
    await settle();
    await settle();

    expect(getDRepsPaginated).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.vote-row').at(0).text()).toContain('CryptoCrow');
  });

  it('follows a server that clamps the page size instead of trusting what it asked for', async () => {
    // `per_page=500` is a request, not a contract. Here the server echoes the
    // ask, answers with two rows a page, and sends only `total_items` — so
    // dividing the register by the size REQUESTED computes one page, and the
    // walk stops before the row that needed naming. The stride comes from the
    // rows page 1 actually returned instead.
    const other = (hex: string) => ({ drep_id: toCip129(hex.repeat(28)), metadata: null });
    const byPage: Record<number, unknown[]> = {
      1: [other('cc'), other('dd')],
      2: [other('ee'), other('11')],
      3: [{ drep_id: DREP_A, metadata: { meta_json: { body: { givenName: 'CryptoCrow' } } } }, other('22')],
    };
    getDRepsPaginated.mockImplementation((params: { page?: number }) =>
      Promise.resolve({
        items: byPage[params?.page ?? 1] ?? [],
        meta: { page: params?.page ?? 1, total_items: 6, per_page: 500 },
      }),
    );
    wrapper = mountPanel({ votes: [vote({ drepId: DREP_A })], total: 1 });
    await settle();
    await settle();

    expect(getDRepsPaginated).toHaveBeenCalledTimes(3);
    expect(wrapper.findAll('.vote-row').at(0).text()).toContain('CryptoCrow');
  });

  it('gives the vote date to assistive tech as text, not as a dead attribute', async () => {
    // `aria-label` on a plain <span> has no role to attach to and is dropped.
    wrapper = mountPanel({ votes: [vote({ votedAt: 1787463005 })], total: 1 });
    await settle();

    const when = wrapper.find('.vote-row__when');
    expect(when.element.tagName).toBe('TIME');
    expect(when.attributes('aria-label')).toBeUndefined();
    expect(when.attributes('datetime')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(when.text()).toContain('governance.votedOn');
  });

  it('shows a DRep avatar the DRep published on ipfs, not the anonymous glyph', async () => {
    // Half of mainnet's avatars are `ipfs://`, and the index used to drop them
    // before the avatar could map them onto the backend proxy — so a DRep with
    // a picture rendered as one without.
    getDRepsPaginated.mockResolvedValue({
      items: [
        {
          drep_id: DREP_A,
          metadata: { meta_json: { body: { givenName: 'CryptoCrow', image: { contentUrl: `ipfs://${CID_V1}` } } } },
        },
      ],
      meta: { page: 1, total_items: 1, per_page: 500, total_pages: 1 },
    });
    wrapper = mountPanel({ votes: [vote({ drepId: DREP_A })], total: 1 });
    await settle();

    const img = wrapper.find('.vote-row__avatar img');
    expect(img.exists()).toBe(true);
    expect(img.attributes('src')).toContain(`/api/ipfs?path=${CID_V1}`);
  });

  it('names a committee member from the committee, and keeps their hash', async () => {
    wrapper = mountPanel({
      votes: [committeeVote()],
      total: 1,
      committeeNames: new Map([[CC_HOT, 'Tingvard']]),
    });
    await settle();

    const row = wrapper.findAll('.vote-row').at(0);
    expect(row.find('.vote-row__name').text()).toBe('Tingvard');
    // Named rows keep the id beside the name; the avatar becomes the initial,
    // exactly as it does for a DRep with no published picture.
    expect(row.find('.vote-row__id').exists()).toBe(true);
    expect(row.find('.drep-avatar__initial').text()).toBe('T');
    // A member is not a DRep: no profile to route to.
    expect(row.find('.vote-row__name--link').exists()).toBe(false);
  });

  it('leaves a member the committee does not name on their hash', async () => {
    // Both live cases land here: a projection that sends no `displayName`, and
    // a voter whose hot credential is not in the current committee at all.
    wrapper = mountPanel({ votes: [committeeVote()], total: 1, committeeNames: new Map() });
    await settle();

    const row = wrapper.findAll('.vote-row').at(0);
    expect(row.find('.vote-row__name').text()).toContain(CC_HOT.slice(0, 6));
    expect(row.find('.vote-row__id').exists()).toBe(false);
    expect(row.find('.drep-avatar__initial').exists()).toBe(false);
  });

  it('never lends a DRep name to a committee row that shares its hash', async () => {
    // Two registers, one hash. Crossing them would put a DRep's name and face
    // on a committee member's vote.
    getDRepsPaginated.mockResolvedValue({
      items: [{ drep_id: toCip129(CC_HOT), metadata: { meta_json: { body: { givenName: 'CryptoCrow' } } } }],
      meta: { page: 1, total_items: 1, per_page: 500, total_pages: 1 },
    });
    wrapper = mountPanel({ votes: [committeeVote()], total: 1, committeeNames: new Map() });
    await settle();

    expect(wrapper.findAll('.vote-row').at(0).text()).not.toContain('CryptoCrow');
  });

  it('still renders every row when the name lookup fails outright', async () => {
    getDRepsPaginated.mockRejectedValue(new Error('directory down'));
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    expect(wrapper.findAll('.vote-row')).toHaveLength(2);
  });
});

describe('PositionsPanel states', () => {
  it('separates a failed lookup from an action nobody voted on', async () => {
    wrapper = mountPanel({ votes: [], total: null, error: 'upstream down' });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsLoadFailed');
    expect(html).not.toContain('governance.noVotesYet');
  });

  it('does not report an empty list it never fetched as "nobody voted"', async () => {
    // Not-yet-loaded, loaded-and-empty and failed are three different facts.
    // The store carries `votesLoaded` for exactly this, and the panel now reads
    // it instead of treating any empty array as an answer.
    wrapper = mountPanel({ votes: [], total: null, loaded: false, actionOpen: true });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsNotLoaded');
    expect(html).toContain('governance.loadPositions');
    expect(html).not.toContain('governance.noVotesYet');
  });

  it('offers a way out of the not-loaded state rather than a dead end', async () => {
    wrapper = mountPanel({ votes: [], total: null, loaded: false });
    await settle();

    await wrapper.find('.positions__more button').trigger('click');
    expect(wrapper.emitted('retry')).toBeTruthy();
  });

  it('invites the reader back when an open action has no positions yet', async () => {
    wrapper = mountPanel({ votes: [], total: 0, actionOpen: true });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.noVotesYet');
    expect(html).toContain('governance.noVotesYetOpen');
  });

  it('says nothing about "still open" once the action has closed', async () => {
    wrapper = mountPanel({ votes: [], total: 0, actionOpen: false });
    await settle();

    expect(wrapper.html()).not.toContain('governance.noVotesYetOpen');
  });

  it('hides the filter chrome on a list too short to need it', async () => {
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    expect(wrapper.find('.positions__controls').exists()).toBe(false);
  });

  it('offers the controls once the list is long enough to search', async () => {
    const votes = Array.from({ length: 20 }, (_, i) =>
      vote({ drepId: toCip129(String(i).padStart(2, '0').repeat(28)) }),
    );
    wrapper = mountPanel({ votes, total: 20 });
    await settle();

    expect(wrapper.find('.positions__controls').exists()).toBe(true);
    expect(wrapper.html()).toContain('governance.showingPositions:{"shown":20,"total":20}');
  });

  it('reports only what it is showing when upstream does not count', async () => {
    wrapper = mountPanel({ votes: [vote()], total: null });
    await settle();

    expect(wrapper.html()).toContain('governance.showingPositionsPartial:{"shown":1}');
  });

  it('states the neutrality promise about ordering', async () => {
    wrapper = mountPanel();
    await settle();

    expect(wrapper.html()).toContain('governance.positionsNeutrality');
    expect(wrapper.html()).toContain('governance.positionsLatestOnly');
  });

  it('claims a newest-first ordering only where that is the ordering', async () => {
    wrapper = mountPanel({
      votes: [vote({ votedAt: 200 }), vote({ drepId: DREP_B, votedAt: 100 })],
      total: 2,
    });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsOrderNewest');
    expect(html).not.toContain('governance.positionsOrderUntimed');
    // Every row is dated, so there is nothing parked at the end to disclose.
    expect(html).not.toContain('governance.positionsUndatedLast');
  });

  // The oldest-first wording is pinned in positions.spec.ts: `<script setup>`
  // state is not reachable from the wrapper, and the sort control is a stubbed
  // v-chip-group here, so the claim is tested where it is decided.

  it('claims no time ordering at all for a list that carries no times', async () => {
    // Nothing here can be ordered by date, so the list falls back to body and
    // id and says so.
    wrapper = mountPanel({ votes: [vote(), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsOrderUntimed');
    expect(html).not.toContain('governance.positionsOrderNewest');
  });

  it('discloses where the undated rows went on a mixed list', async () => {
    wrapper = mountPanel({ votes: [vote({ votedAt: 200 }), vote({ drepId: DREP_B })], total: 2 });
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.positionsOrderNewest');
    expect(html).toContain('governance.positionsUndatedLast');
  });

  it('makes the rationale filter a real toggle a keyboard can reach', async () => {
    // Outside a v-chip-group a bare chip renders a <span> with a click handler:
    // no tab stop, no role, no pressed state.
    const votes = Array.from({ length: 14 }, (_, i) =>
      vote({
        drepId: toCip129(String(i).padStart(2, '0').repeat(28)),
        rationaleUrl: i < 3 ? 'https://a.test/why.json' : null,
      }),
    );
    wrapper = mountPanel({ votes, total: 14 });
    await settle();

    const toggle = wrapper.find('.positions__toggle');
    expect(toggle.exists()).toBe(true);
    expect(toggle.element.tagName).toBe('BUTTON');
    expect(toggle.attributes('aria-pressed')).toBe('false');

    await toggle.trigger('click');
    await settle();

    expect(wrapper.find('.positions__toggle').attributes('aria-pressed')).toBe('true');
    expect(wrapper.findAll('.vote-row')).toHaveLength(3);
  });
});
