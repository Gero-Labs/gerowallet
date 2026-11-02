// The user's own Gero listings, as the wallet recognises them among the UTxOs gero-sync returns.
//
// A listing sits at the listing script's address with the seller's own stake key in the stake
// slot, so gero-sync returns it under the wallet's stake address as if it were the user's money.
// It must never be spent by coin selection or counted as spendable, so applyUtxos diverts every
// UTxO the classifier calls `listed` out of `walletStore.utxos`. This module decides which of
// those are really the user's own listings and so shown, cancelled and counted as the user's:
//
//   A `listed` UTxO is the user's only if ALL hold
//     1. its address is one of the configured deployments' script hashes (every version),
//     2. it carries an inline datum that decodes, strictly, as a Gero `Listing` for the
//        wallet's network (decodeListingDatum),
//     3. the datum's `owner` is one of the wallet's own PAYMENT key hashes,
//     4. the datum's `seller_address` is one of the wallet's own addresses (full bech32 match),
//     5. its value is exactly one non-ADA asset with quantity 1, plus lovelace.
//
// Anything else at the listing script under the wallet's stake key is treated as foreign: not
// listed, not subtracted from the balance, not offered for cancel, not shown. Anyone can lock
// an NFT at the listing script under any stake key with any datum, so a datum naming the wallet
// as `owner` but someone else as `seller_address` (or the reverse) is a fake "your listing": the
// proceeds of a sale would not reach the user, and the user would be shown, and offered the
// cancel of, something that is not theirs. Both halves are checked, never just one.
//
// What this does NOT decide: signing. Refusing to sign a transaction that spends a listed UTxO
// is the signing guard's job and reads the whole candidate set, not only the verified listings.

import { Cardano } from '@cardano-sdk/core';
import type { Keys } from '@/models/types';
import { inlineDatumCbor } from '@/shared/utils/utxoCbor';
import type { NftMarketDeployment } from '@/utils/nftMarketDeployments';
import { decodeListingDatum, type ListingDatum } from '@/chrome/nftMarket/listingDatum';

/**
 * One of the wallet's own listings: a Gero listing UTxO whose datum names the wallet as both
 * owner and seller. It lives in `walletStore.listedListings`, outside `walletStore.utxos`.
 *
 * Over the store's JSON broadcast (and when read back from IndexedDB) the bigint fields of
 * `datum` (`price`, each royalty's `lovelace`) arrive as decimal strings: a context other than
 * the worker reads them through `reviveOwnListings`.
 */
export interface OwnListing {
  /** The listing UTxO, `txHash#index`. */
  ref: string;
  /** Policy id and asset name (hex) of the listed NFT. */
  unit: string;
  /** The decoded datum: owner, seller address, price, royalties, buyer. */
  datum: ListingDatum;
  /** The listing UTxO's own lovelace, the deposit that returns to the seller (decimal string). */
  depositLovelace: string;
  /** `NftMarketDeployment.version` of the script the listing sits at. */
  deploymentVersion: number;
}

/** What identifies the wallet in a listing datum. */
export interface OwnListingIdentity {
  /** The wallet's payment key hashes (56 lower-case hex): never its stake key. */
  paymentKeyHashes: ReadonlySet<string>;
  /** The wallet's own payment and change addresses (bech32), to be matched in full. */
  addresses: ReadonlySet<string>;
}

/** Why a `listed` candidate is not the wallet's own listing. */
export type OwnListingRejection =
  | 'ADDRESS' // not a base address with a script payment part
  | 'DEPLOYMENT' // a script that is not one of the configured deployments
  | 'NO_DATUM' // no inline datum (none, or only a datum hash)
  | 'NOT_A_LISTING' // the inline datum is not exactly a Gero Listing
  | 'OWNER' // the datum's owner is not one of the wallet's payment keys
  | 'SELLER' // the datum's seller address is not one of the wallet's addresses
  | 'VALUE'; // not exactly one non-ADA asset, quantity 1

export type OwnListingVerdict = { listing: OwnListing } | { rejected: OwnListingRejection };

export interface OwnListingContext {
  /** Network id the datum's addresses are rendered for: 0 testnets, 1 mainnet. */
  networkId: number;
  /** Every configured deployment of the network, all versions. */
  deployments: readonly NftMarketDeployment[];
  own: OwnListingIdentity;
}

const HASH_HEX = /^[0-9a-fA-F]{56}$/;

/**
 * The wallet's identity for listing ownership, from its key set plus any payment key hashes
 * derived locally (a key set can lag a sync, derivation never does).
 *
 * Payment and change keys only. The stake key is not an owner: a listing is cancelled by its
 * payment key owner, and the key set's `stake` entries are not payment keys.
 */
export function ownListingIdentity(
  keys: Partial<Keys> | null | undefined,
  derivedPaymentKeyHashes: Iterable<string> = [],
): OwnListingIdentity {
  const paymentKeyHashes = new Set<string>();
  const addresses = new Set<string>();
  for (const kind of ['payment', 'change'] as const) {
    for (const key of keys?.[kind] ?? []) {
      if (typeof key?.cred === 'string' && HASH_HEX.test(key.cred)) paymentKeyHashes.add(key.cred.toLowerCase());
      if (typeof key?.address === 'string' && key.address) addresses.add(key.address);
    }
  }
  for (const hash of derivedPaymentKeyHashes) {
    if (typeof hash === 'string' && HASH_HEX.test(hash)) paymentKeyHashes.add(hash.toLowerCase());
  }
  return { paymentKeyHashes, addresses };
}

/** The payment script hash of a base address, or null for any other shape (never throws). */
function paymentScriptHash(address: string): string | null {
  try {
    const credential = Cardano.Address.fromString(address)?.asBase()?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.ScriptHash ? credential.hash : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether one `listed` candidate UTxO is the wallet's own listing. Pure; every refusal
 * names its reason so the caller can count it. Fails closed: a check that cannot be made
 * refuses.
 */
export function verifyOwnListing([txIn, txOut]: Cardano.Utxo, ctx: OwnListingContext): OwnListingVerdict {
  const scriptHash = paymentScriptHash(txOut.address as string);
  if (!scriptHash) return { rejected: 'ADDRESS' };
  const deployment = ctx.deployments.find((d) => d.scriptHash === scriptHash);
  if (!deployment) return { rejected: 'DEPLOYMENT' };

  // The inline datum's original bytes, in any shape a stored UTxO has held one. A datum hash
  // or a Core value without bytes yields none: with nothing to decode it is not a listing.
  const cbor = inlineDatumCbor(txOut.datum);
  if (!cbor) return { rejected: 'NO_DATUM' };
  let datum: ListingDatum;
  try {
    datum = decodeListingDatum(cbor, ctx.networkId);
  } catch {
    return { rejected: 'NOT_A_LISTING' };
  }

  // OX Agent: Authorization prevented by requiring the datum's owner to be one of this wallet's own payment keys
  if (!ctx.own.paymentKeyHashes.has(datum.owner.toLowerCase())) return { rejected: 'OWNER' };
  // OX Agent: Authorization prevented by requiring the datum's seller address to be one of this wallet's own addresses
  if (!ctx.own.addresses.has(datum.sellerAddress)) return { rejected: 'SELLER' };

  const assets = txOut.value.assets;
  if (!assets || assets.size !== 1) return { rejected: 'VALUE' };
  const [unit, quantity] = [...assets.entries()][0];
  if (quantity !== 1n) return { rejected: 'VALUE' };

  return {
    listing: {
      ref: `${txIn.txId}#${txIn.index}`,
      unit,
      datum,
      depositLovelace: txOut.value.coins.toString(),
      deploymentVersion: deployment.version,
    },
  };
}

/** Total lovelace held by the listings' UTxOs (the deposits). */
export function listedLovelace(listings: readonly OwnListing[]): bigint {
  let total = 0n;
  for (const listing of listings) total += BigInt(listing.depositLovelace);
  return total;
}

/**
 * Listings as they come back from the store's JSON (a broadcast, or IndexedDB): the bigint
 * fields of the datum are decimal strings there, and become bigints again here. A malformed
 * entry is skipped, never thrown on: the store is not a trust boundary, but a bad row must not
 * take a page down.
 */
export function reviveOwnListings(raw: unknown): OwnListing[] {
  if (!Array.isArray(raw)) return [];
  const revived: OwnListing[] = [];
  for (const item of raw) {
    try {
      const datum = (item as OwnListing).datum;
      revived.push({
        ref: String((item as OwnListing).ref),
        unit: String((item as OwnListing).unit),
        depositLovelace: String((item as OwnListing).depositLovelace),
        deploymentVersion: Number((item as OwnListing).deploymentVersion),
        datum: {
          owner: String(datum.owner),
          sellerAddress: String(datum.sellerAddress),
          price: BigInt(datum.price),
          royalties: datum.royalties.map((r) => ({ address: String(r.address), lovelace: BigInt(r.lovelace) })),
          buyer: datum.buyer == null ? null : String(datum.buyer),
        },
      });
    } catch {
      // skip the entry
    }
  }
  return revived;
}
