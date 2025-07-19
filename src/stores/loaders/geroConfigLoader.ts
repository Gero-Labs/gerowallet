import { liveQuery, Subscription } from 'dexie';
import db from '@/db';

export async function loadConfig(store: { geroConfig: any }): Promise<void> {
  try {
    store.geroConfig = await db.getGeroConfig();
  } catch (error) {
    console.error('Initial load failed for Gero Config:', error);
  }
}

export async function subscribeConfig(
  store: { geroConfig: any },
  subscriptions: Map<string, Subscription>
) {
  if (!subscriptions.has('geroConfig')) {
    const sub: Subscription = liveQuery(() => db.getGeroConfig()).subscribe({
      next: (geroConfig: any) => {
        store.geroConfig = geroConfig;
      },
      error: (error: any) => {
        console.error('Failed to get geroConfig:', error);
      },
    });
    subscriptions.set('geroConfig', sub);
  }
}
