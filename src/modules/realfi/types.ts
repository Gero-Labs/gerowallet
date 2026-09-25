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
