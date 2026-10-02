import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import type { CardInfo } from '@/models/card';
import cardStore from '@/stores/modules/card';
import { cardUuidFromOrderStatus } from '@/modules/wallet/utils/cardApiCompat';
import { deliveryPaymentState, type DeliveryPaymentState } from '@/modules/wallet/utils/cardOrderTracker';

export interface OrderSnapshot {
  /** Order status: new, dispatched, activating, done, rejected, unknown. */
  status: string | null;
  /** Delivery-fee state (physical orders only). */
  payment: DeliveryPaymentState;
  /** When the current delivery-fee deposit address stops accepting payments. */
  expiresAt: string | null;
}

/** The provider asks clients to poll for the issued card; 10 s is its suggested pace. */
const POLL_MS = 10_000;

/**
 * Watches every order that has no card yet: its status, its delivery fee and the card
 * issued for it. As soon as a card UUID exists the card list is reloaded, which moves the
 * order out of this set. Polling pauses while the page is hidden.
 */
export function useOrderTracking(cards: ComputedRef<CardInfo[]>) {
  const snapshots = ref<Record<string, OrderSnapshot>>({});
  const checking = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;

  const pendingOrders = computed(() =>
    cards.value.filter(card => {
      const data = card.cardData;
      if (!data?.order_uuid || data.card_uuid) return false;
      if (data.status?.toLowerCase() === 'rejected' || data.delivery?.payment_status === 'expired') return false;
      // An order the provider already ended needs no more polling.
      const seen = snapshots.value[data.order_uuid];
      return !seen || (seen.status !== 'rejected' && seen.payment !== 'rejected' && seen.payment !== 'expired');
    }),
  );

  function snapshotOf(orderUuid: string | null | undefined): OrderSnapshot | null {
    return orderUuid ? snapshots.value[orderUuid] ?? null : null;
  }

  async function refresh(card: CardInfo): Promise<void> {
    const orderUuid = card.cardData.order_uuid;
    const physical = card.cardData.own_type === 'physical';
    const [status, issued, payment] = await Promise.allSettled([
      cardStore.getOrderDetails(orderUuid),
      cardStore.fetchCardUuidForOrder(orderUuid),
      physical ? cardStore.getDeliveryPayment(orderUuid) : Promise.resolve(null),
    ]);

    const previous = snapshots.value[orderUuid];
    const next: OrderSnapshot = {
      status: status.status === 'fulfilled' ? status.value?.status ?? null : previous?.status ?? null,
      payment: previous?.payment ?? 'unknown',
      expiresAt: previous?.expiresAt ?? null,
    };
    if (payment.status === 'fulfilled' && payment.value) {
      next.payment = deliveryPaymentState(payment.value.status);
      next.expiresAt = payment.value.expires_at ?? null;
      if (next.payment === 'awaiting' && next.expiresAt && Date.parse(next.expiresAt) <= Date.now()) {
        next.payment = 'expired';
      }
    }
    snapshots.value = { ...snapshots.value, [orderUuid]: next };

    const cardUuid =
      (issued.status === 'fulfilled' ? issued.value : null) ||
      (status.status === 'fulfilled' ? cardUuidFromOrderStatus(status.value) : null);
    if (cardUuid) await cardStore.fetchCardData();
  }

  async function refreshAll(): Promise<void> {
    if (inFlight || !pendingOrders.value.length) return;
    inFlight = true;
    checking.value = true;
    try {
      await Promise.all(pendingOrders.value.map(card => refresh(card).catch(() => undefined)));
    } finally {
      inFlight = false;
      checking.value = false;
    }
  }

  function stop(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function start(): void {
    if (timer || !pendingOrders.value.length) return;
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') refreshAll();
    }, POLL_MS);
  }

  watch(
    () => pendingOrders.value.map(card => card.cardData.order_uuid).join(','),
    ids => {
      if (ids) {
        refreshAll();
        start();
      } else {
        stop();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);

  return { snapshots, snapshotOf, checking, refreshAll };
}
