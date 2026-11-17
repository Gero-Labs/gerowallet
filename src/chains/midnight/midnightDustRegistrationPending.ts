/**
 * A native (Midnight-side) DUST registration the server took but the chain
 * doesn't show yet. Until it does, the registration dialog says "Registration
 * submitted. Waiting for confirmation." and offers no second Register; after
 * {@link PENDING_EXPIRY_MS} without it, the record reads "Not confirmed" and
 * Dismiss brings Register back.
 *
 * Kept in the extension pages' localStorage (the background never reads it),
 * keyed by the wallet's unshielded address, which also names the network.
 * Holds a transaction hash and a time; nothing secret.
 */
import { ref } from 'vue';
import { PENDING_EXPIRY_MS } from './midnightPendingSends';

const KEY = 'gero.midnightDustRegistrationPending';
/** A record this old is gone for good, seen or not. */
const MAX_AGE_MS = 24 * 60 * 60_000;

export interface MidnightDustRegistrationPending {
  txHash: string;
  /** Epoch ms. */
  submittedAt: number;
}

/** Bumped on every write, so views re-read. */
export const dustRegistrationPendingRevision = ref(0);

function readAll(): Record<string, MidnightDustRegistrationPending> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const parsed = JSON.parse(localStorage.getItem(KEY) || '{}') as unknown;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, MidnightDustRegistrationPending> : {};
  } catch {
    return {};
  }
}

/**
 * Drop records past their day, and records of wallets no longer in the list
 * (`knownAddresses`: every wallet's address; an empty list prunes by age only,
 * so a list that hasn't loaded yet never wipes anything).
 */
export function pruneDustRegistrationPending(knownAddresses: readonly string[] = [], now: number = Date.now()): void {
  const all = readAll();
  const known = new Set(knownAddresses.filter(Boolean));
  let changed = false;
  for (const [address, record] of Object.entries(all)) {
    const expired = typeof record?.submittedAt !== 'number' || now - record.submittedAt >= MAX_AGE_MS;
    if (expired || (known.size > 0 && !known.has(address))) {
      delete all[address];
      changed = true;
    }
  }
  if (changed) writeAll(all);
}

function writeAll(all: Record<string, MidnightDustRegistrationPending>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* private window or blocked storage: the pending state lasts this view only */ }
  dustRegistrationPendingRevision.value += 1;
}

/** The server took a registration for `address`. */
export function markDustRegistrationPending(address: string, txHash: string, now: number = Date.now()): void {
  if (!address) return;
  const all = readAll();
  all[address] = { txHash, submittedAt: now };
  writeAll(all);
}

/** The registration for `address` is on chain, dismissed, or gone. */
export function clearDustRegistrationPending(address: string): void {
  if (!address) return;
  const all = readAll();
  if (!(address in all)) return;
  delete all[address];
  writeAll(all);
}

/** Where a registration the server took stands: pending, not confirmed after the time limit, or none. */
export function dustRegistrationPendingState(address: string, now: number = Date.now()): 'pending' | 'unconfirmed' | null {
  if (!address) return null;
  const record = readAll()[address];
  if (!record || typeof record.submittedAt !== 'number') return null;
  const age = now - record.submittedAt;
  if (age >= MAX_AGE_MS) return null;
  return age >= PENDING_EXPIRY_MS ? 'unconfirmed' : 'pending';
}
