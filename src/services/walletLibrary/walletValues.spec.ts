// Each wallet's value in the wallet list comes from the portfolio server's
// newest snapshot (#1332): tokens and NFTs included, mainnet Cardano only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getWalletHistory = vi.hoisted(() => vi.fn());
vi.mock('@/api/market-api', async (original) => ({
  ...(await original<object>()),
  default: { getWalletHistory },
}));

import {
  clearCachedValues,
  fetchWalletValue,
  hasPortfolioValue,
  latestValue,
  readCachedValues,
  writeCachedValue,
} from './walletValues';
import type { WalletSnapshot } from '@/api/market-api';
import { Blockchain, Network } from '@/models/types';

const STAKE = 'stake1u8j40zgr2gy4788kl54h6x3gu0pukq5lfr8nflufpg5dzaskqlx2l';
const snapshot = (timestamp: number, totalValueAda: number, extra: Partial<WalletSnapshot> = {}) =>
  ({ timestamp, totalValueAda, totalValueUsd: totalValueAda / 2, totalValueEur: totalValueAda / 3, adaBalance: 0, tokenValueAda: 0, nftValueAda: 0, ...extra }) as WalletSnapshot;

beforeEach(() => {
  getWalletHistory.mockReset();
  localStorage.clear();
});
afterEach(() => localStorage.clear());

describe('hasPortfolioValue', () => {
  it('values Cardano mainnet wallets by their stake address', () => {
    expect(hasPortfolioValue({ chain: Blockchain.CARDANO, network: Network.MAINNET }, STAKE)).toBe(true);
    // Records from before the chain field are Cardano.
    expect(hasPortfolioValue({ chain: undefined as never, network: Network.MAINNET }, STAKE)).toBe(true);
  });

  it('leaves testnets, other chains and wallets without a stake address alone', () => {
    expect(hasPortfolioValue({ chain: Blockchain.CARDANO, network: Network.PREPROD }, 'stake_test1uq')).toBe(false);
    expect(hasPortfolioValue({ chain: Blockchain.BITCOIN, network: Network.MAINNET }, STAKE)).toBe(false);
    expect(hasPortfolioValue({ chain: Blockchain.MIDNIGHT, network: Network.MAINNET }, STAKE)).toBe(false);
    expect(hasPortfolioValue({ chain: Blockchain.CARDANO, network: Network.MAINNET }, '')).toBe(false);
  });
});

describe('latestValue', () => {
  it('takes the newest snapshot, in milliseconds', () => {
    expect(latestValue([snapshot(100, 6), snapshot(300, 12), snapshot(200, 9)])).toEqual({ ada: 12, usd: 6, eur: 4, at: 300_000 });
  });

  it('skips snapshots it cannot read, and stands USD in for a missing EUR', () => {
    const value = latestValue([
      snapshot(500, Number.NaN),
      snapshot(0, 30),
      snapshot(400, 8, { totalValueEur: undefined as never }),
    ]);
    expect(value).toEqual({ ada: 8, usd: 4, eur: 4, at: 400_000 });
  });

  it('has nothing for an empty or unreadable answer', () => {
    expect(latestValue([])).toBeNull();
    expect(latestValue(null)).toBeNull();
    expect(latestValue('nope' as never)).toBeNull();
  });
});

describe('fetchWalletValue', () => {
  it('asks for the hourly history with tokens and NFTs, and reads its newest snapshot', async () => {
    getWalletHistory.mockResolvedValue({ state: 'ready', data: [snapshot(100, 6), snapshot(200, 10)] });

    await expect(fetchWalletValue(STAKE)).resolves.toEqual({ state: 'ready', value: { ada: 10, usd: 5, eur: 10 / 3, at: 200_000 } });
    expect(getWalletHistory).toHaveBeenCalledWith(STAKE, '1H', false);
  });

  it('passes on "not ready" with the server\'s hint, clamped', async () => {
    getWalletHistory.mockResolvedValue({ state: 'pending', retryAfterSeconds: 2 });

    await expect(fetchWalletValue(STAKE)).resolves.toEqual({ state: 'pending', retryAfterMs: 5_000 });
  });
});

describe('the value cache', () => {
  it('keeps each wallet\'s last-known value with when it was read, until cleared', () => {
    writeCachedValue(STAKE, { ada: 1, usd: 2, eur: 3, at: 4 }, 5);
    writeCachedValue('stake1other', { ada: 6, usd: 7, eur: 8, at: 9 }, 10);

    expect(readCachedValues()).toEqual({
      [STAKE]: { ada: 1, usd: 2, eur: 3, at: 4, fetchedAt: 5 },
      stake1other: { ada: 6, usd: 7, eur: 8, at: 9, fetchedAt: 10 },
    });
    clearCachedValues();
    expect(readCachedValues()).toEqual({});
  });

  it('reads a damaged cache as empty', () => {
    localStorage.setItem('gero.walletListValues.v1', '{not json');
    expect(readCachedValues()).toEqual({});
    localStorage.setItem('gero.walletListValues.v1', '[1]');
    expect(readCachedValues()).toEqual({});
  });
});
