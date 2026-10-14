import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getTransactionUtxos: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getTransactionUtxos: mocks.getTransactionUtxos }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({ loggedWallet: { chain: 'Midnight', network: 'Mainnet' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.reactive({ addresses: { unshielded: 'mn_addr1self' } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/components/feedback/ErrorState.vue', () => ({
  // A render function, not a template string: the test build of Vue is runtime-only.
  default: Vue.defineComponent({
    props: { message: String },
    render() { return Vue.h('div', { class: 'error-state' }, this.message); },
  }),
}));

import MidnightTxUtxosSfc from './MidnightTxUtxos.vue';

const MidnightTxUtxos = MidnightTxUtxosSfc;

const UTXOS = { txHash: 'abc', createdOutputs: [], spentOutputs: [] };

function mountUtxos(txStatus: 'pending' | 'confirmed', txHash = 'abc') {
  return mount(MidnightTxUtxos, { props: { txHash, txStatus, txType: 'send', txToken: 'NIGHT', txCounterparty: 'mn_addr1other' }, global: { config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) }, stubs: { 'v-progress-circular': true } } });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('MidnightTxUtxos while the row is pending', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not ask the indexer for a transaction it cannot have yet, and says so instead of erroring', async () => {
    const wrapper = mountUtxos('pending', 'pending-a');
    await flush();
    expect(mocks.getTransactionUtxos).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('midnight.utxosPendingHint');
    expect(wrapper.find('.error-state').exists()).toBe(false);
  });

  it('fetches as soon as the row confirms under the same hash', async () => {
    mocks.getTransactionUtxos.mockResolvedValue(UTXOS);
    const wrapper = mountUtxos('pending', 'pending-b');
    await flush();
    expect(mocks.getTransactionUtxos).not.toHaveBeenCalled();

    await wrapper.setProps({ txStatus: 'confirmed' });
    await flush();
    await nextTick();
    expect(mocks.getTransactionUtxos).toHaveBeenCalledWith('pending-b');
    expect(wrapper.text()).toContain('midnight.utxoInputs');
    expect(wrapper.text()).not.toContain('midnight.utxosPendingHint');
  });

  it('still surfaces a real failure for a confirmed row', async () => {
    mocks.getTransactionUtxos.mockRejectedValue(new Error('401'));
    const wrapper = mountUtxos('confirmed', 'confirmed-c');
    await flush();
    await nextTick();
    expect(wrapper.find('.error-state').text()).toBe('midnight.utxoLoadFailed');
  });
});
