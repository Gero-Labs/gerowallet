import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { registerSnapshot: vi.fn(), broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import { clearBlockchainDbCache, getBlockchainDb } from '@/db';
import { blockChainDBSchema, blockChainDBVersion } from '@/db/schema';

const namespaces: Array<[string, string]> = [];

// Exercise the production methods without unrelated address derivation/loaders.
function wallet(chain = 'WalletBgBoundary', network = 'Preprod'): WalletBg {
  namespaces.push([chain, network]);
  return Object.assign(Object.create(WalletBg.prototype) as WalletBg, { chain, network });
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const [chain, network] of namespaces.splice(0)) {
    clearBlockchainDbCache(chain, network);
    await Dexie.delete(`${chain}_${network}`);
  }
});

describe('WalletBg blockchain database boundary', () => {
  it('uses the shared opener and persists nested reactive values with native types', async () => {
    const bg = wallet();
    const db = await bg.getBlockchainDb();
    expect(db).toBe(await getBlockchainDb(bg.chain, bg.network));
    expect(db.verno).toBe(blockChainDBVersion);
    expect(db.tables.map(table => table.name).sort()).toEqual(Object.keys(blockChainDBSchema).sort());
    const metadata = reactive({ count: 4n, bytes: new Uint8Array([1, 2]), updated: new Date('2026-10-13T00:00:00Z') });
    const record = reactive({ asset: 'native-token', metadata: { properties: metadata } });
    await db.table('assets').bulkPut([record]);
    await db.table('epoch_params').put(reactive({ epoch: 42, parameters: metadata }));
    clearBlockchainDbCache(bg.chain, bg.network);
    const reopened = await bg.getBlockchainDb();
    expect(reopened).not.toBe(db);
    const saved = await reopened.table('assets').get('native-token');
    expect(saved.metadata.properties).toEqual(metadata);
    expect(saved.metadata.properties.bytes).toBeInstanceOf(Uint8Array);
    expect(saved.metadata.properties.updated).toBeInstanceOf(Date);
    expect((await reopened.table('epoch_params').get(42)).parameters.count).toBe(4n);
  });

  it('isolates records when the network or chain changes and reuses the right cache', async () => {
    const bg = wallet();
    const preprod = await bg.getBlockchainDb();
    await preprod.table('assets').put({ asset: 'same-unit', name: 'Preprod token' });
    bg.network = 'Mainnet';
    namespaces.push([bg.chain, bg.network]);
    const mainnet = await bg.getBlockchainDb();
    expect(mainnet.name).toBe('WalletBgBoundary_Mainnet');
    expect(await mainnet.table('assets').get('same-unit')).toBeUndefined();
    await mainnet.table('assets').put({ asset: 'same-unit', name: 'Mainnet token' });
    bg.chain = 'OtherChainBoundary';
    namespaces.push([bg.chain, bg.network]);
    const otherChain = await bg.getBlockchainDb();
    expect(otherChain.name).toBe('OtherChainBoundary_Mainnet');
    expect(await otherChain.table('assets').get('same-unit')).toBeUndefined();
    bg.chain = 'WalletBgBoundary';
    bg.network = 'Preprod';
    expect(await bg.getBlockchainDb()).toBe(preprod);
    expect((await preprod.table('assets').get('same-unit')).name).toBe('Preprod token');
  });

  it('fails explicitly when the current network database cannot open', async () => {
    const bg = wallet('UnavailableBoundary', 'Preprod');
    vi.spyOn(Dexie.prototype, 'open').mockRejectedValueOnce(new Error('IndexedDB unavailable'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(bg.getBlockchainDb()).rejects.toThrow('Blockchain database unavailable: UnavailableBoundary_Preprod');
  });
});
