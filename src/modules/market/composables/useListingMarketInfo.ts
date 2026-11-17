import { ref, type Ref } from 'vue';
import marketApi from '@/api/market-api';
import { nftMarketApi, type RoyaltyInfo } from '@/api/nft-market-api';
import { Network } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';

/**
 * What the list sheet reads about an NFT before the seller picks a price.
 *
 *  - The collection's royalty terms (`nftMarketApi.royalties`, read by Nexus from the NFT's own
 *    policy only). They price the listing, so a failure is 'failed' and the sheet offers a retry
 *    and never lists without them: the worker refuses too (ROYALTIES_UNREADABLE).
 *  - On mainnet, the collection floor and the NFT's last sale from the market-data feed
 *    (`marketApi`). They are hints for choosing a price, so one the feed does not have is left
 *    out, and the feed is never asked on a test network, where it has no data.
 *
 * An answer that arrives after the NFT or the wallet has changed is dropped.
 */
export type ListingInfoState = 'idle' | 'loading' | 'ready' | 'failed';

const POLICY_HEX_LENGTH = 56;

/** A lovelace figure from the feed (a JSON number): positive and finite, else none. */
function feedLovelace(value: unknown): bigint | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? BigInt(Math.trunc(value)) : null;
}

export function useListingMarketInfo(getUnit: () => string, options: { royalties: boolean }) {
  const royalties: Ref<RoyaltyInfo | null> = ref(null);
  const royaltiesState = ref<ListingInfoState>('idle');
  const floorLovelace: Ref<bigint | null> = ref(null);
  const lastSaleLovelace: Ref<bigint | null> = ref(null);

  /** Bumped by every load and reset: an answer for an older one is not applied. */
  let epoch = 0;

  function reset(): void {
    epoch += 1;
    royalties.value = null;
    royaltiesState.value = 'idle';
    floorLovelace.value = null;
    lastSaleLovelace.value = null;
  }

  async function loadRoyalties(policyId: string, network: string, current: () => boolean): Promise<void> {
    royaltiesState.value = 'loading';
    try {
      const info = await nftMarketApi.royalties(policyId, network);
      if (!current()) return;
      royalties.value = info;
      royaltiesState.value = 'ready';
    } catch (e) {
      debugLog('NFT market: royalty terms could not be read', e);
      if (!current()) return;
      royalties.value = null;
      royaltiesState.value = 'failed';
    }
  }

  async function loadHints(policyId: string, assetName: string, current: () => boolean): Promise<void> {
    const [floor, lastSale] = await Promise.all([
      marketApi.getNftFloorPrice(policyId).then((r) => feedLovelace(r?.floorPriceLovelace), () => null),
      marketApi.getNftAssetPrice(policyId, assetName).then((r) => feedLovelace(r?.priceLovelace), () => null),
    ]);
    if (!current()) return;
    floorLovelace.value = floor;
    lastSaleLovelace.value = lastSale;
  }

  /** Read what the sheet needs for the NFT and network now. Never rejects. */
  async function load(): Promise<void> {
    const unit = getUnit().toLowerCase();
    const network = walletStore.loggedWallet?.network;
    if (!/^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/.test(unit) || !network) return;
    const startedAt = ++epoch;
    const current = () => epoch === startedAt;
    const policyId = unit.slice(0, POLICY_HEX_LENGTH);
    floorLovelace.value = null;
    lastSaleLovelace.value = null;
    const reads: Promise<void>[] = [];
    if (options.royalties) reads.push(loadRoyalties(policyId, network, current));
    if (network === Network.MAINNET) reads.push(loadHints(policyId, unit.slice(POLICY_HEX_LENGTH), current));
    await Promise.all(reads);
  }

  return { royalties, royaltiesState, floorLovelace, lastSaleLovelace, load, reset };
}
