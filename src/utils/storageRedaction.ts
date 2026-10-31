/**
 * Fields that must never be written to `chrome.storage.local`.
 *
 * Every content script can read and write that area: Gero's own, which runs in
 * every frame of every tab, and the third-party Bring SDK inside it. An encrypted
 * root key or recovery phrase stored there can be copied by code in any web page's
 * renderer and attacked offline; an unlock hash (a 4 to 6 digit PIN) falls in
 * minutes. The stores below keep these values in memory and hand them to the
 * extension's own pages over the store-sync port, which only those pages can open
 * (storeMessagingBg.ts). The copies they persist to chrome.storage.local, for a
 * page's first paint, go through the redactors here.
 *
 * Kept free of heavy imports: every store imports this module.
 */
import { SUBMIT_API_AUTH_CONFIG_KEY } from '@/shared/utils/submitApiConfig';

/** Wallet-record fields holding an encrypted secret or a secret-derived hash. */
export const WALLET_RECORD_SECRET_FIELDS = [
  'encryptedPrivateKey',
  'encryptedMnemonic',
  'prfEncryptedPrivateKey',
  'prfEncryptedMnemonic',
  'prfSpendingPassword',
  'mpcDeviceShare',
  'mpcDeviceShareNext',
] as const;

/**
 * Per-wallet `config` rows (IndexedDB `wallet-{id}`) that hold a secret, an unlock
 * verifier or a credential. ConfigLoader never loads them into walletStore
 * (PRIVATE_CONFIG_KEYS in walletLoader.ts); their readers query the wallet DB.
 * Must include every key of CONFIG_SECRET_FIELDS (walletSecretFields.ts).
 */
export const SECRET_CONFIG_KEYS = [
  // Encrypted under the spending password (CONFIG_SECRET_FIELDS).
  'encryptedPinHash',
  'encryptedTotpSecret',
  'encryptedBackupCodes',
  'spo_encryptedColdKey',
  // Unlock verifiers: a short PIN or pattern hash is brute-forced offline in minutes.
  'pinHash',
  'encryptedPatternHash',
  'lockPasswordHash',
  // The spending password, encrypted with the PassKey PRF.
  'passKeyEncryptedSpendingPassword',
  // SPO node monitors, with each agent's bearer token.
  'spo_nodes',
] as const;

const WALLET_SECRET_SET: ReadonlySet<string> = new Set(WALLET_RECORD_SECRET_FIELDS);
const CONFIG_SECRET_SET: ReadonlySet<string> = new Set([...SECRET_CONFIG_KEYS, SUBMIT_API_AUTH_CONFIG_KEY]);

function without<T>(value: T, drop: ReadonlySet<string>): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (!Object.keys(record).some((key) => drop.has(key))) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(record)) {
    if (!drop.has(key)) copy[key] = field;
  }
  return copy as T;
}

/** `wallet` without its secret fields; the same object when it has none. */
export function redactWalletRecord<T>(wallet: T): T {
  return without(wallet, WALLET_SECRET_SET);
}

/** A wallet `config` map without its secret rows; the same object when it has none. */
export function redactWalletConfig<T>(config: T): T {
  return without(config, CONFIG_SECRET_SET);
}

/** A `{ [id]: wallet }` map with every wallet redacted. */
export function redactWalletRecords<T>(wallets: Record<string, T> | null | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, wallet] of Object.entries(wallets ?? {})) out[id] = redactWalletRecord(wallet);
  return out;
}
