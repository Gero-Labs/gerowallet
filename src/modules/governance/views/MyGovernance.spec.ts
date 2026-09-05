// The governance home is a projection of ONE derived state, so what is worth
// asserting here is the projection: that the state the wallet is actually in
// decides which surface renders, and that the withdrawal gate is reachable from
// exactly one of them.
//
// Everything with a transaction, a network call or a router behind it is mocked
// — useWithdrawal drags the Cardano builder in, and the gate dialog drags the
// whole signing stack. Neither is what this file owns.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, type Wrapper } from '@vue/test-utils';
import Vue, { ref } from 'vue';
import { Cardano } from '@cardano-sdk/core';

const withdraw = vi.fn();
const closeWithdrawalDialog = vi.fn();
const withdrawalBlocked = ref(false);

vi.mock('@/shared/composables/useWithdrawal', () => ({
  useWithdrawal: () => ({ withdraw, withdrawalBlocked, closeWithdrawalDialog }),
}));

const getDRepById = vi.fn();
vi.mock('@/api/blockchain-api', () => ({ default: { getDRepById: (...args: unknown[]) => getDRepById(...args) } }));

// The vote rows name the action they were cast on, which means the governance
// action list. It is a real axios client, so it is mocked rather than left to
// fire at whatever origin happy-dom is pretending to be.
const listProposals = vi.fn();
vi.mock('@/api/governance-api', () => ({
  default: { listProposals: (...args: unknown[]) => listProposals(...args) },
}));

vi.mock('@/modules/governance/dialogs/WithdrawGateDialog.vue', () => ({
  default: { name: 'WithdrawGateDialog', props: ['isOpen'], render: () => null },
}));

// The rationale dialog fetches an author's document; opening it is what this
// page is asserted on, not what the dialog then does with it.
vi.mock('@/modules/governance/dialogs/RationaleDialog.vue', () => ({
  default: { name: 'RationaleDialog', props: ['isOpen', 'url', 'hash', 'actionTitle'], render: () => null },
}));

// Same reason DRepDirectory.spec mocks it: the real dialog pulls the hardware
// signing chain (Ledger/Trezor/Keystone) into the module graph, which does not
// resolve under vitest. This page is asserted on WHICH delegation it offers, not
// on what the dialog does with the certificate afterwards.
vi.mock('@/modules/governance/dialogs/DRepDelegateDialog.vue', () => ({
  default: { name: 'DRepDelegateDialog', props: ['isOpen', 'drep', 'tx'], render: () => null },
}));

const push = vi.fn();
vi.mock('vue-router/composables', () => ({ useRouter: () => ({ push: (...args: unknown[]) => push(...args) }) }));

// @ts-ignore — tsconfig ships no `*.vue` shim; vite resolves this fine.
import MyGovernance from './MyGovernance.vue';
import { walletStore } from '@/stores/walletStore';
import { governanceStore } from '@/stores/governanceStore';
import { networkStore } from '@/stores/networkStore';
import governanceActionsStore from '@/stores/governanceActionsStore';
import { resetDRepRecords } from '@/shared/composables/useGovernanceHydration';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import governanceAlertsStore from '@/stores/governanceAlertsStore';

/**
 * One governance action, in BOTH id encodings.
 *
 * The two services disagree on how to spell an action: gero-backend stamps a
 * DRep's vote with `proposal_id`, Nexus lists the action as `govActionId`
 * (`{txHash}#{index}`) alongside `govActionIdCip129` (bech32). A vote can arrive
 * in either form, so the fixtures below pin the CROSS: one action matched
 * bech32-to-hex, the other hex-to-bech32.
 */
const ACTION_A_HEX = `${'1'.repeat(64)}#0`;
const ACTION_A_BECH32 = 'gov_action1zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsq6dmejn';
const ACTION_B_HEX = `${'ab'.repeat(32)}#3`;
const ACTION_B_BECH32 = 'gov_action14w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w46h2at4w4sx873n5k';

const $t = (key: string, values?: Record<string, unknown>): string =>
  values ? `${key}:${JSON.stringify(values)}` : key;

/** A wallet delegated to a pool but to no DRep: rewards are locked. */
function registeredNoDRep(): void {
  walletStore.account = {
    active: true,
    pool_id: 'pool1abc',
    drep_id: '',
    controlled_amount: '23718000000',
    withdrawable_amount: '412390000',
  } as unknown as typeof walletStore.account;
}

function represented(): void {
  walletStore.account = {
    active: true,
    pool_id: 'pool1abc',
    drep_id: 'drep1yfrexample',
    controlled_amount: '23718000000',
    withdrawable_amount: '0',
  } as unknown as typeof walletStore.account;
}

function mountPage(): Wrapper<Vue> {
  return mount(MyGovernance, {
    mocks: { $t },
    stubs: {
      'v-icon': true,
      'v-skeleton-loader': true,
      AsOf: true,
      // Only the Vuetify layer is stubbed. GButton, EmptyState and ErrorState
      // are `<script setup>` imports, which Vue 2.7 resolves lexically — a
      // `stubs` entry keyed by their name is silently ignored, so they render
      // for real and their classes/props are what the assertions below match.
      //
      // This stub must forward BOTH attrs and listeners onto a real <button>:
      // GButton reaches v-btn through `v-on="$listeners"`, so a stub that
      // swallowed them would leave every click assertion passing vacuously
      // against a button that does nothing.
      'v-btn': {
        inheritAttrs: false,
        template: '<button v-bind="$attrs" v-on="$listeners"><slot /></button>',
      },
    },
  });
}

/** Every rendered GButton, matched by the class GButton always applies. */
function buttonsLabelled(w: Wrapper<Vue>, label: string) {
  return w.findAll('.g-btn').filter(b => b.text().includes(label));
}

/** Let the mounted fetch settle. */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await Vue.nextTick();
}

let wrapper: Wrapper<Vue> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  withdrawalBlocked.value = false;
  // Records are memoised per chain/network/id for five minutes, so without this
  // each test would be served the previous test's DRep.
  resetDRepRecords();
  getDRepById.mockResolvedValue(null);
  listProposals.mockResolvedValue({ items: [], page: 1, pageSize: 50, total: 0 });
  walletStore.loggedWallet = { chain: 'Cardano', network: 'Mainnet', stakeAddress: 'stake1uexample' };
  walletStore.keys = null;
  walletStore.transactions = [];
  governanceStore.currentDRep = null;
  governanceStore.currentCompensationBps = null;
  governanceActionsStore.reset();
  // Both governance flags are pinned rather than read from the ambient store, so
  // these cases do not depend on what the flag service happens to answer. ON is
  // the baseline: it is the page with every affordance reachable. The gate that
  // turns the registration CTA off has its own cases below.
  vi.spyOn(featureFlagsStore, 'isGovernanceEnabled').mockReturnValue(true);
  vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(true);
});

afterEach(() => {
  wrapper?.destroy();
  wrapper = null;
  // The tile tests below drive the epoch through the real store; leaving a tip
  // behind would silently change every other case's expiry arithmetic.
  networkStore.tip = null;
  governanceActionsStore.reset();
  governanceAlertsStore.state.drepId = null;
  governanceAlertsStore.state.evaluatedAt = null;
});

/** Pretend the action board is already loaded, so nothing refetches it. */
function actionsLoaded(items: Record<string, unknown>[]): void {
  governanceActionsStore.state.actions = items as never;
  governanceActionsStore.state.fetchedAt = Date.now();
}

/** Captions under the three health tiles — the line each tile hangs off its fact. */
function tileCaptions(w: Wrapper<Vue>) {
  return w.findAll('.my-governance__tile .t-caption');
}

describe('MyGovernance', () => {
  it('offers the three unlock choices, and only them, when rewards are locked', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await Vue.nextTick();

    const html = wrapper.html();
    expect(html).toContain('governance.status.registeredNoDRep.title');
    expect(html).toContain('governance.delegateToADRep');
    expect(html).toContain('governance.alwaysAbstain');
    expect(html).toContain('governance.alwaysNoConfidence');
    // Every one of them unlocks, and the page says so on each.
    expect(html.split('governance.unlocksWithdrawals').length - 1).toBe(3);
    // The delegated-state surfaces stay away.
    expect(html).not.toContain('governance.howYourStakeWasCast');
  });

  it('renders the locked reward balance exactly, without narrowing it through Number', async () => {
    registeredNoDRep();
    walletStore.account = {
      ...walletStore.account,
      withdrawable_amount: '90071992547409910',
    } as unknown as typeof walletStore.account;
    wrapper = mountPage();
    await Vue.nextTick();

    // 90071992547409910 lovelace is past Number.MAX_SAFE_INTEGER; the exact
    // figure must survive to the formatter.
    expect(wrapper.html()).toContain('90,071,992,547.41');
  });

  it('raises the withdrawal gate from the locked balance, not from a dead end', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await Vue.nextTick();

    const gate = wrapper.findComponent({ name: 'WithdrawGateDialog' });
    expect(gate.props('isOpen')).toBe(false);

    const withdrawButton = buttonsLabelled(wrapper, 'staking.withdraw');
    expect(withdrawButton).toHaveLength(1);

    withdrawButton.at(0).trigger('click');
    await Vue.nextTick();
    expect(withdraw).toHaveBeenCalledTimes(1);

    // The composable's blocked branch is what actually opens it.
    withdrawalBlocked.value = true;
    await Vue.nextTick();
    expect(gate.props('isOpen')).toBe(true);
  });

  it('never offers the gate in a state that can already withdraw', async () => {
    represented();
    wrapper = mountPage();
    await Vue.nextTick();

    expect(wrapper.html()).toContain('governance.status.represented.title');
    expect(wrapper.html()).not.toContain('governance.withdrawalLocked');
    expect(buttonsLabelled(wrapper, 'staking.withdraw')).toHaveLength(0);
  });

  it('shows one row per proposal, newest first, when the DRep has voted twice on one action', async () => {
    represented();
    // No `drep_id` on the record: the composable trusts a record fetched BY the
    // delegated id, and a fake bech32 would fail credential comparison.
    getDRepById.mockResolvedValue({
      registered: true,
      votes: [
        { proposal_id: 'aa11', vote: 'no', block_time: 100, meta_url: '' },
        { proposal_id: 'aa11', vote: 'yes', block_time: 200, meta_url: 'https://example.test/r.json' },
        { proposal_id: 'bb22', vote: 'abstain', block_time: 150 },
      ],
    });

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    // The re-vote collapses to the newest: yes, with its rationale, not no.
    expect(html).toContain('governance.votedYes');
    expect(html).toContain('governance.rationaleAttached');
    expect(html).not.toContain('governance.votedNo');
    expect(html).toContain('governance.votedAbstain');
  });

  it('reports a DRep with no votes as n/a, never as 0%', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    // The recent tile formats its own string, so a wrong 0 would read "0%"...
    expect(html).toContain('common.notAvailable');
    expect(html).not.toContain('0%');
    // ...but the long-run line goes through $t, where a wrong 0 would hide
    // inside the interpolation params rather than the rendered text. The mock
    // echoes them precisely so this stays a real assertion.
    expect(html).not.toContain('"pct":0');
    expect(html).toContain('governance.noVotesYet');
  });

  // The health tiles state facts. A tile whose caption is unknown must show
  // LESS, never something that reads as a claim: "n/a" printed under a real
  // date says the date is unknown, which is the opposite of true, and
  // "stays active for 0 more epochs" is the exact falsehood the trust
  // hierarchy discards a stale expiry to avoid.
  describe('health tile captions', () => {
    it('renders no caption at all when the countdown is unknown', async () => {
      represented();
      networkStore.tip = { epoch: 651 } as unknown as typeof networkStore.tip;
      // `active: true` beside an already-passed expiry is the stale-index
      // signature: delegationHealth sets expiryStale and nulls epochsLeft.
      getDRepById.mockResolvedValue({
        registered: true,
        active: true,
        expires_epoch_no: 629,
        votes: [],
      });

      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      // Neither the countdown nor the expiry it was derived from.
      expect(html).not.toContain('governance.activeForEpochs');
      expect(html).not.toContain('governance.expiresEpochLabel');
      // And no filler standing in for them: "On-chain data" under a vote count
      // says nothing the tile's own label did not already say.
      expect(html).not.toContain('governance.onchainData');
      // One caption survives — the long-run rationale line, which is a real
      // fact about a record with no votes — and the two unknown ones are gone.
      expect(tileCaptions(wrapper)).toHaveLength(1);
      // The tiles themselves stay: they still carry the facts they do have.
      expect(html).toContain('governance.lastVote');
      expect(html).toContain('governance.votes');
    });

    it('still renders the caption when the countdown is coherent', async () => {
      represented();
      networkStore.tip = { epoch: 651 } as unknown as typeof networkStore.tip;
      getDRepById.mockResolvedValue({
        registered: true,
        expires_epoch_no: 660,
        votes: [],
      });

      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      // 660 − 651 = 9 epochs left, and the stored expiry is worth stating.
      expect(html).toContain('governance.activeForEpochs:{"n":9}');
      expect(html).toContain('governance.expiresEpochLabel:{"n":660}');
      expect(tileCaptions(wrapper)).toHaveLength(3);
    });
  });

  // The delegation-alerts panel drops into the slot under the hero and raises
  // its own gradient CTA when an alert is live. Any gradient this page renders
  // in a delegated state would be the second one on screen.
  it('claims no gradient CTA in a delegated state, alerts panel or not', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    wrapper = mountPage();
    await settle();

    expect(wrapper.findAll('.g-btn--primary')).toHaveLength(0);
  });

  it('still yields the gradient when the DRep has retired, since the alert owns it', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: false, votes: [] });
    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.status.drepRetired.title');
    expect(html).toContain('governance.findAReplacement');
    expect(wrapper.findAll('.g-btn--primary')).toHaveLength(0);
  });

  it('keeps exactly one gradient where no alert can exist', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await settle();

    // The delegate choice card, and nothing else.
    const primaries = wrapper.findAll('.g-btn--primary');
    expect(primaries).toHaveLength(1);
    expect(primaries.at(0).text()).toContain('governance.browseDReps');
  });

  // CardanoGovernance.vue was the only dashboard-context writer of these, and
  // it is gone. useWithdrawal.compensationInfo reads both to decide whether a
  // withdrawal carries a CIP-149 donation output, so without this the donation
  // would silently stop being attached.
  describe('governance store hydration', () => {
    /** A confirmed vote delegation carrying a 5% CIP-149 donation rate. */
    function delegationTxWithDonation(bps: number, pending = false) {
      return {
        pending,
        block_height: 100,
        body: { certificates: [{ __typename: Cardano.CertificateType.VoteDelegation }] },
        auxiliaryData: { blob: new Map([[3692n, new Map([['donationBasisPoints', bps]])]]) },
      };
    }

    it('populates currentDRep from the record it already fetched', async () => {
      represented();
      const drepRecord = {
        registered: true,
        votes: [],
        metadata: { meta_json: { body: { paymentAddress: 'addr1qexample' } } },
      };
      getDRepById.mockResolvedValue(drepRecord);

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toEqual(drepRecord);
      // One request, not two: hydration reuses the page's own fetch rather
      // than repeating it through governanceStore.loadDRepById.
      expect(getDRepById).toHaveBeenCalledTimes(1);
    });

    it('recovers the committed donation rate from the newest confirmed delegation', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });
      walletStore.transactions = [delegationTxWithDonation(50)];

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentCompensationBps).toBe(50);
    });

    it('ignores a pending delegation, which the chain has not agreed to yet', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });
      walletStore.transactions = [delegationTxWithDonation(50, true)];

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentCompensationBps).toBeNull();
    });

    it('clears both when the wallet has no DRep to donate to', async () => {
      governanceStore.currentDRep = { drep_id: 'stale' };
      governanceStore.currentCompensationBps = 50;
      registeredNoDRep();

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toBeNull();
      expect(governanceStore.currentCompensationBps).toBeNull();
    });

    it('keeps a good record rather than blanking it on a transient lookup failure', async () => {
      represented();
      governanceStore.currentDRep = { drep_id: 'drep1yfrexample' };
      getDRepById.mockRejectedValue(new Error('boom'));

      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toEqual({ drep_id: 'drep1yfrexample' });
    });
  });

  describe('predefined choices', () => {
    function abstaining(): void {
      walletStore.account = {
        active: true,
        pool_id: 'pool1abc',
        drep_id: 'drep_always_abstain',
        controlled_amount: '23718000000',
        withdrawable_amount: '0',
      } as unknown as typeof walletStore.account;
    }

    it('names the position instead of rendering the keyword as an id', async () => {
      abstaining();
      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      expect(html).toContain('governance.alwaysAbstain');
      // The keyword is a position, not a credential: no truncated "id" line.
      expect(html).not.toContain('drep_always_abstain');
      expect(wrapper.findAll('.my-governance__drep-id')).toHaveLength(0);
      // And nothing to look up, so no doomed 404 on mount.
      expect(getDRepById).not.toHaveBeenCalled();
    });

    it('records the keyword in the store so the withdrawal path still sees a delegation', async () => {
      abstaining();
      wrapper = mountPage();
      await settle();

      expect(governanceStore.currentDRep).toEqual({ drep_id: 'drep_always_abstain' });
    });
  });

  it('refreshes when the delegation changes, without a reload', async () => {
    registeredNoDRep();
    wrapper = mountPage();
    await settle();
    expect(wrapper.html()).toContain('governance.status.registeredNoDRep.title');
    expect(getDRepById).not.toHaveBeenCalled();

    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    walletStore.account = {
      ...walletStore.account,
      drep_id: 'drep1yfrexample',
    } as unknown as typeof walletStore.account;
    await settle();

    expect(getDRepById).toHaveBeenCalledTimes(1);
    expect(wrapper.html()).toContain('governance.status.represented.title');
    // The unlock choices are gone. (The hero title is not a safe probe here:
    // the legend names every state by design.)
    expect(wrapper.html()).not.toContain('governance.unlocksWithdrawals');
  });

  // A row that shows `1111111…111#0` tells the reader nothing about what their
  // stake was cast on. What makes the title resolvable at all is that BOTH id
  // encodings are canonicalised before they are compared — matching the raw
  // strings resolved nothing whenever the two services disagreed on spelling.
  describe('how your stake was cast', () => {
    const RATIONALE_HASH = 'aa'.repeat(32);

    function votedOnBoth(): void {
      getDRepById.mockResolvedValue({
        registered: true,
        votes: [
          {
            proposal_id: ACTION_A_BECH32,
            vote: 'yes',
            block_time: 300,
            meta_url: 'https://author.test/r.json',
            meta_hash: RATIONALE_HASH,
          },
          { proposal_id: ACTION_B_HEX, vote: 'no', block_time: 200 },
          { proposal_id: 'not-an-action-id', vote: 'abstain', block_time: 100 },
        ],
      });
      actionsLoaded([
        // Listed in hex, voted in bech32.
        { govActionId: ACTION_A_HEX, govActionIdCip129: null, title: 'Increase maxBlockExUnits', type: 'ParameterChange' },
        // Listed in bech32, voted in hex.
        { govActionId: null, govActionIdCip129: ACTION_B_BECH32, title: 'Reimburse Ikigai deposit', type: 'TreasuryWithdrawals' },
      ]);
    }

    it('names the action, in whichever encoding either side used', async () => {
      represented();
      votedOnBoth();

      wrapper = mountPage();
      await settle();

      const html = wrapper.html();
      expect(html).toContain('Increase maxBlockExUnits');
      expect(html).toContain('Reimburse Ikigai deposit');
      // The type is stated as an eyebrow, from the same resolved action. The
      // $t mock echoes keys, so `typeLabel` takes its own fallback here — which
      // is the branch a chain that ships an eighth action type would hit, and
      // it must be the type's own name rather than a raw i18n key.
      const types = wrapper.findAll('.my-governance__row-type');
      expect(types.at(0).text()).toBe('ParameterChange');
      expect(types.at(1).text()).toBe('TreasuryWithdrawals');
      // And the raw ids are gone from the rows that resolved.
      expect(html).not.toContain(ACTION_A_BECH32);
      expect(html).not.toContain('1'.repeat(64));
    });

    it('keeps the truncated id for an action it cannot resolve, never a blank', async () => {
      represented();
      votedOnBoth();

      wrapper = mountPage();
      await settle();

      // `not-an-action-id` is in nobody's list and does not even parse.
      const titles = wrapper.findAll('.my-governance__row-title');
      expect(titles).toHaveLength(3);
      expect(titles.at(2).text()).toBe('not-an-action-id');
      // It parses as no action, so there is no detail page to offer.
      expect(titles.at(2).element.tagName).toBe('SPAN');
    });

    it('opens the action detail from a resolved row', async () => {
      represented();
      votedOnBoth();

      wrapper = mountPage();
      await settle();

      wrapper.findAll('.my-governance__row-link').at(0).trigger('click');
      await Vue.nextTick();

      expect(push).toHaveBeenCalledWith({
        name: 'governanceAction',
        params: { txHash: '1'.repeat(64), index: '0' },
      });
    });

    it('opens the rationale dialog with that vote own anchor, and only on a click', async () => {
      represented();
      votedOnBoth();

      wrapper = mountPage();
      await settle();

      // Nothing is mounted until asked: opening it is what sends a request to
      // an author's host, and a render must never do that.
      expect(wrapper.findComponent({ name: 'RationaleDialog' }).exists()).toBe(false);

      const rationale = wrapper.findAll('.my-governance__rationale');
      // One vote of the three published a rationale.
      expect(rationale).toHaveLength(1);
      rationale.at(0).trigger('click');
      await Vue.nextTick();

      const dialog = wrapper.findComponent({ name: 'RationaleDialog' });
      expect(dialog.props('isOpen')).toBe(true);
      expect(dialog.props('url')).toBe('https://author.test/r.json');
      expect(dialog.props('hash')).toBe(RATIONALE_HASH);
      expect(dialog.props('actionTitle')).toBe('Increase maxBlockExUnits');
    });

    it('loads the action list once, unfiltered, when a record arrives with votes', async () => {
      represented();
      getDRepById.mockResolvedValue({
        registered: true,
        votes: [{ proposal_id: ACTION_A_HEX, vote: 'yes', block_time: 300 }],
      });

      wrapper = mountPage();
      await settle();

      expect(listProposals).toHaveBeenCalledTimes(1);
      // A board left filtered to "active" would hide every closed action a past
      // vote points at, so the first load clears the filters it inherits.
      const params = listProposals.mock.calls[0][0] as Record<string, unknown>;
      expect(params['status']).toBeUndefined();
      expect(params['type']).toBeUndefined();
    });

    it('spends no request on a record with nothing to name', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });

      wrapper = mountPage();
      await settle();

      expect(listProposals).not.toHaveBeenCalled();
    });
  });

  // The page is two columns: what the stake is doing on the left, everything
  // that comments on it on the right. Before this, the watchdog and the "what
  // each state means" legend each took a full-width row of their own.
  describe('layout', () => {
    it('keeps the watchdog, the legend and the DRep pitch out of the main column', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });
      // A watched DRep with nothing wrong: the shape the panel takes on this
      // page most of the time, and the one the redesign moves into the column.
      governanceAlertsStore.state.drepId = 'drep1yfrexample';
      governanceAlertsStore.state.evaluatedAt = 1_700_000_000_000;

      wrapper = mountPage();
      await settle();

      const side = wrapper.find('.my-governance__side');
      expect(side.exists()).toBe(true);
      expect(side.find('.my-governance__legend').exists()).toBe(true);
      expect(side.find('.my-governance__promo').exists()).toBe(true);
      // The watchdog too — it renders nothing at all until it has a DRep to
      // watch, which is why the store is given one above.
      expect(side.find('.delegation-alerts').exists()).toBe(true);

      const main = wrapper.find('.my-governance__main');
      expect(main.find('.my-governance__hero').exists()).toBe(true);
      expect(main.find('.my-governance__record').exists()).toBe(true);
      expect(main.find('.my-governance__legend').exists()).toBe(false);
    });

    it('carries the glass material on the hero and the panels, per the canvas', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });

      wrapper = mountPage();
      await settle();

      for (const selector of [
        '.my-governance__hero',
        '.my-governance__record',
        '.my-governance__legend',
        '.my-governance__promo',
      ]) {
        expect(wrapper.find(selector).classes()).toContain('glass-panel');
      }
    });

    it('shows the DRep own avatar in the status chip, ipfs included', async () => {
      represented();
      getDRepById.mockResolvedValue({
        registered: true,
        votes: [],
        metadata: {
          meta_json: {
            body: {
              givenName: 'Cardano Foundation',
              image: { contentUrl: 'ipfs://bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u' },
            },
          },
        },
      });

      wrapper = mountPage();
      await settle();

      const img = wrapper.find('.my-governance__drep-chip img');
      expect(img.exists()).toBe(true);
      expect(img.attributes('src')).toContain('/api/ipfs?path=bafybeickzy3mupolsvukd2pt7huyba7a3wkln7vcfr47wnjkna7no6g72u');
    });

    it('falls back to the DRep initial rather than a broken image', async () => {
      represented();
      getDRepById.mockResolvedValue({
        registered: true,
        votes: [],
        metadata: { meta_json: { body: { givenName: 'Meridian Collective' } } },
      });

      wrapper = mountPage();
      await settle();

      expect(wrapper.find('.my-governance__drep-chip img').exists()).toBe(false);
      expect(wrapper.find('.my-governance__drep-chip .drep-avatar__initial').text()).toBe('M');
    });
  });

  it('surfaces a retryable error instead of an empty page when the lookup fails', async () => {
    represented();
    getDRepById.mockRejectedValue(new Error('boom'));

    wrapper = mountPage();
    await settle();

    const html = wrapper.html();
    expect(html).toContain('governance.drepLookupFailed');
    // The state surfaces are gone; only the error is offered, with its retry.
    expect(html).not.toContain('governance.howYourStakeWasCast');
  });
  describe('the registration gate', () => {
    // Registering posts a deposit and a certificate on chain, so the router
    // gates `governanceRegister` on the VOTING sub-flag as well as the master
    // one. Every other way in already honoured that; this page did not, so the
    // "Become a DRep" card was a button that bounced off the guard straight back
    // to the dashboard, leaving an unhandled navigation rejection behind it.
    it('offers no registration card while voting is off', async () => {
      vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(false);
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });

      wrapper = mountPage();
      await settle();

      expect(wrapper.find('.my-governance__promo').exists()).toBe(false);
      expect(wrapper.html()).not.toContain('navigation.becomeDRep');
    });

    it('offers it once voting is on', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });

      wrapper = mountPage();
      await settle();

      expect(wrapper.find('.my-governance__promo').exists()).toBe(true);
      expect(wrapper.html()).toContain('navigation.becomeDRep');
    });

    it('raises no manage-registration CTA for a self-DRep while voting is off', async () => {
      // The same gated route by another door: managing a registration lands on
      // `governanceRegister` too, so with voting off there is nothing to offer.
      vi.spyOn(featureFlagsStore, 'isGovernanceVotingEnabled').mockReturnValue(false);
      walletStore.account = {
        active: true,
        drep_id: 'drep1yfrexample',
        controlled_amount: '23718000000',
        withdrawable_amount: '0',
      } as unknown as typeof walletStore.account;
      getDRepById.mockResolvedValue({ registered: true, votes: [] });

      wrapper = mountPage();
      await settle();

      expect(wrapper.html()).not.toContain('governance.manageRegistration');
    });
  });
  describe('changing an existing delegation', () => {
    // Raised in testing: the only place to pick Always Abstain / Always No
    // Confidence was the bottom of a 1,682-row directory, and a delegated wallet
    // had no way to step back from its DRep at all.
    it('offers the ways to change it once a DRep is delegated', async () => {
      represented();
      getDRepById.mockResolvedValue({ registered: true, votes: [] });

      wrapper = mountPage();
      await settle();

      const change = wrapper.find('.my-governance__change');
      expect(change.exists()).toBe(true);
      expect(change.text()).toContain('governance.changeToAnotherDRep');
      expect(change.text()).toContain('governance.stepBackToAbstain');
      expect(change.text()).toContain('governance.chooseNoConfidence');
      // States the ledger rule rather than offering an "undelegate" that CIP-1694
      // has no certificate for.
      expect(change.text()).toContain('governance.changeDelegationNote');
    });

    it('does not offer to change a delegation that does not exist', async () => {
      // No drep_id: that is the registeredNoDRep conversation above, which is
      // about unblocking withdrawals and already offers all three.
      walletStore.account = {
        active: true,
        controlled_amount: '23718000000',
        withdrawable_amount: '0',
      } as unknown as typeof walletStore.account;

      wrapper = mountPage();
      await settle();

      expect(wrapper.find('.my-governance__change').exists()).toBe(false);
    });

    it('marks the choice already in force rather than offering it again', async () => {
      walletStore.account = {
        active: true,
        drep_id: 'drep_always_abstain',
        controlled_amount: '23718000000',
        withdrawable_amount: '0',
      } as unknown as typeof walletStore.account;

      wrapper = mountPage();
      await settle();

      const change = wrapper.find('.my-governance__change');
      expect(change.exists()).toBe(true);
      expect(change.text()).toContain('governance.alreadyAbstaining');
      expect(change.text()).not.toContain('governance.stepBackToAbstain');
    });
  });
describe('a delegation the chain has not confirmed', () => {
  /** A pending tx carrying a vote-delegation certificate, as the mempool holds it. */
  function pendingVoteDelegation(type = Cardano.CertificateType.VoteDelegation): void {
    walletStore.transactions = [
      { pending: true, body: { certificates: [{ __typename: type }] } },
    ] as unknown as typeof walletStore.transactions;
  }

  it('says the change is on its way, without claiming it landed', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    pendingVoteDelegation();

    wrapper = mountPage();
    await settle();

    const pending = wrapper.find('.my-governance__pending');
    expect(pending.exists()).toBe(true);
    expect(pending.text()).toContain('governance.delegationPendingTitle');
    // The state below is still the one in force, and still says so. The
    // qualifier explains it; it does not replace it.
    expect(wrapper.html()).toContain('governance.status.represented.title');
  });

  it('stops asking an undelegated wallet to take a position it just took', async () => {
    // The reported bug: submitting from the empty state left three big cards up
    // telling the user to do the thing they had just paid a fee to do.
    registeredNoDRep();
    pendingVoteDelegation();

    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.my-governance__pending').exists()).toBe(true);
    expect(wrapper.find('.my-governance__choices').exists()).toBe(false);
  });

  it('says what the stake follows now, so the card is not a hole with buttons', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });

    wrapper = mountPage();
    await settle();

    const change = wrapper.find('.my-governance__change');
    expect(change.exists()).toBe(true);
    expect(change.text()).toContain('governance.changeCurrentDrep');
  });

  it('offers no second certificate while one is still in flight', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });
    pendingVoteDelegation();

    wrapper = mountPage();
    await settle();

    // Changing now would replace the certificate still waiting.
    expect(wrapper.find('.my-governance__change').exists()).toBe(false);
    expect(wrapper.find('.my-governance__support').exists()).toBe(false);
  });

  it.each([
    ['StakeVoteDelegation', Cardano.CertificateType.StakeVoteDelegation],
    ['VoteRegistrationDelegation', Cardano.CertificateType.VoteRegistrationDelegation],
    ['StakeVoteRegistrationDelegation', Cardano.CertificateType.StakeVoteRegistrationDelegation],
  ])('recognises a pending %s too', async (_label, type) => {
    // A first-time delegator and anyone delegating stake and vote together emit
    // these, and they are exactly the users who most need the feedback.
    registeredNoDRep();
    pendingVoteDelegation(type);

    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.my-governance__pending').exists()).toBe(true);
  });

  it('goes away once nothing is pending', async () => {
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [] });

    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.my-governance__pending').exists()).toBe(false);
  });
});

describe('supporting the DRep (CIP-149)', () => {
  const WITH_PAYMENT = {
    registered: true,
    votes: [],
    drep_id: 'drep1yfrexample',
    metadata: { meta_json: { body: { paymentAddress: 'addr1qxexample' } } },
  };

  it('says plainly when no share is being sent', async () => {
    represented();
    getDRepById.mockResolvedValue(WITH_PAYMENT);
    governanceStore.currentCompensationBps = null;

    wrapper = mountPage();
    await settle();

    const support = wrapper.find('.my-governance__support');
    expect(support.exists()).toBe(true);
    expect(support.text()).toContain('governance.supportOff');
    expect(support.text()).toContain('governance.supportStart');
    expect(support.text()).not.toContain('governance.supportStop');
  });

  it('states the rate as a percentage, not as raw bps', async () => {
    // The stored unit is TENTHS of a percent: 50 is 5.0%, because the withdrawal
    // builder divides by 1000. Rendering 50 would overstate it a hundredfold.
    represented();
    getDRepById.mockResolvedValue(WITH_PAYMENT);

    wrapper = mountPage();
    await settle();
    // Set AFTER the load: applyGovernanceHydration recomputes the rate from
    // confirmed CIP-149 metadata on every load, so a value set before mount is
    // overwritten. This is the store the section actually binds to.
    governanceStore.currentCompensationBps = 50;
    await settle();

    const support = wrapper.find('.my-governance__support');
    expect(support.text()).toContain('5.0%');
    expect(support.text()).toContain('governance.supportStop');
  });

  it('warns when the DRep published nowhere to receive it', async () => {
    // The withdrawal builder drops the donation output silently in this case, so
    // the commitment would never be honoured and nothing would say so.
    represented();
    getDRepById.mockResolvedValue({ registered: true, votes: [], drep_id: 'drep1yfrexample' });

    wrapper = mountPage();
    await settle();
    governanceStore.currentCompensationBps = 50;
    await settle();

    expect(wrapper.find('.my-governance__support').text()).toContain('governance.supportNoPayoutAddress');
  });

  it('is not offered for a keyword choice, which has nobody to pay', async () => {
    walletStore.account = {
      active: true,
      drep_id: 'drep_always_abstain',
      controlled_amount: '23718000000',
      withdrawable_amount: '0',
    } as unknown as typeof walletStore.account;

    wrapper = mountPage();
    await settle();

    expect(wrapper.find('.my-governance__support').exists()).toBe(false);
  });
});
});
