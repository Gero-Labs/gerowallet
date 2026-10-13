import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { isProxy, reactive } from 'vue';
import { configureCloneBoundary, unwrapForIndexedDB } from './cloneBoundary';
import { clearDbCache, getDb, setWalletConfiguration } from './wallet-db';
import { clearBlockchainDbCache, getBlockchainDb } from './index';

const databases: Dexie[] = [];
afterEach(async () => {
  clearDbCache(908701);
  clearBlockchainDbCache('CloneBoundaryTest', 'test');
  for (const db of databases.splice(0)) {
    db.close();
    await db.delete();
  }
});

function database() {
  const db = configureCloneBoundary(new Dexie('vue-clone-boundary-test'));
  db.version(1).stores({ records: '++id, name' });
  databases.push(db);
  return db;
}

function payload() {
  const bytes = new Uint8Array([1, 2, 254, 255]);
  const child = reactive({ count: 4n, bytes });
  return reactive({
    name: 'wallet record',
    encryptedPrivateKey: 'unchanged-encrypted-envelope',
    passwordLastUpdate: new Date('2026-10-13T01:02:03Z'),
    child,
    spread: { child },
    map: new Map([[child, new Set([child])]]),
    buffer: bytes.buffer,
    view: new DataView(bytes.buffer, 1, 2),
  });
}

describe('Vue proxy IndexedDB boundary', () => {
  it('preserves native types, shared references and cycles without changing its input', () => {
    const input = payload();
    const cyclic = reactive<{ value: typeof input; self?: unknown }>({ value: input });
    cyclic.self = cyclic;
    const result = structuredClone(unwrapForIndexedDB(cyclic));
    expect(result.self).toBe(result);
    expect(isProxy(result.value.child)).toBe(false);
    expect(isProxy(input.child)).toBe(true);
    expect(result.value.spread.child).toBe(result.value.child);
    expect([...result.value.map.keys()][0]).toBe(result.value.child);
    expect([...result.value.map.values()][0].has(result.value.child)).toBe(true);
    expect(result.value.child.count).toBe(4n);
    expect(result.value.passwordLastUpdate).toEqual(new Date('2026-10-13T01:02:03Z'));
    expect(result.value.child.bytes).toBeInstanceOf(Uint8Array);
    expect(result.value.child.bytes.buffer).toBe(result.value.buffer);
    expect(result.value.view).toBeInstanceOf(DataView);
    expect(result.value.view.buffer).toBe(result.value.buffer);
    expect(result.value.view.byteOffset).toBe(1);
    expect(result.value.encryptedPrivateKey).toBe(input.encryptedPrivateKey);
  });

  it('covers add, put, bulk writes, update and modify while keeping generated keys and rollback', async () => {
    const db = database();
    // Reinstalling is harmless; no double middleware or schema upgrade.
    expect(configureCloneBoundary(db)).toBe(db);
    const table = db.table('records');
    const source = payload();
    const key = await table.add(source);
    expect(typeof key).toBe('number');
    await table.put(reactive({ ...source, id: key, name: 'put' }));
    await table.bulkAdd(reactive([{ name: 'bulk-add', child: source.child }]));
    await table.bulkPut(reactive([{ id: 30, name: 'bulk-put', child: source.child }]));
    await table.update(key, { child: reactive({ count: 9n, bytes: new Uint8Array([42]) }) });
    await table.where('name').equals('bulk-add').modify(record => {
      record.child = reactive({ count: 8n, bytes: new Uint8Array([43]) });
    });
    const saved = await table.get(key);
    expect(saved.child.count).toBe(9n);
    expect(saved.child.bytes).toEqual(new Uint8Array([42]));
    expect(saved.passwordLastUpdate).toEqual(source.passwordLastUpdate);
    expect(saved.encryptedPrivateKey).toBe(source.encryptedPrivateKey);
    expect((await table.where('name').equals('bulk-add').first()).child.count).toBe(8n);
    expect((await table.get(30)).child.count).toBe(4n);
    expect(db.verno).toBe(1);
    await expect(db.transaction('rw', table, async () => {
      await table.put(reactive({ id: key, name: 'rolled back', child: source.child }));
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await table.get(key)).name).toBe('put');
    // Unsupported values must fail, rather than silently disappear as in JSON.
    await expect(table.put(reactive({ name: 'invalid', callback: () => {} }))).rejects.toMatchObject({ name: 'DataCloneError' });
  });

  it('installs on production wallet and blockchain openers and preserves records after reopen', async () => {
    const wallet = (await getDb(908701))!;
    databases.push(wallet);
    const input = payload();
    await setWalletConfiguration(908701, 'typed-record', input);
    clearDbCache(908701);
    const reopened = (await getDb(908701))!;
    databases.push(reopened);
    const saved = (await reopened.table('config').get('typed-record')).value;
    expect(saved.passwordLastUpdate).toEqual(input.passwordLastUpdate);
    expect(saved.child.bytes).toEqual(input.child.bytes);
    expect(saved.child.count).toBe(4n);
    expect(saved.encryptedPrivateKey).toBe(input.encryptedPrivateKey);
    expect(reopened.verno).toBe(11);
    const blockchain = await getBlockchainDb('CloneBoundaryTest', 'test');
    databases.push(blockchain);
    const target = blockchain.table('assets');
    await target.put(reactive({ ...input, asset: 'test-asset', policy_id: 'test-policy', asset_name: 'test' }));
    expect((await target.toArray())[0].child.bytes).toEqual(input.child.bytes);
  });
});
