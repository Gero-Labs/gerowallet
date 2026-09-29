import { Buffer } from 'buffer';
import { Mutex } from 'async-mutex';
import type Dexie from 'dexie';
import { SecretPurpose, decrypt, decryptPrivateKey } from '@/shared/utils/crypto';
import { isGpw2, openGpw2, openGpw2Text, sealGpw2, sealGpw2Text } from '@/shared/utils/secretEnvelope';
import { refreshEnvelopeV2Flag } from '@/shared/utils/envelopeV2Flag';
import { rootKeyFromMnemonic } from '@/shared/utils/rootKeyFromMnemonic';
import {
  CONFIG_SECRET_FIELDS,
  isConfigValueGpw2,
  openConfigSecret,
  sameConfigPlain,
  sealConfigSecret,
  type ConfigSecretField,
  type ConfigSecretPlain,
} from '@/shared/utils/walletSecretFields';
import { debugLog } from '@/utils/debug';

/**
 * On-unlock upgrade of every secret a password wallet stores under its spending
 * password to the `gpw2` envelope (root key, mnemonic, 2FA data, SPO cold key).
 *
 * Runs only after a successful password decrypt, only with `isKeyEnvelopeV2Enabled`
 * on, and never blocks the caller. The safety rules, in order:
 *  1. Decrypt every field with the verified password. A field that does not open
 *     (e.g. left under an older password) is left alone, never rewritten.
 *  2. Key equivalence: the root key must equal the one the mnemonic derives. On a
 *     mismatch nothing is written.
 *  3. Seal to `gpw2` and open it again in memory; bytes must match.
 *  4. Compare-and-swap inside one IndexedDB `rw` transaction per database: write
 *     only if every field still holds the exact blob we decrypted. Without this, a
 *     spending-password change landing mid-migration would be overwritten with
 *     ciphertext under the OLD password (lockout).
 *  5. Read the rows back from IndexedDB and open them before reporting success.
 *
 * Old ciphertext is replaced in place; no weaker copy is kept. Every reader
 * accepts every format, so a wallet interrupted between the two databases is fully
 * usable and the next trigger finishes the job. `passwordLastUpdate` is untouched.
 *
 * Not covered here: MPC device shares (not unlocked through this path), the Strike
 * key (chrome.storage.local, no transactional compare-and-swap) and PRF wallets.
 */

export type MigrationOutcome =
  | 'migrated'
  | 'already-current'
  | 'disabled'
  | 'not-applicable'
  | 'decrypt_fail'
  | 'equivalence_fail'
  | 'readback_fail'
  | 'cas_conflict'
  | 'write_error';

export interface MigrationResult {
  outcome: MigrationOutcome;
  /** New blobs written to the wallets row, for the caller's in-memory copy. */
  encryptedPrivateKey?: string;
  encryptedMnemonic?: string;
}

export interface WalletSecretRow {
  id: number;
  chain?: string;
  type?: string;
  encryptionMethod?: string;
  encryptedPrivateKey?: string;
  encryptedMnemonic?: string;
}

type WalletBlobs = Partial<Pick<WalletSecretRow, 'encryptedPrivateKey' | 'encryptedMnemonic'>>;

/** A per-wallet `config` row. The table's primary key is `key`. */
export interface ConfigRow {
  key: string;
  value: unknown;
}

/** Storage seam. The default implementation is Dexie; tests inject their own. */
export interface SecretMigrationStore {
  getWallet(walletId: number): Promise<WalletSecretRow | undefined>;
  /** Atomically: if every `expected` field still matches, apply `next`. Returns false on mismatch. */
  casWallet(walletId: number, expected: WalletBlobs, next: WalletBlobs): Promise<boolean>;
  getConfig(walletId: number, keys: readonly string[]): Promise<ConfigRow[]>;
  /** Atomically: if every row still holds its `expected` value, write `next`. Returns false on mismatch. */
  casConfig(walletId: number, updates: Array<{ key: string; expected: unknown; next: unknown }>): Promise<boolean>;
}

const CONFIG_KEYS = [
  ...CONFIG_SECRET_FIELDS.map(f => f.key),
  ...CONFIG_SECRET_FIELDS.flatMap(f => (f.encryptionKey ? [f.encryptionKey] : [])),
];

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createDexieSecretStore(): SecretMigrationStore {
  const walletsDb = async (): Promise<Dexie> => (await import('@/db/gero-db')).getDb();
  const configDb = async (walletId: number): Promise<Dexie> => {
    const db = await (await import('@/db/wallet-db')).getDb(walletId);
    if (!db) throw new Error('Wallet database unavailable');
    return db;
  };
  return {
    async getWallet(walletId) {
      return (await walletsDb()).table('wallets').get(walletId);
    },
    async casWallet(walletId, expected, next) {
      const db = await walletsDb();
      const table = db.table('wallets');
      return db.transaction('rw', table, async () => {
        const row = await table.get(walletId);
        if (!row) return false;
        for (const [field, value] of Object.entries(expected)) {
          if (row[field] !== value) return false;
        }
        await table.update(walletId, next);
        return true;
      });
    },
    async getConfig(walletId, keys) {
      const db = await configDb(walletId);
      return db.table('config').where('key').anyOf(keys as string[]).toArray();
    },
    async casConfig(walletId, updates) {
      const db = await configDb(walletId);
      const table = db.table('config');
      return db.transaction('rw', table, async () => {
        for (const u of updates) {
          const row = await table.get(u.key);
          if (!row || !sameValue(row.value, u.expected)) return false;
        }
        for (const u of updates) await table.update(u.key, { value: u.next });
        return true;
      });
    },
  };
}

// ---------------------------------------------------------------------------

const locks = new Map<number, Mutex>();
function lockFor(walletId: number): Mutex {
  let lock = locks.get(walletId);
  if (!lock) {
    lock = new Mutex();
    locks.set(walletId, lock);
  }
  return lock;
}

/** Non-sensitive local counters for rollout monitoring. Best-effort. */
async function recordOutcome(outcome: MigrationOutcome): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.id || !chrome.storage?.local) return;
  try {
    const KEY = 'keyEnvelopeMigration';
    const stored = (await chrome.storage.local.get(KEY))?.[KEY] as Record<string, number> | undefined;
    const counts = { ...(stored ?? {}) };
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    await chrome.storage.local.set({ [KEY]: counts });
  } catch {
    // Counters must never affect unlock.
  }
}

interface PlannedConfig {
  field: ConfigSecretField;
  row: ConfigRow;
  plain: ConfigSecretPlain;
  next: string | string[];
}

async function planConfig(rows: ConfigRow[], password: string): Promise<PlannedConfig[]> {
  const byKey = new Map(rows.map(r => [r.key, r]));

  const planned: PlannedConfig[] = [];
  for (const field of CONFIG_SECRET_FIELDS) {
    if (field.encryptionKey) {
      const method = byKey.get(field.encryptionKey)?.value;
      if (method !== undefined && method !== 'password') continue;
    }
    const row = byKey.get(field.key);
    if (!row || row.value === undefined || row.value === null || isConfigValueGpw2(row.value)) continue;
    let plain: ConfigSecretPlain;
    try {
      plain = openConfigSecret(field, row.value, password);
    } catch {
      // Not under this password (or malformed): leave it exactly as it is.
      continue;
    }
    const next = await sealConfigSecret(
      field,
      plain,
      text => sealGpw2Text(text, password, field.purpose),
      bytes => sealGpw2(bytes, password, field.purpose),
    );
    if (!sameConfigPlain(openConfigSecret(field, next, password), plain)) {
      throw new MigrationError('readback_fail');
    }
    planned.push({ field, row, plain, next });
  }
  return planned;
}

class MigrationError extends Error {
  constructor(readonly outcome: MigrationOutcome) {
    super(outcome);
  }
}

async function migrate(walletId: number, password: string, store: SecretMigrationStore): Promise<MigrationResult> {
  if (!(await refreshEnvelopeV2Flag())) return { outcome: 'disabled' };

  const row = await store.getWallet(walletId);
  if (!row || !row.encryptedPrivateKey || row.encryptionMethod === 'prf' || row.encryptionMethod === 'mpc') {
    return { outcome: 'not-applicable' };
  }

  // 1. Decrypt the wallets-row secrets.
  let rootKey: Buffer;
  let mnemonic: string | undefined;
  try {
    rootKey = decryptPrivateKey(row.encryptedPrivateKey, password);
    if (row.encryptedMnemonic) mnemonic = decrypt(row.encryptedMnemonic, password, SecretPurpose.Mnemonic);
  } catch {
    return { outcome: 'decrypt_fail' };
  }

  // 2. Key equivalence before anything is rewritten.
  if (mnemonic !== undefined && !Buffer.from(rootKeyFromMnemonic(row.chain, mnemonic)).equals(rootKey)) {
    return { outcome: 'equivalence_fail' };
  }

  // 3. Seal + in-memory read-back.
  const expected: WalletBlobs = {};
  const next: WalletBlobs = {};
  if (!isGpw2(row.encryptedPrivateKey)) {
    const sealed = sealGpw2(rootKey, password, SecretPurpose.RootKey);
    if (!Buffer.from(openGpw2(sealed, password, SecretPurpose.RootKey)).equals(rootKey)) return { outcome: 'readback_fail' };
    expected.encryptedPrivateKey = row.encryptedPrivateKey;
    next.encryptedPrivateKey = sealed;
  }
  if (mnemonic !== undefined && row.encryptedMnemonic && !isGpw2(row.encryptedMnemonic)) {
    const sealed = sealGpw2Text(mnemonic, password, SecretPurpose.Mnemonic);
    if (openGpw2Text(sealed, password, SecretPurpose.Mnemonic) !== mnemonic) return { outcome: 'readback_fail' };
    expected.encryptedMnemonic = row.encryptedMnemonic;
    next.encryptedMnemonic = sealed;
  }

  let planned: PlannedConfig[];
  try {
    planned = await planConfig(await store.getConfig(walletId, CONFIG_KEYS), password);
  } catch (e) {
    return { outcome: e instanceof MigrationError ? e.outcome : 'write_error' };
  }

  if (Object.keys(next).length === 0 && planned.length === 0) return { outcome: 'already-current' };

  // 4. Compare-and-swap writes, one transaction per database.
  try {
    if (Object.keys(next).length > 0 && !(await store.casWallet(walletId, expected, next))) {
      return { outcome: 'cas_conflict' };
    }
    if (planned.length > 0) {
      const ok = await store.casConfig(walletId, planned.map(p => ({ key: p.row.key, expected: p.row.value, next: p.next })));
      if (!ok) return { outcome: 'cas_conflict', ...next };
    }
  } catch {
    return { outcome: 'write_error' };
  }

  // 5. Read back from storage and open.
  try {
    const stored = await store.getWallet(walletId);
    if (next.encryptedPrivateKey !== undefined) {
      if (stored?.encryptedPrivateKey !== next.encryptedPrivateKey) return { outcome: 'readback_fail' };
      if (!decryptPrivateKey(stored.encryptedPrivateKey, password).equals(rootKey)) return { outcome: 'readback_fail' };
    }
    if (next.encryptedMnemonic !== undefined) {
      if (stored?.encryptedMnemonic !== next.encryptedMnemonic) return { outcome: 'readback_fail' };
      if (decrypt(stored.encryptedMnemonic, password, SecretPurpose.Mnemonic) !== mnemonic) return { outcome: 'readback_fail' };
    }
    if (planned.length > 0) {
      const rows = new Map((await store.getConfig(walletId, CONFIG_KEYS)).map(r => [r.key, r]));
      for (const p of planned) {
        const r = rows.get(p.row.key);
        if (!r || !sameConfigPlain(openConfigSecret(p.field, r.value, password), p.plain)) return { outcome: 'readback_fail' };
      }
    }
  } catch {
    return { outcome: 'readback_fail' };
  }

  return { outcome: 'migrated', ...next };
}

/**
 * Upgrade a wallet's stored secrets to `gpw2`. Safe to call on every successful
 * password decrypt: it is serialized per wallet, cheap when there is nothing to do,
 * and never throws.
 */
export async function migrateWalletSecrets(
  walletId: number,
  password: string,
  store: SecretMigrationStore = createDexieSecretStore(),
): Promise<MigrationResult> {
  if (!password) return { outcome: 'not-applicable' };
  const result = await lockFor(walletId).runExclusive(async () => {
    try {
      return await migrate(walletId, password, store);
    } catch {
      return { outcome: 'write_error' as const };
    }
  });
  if (result.outcome !== 'disabled' && result.outcome !== 'already-current' && result.outcome !== 'not-applicable') {
    debugLog(`🔐 Secret envelope migration for wallet ${walletId}: ${result.outcome}`);
    await recordOutcome(result.outcome);
  }
  return result;
}
