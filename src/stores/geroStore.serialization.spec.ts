import { afterEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive } from 'vue';
import type { Wallet } from '@/models/types';

const env = vi.hoisted(() => {
  const writes: Record<string, unknown>[] = [];
  const set = vi.fn((value: Record<string, unknown>) => {
    // A raw Chrome-storage boundary: fail if any Vue proxy escaped the store.
    writes.push(structuredClone(value));
    return Promise.resolve();
  });
  return { writes, set, broadcast: vi.fn() };
});
vi.mock('@/utils/storageSync', () => ({ getContextType: () => 'background' }));
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: env.broadcast } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/db/gero-db', () => ({
  deleteWallet: vi.fn(), createNewWallet: vi.fn(), createNewHardwareWallet: vi.fn(),
  getAllWallets: vi.fn(), setWalletName: vi.fn(), setWalletIcon: vi.fn(), updatePrivateKeyAndMnemonic: vi.fn(),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('geroStore persistence serialization', () => {
  it.each(['immediate', 'debounced'] as const)('keeps the existing detached JSON format for %s writes', async (mode) => {
    vi.resetModules();
    vi.useFakeTimers();
    env.writes.length = 0;
    env.set.mockClear();
    vi.stubGlobal('chrome', { storage: { local: { set: env.set } }, runtime: {} });
    const { default: store, geroStore } = await import('./geroStore');
    const properties = reactive({ amount: 7n, labels: new Map([['ticker', 'GERO']]), updated: new Date('2026-10-13T00:00:00Z') });
    const record = reactive({ id: 1, name: 'Synthetic wallet', properties });
    store.setWallets({ 1: record as unknown as Wallet });
    if (mode === 'debounced') {
      env.writes.length = 0;
      env.set.mockClear();
      record.name = 'Renamed synthetic wallet';
      store.setWallets({ 1: record as unknown as Wallet });
      expect(env.set).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(env.set).toHaveBeenCalledTimes(1);
    const payload = env.writes[0]['geroStore'] as { wallets: Record<number, typeof record> };
    expect(payload.wallets[1].properties).toEqual({
      amount: '7', labels: { ticker: 'GERO' }, updated: '2026-10-13T00:00:00.000Z',
    });
    expect(payload.wallets[1].name).toBe(mode === 'immediate' ? 'Synthetic wallet' : 'Renamed synthetic wallet');
    expect(isProxy(geroStore.wallets[1])).toBe(true);
    properties.amount = 9n;
    expect(payload.wallets[1].properties.amount).toBe('7');
  });
});
