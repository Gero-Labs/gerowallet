import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import StepGoogleSecure from './StepGoogleSecure.vue';
import networks from '@/utils/networks';
import { Blockchain, Network } from '@/models/types';

const network = networks.resolveNetwork(Blockchain.CARDANO, Network.MAINNET);

vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: vi.fn() } }));
vi.mock('@/shared/utils/mpc/mpcPasskey', () => ({ mpcPasskeyAvailable: async () => false, enrollMpcPasskey: vi.fn() }));

describe('field labels', () => {
  it('names every field once, by its own section on the password path', async () => {
    const wrapper = mount(StepGoogleSecure, { props: { network, idToken: 'token' }, global: { plugins: [createTestVuetify()], config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) } } });
    try {
      await flushPromises();
      const names = wrapper.findAll('input').map((input) => (
        input.attributes('aria-label') ?? wrapper.find(`label[for="${input.attributes('id')}"]`).text()
      ));
      expect(names).toEqual([
        'welcome.walletName',
        'welcome.spendingPassword',
        'welcome.confirmPassword',
        'welcome.recoveryPassword',
        'welcome.confirmRecoveryPassword',
      ]);
      expect(wrapper.findAll('label, .t-label').filter((el) => el.text() === 'welcome.walletName')).toHaveLength(1);
    } finally { wrapper.unmount(); }
  });
});
