import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PortfolioCacheService } from './portfolio-cache';

// A 202 PENDING history is "not ready", never an empty history: the service passes the
// retry hint up and returns no points.

const { getWalletHistory } = vi.hoisted(() => ({ getWalletHistory: vi.fn() }));

vi.mock('@/api/market-api', () => ({ default: { getWalletHistory } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: { loggedWallet: { stakeAddress: 'stake1uwallet' } } }));
vi.mock('@/utils/debug', () => ({ debugLog: () => {} }));

describe('PortfolioCacheService.loadForTimeframe: 202 PENDING', () => {
  beforeEach(() => {
    getWalletHistory.mockReset();
  });

  it('passes the retry hint up with no points', async () => {
    getWalletHistory.mockResolvedValue({ state: 'pending', retryAfterSeconds: 30 });

    const result = await new PortfolioCacheService().loadForTimeframe('addr1qxwallet', '7d', false);

    expect(result).toEqual({ adaData: [], usdData: [], eurData: [], pendingRetryAfterSeconds: 30 });
  });

  it('maps a ready history to points', async () => {
    getWalletHistory.mockResolvedValue({
      state: 'ready',
      data: [{ timestamp: 2, totalValueAda: 5, totalValueUsd: 2, totalValueEur: 1.8 }],
    });

    const result = await new PortfolioCacheService().loadForTimeframe('addr1qxwallet', '7d', false);

    expect(getWalletHistory).toHaveBeenCalledWith('stake1uwallet', '6H', false);
    expect(result).toEqual({ adaData: [[2_000, 5]], usdData: [[2_000, 2]], eurData: [[2_000, 1.8]] });
    expect(result.pendingRetryAfterSeconds).toBeUndefined();
  });
});
