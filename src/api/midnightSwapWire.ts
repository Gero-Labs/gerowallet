// Wire shapes of Nexus's Midnight token catalog, swap trades and open offers
// (`/api/midnight/{network}/tokens`, `/swaps/trades`, `/swap-offers`), and the
// strict readers that turn an answer into wallet types. A row that does not
// read is dropped, never shown half; a server's text never reaches the user
// (codes map to copy in midnightSwapConfig.ts).
//
// Pure: no axios, no store. midnight-api.ts calls these.

import type { MidnightSwapLeg } from '@/chains/midnight/midnightSwapRecords';
import { decodeSwapOffer, swapOfferId } from '@/chains/midnight/midnightSwapOffer';

const HEX64 = /^[0-9a-f]{64}$/;
const DECIMAL = /^[0-9]{1,80}$/;

/** Fields of a JSON object, each still unread (`unknown`). */
type Wire<K extends string> = Partial<Record<K, unknown>>;

const isRecord = <K extends string = never>(value: unknown): value is Wire<K> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const optionalString = (value: unknown, max = 200): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;

/** One token of the catalog. Only `verified` tokens count as listed; a MIP-0018 name alone is never trusted for that. */
export interface MidnightCatalogToken {
  readonly tokenType: string;
  readonly kind: 'UNSHIELDED' | 'SHIELDED';
  readonly symbol: string | null;
  readonly name: string | null;
  readonly decimals: number | null;
  readonly metadataSource: 'CURATED' | 'MIP0018' | 'NONE';
  readonly verified: boolean;
  readonly holders: number | null;
}

export interface MidnightTokenCatalogPage {
  readonly total: number;
  readonly tokens: MidnightCatalogToken[];
}

/** A catalog row, or `null` when it does not read. */
export function readCatalogToken(value: unknown): MidnightCatalogToken | null {
  if (!isRecord<'tokenType' | 'kind' | 'metadataSource' | 'decimals' | 'holders' | 'symbol' | 'name' | 'verified'>(value)) return null;
  const tokenType = typeof value.tokenType === 'string' ? value.tokenType.toLowerCase() : '';
  if (!HEX64.test(tokenType)) return null;
  if (value.kind !== 'UNSHIELDED' && value.kind !== 'SHIELDED') return null;
  const source = value.metadataSource;
  if (source !== 'CURATED' && source !== 'MIP0018' && source !== 'NONE') return null;
  const decimals = typeof value.decimals === 'number' && Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 30
    ? value.decimals : null;
  const holders = typeof value.holders === 'number' && Number.isFinite(value.holders) && value.holders >= 0 ? value.holders : null;
  return {
    tokenType,
    kind: value.kind,
    // A ticker is short and plain; anything else is not shown.
    symbol: typeof value.symbol === 'string' && /^[\p{L}\p{N}._-]{1,16}$/u.test(value.symbol) ? value.symbol : null,
    name: optionalString(value.name, 64),
    decimals,
    metadataSource: source,
    verified: value.verified === true,
    holders,
  };
}

/** A `GET tokens` page; unreadable rows are dropped. */
export function readTokenCatalogPage(value: unknown): MidnightTokenCatalogPage {
  if (!isRecord<'tokens' | 'total'>(value) || !Array.isArray(value.tokens)) throw new Error('Unreadable token catalog');
  const tokens = value.tokens.map(readCatalogToken).filter((token): token is MidnightCatalogToken => token !== null);
  const total = typeof value.total === 'number' && Number.isInteger(value.total) && value.total >= 0 ? value.total : tokens.length;
  return { total, tokens };
}

/** One settled swap, the pair normalized so `tokenA < tokenB`. */
export interface MidnightSwapTrade {
  readonly txHash: string;
  readonly timestamp: number | null;
  readonly tokenA: string;
  readonly amountA: string;
  readonly tokenB: string;
  readonly amountB: string;
}

export function readSwapTrades(value: unknown): MidnightSwapTrade[] {
  if (!isRecord<'trades'>(value) || !Array.isArray(value.trades)) throw new Error('Unreadable swap trades');
  const trades: MidnightSwapTrade[] = [];
  for (const row of value.trades) {
    if (!isRecord<'tokenA' | 'tokenB' | 'amountA' | 'amountB' | 'timestamp' | 'txHash'>(row)) continue;
    const tokenA = typeof row.tokenA === 'string' ? row.tokenA.toLowerCase() : '';
    const tokenB = typeof row.tokenB === 'string' ? row.tokenB.toLowerCase() : '';
    const amountA = typeof row.amountA === 'string' ? row.amountA : '';
    const amountB = typeof row.amountB === 'string' ? row.amountB : '';
    if (!HEX64.test(tokenA) || !HEX64.test(tokenB) || !DECIMAL.test(amountA) || !DECIMAL.test(amountB)) continue;
    if (BigInt(amountA) === 0n || BigInt(amountB) === 0n) continue;
    const time = typeof row.timestamp === 'string' ? Date.parse(row.timestamp)
      : typeof row.timestamp === 'number' ? row.timestamp : NaN;
    trades.push({
      txHash: typeof row.txHash === 'string' ? row.txHash : '',
      timestamp: Number.isFinite(time) ? time : null,
      tokenA, amountA, tokenB, amountB,
    });
  }
  return trades;
}

/** Nexus's answer to a listing (POST swap-offers). */
export interface MidnightListedOffer {
  readonly offerId: string;
  readonly status: string;
  readonly published: boolean;
}

export function readListedOffer(value: unknown): MidnightListedOffer {
  if (!isRecord<'offerId' | 'status' | 'published'>(value) || typeof value.offerId !== 'string' || !HEX64.test(value.offerId.toLowerCase())) {
    throw new Error('Unreadable swap offer listing');
  }
  return {
    offerId: value.offerId.toLowerCase(),
    status: typeof value.status === 'string' ? value.status : 'live',
    published: value.published === true,
  };
}

/**
 * One open offer of Gero's list (MIP-0006 `OffchainOfferPayload`). Its legs are
 * the server's reading and only sort and label the list: the wallet reads the
 * offer's own bytes before anyone can take it (midnightSwap9.ts).
 */
export interface MidnightOpenOffer {
  readonly offerId: string;
  /** Present when the list carries it; otherwise fetched by id when chosen. */
  readonly offerBech32: string | null;
  readonly gives: MidnightSwapLeg[];
  readonly wants: MidnightSwapLeg[];
  readonly expiresAt: number | null;
}

function readLegs(value: unknown): MidnightSwapLeg[] | null {
  if (!Array.isArray(value) || !value.length) return null;
  const legs: MidnightSwapLeg[] = [];
  for (const leg of value) {
    if (!isRecord<'token' | 'tokenType' | 'amount' | 'type' | 'shielded'>(leg)) return null;
    const tokenType = typeof leg.token === 'string' ? leg.token.toLowerCase()
      : typeof leg.tokenType === 'string' ? leg.tokenType.toLowerCase() : '';
    const amount = typeof leg.amount === 'string' ? leg.amount : '';
    // Public legs only: a private leg cannot be taken by this version.
    const kind = leg.type ?? (leg.shielded === true ? 'SHIELDED' : 'UNSHIELDED');
    if (!HEX64.test(tokenType) || !DECIMAL.test(amount) || BigInt(amount) === 0n || kind !== 'UNSHIELDED') return null;
    legs.push({ tokenType, amount });
  }
  return legs;
}

/** An open-offers row, or `null` (unreadable, private, or without an id). */
export function readOpenOffer(value: unknown): MidnightOpenOffer | null {
  if (!isRecord<'computed' | 'offerBech32' | 'offerId'>(value)) return null;
  const computed = isRecord<'gives' | 'wants' | 'expiresAt'>(value.computed) ? value.computed : null;
  if (!computed) return null;
  const offerBech32 = typeof value.offerBech32 === 'string' && value.offerBech32.toLowerCase().startsWith('swapoffer1')
    ? value.offerBech32 : null;
  let offerId = typeof value.offerId === 'string' && HEX64.test(value.offerId.toLowerCase()) ? value.offerId.toLowerCase() : null;
  // MIP-0006: at least one of the two is present; the id derives from the string.
  if (!offerId && offerBech32) {
    try {
      offerId = swapOfferId(decodeSwapOffer(offerBech32));
    } catch {
      return null;
    }
  }
  if (!offerId) return null;
  const gives = readLegs(computed.gives);
  const wants = readLegs(computed.wants);
  if (!gives || !wants) return null;
  const expiresAt = typeof computed.expiresAt === 'string' ? Date.parse(computed.expiresAt) : NaN;
  return { offerId, offerBech32, gives, wants, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
}

export function readOpenOffers(value: unknown): MidnightOpenOffer[] {
  if (!isRecord<'offers'>(value) || !Array.isArray(value.offers)) throw new Error('Unreadable open offers');
  return value.offers.map(readOpenOffer).filter((offer): offer is MidnightOpenOffer => offer !== null);
}

/** The `code` of a Nexus error body, if it has one. */
export function nexusErrorCode(value: unknown): string | undefined {
  return isRecord<'code'>(value) && typeof value.code === 'string' ? value.code : undefined;
}
