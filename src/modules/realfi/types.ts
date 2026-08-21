/**
 * RealFi Earn — domain types.
 *
 * These mirror the read shapes documented in `@realfi-co/realfi-partner-sdk`
 * (PARTNER_GUIDE.md "Reading account state" / "Protocol transparency", 2.12) but are
 * DELIBERATELY our own declarations rather than re-exports of the SDK's:
 *
 *  - the SDK is a private package, so the repo must typecheck and build without it;
 *  - these values cross the chrome messaging boundary, where `bigint` cannot travel.
 *
 * Hence the amount convention below.
 */

/** USDr and sUSDr both carry 6 decimals (PARTNER_GUIDE.md "Amounts"). */
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
  | 'InvalidMinReceived';

export type RealFiOrderAction =
  | 'Mint'
  | 'Redeem'
  | 'Stake'
  | 'Unstake'
  | 'Deposit'
  | 'Withdraw';

export interface RealFiOrder {
  txHash: string;
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

/**
 * Protocol-wide state. Identical for every wallet, so this is the one read worth
 * caching centrally rather than per-session.
 */
export interface RealFiProtocol {
  /**
   * Circulating supply figures read from the treasury / staking-vault datums.
   *
   * `null` until the on-chain half of the SDK is wired: these are the only fields
   * here that need a Blaze instance and a Cardano provider. Everything else on this
   * interface comes from `RealfiSDK.api`, which needs neither — which is why the
   * read-only surface can ship before any provider work lands.
   */
  circulatingUsdr: SmallestUnit | null;
  circulatingSusdr: SmallestUnit | null;
  /** USDr per sUSDr, diffusion-aware where the deployed protocol line supports it. */
  usdrPerSusdr: number;
  reserveAssetCount: number;
  fees: {
    mintBps: number;
    redeemBps: number;
  };
  limits: {
    mintMinUsd: number;
    redeemMinUsd: number;
  };
}

/**
 * Why the Earn surface cannot currently serve data.
 *
 * Modelled explicitly rather than as a bare `null` so the UI can say something true
 * and specific. "Unavailable" and "we could not reach RealFi" are different messages,
 * and a user who has money staked deserves to know which one they are looking at.
 */
export type RealFiUnavailableReason =
  /** The partner SDK is not installed in this build (no npm credential at build time). */
  | 'sdk-missing'
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
