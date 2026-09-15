// The DRep directory as rendered.
//
// `drepDirectory.sort.spec.ts` pins the ordering rule itself; this file pins
// that the page WIRES it: the column headers are real buttons, the active one
// announces its direction, the arriving order is participation and never power,
// and each row's delegate control acts on that row's own record.
//
// Everything with a network call, a chain SDK or a signing surface behind it is
// mocked. The Vuetify layer is stubbed; GButton and the feedback components are
// `<script setup>` imports that Vue 2.7 resolves lexically, so they render for
// real and the buttons under test are real buttons.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue from 'vue';

// `vi.mock` factories are hoisted above every const in this file, and the view's
// own imports are hoisted above them again — so anything a factory touches has
// to be hoisted too, not merely declared first.
const h = vi.hoisted(() => ({
  getDRepsPaginated: vi.fn(),
  delegateToDRep: vi.fn(),
  delegateToPredefined: vi.fn(),
  // walletStore and networkStore both drag in the chain SDK; the view reads a
  // handful of fields off each, so stand those fields up directly.
  wallet: {
    loggedWallet: { chain: 'Cardano', network: 'Mainnet', stakeAddress: 'stake1uexample' },
    account: { drep_id: null as string | null },
    keys: null as unknown,
    utxos: null as unknown,
    isSyncing: false,
  },
  network: { epochParams: null as unknown },
  // Participation is votes-cast over ELIGIBLE ACTIONS, so the denominator has to
  // exist or every DRep is "pending" and the sort has nothing to order by. Four
  // loaded actions is the denominator; the sample proposal id on the DRep rows
  // is not canonical, so `drepStats` falls back to this count rather than to an
  // exact id window, which is the honest path the view already documents.
  actionsState: {
    actions: Array.from({ length: 4 }, (_, i) => ({
      govActionId: `${'ab'.repeat(32)}#${i}`,
      govActionIdCip129: null,
      type: 'InfoAction',
    })),
  },
}));

vi.mock('@/api/blockchain-api', () => ({
  default: { getDRepsPaginated: (...args: unknown[]) => h.getDRepsPaginated(...args) },
}));

vi.mock('@/stores/walletStore', () => ({ walletStore: h.wallet, default: { state: h.wallet } }));

vi.mock('@/stores/networkStore', () => ({
  networkStore: h.network,
  default: { getCurrentEpoch: () => 650, state: h.network },
}));

vi.mock('@/stores/governanceActionsStore', () => ({
  default: { state: h.actionsState, loadActions: vi.fn(async () => undefined) },
}));

vi.mock('@/modules/governance/composables/useDRepDelegation', async () => {
  const { ref } = await import('vue');
  return {
    useDRepDelegation: () => ({
      selectedDRep: ref(null),
      tx: ref(null),
      isDialogOpen: ref(false),
      building: ref(null),
      delegateToDRep: (...args: unknown[]) => h.delegateToDRep(...args),
      delegateToPredefined: (...args: unknown[]) => h.delegateToPredefined(...args),
      closeDialog: vi.fn(),
    }),
  };
});

vi.mock('@/modules/governance/dialogs/DRepDelegateDialog.vue', () => ({
  default: { name: 'DRepDelegateDialog', props: ['isOpen', 'drep', 'tx'], render: () => null },
}));
vi.mock('@/modules/governance/components/dreps/MatchPanel.vue', () => ({
  default: { name: 'MatchPanel', props: ['isOpen', 'statsContext', 'seed'], render: () => null },
}));
vi.mock('@/shared/utils/pendingDelegation', () => ({
  onPendingDRepDelegation: () => () => undefined,
  takePendingDRepDelegation: async () => null,
}));
vi.mock('@/plugins/snackbar', () => ({ default: { setError: vi.fn(), setSuccess: vi.fn() } }));
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: $t }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import DRepDirectory from './DRepDirectory.vue';
import { toCip129 } from '@/shared/utils/drepId';
import { resetDRepRegister } from './drepRegister';

/**
 * 56 hex chars: `drepStats` keys a row on the credential, not the label.
 *
 * Derived from the WHOLE name. Keying on the first character alone collides for
 * any two DReps sharing an initial, and a shared credential is a shared row key —
 * which both breaks Vue's list rendering and hands the comparator's tie-break
 * nothing to separate the rows with.
 */
const credential = (name: string): string => {
  let hex = '';
  for (let i = 0; i < 28; i += 1) {
    hex += ((name.charCodeAt(i % name.length) + i * 7 + name.length) % 256).toString(16).padStart(2, '0');
  }
  return hex;
};

/** The real CIP-129 form, so `sameDRep` can match on credential as it does live. */
const drepId = (name: string): string => toCip129(credential(name)) as string;

/** A DRep the endpoint could really return. Power is a decimal STRING. */
function drep(
  name: string,
  over: { power?: string; delegators?: number; votes?: number; rationale?: number } = {},
) {
  const votes = over.votes ?? 4;
  const withRationale = over.rationale ?? votes;
  return {
    hex: credential(name),
    drep_id: drepId(name),
    display_name: name,
    active: true,
    registered: true,
    amount: over.power ?? '1000000',
    votes: Array.from({ length: votes }, (_, i) => ({
      proposal_id: `p${i}`,
      vote: 'Yes',
      block_time: 1_700_000_000 + i,
      meta_url: i < withRationale ? 'https://example.test/r.json' : null,
    })),
    delegators: Array.from({ length: over.delegators ?? 1 }, (_, i) => ({ stake_address: `stake${i}` })),
  };
}

function mountPage(): Wrapper<Vue> {
  return mount(DRepDirectory, {
    mocks: { $t, $route: { query: {} } },
    stubs: {
      'v-icon': true,
      'v-avatar': true,
      'v-img': true,
      'v-text-field': true,
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

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) {
    await new Promise(resolve => setTimeout(resolve, 0));
    await Vue.nextTick();
  }
}

let wrapper: Wrapper<Vue> | null = null;

/** The rendered order, by display name. */
function renderedNames(w: Wrapper<Vue>): string[] {
  return w.findAll('.drep-directory__name').wrappers.map(n => n.text());
}

/** One sortable column header, by its label key. */
function header(w: Wrapper<Vue>, labelKey: string): Wrapper<Vue> {
  const found = w
    .findAll('.drep-directory__sort')
    .wrappers.find(button => button.text().startsWith(labelKey));
  if (!found) throw new Error(`no sortable header for ${labelKey}`);
  return found as Wrapper<Vue>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // The register is cached at module scope for the session; without this, the
  // second test in this file would render the first test's DReps.
  resetDRepRegister();
  h.wallet.account = { drep_id: null };
  h.getDRepsPaginated.mockResolvedValue({
    items: [
      // Deliberately arriving worst-participation-first, and with the biggest
      // holder last, so neither the API order nor power can pass for the sort.
      drep('quiet', { power: '90071992547409920', votes: 1, rationale: 0, delegators: 900 }),
      drep('steady', { power: '2000000', votes: 4, rationale: 4, delegators: 12 }),
    ],
    meta: { total_items: 2, total_pages: 1 },
  });
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
});

describe('DRepDirectory: the header is the sort control', () => {
  it('renders a real button for every sortable column and no sort chip row', async () => {
    wrapper = mountPage();
    await settle();

    // The active header carries a direction glyph; strip it to compare labels.
    const labels = wrapper
      .findAll('.drep-directory__sort')
      .wrappers.map(b => b.text().replace(/[↑↓]/g, '').trim());
    expect(labels).toContain('governance.colParticipation');
    expect(labels).toContain('governance.colRationale');
    expect(labels).toContain('governance.delegators');
    expect(labels).toContain('governance.lastVote');
    expect(labels).toContain('governance.votingPower');
    // Every one of them is a <button>, not a div wearing a click handler.
    for (const button of wrapper.findAll('.drep-directory__sort').wrappers) {
      expect(button.element.tagName).toBe('BUTTON');
      expect(button.attributes('type')).toBe('button');
    }
    // The chip row is gone: the headers replaced it, they did not join it.
    expect(wrapper.find('.drep-directory__sort-label').exists()).toBe(false);
  });

  it('arrives sorted by participation, descending, and says so', async () => {
    wrapper = mountPage();
    await settle();

    expect(renderedNames(wrapper)).toEqual(['steady', 'quiet']);
    const participation = wrapper
      .findAll('[role="columnheader"]')
      .wrappers.find(cell => cell.text().startsWith('governance.colParticipation'));
    expect(participation?.attributes('aria-sort')).toBe('descending');
  });

  it('never arrives sorted by voting power', async () => {
    wrapper = mountPage();
    await settle();

    // `quiet` holds 45 000× more stake than `steady` and is still second.
    expect(renderedNames(wrapper)[0]).toBe('steady');
    const power = wrapper
      .findAll('[role="columnheader"]')
      .wrappers.find(cell => cell.text().startsWith('governance.votingPower'));
    expect(power?.attributes('aria-sort')).toBe('none');
  });

  it('toggles direction when the active header is clicked again', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.colParticipation').trigger('click');
    await Vue.nextTick();
    expect(renderedNames(wrapper)).toEqual(['quiet', 'steady']);

    await header(wrapper, 'governance.colParticipation').trigger('click');
    await Vue.nextTick();
    expect(renderedNames(wrapper)).toEqual(['steady', 'quiet']);
  });

  it('takes over at descending when another header is clicked', async () => {
    wrapper = mountPage();
    await settle();

    // `settle`, not one tick: voting power is ordered by the endpoint across all
    // of its pages, so taking that column over re-fetches page 1.
    await header(wrapper, 'governance.votingPower').trigger('click');
    await settle();

    expect(renderedNames(wrapper)).toEqual(['quiet', 'steady']);
    const cells = wrapper.findAll('[role="columnheader"]').wrappers;
    expect(cells.find(c => c.text().startsWith('governance.votingPower'))?.attributes('aria-sort')).toBe(
      'descending',
    );
    expect(
      cells.find(c => c.text().startsWith('governance.colParticipation'))?.attributes('aria-sort'),
    ).toBe('none');
  });
});

describe('DRepDirectory: the row action', () => {
  it('delegates to the row the button sits on, not to the first row', async () => {
    wrapper = mountPage();
    await settle();

    // Second row after the default sort is `quiet`.
    const rows = wrapper.findAll('.drep-directory__row').wrappers;
    expect(rows).toHaveLength(2);
    const secondAction = rows[1].find('.drep-directory__col-action button');
    await secondAction.trigger('click');
    await settle();

    expect(h.delegateToDRep).toHaveBeenCalledTimes(1);
    expect(h.delegateToDRep.mock.calls[0][0]).toMatchObject({ id: drepId('quiet'), name: 'quiet' });
  });

  it('follows the row when the order changes', async () => {
    wrapper = mountPage();
    await settle();

    // `settle`, not one tick: this column is ordered by the endpoint, so the
    // click re-fetches page 1 before the new order is on screen.
    await header(wrapper, 'governance.votingPower').trigger('click');
    await settle();

    // `quiet` is now FIRST. The same position must now delegate to it.
    const rows = wrapper.findAll('.drep-directory__row').wrappers;
    await rows[0].find('.drep-directory__col-action button').trigger('click');
    await settle();

    expect(h.delegateToDRep.mock.calls[0][0]).toMatchObject({ id: drepId('quiet') });
  });

  it('puts the delegate control in its own action cell, outside the data columns', async () => {
    wrapper = mountPage();
    await settle();

    const row = wrapper.findAll('.drep-directory__row').wrappers[0];
    const action = row.find('.drep-directory__col-action');
    expect(action.exists()).toBe(true);
    expect(action.find('button').exists()).toBe(true);
    // The power cell carries the figure only — the CTA is not inside it.
    expect(row.find('.drep-directory__col-power').find('button').exists()).toBe(false);
  });

  it('reads Delegated and is disabled on the DRep this wallet already uses', async () => {
    h.wallet.account = { drep_id: drepId('steady') };
    wrapper = mountPage();
    await settle();

    const first = wrapper.findAll('.drep-directory__row').wrappers[0];
    expect(first.find('.drep-directory__name').text()).toBe('steady');
    const button = first.find('.drep-directory__col-action button');
    expect(button.text()).toBe('governance.delegated');
    expect(button.attributes('disabled')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Ordering the whole register
// ---------------------------------------------------------------------------

/**
 * A server holding `total` DReps but handing out only `stride` a page, and
 * reporting `total_items` without `total_pages`.
 *
 * Both halves are deliberate. The clamp is what a real endpoint may do with a
 * wide `per_page`, and the missing `total_pages` forces the walk to derive the
 * page count from the rows it actually received — the one arithmetic that decides
 * whether the tail of the register is reached or quietly abandoned.
 */
function pagedServer(total: number, stride: number) {
  return vi.fn(async (params: { page?: number }) => {
    const page = params?.page ?? 1;
    const start = (page - 1) * stride;
    return {
      items: Array.from({ length: Math.max(0, Math.min(stride, total - start)) }, (_, i) =>
        // Only the LAST DRep has voted on all four eligible actions; every other
        // one has voted once. So the top of a participation order lives on the
        // final page, exactly where a page-local sort could never find it.
        start + i + 1 === total
          ? drep(`d${start + i}`, { votes: 4, rationale: 4, power: '1', delegators: 1 })
          : drep(`d${start + i}`, { votes: 1, rationale: 0, power: '900000000000000', delegators: 800 }),
      ),
      meta: { page, per_page: stride, total_items: total },
    };
  });
}

describe('DRepDirectory: a client-computed column orders every page', () => {
  it('puts the best participation first even when it sits on the last page', async () => {
    h.getDRepsPaginated.mockImplementation(pagedServer(40, 15));
    wrapper = mountPage();
    await settle();

    // Three requests: the register was walked, not sampled.
    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(3);
    // `d39` is the 40th DRep — the third page. Under page-local sorting the
    // first row could only ever have been one of d0..d14.
    expect(renderedNames(wrapper)[0]).toBe('d39');
  });

  it('pages the register in memory, without going back to the server', async () => {
    h.getDRepsPaginated.mockImplementation(pagedServer(40, 15));
    wrapper = mountPage();
    await settle();

    const firstPage = renderedNames(wrapper);
    expect(firstPage).toHaveLength(15);
    h.getDRepsPaginated.mockClear();

    wrapper.find('v-pagination-stub').vm.$emit('input', 2);
    await settle();

    // Page 2 is rows 16-30 of the GLOBAL order, and it cost nothing.
    expect(h.getDRepsPaginated).not.toHaveBeenCalled();
    const secondPage = renderedNames(wrapper);
    expect(secondPage).toHaveLength(15);
    expect(secondPage).not.toEqual(firstPage);
    for (const name of secondPage) expect(firstPage).not.toContain(name);
  });

  it('sends no sort parameter for a column the endpoint cannot order', async () => {
    h.getDRepsPaginated.mockImplementation(pagedServer(40, 15));
    wrapper = mountPage();
    await settle();

    // Participation is the arriving order AND client-computed. `/api/dreps`
    // answers an unrecognised `sort_by` with its own default order, so pushing
    // one would put an arbitrary order under a sorted header.
    for (const call of h.getDRepsPaginated.mock.calls) {
      expect(call[0]).not.toHaveProperty('sort_by');
    }
  });
});

describe('DRepDirectory: a server-sortable column is pushed to the endpoint', () => {
  it('re-fetches page 1 with sort_by when voting power is clicked', async () => {
    wrapper = mountPage();
    await settle();
    h.getDRepsPaginated.mockClear();

    await header(wrapper, 'governance.votingPower').trigger('click');
    await settle();

    expect(h.getDRepsPaginated).toHaveBeenCalledTimes(1);
    expect(h.getDRepsPaginated.mock.calls[0][0]).toMatchObject({
      page: 1,
      per_page: 15,
      sort_by: 'voting_power',
      sort_direction: 'desc',
    });
  });

  it('sends the direction the header is showing', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.votingPower').trigger('click');
    await settle();
    h.getDRepsPaginated.mockClear();

    // Second click on the active header flips it.
    await header(wrapper, 'governance.votingPower').trigger('click');
    await settle();

    expect(h.getDRepsPaginated.mock.calls[0][0]).toMatchObject({
      sort_by: 'voting_power',
      sort_direction: 'asc',
    });
  });

  it('pushes delegators too, and returns to no parameter on the way back', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.delegators').trigger('click');
    await settle();
    expect(h.getDRepsPaginated.mock.calls.at(-1)?.[0]).toMatchObject({ sort_by: 'delegators' });

    h.getDRepsPaginated.mockClear();
    await header(wrapper, 'governance.colParticipation').trigger('click');
    await settle();

    // Back on a client-ordered column: the register answers, so nothing that
    // goes out may carry a sort the endpoint would ignore.
    for (const call of h.getDRepsPaginated.mock.calls) {
      expect(call[0]).not.toHaveProperty('sort_by');
    }
    expect(renderedNames(wrapper)).toEqual(['steady', 'quiet']);
  });

  it('does not re-fetch to move between two client-ordered columns', async () => {
    h.getDRepsPaginated.mockImplementation(pagedServer(40, 15));
    wrapper = mountPage();
    await settle();
    h.getDRepsPaginated.mockClear();

    await header(wrapper, 'governance.colRationale').trigger('click');
    await settle();

    // The register in memory already holds every figure these columns read.
    expect(h.getDRepsPaginated).not.toHaveBeenCalled();
    expect(wrapper.findAll('.drep-directory__row')).toHaveLength(15);
  });
});

/** Type into the search field the way the user does: through the field itself. */
async function typeSearch(w: Wrapper<Vue>, term: string): Promise<void> {
  w.find('v-text-field-stub').vm.$emit('input', term);
  await Vue.nextTick();
  await new Promise(resolve => setTimeout(resolve, 450)); // the field's own debounce
  await settle();
}

describe('DRepDirectory: search and sort compose', () => {
  it('sends both the term and the sort on a server-ordered column', async () => {
    wrapper = mountPage();
    await settle();

    await header(wrapper, 'governance.votingPower').trigger('click');
    await settle();
    h.getDRepsPaginated.mockClear();

    await typeSearch(wrapper, 'HeptaSean');

    // The endpoint applies `search` BEFORE ordering, so the two compose into
    // "the highest-power DRep among the matches" rather than fighting.
    expect(h.getDRepsPaginated.mock.calls[0][0]).toMatchObject({
      page: 1,
      search: 'HeptaSean',
      sort_by: 'voting_power',
      sort_direction: 'desc',
    });
  });

  it('carries the term into the register walk on a client-ordered column', async () => {
    h.getDRepsPaginated.mockImplementation(pagedServer(40, 15));
    wrapper = mountPage();
    await settle();
    h.getDRepsPaginated.mockClear();

    await typeSearch(wrapper, 'HeptaSean');

    // The searched set is walked in FULL, so the order spans all of it and not
    // just its first page.
    expect(h.getDRepsPaginated.mock.calls.length).toBeGreaterThan(1);
    for (const call of h.getDRepsPaginated.mock.calls) {
      expect(call[0].search).toBe('HeptaSean');
      expect(call[0]).not.toHaveProperty('sort_by');
    }
    expect(renderedNames(wrapper)[0]).toBe('d39');
  });
});

describe('DRepDirectory: an order it cannot deliver is never implied', () => {
  it('says the sort is page-local when the register could not be loaded', async () => {
    const paged = pagedServer(40, 15);
    h.getDRepsPaginated.mockImplementation(async (params: { page?: number; per_page?: number }) => {
      // The walk asks for wide pages and fails; the single-page fallback does not.
      if ((params?.per_page ?? 0) > 15) throw new Error('gateway timeout');
      return paged(params);
    });

    wrapper = mountPage();
    await settle();

    // Rows still render, from one server page.
    expect(wrapper.findAll('.drep-directory__row').length).toBeGreaterThan(0);
    // And the caveat sits against the sort control, not buried in the footer.
    const note = wrapper.find('.drep-directory__scope-note');
    expect(note.exists()).toBe(true);
    expect(note.text()).toContain('governance.sortPageOnlyNotice');
    expect(wrapper.find('.drep-directory__footer').text()).toContain(
      'governance.directoryFooterPageLocal',
    );
  });

  it('claims the register-wide order only when it really has the register', async () => {
    h.getDRepsPaginated.mockImplementation(pagedServer(40, 15));
    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.drep-directory__scope-note').exists()).toBe(false);
    expect(wrapper.find('.drep-directory__footer').text()).toContain('governance.directoryFooter');
  });

  it('explains the wait while the register is loading', async () => {
    let release: (() => void) | null = null;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    h.getDRepsPaginated.mockImplementation(async () => {
      await gate;
      return { items: [drep('steady')], meta: { total_items: 1, total_pages: 1 } };
    });

    wrapper = mountPage();
    await Vue.nextTick();

    expect(wrapper.find('.drep-directory__loading-note').text()).toContain(
      'governance.orderingRegister',
    );
    release?.();
    await settle();
    expect(wrapper.find('.drep-directory__loading-note').exists()).toBe(false);
  });
});

describe('DRepDirectory: the match CTA', () => {
  it('stands on its own line with its own prompt, not inside the search row', async () => {
    wrapper = mountPage();
    await settle();

    const match = wrapper.find('.drep-directory__match');
    expect(match.exists()).toBe(true);
    expect(match.text()).toContain('governance.matchPrompt');
    expect(match.text()).toContain('governance.findMatch');
    // The search field is in the header, the CTA is not.
    expect(wrapper.find('.drep-directory__header').find('.drep-directory__match').exists()).toBe(false);
  });
});
