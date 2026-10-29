import type { SpendBound } from '@/shared/utils/txIntentGuard';

/**
 * Spend budgets for orders built by a backend (the swap aggregator, RealFi
 * through Nexus). An order pays a script, so its exact outputs aren't known in
 * advance; what is known is how much may leave the wallet. The native signer
 * refuses any order whose net outflow exceeds the budget (see verifySpendBound).
 */

/**
 * ADA an order may take besides what is sold: the DEX deposit, batcher and
 * service fees and any execution budget. The swap widget itself assumes 12 ADA
 * for this leg before a quote exists; only a large trade's service fee raises it.
 */
export const ORDER_LEG_FLOOR_LOVELACE = 12_000_000n;

/**
 * ADA a signature may take when no order is being placed (cancelling an order,
 * claiming a result): those return value to the wallet, so only change rounding.
 */
export const NO_ORDER_LOVELACE = 2_000_000n;

/** The budget when nothing more specific is known: no tokens, a little ADA. */
export const DEFAULT_ORDER_SPEND_BOUND: SpendBound = {
  maxOutflow: new Map([['lovelace', NO_ORDER_LOVELACE]]),
};

/**
 * The most an order may cost besides what is sold and Gero's service fee: the
 * largest DEX deposit + execution budget + batcher fee the aggregator funds
 * (Splash: 1.5 + 2 + 2 ADA; every other DEX less). Reviewed against
 * cardano-market-data's DexFees and OrderFunding at 49e1ccb. Not read from the
 * quote: the server that quotes is the server that builds the order.
 */
export const ORDER_OVERHEAD_MAX_LOVELACE = 5_500_000n;

/** Gero's service fee is never below this: the aggregator pays it as an output of at least 1.2 ADA. */
export const SERVICE_FEE_MIN_LOVELACE = 1_200_000n;

/**
 * The highest service fee rate the budget allows, in basis points of the
 * trade's ADA side. Gero charges 10 (cardano-market-data `aggregator.fee-rate`);
 * 30 leaves room to raise it without a wallet release. A rate above this needs
 * the constant raised in the same release, or large swaps are refused. The
 * wallet passes no partner key, so no partner fee is allowed.
 */
export const SERVICE_FEE_MAX_BPS = 30n;

/** Room on the wallet's own price of a sold token: it can move between the quote and the fill. */
export const TOKEN_VALUE_HEADROOM = 2n;

/** What the user asked to swap, as the wallet itself knows it (never the quote's echo of it). */
export interface SwapIntent {
  /** The unit the user is selling ('lovelace' for ADA). */
  tokenIn: string;
  /** The amount the user typed, in base units. */
  amountIn: bigint;
  /** The sold tokens' value in lovelace at the wallet's own price, or null without one. Unused for ADA. */
  tokenValueLovelace?: bigint | null;
}

/** The part of a `<gero-swap>` quote the host reads: only that a quote was given. */
export interface QuotedRoute {
  tokenIn: string;
  amountIn: string;
}

/**
 * The route a `<gero-swap>` `quote` event carries. The widget is a Vue custom
 * element, so the payload arrives as `detail[0]`; a bare object is accepted too.
 */
export function routeFromQuoteEvent(detail: unknown): QuotedRoute | null {
  const payload = (Array.isArray(detail) ? detail[0] : detail) as { route?: unknown } | null | undefined;
  const route = payload?.route as Partial<QuotedRoute> | null | undefined;
  if (!route || typeof route.tokenIn !== 'string' || !route.tokenIn) return null;
  if (!/^\d+$/.test(String(route.amountIn ?? ''))) return null;
  return route as QuotedRoute;
}

/**
 * A typed amount in base units, converted the way the widget converts it
 * (its `sr()`): extra decimals are cut, not rounded. Null for anything that is
 * not a plain non-negative decimal.
 */
export function toBaseUnits(display: unknown, decimals: number): bigint | null {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const text = String(display ?? '').trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(`${whole || '0'}${(fraction + '0'.repeat(decimals)).slice(0, decimals)}`);
}

/** `amount` base units at `priceAda` ADA per display unit, in lovelace; null without a usable price. */
export function tokenValueLovelace(amount: bigint, decimals: number, priceAda: unknown): bigint | null {
  if (typeof priceAda !== 'number' || !Number.isFinite(priceAda) || priceAda <= 0) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;
  const scale = 10n ** 18n;
  const scaledPrice = BigInt(Math.round(priceAda * 1e18));
  return (amount * scaledPrice * 1_000_000n) / (scale * 10n ** BigInt(decimals));
}

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * What a swap may take: the amount the user typed of the token they are
 * selling, plus the order's ADA leg, never below the floor. The leg is bounded
 * from Gero's published fee schedule, not from the quote's fee fields: the
 * largest DEX overhead plus the service fee at SERVICE_FEE_MAX_BPS of the
 * trade's ADA side (what is sold when selling ADA; else the sold tokens at the
 * wallet's own price, with headroom, or nothing without one). The network fee
 * is not part of it: verifySpendBound allows the transaction's own fee on top
 * and refuses one over MAX_BUILT_TX_FEE_LOVELACE.
 */
export function swapSpendBound(intent: SwapIntent): SpendBound {
  const tokenIn = intent.tokenIn.toLowerCase();
  const adaSide = tokenIn === 'lovelace'
    ? intent.amountIn
    : (intent.tokenValueLovelace ?? 0n) * TOKEN_VALUE_HEADROOM;
  const rated = ceilDiv(adaSide * SERVICE_FEE_MAX_BPS, 10_000n);
  const serviceFee = rated > SERVICE_FEE_MIN_LOVELACE ? rated : SERVICE_FEE_MIN_LOVELACE;
  const leg = ORDER_OVERHEAD_MAX_LOVELACE + serviceFee;
  const adaLeg = leg > ORDER_LEG_FLOOR_LOVELACE ? leg : ORDER_LEG_FLOOR_LOVELACE;
  const maxOutflow = new Map<string, bigint>();
  if (tokenIn === 'lovelace') {
    maxOutflow.set('lovelace', intent.amountIn + adaLeg);
  } else {
    maxOutflow.set('lovelace', adaLeg);
    maxOutflow.set(tokenIn, intent.amountIn);
  }
  return { maxOutflow };
}
