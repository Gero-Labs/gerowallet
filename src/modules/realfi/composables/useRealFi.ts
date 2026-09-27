/**
 * Loads a wallet's RealFi state for the Earn page.
 *
 * A composable rather than an Observable store on purpose: this data is read-only,
 * per-wallet, and only ever rendered by the Earn surface. Nothing in the background
 * needs it and no other context subscribes to it, so the broadcast-store machinery
 * would be cost without benefit. If a background consumer ever appears — a claim-ready
 * notification, say — that is the moment to promote this to a store, not before.
 */

import { computed, ref } from 'vue';
import WalletStore, { walletStore } from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import NetworkStore from '@/stores/networkStore';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import { resolveRealFiReadClient, type RealFiReadClient } from '../services/realfiClient';
import { susdrAssetIdFor, usdrAssetIdFor } from '../assets';
import {
  EMPTY_POINTS,
  EMPTY_REFERRALS,
  fromSmallestUnit,
  isClaimable,
  isFailed,
  isInReview,
  needsAction,
  type RealFiOrder,
  type RealFiPoints,
  type RealFiPosition,
  type RealFiProtocol,
  type RealFiReferrals,
  type RealFiUnavailableReason,
  type SmallestUnit,
} from '../types';

export function useRealFi() {
  const isLoading = ref(false);
  /** Set once we know why there is no data. Null while things are working. */
  const unavailableReason = ref<RealFiUnavailableReason | null>(null);

  const position = ref<RealFiPosition | null>(null);
  const points = ref<RealFiPoints>(EMPTY_POINTS);
  const referrals = ref<RealFiReferrals>(EMPTY_REFERRALS);
  const orders = ref<RealFiOrder[]>([]);
  const protocol = ref<RealFiProtocol | null>(null);

  const wallet = computed(() => WalletStore.state.loggedWallet);

  /**
   * Both gates, ANDed, exactly as the router and the nav item apply them: the flag
   * says the feature is live, the network resolver says this wallet can reach it.
   */
  const isAvailable = computed<boolean>(() => {
    const w = wallet.value;
    if (!w) return false;
    return (
      networks.resolveRealFiSupport(w.chain, w.network) && featureFlagsStore.isRealFiEnabled()
    );
  });

  /**
   * In-wallet orders: the Earn gates plus the staking flag. Off, the page hands
   * transacting to RealFi's own app exactly as before.
   */
  const canTransact = computed<boolean>(
    () => isAvailable.value && featureFlagsStore.isRealFiStakingEnabled(),
  );

  /** A held token's quantity in smallest units, as the exact decimal string. */
  function heldUnits(assetId: string | null): SmallestUnit {
    if (!assetId) return '0';
    const held = (walletStore.tokens as Record<string, { quantity?: unknown }>)[assetId];
    const quantity = held?.quantity;
    if (typeof quantity === 'bigint') return quantity.toString();
    if (typeof quantity === 'string' && /^\d+$/.test(quantity)) return quantity;
    if (typeof quantity === 'number' && Number.isSafeInteger(quantity) && quantity >= 0) {
      return String(quantity);
    }
    return '0';
  }

  /**
   * USDrf sitting in the wallet, unstaked.
   *
   * Read straight off the wallet's token map rather than from RealFi: it is a plain
   * balance we already hold, and it is the difference between "you have nothing" and
   * "you have money one step away from earning". Decimals are RealFi's fixed 6 rather
   * than the token's metadata, so a registry lag can never misstate it by 1e6.
   *
   * RealFi's own asset id first; the known one if the protocol read failed, so one
   * missing call cannot turn "you're ready to stake" into "go and get USDrf".
   */
  const usdrUnits = computed<SmallestUnit>(() =>
    heldUnits(protocol.value?.stablecoinAssetId ?? usdrAssetIdFor(wallet.value?.network)),
  );
  const usdrBalance = computed<number>(() => fromSmallestUnit(usdrUnits.value));
  const hasUsdr = computed<boolean>(() => usdrBalance.value > 0);

  /** sUSDrf in the wallet — what an unstake spends. */
  const susdrUnits = computed<SmallestUnit>(() =>
    heldUnits(susdrAssetIdFor(wallet.value?.network)),
  );
  const susdrBalance = computed<number>(() => fromSmallestUnit(susdrUnits.value));

  /** The chain tip's slot, from Gero Sync. Null until the first tip arrives. */
  const currentSlot = computed<number | null>(() => NetworkStore.getCurrentSlot());

  /** Executed unstakes whose timelock has opened: ready to claim. */
  const claimableOrders = computed<RealFiOrder[]>(() =>
    orders.value.filter((o) => isClaimable(o, currentSlot.value)),
  );


  /** Orders the user must act on — the operator will not clear these by itself. */
  const actionableOrders = computed<RealFiOrder[]>(() => orders.value.filter(needsAction));

  /** Orders paused for RealFi's compliance review — nothing to do, but worth saying. */
  const reviewOrders = computed<RealFiOrder[]>(() => orders.value.filter(isInReview));

  /** Orders that went wrong with no documented recovery — the user needs RealFi support. */
  const failedOrders = computed<RealFiOrder[]>(() => orders.value.filter(isFailed));

  const hasPosition = computed<boolean>(
    () => position.value !== null && position.value.totalSUSDr !== '0',
  );

  /**
   * A wallet with no points record yet is distinct from one holding zero points, and
   * the UI says something different for each — so this asks "is there a record", not
   * "is the balance truthy".
   */
  const hasPointsRecord = computed<boolean>(() => points.value.pointsBalance !== null);

  /** The client and address from the last successful load, for user-initiated reads. */
  let activeClient: RealFiReadClient | null = null;
  let activeAddress: string | null = null;
  const isRequestingCode = ref(false);

  function reset(): void {
    position.value = null;
    points.value = EMPTY_POINTS;
    referrals.value = EMPTY_REFERRALS;
    orders.value = [];
    protocol.value = null;
  }

  /**
   * @param options.quiet A background refresh (the page polling for an order it just
   *   placed): no loading state, so nothing flickers, and a failed refresh leaves the
   *   page as it was rather than replacing it with an error.
   */
  async function load(options: { quiet?: boolean } = {}): Promise<void> {
    const quiet = options.quiet === true;
    const w = wallet.value;
    if (!w?.baseAddress) {
      unavailableReason.value = 'unsupported-network';
      return;
    }
    if (!isAvailable.value) {
      reset();
      unavailableReason.value = 'unsupported-network';
      return;
    }

    if (!quiet) isLoading.value = true;
    try {
      const resolved = await resolveRealFiReadClient(w.network);
      if (resolved.status === 'unavailable') {
        reset();
        unavailableReason.value = resolved.reason;
        return;
      }

      const client = resolved.client;
      const address = w.baseAddress as string;
      activeClient = client;
      activeAddress = address;

      // Independent reads — one slow endpoint should not hold up the rest of the page.
      // `allSettled` so a single failing call degrades that card alone rather than
      // blanking a screen that may be showing someone their staked balance.
      const [positionResult, pointsResult, referralsResult, ordersResult, protocolResult] =
        await Promise.allSettled([
          client.getPosition(address),
          client.getPoints(address),
          client.getReferrals(address),
          client.getOrders(address),
          client.getProtocol(),
        ]);

      if (positionResult.status === 'fulfilled') position.value = positionResult.value;
      if (pointsResult.status === 'fulfilled') points.value = pointsResult.value;
      if (referralsResult.status === 'fulfilled') referrals.value = referralsResult.value;
      if (ordersResult.status === 'fulfilled') orders.value = ordersResult.value;
      if (protocolResult.status === 'fulfilled') protocol.value = protocolResult.value;

      const allFailed = [
        positionResult,
        pointsResult,
        referralsResult,
        ordersResult,
        protocolResult,
      ].every((r) => r.status === 'rejected');

      // The indexer behind these reads can briefly lag the chain. A failed read means
      // "unknown", never "gone" — so a partial failure leaves whatever we already have
      // on screen rather than replacing it with an error.
      if (!quiet || !allFailed) unavailableReason.value = allFailed ? 'request-failed' : null;
    } catch (error) {
      debugLog('[RealFi] failed to load account state', error);
      if (!quiet) unavailableReason.value = 'request-failed';
    } finally {
      if (!quiet) isLoading.value = false;
    }
  }

  /**
   * Fetch — and if the wallet has none, create — its RealFi referral code.
   *
   * Separate from `load()` on purpose. RealFi mints a code the first time one is read,
   * which enrols the wallet in their referral programme; that has to be the user's
   * tap, never a side effect of opening the page. Idempotent after the first call.
   */
  async function requestReferralCode(): Promise<void> {
    if (!activeClient || !activeAddress || isRequestingCode.value) return;
    isRequestingCode.value = true;
    try {
      referrals.value = await activeClient.getReferrals(activeAddress, true);
    } catch (error) {
      debugLog('[RealFi] failed to fetch referral code', error);
    } finally {
      isRequestingCode.value = false;
    }
  }

  return {
    isLoading,
    isRequestingCode,
    unavailableReason,
    isAvailable,
    position,
    points,
    referrals,
    orders,
    protocol,
    actionableOrders,
    reviewOrders,
    failedOrders,
    hasPosition,
    hasPointsRecord,
    usdrBalance,
    usdrUnits,
    hasUsdr,
    susdrBalance,
    susdrUnits,
    canTransact,
    currentSlot,
    claimableOrders,
    load,
    requestReferralCode,
  };
}
