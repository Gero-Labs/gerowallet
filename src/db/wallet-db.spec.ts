import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from './wallet-db';
import databaseSetup from './index';

const original = {
  config: 'key, value',
  sync: '++id, hash, height, slot, time, epoch, epoch_slot',
  account: '++id, walletId',
  addresses: 'address',
  contacts: 'address, name',
  rewards: 'epoch, amount, pool_id, type',
  transactions: 'id',
  connected_dapps: '++id, domain, time',
};
const multisig = 'id, paymentAddress, stakeAddress, name, signers, cbor, requiredSigners, createdAt';
const charts = '++id, address, currency, [address+currency], data, timestamp, expiresAt';
const vaults = 'vaultId, status, network, updatedAt';
let nextId = 105600;
const connections: Dexie[] = [];
const names: string[] = [];
function walletId() {
  const id = nextId++;
  names.push(`wallet-${id}`);
  return id;
}
function connection(id: number) {
  const db = new Dexie(`wallet-${id}`);
  connections.push(db);
  return db;
}
async function openWallet(id: number) {
  const db = await getDb(id);
  expect(db).not.toBeNull();
  connections.push(db!);
  return db!;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of connections.splice(0)) db.close();
  for (const name of names.splice(0)) await Dexie.delete(name);
});

describe('wallet database upgrades', () => {
  for (const version of [3, 4, 5, 6, 7, 8, 9, 10, 10.1, 11, 12]) {
    it(`preserves records upgrading version ${version} through concurrent openers`, async () => {
      const id = walletId();
      const legacy = connection(id);
      // 10.1 models Dexie's native-version bump after the conflicting v10 opener.
      const hasMultisig = (version >= 6 && version <= 8) || version >= 10.1;
      legacy.version(version).stores({
        ...original,
        ...(hasMultisig ? { multisig } : {}),
        ...(version >= 7 ? { portfolio_charts: charts } : {}),
        ...(version >= 10 ? { utxos: '++id' } : {}),
        ...(version >= 12 ? { vaults } : {}),
      });
      await legacy.open();
      const records: Record<string, object> = {
        config: { key: 'currency', value: 'EUR' },
        sync: { id: 1, hash: 'saved-tip', height: 123 },
        account: { id: 1, walletId: id, controlled_amount: '1234567' },
        addresses: { address: 'saved-public-key', resolvedKeys: { payment: ['saved-address'] } },
        contacts: { address: 'saved-contact', name: 'Alice' },
        rewards: { epoch: 42, amount: '456' },
        transactions: { id: 'saved-transaction', cbor: '00' },
        connected_dapps: { id: 1, domain: 'https://example.test', time: 12 },
        ...(hasMultisig ? { multisig: { id: 'saved-script', cbor: '00', signers: ['key-a'] } } : {}),
        ...(version >= 7 ? { portfolio_charts: { id: 1, address: 'saved-address', data: '[1,2]' } } : {}),
        ...(version >= 10 ? { utxos: { id: 1, txHash: 'saved-utxo', amount: '1234567' } } : {}),
        ...(version >= 12 ? { vaults: { vaultId: 'ab'.repeat(32), status: 'accepted', network: 'preprod', updatedAt: 1 } } : {}),
      };
      for (const [table, record] of Object.entries(records)) await legacy.table(table).put(record);
      legacy.close();

      const warn = vi.spyOn(console, 'warn');
      const ui = connection(id);
      databaseSetup.setWalletDBVersionSchema(ui);
      const [background] = await Promise.all([openWallet(id), ui.open()]);
      expect(background.backendDB().version).toBe(130);
      expect(ui.backendDB().version).toBe(130);
      expect(ui.tables.map(t => t.name).sort()).toEqual(background.tables.map(t => t.name).sort());
      expect(background.tables.map(t => t.name)).toContain('multisig');
      for (const [table, record] of Object.entries(records)) {
        expect(await background.table(table).toArray()).toEqual([record]);
      }
      // Version 12 adds the GeroVault table, empty, beside the legacy multisig one; 13 adds the
      // Midnight one, empty, and leaves every earlier table as it was.
      if (version < 12) expect(await background.table('vaults').count()).toBe(0);
      expect(await background.table('midnightVaults').count()).toBe(0);
      expect(await background.table('midnightVaultIndexes').count()).toBe(0);
      expect(warn.mock.calls.flat().join(' ')).not.toMatch(/SchemaDiff|without increasing|blocked by other connection/);
    });
  }

  it('opens one connection for simultaneous callers and reopens after close', async () => {
    const id = walletId();
    const open = vi.spyOn(Dexie.prototype, 'open');
    const databases = await Promise.all(Array.from({ length: 12 }, () => openWallet(id)));
    expect(new Set(databases).size).toBe(1);
    expect(open).toHaveBeenCalledTimes(1);
    databases[0].close();
    const reopened = await openWallet(id);
    expect(reopened).not.toBe(databases[0]);
    expect(reopened.backendDB().version).toBe(130);
  });

  it('allows retry after a failed open instead of caching failure', async () => {
    const id = walletId();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = vi.spyOn(Dexie.prototype, 'open').mockRejectedValueOnce(new Error('injected open failure'));
    const failed = await Promise.all([getDb(id), getDb(id)]);
    expect(failed).toEqual([null, null]);
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
    expect((await openWallet(id)).backendDB().version).toBe(130);
  });

  it('declares the vaults table with the vault id as its key', async () => {
    const db = await openWallet(walletId());
    const vaults = db.table('vaults');
    expect(vaults.schema.primKey.keyPath).toBe('vaultId');
    expect(vaults.schema.indexes.map(index => index.name).sort()).toEqual(['network', 'status', 'updatedAt']);
  });

  it('declares the Midnight tables: vaults by vault id, index counters by network', async () => {
    const db = await openWallet(walletId());
    const midnight = db.table('midnightVaults');
    expect(midnight.schema.primKey.keyPath).toBe('vaultId');
    expect(midnight.schema.indexes.map(index => index.name).sort()).toEqual(['contractAddress', 'network', 'status', 'updatedAt']);
    expect(db.table('midnightVaultIndexes').schema.primKey.keyPath).toBe('network');
  });
});
