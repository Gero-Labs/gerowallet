import { computed, type ComputedRef } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { reviveOwnListings, type OwnListing } from '@/chrome/nftMarket/ownListings';

/**
 * The logged wallet's own Gero market listings, for the pages that show or act on them (the
 * collectibles view, the list and unlist dialogs).
 *
 * Read from `walletStore.listedListings`: the listings the wallet itself verified (their datum
 * names the wallet as owner and as seller, see ownListings.ts), which gero-sync returns under
 * the wallet's stake address. Over the store's JSON broadcast and in IndexedDB the datum's
 * bigint fields are decimal strings, so every read goes through `reviveOwnListings`: a page
 * always gets `price` and each royalty's `lovelace` as bigints, and a row that cannot be read
 * is left out rather than failing the page.
 */
export function useMyListings(): {
  /** The wallet's own listings, in the order the store holds them. */
  listings: ComputedRef<OwnListing[]>;
  /**
   * The same listings keyed by NFT unit (policy id and asset name, lower-case hex), to ask
   * "is this NFT listed, and where". One NFT sits in one listing, so a unit appears once; if a
   * stale store ever shows two, the first stays.
   */
  byUnit: ComputedRef<Map<string, OwnListing>>;
} {
  const listings = computed(() => reviveOwnListings(walletStore.listedListings));

  const byUnit = computed(() => {
    const units = new Map<string, OwnListing>();
    for (const listing of listings.value) {
      if (!units.has(listing.unit)) units.set(listing.unit, listing);
    }
    return units;
  });

  return { listings, byUnit };
}
