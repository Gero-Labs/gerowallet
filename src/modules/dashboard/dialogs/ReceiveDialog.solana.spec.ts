// A Solana wallet's receive dialog shows its one address (the record's public key) at
// its account's path, with no Cardano tabs or used-address list.
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('@/utils/networks', () => ({ default: { resolveCurrencyTicker: () => 'SOL', resolveGovernanceSupport: () => false } }));
vi.mock('@/utils/assets', () => ({ default: { qrCodeSvg: '', geroLogo: '' } }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/dialogs/BaseDialog.vue', () => ({ default: { template: '<div><slot /></div>' } }));
vi.mock('@/shared/components/CopyButton.vue', () => ({ default: { render: () => null } }));
vi.mock('@/shared/components/GButton/GButton.vue', () => ({ default: { template: '<button type="button"><slot /></button>' } }));

import ReceiveDialog from './ReceiveDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';

const ACCOUNT_1 = 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb';

enableAutoUnmount(afterEach);

describe('ReceiveDialog on a Solana wallet', () => {
  it("shows the account address at m/44'/501'/n'/0', with no tabs", async () => {
    walletStore.loggedWallet = { id: 1, chain: Blockchain.SOLANA, network: Network.DEVNET, publicKey: ACCOUNT_1, accountIndex: 1 } as never;
    const wrapper = mount(ReceiveDialog as unknown as Parameters<typeof mount>[0], {
      props: { isOpen: true },
      global: { plugins: [createTestVuetify()] },
    });
    await flushPromises();
    await wrapper.find('.receive-link').trigger('click');

    expect(wrapper.findAll('[role="tab"]')).toHaveLength(0);
    expect(wrapper.text().replace(/\s/g, '')).toContain(ACCOUNT_1);
    expect(wrapper.text()).toContain("m/44'/501'/1'/0'");
    expect(wrapper.text()).toContain('solana.receiveInfo');
  });
});
