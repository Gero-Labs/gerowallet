import type { Key, Keys } from '@/models/types';

/**
 * The addresses the wallet itself says are its own, for checks that decide what
 * may leave it: the payment and change addresses WalletBg derives from the
 * account xpub (resolvePathsForMissingAddresses; gero-sync only marks which are
 * used) and the record's base address.
 *
 * Never the addresses of the UTxO list. That list comes from gero-sync, the same
 * backend that, together with a transaction builder, could slip an address of its
 * own into it and have an output there counted as change.
 */
export function derivedOwnAddresses(keys: Partial<Keys> | null | undefined, baseAddress?: string | null): string[] {
  const derived = [...(keys?.payment ?? []), ...(keys?.change ?? [])]
    .map((k: Key) => k.address)
    .filter((a): a is string => typeof a === 'string' && a.length > 0);
  return [...new Set([...(baseAddress ? [baseAddress] : []), ...derived])];
}
