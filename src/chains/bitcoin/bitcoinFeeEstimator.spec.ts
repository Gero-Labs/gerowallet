// The fee picker's rates (issue 1440): fetched from the wallet network's Esplora in
// the page, whole sat/vB, and flagged when they are the built-in fallback.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BitcoinFeeEstimates } from '@/api/bitcoin-api';

const getFeeEstimates = vi.hoisted(() => vi.fn<() => Promise<BitcoinFeeEstimates>>());
const apiNetworks = vi.hoisted(() => [] as unknown[]);
vi.mock('@/api/bitcoin-api', () => ({
  BitcoinApi: class {
    getFeeEstimates = getFeeEstimates;
    constructor(wallet: { network: string }) { apiNetworks.push(wallet.network); }
  },
}));

import { BitcoinFeeEstimator, FeePriority, getBitcoinFeeEstimator, getBitcoinFeeEstimatorFor } from './bitcoinFeeEstimator';

const ESTIMATES: BitcoinFeeEstimates = { fastestFee: 42, halfHourFee: 17, hourFee: 9, economyFee: 3, minimumFee: 1 };

beforeEach(() => {
  getFeeEstimates.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

function estimator(): BitcoinFeeEstimator {
  const e = getBitcoinFeeEstimatorFor('Mainnet');
  e.clearCache();
  return e;
}

describe('getFeeTiers', () => {
  it('maps next block, ~3 blocks and ~6 blocks to Fast, Medium and Slow from one fetch', async () => {
    getFeeEstimates.mockResolvedValue(ESTIMATES);
    await expect(estimator().getFeeTiers()).resolves.toEqual({ fast: 42, medium: 17, slow: 9, fallback: false });
    expect(getFeeEstimates).toHaveBeenCalledTimes(1);
  });

  it('rounds Esplora\'s fractional rates up to whole sat/vB, never under the minimum relay fee', async () => {
    getFeeEstimates.mockResolvedValue({ ...ESTIMATES, fastestFee: 4.017, halfHourFee: 2.5, hourFee: 0.3 });
    await expect(estimator().getFeeTiers()).resolves.toEqual({ fast: 5, medium: 3, slow: 1, fallback: false });
  });

  it('flags the built-in defaults when the network\'s rates cannot be fetched', async () => {
    getFeeEstimates.mockRejectedValue(new Error('network down'));
    await expect(estimator().getFeeTiers()).resolves.toEqual({ fast: 20, medium: 10, slow: 5, fallback: true });
  });

  it('keeps the last fetched rates, unflagged, when a refresh fails', async () => {
    const e = estimator();
    getFeeEstimates.mockResolvedValueOnce(ESTIMATES).mockRejectedValueOnce(new Error('network down'));
    await e.getFeeTiers();
    await expect(e.getFeeTiers(true)).resolves.toEqual({ fast: 42, medium: 17, slow: 9, fallback: false });
  });

  it('prices Slow at the ~6-block rate its ~60 min promises, in every reader', async () => {
    getFeeEstimates.mockResolvedValue(ESTIMATES);
    const e = estimator();
    await expect(e.getFeeEstimate(FeePriority.SLOW)).resolves.toMatchObject({ feeRate: 9, estimatedBlocks: 6 });
    expect((await e.getAllFeeEstimates())[2]).toMatchObject({ priority: FeePriority.SLOW, feeRate: 9 });
  });
});

describe('getBitcoinFeeEstimatorFor', () => {
  it('fetches in a page, where the shared estimator has no API', async () => {
    getFeeEstimates.mockResolvedValue(ESTIMATES);
    await expect(getBitcoinFeeEstimator().getFeeTiers()).rejects.toThrow('Bitcoin API not initialized');
    await expect(estimator().getFeeTiers()).resolves.toMatchObject({ medium: 17, fallback: false });
  });

  it('keeps one estimator, with its own API and cache, per network', () => {
    const mainnet = getBitcoinFeeEstimatorFor('Mainnet');
    const testnet = getBitcoinFeeEstimatorFor('Testnet');
    expect(getBitcoinFeeEstimatorFor('Mainnet')).toBe(mainnet);
    expect(testnet).not.toBe(mainnet);
    expect(apiNetworks).toEqual(['Mainnet', 'Testnet']);
  });
});
