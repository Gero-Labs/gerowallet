import type Dexie from 'dexie';
import { getDb } from '@/db/gero-db';
import type { Wallet } from '@/models/types';
import { favoriteWallet, moveWalletOrder, LIBRARY_CONFIG_KEY, normalizePreferences, WalletLibraryError } from '@/services/walletLibrary/model';
import type { WalletLibraryPreferences, WalletOrganization } from '@/services/walletLibrary/model';

export { WalletLibraryError } from '@/services/walletLibrary/model';

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
      if (JSON.stringify(record?.value) !== JSON.stringify(preferences)) {
        await db.table('config').put({ ...record, key: LIBRARY_CONFIG_KEY, value: preferences });
      }
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
      const db = await provideDb();
      await db.transaction('rw', db.table('wallets'), async () => {
        const wallet = await db.table<Wallet>('wallets').get(id);
        if (!wallet) throw new WalletLibraryError('missingWallet');
        const first = await db.table<Wallet>('wallets').orderBy('order').first();
        const updated = favoriteWallet(first && first.id !== id ? [wallet, first] : [wallet], id, favorite).find(row => row.id === id)!;
        await db.table('wallets').update(id, { isFavorite: updated.isFavorite, order: updated.order });
      });
    },
    async moveWallet(id: number, categoryId: string | null | undefined, beforeId: number | null = null, favorite?: boolean) {
      await mutate(async (db, preferences) => {
        const wallets = await db.table<Wallet>('wallets').toArray();
        const updated = moveWalletOrder(wallets, preferences, id, categoryId, beforeId, favorite);
        const previous = new Map(wallets.map(wallet => [wallet.id, wallet]));
        await Promise.all(updated.filter(wallet => {
          const old = previous.get(wallet.id)!;
          return old.order !== wallet.order || old.categoryId !== wallet.categoryId || old.isFavorite !== wallet.isFavorite;
        }).map(wallet => db.table('wallets').update(wallet.id,
          { order: wallet.order, categoryId: wallet.categoryId, isFavorite: wallet.isFavorite })));
        if (categoryId === null) preferences.uncategorizedCollapsed = false;
        else if (categoryId !== undefined) preferences.categories.find(category => category.id === categoryId)!.collapsed = false;
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
