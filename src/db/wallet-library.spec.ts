import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
vi.mock('./gero-db', () => ({ getDb: vi.fn() }));
import { createWalletLibraryRepository } from './wallet-library';
import { LIBRARY_CONFIG_KEY } from '@/services/walletLibrary/model';

let db: Dexie;
let repo: ReturnType<typeof createWalletLibraryRepository>;
beforeEach(async () => {
  db = new Dexie('library-test-' + crypto.randomUUID());
  db.version(1).stores({ wallets: '++id,order', config: '++id,key' });
  await db.open();
  await db.table('wallets').bulkPut([
    { id: 1, name: 'Treasury', order: 0, encryptedPrivateKey: 'untouched', publicKey: 'public' },
    { id: 2, name: 'Operations', order: 1 }, { id: 3, name: 'Personal', order: 2 },
  ]);
  repo = createWalletLibraryRepository(async () => db);
});
afterEach(async () => { await db.delete(); });

describe('wallet library persistence', () => {
  it('reads legacy wallets without requiring a migration and does not expose key fields', async () => {
    const state = await repo.read();
    expect(state.preferences).toEqual({ categories: [], uncategorizedCollapsed: false });
    expect(state.wallets).toHaveLength(3);
    expect(state.wallets[0]).not.toHaveProperty('encryptedPrivateKey');
    expect(state.wallets[0]).not.toHaveProperty('publicKey');
  });
  it('saves a new order and preserves unrelated wallet data', async () => {
    await repo.moveWallet(3, null, 1);
    expect((await db.table('wallets').orderBy('order').toArray()).map(row => row.id)).toEqual([3, 1, 2]);
    expect(await db.table('wallets').get(1)).toMatchObject({ encryptedPrivateKey: 'untouched', name: 'Treasury' });
  });
  it('persists favorites without losing concurrent order changes', async () => {
    await Promise.all([repo.setFavorite(1, true), repo.moveWallet(1, null)]);
    expect(await db.table('wallets').get(1)).toMatchObject({ isFavorite: true, order: 2 });
    const reopened = createWalletLibraryRepository(async () => db);
    expect((await reopened.read()).wallets.find(wallet => wallet.id === 1)?.isFavorite).toBe(true);
  });
  it('moves between categories and appends after the last wallet in the destination', async () => {
    await repo.saveCategory(null, 'Work');
    const category = (await repo.read()).preferences.categories[0];
    await repo.setCollapsed(category.id, true);
    await repo.moveWallet(2, category.id);
    expect((await repo.read()).preferences.categories[0].collapsed).toBe(false);
    await repo.moveWallet(3, category.id, 2);
    expect((await db.table('wallets').orderBy('order').toArray()).filter(row => row.categoryId === category.id).map(row => row.id)).toEqual([3, 2]);
  });
  it('deleting a category reassigns wallets without deleting them or changing favorite status', async () => {
    await repo.saveCategory(null, 'Work');
    const { id } = (await repo.read()).preferences.categories[0];
    await repo.moveWallet(1, id);
    await repo.setFavorite(1, true);
    await repo.deleteCategory(id);
    expect(await db.table('wallets').count()).toBe(3);
    expect(await db.table('wallets').get(1)).toMatchObject({ categoryId: null, isFavorite: true, encryptedPrivateKey: 'untouched' });
  });
  it('validates category names, rejects duplicates and retains collapse state on rename', async () => {
    await repo.saveCategory(null, '  Work  ');
    const { id } = (await repo.read()).preferences.categories[0];
    await expect(repo.saveCategory(null, 'work')).rejects.toThrow('duplicateName');
    await expect(repo.saveCategory(null, ' ')).rejects.toThrow('invalidName');
    await expect(repo.saveCategory(null, 'x'.repeat(49))).rejects.toThrow('invalidName');
    await repo.setCollapsed(id, true);
    await repo.saveCategory(id, 'Business');
    expect((await repo.read()).preferences.categories).toEqual([{ id, name: 'Business', collapsed: true }]);
    await repo.setCollapsed(null, true);
    expect((await repo.read()).preferences.uncategorizedCollapsed).toBe(true);
  });
  it('rolls back moves to a deleted category or missing target wallet', async () => {
    const before = await db.table('wallets').toArray();
    await expect(repo.moveWallet(1, 'missing')).rejects.toThrow('missingCategory');
    await expect(repo.moveWallet(1, null, 999)).rejects.toThrow('missingWallet');
    expect(await db.table('wallets').toArray()).toEqual(before);
  });
  it('keeps unrelated preferences when saving wallet organization', async () => {
    await db.table('config').put({ key: 'locale', value: 'de' });
    await repo.saveCategory(null, 'Work');
    expect((await db.table('config').where('key').equals('locale').first()).value).toBe('de');
    expect(await db.table('config').where('key').equals(LIBRARY_CONFIG_KEY).count()).toBe(1);
  });
  it('reads fresh data from another connection rather than overwriting its changes', async () => {
    const other = new Dexie(db.name);
    other.version(1).stores({ wallets: '++id,order', config: '++id,key' });
    await other.open();
    try {
      await other.table('wallets').update(1, { name: 'Renamed elsewhere' });
      await repo.setFavorite(1, true);
      expect(await db.table('wallets').get(1)).toMatchObject({ name: 'Renamed elsewhere', isFavorite: true });
    } finally { other.close(); }
  });
});
