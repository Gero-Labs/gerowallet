/**
 * Tolerant readers for card API fields whose names differ between the provider's
 * OpenAPI spec and what this code was written against. Both hosts serve the same
 * spec, so read either name until a live response settles it.
 */

/** Deposit address from GET /api/kaiserex/cardano-address (spec: `address`; code: `wallet_address`). */
export function depositAddressFromResponse(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { wallet_address: walletAddress, address } = body as { wallet_address?: unknown; address?: unknown };
  const value = typeof walletAddress === 'string' && walletAddress ? walletAddress : address;
  return typeof value === 'string' && value ? value : null;
}

/** Issued card UUID from GET /api/kaiserex/cards/order/{uuid}/status (spec: `cardUuid`; code: `card_uuid`). */
export function cardUuidFromOrderStatus(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { cardUuid, card_uuid: snakeCase } = body as { cardUuid?: unknown; card_uuid?: unknown };
  const value = typeof cardUuid === 'string' && cardUuid ? cardUuid : snakeCase;
  return typeof value === 'string' && value ? value : null;
}
