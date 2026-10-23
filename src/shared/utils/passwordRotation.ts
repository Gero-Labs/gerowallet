import { Buffer } from 'buffer';
import { SecretPurpose, decrypt, decryptKeyBlob, decryptPrivateKey } from './crypto';
import { resealKeySecret, resealTextSecret } from './secretWriters';
import { CONFIG_SECRET_FIELDS, openConfigSecret, sealConfigSecret, type ConfigSecretField, type ConfigSecretPlain } from './walletSecretFields';
import { debugLog } from '@/utils/debug';
import { moveFromChromeLocal, setPrivateMany } from '@/utils/privateStore';

/**
 * Re-encrypt every secret a password wallet stores under its spending password,
 * for a spending-password change.
 *
 * Two phases so a wrong password never writes anything:
 *  1. `prepare` decrypts the root key and mnemonic with the current password
 *     (throws on a wrong one) and seals them under the new one. It also decrypts
 *     and re-seals the secondary secrets: 2FA data and the password-encrypted SPO
 *     cold key (per-wallet config), and the Strike key (privateStore.ts). A
 *     secondary value that does not open with the current password is already
 *     unusable and is left as it is.
 *  2. The caller writes the wallets row, then calls `commitSecondary`, which is
 *     best-effort: a failed secondary write is logged, never turns a completed
 *     password change into an error.
 *
 * Every field is re-sealed at least as strongly as it is stored: a `gpw2` field
 * stays `gpw2` even when the flag has since been turned off (`reseal*Secret`).
 *
 * Root keys are handled as raw bytes for every chain; wrapping them in a Cardano
 * `Bip32PrivateKey` rejected Bitcoin (32-byte) and Midnight (64-byte) keys.
 */

export interface RotationWallet {
  id: number;
  encryptedPrivateKey: string;
  encryptedMnemonic?: string | null;
  encryptionMethod?: string;
}

/** Per-wallet `config` rows are keyed by `key`. */
interface ConfigUpdate {
  key: string;
  next: string | string[];
}

export interface PreparedRotation {
  encryptedPrivateKey: string;
  encryptedMnemonic: string | null;
  commitSecondary(): Promise<void>;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage?.local;
}

async function prepareConfig(walletId: number, currentPassword: string, newPassword: string): Promise<ConfigUpdate[]> {
  const { getDb } = await import('@/db/wallet-db');
  const db = await getDb(walletId);
  if (!db) return [];
  const keys = [...CONFIG_SECRET_FIELDS.map(f => f.key), ...CONFIG_SECRET_FIELDS.flatMap(f => (f.encryptionKey ? [f.encryptionKey] : []))];
  const rows: Array<{ key: string; value: unknown }> = await db.table('config').where('key').anyOf(keys).toArray();

  const updates: ConfigUpdate[] = [];
  for (const field of CONFIG_SECRET_FIELDS as readonly ConfigSecretField[]) {
    if (field.encryptionKey) {
      const method = rows.find(r => r.key === field.encryptionKey)?.value;
      if (method !== undefined && method !== 'password') continue;
    }
    const row = rows.find(r => r.key === field.key);
    if (!row || row.value === undefined || row.value === null) continue;
    let plain: ConfigSecretPlain;
    try {
      plain = openConfigSecret(field, row.value, currentPassword);
    } catch {
      continue;
    }
    const next = await sealConfigSecret(
      field,
      plain,
      text => resealTextSecret(text, newPassword, SecretPurpose.SecurityData, row.value),
      bytes => resealKeySecret(bytes, newPassword, SecretPurpose.ColdKey, row.value),
    );
    updates.push({ key: row.key, next });
  }
  return updates;
}

interface StrikeRecord {
  privateKeyEncrypted?: unknown;
  [k: string]: unknown;
}

async function prepareStrike(wallet: RotationWallet, currentPassword: string, newPassword: string): Promise<{ key: string; record: StrikeRecord } | null> {
  if (!hasChromeStorage() || wallet.encryptionMethod === 'prf') return null;
  const key = `strike_keys_${wallet.id}`;
  const record = await moveFromChromeLocal<StrikeRecord>(key);
  if (!record || typeof record.privateKeyEncrypted !== 'string') return null;
  let keyBytes: Buffer;
  try {
    keyBytes = decryptKeyBlob(record.privateKeyEncrypted, currentPassword, SecretPurpose.StrikeKey);
  } catch {
    return null;
  }
  return {
    key,
    record: {
      ...record,
      privateKeyEncrypted: await resealKeySecret(keyBytes, newPassword, SecretPurpose.StrikeKey, record.privateKeyEncrypted),
    },
  };
}

/**
 * @param accountIds - The accounts added under `wallet`. They store none of its
 *   secrets, but their own secondary ones (an SPO cold key, a Strike key) are
 *   sealed under the same spending password and follow it too.
 */
export async function prepareSpendingPasswordRotation(
  wallet: RotationWallet,
  currentPassword: string,
  newPassword: string,
  accountIds: readonly number[] = [],
): Promise<PreparedRotation> {
  // Throws on a wrong current password, before anything is sealed or written.
  const rootKey = decryptPrivateKey(wallet.encryptedPrivateKey, currentPassword);
  const mnemonic = wallet.encryptedMnemonic
    ? decrypt(wallet.encryptedMnemonic, currentPassword, SecretPurpose.Mnemonic)
    : null;

  const encryptedPrivateKey = await resealKeySecret(rootKey, newPassword, SecretPurpose.RootKey, wallet.encryptedPrivateKey);
  const encryptedMnemonic = mnemonic === null
    ? null
    : await resealTextSecret(mnemonic, newPassword, SecretPurpose.Mnemonic, wallet.encryptedMnemonic);

  const configUpdates: Array<{ walletId: number; updates: ConfigUpdate[] }> = [];
  const strikes: Array<{ key: string; record: StrikeRecord }> = [];
  for (const walletId of [wallet.id, ...accountIds]) {
    try {
      const updates = await prepareConfig(walletId, currentPassword, newPassword);
      if (updates.length > 0) configUpdates.push({ walletId, updates });
      const strike = await prepareStrike({ ...wallet, id: walletId }, currentPassword, newPassword);
      if (strike) strikes.push(strike);
    } catch (e) {
      debugLog('🔐 Could not prepare secondary secrets for password change:', e);
    }
  }

  return {
    encryptedPrivateKey,
    encryptedMnemonic,
    async commitSecondary() {
      const { getDb } = await import('@/db/wallet-db');
      for (const { walletId, updates } of configUpdates) {
        try {
          const db = await getDb(walletId);
          if (!db) continue;
          const table = db.table('config');
          await db.transaction('rw', table, async () => {
            for (const u of updates) await table.update(u.key, { value: u.next });
          });
        } catch (e) {
          debugLog('🔐 Could not re-encrypt secondary secrets after password change:', e);
        }
      }
      try {
        if (strikes.length > 0) await setPrivateMany(strikes.map(({ key, record }) => ({ key, value: record })));
      } catch (e) {
        debugLog('🔐 Could not re-encrypt secondary secrets after password change:', e);
      }
    },
  };
}
