import type { CardInfo } from '@/models/card';
import type { OrderPhysicalCardPayload } from '@/stores/modules/card';
import { toProviderText } from './cardholderDetails';

export type ShippingMethod = 'regular' | 'express-eu' | 'express-worldwide';

export interface ShippingAddress {
  streetAddress: string;
  city: string;
  stateProvince: string;
  zipCode: string;
  countryCode: string;
  phone: string;
}

/**
 * An address the wallet already knows and can offer for delivery: the home address the user
 * just gave Zione, or the delivery address of their last physical card. Zione has no endpoint
 * that returns the address it holds, so nothing else is known.
 */
export interface KnownAddress {
  source: 'residential' | 'delivery';
  address: ShippingAddress;
}

/** Field limits of the provider's physical-card order endpoint. */
export const ADDRESS_LIMITS = {
  streetAddress: 30,
  city: 100,
  stateProvince: 100,
  zipCode: 10,
} as const;

export function emptyAddress(): ShippingAddress {
  return { streetAddress: '', city: '', stateProvince: '', zipCode: '', countryCode: '', phone: '' };
}

/** The delivery address of the most recently updated physical card, if any. */
export function savedDeliveryAddress(cards: CardInfo[]): ShippingAddress | null {
  const time = (card: CardInfo) => new Date(card.cardData?.updated_at || card.cardData?.created_at || 0).getTime();
  const latest = cards
    .filter(card => card.cardData?.own_type === 'physical' && card.cardData.delivery)
    .sort((a, b) => time(b) - time(a))[0];
  const delivery = latest?.cardData.delivery;
  if (!delivery) return null;
  return {
    streetAddress: delivery.address || '',
    city: delivery.city || '',
    stateProvince: delivery.region || '',
    zipCode: delivery.zip || '',
    countryCode: delivery.country_code || '',
    phone: delivery.phone || '',
  };
}

/** A known address rewritten into the characters Zione accepts (see `toProviderText`). */
export function toProviderAddress(address: ShippingAddress): ShippingAddress {
  return {
    ...address,
    streetAddress: toProviderText(address.streetAddress),
    city: toProviderText(address.city),
    stateProvince: toProviderText(address.stateProvince),
    zipCode: toProviderText(address.zipCode),
  };
}

/** The address on one line, for a choice card: "Vnouckova 2007, 25601 Benesov, Stredocesky kraj, Czechia". */
export function addressLine(address: ShippingAddress, countryName?: string): string {
  const place = [address.zipCode, address.city].filter(Boolean).join(' ');
  return [address.streetAddress, place, address.stateProvince, countryName || address.countryCode].filter(Boolean).join(', ');
}

/**
 * True when Zione refused characters in a card order. The wallet only sends delivery fields that
 * pass Zione's character rules, so the refused text is in the cardholder details Zione already
 * holds, which only Zione support can change.
 */
export function isStoredDetailsRejection(reason: string | undefined): boolean {
  return !!reason && /forbidden symbols/i.test(reason);
}

/**
 * True when Zione refused a card order for a missing field ("The address field is required.",
 * "Missing field"). The wallet always sends the full delivery address, so the gap is in the
 * cardholder details, which the user can fill in.
 */
export function isMissingDetailsRejection(reason: string | undefined): boolean {
  return !!reason && /\b(is required|missing field)\b/i.test(reason);
}

export function toOrderPayload(address: ShippingAddress, method: ShippingMethod): OrderPhysicalCardPayload {
  return {
    address: address.streetAddress.trim(),
    region: address.stateProvince.trim(),
    city: address.city.trim(),
    zipCode: address.zipCode.trim(),
    countryCode: address.countryCode,
    phone: address.phone,
    deliveryMethod: method,
  };
}

/**
 * Lovelace for an ADA amount the provider quotes as a decimal string (often 8 places,
 * "47.99946773"). Rounded UP to whole lovelace so the payment never falls short of the
 * quote. Null for anything that is not a positive amount.
 */
export function lovelaceFromAda(value: string | number | null | undefined): bigint | null {
  const text = String(value ?? '').trim();
  const match = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) return null;
  const [, whole, fraction = ''] = match;
  let lovelace = BigInt(whole) * 1_000_000n + BigInt((fraction.slice(0, 6) || '0').padEnd(6, '0'));
  if (/[1-9]/.test(fraction.slice(6))) lovelace += 1n;
  return lovelace > 0n ? lovelace : null;
}
