/**
 * Balance / cost helpers for Strike Finance perpetuals.
 *
 * Spec: strike-finance-skills/skills/strike-calculations/SKILL.md
 *   (Withdrawable Balance, Order Cost preview).
 */

/**
 * Compute the amount of margin asset that can be safely withdrawn while
 * keeping all open cross positions within their margin requirements.
 *
 *   WithdrawableBalance = max(0, BaseBalance - max(CrossIM - CrossUPnL, CrossMM))
 *
 *     BaseBalance = WalletBalance - Sum(isolated)IsoBalance - Sum(TotalOrderCost)
 *
 * Negative inputs are clamped — the function never returns less than 0.
 */
export function calcWithdrawableBalance(
  walletBalance: number,
  totalIsoBalance: number,
  totalOrderCost: number,
  crossInitialMargin: number,
  crossUnrealizedPnl: number,
  crossMaintenanceMargin: number,
): number {
  if (!isFinite(walletBalance)) return 0;
  const baseBalance = walletBalance - totalIsoBalance - totalOrderCost;
  const marginRequirement = Math.max(
    crossInitialMargin - crossUnrealizedPnl,
    crossMaintenanceMargin,
  );
  return Math.max(0, baseBalance - marginRequirement);
}

/**
 * Estimate the up-front cost of placing a leveraged order: required
 * margin plus the taker fee. Used by the order form to render a single
 * "cost" preview.
 *
 *   margin     = (price * size) / leverage
 *   takerFee   = price * size * takerFeeRate
 *   orderCost  = margin + takerFee
 */
export function calcOrderCost(
  price: number,
  size: number,
  leverage: number,
  takerFeeRate: number,
): number {
  if (!isFinite(price) || !isFinite(size) || price <= 0 || size <= 0) return 0;
  const notional = price * size;
  const margin = leverage > 0 ? notional / leverage : notional;
  const fee = notional * Math.max(0, takerFeeRate);
  return margin + fee;
}
