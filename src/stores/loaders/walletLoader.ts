import { liveQuery, Subscription } from 'dexie';
import db from '@/db';

export async function loadWallets(
  store: { wallets: any[] }
): Promise<void> {
  try {
    store.wallets = await db.getAllWallets();
  } catch (error) {
    console.error('Initial load failed for wallets:', error);
  }
}

export async function subscribeWallets(
  store: { wallets: any[] },
  subscriptions: Map<string, Subscription>
) {
  if (!subscriptions.has('wallets')) {
    const sub: Subscription = liveQuery(() => db.getAllWallets()).subscribe({
      next: (wallets: any[]) => {
        store.wallets = wallets;
      },
      error: (error: any) => {
        console.error('Failed to get all Wallets:', error);
      },
    });
    subscriptions.set('wallets', sub);
  }
}
