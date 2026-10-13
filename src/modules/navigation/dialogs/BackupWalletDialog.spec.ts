import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { deferred, dialogControls } from '@test/helpers/dialogControls';

// Public BIP-39 test vector, never wallet data.
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const mocks = vi.hoisted(() => ({
  validate: vi.fn(async () => ({ valid: true, errors: [] })),
  decrypt: vi.fn(), decryptPrf: vi.fn(), backup: vi.fn(), error: vi.fn(),
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', async () => ({ default: (await import('@test/helpers/dialogControls')).DialogShell }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', async () => ({ default: (await import('@test/helpers/dialogControls')).PasswordInput }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', async () => ({
  default: { setBackup: mocks.backup },
  walletStore: (await import('vue')).reactive({ loggedWallet: {}, config: { backup: false }, isLocked: false }),
}));
vi.mock('@/shared/utils/crypto', () => ({ SecretPurpose: { Mnemonic: 'mnemonic' }, decrypt: mocks.decrypt }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ decryptMnemonicWithPrf: mocks.decryptPrf }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: vi.fn(), setError: mocks.error } }));

import BackupWalletDialog from './BackupWalletDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockReset().mockResolvedValue({ valid: true, errors: [] });
  mocks.decrypt.mockReset().mockReturnValue(PHRASE);
  mocks.decryptPrf.mockReset().mockResolvedValue(PHRASE);
  walletStore.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet', encryptedMnemonic: 'ciphertext-1' } as never;
  walletStore.isLocked = false;
});
function render() {
  return mount(BackupWalletDialog, { props: { isOpen: true }, global: {
    stubs: dialogControls(mocks.validate), config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
  } });
}
type View = ReturnType<typeof render>;
const button = (wrapper: View, label: string) => wrapper.findAll('button').find(entry => entry.text().includes(label))!;
const seed = (wrapper: View) => (wrapper.vm as unknown as { seedPhrase: string[] }).seedPhrase;
async function interrupt(wrapper: View, change: 'close' | 'wallet' | 'network' | 'lock') {
  if (change === 'close') await wrapper.setProps({ isOpen: false });
  if (change === 'wallet') walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
  if (change === 'network') walletStore.loggedWallet = { ...walletStore.loggedWallet, network: 'Preprod' };
  if (change === 'lock') walletStore.isLocked = true;
}

describe('backup phrase authorization', () => {
  it('reveals the decrypted phrase only after a valid awaited form result', async () => {
    const wrapper = render();
    await wrapper.find('[data-testid="current-password"]').setValue('password');
    await button(wrapper, 'WALLET.UNLOCK').trigger('click');
    await flushPromises();
    expect(mocks.decrypt).toHaveBeenCalledWith('ciphertext-1', 'password', 'mnemonic');
    expect(seed(wrapper)).toEqual(PHRASE.split(' '));
    expect(wrapper.find('[data-testid="seed-overlay"]').attributes('data-protected')).toBe('false');
  });

  it.each(['close', 'wallet', 'network', 'lock'] as const)('never decrypts if %s changes during form validation', async change => {
    const validation = deferred<{ valid: boolean; errors: never[] }>();
    mocks.validate.mockReturnValueOnce(validation.promise);
    const wrapper = render();
    await wrapper.find('[data-testid="current-password"]').setValue('password');
    await button(wrapper, 'WALLET.UNLOCK').trigger('click');
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    await interrupt(wrapper, change);
    validation.resolve({ valid: true, errors: [] });
    await flushPromises();
    expect(mocks.decrypt).not.toHaveBeenCalled();
    expect(seed(wrapper)).toEqual([]);
    expect(wrapper.find('[data-testid="seed-overlay"]').attributes('data-protected')).toBe('true');
  });

  it.each(['close', 'wallet', 'network', 'lock'] as const)('discards PassKey plaintext if %s changes during authentication', async change => {
    walletStore.loggedWallet = { ...walletStore.loggedWallet, encryptionMethod: 'prf', prfEncryptedMnemonic: 'prf-ciphertext', webAuthnCredentialId: 'credential-1' };
    const authentication = deferred<string>();
    mocks.decryptPrf.mockReturnValueOnce(authentication.promise);
    const wrapper = render();
    await button(wrapper, 'SECURITY.USEPASSKEY').trigger('click');
    await vi.waitFor(() => expect(mocks.decryptPrf).toHaveBeenCalledTimes(1));
    await interrupt(wrapper, change);
    authentication.resolve(PHRASE);
    await flushPromises();
    expect(seed(wrapper)).toEqual([]);
    expect(wrapper.find('[data-testid="seed-overlay"]').attributes('data-protected')).toBe('true');
    expect(mocks.backup).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});
