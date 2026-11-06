import { reactive } from 'vue';

/**
 * The listings a purchase of went out for, or may have (a confirmed submit, or one the network did
 * not confirm that may be on chain). They are offered no Buy while the purchase can still be on
 * its way, so a second attempt cannot be started from the list.
 *
 * Module state, not the collection page's: the page is unmounted whenever the collection dialog
 * switches to "In your wallet" (and when it closes), and a lock held by the component would give
 * the Buy back on a listing the index still lists. An entry is keyed by wallet and listing, so
 * another wallet is not held back by it, and it lasts PENDING_BUY_TTL_MS, long enough for the
 * sync and Nexus's index to catch up. It is let go earlier when the listing is gone from a read of
 * the whole collection (`prunePendingBuys`): the purchase landed, or the listing was taken down.
 */

/** How long a purchase that went out holds its listing back: ten minutes. */
export const PENDING_BUY_TTL_MS = 10 * 60_000;

interface Pending {
  policyId: string;
  expiresAt: number;
}

/** `walletId|txHash#index` -> the collection it belongs to and when the lock lets go. */
const pending = reactive(new Map<string, Pending>());

const keyOf = (walletId: number, ref: string): string => `${walletId}|${ref}`;

/** A purchase of this listing (`txHash#index`) of this collection went out, or may have. */
export function markPendingBuy(walletId: number | undefined, policyId: string, ref: string): void {
  if (walletId === undefined) return;
  pending.set(keyOf(walletId, ref), { policyId, expiresAt: Date.now() + PENDING_BUY_TTL_MS });
}

/** Whether a purchase of this listing, by this wallet, may still be on its way. */
export function isPendingBuy(walletId: number | undefined, ref: string): boolean {
  if (walletId === undefined) return false;
  const entry = pending.get(keyOf(walletId, ref));
  return entry !== undefined && Date.now() < entry.expiresAt;
}

/**
 * Forget this wallet's locks in this collection for listings that are not in `listed`: call it
 * with the refs of a read of the WHOLE collection (no next page), so a listing that is not there
 * is gone, not merely on a page not loaded yet.
 */
export function prunePendingBuys(walletId: number | undefined, policyId: string, listed: ReadonlySet<string>): void {
  if (walletId === undefined) return;
  const prefix = `${walletId}|`;
  for (const [key, entry] of pending) {
    if (key.startsWith(prefix) && entry.policyId === policyId && !listed.has(key.slice(prefix.length))) pending.delete(key);
  }
}

/** Test seam: forget every lock. */
export function resetPendingBuys(): void {
  pending.clear();
}
