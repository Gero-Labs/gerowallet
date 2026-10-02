import { describe, expect, it } from 'vitest';
import { checkDeliveryPayment } from './cardDeliveryPayment';

const now = Date.parse('2026-10-02T12:00:00Z');
const shown = { depositAddress: 'addr1shown', depositAmountAda: '28.5' };
const fresh = { deposit_address: 'addr1shown', amount_ada: 28.5, expires_at: '2026-10-02T12:30:00Z', status: 'pending' };

describe('checkDeliveryPayment', () => {
  it('allows paying exactly what the user confirmed while it is still pending', () => {
    expect(checkDeliveryPayment(fresh, shown, now)).toBe('ok');
    expect(checkDeliveryPayment({ ...fresh, expires_at: undefined }, shown, now)).toBe('ok');
  });

  it('refuses when the payment is gone or already in flight', () => {
    expect(checkDeliveryPayment(null, shown, now)).toBe('unavailable');
    expect(checkDeliveryPayment({ ...fresh, status: 'detected' }, shown, now)).toBe('unavailable');
    expect(checkDeliveryPayment({ ...fresh, status: 'rejected' }, shown, now)).toBe('unavailable');
    expect(checkDeliveryPayment({ ...fresh, deposit_address: '' }, shown, now)).toBe('unavailable');
  });

  it('refuses after the 60-minute window', () => {
    expect(checkDeliveryPayment({ ...fresh, expires_at: '2026-10-02T11:59:59Z' }, shown, now)).toBe('expired');
  });

  it('flags a rotated address or a changed amount', () => {
    expect(checkDeliveryPayment({ ...fresh, deposit_address: 'addr1new' }, shown, now)).toBe('changed');
    expect(checkDeliveryPayment({ ...fresh, amount_ada: 30.1 }, shown, now)).toBe('changed');
  });
});
