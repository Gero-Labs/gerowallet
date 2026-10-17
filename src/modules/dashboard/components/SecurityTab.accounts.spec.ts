import { mockGlobalProperties } from '@test/helpers/globalProperties';
import * as Vue from 'vue';
import { createTestVuetify } from '@test/helpers/vuetify';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { env, stub } = vi.hoisted(() => ({
  env: { send: vi.fn() },
  // A child dialog that renders nothing; the tab's own rows are what is checked.
  stub: () => ({ default: { render: () => null } }),
}));
vi.mock('@/modules/navigation/dialogs/BackupWalletDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/ChangePasswordDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/RemoteSigningDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/ChangeRecoveryPasswordDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/RevealRecoveryPhraseDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/LockSettingsDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/PinSetupDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/PatternSetupDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/LockPasswordSetupDialog.vue', stub);
vi.mock('@/modules/dashboard/dialogs/TwoFactorSetupDialog.vue', stub);
vi.mock('@/modules/dashboard/components/PatternLock.vue', stub);
vi.mock('@/shared/components/CopyButton.vue', stub);
vi.mock('qr-code-styling', () => ({ default: class { append() {} update() {} } }));
vi.mock('@/stores/geroStore', () => ({ geroStore: Vue.reactive({ wallets: {} as Record<number, unknown> }) }));
vi.mock('@/stores/walletStore', () => ({
  walletStore: Vue.reactive({ config: {}, loggedWallet: null as unknown }),
  default: { hasBackup: () => true, setWebsiteProtection: vi.fn() },
}));
vi.mock('@/stores/featureFlagsStore', () => ({ featureFlagsStore: { isCrossDeviceSigningEnabled: () => false } }));
vi.mock('@/stores/remoteSigningStore', () => ({ remoteSigningStore: { state: { settings: { enabled: false } }, needsProof: () => false } }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: env.send } }));
vi.mock('@/db/wallet-db', () => ({ getDb: async () => ({ table: () => ({ where: () => ({ first: async () => undefined }) }) }) }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/shared/composables/useFeatureNotifications', () => ({ isFeatureNew: () => false, markFeatureAsSeen: vi.fn() }));
vi.mock('@/shared/utils/trezorDispatch', () => ({ dispatchTrezor: vi.fn() }));
vi.mock('@/utils/assets', () => ({ default: { resolveChainLogo: () => '' } }));

import SecurityTab from './SecurityTab.vue';
import { geroStore } from '@/stores/geroStore';
import { walletStore } from '@/stores/walletStore';

const base = { chain: 'Cardano', network: 'Mainnet', type: 'Normal', encryptionMethod: 'password' };
const daily = { id: 1, name: 'Daily', ...base, publicKey: 'xpub-0', encryptedPrivateKey: 'sealed' };
const added = { id: 2, name: 'Account #1', ...base, publicKey: 'xpub-1', accountIndex: 1, parentWalletId: 1 };

function render(loggedWallet: Record<string, unknown>) {
  geroStore.wallets = { 1: daily, 2: added } as unknown as typeof geroStore.wallets;
  walletStore.loggedWallet = loggedWallet;
  return mount(SecurityTab as unknown as Parameters<typeof mount>[0], {
    global: {
      plugins: [createTestVuetify()],
      config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
      stubs: { 'v-window-item': { template: '<div><slot /></div>' }, NotificationDot: { template: '<div><slot /></div>' } },
    },
  });
}

afterEach(() => vi.clearAllMocks());

describe('security settings of an added account', () => {
  it('are its account #0’s, which a tap opens', async () => {
    const wrapper = render({ ...added, encryptedPrivateKey: 'sealed', secretsWalletId: 1 });
    await flushPromises();

    expect(wrapper.text()).toContain('accounts.managedBy');
    expect(wrapper.text()).toContain('accounts.accountPublicKey');
    for (const editor of ['security.lockSettings', 'settings.spendingSecuritySettings', 'settings.recoveryPhrase']) {
      expect(wrapper.text()).not.toContain(editor);
    }

    const row = wrapper.findAll('.v-list-item').find((item) => item.text().includes('accounts.managedBy'))!;
    await row.trigger('click');
    await flushPromises();
    expect(env.send).toHaveBeenCalledWith({ method: 'LOGIN', data: { wallet: daily } });
  });

  it('stay editable on account #0', async () => {
    const wrapper = render(daily);
    await flushPromises();

    expect(wrapper.text()).not.toContain('accounts.managedBy');
    expect(wrapper.text()).toContain('security.lockSettings');
    expect(wrapper.text()).toContain('settings.spendingSecuritySettings');
    expect(wrapper.text()).toContain('accounts.accountPublicKey');
  });
});
