/**
 * Order progress for the card dashboard, from the provider's two status sources:
 * GET /cards/order/{uuid}/status (`status`: new, dispatched, activating, done, rejected,
 * unknown) and, for physical cards, GET /cards/delivery-payment/{uuid} (`status`).
 */

import type { CardData } from '@/models/card';

/**
 * How long to wait before checking again on an order that has no card yet, by the order's age:
 * every 10 s for the first five minutes (a virtual card usually appears within them), every
 * minute until it is an hour old, then every five minutes, since a physical card can take days.
 */
export function orderPollDelay(ageMs: number): number {
  if (!Number.isFinite(ageMs) || ageMs < 5 * 60_000) return 10_000;
  if (ageMs < 60 * 60_000) return 60_000;
  return 5 * 60_000;
}

export type DeliveryPaymentState = 'awaiting' | 'detected' | 'paid' | 'expired' | 'rejected' | 'unknown';

/** Normalises the delivery-fee payment status (also covers the 404/410 mappings in the card store). */
export function deliveryPaymentState(status: string | null | undefined): DeliveryPaymentState {
  switch ((status || '').toLowerCase()) {
    case 'pending':
      return 'awaiting';
    case 'detected':
    case 'confirming':
      return 'detected';
    case 'confirmed':
    case 'completed':
      return 'paid';
    case 'expired':
      return 'expired';
    case 'rejected':
    case 'failed':
      return 'rejected';
    default:
      return 'unknown';
  }
}

/**
 * The order itself is past its delivery fee: the card is dispatched, activating or done.
 * From then on the fee decides nothing. Its endpoint can answer 404 (which the card store
 * reads as rejected) or show a stale deposit address as expired, and letting either end the
 * order hid a card already in the customer's hands, and its activation, behind "Order new card".
 */
export function orderPastPayment(orderStatus: string | null | undefined): boolean {
  return ['dispatched', 'activating', 'done'].includes((orderStatus || '').toLowerCase());
}

/**
 * Whether the card page keeps a physical card or order in its carousel: an issued card always,
 * an order unless the provider rejected it or its delivery fee ended it (never past the fee).
 */
export function keepsPhysicalSlot(
  data: Pick<CardData, 'status' | 'card_uuid' | 'order_uuid' | 'delivery'>,
  snapshot?: { status: string | null; payment: DeliveryPaymentState } | null,
): boolean {
  if (data.status?.toLowerCase() === 'rejected') return false;
  if (data.card_uuid) return true;
  if (!data.order_uuid) return false;
  if (orderPastPayment(snapshot?.status ?? data.status)) return true;
  if (data.delivery?.payment_status === 'expired') return false;
  return snapshot?.payment !== 'rejected';
}

export type OrderStageId ='placed' | 'paid' | 'dispatched' | 'activated' | 'ready';
export type OrderStageState = 'done' | 'current' | 'todo';

export interface OrderTrackerView {
  stages: { id: OrderStageId; state: OrderStageState }[];
  /** The order can no longer complete; the user has to place a new one. */
  ended: 'rejected' | 'expired' | null;
  /** The delivery fee is still unpaid and can be paid now. */
  needsPayment: boolean;
  /** The fee reached the deposit address and is waiting for confirmations. */
  paymentDetected: boolean;
  /** The card is on its way, so it can be activated with the number printed on it. */
  canActivate: boolean;
}

const PHYSICAL: OrderStageId[] = ['placed', 'paid', 'dispatched', 'activated', 'ready'];
const VIRTUAL: OrderStageId[] = ['placed', 'ready'];

function withCurrent(ids: OrderStageId[], current: number): OrderTrackerView['stages'] {
  return ids.map((id, i) => ({ id, state: i < current ? 'done' : i === current ? 'current' : 'todo' }));
}

export function orderTracker(input: {
  physical: boolean;
  orderStatus?: string | null;
  payment?: DeliveryPaymentState;
}): OrderTrackerView {
  const status = (input.orderStatus || '').toLowerCase();
  const payment = input.payment ?? 'unknown';
  const view: OrderTrackerView = {
    stages: [],
    ended: null,
    needsPayment: false,
    paymentDetected: false,
    canActivate: false,
  };

  if (!input.physical) {
    view.stages = withCurrent(VIRTUAL, status === 'done' ? VIRTUAL.length : 1);
    view.ended = status === 'rejected' ? 'rejected' : null;
    return view;
  }

  let current: number;
  switch (status) {
    case 'done':
      current = PHYSICAL.length;
      break;
    case 'activating':
      current = 3;
      break;
    case 'dispatched':
      current = 2;
      view.canActivate = true;
      break;
    default:
      // new / unknown: the order waits on its delivery fee, then on dispatch.
      current = payment === 'paid' ? 2 : 1;
      view.needsPayment = payment === 'awaiting';
      view.paymentDetected = payment === 'detected';
  }
  view.stages = withCurrent(PHYSICAL, current);

  if (status === 'rejected' || (payment === 'rejected' && !orderPastPayment(status))) view.ended = 'rejected';
  else if (payment === 'expired' && current <= 1) view.ended = 'expired';
  if (view.ended) {
    view.needsPayment = false;
    view.paymentDetected = false;
    view.canActivate = false;
  }
  return view;
}
