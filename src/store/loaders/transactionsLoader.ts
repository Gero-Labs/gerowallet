import { liveQuery, Subscription } from 'dexie';

export async function loadTransactions(
  store: { transactions: any; setUtxosAndAddresses?: (txs: any) => Promise<void> },
  appWallet: any,
): Promise<void> {
  if (!appWallet) return Promise.reject('No appWallet');
  const dbInstance = await appWallet.getDb();
  // Initial load
  try {
    const initialTxs = await dbInstance.table('transactions').toArray();
    const newT = initialTxs.map((tx: any) => tx.transaction);
    store.transactions = newT;
    if (store.setUtxosAndAddresses) {
      await store.setUtxosAndAddresses(newT);
    }
  } catch (error) {
    console.error('Initial load failed for transactions:', error);
  }
}

export async function subscribeTransactions(
  store: { transactions: any; setUtxosAndAddresses?: (txs: any) => Promise<void> },
  appWallet: any,
  subscriptions: Map<string, Subscription>
): Promise<void> {
  if (!appWallet) return Promise.reject('No appWallet');
  if (!subscriptions.has('transactions')) {
    const dbInstance = await appWallet.getDb();
    const sub: Subscription = liveQuery(() =>
      dbInstance.table('transactions').toArray()
    ).subscribe({
      next: async (newTransactions: any[]) => {
        const newT = newTransactions.map((tx: any) => tx.transaction);
        store.transactions = newT;
        if (store.setUtxosAndAddresses) {
          await store.setUtxosAndAddresses(newT);
        }
      },
      error: (error: any) => {
        console.error('Failed to fetch transactions:', error);
      },
    });
    subscriptions.set('transactions', sub);
  }
}
