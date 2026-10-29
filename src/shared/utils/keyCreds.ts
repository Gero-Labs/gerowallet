/**
 * The lowercase key hashes (`cred`) of the given key lists, as the signers and the approval
 * card compare a transaction's key hashes against the wallet's. A missing list, or a key
 * with no cred, adds nothing.
 */
export const credSet = (...lists: Array<ReadonlyArray<{ cred?: string }> | null | undefined>): Set<string> =>
  new Set(lists.flatMap((list) => (Array.isArray(list) ? list : []))
    .map((key) => String(key?.cred ?? '').toLowerCase())
    .filter(Boolean));
