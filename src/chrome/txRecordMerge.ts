/**
 * The record to store when a transaction already in the wallet DB arrives again.
 *
 * Gero stores a transaction it submits in full (CBOR and the decoded body), as a pending
 * record. When it confirms, Gero Sync may push the record "thin": the backend's CBOR writer
 * lags the tip, so the push carries the block, the UTxOs and the timestamp but no CBOR or
 * body. Replacing the stored record with that one dropped a body Gero already had, until
 * the background heal fetched it again; meanwhile a vote delegation (all own addresses and
 * a fee) read as a "Self Transfer" (QA, issue 1518). A transaction id fixes its body, so the
 * stored body is the confirmed transaction's body too: keep it and take every value the
 * incoming record does carry.
 */
export function mergeTxRecord<T extends Record<string, unknown>>(existing: T | undefined, incoming: T): T {
  if (!existing || incoming['cbor'] || !existing['cbor']) return incoming;
  const merged: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined && value !== null) merged[key] = value;
  }
  return merged as T;
}
