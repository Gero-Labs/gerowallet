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
import WalletStore from '@/stores/walletStore';
import featureFlagsStore from '@/stores/featureFlagsStore';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import { resolveRealFiReadClient } from '../services/realfiClient';
import {
  EMPTY_POINTS,
  EMPTY_REFERRALS,
  needsAction,
  type RealFiOrder,
  type RealFiPoints,
  type RealFiPosition,
  type RealFiProtocol,
  type RealFiReferrals,
  type RealFiUnavailableReason,
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

  /** Orders the user must act on — the operator will not clear these by itself. */
  const actionableOrders = computed<RealFiOrder[]>(() => orders.value.filter(needsAction));

  const hasPosition = computed<boolean>(
    () => position.value !== null && position.value.totalSUSDr !== '0',
  );

  /**
   * A wallet with no points record yet is distinct from one holding zero points, and
   * the UI says something different for each — so this asks "is there a record", not
   * "is the balance truthy".
   */
  const hasPointsRecord = computed<boolean>(() => points.value.pointsBalance !== null);

  function reset(): void {
    position.value = null;
    points.value = EMPTY_POINTS;
    referrals.value = EMPTY_REFERRALS;
    orders.value = [];
    protocol.value = null;
  }

  async function load(): Promise<void> {
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

    isLoading.value = true;
    try {
      const resolved = await resolveRealFiReadClient(w.network);
      if (resolved.status === 'unavailable') {
        reset();
        unavailableReason.value = resolved.reason;
        return;
      }

      const client = resolved.client;
      const address = w.baseAddress as string;

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
      unavailableReason.value = allFailed ? 'request-failed' : null;
    } catch (error) {
      debugLog('[RealFi] failed to load account state', error);
      unavailableReason.value = 'request-failed';
    } finally {
      isLoading.value = false;
    }
  }

  return {
    isLoading,
    unavailableReason,
    isAvailable,
    position,
    points,
    referrals,
    orders,
    protocol,
    actionableOrders,
    hasPosition,
    hasPointsRecord,
    load,
  };
}
