import Vue, { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getTransactionUtxos: vi.fn() }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getTransactionUtxos: mocks.getTransactionUtxos }) }));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.observable({ loggedWallet: { chain: 'Midnight', network: 'Mainnet' } }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.observable({ addresses: { unshielded: 'mn_addr1self' } }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/components/feedback/ErrorState.vue', () => ({
  // A render function, not a template string: the test build of Vue is runtime-only.
  default: Vue.extend({
    props: { message: String },
    render(h) { return h('div', { class: 'error-state' }, this.message); },
  }),
}));

import MidnightTxUtxosSfc from './MidnightTxUtxos.vue';

// test-utils v1's mount() typings predate <script setup> components; every
// component spec in the repo trips TS2769 on this without the cast.
const MidnightTxUtxos = MidnightTxUtxosSfc as unknown as Parameters<typeof mount>[0];

const UTXOS = { txHash: 'abc', createdOutputs: [], spentOutputs: [] };

function mountUtxos(txStatus: 'pending' | 'confirmed', txHash = 'abc') {
  return mount(MidnightTxUtxos, {
    propsData: { txHash, txStatus, txType: 'send', txToken: 'NIGHT', txCounterparty: 'mn_addr1other' },
    mocks: { $t: (key: string) => key },
    stubs: { 'v-progress-circular': true },
  });
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
