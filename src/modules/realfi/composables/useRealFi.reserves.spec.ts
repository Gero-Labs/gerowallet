import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealFiReadClient } from '../services/realfiClient';
import type { RealFiReservesReport } from '../types';

const wallet = { chain: 'Cardano', network: 'Mainnet', baseAddress: 'addr1test' };
const resolveClient = vi.fn();

vi.mock('@/stores/walletStore', () => ({
  default: { state: { get loggedWallet() { return wallet; } } },
  walletStore: { tokens: {} },
}));
vi.mock('@/stores/featureFlagsStore', () => ({
  default: { isRealFiEnabled: () => true, isRealFiStakingEnabled: () => false },
}));
vi.mock('@/stores/networkStore', () => ({ default: { getCurrentSlot: () => null } }));
vi.mock('@/utils/networks', () => ({ default: { resolveRealFiSupport: () => true } }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('../referralOptIn', () => ({ hasReferralOptIn: () => false, rememberReferralOptIn: vi.fn() }));
vi.mock('../services/realfiClient', () => ({
  resolveRealFiReadClient: (network: string) => resolveClient(network),
}));

import { useRealFi } from './useRealFi';

/** Made-up figures: RealFi's own feed is private. */
const REPORT: RealFiReservesReport = {
  publishedAt: null,
  reserves: null,
  supply: null,
  nav: { asOf: '2026-01-02', totalUsd: 1_000_000, perToken: 1.002, tokensOutstanding: null, source: 'NFS' },
  coverage: null,
  history: { supply: [], nav: [] },
};

const POSITION = {
  totalSUSDr: '1000000',
  totalUSDrValue: '1000000',
  principal: '1000000',
  earned: '0',
  yieldPercent: 0,
};

/** A read client whose reserves read answers only when the test says so. */
function client(reserves: () => Promise<RealFiReservesReport | null>): RealFiReadClient {
  return {
    getPosition: async () => POSITION,
    getPoints: async () => ({ pointsBalance: null, potentialPoints: null, multiplier: null }),
    getReferrals: async () => ({ code: null, createdAt: null, invitedCount: 0, rewardPoints: 0 }),
    getOrders: async () => [],
    getProtocol: async () => null,
    getReserves: reserves,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useRealFi: reserves', () => {
  beforeEach(() => {
    wallet.network = 'Mainnet';
    resolveClient.mockReset();
  });

  it('shows the position without waiting for the reserves feed', async () => {
    const never = deferred<RealFiReservesReport | null>();
    resolveClient.mockResolvedValue({ status: 'ok', client: client(() => never.promise) });
    const realfi = useRealFi();

    await realfi.load();

    expect(realfi.position.value).toEqual(POSITION);
    expect(realfi.isLoading.value).toBe(false);
    expect(realfi.reserves.value).toBeNull();
  });

  it('clears the report on a network switch and drops a late answer for the old network', async () => {
    const mainnet = deferred<RealFiReservesReport | null>();
    resolveClient.mockResolvedValueOnce({ status: 'ok', client: client(() => mainnet.promise) });
    resolveClient.mockResolvedValueOnce({
      status: 'ok',
      client: client(() => Promise.reject(new Error('503'))),
    });
    const realfi = useRealFi();

    await realfi.load();
    wallet.network = 'Preprod';
    await realfi.load();
    mainnet.resolve(REPORT);
    await flushPromises();

    expect(realfi.reserves.value).toBeNull();
  });

  it('keeps the shown report when a refresh on the same network fails', async () => {
    resolveClient.mockResolvedValueOnce({ status: 'ok', client: client(async () => REPORT) });
    resolveClient.mockResolvedValueOnce({
      status: 'ok',
      client: client(() => Promise.reject(new Error('503'))),
    });
    const realfi = useRealFi();

    await realfi.load();
    await flushPromises();
    expect(realfi.reserves.value).toEqual(REPORT);

    await realfi.load();
    await flushPromises();
    expect(realfi.reserves.value).toEqual(REPORT);
  });
});
