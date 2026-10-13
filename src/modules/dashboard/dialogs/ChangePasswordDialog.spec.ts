import { mockGlobalProperties } from '@test/helpers/globalProperties';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { deferred, dialogControls } from '@test/helpers/dialogControls';
import { MessageTypes } from '@/models/MessageTypes';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(async () => ({ valid: true, errors: [] })),
  rotate: vi.fn(async (_id: number, _old: string, _next: string) => {}),
  refresh: vi.fn(async () => {}),
  getDb: vi.fn(), remove: vi.fn(async () => {}), put: vi.fn(async () => {}),
  encrypt: vi.fn(async () => 'new-autofill-ciphertext'),
  success: vi.fn(), error: vi.fn(), autofill: false,
}));
vi.mock('@/shared/dialogs/BaseDialog.vue', async () => ({ default: (await import('@test/helpers/dialogControls')).DialogShell }));
vi.mock('@/shared/components/PassKeyPasswordField.vue', async () => ({ default: (await import('@test/helpers/dialogControls')).PasswordInput }));
vi.mock('@/shared/composables/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/walletStore', async () => ({ walletStore: (await import('vue')).reactive({ loggedWallet: { id: 1, chain: 'Cardano', network: 'Mainnet' }, isLocked: false }) }));
vi.mock('@/stores/geroStore', () => ({ default: { updateSpendingPassword: mocks.rotate } }));
vi.mock('@/db/wallet-db', () => ({ getDb: mocks.getDb }));
vi.mock('@/shared/utils/webauthn-prf', () => ({ encryptSpendingPasswordWithPrf: mocks.encrypt }));
vi.mock('@/chrome/messaging', () => ({ Messaging: { sendToBackgroundFromOptions: mocks.refresh } }));
vi.mock('@/plugins/snackbar', () => ({ default: { fireSuccess: mocks.success, setError: mocks.error } }));

import ChangePasswordDialog from './ChangePasswordDialog.vue';
import { walletStore } from '@/stores/walletStore';

enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.validate.mockReset().mockResolvedValue({ valid: true, errors: [] });
  mocks.rotate.mockReset().mockResolvedValue(undefined);
  mocks.encrypt.mockReset().mockResolvedValue('new-autofill-ciphertext');
  mocks.autofill = false;
  mocks.getDb.mockImplementation(async () => ({ table: () => ({
    where: ({ key }: { key: string }) => ({
      first: async () => ({ value: key === 'passKeyForPasswordAutofill' ? mocks.autofill : 'credential-1' }),
      delete: mocks.remove,
    }), put: mocks.put,
  }) }));
  walletStore.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet' } as never;
  walletStore.isLocked = false;
});
async function render() {
  const wrapper = mount(ChangePasswordDialog, { props: { isOpen: true }, global: {
    stubs: dialogControls(mocks.validate), config: { globalProperties: mockGlobalProperties({ $t: (key: string) => key }) },
  } });
  await wrapper.find('[data-testid="current-password"]').setValue('Original1!');
  await wrapper.find('[data-label="dashboard.newPassword"]').setValue('Replacement2!');
  await wrapper.find('[data-label="dashboard.confirmNewPassword"]').setValue('Replacement2!');
  return wrapper;
}

describe('password rotation authorization', () => {
  it('does not mutate when the awaited form result is invalid', async () => {
    mocks.validate.mockResolvedValueOnce({ valid: false, errors: [] });
    const wrapper = await render();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    expect(mocks.rotate).not.toHaveBeenCalled();
  });

  it.each(['close', 'wallet', 'network', 'lock'] as const)('cancels before mutation if %s changes during form validation', async change => {
    const validation = deferred<{ valid: boolean; errors: never[] }>();
    mocks.validate.mockReturnValueOnce(validation.promise);
    const wrapper = await render();
    await wrapper.find('button').trigger('click');
    expect(mocks.validate).toHaveBeenCalledTimes(1);
    if (change === 'close') await wrapper.setProps({ isOpen: false });
    if (change === 'wallet') walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
    if (change === 'network') walletStore.loggedWallet = { ...walletStore.loggedWallet, network: 'Preprod' };
    if (change === 'lock') walletStore.isLocked = true;
    validation.resolve({ valid: true, errors: [] });
    await flushPromises();
    expect(mocks.rotate).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('finishes original-wallet refresh and stale autofill cleanup after rotation already committed', async () => {
    const rotation = deferred<void>();
    mocks.rotate.mockReturnValueOnce(rotation.promise);
    mocks.autofill = true;
    const wrapper = await render();
    await wrapper.find('button').trigger('click');
    await vi.waitFor(() => expect(mocks.rotate).toHaveBeenCalledWith(1, 'Original1!', 'Replacement2!'));
    walletStore.loggedWallet = { ...walletStore.loggedWallet, id: 2 };
    await wrapper.setProps({ isOpen: false });
    rotation.resolve();
    await flushPromises();
    expect(mocks.refresh).toHaveBeenCalledWith({ method: MessageTypes.REFRESH_LOGGED_WALLET_SECRET, data: { walletId: 1 } });
    expect(mocks.getDb.mock.calls.every(([id]) => id === 1)).toBe(true);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('removes the original stale autofill secret if re-encryption fails', async () => {
    mocks.autofill = true;
    mocks.encrypt.mockRejectedValueOnce(new Error('PassKey cancelled'));
    const wrapper = await render();
    await wrapper.find('button').trigger('click');
    await flushPromises();
    expect(mocks.encrypt).toHaveBeenCalledWith('Replacement2!', 'credential-1', 1);
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(mocks.getDb.mock.calls.every(([id]) => id === 1)).toBe(true);
    expect(mocks.error).toHaveBeenCalledWith('security.passKeyPasswordUpdateFailed');
  });
});
