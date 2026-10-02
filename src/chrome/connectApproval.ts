/**
 * A dApp connect prompt counts as approved only on an explicit `data === true`.
 * Truthy look-alikes (`{}`, `[]`, a string) are a decline or a malformed answer:
 * the popup's Decline button used to send `{ data: {} }`, which the Bitcoin
 * enable handler read as "approved" and connected the site.
 */
export function isConnectApproval(response: { data?: unknown } | null | undefined): boolean {
  return response?.data === true;
}
