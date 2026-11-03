import axios from 'axios';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import {
  HASH28_BYTES,
  MAX_ASSET_NAME_BYTES,
  NftMarketResponseError,
  ResponseReader,
  TX_HASH_BYTES,
} from '@/api/nftMarketValidation';
import { debugLog } from '@/utils/debug';

export { NftMarketResponseError } from '@/api/nftMarketValidation';

/**
 * Reads of Gero's NFT market: the open listings of a collection, one listing, and a
 * collection's royalties. They go through gero-backend's Nexus proxy (VITE_NEXUS_URL ->
 * <backend>/api/nexus), which injects the Nexus API key server-side. Nexus answers from its
 * index of the listing contract and re-reads a single listing from chain, but a listing can
 * still be spent between the answer and the click: the build (422 `LISTING_NOT_FOUND`) is
 * what settles that, not this list.
 *
 * Every answer is validated before it is returned, and a listing is never shown, priced or
 * built from a half-read row. A single listing, a royalty read or a page whose body is not
 * shaped as promised fails with an NftMarketResponseError. A page is the exception for its
 * rows: anyone can lock an NFT at the listing script under a datum Nexus decodes but the
 * wallet rejects (a negative price, say), so one such row must not blank the collection.
 * `listings()` drops a malformed row, keeps the rest in order and counts what it dropped. A row
 * of another policy than the one asked for is not that case: it is a server fault or an
 * attack, and fails the page. Nexus failures (a 404 `LISTING_NOT_FOUND`, a 422
 * `NETWORK_UNSUPPORTED`) reach the caller as the axios error; nexusErrorCode() reads the code.
 */

/** One payee of a listing besides the seller and the fee address. */
export interface ListingRoyalty {
  address: string;
  /** Lovelace, a decimal string. */
  lovelace: string;
}

/** An open Gero listing, as Nexus indexes it. Mirrors Nexus's `ListingDto` field for field. */
export interface ListingDto {
  /** The listing UTxO: `txHash#outputIndex`. */
  txHash: string;
  outputIndex: number;
  /** Deployment version of the listing contract the UTxO sits at. */
  version: number;
  /** Script hash of that deployment (56 hex). */
  scriptHash: string;
  /** Policy id followed by the hex asset name. */
  unit: string;
  policyId: string;
  /** Hex. */
  assetName: string;
  /** What the buyer pays the payees, lovelace as a decimal string. */
  priceLovelace: string;
  /** The Gero fee inside that price, a decimal string. */
  feeLovelace: string;
  royalties: ListingRoyalty[];
  /** The ADA riding with the NFT, a decimal string; the seller gets it back. */
  depositLovelace: string;
  sellerAddress: string;
  /** Payment key hash of the owner named in the datum (56 hex). */
  ownerPkh: string;
  listedSlot: number;
  /** The raw inline datum, hex. The worker decodes it itself before verifying a buy. */
  datumCbor: string;
}

export type ListingSort = 'price' | 'recent';

export interface ListingsQuery {
  /** Server default when omitted. */
  sort?: ListingSort;
  /** Opaque: the `nextCursor` of the previous page. */
  cursor?: string;
  /** 1 to LISTINGS_MAX_LIMIT; the server default when omitted. */
  limit?: number;
}

export interface ListingsPage {
  /** The well-formed listings of the page, in Nexus's order. */
  items: ListingDto[];
  /** Pass to the next call, or null on the last page. */
  nextCursor: string | null;
  /** Rows of the page the wallet refused as malformed and left out. */
  dropped: number;
}

export interface ListingRef {
  txHash: string;
  outputIndex: number;
}

/** One royalty recipient of a collection. */
export interface RoyaltyRecipient {
  address: string;
  /** This recipient's share, a fraction from 0 to 1. */
  rate: number;
  /**
   * CIP-102 minimum fee, lovelace: the royalty is never less than this. `null` when the collection
   * sets none (always for CIP-27).
   */
  minFeeLovelace: bigint | null;
  /**
   * CIP-102 maximum fee, lovelace: the royalty is never more than this. `null` when the collection
   * sets none (always for CIP-27). Never below `minFeeLovelace` when both are set.
   */
  maxFeeLovelace: bigint | null;
}

/**
 * A collection's royalty terms, read from its policy's own on-chain metadata. Each recipient's
 * royalty is `max(minFee, min(maxFee, floor(price x rate)))` with an absent bound ignored.
 */
export interface RoyaltyInfo {
  source: 'cip27' | 'cip102' | 'none';
  /** The total, a fraction from 0 to 1. */
  rate: number;
  recipients: RoyaltyRecipient[];
}

/** Most listings Nexus returns in one page. */
export const LISTINGS_MAX_LIMIT = 100;

const LISTING_SORTS: readonly ListingSort[] = ['price', 'recent'];
const ROYALTY_SOURCES: readonly RoyaltyInfo['source'][] = ['cip27', 'cip102', 'none'];

const POLICY_ID = /^[0-9a-f]{56}$/;
const TX_HASH = /^[0-9a-f]{64}$/;

const marketClient = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

/** Nexus's slug for the network, or an error: a read is never sent for a network it has no slug for. */
function marketNetwork(network: string): NonNullable<ReturnType<typeof toNexusNetwork>> {
  const nexusNetwork = toNexusNetwork(network);
  if (!nexusNetwork) throw new Error(`The NFT market is not supported on ${network}`);
  return nexusNetwork;
}

function assertPolicyId(policyId: string): void {
  if (typeof policyId !== 'string' || !POLICY_ID.test(policyId)) throw new Error('Invalid policy id');
}

function assertListingRef(ref: ListingRef): void {
  if (
    typeof ref?.txHash !== 'string' ||
    !TX_HASH.test(ref.txHash) ||
    !Number.isSafeInteger(ref.outputIndex) ||
    ref.outputIndex < 0
  ) {
    throw new Error('Invalid listing reference');
  }
}

/**
 * One listing, rebuilt from the fields the wallet uses. `path` names it in an error
 * (`items[2]`, or `body` for a single listing).
 */
function parseListing(r: ResponseReader, raw: unknown, path: string): ListingDto {
  const item = r.record(raw, path);
  const at = (field: string) => `${path}.${field}`;
  const policyId = r.hex(item['policyId'], at('policyId'), { bytes: HASH28_BYTES });
  const assetName = r.hex(item['assetName'], at('assetName'), { maxBytes: MAX_ASSET_NAME_BYTES, allowEmpty: true });
  const unit = r.hex(item['unit'], at('unit'));
  // The unit is what the wallet displays, owns and prices; it has to be the policy and name it
  // is listed under, or a collection's page could carry another collection's token.
  if (unit !== policyId + assetName) r.fail(at('unit'));
  const royalties = r.array(item['royalties'], at('royalties')).map((raw, i) => {
    const royalty = r.record(raw, `${at('royalties')}[${i}]`);
    return {
      address: r.string(royalty['address'], `${at('royalties')}[${i}].address`),
      lovelace: r.decimal(royalty['lovelace'], `${at('royalties')}[${i}].lovelace`),
    };
  });
  return {
    txHash: r.hex(item['txHash'], at('txHash'), { bytes: TX_HASH_BYTES }),
    outputIndex: r.int(item['outputIndex'], at('outputIndex')),
    version: r.int(item['version'], at('version')),
    scriptHash: r.hex(item['scriptHash'], at('scriptHash'), { bytes: HASH28_BYTES }),
    unit,
    policyId,
    assetName,
    priceLovelace: r.decimal(item['priceLovelace'], at('priceLovelace')),
    feeLovelace: r.decimal(item['feeLovelace'], at('feeLovelace')),
    royalties,
    depositLovelace: r.decimal(item['depositLovelace'], at('depositLovelace')),
    sellerAddress: r.string(item['sellerAddress'], at('sellerAddress')),
    ownerPkh: r.hex(item['ownerPkh'], at('ownerPkh'), { bytes: HASH28_BYTES }),
    listedSlot: r.int(item['listedSlot'], at('listedSlot')),
    datumCbor: r.hex(item['datumCbor'], at('datumCbor')),
  };
}

export const nftMarketApi = {
  /**
   * One page of a collection's open public listings (`GET /api/nft-market/listings`). Pass the
   * returned `nextCursor` back for the next page. A row that does not read back whole is left
   * out and counted in `dropped`; a body that is not a page, a bad `nextCursor` or a row of
   * another policy than the one asked for throws an NftMarketResponseError.
   */
  async listings(policyId: string, options: ListingsQuery, network: string): Promise<ListingsPage> {
    const nexusNetwork = marketNetwork(network);
    assertPolicyId(policyId);
    const { sort, cursor, limit } = options;
    if (sort !== undefined && !LISTING_SORTS.includes(sort)) throw new Error('Invalid listing sort');
    if (cursor !== undefined && (typeof cursor !== 'string' || cursor.length === 0)) {
      throw new Error('Invalid listings cursor');
    }
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1 || limit > LISTINGS_MAX_LIMIT)) {
      throw new Error(`Listings limit must be 1 to ${LISTINGS_MAX_LIMIT}`);
    }
    const route = '/api/nft-market/listings';
    // Only what was asked for goes on the query string.
    const params: Record<string, string | number> = { policy: policyId, network: nexusNetwork };
    if (sort !== undefined) params['sort'] = sort;
    if (cursor !== undefined) params['cursor'] = cursor;
    if (limit !== undefined) params['limit'] = limit;
    const { data } = await marketClient.get<unknown>(route, { params });
    const r = new ResponseReader(route);
    const body = r.record(data, 'body');
    const rows = r.array(body['items'], 'items');
    const next = body['nextCursor'];
    // Absent reads as the last page, the same as null.
    const nextCursor = next === undefined || next === null ? null : r.string(next, 'nextCursor');
    const items: ListingDto[] = [];
    const droppedFields: string[] = [];
    rows.forEach((raw, i) => {
      // A row naming another policy fails the page whatever else is wrong with it.
      const claimed = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>)['policyId'] : undefined;
      if (typeof claimed === 'string' && POLICY_ID.test(claimed) && claimed !== policyId) {
        r.fail(`items[${i}].policyId`);
      }
      try {
        items.push(parseListing(r, raw, `items[${i}]`));
      } catch (e) {
        if (!(e instanceof NftMarketResponseError)) throw e;
        droppedFields.push(e.field);
      }
    });
    // Field paths only, never a value.
    if (droppedFields.length > 0) debugLog('NFT market: dropped malformed listing rows', droppedFields);
    return { items, nextCursor, dropped: droppedFields.length };
  },

  /**
   * One listing by its out-ref (`GET /api/nft-market/listing/{txHash}/{index}`), re-read from
   * chain by Nexus. A listing spent or never indexed is a 404 whose `errorCode` is
   * `LISTING_NOT_FOUND` (nexusErrorCode()). The answer must be for the out-ref asked about.
   */
  async listing(ref: ListingRef, network: string): Promise<ListingDto> {
    const nexusNetwork = marketNetwork(network);
    assertListingRef(ref);
    const route = `/api/nft-market/listing/${ref.txHash}/${ref.outputIndex}`;
    const { data } = await marketClient.get<unknown>(route, { params: { network: nexusNetwork } });
    const r = new ResponseReader(route);
    const listing = parseListing(r, data, 'body');
    if (listing.txHash !== ref.txHash) r.fail('body.txHash');
    if (listing.outputIndex !== ref.outputIndex) r.fail('body.outputIndex');
    return listing;
  },

  /**
   * The royalty terms of a policy (`GET /api/nft-market/royalties/{policyId}`), from the
   * policy's own on-chain metadata (CIP-27 or CIP-102), `none` when it has none. Rates are
   * fractions from 0 to 1. A CIP-102 recipient may carry `minFeeLovelace` / `maxFeeLovelace`
   * (canonical decimal strings; absent or null reads as `null`, as does every CIP-27 recipient).
   */
  async royalties(policyId: string, network: string): Promise<RoyaltyInfo> {
    const nexusNetwork = marketNetwork(network);
    assertPolicyId(policyId);
    const route = `/api/nft-market/royalties/${policyId}`;
    const { data } = await marketClient.get<unknown>(route, { params: { network: nexusNetwork } });
    const r = new ResponseReader(route);
    const body = r.record(data, 'body');
    return {
      source: r.oneOf(body['source'], 'source', ROYALTY_SOURCES),
      rate: r.rate(body['rate'], 'rate'),
      recipients: r.array(body['recipients'], 'recipients').map((raw, i) => {
        const recipient = r.record(raw, `recipients[${i}]`);
        const minFeeLovelace = r.optionalCanonicalDecimal(recipient['minFeeLovelace'], `recipients[${i}].minFeeLovelace`);
        const maxFeeLovelace = r.optionalCanonicalDecimal(recipient['maxFeeLovelace'], `recipients[${i}].maxFeeLovelace`);
        // A minimum above the maximum has no royalty to give: the terms cannot be read.
        if (minFeeLovelace !== null && maxFeeLovelace !== null && minFeeLovelace > maxFeeLovelace) {
          r.fail(`recipients[${i}].minFeeLovelace`);
        }
        return {
          address: r.string(recipient['address'], `recipients[${i}].address`),
          rate: r.rate(recipient['rate'], `recipients[${i}].rate`),
          minFeeLovelace,
          maxFeeLovelace,
        };
      }),
    };
  },
};
