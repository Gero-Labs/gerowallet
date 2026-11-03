// What the list and edit-price sheets show before the worker has built anything.
//
// The seller types a price in ADA; this turns it into an exact lovelace amount (never through a
// float) and works out how that price splits between Gero's fee, the creators' royalties and the
// seller. The split uses the same functions the worker holds the listing to: `listingSplit`
// (listingDatum.ts, the fee clamp and the seller's share) and `computeRoyalties` (royalties.ts),
// with the same limits (MIN_LIST_PRICE, MAX_LIST_PRICE, MIN_SELLER_SHARE). It is a PREVIEW: the
// worker re-derives every number (marketPrepare.ts) and the review screen shows the worker's
// verified figures, so a difference between the two is the review screen's to win.

import type { RoyaltyInfo } from '@/api/nft-market-api';
import { listingSplit, type ListingFeeParams, type Payee } from '@/chrome/nftMarket/listingDatum';
import { computeRoyalties, protocolParameter, royaltyMinUtxoFor } from '@/chrome/nftMarket/royalties';
import { MAX_LIST_PRICE, MIN_LIST_PRICE, MIN_SELLER_SHARE } from '@/utils/nftMarketDeployments';

// ---------------------------------------------------------------------------------------------
// The price the seller types
// ---------------------------------------------------------------------------------------------

export type PriceParse = { ok: true; lovelace: bigint } | { ok: false; reason: 'empty' | 'invalid' };

/** Digits, then at most one separator (`.` or `,`) and up to six decimals. ASCII digits only. */
const PRICE_TEXT = /^(?:([0-9]+)(?:[.,]([0-9]{0,6}))?|[.,]([0-9]{1,6}))$/;
/** Far more than the ADA supply needs (11 digits): a longer number is not a price, and costs no BigInt. */
const MAX_WHOLE_DIGITS = 30;

/**
 * ADA text as an exact lovelace amount. Whole ADA and up to six decimals, with `.` or `,` as the
 * decimal separator and nothing else (no grouping, no sign, no exponent). A seventh decimal is
 * refused, not rounded: the price the seller sees is the price that is listed. Blank is 'empty'
 * (the sheet stays quiet until the seller types); anything else it cannot read is 'invalid'.
 * Zero parses; the limits are the preview's to judge.
 */
export function parseAdaPrice(text: string): PriceParse {
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed === '') return { ok: false, reason: 'empty' };
  const match = PRICE_TEXT.exec(trimmed);
  if (!match) return { ok: false, reason: 'invalid' };
  const whole = match[1] ?? '0';
  const decimals = match[2] ?? match[3] ?? '';
  if (whole.length > MAX_WHOLE_DIGITS) return { ok: false, reason: 'invalid' };
  return { ok: true, lovelace: BigInt(whole) * 1_000_000n + BigInt(decimals.padEnd(6, '0') || '0') };
}

/** A lovelace amount as price-field text: no grouping, no trailing zeros (the inverse of parseAdaPrice). */
export function adaInputText(lovelace: bigint): string {
  const whole = (lovelace / 1_000_000n).toString();
  const fraction = (lovelace % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

// ---------------------------------------------------------------------------------------------
// The split of the price
// ---------------------------------------------------------------------------------------------

/** What keeps a price from being listed, in the order the worker checks it. */
export type ListingIssue = 'PRICE_TOO_LOW' | 'PRICE_TOO_HIGH' | 'ROYALTIES_MALFORMED' | 'SELLER_SHARE_TOO_LOW';

export interface ListingPreview {
  price: bigint;
  /** The market fee: the deployment's clamp of the price. */
  fee: bigint;
  /**
   * The royalty entries, each with its own amount, in the collection's order. Above the cap
   * (`overCap`) these are what WOULD be paid once the seller confirms.
   */
  royalties: Payee[];
  /** The sum of the royalty amounts. */
  royaltiesTotal: bigint;
  /** What the seller keeps, deposit aside: `price - fee - royaltiesTotal`. Can be negative. */
  sellerReceives: bigint;
  /** The royalties as a share of the price (a fraction from 0 to 1), for display. */
  royaltyFraction: number;
  /** Entries left out of the listing: too small to pay out, or beyond the recipient limit. */
  dropped: Payee[];
  /** Recipients the collection named without a usable address. */
  invalidRecipients: number;
  /** The royalties pass the usual 10% cap (rate or effective amount): the seller must confirm. */
  overCap: boolean;
  issue: ListingIssue | null;
}

/** `part / whole` (a share of the price) as a fraction to six digits, from exact bigint arithmetic. */
export function shareOfPrice(part: bigint, whole: bigint): number {
  return whole > 0n && part > 0n ? Number((part * 1_000_000n) / whole) / 1_000_000 : 0;
}

/** The first thing wrong with a price, in the worker's order: limits, then terms, then the seller's share. */
function issueOf(price: bigint, malformed: boolean, sellerReceives: bigint): ListingIssue | null {
  if (price < MIN_LIST_PRICE) return 'PRICE_TOO_LOW';
  if (price > MAX_LIST_PRICE) return 'PRICE_TOO_HIGH';
  if (malformed) return 'ROYALTIES_MALFORMED';
  if (sellerReceives < MIN_SELLER_SHARE) return 'SELLER_SHARE_TOO_LOW';
  return null;
}

function assemble(
  price: bigint,
  royalties: Payee[],
  fee: ListingFeeParams,
  rest: Pick<ListingPreview, 'dropped' | 'invalidRecipients' | 'overCap'> & { malformed?: boolean },
): ListingPreview {
  const split = listingSplit(price, royalties, fee);
  return {
    price,
    fee: split.fee,
    royalties,
    royaltiesTotal: split.royalties,
    sellerReceives: split.sellerShare,
    royaltyFraction: shareOfPrice(split.royalties, price),
    dropped: rest.dropped,
    invalidRecipients: rest.invalidRecipients,
    overCap: rest.overCap,
    issue: issueOf(price, rest.malformed === true, split.sellerShare),
  };
}

/**
 * The preview of a NEW listing at `price` for a collection's royalty terms: the royalty entries
 * (CIP-27 or CIP-102, clamped, those under min-UTxO and beyond three left out), the fee, and
 * what the seller keeps. Null for a price of zero or less (nothing to show yet). Above the 10%
 * cap the entries shown are what would be paid once the seller has confirmed.
 */
export function previewNewListing(
  price: bigint,
  info: RoyaltyInfo,
  fee: ListingFeeParams,
  opts: { minUtxo: bigint },
): ListingPreview | null {
  if (typeof price !== 'bigint' || price <= 0n) return null;
  try {
    const asked = computeRoyalties(price, info, { confirmAboveCap: false, minUtxo: opts.minUtxo });
    // Above the cap nothing is computed until the seller confirms; the amounts are still shown.
    const chosen = asked.needsConfirmation ? computeRoyalties(price, info, { confirmAboveCap: true, minUtxo: opts.minUtxo }) : asked;
    if (asked.malformed || chosen.malformed) return assemble(price, [], fee, { dropped: [], invalidRecipients: 0, overCap: false, malformed: true });
    return assemble(price, chosen.royalties, fee, {
      dropped: chosen.dropped,
      invalidRecipients: chosen.invalidRecipients,
      overCap: asked.needsConfirmation,
    });
  } catch {
    // computeRoyalties throws only for a price that is not positive, which is ruled out above.
    return assemble(price, [], fee, { dropped: [], invalidRecipients: 0, overCap: false, malformed: true });
  }
}

/**
 * The preview of a new price for a listing that already exists: its royalties keep their amounts
 * (a reprice changes only the price), so only the fee and the seller's share move. Null for a
 * price of zero or less.
 */
export function previewRepricedListing(price: bigint, royalties: readonly Payee[], fee: ListingFeeParams): ListingPreview | null {
  if (typeof price !== 'bigint' || price <= 0n) return null;
  return assemble(price, [...royalties], fee, { dropped: [], invalidRecipients: 0, overCap: false });
}

/**
 * The entries a listing leaves out, told apart for the seller: one below min-UTxO is too small
 * to pay out; one at or above it that is still out did not fit within the recipient limit. An
 * entry of zero lovelace owed nothing, so it is not mentioned.
 */
export function classifyDroppedRoyalties(
  dropped: readonly Payee[],
  minUtxo: bigint,
): { tooSmall: Payee[]; tooMany: Payee[] } {
  const tooSmall: Payee[] = [];
  const tooMany: Payee[] = [];
  for (const entry of dropped) {
    if (entry.lovelace <= 0n) continue;
    (entry.lovelace < minUtxo ? tooSmall : tooMany).push(entry);
  }
  return { tooSmall, tooMany };
}

/**
 * The least a royalty output may hold, from the network's `coinsPerUtxoByte` as the store holds
 * it: the worker's own function (`royaltyMinUtxoFor`, over its `protocolParameter` reading), so
 * the preview and the worker's choice of royalties use one threshold.
 */
export function pageRoyaltyMinUtxo(coinsPerUtxoByte: unknown): bigint {
  return royaltyMinUtxoFor(protocolParameter(coinsPerUtxoByte));
}
