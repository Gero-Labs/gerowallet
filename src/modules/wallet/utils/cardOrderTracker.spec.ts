import { describe, expect, it } from 'vitest';
import { deliveryPaymentState, orderTracker } from './cardOrderTracker';

const states = (view: ReturnType<typeof orderTracker>) => view.stages.map(s => `${s.id}:${s.state}`).join(' ');

describe('deliveryPaymentState', () => {
  it.each([
    ['pending', 'awaiting'],
    ['detected', 'detected'],
    ['confirming', 'detected'],
    ['confirmed', 'paid'],
    ['completed', 'paid'],
    ['expired', 'expired'],
    ['rejected', 'rejected'],
    ['failed', 'rejected'],
    ['PENDING', 'awaiting'],
    [undefined, 'unknown'],
    ['something-new', 'unknown'],
  ])('%s → %s', (status, state) => {
    expect(deliveryPaymentState(status)).toBe(state);
  });
});

describe('orderTracker, physical card', () => {
  it('waits on the delivery fee first', () => {
    const view = orderTracker({ physical: true, orderStatus: 'new', payment: 'awaiting' });
    expect(states(view)).toBe('placed:done paid:current dispatched:todo activated:todo ready:todo');
    expect(view.needsPayment).toBe(true);
    expect(view.paymentDetected).toBe(false);
  });

  it('says the payment was seen instead of asking to pay again', () => {
    const view = orderTracker({ physical: true, orderStatus: 'new', payment: 'detected' });
    expect(view.needsPayment).toBe(false);
    expect(view.paymentDetected).toBe(true);
  });

  it('moves to dispatch once the fee is confirmed', () => {
    const view = orderTracker({ physical: true, orderStatus: 'new', payment: 'paid' });
    expect(states(view)).toBe('placed:done paid:done dispatched:current activated:todo ready:todo');
  });

  it('offers activation only once the card is dispatched', () => {
    expect(orderTracker({ physical: true, orderStatus: 'new', payment: 'paid' }).canActivate).toBe(false);
    const view = orderTracker({ physical: true, orderStatus: 'dispatched', payment: 'paid' });
    expect(view.canActivate).toBe(true);
    expect(orderTracker({ physical: true, orderStatus: 'activating' }).canActivate).toBe(false);
  });

  it('completes on done', () => {
    const view = orderTracker({ physical: true, orderStatus: 'done', payment: 'paid' });
    expect(view.stages.every(s => s.state === 'done')).toBe(true);
  });

  it('ends on rejection or an unpaid, expired fee', () => {
    expect(orderTracker({ physical: true, orderStatus: 'rejected' }).ended).toBe('rejected');
    const expired = orderTracker({ physical: true, orderStatus: 'new', payment: 'expired' });
    expect(expired.ended).toBe('expired');
    expect(expired.needsPayment).toBe(false);
  });
});

describe('orderTracker, virtual card', () => {
  it('has no fee and no activation', () => {
    const view = orderTracker({ physical: false, orderStatus: 'new' });
    expect(states(view)).toBe('placed:done ready:current');
    expect(view.needsPayment).toBe(false);
    expect(view.canActivate).toBe(false);
  });
});
