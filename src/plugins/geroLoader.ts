import Dexie, { liveQuery, Subscription } from 'dexie';
import { getDb } from '@/db/gero-db';
import GeroStore from '@/stores/geroStore';
import { Wallet } from '@/models/types';

const subscriptions: Map<string, Subscription> = new Map();

export async function loadWallets() {
  const geroDb: Dexie = await getDb();
  return new Promise((resolve, reject) => {
    subscriptions.set('wallets', liveQuery(() => geroDb.table('wallets').toArray()).subscribe({
      next: wallets => {
        GeroStore.setWallets(wallets.reduce((map: Record<number, Wallet>, wallet: Wallet) => {
          map[wallet.id] = wallet;
          return map;
        }, {}))
        resolve(wallets)
      },
      error: error => {
        console.error('Failed to Fetch Wallets:', error)
        reject(error)
      }
    }));
  });
}

export async function loadConfig() {
  const geroDb: Dexie = await getDb();
  return new Promise((resolve, reject) => {
    subscriptions.set('config', liveQuery(() => geroDb.table('config').toArray()).subscribe({
      next: config => {
        GeroStore.setConfig(config.reduce(function(map, val) {
          map[val.key] = val.value
          return map
        }, {}));
        resolve(config)
      },
      error: error => {
        console.error('Failed to Fetch Config:', error)
        reject(error)
      }
    }));
  });
}
