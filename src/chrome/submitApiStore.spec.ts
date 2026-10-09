import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { getDb } from '@/db/wallet-db';
import { clearSubmitApi, readSubmitApi, writeSubmitApi } from './submitApiStore';
import type { SubmitApiConfig } from '@/shared/utils/submitApiConfig';

const WALLET_ID = 880001;
const CONFIG: SubmitApiConfig = {
  version: 1,
  url: 'https://node.example/api/submit/tx',
  headerName: 'project_id',
  hasAuth: true,
  fallbackToDefault: false,
};

async function row(key: string): Promise<unknown> {
  const db = await getDb(WALLET_ID);
  return (await db!.table('config').get(key))?.value;
}

afterEach(async () => {
  await (await getDb(WALLET_ID))?.delete();
});

describe('submitApiStore', () => {
  it('reads null for a wallet without a Submit API', async () => {
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: null, auth: null });
  });

  it('reads a present row holding null as an empty config, so the router fails closed instead of treating it as absent', async () => {
    const db = await getDb(WALLET_ID);
    await db!.table('config').put({ key: 'submitApi', value: null });
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: {}, auth: null });
    await db!.table('config').put({ key: 'submitApi', value: undefined });
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: {}, auth: null });
  });

  it('writes the public row and the secret row separately', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    expect(await row('submitApi')).toEqual(CONFIG);
    expect(await row('submitApiAuth')).toBe('secret-key');
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: CONFIG, auth: 'secret-key' });
  });

  it('keeps the saved secret when headerValue is undefined', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    await writeSubmitApi(WALLET_ID, { ...CONFIG, fallbackToDefault: true }, undefined);
    expect(await row('submitApiAuth')).toBe('secret-key');
    expect(await row('submitApi')).toMatchObject({ fallbackToDefault: true });
  });

  it('deletes the secret when headerValue is null', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    await writeSubmitApi(WALLET_ID, { ...CONFIG, headerName: null, hasAuth: false }, null);
    expect(await row('submitApiAuth')).toBeUndefined();
  });

  it('clears both rows', async () => {
    await writeSubmitApi(WALLET_ID, CONFIG, 'secret-key');
    await clearSubmitApi(WALLET_ID);
    expect(await readSubmitApi(WALLET_ID)).toEqual({ config: null, auth: null });
  });
});
