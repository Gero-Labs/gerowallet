import type { LegacyListingItem } from '@/api/legacy-listings-api';
import type { LegacyItemMeta } from '@/shared/composables/useLegacyListings';
import { formatTokenQuantity } from '@/shared/utils/format';

/** How a stuck item of a closed marketplace reads in the Portfolio card and the cancel dialog. */

/** Lovelace as ADA, the way holdings quantities read: up to six decimals, no trailing zeros. */
export function formatAda(lovelace: string): string {
  return formatTokenQuantity(Number(lovelace) / 1_000_000, 6);
}

/** The asset's name from `meta`, or a shortened unit while the lookup has not named it. */
function assetName(unit: string, meta: ReadonlyMap<string, LegacyItemMeta>): string {
  return meta.get(unit)?.name || `${unit.slice(0, 16)}...`;
}

/** Several assets under one listing read as a list; a quantity above one shows after the name. */
export function legacyItemName(item: LegacyListingItem, meta: ReadonlyMap<string, LegacyItemMeta>): string {
  return item.assets
    .map((asset) => (asset.quantity === '1' ? assetName(asset.unit, meta) : `${assetName(asset.unit, meta)} ×${asset.quantity}`))
    .join(', ');
}

/** The first picture any of the item's assets has, if any. */
export function legacyItemImage(item: LegacyListingItem, meta: ReadonlyMap<string, LegacyItemMeta>): string | undefined {
  return item.assets.map((asset) => meta.get(asset.unit)?.image).find(Boolean);
}

/**
 * The unit of the one NFT a stuck item holds, or null for anything that is not a listing of exactly
 * one NFT: an offer (ADA only), or a bundle (several assets, or several of one). Only such a listing
 * can be moved to Gero: the worker refuses the rest (OFFER_NOT_MOVABLE, NOT_SINGLE_NFT).
 */
export function singleNftUnit(item: LegacyListingItem): string | null {
  if (item.kind !== 'listing' || item.assets.length !== 1) return null;
  const [asset] = item.assets;
  return asset.quantity === '1' ? asset.unit : null;
}
