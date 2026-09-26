/**
 * RealFi Earn — domain types.
 *
 * The wallet never calls RealFi or its SDK. Nexus brokers every read
 * (`/api/realfi/*`, reached through gero-backend's Nexus proxy), and these are the
 * shapes the client maps Nexus's responses onto. Keeping them as our own declarations
 * means the Earn UI does not change when RealFi's schema does — Nexus absorbs it.
 *
 * Amounts stay strings end to end; see `SmallestUnit`.
 */

/** USDr and sUSDr both carry 6 decimals (confirmed in the Cardano token registry). */
export const REALFI_DECIMALS = 6;

/**
 * An on-chain amount in the asset's SMALLEST unit, carried as a decimal string.
 *
 * The SDK speaks `bigint`; chrome messaging and `chrome.storage.local` do not, and
 * the store-broadcast helper stringifies bigints anyway. Keeping one string
 * representation end to end avoids a lossy `Number` hop in the middle — `12_106_421_500n`
 * is 12,106.4215 sUSDr, and that precision is the user's money.
 *
 * Convert for display only, at the render edge, via `fromSmallestUnit`.
 */
export type SmallestUnit = string;

/** Convert a smallest-unit amount to a display number. Presentation only. */
export function fromSmallestUnit(value: SmallestUnit | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 10 ** REALFI_DECIMALS : 0;
}

/**
 * Parse what a user typed ("12.5", "0.000001") into smallest units.
 *
 * String arithmetic, never `Number`: "0.1" through a float is 99999.99… units, and an
 * order for one unit less than the user asked for is a bug they can see on-chain.
 *
 * A dot is the only decimal separator, and there are no thousands separators. A comma
 * is refused rather than interpreted: "1,5" is one and a half to a German reader and
 * fifteen with the comma dropped, and "1,500" means 1.5 or 1500 depending on who typed
 * it. Guessing wrong orders the wrong amount, so the user is asked to retype instead.
 *
 * Returns null for anything that is not a positive amount with at most 6 decimals.
 */
export function toSmallestUnit(input: string): SmallestUnit | null {
  const cleaned = input.trim();
  const match = /^(\d*)(?:\.(\d*))?$/.exec(cleaned);
  if (!match || cleaned === '' || cleaned === '.') return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (fraction.length > REALFI_DECIMALS) return null;
  const units = `${whole}${fraction.padEnd(REALFI_DECIMALS, '0')}`.replace(/^0+/, '');
  return units === '' ? null : units;
}

/** Compare two smallest-unit amounts without a lossy Number hop. */
export function compareUnits(a: SmallestUnit, b: SmallestUnit): number {
  const x = BigInt(a);
  const y = BigInt(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/**
 * A wallet's staked position — `api.getYieldBreakdown(address)`.
 *
 * `earned` is the SDK's `yield` field, renamed because `yield` is a reserved word in
 * a strict-mode module (the SDK's own guide renames it for the same reason).
 */
export interface RealFiPosition {
  totalSUSDr: SmallestUnit;
  totalUSDrValue: SmallestUnit;
  principal: SmallestUnit;
  earned: SmallestUnit;
  /** Percent, as returned (3.16 means 3.16%), not a fraction. */
  yieldPercent: number;
}

/**
 * Points balance — `api.getPointsBalance(address)`.
 *
 * Every field is `null` for a wallet with no points record yet, which is the COMMON
 * case at launch rather than an edge case. The UI must render "no record" distinctly
 * from "zero points"; they mean different things to a user deciding whether the
 * programme is working for them.
 *
 * The semantics of `potentialPoints` and `multiplier` are not documented by RealFi.
 * Until they are, treat these as display-only and do not derive anything from them.
 */
export interface RealFiPoints {
  pointsBalance: number | null;
  potentialPoints: number | null;
  multiplier: number | null;
}

/** Referral state — `getReferrerCode` + `getInvitedCount` + `getReferralRewards`. */
export interface RealFiReferrals {
  /** `null` until the wallet has been issued a code. */
  code: string | null;
  createdAt: string | null;
  invitedCount: number;
  /** Points earned from referees. */
  rewardPoints: number;
}

/**
 * Order settlement status — `TOrderStatus`.
 *
 * `InvalidMinReceived` (SDK 2.12.0+) means settlement rejected the order's output
 * floor rather than executing at a worse rate. `Invalidated` means a protocol upgrade
 * stranded it. Both are terminal-but-recoverable: the funds are still the owner's, and
 * RealFi's operator does NOT auto-cancel — the user has to act. See `needsAction`.
 */
export type RealFiOrderStatus =
  | 'Open'
  | 'Validating'
  | 'Executed'
  | 'Canceled'
  | 'Invalidated'
  | 'InvalidMinReceived'
  /** Paused for RealFi's compliance screening (SDK 2.18+). No action needed yet. */
  | 'HeldForScreening'
  /** Invalidated by that screening. Whether a cancel recovers it is not documented. */
  | 'InvalidatedBlockedScreening'
  /** Quarantined after repeated processing failures (SDK 3.1). */
  | 'Failed'
  | 'Rejected';

export type RealFiOrderAction =
  | 'Mint'
  | 'Redeem'
  | 'Stake'
  | 'Unstake'
  | 'Deposit'
  | 'Withdraw'
  | 'DirectMint'
  | 'DirectBurn';

export interface RealFiOrder {
  txHash: string;
  /** The order's output index. With `txHash`, the order's identity. */
  outputIndex: number;
  action: RealFiOrderAction;
  status: RealFiOrderStatus;
  /** Present on an Unstake once its released USDr has been claimed from the timelock. */
  claimTxHash?: string;
  /**
   * Unstake only: the slot its timelock opens at. The claim must be built with THIS
   * value — a fresh one derives a different timelock address that holds nothing.
   */
  unlockSlot?: string;
  /** The output an Executed order produced. For an Unstake, what the claim spends. */
  resultTxHash?: string;
  resultOutputIndex?: number;
}

/**
 * Statuses that require the user to do something before their funds move again.
 *
 * The operator will not clear these on its own, so an order in one of them sitting
 * silently in a list is the failure mode this whole surface exists to prevent.
 */
export const ORDER_STATUSES_NEEDING_ACTION: readonly RealFiOrderStatus[] = [
  'Invalidated',
  'InvalidMinReceived',
];

export function needsAction(order: RealFiOrder): boolean {
  return ORDER_STATUSES_NEEDING_ACTION.includes(order.status);
}

/**
 * Orders the owner can cancel to get their funds back: still waiting, or stranded.
 *
 * `Validating`, `HeldForScreening` and the failure statuses are deliberately absent —
 * the operator is mid-flight on the first two, and a cancel is not a documented way out
 * of the others.
 */
export function isCancellable(order: RealFiOrder): boolean {
  return order.status === 'Open' || needsAction(order);
}

/** An executed unstake whose released USDr still sits in its timelock. */
export function isUnclaimed(order: RealFiOrder): boolean {
  return (
    order.action === 'Unstake' &&
    order.status === 'Executed' &&
    !order.claimTxHash &&
    !!order.resultTxHash &&
    order.resultOutputIndex !== undefined &&
    !!order.unlockSlot
  );
}

/**
 * Unclaimed AND its timelock has opened. The claim transaction is only valid from
 * `unlockSlot` on, so offering it earlier would build something the chain rejects.
 */
export function isClaimable(order: RealFiOrder, currentSlot: number | null): boolean {
  if (!isUnclaimed(order) || currentSlot === null) return false;
  return BigInt(currentSlot) >= BigInt(order.unlockSlot as string);
}

/** Terminal statuses — no further settlement will happen. */
export function isSettled(order: RealFiOrder): boolean {
  return order.status === 'Executed' || order.status === 'Canceled';
}

/** Every status, in one place — the client, the page and the tests all read this. */
export const ORDER_STATUS_VALUES: readonly RealFiOrderStatus[] = [
  'Open',
  'Validating',
  'Executed',
  'Canceled',
  'Invalidated',
  'InvalidMinReceived',
  'HeldForScreening',
  'InvalidatedBlockedScreening',
  'Failed',
  'Rejected',
];

/** Every action, in one place. */
export const ORDER_ACTION_VALUES: readonly RealFiOrderAction[] = [
  'Mint',
  'Redeem',
  'Stake',
  'Unstake',
  'Deposit',
  'Withdraw',
  'DirectMint',
  'DirectBurn',
];

/**
 * Paused for RealFi's compliance screening (SDK 2.18). Nothing is wrong and nothing
 * is asked of the user — but an order that sits still with no explanation reads as
 * stuck, so the page says what is happening.
 */
export const ORDER_STATUSES_IN_REVIEW: readonly RealFiOrderStatus[] = ['HeldForScreening'];

export function isInReview(order: RealFiOrder): boolean {
  return ORDER_STATUSES_IN_REVIEW.includes(order.status);
}

/**
 * Statuses that went wrong but carry no documented recovery path.
 *
 * Shown as a problem rather than as "still working", and deliberately NOT folded into
 * `needsAction`: telling someone to cancel an order that may not be cancellable is
 * worse than stating plainly what happened.
 */
export const ORDER_STATUSES_FAILED: readonly RealFiOrderStatus[] = [
  'InvalidatedBlockedScreening',
  'Failed',
  'Rejected',
];

export function isFailed(order: RealFiOrder): boolean {
  return ORDER_STATUSES_FAILED.includes(order.status);
}

/**
 * Protocol-wide state — `GET /api/realfi/protocol`. Identical for every wallet, which
 * is why Nexus caches it once for everybody.
 */
export interface RealFiProtocol {
  /** Canonical USDr asset id, concatenated form — how `walletStore.tokens` is keyed. */
  stablecoinAssetId: string | null;
  fees: {
    mintBps: number;
    redeemBps: number;
  };
  /** USD UX limits from RealFi's partner config — $100 on preprod, $1 on mainnet. */
  limits: {
    mintMinUsd: number;
    redeemMinUsd: number;
  };
  /**
   * The latest APY RealFi publishes: the weighted average of the private-credit fund
   * behind sUSDr. Gross and historical, never a promise — which is why it is useless
   * without `apyAsOf`. Null when RealFi publishes none (the case at launch).
   */
  apyPercent: number | null;
  /** ISO date (yyyy-MM-dd) `apyPercent` was published. */
  apyAsOf: string | null;
  /** The cooldown boundary an unstake placed now binds to. Null if RealFi gave none. */
  nextCooldownSlot: string | null;
}

/**
 * Why the Earn surface cannot currently serve data.
 *
 * Modelled explicitly rather than as a bare `null` so the UI can say something true
 * and specific. "Unavailable" and "we could not reach RealFi" are different messages,
 * and a user who has money staked deserves to know which one they are looking at.
 */
export type RealFiUnavailableReason =
  /** The wallet's chain/network has no RealFi deployment (see networks.resolveRealFiSupport). */
  | 'unsupported-network'
  /** Reached RealFi, but the request failed. Transient; retry is meaningful. */
  | 'request-failed';

export interface RealFiSnapshot {
  position: RealFiPosition | null;
  points: RealFiPoints;
  referrals: RealFiReferrals;
  orders: RealFiOrder[];
  protocol: RealFiProtocol | null;
}

export const EMPTY_POINTS: RealFiPoints = {
  pointsBalance: null,
  potentialPoints: null,
  multiplier: null,
};

export const EMPTY_REFERRALS: RealFiReferrals = {
  code: null,
  createdAt: null,
  invitedCount: 0,
  rewardPoints: 0,
};
