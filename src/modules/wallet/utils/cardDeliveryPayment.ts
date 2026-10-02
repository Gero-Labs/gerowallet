export type DeliveryPaymentVerdict = 'ok' | 'unavailable' | 'expired' | 'changed';

export interface FreshDeliveryPayment {
  deposit_address?: string;
  amount_ada?: number | string;
  expires_at?: string;
  status?: string;
}

/**
 * Whether a physical-card delivery fee may be paid now, given the payment re-read
 * just before sending and the address/amount the user confirmed. The provider
 * rotates the deposit address after 60 minutes, so a stale one must never be paid.
 */
export function checkDeliveryPayment(
  fresh: FreshDeliveryPayment | null,
  shown: { depositAddress: string; depositAmountAda: string | number },
  now: number,
): DeliveryPaymentVerdict {
  if (!fresh || fresh.status !== 'pending' || !fresh.deposit_address) return 'unavailable';
  const expiresAt = fresh.expires_at ? Date.parse(fresh.expires_at) : NaN;
  if (!Number.isNaN(expiresAt) && expiresAt <= now) return 'expired';
  const freshAda = parseFloat(String(fresh.amount_ada));
  const shownAda = parseFloat(String(shown.depositAmountAda));
  if (fresh.deposit_address !== shown.depositAddress || freshAda !== shownAda) return 'changed';
  return 'ok';
}
