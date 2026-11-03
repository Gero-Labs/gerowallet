import { computed, type ComputedRef } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { reviveOwnListings, type OwnListing } from '@/chrome/nftMarket/ownListings';
import { nftMarketListingsVisible } from '@/shared/utils/nftMarketAvailability';
import { findCollectionName, longestCommonStartingSubstring, resolveAsset } from '@/shared/utils/resolver';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';

/**
 * The wallet's NFT collections as the collectibles views show them.
 *
 * `walletStore.collections` is built from the wallet's spendable UTxOs, and the NFTs it has
 * listed sit at the market contract, outside them. A seller would lose sight of an NFT the moment
 * it is listed, and with it the only place to change its price or take it back, so where the
 * network has a market these are added back for display (resolved the way every other asset is,
 * from the metadata the sync already fetched for them). The store itself is never touched: nothing
 * that selects inputs or sends an NFT reads this, so a listed NFT can only be listed, repriced or
 * unlisted from here, never sent.
 *
 * Not behind the `isNftMarketEnabled` flag (Ruling P41): a listing locks the user's NFT and
 * deposit, so switching the market off must never hide them. Only what the sheets offer on them
 * (List, Edit price) follows the flag.
 */

/** An asset of a collection, as `resolveAsset` returns it (the shape the store's collection items have). */
export interface CollectibleItem {
  unit: string;
  name: string;
  img?: string;
  policy_id?: string;
  asset_name?: string;
  fingerprint: string;
  onchain_metadata?: { image?: string; mediaType?: string; files?: { src: string; mediaType: string }[]; [key: string]: unknown } | null;
  metadata?: unknown;
  quantity?: string | number;
  isScam?: boolean;
  [key: string]: unknown;
}

/** A collection of the wallet: what the collectibles table, gallery and dialog read. */
export interface CollectibleCollection {
  id?: string;
  name: string;
  img?: string;
  description?: string | string[];
  quantity?: number;
  isScam?: boolean;
  items: CollectibleItem[];
}

const POLICY_HEX_LENGTH = 56;

/** One listed NFT as a collection item: the same resolver every asset goes through, with a fallback that cannot throw. */
export function resolveNftUnit(unit: string): CollectibleItem {
  const policyId = unit.slice(0, POLICY_HEX_LENGTH);
  const assetName = unit.slice(POLICY_HEX_LENGTH);
  try {
    const fingerprint = Cardano.AssetFingerprint.fromParts(Cardano.PolicyId(policyId), Cardano.AssetName(assetName));
    return resolveAsset({ unit, policy_id: policyId, asset_name: assetName, fingerprint, quantity: 1 }) as CollectibleItem;
  } catch (e) {
    debugLog('NFT market: could not resolve a listed NFT', e);
    return { unit, name: `${unit.slice(0, 16)}...`, policy_id: policyId, asset_name: assetName, fingerprint: '', quantity: 1, isScam: false };
  }
}

/** The name of a collection made only of listed NFTs: what the NFTs name, else what their names share, else the policy. */
function nameOf(items: readonly CollectibleItem[], policyId: string): string {
  const named = findCollectionName(items[0]);
  const name = typeof named === 'string' && named
    ? named
    : longestCommonStartingSubstring(items.map((i) => i.name).filter(Boolean));
  return typeof name === 'string' && name ? name : policyId;
}

/**
 * `base` (the store's collections) with the listed NFTs added: to their policy's collection when
 * the wallet holds others of it, else as a collection of their own. Pure: neither argument is
 * changed. An NFT the base already holds is not added twice.
 */
export function mergeListedCollectibles(
  base: Record<string, CollectibleCollection>,
  listings: readonly OwnListing[],
  resolve: (unit: string) => CollectibleItem = resolveNftUnit,
): Record<string, CollectibleCollection> {
  const held = new Set<string>();
  for (const collection of Object.values(base)) {
    for (const entry of collection.items ?? []) held.add(String(entry.unit).toLowerCase());
  }
  const listedByPolicy = new Map<string, CollectibleItem[]>();
  for (const listing of listings) {
    if (held.has(listing.unit)) continue;
    const policyId = listing.unit.slice(0, POLICY_HEX_LENGTH);
    listedByPolicy.set(policyId, [...(listedByPolicy.get(policyId) ?? []), resolve(listing.unit)]);
  }
  if (listedByPolicy.size === 0) return base;

  const merged: Record<string, CollectibleCollection> = { ...base };
  for (const [policyId, listed] of listedByPolicy) {
    const existing = base[policyId];
    if (existing) {
      merged[policyId] = {
        ...existing,
        items: [...existing.items, ...listed],
        quantity: Number(existing.quantity ?? existing.items.length) + listed.length,
      };
    } else {
      merged[policyId] = {
        name: nameOf(listed, policyId),
        img: listed[0]?.img,
        quantity: listed.length,
        isScam: listed.some((i) => i.isScam === true),
        items: listed,
      };
    }
  }
  return merged;
}

/**
 * The collections right now: the store's, with the listed NFTs added where the network has a
 * market. Reads reactive state, so calling it inside a computed or a watch source tracks it.
 * For code that is not a component (useNftMarketData's singleton); components use the composable.
 */
export function collectibleCollectionsNow(): Record<string, CollectibleCollection> {
  const base = (walletStore.collections ?? {}) as Record<string, CollectibleCollection>;
  return nftMarketListingsVisible() ? mergeListedCollectibles(base, reviveOwnListings(walletStore.listedListings)) : base;
}

/** The units of the wallet's own listings that are shown (none where the network has no market). Reactive. */
export function listedUnitsNow(): Set<string> {
  return nftMarketListingsVisible() ? new Set(reviveOwnListings(walletStore.listedListings).map((listing) => listing.unit)) : new Set();
}

export function useCollectibleCollections(): ComputedRef<Record<string, CollectibleCollection>> {
  return computed(collectibleCollectionsNow);
}
