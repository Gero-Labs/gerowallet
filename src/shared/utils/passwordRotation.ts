import { Buffer } from 'buffer';
import { SecretPurpose, decrypt, decryptKeyBlob, decryptPrivateKey } from './crypto';
import { sealKeySecret, sealTextSecret } from './secretWriters';
import { CONFIG_SECRET_FIELDS, openConfigSecret, sealConfigSecret, type ConfigSecretField, type ConfigSecretPlain } from './walletSecretFields';
import { debugLog } from '@/utils/debug';

/**
 * Re-encrypt every secret a password wallet stores under its spending password,
 * for a spending-password change.
 *
 * Two phases so a wrong password never writes anything:
 *  1. `prepare` decrypts the root key and mnemonic with the current password
 *     (throws on a wrong one) and seals them under the new one. It also decrypts
 *     and re-seals the secondary secrets: 2FA data and the password-encrypted SPO
 *     cold key (per-wallet config), and the Strike key (chrome.storage.local). A
 *     secondary value that does not open with the current password is already
 *     unusable and is left as it is.
 *  2. The caller writes the wallets row, then calls `commitSecondary`, which is
 *     best-effort: a failed secondary write is logged, never turns a completed
 *     password change into an error.
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
      text => sealTextSecret(text, newPassword, SecretPurpose.SecurityData),
      bytes => sealKeySecret(bytes, newPassword, SecretPurpose.ColdKey),
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
  const record = (await chrome.storage.local.get(key))?.[key] as StrikeRecord | undefined;
  if (!record || typeof record.privateKeyEncrypted !== 'string') return null;
  let keyBytes: Buffer;
  try {
    keyBytes = decryptKeyBlob(record.privateKeyEncrypted, currentPassword, SecretPurpose.StrikeKey);
  } catch {
    return null;
  }
  return {
    key,
    record: { ...record, privateKeyEncrypted: await sealKeySecret(keyBytes, newPassword, SecretPurpose.StrikeKey) },
  };
}

export async function prepareSpendingPasswordRotation(
  wallet: RotationWallet,
  currentPassword: string,
  newPassword: string,
): Promise<PreparedRotation> {
  // Throws on a wrong current password, before anything is sealed or written.
  const rootKey = decryptPrivateKey(wallet.encryptedPrivateKey, currentPassword);
  const mnemonic = wallet.encryptedMnemonic
    ? decrypt(wallet.encryptedMnemonic, currentPassword, SecretPurpose.Mnemonic)
    : null;

  const encryptedPrivateKey = await sealKeySecret(rootKey, newPassword, SecretPurpose.RootKey);
  const encryptedMnemonic = mnemonic === null ? null : await sealTextSecret(mnemonic, newPassword, SecretPurpose.Mnemonic);

  let configUpdates: ConfigUpdate[] = [];
  let strike: { key: string; record: StrikeRecord } | null = null;
  try {
    configUpdates = await prepareConfig(wallet.id, currentPassword, newPassword);
    strike = await prepareStrike(wallet, currentPassword, newPassword);
  } catch (e) {
    debugLog('🔐 Could not prepare secondary secrets for password change:', e);
  }

  return {
    encryptedPrivateKey,
    encryptedMnemonic,
    async commitSecondary() {
      try {
        if (configUpdates.length > 0) {
          const { getDb } = await import('@/db/wallet-db');
          const db = await getDb(wallet.id);
          if (db) {
            const table = db.table('config');
            await db.transaction('rw', table, async () => {
              for (const u of configUpdates) await table.update(u.key, { value: u.next });
            });
          }
        }
        if (strike) await chrome.storage.local.set({ [strike.key]: strike.record });
      } catch (e) {
        debugLog('🔐 Could not re-encrypt secondary secrets after password change:', e);
      }
    },
  };
}
