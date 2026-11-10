import { ref, watch, type Ref } from 'vue';
import { chunkArray } from 'array-chunk-by-size';
import { Api } from '@/api/api';
import { collectionFieldOf } from '@/modules/market/utils/lookalike';
import { resolveAssetWithRow } from '@/shared/utils/resolver';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import networks from '@/utils/networks';

/** What the collection page shows of an NFT it does not hold. */
export interface ListingNftMeta {
  name: string;
  image?: string;
  /** The collection or project the NFT's own metadata names, if it does (never its own name). */
  collection?: string;
}

/** Bytes of units per asset-info request, as the asset sync sends them. */
const ASSET_INFO_BATCH_BYTES = 4000;

/** Unit metadata is the same for every wallet, so it outlives a wallet switch. Per network, by unit. */
const metaByNetwork = new Map<string, Map<string, ListingNftMeta>>();
/** Units whose asset-info lookup answered; the others hold only a decoded fallback name and are asked again. */
const resolvedByNetwork = new Map<string, Set<string>>();

const metaOf = (network: string) => {
  let units = metaByNetwork.get(network);
  if (!units) metaByNetwork.set(network, (units = new Map()));
  return units;
};
const resolvedOf = (network: string) => {
  let units = resolvedByNetwork.get(network);
  if (!units) resolvedByNetwork.set(network, (units = new Set()));
  return units;
};

/** A name, and the picture and collection if there is a row, for a unit. Never throws. */
function describeUnit(unit: string, row: unknown): ListingNftMeta {
  try {
    const resolved = resolveAssetWithRow({ unit }, row);
    const collection = collectionFieldOf(resolved.onchain_metadata);
    return { name: resolved.name, ...(resolved.img ? { image: resolved.img } : {}), ...(collection ? { collection } : {}) };
  } catch (e) {
    debugLog('NFT market: could not read the metadata of', unit, e);
    return row === undefined ? { name: unit.slice(0, 16) + '...' } : describeUnit(unit, undefined);
  }
}

/**
 * Names, pictures and collection fields for the NFTs of a collection's listings. The NFTs are
 * not the wallet's, so its store has no metadata for them: they come from the call the sync makes
 * (`POST /api/assets/info`), mapped by the resolver the rest of the wallet uses (CIP-25, CIP-68,
 * IPFS gateway rewriting). Every unit has a name at once (decoded from its hex asset name); the
 * lookup then improves it. A failed lookup keeps the decoded names and the unit is asked again
 * the next time it is wanted. Nothing here is ever shown as the truth about a collection: it is
 * what the NFT's issuer wrote, which is why the page shows the policy ID beside it.
 */
export function useListingNftMeta(units: () => readonly string[]): { meta: Ref<Map<string, ListingNftMeta>> } {
  const meta = ref(new Map<string, ListingNftMeta>());

  const publish = (network: string) => { meta.value = new Map(metaOf(network)); };

  async function resolve(wanted: string[], chain: string, network: string): Promise<void> {
    const api = new Api({ chain, network }, networks.resolveDefaultProvider(chain, network));
    const batches: string[][] = chunkArray({ input: wanted, bytesSize: ASSET_INFO_BATCH_BYTES });
    await Promise.all(batches.map(async (batch) => {
      try {
        const { status, data } = await api.getAssetsInfo(batch);
        if (status !== 200 || !Array.isArray(data)) return;
        const rows = new Map<string, unknown>();
        for (const row of data) {
          if (typeof row?.asset === 'string') rows.set(row.asset, row);
        }
        for (const unit of batch) {
          metaOf(network).set(unit, describeUnit(unit, rows.get(unit)));
          resolvedOf(network).add(unit);
        }
        if (walletStore.loggedWallet?.network === network) publish(network);
      } catch (e) {
        debugLog('NFT market: the asset metadata lookup failed, keeping the decoded names', e);
      }
    }));
  }

  watch(
    () => [...units()],
    (wanted) => {
      const wallet = walletStore.loggedWallet;
      if (!wallet) return;
      const known = metaOf(wallet.network);
      let seeded = false;
      for (const unit of wanted) {
        if (!known.has(unit)) {
          known.set(unit, describeUnit(unit, undefined));
          seeded = true;
        }
      }
      if (seeded) publish(wallet.network);
      const unresolved = wanted.filter((unit) => !resolvedOf(wallet.network).has(unit));
      if (unresolved.length > 0) void resolve(unresolved, wallet.chain, wallet.network);
    },
    { immediate: true },
  );

  return { meta };
}

/** Test seam: forget every name and what was asked. */
export function resetListingNftMeta(): void {
  metaByNetwork.clear();
  resolvedByNetwork.clear();
}
