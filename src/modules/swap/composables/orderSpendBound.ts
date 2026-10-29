import type { SpendBound } from '@/shared/utils/txIntentGuard';

/**
 * Spend budgets for orders built by a backend (the swap aggregator, RealFi
 * through Nexus). An order pays a script, so its exact outputs aren't known in
 * advance; what is known is how much may leave the wallet. The native signer
 * refuses any order whose net outflow exceeds the budget (see verifySpendBound).
 */

/**
 * ADA a RealFi order may take besides what it locks. RealFi's own costs live in
 * its SDK and are not reviewed here, so this stays a flat allowance; swaps size
 * their leg from Gero's fee schedule instead (swapSpendBound).
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
 * The service fee rate the budget allows, in basis points of the trade's ADA
 * side: exactly what Gero charges the wallet. The wallet's swap calls reach Nexus
 * as a device, never with an API key, so no per-key rate override and no partner
 * fee applies and the engine's global `aggregator.fee-rate` (0.001) is the rate.
 * Raising that rate needs this raised in the same release, or large swaps are
 * refused.
 */
export const SERVICE_FEE_MAX_BPS = 10n;

/**
 * The largest token sale, in ADA of value, whose service fee is still the
 * minimum (1.2 ADA at 10 bps: 1,200 ADA). A token sale has no ADA side the
 * wallet can trust: the only prices it has come from Gero's market data, the
 * same service as the aggregator. So a token sale is allowed the minimum fee
 * only, and a larger one is refused and has to be split.
 */
export const TOKEN_SALE_LIMIT_ADA = (SERVICE_FEE_MIN_LOVELACE * 10_000n) / SERVICE_FEE_MAX_BPS / 1_000_000n;

/** What the user asked to swap, as the wallet itself knows it (never the quote's echo of it). */
export interface SwapIntent {
  /** The unit the user is selling ('lovelace' for ADA). */
  tokenIn: string;
  /** The amount the user typed, in base units. */
  amountIn: bigint;
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

function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

/**
 * What a swap may take: the amount the user typed of the token they are
 * selling, plus the order's ADA leg. The leg comes from Gero's published fee
 * schedule, not from the quote's fee fields: the largest DEX overhead plus the
 * service fee at SERVICE_FEE_MAX_BPS of the ADA sold, never below its 1.2 ADA
 * minimum. A token sale gets the minimum fee only (TOKEN_SALE_LIMIT_ADA). No flat floor on top:
 * anything a floor allowed beyond those costs a builder could take. The network
 * fee is not part of it: verifySpendBound allows the transaction's own fee on
 * top and refuses one over MAX_BUILT_TX_FEE_LOVELACE.
 */
export function swapSpendBound(intent: SwapIntent): SpendBound {
  const tokenIn = intent.tokenIn.toLowerCase();
  const adaSide = tokenIn === 'lovelace' ? intent.amountIn : 0n;
  const rated = ceilDiv(adaSide * SERVICE_FEE_MAX_BPS, 10_000n);
  const serviceFee = rated > SERVICE_FEE_MIN_LOVELACE ? rated : SERVICE_FEE_MIN_LOVELACE;
  const adaLeg = ORDER_OVERHEAD_MAX_LOVELACE + serviceFee;
  const maxOutflow = new Map<string, bigint>();
  if (tokenIn === 'lovelace') {
    maxOutflow.set('lovelace', intent.amountIn + adaLeg);
  } else {
    maxOutflow.set('lovelace', adaLeg);
    maxOutflow.set(tokenIn, intent.amountIn);
  }
  return { maxOutflow };
}
