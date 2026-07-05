/**
 * Strike perpetuals math layer — pure number-in / number-out functions.
 * String-encoded API decimals must be parsed at the boundary.
 *
 * Reference: strike-finance-skills/skills/strike-calculations/SKILL.md
 */

export {
  calcNotional,
  calcUnrealizedPnl,
  calcPnlPercentage,
  calcCurrentMargin,
  calcMaintenanceMargin,
  calcLiquidationPriceIsolated,
  calcLiquidationPriceCross,
  calcPositionSummary,
  calcTpSlPriceFromPercentage,
  calcTpSlPriceFromUsd,
} from './positionCalculations';

export type {
  PositionSide,
  MarginType,
  CrossPositionInput,
  IsolatedPositionInput,
  PositionSummary,
  CalcPositionSummaryParams,
} from './positionCalculations';

export {
  getMarginTier,
  getMaxLeverageForNotional,
  normalizeMarginTiers,
} from './marginTiers';

export {
  calcVwapMarketFill,
  groupOrderBookLevels,
} from './orderBookUtils';

export type {
  OrderBookLevels,
  VwapFillResult,
} from './orderBookUtils';

export {
  calcWithdrawableBalance,
  calcOrderCost,
} from './balanceCalculations';
