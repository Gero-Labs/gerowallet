import type Dexie from 'dexie';
import { getDb } from '@/db/gero-db';
import type { Wallet } from '@/models/types';
import { categoryFor, LIBRARY_CONFIG_KEY, normalizePreferences, sortWallets } from '@/services/walletLibrary/model';
import type { WalletLibraryPreferences, WalletOrganization } from '@/services/walletLibrary/model';

export class WalletLibraryError extends Error {
  constructor(public code: 'duplicateName' | 'invalidName' | 'missingWallet' | 'missingCategory') { super(code); }
}

// Reuse the existing wallet order and config tables. These display-only fields
// need no new indexes or schema migration. Every mutation reads the latest rows
// inside a Dexie transaction, including changes made in another extension tab.
export function createWalletLibraryRepository(provideDb: () => Promise<Dexie>) {
  const mutate = async (change: (db: Dexie, preferences: WalletLibraryPreferences) => Promise<void>) => {
    const db = await provideDb();
    await db.transaction('rw', db.table('wallets'), db.table('config'), async () => {
      const record = await db.table('config').where('key').equals(LIBRARY_CONFIG_KEY).first();
      const preferences = normalizePreferences(record?.value);
      await change(db, preferences);
      await db.table('config').put({ ...record, key: LIBRARY_CONFIG_KEY, value: preferences });
    });
  };
  const validateCategory = (preferences: WalletLibraryPreferences, id: string | null) => {
    if (id !== null && !preferences.categories.some(category => category.id === id)) throw new WalletLibraryError('missingCategory');
  };
  return {
    async initialize() { await provideDb(); },
    async read(): Promise<{ preferences: WalletLibraryPreferences; wallets: WalletOrganization[] }> {
      const db = await provideDb();
      return db.transaction('r', db.table('wallets'), db.table('config'), async () => {
        const record = await db.table('config').where('key').equals(LIBRARY_CONFIG_KEY).first();
        const wallets = await db.table<Wallet>('wallets').toArray();
        return { preferences: normalizePreferences(record?.value),
          wallets: wallets.map(({ id, order, isFavorite, categoryId }) => ({ id, order, isFavorite, categoryId })) };
      });
    },
    async setFavorite(id: number, favorite: boolean) {
      await mutate(async db => {
        if (!await db.table('wallets').update(id, { isFavorite: favorite })) throw new WalletLibraryError('missingWallet');
      });
    },
    async moveWallet(id: number, categoryId: string | null, beforeId: number | null = null) {
      await mutate(async (db, preferences) => {
        validateCategory(preferences, categoryId);
        const wallets = sortWallets(await db.table<Wallet>('wallets').toArray());
        const moving = wallets.find(wallet => wallet.id === id);
        if (!moving) throw new WalletLibraryError('missingWallet');
        if (beforeId === id) return;
        const remaining = wallets.filter(wallet => wallet.id !== id);
        let index = remaining.length;
        if (beforeId !== null) {
          index = remaining.findIndex(wallet => wallet.id === beforeId && categoryFor(wallet, preferences) === categoryId);
          if (index < 0) throw new WalletLibraryError('missingWallet');
        } else {
          const last = remaining.map(wallet => categoryFor(wallet, preferences)).lastIndexOf(categoryId);
          if (last >= 0) index = last + 1;
        }
        remaining.splice(index, 0, { ...moving, categoryId });
        // Reveal the destination in the same transaction as the move.
        if (categoryId === null) preferences.uncategorizedCollapsed = false;
        else preferences.categories.find(category => category.id === categoryId)!.collapsed = false;
        await Promise.all(remaining.map((wallet, order) => db.table('wallets').update(wallet.id,
          wallet.id === id ? { order, categoryId } : { order })));
      });
    },
    async saveCategory(id: string | null, input: string) {
      const name = input.trim();
      if (!name || name.length > 48) throw new WalletLibraryError('invalidName');
      await mutate(async (_db, preferences) => {
        if (preferences.categories.some(category => category.id !== id && category.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
          throw new WalletLibraryError('duplicateName');
        }
        if (id) {
          validateCategory(preferences, id);
          preferences.categories.find(category => category.id === id)!.name = name;
        } else preferences.categories.push({ id: crypto.randomUUID(), name, collapsed: false });
      });
    },
    async deleteCategory(id: string) {
      await mutate(async (db, preferences) => {
        validateCategory(preferences, id);
        preferences.categories = preferences.categories.filter(category => category.id !== id);
        await db.table<Wallet>('wallets').filter(wallet => wallet.categoryId === id).modify({ categoryId: null });
      });
    },
    async setCollapsed(id: string | null, collapsed: boolean) {
      await mutate(async (_db, preferences) => {
        validateCategory(preferences, id);
        if (id === null) preferences.uncategorizedCollapsed = collapsed;
        else preferences.categories.find(category => category.id === id)!.collapsed = collapsed;
      });
    },
  };
}
export const walletLibraryRepository = createWalletLibraryRepository(getDb);
