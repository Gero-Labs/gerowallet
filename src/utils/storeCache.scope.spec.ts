import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { deleteStoreCacheScope, readStoreCache, writeStoreCache } from './storeCache';

describe('deleteStoreCacheScope', () => {
  it('drops only the rows of the given session', async () => {
    await writeStoreCache([
      { key: 'midnightStore.transactions', scope: 'mn_addr1gone', json: '[1]', savedAt: 1 },
      { key: 'midnightStore.utxos', scope: 'mn_addr1gone', json: '[2]', savedAt: 1 },
      { key: 'walletStore.transactions', scope: '7', json: '[3]', savedAt: 1 },
    ]);
    await deleteStoreCacheScope('mn_addr1gone');
    const left = await readStoreCache(['midnightStore.transactions', 'midnightStore.utxos', 'walletStore.transactions']);
    expect([...left.keys()]).toEqual(['walletStore.transactions']);
  });
});
