// "Balances in the wallet list" (#1332) is app-wide: it is stored with the
// language in gero-db, whose config live query hands it to every context.
import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ setConfiguration: vi.fn(async () => undefined), broadcast: vi.fn() }));
vi.mock('@/utils/storageSync', () => ({ getContextType: () => 'background' }));
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: env.broadcast, registerSnapshot: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/db/gero-db', () => ({
  deleteWallet: vi.fn(), createNewWallet: vi.fn(), createNewHardwareWallet: vi.fn(), createAccountWallet: vi.fn(),
  DuplicateWalletError: class extends Error {}, getAllWallets: vi.fn(), setWalletName: vi.fn(), setWalletIcon: vi.fn(),
  updatePrivateKeyAndMnemonic: vi.fn(), setConfiguration: env.setConfiguration,
}));

describe('setWalletListBalances', () => {
  it('stores the choice in gero-db and shows it at once', async () => {
    vi.stubGlobal('chrome', { storage: { local: { set: vi.fn(async () => undefined) } }, runtime: {} });
    const { default: store, geroStore } = await import('./geroStore');

    await store.setWalletListBalances(false);
    expect(geroStore.config.walletListBalances).toBe(false);
    expect(env.setConfiguration).toHaveBeenLastCalledWith('walletListBalances', false);

    await store.setWalletListBalances(true);
    expect(geroStore.config.walletListBalances).toBe(true);
    expect(env.setConfiguration).toHaveBeenLastCalledWith('walletListBalances', true);
    vi.unstubAllGlobals();
  });

  it('puts the previous choice back when it can\'t be saved', async () => {
    vi.stubGlobal('chrome', { storage: { local: { set: vi.fn(async () => undefined) } }, runtime: {} });
    const { default: store, geroStore } = await import('./geroStore');
    geroStore.config.walletListBalances = true;
    env.setConfiguration.mockRejectedValueOnce(new Error('database closed'));

    await expect(store.setWalletListBalances(false)).rejects.toThrow('database closed');
    expect(geroStore.config.walletListBalances).toBe(true);
    vi.unstubAllGlobals();
  });
});
