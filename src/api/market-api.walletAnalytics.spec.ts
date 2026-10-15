import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import marketApi, {
  marketAxiosInstance,
  pendingRetryDelayMs,
  type WalletPnlSummary,
  type WalletSnapshot,
} from './market-api';

// cardano-market-data answers wallet P&L and history 202 PENDING, with no numbers, while a
// wallet's full history is still being fetched. gero-backend forwards the status and body but
// not the Retry-After header, so the retry hint is read from the body.
const STAKE = 'stake1u83ax56dkxw2zsc7320hqmpszys6z66scvsmmv9837yqxzsqdqs0s';
const PENDING = {
  status: 'PENDING',
  wallets: [{ stakeAddress: STAKE, backfill: 'IN_PROGRESS' }],
  retryAfterSeconds: 30,
  message: 'A requested wallet\'s history from before the indexer\'s start is still being fetched.',
};

function answer(status: number, data: unknown) {
  return vi.spyOn(marketAxiosInstance, 'get').mockResolvedValue({ status, data } as never);
}

describe('wallet analytics: 202 PENDING', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a 200 P&L is ready data', async () => {
    const summary = { stakeAddress: STAKE, totalRealizedPnlAda: 1, totalUnrealizedPnlAda: 2, tokens: [] } as unknown as WalletPnlSummary;
    answer(200, summary);

    await expect(marketApi.getWalletPnl(STAKE)).resolves.toEqual({ state: 'ready', data: summary });
  });

  it('a 202 P&L is pending with the body\'s retry hint, never numbers', async () => {
    answer(202, PENDING);

    await expect(marketApi.getWalletPnl(STAKE)).resolves.toEqual({ state: 'pending', retryAfterSeconds: 30 });
  });

  it('a 202 history is pending', async () => {
    answer(202, { ...PENDING, retryAfterSeconds: 300 });

    await expect(marketApi.getWalletHistory(STAKE, '1D', true)).resolves.toEqual({ state: 'pending', retryAfterSeconds: 300 });
  });

  it('a 200 history is ready data', async () => {
    const snapshots = [{ timestamp: 1, totalValueAda: 5 }] as unknown as WalletSnapshot[];
    answer(200, snapshots);

    await expect(marketApi.getWalletHistory(STAKE, '1D', true)).resolves.toEqual({ state: 'ready', data: snapshots });
  });

  it('a 202 without a usable hint still counts as pending, with the default hint', async () => {
    answer(202, '');

    await expect(marketApi.getWalletPnl(STAKE)).resolves.toEqual({ state: 'pending', retryAfterSeconds: 30 });
  });

  it('a PENDING body is pending even if a proxy turned the status into 200', async () => {
    answer(200, PENDING);

    await expect(marketApi.getWalletPnl(STAKE)).resolves.toEqual({ state: 'pending', retryAfterSeconds: 30 });
  });

  it('the retry delay follows the hint, clamped to 5 s .. 5 min', () => {
    expect(pendingRetryDelayMs(30)).toBe(30_000);
    expect(pendingRetryDelayMs(1)).toBe(5_000);
    expect(pendingRetryDelayMs(3_600)).toBe(300_000);
    expect(pendingRetryDelayMs(Number.NaN)).toBe(30_000);
  });
});
