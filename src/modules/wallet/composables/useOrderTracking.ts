import { computed, onBeforeUnmount, ref, watch, type ComputedRef } from 'vue';
import type { CardInfo } from '@/models/card';
import cardStore from '@/stores/modules/card';
import { cardUuidFromOrderStatus } from '@/modules/wallet/utils/cardApiCompat';
import { deliveryPaymentState, orderPollDelay, type DeliveryPaymentState } from '@/modules/wallet/utils/cardOrderTracker';

export interface OrderSnapshot {
  /** Order status: new, dispatched, activating, done, rejected, unknown. */
  status: string | null;
  /** Delivery-fee state (physical orders only). */
  payment: DeliveryPaymentState;
  /** When the current delivery-fee deposit address stops accepting payments. */
  expiresAt: string | null;
}

/**
 * Watches every order that has no card yet: its status, its delivery fee and the card
 * issued for it. As soon as a card UUID exists the card list is reloaded, which moves the
 * order out of this set. The provider suggests polling every 10 s, which fits a fresh order;
 * older orders back off (see `orderPollDelay`), because a physical card can take days and
 * every check is three requests. Polling pauses while the page is hidden.
 */
export function useOrderTracking(cards: ComputedRef<CardInfo[]>) {
  const snapshots = ref<Record<string, OrderSnapshot>>({});
  const checking = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  /** When this page first saw each order: the age to fall back on without a usable created_at. */
  const firstSeen = new Map<string, number>();

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
      clearTimeout(timer);
      timer = null;
    }
  }

  /** The shortest wait any pending order needs. The older age wins, so a wrong created_at cannot keep polling fast. */
  function nextDelay(now: number): number {
    const delays = pendingOrders.value.map(card => {
      const orderUuid = card.cardData.order_uuid;
      if (!firstSeen.has(orderUuid)) firstSeen.set(orderUuid, now);
      const created = Date.parse(card.cardData.created_at || '');
      const seenFor = now - (firstSeen.get(orderUuid) ?? now);
      return orderPollDelay(Number.isFinite(created) ? Math.max(seenFor, now - created) : seenFor);
    });
    return Math.min(...delays);
  }

  /** (Re)starts the timer for the next check; each check schedules the one after it. */
  function schedule(): void {
    stop();
    if (!pendingOrders.value.length) return;
    timer = setTimeout(async () => {
      timer = null;
      if (document.visibilityState === 'visible') await refreshAll();
      schedule();
    }, nextDelay(Date.now()));
  }

  watch(
    () => pendingOrders.value.map(card => card.cardData.order_uuid).join(','),
    ids => {
      if (ids) {
        refreshAll();
        // Restart rather than keep a long wait: a newly placed order needs the fast pace.
        schedule();
      } else {
        stop();
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(stop);

  return { snapshots, snapshotOf, checking, refreshAll };
}
