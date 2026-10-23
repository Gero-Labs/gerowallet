import type { SpendBound } from '@/shared/utils/txIntentGuard';

/**
 * Spend budgets for orders built by a backend (the swap aggregator, RealFi
 * through Nexus). An order pays a script, so its exact outputs aren't known in
 * advance; what is known is how much may leave the wallet. The native signer
 * refuses any order whose net outflow exceeds the budget (see verifySpendBound).
 */

/**
 * ADA an order may take besides what is sold: the DEX deposit, batcher,
 * service and partner fees and any execution budget. The swap widget itself
 * assumes 12 ADA for this leg before a quote exists; a quote can only raise it.
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

/** The fields of an aggregator route this budget reads. */
export interface SwapRouteLike {
  tokenIn: string;
  amountIn: string;
  aggregatorFeeLovelace?: string | number | null;
  batcherFeeLovelace?: string | number | null;
  partnerFeeLovelace?: string | number | null;
  orderDepositLovelace?: string | number | null;
  executionBudgetLovelace?: string | number | null;
}

function lovelace(value: unknown): bigint {
  if (value == null || value === '') return 0n;
  try {
    const n = BigInt(String(value));
    return n > 0n ? n : 0n;
  } catch {
    return 0n;
  }
}

/**
 * The route a `<gero-swap>` `quote` event carries. The widget is a Vue custom
 * element, so the payload arrives as `detail[0]`; a bare object is accepted too.
 */
export function routeFromQuoteEvent(detail: unknown): SwapRouteLike | null {
  const payload = (Array.isArray(detail) ? detail[0] : detail) as { route?: unknown } | null | undefined;
  const route = payload?.route as Partial<SwapRouteLike> | null | undefined;
  if (!route || typeof route.tokenIn !== 'string' || !route.tokenIn) return null;
  if (!/^\d+$/.test(String(route.amountIn ?? ''))) return null;
  return route as SwapRouteLike;
}

/** What a swap may take: the quoted amount of the sold token, plus the order's ADA leg. */
export function swapSpendBound(route: SwapRouteLike): SpendBound {
  const amountIn = BigInt(route.amountIn);
  const leg = lovelace(route.aggregatorFeeLovelace) + lovelace(route.batcherFeeLovelace)
    + lovelace(route.partnerFeeLovelace) + lovelace(route.orderDepositLovelace)
    + lovelace(route.executionBudgetLovelace);
  const adaLeg = leg > ORDER_LEG_FLOOR_LOVELACE ? leg : ORDER_LEG_FLOOR_LOVELACE;
  const tokenIn = route.tokenIn.toLowerCase();
  const maxOutflow = new Map<string, bigint>();
  if (tokenIn === 'lovelace') {
    maxOutflow.set('lovelace', amountIn + adaLeg);
  } else {
    maxOutflow.set('lovelace', adaLeg);
    maxOutflow.set(tokenIn, amountIn);
  }
  return { maxOutflow };
}
