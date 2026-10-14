import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { VStepperWindow } from 'vuetify/components';
import { createTestVuetify } from '@test/helpers/vuetify';

const mocks = vi.hoisted(() => ({ decrypt: vi.fn(), decryptPrf: vi.fn(), backup: vi.fn() }));
vi.mock('bip39', () => ({
  // Deliberately invalid placeholders: this visual regression never uses seed material.
  generateMnemonic: () => Array(24).fill('placeholder').join(' '),
  validateMnemonic: () => false,
}));
vi.mock('@/shared/utils/crypto', () => ({ SecretPurpose: { Mnemonic: 'mnemonic' }, decrypt: mocks.decrypt }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ decryptMnemonicWithPrf: mocks.decryptPrf }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: vi.fn() } }));
vi.mock('@/utils/assets', () => ({ default: {} }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', async () => ({
  default: { setBackup: mocks.backup },
  walletStore: (await import('vue')).reactive({
    loggedWallet: { id: 1, chain: 'Cardano', network: 'Preprod' }, config: { backup: false }, isLocked: false,
  }),
}));
// Authentication has separate regression coverage. Preserve its visible input
// without probing IndexedDB or WebAuthn in this native-stepper regression.
vi.mock('@/shared/components/PassKeyPasswordField.vue', () => ({
  default: { template: '<input data-test="backup-password" type="password" />' },
}));

import BackupWalletDialog from './BackupWalletDialog.vue';

enableAutoUnmount(afterEach);
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { document.body.innerHTML = ''; });

describe('BackupWalletDialog with the real Vuetify stepper and dialog', () => {
  it('keeps the protected first step visible on initial open and reopening', async () => {
    const wrapper = mount(BackupWalletDialog, {
      attachTo: document.body,
      props: { isOpen: false },
      global: {
        plugins: [createTestVuetify()],
        mocks: { $t: (key: string) => key },
      },
    });
    for (let opening = 0; opening < 2; opening += 1) {
      await wrapper.setProps({ isOpen: true });
      await flushPromises();
      const window = wrapper.getComponent(VStepperWindow);
      const instructions = window.findAll('li').find(item => item.text() === 'wallet.backupWriteDownOrder');
      expect(instructions?.isVisible()).toBe(true);
      expect(window.props('modelValue')).toBe(1);
      const input = document.querySelector<HTMLInputElement>('[data-test="backup-password"]');
      expect(input).not.toBeNull();
      expect(input!.closest('.v-overlay--active')).not.toBeNull();
      await wrapper.setProps({ isOpen: false });
      await flushPromises();
    }
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(mocks.decryptPrf).not.toHaveBeenCalled();
    expect(mocks.backup).not.toHaveBeenCalled();
  });
});
