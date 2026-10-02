/**
 * PRIV-01: remove the Midnight zswap viewing key from persisted wallet data.
 *
 * Older releases wrote `zswapViewingKey` (`mn_shield-esk_…`, encryption SECRET
 * key material that decrypts every incoming shielded note of the wallet) into
 * the wallet record's `publicKey` JSON, in plaintext, and from there into the
 * geroStore / walletStore copies in chrome.storage.local. Nothing reads it any
 * more: the on-device private sync derives its keys from the seed at unlock.
 * New records never carry it; this scrubs the old ones once per worker start.
 */
import { Blockchain } from '@/models/types';

const VIEWING_KEY_FIELD = 'zswapViewingKey';

/**
 * The `publicKey` JSON without the viewing key. Returns the input unchanged
 * when it is not a JSON object or carries no key, so callers can compare by
 * identity to see whether anything was removed.
 */
export function stripViewingKeyFromPublicKey(publicKey: string): string {
  if (typeof publicKey !== 'string' || !publicKey.includes(VIEWING_KEY_FIELD)) return publicKey;
  let parsed: unknown;
  try {
    parsed = JSON.parse(publicKey);
  } catch {
    return publicKey;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !(VIEWING_KEY_FIELD in parsed)) {
    return publicKey;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [VIEWING_KEY_FIELD]: _removed, ...rest } = parsed as Record<string, unknown>;
  return JSON.stringify(rest);
}

/** The addresses object to persist, never carrying the viewing key. */
export function withoutViewingKey<T extends object>(addresses: T): Omit<T, 'zswapViewingKey'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { zswapViewingKey: _removed, ...rest } = addresses as T & { zswapViewingKey?: unknown };
  return rest;
}

interface WalletsTable {
  toArray(): Promise<Array<{ id: number; chain?: string; publicKey?: string }>>;
  update(id: number, changes: { publicKey: string }): Promise<number>;
}

/**
 * Strip the viewing key from every stored Midnight wallet record. Returns how
 * many records were rewritten. Safe to run repeatedly.
 */
export async function scrubStoredMidnightViewingKeys(wallets: WalletsTable): Promise<number> {
  let rewritten = 0;
  for (const wallet of await wallets.toArray()) {
    if (wallet.chain !== Blockchain.MIDNIGHT || typeof wallet.publicKey !== 'string') continue;
    const scrubbed = stripViewingKeyFromPublicKey(wallet.publicKey);
    if (scrubbed !== wallet.publicKey) {
      await wallets.update(wallet.id, { publicKey: scrubbed });
      rewritten += 1;
    }
  }
  return rewritten;
}
