import type Dexie from 'dexie';
import { getDb } from '@/db/wallet-db';
import {
  SUBMIT_API_AUTH_CONFIG_KEY,
  SUBMIT_API_CONFIG_KEY,
  type SubmitApiConfig,
} from '@/shared/utils/submitApiConfig';

/**
 * Background-only access to a wallet's Submit API rows. The secret row
 * (SUBMIT_API_AUTH_CONFIG_KEY) is read here and nowhere else: ConfigLoader skips
 * it, so it never reaches walletStore, broadcasts or chrome.storage.local.
 */
export interface StoredSubmitApi {
  config: unknown;
  auth: unknown;
}

async function walletDb(walletId: number): Promise<Dexie> {
  const db = await getDb(walletId);
  if (!db) throw new Error('Wallet database unavailable');
  return db;
}

export async function readSubmitApi(walletId: number): Promise<StoredSubmitApi> {
  const table = (await walletDb(walletId)).table('config');
  const [config, auth] = await Promise.all([table.get(SUBMIT_API_CONFIG_KEY), table.get(SUBMIT_API_AUTH_CONFIG_KEY)]);
  return { config: config?.value ?? null, auth: auth?.value ?? null };
}

/** headerValue: undefined keeps the stored secret, null deletes it, a string replaces it. */
export async function writeSubmitApi(
  walletId: number,
  config: SubmitApiConfig,
  headerValue: string | null | undefined,
): Promise<void> {
  const db = await walletDb(walletId);
  const table = db.table('config');
  await db.transaction('rw', table, async () => {
    await table.put({ key: SUBMIT_API_CONFIG_KEY, value: config });
    if (headerValue === null) await table.delete(SUBMIT_API_AUTH_CONFIG_KEY);
    // OX Agent: Sensitive Data Protection prevented - the secret is stored apart from the broadcast config row
    else if (typeof headerValue === 'string') await table.put({ key: SUBMIT_API_AUTH_CONFIG_KEY, value: headerValue });
  });
}

export async function clearSubmitApi(walletId: number): Promise<void> {
  const table = (await walletDb(walletId)).table('config');
  await table.bulkDelete([SUBMIT_API_CONFIG_KEY, SUBMIT_API_AUTH_CONFIG_KEY]);
}
