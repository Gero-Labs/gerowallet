import { liveQuery, Subscription } from 'dexie';

export async function loadSync(
  store: { latestTip: any },
  appWallet: any
): Promise<void> {
  if (!appWallet) return Promise.reject('No appWallet');
  const dbInstance = await appWallet.getDb();
  // Initial load
  try {
    store.latestTip = await dbInstance.table('sync').orderBy('height').last();
  } catch (error) {
    console.error('Initial load failed for sync:', error);
  }
}

export async function subscribeSync(
  store: { latestTip: any },
  appWallet: any,
  subscriptions: Map<string, Subscription>
): Promise<void> {
  if (!appWallet) return Promise.reject('No appWallet');
  if (!subscriptions.has('sync')) {
    const dbInstance = await appWallet.getDb();
    const sub: Subscription = liveQuery(() =>
      dbInstance.table('sync').orderBy('height').last()
    ).subscribe({
      next: (newTip: any) => {
        store.latestTip = newTip;
      },
      error: (error: any) => {
        console.error('Failed to fetch sync tip:', error);
      },
    });
    subscriptions.set('sync', sub);
  }
}
