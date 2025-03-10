import { liveQuery, Subscription } from 'dexie';

export async function loadAssets(
  store: { assets?: any; setAssets?: (assets: any) => void },
  appWallet: any,
  subscriptions: Map<string, Subscription>
): Promise<any> {
  if (!appWallet) return Promise.reject('No appWallet');
  const dbInstance = await appWallet.getBlockchainDb();
  // Initial load
  try {
    const initialAssets = await dbInstance.table('assets').toArray();
    const assetsMap = initialAssets.reduce((map: Record<string, any>, asset: any) => {
      map[asset.asset] = asset;
      return map;
    }, {});
    if (store.setAssets) {
      store.setAssets(assetsMap);
    } else {
      store.assets = assetsMap;
    }
  } catch (error) {
    console.error('Initial load failed for assets:', error);
  }
  // Subscribe to changes
  const sub: Subscription = liveQuery(() =>
    dbInstance.table('assets').toArray()
  ).subscribe({
    next: (newAssets: any[]) => {
      const assetsMap = newAssets.reduce((map: Record<string, any>, asset: any) => {
        map[asset.asset] = asset;
        return map;
      }, {});
      if (store.setAssets) {
        store.setAssets(assetsMap);
      } else {
        store.assets = assetsMap;
      }
    },
    error: (error: any) => {
      console.error('Failed to fetch assets:', error);
    },
  });
  subscriptions.set('assets', sub);
  return store.assets;
}
