// What the list sheet reads about an NFT before the seller picks a price: its collection's
// royalty terms (needed to price the listing, so a failure blocks it) and, on mainnet where the
// market-data feed exists, the collection floor and the NFT's last sale (hints, so a failure just
// hides them).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { RoyaltyInfo } from '@/api/nft-market-api';
import { Network } from '@/models/types';

const POLICY = 'ab'.repeat(28);
const ASSET_NAME = '4e4654';
const UNIT = `${POLICY}${ASSET_NAME}`;
const INFO: RoyaltyInfo = { source: 'cip27', rate: 0.05, recipients: [{ address: 'addr1creator', rate: 0.05, minFeeLovelace: null, maxFeeLovelace: null }] };

const wallet = vi.hoisted(() => ({ loggedWallet: { network: 'Preprod' } as { network: string } | null }));
const api = vi.hoisted(() => ({
  royalties: vi.fn(),
  floor: vi.fn(),
  assetPrice: vi.fn(),
}));

vi.mock('@/stores/walletStore', () => ({ walletStore: wallet }));
vi.mock('@/api/nft-market-api', () => ({ nftMarketApi: { royalties: api.royalties } }));
vi.mock('@/api/market-api', () => ({ default: { getNftFloorPrice: api.floor, getNftAssetPrice: api.assetPrice } }));

import { useListingMarketInfo } from './useListingMarketInfo';

beforeEach(() => {
  api.royalties.mockReset().mockResolvedValue(INFO);
  api.floor.mockReset().mockResolvedValue({ floorPriceLovelace: 120_000_000 });
  api.assetPrice.mockReset().mockResolvedValue({ priceLovelace: 150_500_000 });
  wallet.loggedWallet = { network: Network.PREPROD };
});

describe('useListingMarketInfo', () => {
  it('reads the royalty terms of the NFT\'s own policy on the wallet\'s network', async () => {
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    expect(info.royaltiesState.value).toBe('idle');
    const loading = info.load();
    expect(info.royaltiesState.value).toBe('loading');
    await loading;
    expect(api.royalties).toHaveBeenCalledWith(POLICY, Network.PREPROD);
    expect(info.royaltiesState.value).toBe('ready');
    expect(info.royalties.value).toEqual(INFO);
  });

  it('does not read royalties for a sheet that does not need them (edit price keeps the old ones)', async () => {
    const info = useListingMarketInfo(() => UNIT, { royalties: false });
    await info.load();
    expect(api.royalties).not.toHaveBeenCalled();
    expect(info.royaltiesState.value).toBe('idle');
  });

  it('says failed when the terms cannot be read, so the sheet never prices a listing without them', async () => {
    api.royalties.mockRejectedValue(new Error('nope'));
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    await info.load();
    expect(info.royaltiesState.value).toBe('failed');
    expect(info.royalties.value).toBeNull();
  });

  it('retries after a failure', async () => {
    api.royalties.mockRejectedValueOnce(new Error('nope'));
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    await info.load();
    await info.load();
    expect(info.royaltiesState.value).toBe('ready');
  });

  it('asks the market feed for the floor and last sale on mainnet only', async () => {
    wallet.loggedWallet = { network: Network.MAINNET };
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    await info.load();
    expect(api.floor).toHaveBeenCalledWith(POLICY);
    expect(api.assetPrice).toHaveBeenCalledWith(POLICY, ASSET_NAME);
    expect(info.floorLovelace.value).toBe(120_000_000n);
    expect(info.lastSaleLovelace.value).toBe(150_500_000n);
  });

  it('never asks the mainnet feed about a test network', async () => {
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    await info.load();
    expect(api.floor).not.toHaveBeenCalled();
    expect(api.assetPrice).not.toHaveBeenCalled();
    expect(info.floorLovelace.value).toBeNull();
    expect(info.lastSaleLovelace.value).toBeNull();
  });

  it('leaves out a hint the feed does not have, without touching the royalties or the other hint', async () => {
    wallet.loggedWallet = { network: Network.MAINNET };
    api.floor.mockRejectedValue(new Error('404'));
    api.assetPrice.mockResolvedValue({ priceLovelace: 0 });
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    await info.load();
    expect(info.floorLovelace.value).toBeNull();
    expect(info.lastSaleLovelace.value).toBeNull();
    expect(info.royaltiesState.value).toBe('ready');
  });

  it('reads a price only when it is a positive finite number', async () => {
    wallet.loggedWallet = { network: Network.MAINNET };
    for (const bad of [Number.NaN, -5, Number.POSITIVE_INFINITY, '120', null, undefined]) {
      api.floor.mockResolvedValue({ floorPriceLovelace: bad });
      const info = useListingMarketInfo(() => UNIT, { royalties: false });
      await info.load();
      expect(info.floorLovelace.value, String(bad)).toBeNull();
    }
  });

  it('drops an answer that arrives after the NFT or the wallet has changed', async () => {
    const unit = ref(UNIT);
    let release: (value: RoyaltyInfo) => void = () => {};
    api.royalties.mockImplementationOnce(() => new Promise<RoyaltyInfo>((resolve) => { release = resolve; }));
    const info = useListingMarketInfo(() => unit.value, { royalties: true });
    const first = info.load();
    unit.value = `${'cd'.repeat(28)}4e4654`;
    await info.load();
    release({ source: 'none', rate: 0, recipients: [] });
    await first;
    await flushPromises();
    expect(info.royalties.value).toEqual(INFO);
  });

  it('forgets what it knew when it is asked to reset', async () => {
    const info = useListingMarketInfo(() => UNIT, { royalties: true });
    await info.load();
    info.reset();
    expect(info.royalties.value).toBeNull();
    expect(info.royaltiesState.value).toBe('idle');
  });
});
