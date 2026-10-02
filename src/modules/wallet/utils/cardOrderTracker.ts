/**
 * Order progress for the card dashboard, from the provider's two status sources:
 * GET /cards/order/{uuid}/status (`status`: new, dispatched, activating, done, rejected,
 * unknown) and, for physical cards, GET /cards/delivery-payment/{uuid} (`status`).
 */

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

export type OrderStageId = 'placed' | 'paid' | 'dispatched' | 'activated' | 'ready';
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

  if (status === 'rejected' || payment === 'rejected') view.ended = 'rejected';
  else if (payment === 'expired' && current <= 1) view.ended = 'expired';
  if (view.ended) {
    view.needsPayment = false;
    view.paymentDetected = false;
    view.canActivate = false;
  }
  return view;
}
