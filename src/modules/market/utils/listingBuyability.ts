import type { ListingDto } from '@/api/nft-market-api';
import { decodeListingDatum, type ListingDatum } from '@/chrome/nftMarket/listingDatum';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import type { Keys } from '@/models/types';

/**
 * What the wallet may do with a listing in a collection's list, so Buy is offered only where the
 * worker would build one (NFT_MARKET_PREPARE_BUY, marketPrepare.ts). The page never offers a
 * button that leads to a refusal it could have seen coming.
 *
 *   buyable     a public listing that is somebody else's.
 *   own         one of this account's own listings: it is cancelled, not bought (`OWN_LISTING`).
 *   private     a `buyer` is set in the datum, whoever it names: not shown and never bought.
 *               Ruling R2: phase 1 buys PUBLIC listings only. The Nexus buy builder and the
 *               worker (`verifyBuy`) refuse every listing with a `buyer` (`PRIVATE_LISTING`),
 *               this account's own keys included, and browse hides them. Private buying is
 *               phase 1b, which lifts the refusal on both sides.
 *   unreadable  the datum is not exactly a Gero listing (`DATUM`): it can never be bought.
 *
 * The datum is read here from the row's own bytes, strictly, the way the worker reads it (R11):
 * the row's other fields are Nexus's word, and a row that says "owned by a stranger" over a datum
 * that names this wallet is the wallet's.
 */
export type ListingBuyState = { kind: 'buyable' } | { kind: 'own' } | { kind: 'private' } | { kind: 'unreadable' };

/** What identifies this account: the worker's own key set, read from the page's store. */
export interface BuyerIdentity {
  /**
   * The key hashes the worker counts as the wallet's own when it judges a row to be the
   * wallet's listing: payment, change and stake keys (`ownKeys` in cip113PrepareTransfer.ts).
   */
  keyHashes: ReadonlySet<string>;
  /** The payment and change addresses (bech32, lower case). */
  addresses: ReadonlySet<string>;
  /** `txHash#index` of each of the wallet's own verified listings (`useMyListings`). */
  listingRefs: ReadonlySet<string>;
}

const HASH_HEX = /^[0-9a-fA-F]{56}$/;

/** The identity of the logged account from its key set and its own listings. Empty, never an error, before the keys load. */
export function buyerIdentity(keys: Partial<Keys> | null | undefined, ownListings: readonly OwnListing[]): BuyerIdentity {
  const keyHashes = new Set<string>();
  const addresses = new Set<string>();
  for (const kind of ['payment', 'change', 'stake'] as const) {
    for (const key of keys?.[kind] ?? []) {
      if (typeof key?.cred === 'string' && HASH_HEX.test(key.cred)) {
        keyHashes.add(key.cred.toLowerCase());
      }
      if (kind !== 'stake' && typeof key?.address === 'string' && key.address) addresses.add(key.address.toLowerCase());
    }
  }
  return { keyHashes, addresses, listingRefs: new Set(ownListings.map((listing) => listing.ref)) };
}

function readDatum(row: ListingDto, networkId: number): ListingDatum | null {
  try {
    return decodeListingDatum(String(row.datumCbor ?? ''), networkId);
  } catch {
    return null;
  }
}

const lower = (value: unknown): string => String(value ?? '').toLowerCase();

/**
 * What the wallet may do with one row of a collection's list. `networkId` is the wallet's own
 * (0 for a testnet, 1 for mainnet): the datum's addresses are rendered for it.
 */
export function listingBuyState(row: ListingDto, networkId: number, who: BuyerIdentity): ListingBuyState {
  const datum = readDatum(row, networkId);
  const isOwn =
    who.listingRefs.has(`${row.txHash}#${row.outputIndex}`) ||
    who.keyHashes.has(lower(row.ownerPkh)) ||
    who.addresses.has(lower(row.sellerAddress)) ||
    (datum !== null && (who.keyHashes.has(lower(datum.owner)) || who.addresses.has(lower(datum.sellerAddress))));
  if (isOwn) return { kind: 'own' };
  if (datum === null) return { kind: 'unreadable' };
  return datum.buyer === null ? { kind: 'buyable' } : { kind: 'private' };
}
