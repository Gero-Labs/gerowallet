import type { ListingDto } from '@/api/nft-market-api';
import { decodeListingDatum, type ListingDatum } from '@/chrome/nftMarket/listingDatum';
import type { OwnListing } from '@/chrome/nftMarket/ownListings';
import type { Keys } from '@/models/types';
import { MAX_ROYALTIES } from '@/utils/nftMarketDeployments';

/**
 * What the wallet may do with a listing in a collection's list, so Buy is offered only where the
 * worker would build one (NFT_MARKET_PREPARE_BUY, marketPrepare.ts). The page never offers a
 * button that leads to a refusal it could have seen coming.
 *
 *   buyable     a public listing that is somebody else's.
 *   own         one of this account's own listings: marked "Your listing", never bought (it is
 *               cancelled, `OWN_LISTING`). Only what the wallet itself verified (`useMyListings`)
 *               or a datum naming this account as owner AND as seller.
 *   contested   the datum names this account on ONE side only: as owner but with somebody else's
 *               address as seller (the fake "your listing" that pays an attacker), or the other
 *               way round. Not marked as the account's own, and never offered (the worker refuses
 *               either, `isOwnRow`).
 *   private     a `buyer` is set in the datum, whoever it names and whoever lists it: not shown
 *               and never bought. Ruling R2 (and P43): phase 1 buys PUBLIC listings only. The Nexus
 *               buy builder and the worker (`verifyBuy`) refuse every listing with a `buyer`
 *               (`PRIVATE_LISTING`), this account's own keys included, and browse hides them.
 *               Private buying is phase 1b, which lifts the refusal on both sides.
 *   unreadable  the datum is not exactly a Gero listing (`DATUM`), or the row contradicts it (its
 *               price, owner, seller or royalties are not the datum's), or the datum carries more
 *               royalties than the wallet ever writes (MAX_ROYALTIES): `verifyBuy` refuses each of
 *               these, so it can never be bought, and the page counts it among the listings it
 *               could not show.
 *
 * The datum is read here from the row's own bytes, strictly, the way the worker reads it (R11):
 * the row's other fields are Nexus's word, and a row that shows one price over a datum that holds
 * another is not a listing to put in front of a buyer.
 */
export type ListingBuyState =
  | { kind: 'buyable' }
  | { kind: 'own' }
  | { kind: 'contested' }
  | { kind: 'private' }
  | { kind: 'unreadable' };

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
 * Whether the row says what its datum says: the same price, owner, seller address and royalties
 * (each payee's address and amount, in order). The royalties are compared as `verifyBuy` compares
 * them (a missing list is none), so a row that shows others never gets a Buy the worker refuses.
 */
function rowMatchesDatum(row: ListingDto, datum: ListingDatum): boolean {
  try {
    const rows = Array.isArray(row.royalties) ? row.royalties : [];
    return (
      BigInt(row.priceLovelace) === datum.price &&
      typeof row.ownerPkh === 'string' &&
      lower(row.ownerPkh) === lower(datum.owner) &&
      typeof row.sellerAddress === 'string' &&
      lower(row.sellerAddress) === lower(datum.sellerAddress) &&
      rows.length === datum.royalties.length &&
      rows.every((royalty, i) => lower(royalty?.address) === lower(datum.royalties[i].address) && String(royalty?.lovelace) === datum.royalties[i].lovelace.toString())
    );
  } catch {
    return false;
  }
}

/**
 * What the wallet may do with one row of a collection's list. `networkId` is the wallet's own
 * (0 for a testnet, 1 for mainnet): the datum's addresses are rendered for it.
 */
export function listingBuyState(row: ListingDto, networkId: number, who: BuyerIdentity): ListingBuyState {
  const datum = readDatum(row, networkId);
  // A private listing is never shown, the account's own included.
  if (datum !== null && datum.buyer !== null) return { kind: 'private' };
  // What the wallet verified itself is its own, whatever Nexus's row or datum bytes look like.
  if (who.listingRefs.has(`${row.txHash}#${row.outputIndex}`)) return { kind: 'own' };
  if (datum === null || !rowMatchesDatum(row, datum)) return { kind: 'unreadable' };
  // More royalties than the wallet itself writes: each is a min-UTxO top-up at the buyer's expense, and verifyBuy refuses it.
  if (datum.royalties.length > MAX_ROYALTIES) return { kind: 'unreadable' };
  const ownerIsMine = who.keyHashes.has(lower(datum.owner));
  const sellerIsMine = who.addresses.has(lower(datum.sellerAddress));
  if (ownerIsMine && sellerIsMine) return { kind: 'own' };
  if (ownerIsMine || sellerIsMine) return { kind: 'contested' };
  return { kind: 'buyable' };
}
