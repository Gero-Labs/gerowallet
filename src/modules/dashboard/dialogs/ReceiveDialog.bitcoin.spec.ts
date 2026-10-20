// A Bitcoin wallet's receive dialog offers only the wallet's own address type. Its xpub is
// the account key of that type's purpose alone, so a Legacy or Taproot address derived
// from a SegWit wallet's key sits off the path shown, unknown to other wallets and never
// synced (issue 1338).
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { deriveBitcoinAddress } = vi.hoisted(() => ({
  deriveBitcoinAddress: vi.fn((_xpub: string, _network: string, type: string, chain: number, index: number) => `tb-${type}-${chain}-${index}`),
}));
vi.mock('@/chains/bitcoin/bitcoinKeyManager', () => ({ deriveBitcoinAddress }));
vi.mock('qr-code-styling', () => ({
  default: class {
    append(): void {}
    update(): void {}
    download(): Promise<void> {
      return Promise.resolve();
    }
  },
}));
vi.mock('@/stores/walletStore', () => ({ walletStore: Vue.reactive({ loggedWallet: null as unknown, keys: null }) }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: Vue.reactive({ addresses: {} }) }));
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'tBTC', resolveGovernanceSupport: () => false } }));
vi.mock('@/utils/assets', () => ({ default: { qrCodeSvg: '', resolveChainLogo: () => '' } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { render: () => null } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: { template: '<button type="button"><slot /></button>' } }));

import ReceiveDialog from './ReceiveDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';

function render(addressType: string) {
  walletStore.loggedWallet = { id: 1, chain: Blockchain.BITCOIN, network: Network.TESTNET, addressType, publicKey: `xpub-${addressType}`, accountIndex: 0 } as never;
  return mount(ReceiveDialog as unknown as Parameters<typeof mount>[0], {
    props: { isOpen: true },
    global: { plugins: [createTestVuetify()] },
  });
}

enableAutoUnmount(afterEach);
afterEach(() => {
  deriveBitcoinAddress.mockClear();
});

describe('ReceiveDialog on a Bitcoin wallet', () => {
  it.each([
    ['segwit', 84],
    ['legacy', 44],
    ['taproot', 86],
  ])('shows only the %s address, at that type’s own path', async (addressType, purpose) => {
    const wrapper = render(addressType);
    await flushPromises();

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(deriveBitcoinAddress.mock.calls.map(([, , type]) => type)).toEqual([addressType]);
    expect(wrapper.text()).toContain(`tb-${addressType}-0-0`);
    expect(wrapper.text()).toContain(`m/${purpose}'/1'/0'/0/0`);
  });

  it('follows a wallet switch while it is open, so the address matches the path shown', async () => {
    const wrapper = render('segwit');
    await flushPromises();

    walletStore.loggedWallet = { id: 2, chain: Blockchain.BITCOIN, network: Network.TESTNET, addressType: 'taproot', publicKey: 'xpub-taproot', accountIndex: 0 } as never;
    await flushPromises();

    expect(deriveBitcoinAddress).toHaveBeenLastCalledWith('xpub-taproot', Network.TESTNET, 'taproot', 0, 0);
    expect(wrapper.text()).toContain('tb-taproot-0-0');
    expect(wrapper.text()).toContain("m/86'/1'/0'/0/0");
  });
});
