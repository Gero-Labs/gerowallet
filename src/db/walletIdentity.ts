import { Blockchain } from '@/models/types';

/**
 * Wallet identity comparison — the rule that decides whether a restore would
 * produce a duplicate.
 *
 * A wallet is uniquely identified by the triple (chain, network, derived public
 * key). Names are deliberately NOT part of the identity: users rename wallets
 * freely, and the same seed legitimately produces separate wallets on different
 * chains (Cardano / Bitcoin / Midnight) and on different networks of the same
 * chain (Mainnet / Preprod / …).
 *
 * This module is pure — no Dexie, no key derivation, no chain SDKs — so the
 * comparison rule can be unit tested on its own.
 */

/**
 * Minimal shape needed for an identity comparison. Structural rather than the
 * full `Wallet` type so a not-yet-persisted candidate can be compared against
 * stored records.
 */
export interface WalletIdentitySource {
  chain: string;
  network: string;
  publicKey?: string;
}

export interface WalletIdentity {
  chain: string;
  network: string;
  /**
   * Chain-normalised identity key, or null when the record carries no
   * comparable identity (missing/empty public key, unparsable Midnight blob).
   * A null key never matches anything — an unknown identity is not a duplicate.
   */
  key: string | null;
}

/** Chain and network are display-cased constants; compare them case-insensitively. */
function normalizeLabel(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/**
 * Midnight stores `publicKey` as a JSON blob of role-specific bech32m addresses
 * (see `createNewWallet` in gero-db.ts). Property order in that blob is not
 * guaranteed and callers may attach extra derived material, so compare on the
 * unshielded receive address instead of the serialized string.
 */
function midnightIdentityKey(publicKey: string): string | null {
  try {
    const parsed: unknown = JSON.parse(publicKey);
    const unshielded = (parsed as { unshielded?: unknown })?.unshielded;
    if (typeof unshielded !== 'string') {
      return null;
    }
    return normalizeLabel(unshielded) || null;
  } catch {
    return null;
  }
}

/**
 * Reduce a wallet record (or restore candidate) to its comparable identity.
 */
export function toWalletIdentity(source: WalletIdentitySource): WalletIdentity {
  const chain = normalizeLabel(source?.chain);
  const network = normalizeLabel(source?.network);
  const publicKey = (source?.publicKey ?? '').trim();

  if (!publicKey) {
    return { chain, network, key: null };
  }

  if (chain === normalizeLabel(Blockchain.MIDNIGHT)) {
    return { chain, network, key: midnightIdentityKey(publicKey) };
  }

  if (chain === normalizeLabel(Blockchain.BITCOIN)) {
    // Bitcoin account xpubs are base58 — case is significant, don't fold it.
    return { chain, network, key: publicKey };
  }

  // Cardano / Apex Fusion account xpubs are bech32, which is case-insensitive.
  return { chain, network, key: publicKey.toLowerCase() };
}

/**
 * True when both identities describe the same wallet: same chain, same network,
 * same derived key.
 */
export function isSameWalletIdentity(a: WalletIdentity, b: WalletIdentity): boolean {
  if (!a?.key || !b?.key) {
    return false;
  }
  return a.chain === b.chain && a.network === b.network && a.key === b.key;
}

/**
 * Find an already-stored wallet that has the same identity as `candidate`.
 *
 * @param candidate - The wallet about to be created/restored.
 * @param wallets - Existing wallets, as an array or as the id-keyed map that
 *                  `getAllWallets()` returns.
 * @returns The first matching wallet, or null when the restore is not a duplicate.
 */
export function findDuplicateWallet<T extends WalletIdentitySource>(
  candidate: WalletIdentitySource,
  wallets: T[] | Record<string | number, T> | null | undefined,
): T | null {
  const target = toWalletIdentity(candidate);
  if (!target.key) {
    return null;
  }

  const list: T[] = Array.isArray(wallets)
    ? wallets
    : Object.values((wallets ?? {}) as Record<string | number, T>);

  return list.find((wallet) => !!wallet && isSameWalletIdentity(target, toWalletIdentity(wallet))) ?? null;
}
