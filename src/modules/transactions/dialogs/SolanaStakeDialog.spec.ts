// Solana Stake / Unstake / Withdraw dialog: it checks what the worker will check, sends only what
// the user chose plus the reviewed limits, and shows the worker's code as text.
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: send } }));
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({ loggedWallet: null as unknown, solana: { lamports: '10000000000' as string | null } }),
}));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'SOL' } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({
  default: {
    props: ['disabled', 'loading'],
    emits: ['click'],
    template: `<button type="button" :disabled="disabled" @click="$emit('click')"><slot /></button>`,
  },
}));

import SolanaStakeDialog from './SolanaStakeDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import { MessageTypes } from '@/models/MessageTypes';
import type { SolanaStakeAccount, SolanaStakeInfo, SolanaValidator } from '@/chains/solana/solanaStaking';

const OWNER = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const STAKE = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const SIGNATURE = '5'.repeat(88);
const SOL = 1_000_000_000n;
const PRICES = { fees: { standard: '5000', fast: '5000' }, prices: { standard: '0', fast: '1000' }, live: true };
const INFO: SolanaStakeInfo = { epoch: 700, slotIndex: 1, slotsInEpoch: 432_000, minimumDelegation: SOL, rentExemptReserve: 2_282_880n };
const VALIDATORS: SolanaValidator[] = [{
  votePubkey: VOTE, nodePubkey: OWNER, name: 'Certus', website: null, iconUrl: null, details: null,
  commission: 15, activatedStake: SOL, delinquent: false, lastEpochCredits: 1,
}];
const ACCOUNT: SolanaStakeAccount = {
  address: STAKE, state: 'inactive', role: 'both', lamports: 2n * SOL, rentExemptReserve: 2_282_880n, staker: OWNER, withdrawer: OWNER,
  voter: VOTE, delegatedStake: 2n * SOL, activeStake: 0n, activatingStake: 0n, deactivatingStake: 0n, activationEpoch: 1,
  deactivationEpoch: 2, withdrawableLamports: 2n * SOL, lockedUp: false,
};

function answer(quote: unknown, result: unknown = { data: { success: true, result: { signature: SIGNATURE } } }) {
  send.mockImplementation(async ({ method }: { method: string }) => {
    if (method === MessageTypes.SOLANA_SEND_QUOTE) return { data: { success: true, result: PRICES } };
    if (method === MessageTypes.SOLANA_STAKE_QUOTE) return quote;
    return result;
  });
}

// The validator picker as a plain input: Vuetify's autocomplete needs a layout the test has not.
const AutocompleteStub = {
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `<input data-test="stake-validator" @input="$emit('update:modelValue', $event.target.value)" />`,
};

function render(action: 'stake' | 'unstake' | 'withdraw', account: SolanaStakeAccount | null = null) {
  return mount(SolanaStakeDialog as unknown as Parameters<typeof mount>[0], {
    props: { modelValue: true, action, account, validators: VALIDATORS, info: INFO },
    global: { plugins: [createTestVuetify()], mocks: { $t: (key: string) => key }, stubs: { VAutocomplete: AutocompleteStub } },
  });
}

enableAutoUnmount(afterEach);

describe('SolanaStakeDialog', () => {
  beforeEach(() => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.SOLANA, network: Network.DEVNET, publicKey: OWNER, encryptionMethod: 'password' } as never;
    (walletStore as unknown as { solana: unknown }).solana = { lamports: '10000000000' };
    send.mockReset();
  });

  it('holds Continue below the minimum and when too little would stay for later fees', async () => {
    answer({ data: { success: false } });
    const wrapper = render('stake');
    await flushPromises();
    await wrapper.find('[data-test="stake-validator"]').setValue(VOTE);
    expect(wrapper.find('[data-test="stake-high-commission"]').exists()).toBe(true);
    await wrapper.find('[data-test="stake-amount"]').setValue('0.5');
    expect(wrapper.find('[data-test="stake-amount-error"]').text()).toBe('solana.staking.error.belowMinimum');
    await wrapper.find('[data-test="stake-amount"]').setValue('9.995');
    expect(wrapper.find('[data-test="stake-amount-error"]').text()).toBe('solana.staking.error.keepSol');
    expect(wrapper.find('[data-test="stake-continue"]').attributes('disabled')).toBeDefined();
  });

  it('stakes with the validator, lamports and fee level, holding the send to the reviewed cost', async () => {
    const quote = { action: 'stake', stakeAccount: STAKE, voteAccount: VOTE, lamports: '2000000000', reserveLamports: '2282880', feeLamports: '5000' };
    answer({ data: { success: true, result: quote } });
    const wrapper = render('stake');
    await flushPromises();
    await wrapper.find('[data-test="stake-validator"]').setValue(VOTE);
    await wrapper.find('[data-test="stake-amount"]').setValue('2');
    await wrapper.find('[data-test="stake-continue"]').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith({
      method: MessageTypes.SOLANA_STAKE_QUOTE,
      data: { action: 'stake', voteAccount: VOTE, lamports: '2000000000', feeLevel: 'standard' },
    });
    expect(wrapper.find('[data-test="stake-review-account"]').text()).toBe(STAKE);
    await wrapper.find('[data-test="stake-password"]').setValue('pw');
    await wrapper.find('[data-test="stake-confirm"]').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith({
      method: MessageTypes.SOLANA_STAKE,
      data: { action: 'stake', voteAccount: VOTE, lamports: '2000000000', feeLevel: 'standard', maxSolCost: '2002287880', password: 'pw' },
    });
    expect(wrapper.find('[data-test="stake-done"]').exists()).toBe(true);
    expect(wrapper.emitted('done')).toHaveLength(1);
  });

  it('withdraws a stake account with the reviewed amount as the least received', async () => {
    const quote = { action: 'withdraw', stakeAccount: STAKE, voteAccount: VOTE, lamports: '2000000000', reserveLamports: '0', feeLamports: '5000' };
    answer({ data: { success: true, result: quote } });
    const wrapper = render('withdraw', ACCOUNT);
    await flushPromises();
    await wrapper.find('[data-test="stake-continue"]').trigger('click');
    await flushPromises();
    await wrapper.find('[data-test="stake-password"]').setValue('pw');
    await wrapper.find('[data-test="stake-confirm"]').trigger('click');
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith({
      method: MessageTypes.SOLANA_STAKE,
      data: { action: 'withdraw', stakeAccount: STAKE, feeLevel: 'standard', maxSolCost: '5000', minReceived: '2000000000', password: 'pw' },
    });
  });

  it('shows the worker\'s refusal as text', async () => {
    answer({ data: { success: false, error: 'STAKE_NOT_ACTIVE' } });
    const wrapper = render('unstake', { ...ACCOUNT, state: 'active', activeStake: 2n * SOL });
    await flushPromises();
    await wrapper.find('[data-test="stake-continue"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="stake-quote-error"]').text()).toBe('solana.staking.error.notActive');
  });

  it.each([
    ['SIMULATION_FAILED', 'solana.staking.error.simulationFailed'],
    ['COST_CHANGED', 'solana.staking.error.costChanged'],
    ['SOMETHING_NEW', 'solana.staking.error.failed'],
  ])('says %s in staking words, not a transfer one', async (code, key) => {
    answer({ data: { success: false, error: code } });
    const wrapper = render('withdraw', ACCOUNT);
    await flushPromises();
    await wrapper.find('[data-test="stake-continue"]').trigger('click');
    await flushPromises();
    expect(wrapper.find('[data-test="stake-quote-error"]').text()).toBe(key);
  });
});
