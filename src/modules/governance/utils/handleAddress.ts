/**
 * Reading an ADA Handle lookup into a payment address, or into nothing.
 *
 * Extracted from the registration form because this is the decision that says
 * what goes into published, permanently-referenced metadata. CIP-119's
 * `paymentAddress` is an ADDRESS field, and a handle is a transferable pointer:
 * publishing `$name` would route a delegator's support to whoever holds that
 * handle at the time, who need not be the DRep who wrote the document. So the
 * handle is resolved and the ADDRESS is what gets published.
 *
 * The rule that matters: nothing is accepted unless it is a real payment
 * address. A resolver that answers 200 with a null, an empty string, an object,
 * or a stake address must produce a MISS, not a published value — a wrong
 * address here is money sent to a stranger, and it cannot be edited after the
 * fact without publishing and hashing a new document.
 */

import { isPaymentAddress } from '@/chrome/serialization';

export type HandleResolution =
  | { status: 'resolved'; address: string }
  | { status: 'notFound' };

const MISS: HandleResolution = { status: 'notFound' };

/** Strip the leading `$` the field shows; the API keys on the bare name. */
export function handleName(input: string): string {
  return input.trim().replace(/^\$/, '');
}

/** True for the one shape this field treats as a handle rather than an address. */
export function looksLikeHandle(input: string): boolean {
  const value = input.trim();
  return value.startsWith('$') && value.length > 1;
}

/**
 * The address an ADA Handle response resolves to, or a miss.
 *
 * Takes the whole axios-shaped response rather than the address, so that a
 * non-200 with a body cannot be read as a hit.
 */
export function readHandleResponse(response: unknown): HandleResolution {
  if (!response || typeof response !== 'object') return MISS;
  const { status, data } = response as { status?: unknown; data?: unknown };
  if (status !== 200) return MISS;
  if (!data || typeof data !== 'object') return MISS;

  const resolved = (data as { resolved_addresses?: unknown }).resolved_addresses;
  if (!resolved || typeof resolved !== 'object') return MISS;

  const address = (resolved as { ada?: unknown }).ada;
  if (typeof address !== 'string') return MISS;

  const trimmed = address.trim();
  return trimmed && isPaymentAddress(trimmed) ? { status: 'resolved', address: trimmed } : MISS;
}
