// The panel's staking: the account's stake accounts with what each offers, opened in a sheet;
// a failed read offers a retry; hidden balances stay masked.
import * as Vue from 'vue';
import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SolanaStakeAccount, SolanaStakeInfo, SolanaStakes, SolanaValidator } from '@/chains/solana/solanaStaking';

const OWNER = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const OTHER = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const SOL = 1_000_000_000n;

const staking = vi.hoisted(() => ({ state: null as unknown as Record<string, unknown> }));
vi.mock('@/shared/composables/useSolanaStaking', () => ({ useSolanaStaking: () => staking.state }));
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({ loggedWallet: { chain: 'Solana', network: 'Devnet', publicKey: 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk' }, config: { hideBalances: false } }),
}));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'SOL' } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: { props: ['disabled', 'loading'], emits: ['click'], template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot /></button>` },
}));
const sheetProps = vi.hoisted(() => ({ last: null as null | Record<string, unknown> }));
vi.mock('./flows/SolanaStakeSheet.vue', () => ({
  default: {
    props: ['modelValue', 'action', 'account', 'validators', 'validatorsFailed', 'info'],
    setup(props: Record<string, unknown>) {
      Vue.watchEffect(() => { sheetProps.last = { ...props }; });
      return () => Vue.h('div');
    },
  },
}));

import SolanaStakingSectionSfc from './SolanaStakingSection.vue';
import { walletStore } from '@/stores/walletStore';

const Section = SolanaStakingSectionSfc as unknown as Parameters<typeof mount>[0];

const account = (fields: Partial<SolanaStakeAccount> = {}): SolanaStakeAccount => ({
  address: OTHER, state: 'active', role: 'both', lamports: 2n * SOL, rentExemptReserve: 2_282_880n, staker: OWNER, withdrawer: OWNER,
  voter: VOTE, delegatedStake: 2n * SOL, activeStake: 2n * SOL, activatingStake: 0n, deactivatingStake: 0n, activationEpoch: 1,
  deactivationEpoch: null, withdrawableLamports: 0n, lockedUp: false, ...fields,
});
const validator: SolanaValidator = {
  votePubkey: VOTE, nodePubkey: OWNER, name: 'Certus', website: null, iconUrl: null, details: null,
  commission: 5, activatedStake: SOL, delinquent: false, lastEpochCredits: 1,
};
const INFO: SolanaStakeInfo = { epoch: 700, slotIndex: 216_000, slotsInEpoch: 432_000, minimumDelegation: SOL, rentExemptReserve: 2_282_880n };

function use(stakes: SolanaStakes | null, opts: { failed?: boolean; info?: SolanaStakeInfo | null } = {}) {
  const load = vi.fn();
  const ensureValidators = vi.fn();
  staking.state = {
    stakes: Vue.shallowRef(stakes),
    validators: Vue.shallowRef([validator]),
    info: Vue.shallowRef(opts.info === undefined ? INFO : opts.info),
    byVote: Vue.computed(() => new Map([[VOTE, validator]])),
    loading: Vue.ref(false),
    failed: Vue.ref(opts.failed ?? false),
    validatorsFailed: Vue.ref(false),
    load,
    reloadAfterAction: vi.fn(),
    ensureValidators,
    owner: Vue.computed(() => OWNER),
  };
  return Object.assign(load, { ensureValidators });
}

function render() {
  return mount(Section, {
    global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-icon': true } },
  });
}

enableAutoUnmount(afterEach);

describe('SolanaStakingSection', () => {
  beforeEach(() => {
    (walletStore as unknown as { config: { hideBalances: boolean } }).config.hideBalances = false;
    sheetProps.last = null;
  });

  it('lists each stake account with its validator, state and the action it offers', async () => {
    use({ epoch: 700, accounts: [account(), account({ address: OWNER.replace('H', 'J'), state: 'inactive', activeStake: 0n, withdrawableLamports: 2n * SOL })], truncated: false, dropped: 0 });
    const wrapper = render();
    const rows = wrapper.findAll('[data-test="sol-panel-stake-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('Certus');
    expect(rows[0].text()).toContain('solana.staking.state.active');
    expect(rows[0].find('[data-test="sol-panel-unstake"]').exists()).toBe(true);
    expect(rows[0].find('[data-test="sol-panel-withdraw"]').exists()).toBe(false);
    expect(rows[1].find('[data-test="sol-panel-withdraw"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="sol-panel-staked-total"]').text()).toBe('4 SOL');
    expect(wrapper.text()).toContain('solana.staking.selfDeclared');

    await rows[1].find('[data-test="sol-panel-withdraw"]').trigger('click');
    await flushPromises();
    expect(sheetProps.last).toMatchObject({ modelValue: true, action: 'withdraw' });
    expect((sheetProps.last?.['account'] as SolanaStakeAccount).state).toBe('inactive');
  });

  it('opens Stake once the epoch info is in, reading the validator list for its picker', async () => {
    const { ensureValidators } = use({ epoch: 700, accounts: [], truncated: false, dropped: 0 });
    const wrapper = render();
    expect(wrapper.text()).toContain('solana.staking.empty');
    await wrapper.find('[data-test="sol-panel-stake"]').trigger('click');
    expect(sheetProps.last).toMatchObject({ modelValue: true, action: 'stake', account: null });
    // The validator list is read for the picker only now.
    expect(ensureValidators).toHaveBeenCalledTimes(1);
  });

  it('offers a retry when the read failed, and keeps Stake off without the epoch info', async () => {
    const load = use(null, { failed: true, info: null });
    const wrapper = render();
    expect(wrapper.find('[data-test="sol-panel-stake"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('solana.staking.loadFailed');
    await wrapper.find('[role="alert"] button').trigger('click');
    expect(load).toHaveBeenCalled();
  });

  it('masks amounts when balances are hidden', () => {
    (walletStore as unknown as { config: { hideBalances: boolean } }).config.hideBalances = true;
    use({ epoch: 700, accounts: [account()], truncated: false, dropped: 0 });
    const wrapper = render();
    expect(wrapper.find('[data-test="sol-panel-staked-total"]').text()).toBe('•••• SOL');
    expect(wrapper.find('[data-test="sol-panel-stake-row"]').text()).not.toContain('2 SOL');
  });
});
