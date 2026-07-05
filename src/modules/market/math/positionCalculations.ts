/**
 * Position math for Strike Finance perpetuals.
 *
 * All functions are pure number-in / number-out — convert
 * string-encoded API decimals at the boundary (helpers in `index.ts`).
 *
 * Spec: strike-finance-skills/skills/strike-calculations/SKILL.md
 */

import type { MarginTierNumeric } from '@/api/strike-v2.types';
import { getMarginTier } from './marginTiers';

export type PositionSide = 'LONG' | 'SHORT';
export type MarginType = 'cross' | 'isolated';

export interface CrossPositionInput {
  symbol: string;
  side: PositionSide;
  size: number;
  entryPrice: number;
  markPrice: number;
  notional: number;
  tier: MarginTierNumeric;
}

export interface IsolatedPositionInput {
  isoBalance: number;
}

export interface PositionSummary {
  unrealizedPnl: number;
  pnlPercentage: number;
  notional: number;
  currentMargin: number;
  maintenanceMargin: number;
  liquidationPrice: number;
}

// ---------------------------------------------------------------------------
// Notional value
// ---------------------------------------------------------------------------

/**
 * Notional value of a position.
 *
 *   Notional = MarkPrice * |Size|
 */
export function calcNotional(markPrice: number, size: number): number {
  if (!isFinite(markPrice) || !isFinite(size)) return 0;
  return markPrice * Math.abs(size);
}

// ---------------------------------------------------------------------------
// Unrealized PnL
// ---------------------------------------------------------------------------

/**
 * Unrealized PnL for an open position.
 *
 *   LONG:  uPnL = (MarkPrice - EntryPrice) * Size
 *   SHORT: uPnL = (EntryPrice - MarkPrice) * Size
 *
 * `size` should always be positive — direction comes from `side`.
 */
export function calcUnrealizedPnl(
  side: PositionSide,
  entryPrice: number,
  markPrice: number,
  size: number,
): number {
  if (!isFinite(entryPrice) || !isFinite(markPrice) || !isFinite(size)) return 0;
  const absSize = Math.abs(size);
  if (side === 'LONG') {
    return (markPrice - entryPrice) * absSize;
  }
  return (entryPrice - markPrice) * absSize;
}

// ---------------------------------------------------------------------------
// PnL percentage
// ---------------------------------------------------------------------------

/**
 * PnL relative to the current margin (i.e. ROI of the margin posted).
 *
 *   pnlPercentage = (uPnL / currentMargin) * 100
 */
export function calcPnlPercentage(unrealizedPnl: number, currentMargin: number): number {
  if (!currentMargin || !isFinite(currentMargin)) return 0;
  return (unrealizedPnl / currentMargin) * 100;
}

// ---------------------------------------------------------------------------
// Current margin
// ---------------------------------------------------------------------------

/**
 * Current margin posted on a position.
 *
 *   Isolated: currentMargin = isoBalance
 *   Cross:    currentMargin = Notional / Leverage
 */
export function calcCurrentMargin(
  marginType: MarginType,
  isoBalance: number,
  notional: number,
  leverage: number,
): number {
  if (marginType === 'isolated') {
    return Math.max(0, isoBalance);
  }
  if (!leverage || leverage <= 0) return 0;
  return notional / leverage;
}

// ---------------------------------------------------------------------------
// Maintenance margin
// ---------------------------------------------------------------------------

/**
 * Maintenance margin requirement for a notional under a given tier.
 *
 *   MM = Notional * MMR - MaintenanceAmount
 */
export function calcMaintenanceMargin(
  notional: number,
  tier: MarginTierNumeric,
): number {
  return notional * tier.maintenance_margin_rate - tier.maintenance_amount;
}

// ---------------------------------------------------------------------------
// Liquidation price — isolated
// ---------------------------------------------------------------------------

/**
 * Liquidation price for an isolated-margin position. Fixed value — does
 * not move with the mark price.
 *
 *   LP = (EP - (IsoBalance + MA) / Size) / (1 - Direction * MMR)
 *
 *   Direction = +1 (LONG) | -1 (SHORT)
 *
 * Returns 0 if the position is immediately liquidatable or the formula
 * produces a non-physical price (LONG with LP >= EP, SHORT with LP <= EP).
 */
export function calcLiquidationPriceIsolated(
  side: PositionSide,
  entryPrice: number,
  isoBalance: number,
  size: number,
  tier: MarginTierNumeric,
): number {
  const absSize = Math.abs(size);
  if (absSize <= 0 || !isFinite(entryPrice) || !isFinite(isoBalance)) return 0;

  const direction = side === 'LONG' ? 1 : -1;
  const mmr = tier.maintenance_margin_rate;
  const ma = tier.maintenance_amount;

  const denominator = 1 - direction * mmr;
  if (denominator === 0) return 0;

  const numerator = entryPrice - (isoBalance + ma) / absSize;
  const liqPrice = numerator / denominator;

  if (!isFinite(liqPrice) || liqPrice <= 0) return 0;
  if (side === 'LONG' && liqPrice >= entryPrice) return 0;
  if (side === 'SHORT' && liqPrice <= entryPrice) return 0;

  return liqPrice;
}

// ---------------------------------------------------------------------------
// Liquidation price — cross
// ---------------------------------------------------------------------------

/**
 * Liquidation price for a cross-margin position. Varies with wallet
 * balance and mark prices of other open cross positions.
 *
 *   LP = (EP - (W + TU - TM + MA) / Size) / (1 - Direction * MMR)
 *
 *   W  = WalletBalance - Sum(isolated)IsoBalance
 *   TU = Sum(other cross) UnrealizedPnL
 *   TM = Sum(other cross) MaintenanceMargin
 */
export function calcLiquidationPriceCross(
  position: CrossPositionInput,
  walletBalance: number,
  otherCrossPositions: CrossPositionInput[],
  isolatedPositions: IsolatedPositionInput[],
  tier: MarginTierNumeric,
): number {
  const absSize = Math.abs(position.size);
  if (absSize <= 0) return 0;

  const direction = position.side === 'LONG' ? 1 : -1;
  const mmr = tier.maintenance_margin_rate;
  const ma = tier.maintenance_amount;

  const totalIsoBalance = isolatedPositions.reduce((sum, p) => sum + p.isoBalance, 0);
  const W = walletBalance - totalIsoBalance;

  const TU = otherCrossPositions.reduce(
    (sum, p) => sum + calcUnrealizedPnl(p.side, p.entryPrice, p.markPrice, p.size),
    0,
  );

  const TM = otherCrossPositions.reduce(
    (sum, p) => sum + calcMaintenanceMargin(p.notional, p.tier),
    0,
  );

  const denominator = 1 - direction * mmr;
  if (denominator === 0) return 0;

  const numerator = position.entryPrice - (W + TU - TM + ma) / absSize;
  const liqPrice = numerator / denominator;

  if (!isFinite(liqPrice) || liqPrice <= 0) return 0;
  if (position.side === 'LONG' && liqPrice >= position.entryPrice) return 0;
  if (position.side === 'SHORT' && liqPrice <= position.entryPrice) return 0;

  return liqPrice;
}

// ---------------------------------------------------------------------------
// Position summary
// ---------------------------------------------------------------------------

export interface CalcPositionSummaryParams {
  side: PositionSide;
  marginType: MarginType;
  entryPrice: number;
  markPrice: number;
  size: number;
  leverage: number;
  isoBalance: number;
  tiers: MarginTierNumeric[];
  // Cross-only context
  walletBalance?: number;
  otherCrossPositions?: CrossPositionInput[];
  isolatedPositions?: IsolatedPositionInput[];
}

/**
 * Compose every per-position derived value (notional, uPnL, margin, MM,
 * liquidation price) in one call. Returns zeros when inputs are
 * insufficient or the position would be immediately liquidatable.
 */
export function calcPositionSummary(params: CalcPositionSummaryParams): PositionSummary {
  const {
    side, marginType, entryPrice, markPrice, size, leverage,
    isoBalance, tiers,
    walletBalance, otherCrossPositions, isolatedPositions,
  } = params;

  const notional = calcNotional(markPrice, size);
  const tier = getMarginTier(tiers, notional);

  if (!tier) {
    return {
      unrealizedPnl: 0,
      pnlPercentage: 0,
      notional,
      currentMargin: 0,
      maintenanceMargin: 0,
      liquidationPrice: 0,
    };
  }

  const unrealizedPnl = calcUnrealizedPnl(side, entryPrice, markPrice, size);
  const currentMargin = calcCurrentMargin(marginType, isoBalance, notional, leverage);
  const pnlPercentage = calcPnlPercentage(unrealizedPnl, currentMargin);
  const maintenanceMargin = calcMaintenanceMargin(notional, tier);

  let liquidationPrice: number;
  if (marginType === 'isolated') {
    liquidationPrice = calcLiquidationPriceIsolated(side, entryPrice, isoBalance, size, tier);
  } else {
    liquidationPrice = calcLiquidationPriceCross(
      { symbol: '', side, size, entryPrice, markPrice, notional, tier },
      walletBalance ?? 0,
      otherCrossPositions ?? [],
      isolatedPositions ?? [],
      tier,
    );
  }

  return {
    unrealizedPnl,
    pnlPercentage,
    notional,
    currentMargin,
    maintenanceMargin,
    liquidationPrice,
  };
}

// ---------------------------------------------------------------------------
// TP / SL price conversions
// ---------------------------------------------------------------------------

/**
 * Convert a target ROI percentage on margin into a TP/SL trigger price.
 *
 *   LONG:  tpPrice = entryPrice + (percentage / 100) * margin / size
 *   SHORT: tpPrice = entryPrice - (percentage / 100) * margin / size
 */
export function calcTpSlPriceFromPercentage(
  side: PositionSide,
  entryPrice: number,
  percentage: number,
  margin: number,
  size: number,
): number {
  const absSize = Math.abs(size);
  if (absSize <= 0) return 0;
  const offset = (percentage / 100) * margin / absSize;
  return side === 'LONG' ? entryPrice + offset : entryPrice - offset;
}

/**
 * Convert a target USD gain into a TP/SL trigger price.
 *
 *   LONG:  tpPrice = entryPrice + usdGain / size
 *   SHORT: tpPrice = entryPrice - usdGain / size
 */
export function calcTpSlPriceFromUsd(
  side: PositionSide,
  entryPrice: number,
  usdGain: number,
  size: number,
): number {
  const absSize = Math.abs(size);
  if (absSize <= 0) return 0;
  const offset = usdGain / absSize;
  return side === 'LONG' ? entryPrice + offset : entryPrice - offset;
}
