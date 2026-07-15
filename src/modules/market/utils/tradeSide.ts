// Trade-direction semantics — SINGLE SOURCE OF TRUTH. Read before touching buy/sell UI.
//
// The market backend (cardano-market-data `DexEventProcessor`) reports each swap's
// `type` from the TOKEN's perspective, already resolved for us:
//   - "BUY"  = the user BOUGHT the token (added ADA to the pool, took out token)
//   - "SELL" = the user SOLD the token   (offered token, took out ADA)
// Ground truth: DexEventProcessor.java `swapType = deltaA.signum() > 0 ? "BUY" : "SELL"`
// (pool ADA reserve up ⇒ user bought token) and the order-UTxO classifier
// ("UTxO has a token → user is SELLING token"). The reference frontend renders
// `type` AS-IS (live/page.tsx: `isBuy = s.type === 'BUY'`; TradesPanel.tsx).
//
// DO NOT INVERT. A prior "Market Portfolio revamp" (#600) wrongly assumed an
// "ADA perspective" and flipped BUY/SELL, which displayed buys as sells and
// inverted the buy/sell pressure ratio (e.g. a pumping token showing 82% sell).
// This module exists so that logic lives in ONE tested place and cannot silently
// drift back to an inversion.

export interface TradeLike {
  type: 'BUY' | 'SELL';
  volumeAda: number;
}

export interface BuySellSummary {
  buyVolume: number;
  sellVolume: number;
  buyCount: number;
  sellCount: number;
}

/**
 * Aggregate a list of swaps into buy/sell volume + counts, rendering the
 * backend `type` as-is (token perspective). Guards non-finite volumes.
 */
export function summarizeBuySell(trades: readonly TradeLike[]): BuySellSummary {
  const summary: BuySellSummary = { buyVolume: 0, sellVolume: 0, buyCount: 0, sellCount: 0 };
  for (const trade of trades) {
    const vol = Number(trade.volumeAda);
    const safeVol = Number.isFinite(vol) ? vol : 0;
    if (trade.type === 'BUY') {
      summary.buyVolume += safeVol;
      summary.buyCount += 1;
    } else if (trade.type === 'SELL') {
      summary.sellVolume += safeVol;
      summary.sellCount += 1;
    }
  }
  return summary;
}
