import { Buffer } from 'buffer';
import { SecretPurpose } from './secretEnvelope';
import { decrypt, decryptKeyBlob } from './crypto';

/**
 * Inventory of the per-wallet `config` rows (IndexedDB `wallet-{id}`) that hold a
 * secret encrypted under the spending password. The root key and mnemonic live
 * on the `wallets` row and are handled separately.
 *
 * Anything added here is re-encrypted on a spending-password change and upgraded
 * by the on-unlock migration. Something encrypted under the spending password
 * that is missing from this list silently keeps the OLD password after a change.
 */
export type ConfigSecretKind = 'text' | 'textList' | 'key';

export interface ConfigSecretField {
  key: string;
  kind: ConfigSecretKind;
  purpose: typeof SecretPurpose.SecurityData | typeof SecretPurpose.ColdKey;
  /**
   * Config row that says how the value is encrypted. The field is only a
   * password secret when that row is absent or equals 'password' (the SPO cold
   * key can also be PassKey/PRF-encrypted, which is not ours to touch).
   */
  encryptionKey?: string;
}

export const CONFIG_SECRET_FIELDS: readonly ConfigSecretField[] = [
  { key: 'encryptedPinHash', kind: 'text', purpose: SecretPurpose.SecurityData },
  { key: 'encryptedTotpSecret', kind: 'text', purpose: SecretPurpose.SecurityData },
  { key: 'encryptedBackupCodes', kind: 'textList', purpose: SecretPurpose.SecurityData },
  { key: 'spo_encryptedColdKey', kind: 'key', purpose: SecretPurpose.ColdKey, encryptionKey: 'spo_coldKeyEncryption' },
];

/** Plaintext of one config secret: a string, a list of strings, or key bytes. */
export type ConfigSecretPlain = string | string[] | Uint8Array;

/** Decrypt one config value. Throws on a wrong password or an unexpected shape. */
export function openConfigSecret(field: ConfigSecretField, value: unknown, password: string): ConfigSecretPlain {
  if (field.kind === 'textList') {
    if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) throw new Error(`Unexpected ${field.key} shape`);
    return value.map(v => decrypt(v, password, SecretPurpose.SecurityData));
  }
  if (typeof value !== 'string') throw new Error(`Unexpected ${field.key} shape`);
  if (field.kind === 'key') {
    return new Uint8Array(decryptKeyBlob(value, password, SecretPurpose.ColdKey));
  }
  return decrypt(value, password, SecretPurpose.SecurityData);
}

/** Seal one config plaintext with the given sealers, preserving its shape. */
export async function sealConfigSecret(
  field: ConfigSecretField,
  plain: ConfigSecretPlain,
  sealText: (text: string) => Promise<string> | string,
  sealKey: (bytes: Uint8Array) => Promise<string> | string,
): Promise<string | string[]> {
  if (field.kind === 'textList') return Promise.all((plain as string[]).map(v => sealText(v)));
  if (field.kind === 'key') return sealKey(plain as Uint8Array);
  return sealText(plain as string);
}

/** True when two plaintexts are identical (used for read-back verification). */
export function sameConfigPlain(a: ConfigSecretPlain, b: ConfigSecretPlain): boolean {
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    return a instanceof Uint8Array && b instanceof Uint8Array && Buffer.from(a).equals(Buffer.from(b));
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/** True when a stored config value is already fully `gpw2`. */
export function isConfigValueGpw2(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0 && value.every(v => typeof v === 'string' && v.startsWith('gpw2.'));
  return typeof value === 'string' && value.startsWith('gpw2.');
}
