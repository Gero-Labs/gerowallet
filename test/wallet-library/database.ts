import Dexie from 'dexie';
import { wallets } from './fixtures';
const db = new Dexie('wallet-library-browser-fixture');
db.version(1).stores({ wallets: '++id,order', config: '++id,key' });
let initialized: Promise<void> | undefined;
export async function getDb() {
  initialized ||= db.open().then(async () => {
    if (await db.table('wallets').count()) return;
    await db.table('wallets').bulkPut(wallets.map((wallet, order) => ({ ...wallet, order, isFavorite: [1, 3, 4].includes(wallet.id), categoryId: wallet.id < 4 ? 'business' : wallet.id < 7 ? 'personal' : null })));
    await db.table('config').put({ key: 'walletLibrary', value: { categories: [{ id: 'business', name: 'Business', collapsed: false }, { id: 'personal', name: 'Personal', collapsed: false }], uncategorizedCollapsed: false } });
  });
  await initialized;
  return db;
}
