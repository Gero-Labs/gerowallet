// The worker's geroStore starts from defaults and is filled by the gero-db
// liveQueries in geroLoader: config first, wallets a few ms later. With a
// non-'us' locale row the config emission is a change, and a config broadcast is
// persisted immediately. That write used to be `{ ...geroStore }` while wallets
// was still `{}`, so a page hydrating from chrome.storage in the ~300 ms before
// the debounced wallets write showed no wallets (onboarding instead of the
// wallet list). First-install locale detection made that the default boot for
// every Spanish or German browser.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';

const env = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const sets: Record<string, unknown>[] = [];
  const local = {
    get: (key: string | string[], cb?: (r: Record<string, unknown>) => void) => {
      const out: Record<string, unknown> = {};
      for (const k of typeof key === 'string' ? [key] : key) {
        if (data.has(k)) out[k] = JSON.parse(JSON.stringify(data.get(k)));
      }
      if (cb) cb(out);
      return Promise.resolve(out);
    },
    set: (items: Record<string, unknown>) => {
      sets.push(JSON.parse(JSON.stringify(items)));
      Object.entries(items).forEach(([k, v]) => data.set(k, JSON.parse(JSON.stringify(v))));
      return Promise.resolve();
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = { storage: { local }, runtime: {} };
  return { sets };
});

vi.mock('@/utils/storageSync', () => ({ getContextType: () => 'background' }));
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { registerSnapshot: vi.fn(), broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('geroStore worker boot persistence', () => {
  it('never persists fewer wallets than the database holds, even with a non-us locale', async () => {
    const { getDb, setConfiguration } = await import('@/db/gero-db');
    const db = await getDb();
    await db.table('wallets').put({ id: 1, name: 'Main', chain: 'Cardano', network: 'Mainnet' });
    await setConfiguration('locale', 'es');

    // background.ts order: config first, then wallets.
    const { loadConfig, loadWallets } = await import('@/plugins/geroLoader');
    await loadConfig();
    await loadWallets();
    await settle(700);

    const writes = env.sets
      .filter((s) => 'geroStore' in s)
      .map((s) => s.geroStore as { wallets: Record<string, unknown>; config: { locale: string } });
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.map((w) => Object.keys(w.wallets).length)).toEqual(writes.map(() => 1));
    expect(writes[writes.length - 1]!.config.locale).toBe('es');
  });
});
