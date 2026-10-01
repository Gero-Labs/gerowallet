// Deleting a wallet must leave nothing of it on this device, including the
// data kept outside its `wallets` row and `wallet-{id}` database: the
// encrypted Strike API key and the cached display state in gero-store-cache.
// Real (in-memory) IndexedDB, because deleteWallet lives next to the other
// gero-db functions it calls.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, Theme } from '@/models/types';
import { createNewWallet, deleteWallet } from '@/db/gero-db';
import { readStoreCache, writeStoreCache } from '@/utils/storeCache';

// Fixed test vector, never used to hold funds.
const MNEMONIC = 'test walk nut penalty hip pave soap entry language right filter choice';
const PASSWORD = 'Test-Password-1!';

let local: Record<string, unknown>;

beforeEach(() => {
  local = {};
  vi.stubGlobal('chrome', {
    runtime: { id: 'test-ext' },
    storage: {
      local: {
        get: async (key: string) => ({ [key]: local[key] }),
        set: async (items: Record<string, unknown>) => { Object.assign(local, items); },
        remove: async (key: string | string[]) => { for (const k of [key].flat()) delete local[k]; },
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deleteWallet leftovers', () => {
  it("removes the wallet's Strike key and its cached store fields, and nobody else's", async () => {
    const id = await createNewWallet('Doomed', 'icon', Theme.GERO, MNEMONIC, PASSWORD, Blockchain.CARDANO, Network.MAINNET);
    const other = id + 1000;
    local[`strike_keys_${id}`] = { publicKey: 'pk', privateKeyEncrypted: 'blob' };
    local[`strike_keys_${other}`] = { publicKey: 'pk2', privateKeyEncrypted: 'blob2' };
    await writeStoreCache([
      { key: 'walletStore.transactions', scope: String(id), json: '[1]', savedAt: 1 },
      { key: 'walletStore.utxos', scope: String(id), json: '[2]', savedAt: 1 },
      { key: 'networkStore.assets', scope: String(other), json: '[3]', savedAt: 1 },
    ]);

    await deleteWallet(id);

    expect(local[`strike_keys_${id}`]).toBeUndefined();
    expect(local[`strike_keys_${other}`]).toBeDefined();
    const left = await readStoreCache(['walletStore.transactions', 'walletStore.utxos', 'networkStore.assets']);
    expect([...left.keys()]).toEqual(['networkStore.assets']);
  });
});
