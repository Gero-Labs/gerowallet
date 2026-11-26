/**
 * The script hashes of every vault (GeroVault, CIP-1854 native-script multisig) the wallet knows:
 * accepted vaults and quarantined candidates alike, of every wallet in this extension. The generic
 * signers refuse a transaction that touches one (vaultSignGuard.ts), because a vault transaction is
 * approved on the vault screen and nowhere else.
 *
 * Read from the per-wallet `vaults` tables that src/db/vaultStore.ts writes: the wallet ids come
 * from the wallet list in `GeroWalletDatabase`, then each wallet's own database is read. This file
 * stays light (no vault library, and the wallet list is read without its upgrade chain) because
 * every signer imports it, the background worker's among them.
 *
 * A store that cannot be read makes this throw, never answer empty sets. The signers let the throw
 * through, so a failed read refuses the signature instead of letting a vault transaction past. It
 * answers empty only where no vault can be stored: a context without IndexedDB, or an extension
 * with no wallet list yet.
 */
import Dexie from 'dexie';
import { geroWalletDbName } from '@/db/schema';
import { getDb as getWalletDb } from '@/db/wallet-db';

export interface KnownVaultScriptHashes {
  /** The payment script hash of each known vault, lowercase hex. */
  readonly payment: ReadonlySet<string>;
  /** The stake script hash of each known vault, lowercase hex. */
  readonly stake: ReadonlySet<string>;
  /**
   * Whether a stored vault holds a wallet's own CIP-1854 keys at index 0 (`m/1854'/1815'/0'/0/0`
   * and `.../2/0`). The payment key there is the one multisig key the generic signers may otherwise
   * use, so with such a vault they refuse it as well (vaultSignGuard.ts). Absent means false.
   */
  readonly ownIndexZero?: boolean;
}

const SCRIPT_HASH = /^[0-9a-f]{56}$/;

const NONE: KnownVaultScriptHashes = Object.freeze({ payment: new Set<string>(), stake: new Set<string>(), ownIndexZero: false });

interface StoredVaultHashes {
  readonly paymentScriptHash?: unknown;
  readonly stakeScriptHash?: unknown;
  readonly ownIndex?: unknown;
}

/** The ids in the wallet list, or null when there is none yet. Opened without a schema, then closed. */
async function walletIds(): Promise<number[] | null> {
  if (!(await Dexie.exists(geroWalletDbName))) return null;
  const db = new Dexie(geroWalletDbName);
  try {
    await db.open();
    if (!db.tables.some(table => table.name === 'wallets')) return [];
    const ids = await db.table('wallets').toCollection().primaryKeys();
    return ids.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id >= 0);
  } finally {
    db.close();
  }
}

export async function knownVaultScriptHashes(): Promise<KnownVaultScriptHashes> {
  if (typeof globalThis.indexedDB === 'undefined') return NONE;
  const ids = await walletIds();
  if (ids === null) return NONE;
  const payment = new Set<string>();
  const stake = new Set<string>();
  let ownIndexZero = false;
  for (const id of ids) {
    const db = await getWalletDb(id);
    if (!db) throw new Error('A wallet database could not be opened to read its vaults');
    for (const row of await db.table<StoredVaultHashes>('vaults').toArray()) {
      const { paymentScriptHash, stakeScriptHash, ownIndex } = row ?? {};
      if (typeof paymentScriptHash !== 'string' || !SCRIPT_HASH.test(paymentScriptHash)
        || typeof stakeScriptHash !== 'string' || !SCRIPT_HASH.test(stakeScriptHash)) {
        throw new Error('A stored vault has no readable script hashes');
      }
      payment.add(paymentScriptHash);
      stake.add(stakeScriptHash);
      if (ownIndex === 0) ownIndexZero = true;
    }
  }
  return { payment, stake, ownIndexZero };
}
