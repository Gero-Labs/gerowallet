// No secrets in chrome.storage.local, and no trust in what comes back from it,
// driven through the real walletStore and geroStore modules.
//
// Every content script can read and rewrite chrome.storage.local: Gero's own, in
// every frame of every tab, and the third-party Bring SDK inside it. So the encrypted
// root keys, recovery phrases, PassKey/MPC blobs and unlock hashes stay out of it,
// the extension's pages still get them (port snapshot, private IndexedDB copy), and
// the worker never logs in, unlocks or answers a dApp from a value planted there.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const env = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const pendingGets: Array<() => void> = [];
  const local = {
    holdGets: false,
    get: (key: string | string[], cb?: (r: Record<string, unknown>) => void) => {
      const read = () => {
        const out: Record<string, unknown> = {};
        for (const k of typeof key === 'string' ? [key] : key) {
          if (data.has(k)) out[k] = JSON.parse(JSON.stringify(data.get(k)));
        }
        return out;
      };
      if (cb) {
        if (local.holdGets) pendingGets.push(() => cb(read()));
        else cb(read());
        return undefined;
      }
      return Promise.resolve(read());
    },
    set: async (items: Record<string, unknown>) => {
      Object.entries(items).forEach(([k, v]) => data.set(k, JSON.parse(JSON.stringify(v))));
    },
    remove: async () => undefined,
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local },
    alarms: { getAll: (cb: (a: unknown[]) => void) => cb([]), clear: () => {} },
    runtime: {},
  };
  return {
    data,
    local,
    pendingGets,
    context: 'background' as 'background' | 'browser',
    snapshots: new Map<string, () => Record<string, unknown>>(),
    subscribers: new Map<string, (u: Record<string, unknown>) => void>(),
  };
});

vi.mock('@/utils/storageSync', () => ({ getContextType: () => env.context }));
vi.mock('@/chrome/storeMessagingBg', () => ({
  default: {
    registerSnapshot: (store: string, read: () => Record<string, unknown>) => env.snapshots.set(store, read),
    broadcastUpdate: () => undefined,
  },
}));
vi.mock('@/services/storeMessaging.service', () => ({
  default: {
    subscribe: (store: string, cb: (u: Record<string, unknown>) => void) => {
      env.subscribers.set(store, cb);
      return () => env.subscribers.delete(store);
    },
  },
}));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: () => Promise.resolve(), disconnect: () => {} } }));

const SEALED = {
  encryptedPrivateKey: 'SEALED-root-key',
  encryptedMnemonic: 'SEALED-mnemonic',
  prfEncryptedPrivateKey: 'SEALED-prf-key',
  prfEncryptedMnemonic: 'SEALED-prf-mnemonic',
  prfSpendingPassword: 'SEALED-prf-hash',
  mpcDeviceShare: 'SEALED-share',
};
const WALLET = { id: 1, name: 'Main', chain: 'Cardano', network: 'Preprod', publicKey: 'xpub-real', encryptionMethod: 'prf', webAuthnCredentialId: 'cred', ...SEALED };
const SECRET_CONFIG = { pinHash: 'SEALED-pin', encryptedPatternHash: 'SEALED-pattern', lockPasswordHash: 'SEALED-lock', encryptedTotpSecret: 'SEALED-totp', passKeyEncryptedSpendingPassword: 'SEALED-pw' };

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

/** A profile an older release ran on: nothing in this release's private store. */
async function wipePrivateStore() {
  (await import('@/utils/privateStore')).resetPrivateStoreForTest();
  await deleteDatabase('gero-private-store');
}

/** A fresh module graph = a restarted worker (or a newly opened page) over the same storage. */
async function start(context: 'background' | 'browser') {
  env.context = context;
  vi.resetModules();
  return import('./walletStore');
}

beforeEach(async () => {
  (await import('@/utils/storeCache')).resetStoreCacheForTest();
  await deleteDatabase('gero-store-cache');
  await wipePrivateStore();
  env.data.clear();
  env.snapshots.clear();
  env.subscribers.clear();
  env.local.holdGets = false;
  env.pendingGets.length = 0;
});

describe('walletStore and chrome.storage.local', () => {
  it('persists the logged wallet and config without their secrets, while the pages still get them', async () => {
    const w = await start('background');
    await w.hydrateWalletStore();
    w.default.setLoggedWallet({ ...WALLET });
    w.default.setConfig({ currency: 'usd', ...SECRET_CONFIG });
    await settle();
    await w.flushWalletStorePersistence();

    const record = JSON.stringify(env.data.get('walletStore'));
    expect(record).not.toContain('SEALED');
    expect((env.data.get('walletStore') as { loggedWallet: unknown }).loggedWallet).toMatchObject({ id: 1, publicKey: 'xpub-real', webAuthnCredentialId: 'cred' });
    // The extension's pages: the port snapshot carries the full record.
    expect(env.snapshots.get('walletStore')!()['loggedWallet']).toMatchObject(SEALED);

    // A page with no port (the PassKey popup) gets it from the private copy.
    const page = await start('browser');
    await page.hydrateWalletStore();
    expect(page.walletStore.loggedWallet).toMatchObject({ id: 1, ...SEALED });
  });

  it('keeps the secret config rows out of the store altogether (ConfigLoader)', async () => {
    const { configRowsToMap } = await import('@/db/loaders/walletLoader');
    const rows = Object.entries({ currency: 'usd', ...SECRET_CONFIG, spo_nodes: '[{"authToken":"SEALED"}]', submitApiAuth: 'SEALED' })
      .map(([key, value]) => ({ key, value }));
    expect(configRowsToMap(rows)).toEqual({ currency: 'usd' });
  });

  it('rewrites a record an older release left with the secrets in it', async () => {
    env.data.set('walletStore', { loggedWallet: { ...WALLET }, isLocked: true, config: { currency: 'eur', ...SECRET_CONFIG }, connectedDapps: [] });
    const w = await start('background');
    await w.hydrateWalletStore();
    expect(w.walletStore.loggedWallet).toMatchObject(SEALED); // still usable this session
    await settle();
    await w.flushWalletStorePersistence();

    const record = env.data.get('walletStore') as { loggedWallet: unknown; isLocked: boolean; config: Record<string, unknown> };
    expect(JSON.stringify(record)).not.toContain('SEALED');
    expect(record.isLocked).toBe(true);
    expect(record.config['currency']).toBe('eur');
  });

  it('a restarted worker ignores a logged wallet or lock state planted in chrome.storage', async () => {
    const w = await start('background');
    await w.hydrateWalletStore();
    w.default.setLoggedWallet({ ...WALLET });
    w.default.setLocked(true);
    await settle();
    await w.flushWalletStorePersistence();

    // A content script points the record at another key and unlocks it.
    const record = env.data.get('walletStore') as Record<string, unknown>;
    env.data.set('walletStore', { ...record, loggedWallet: { id: 1, name: 'Main', chain: 'Cardano', publicKey: 'xpub-PLANTED', baseAddress: 'addr_PLANTED' }, isLocked: false });

    const restarted = await start('background');
    await restarted.hydrateWalletStore();
    expect(restarted.walletStore.loggedWallet).toMatchObject({ publicKey: 'xpub-real', ...SEALED });
    expect(restarted.walletStore.loggedWallet.baseAddress).toBeUndefined();
    expect(restarted.walletStore.isLocked).toBe(true);
  });

  it('a restarted worker answers dApps from the wallet database, not a whitelist planted in chrome.storage', async () => {
    const { addConnectedDapp } = await import('@/db/wallet-db');
    await addConnectedDapp(1, 'https://good.example');
    const w = await start('background');
    await w.hydrateWalletStore();
    w.default.setLoggedWallet({ ...WALLET });
    await settle();
    await w.flushWalletStorePersistence();
    const record = env.data.get('walletStore') as Record<string, unknown>;
    env.data.set('walletStore', { ...record, connectedDapps: [{ id: 99, domain: 'https://evil.example' }] });

    const restarted = await start('background');
    await restarted.hydrateWalletStore();
    expect(restarted.default.isWhitelisted('https://evil.example')).toBe(false);
    expect(restarted.default.isWhitelisted('https://good.example')).toBe(true);
  });
});

describe('geroStore and chrome.storage.local', () => {
  async function workerWithWallet() {
    const { getDb } = await import('@/db/gero-db');
    await (await getDb()).table('wallets').put({ ...WALLET });
    env.context = 'background';
    vi.resetModules();
    const { loadWallets } = await import('@/plugins/geroLoader');
    await loadWallets();
    await settle(600);
  }

  beforeEach(async () => {
    await deleteDatabase('GeroWalletDatabase');
  });

  it('persists the wallet list without secrets, and hands the full records to the pages', async () => {
    await workerWithWallet();

    const record = env.data.get('geroStore') as { wallets: Record<string, Record<string, unknown>> };
    expect(JSON.stringify(record)).not.toContain('SEALED');
    expect(record.wallets['1']).toMatchObject({ id: 1, name: 'Main', publicKey: 'xpub-real', webAuthnCredentialId: 'cred' });
    const snapshot = env.snapshots.get('geroStore')!() as { wallets: Record<string, unknown> };
    expect(snapshot.wallets['1']).toMatchObject(SEALED);
  });

  it('replaces a record an older release wrote with the secrets in it', async () => {
    env.data.set('geroStore', { wallets: { 1: { ...WALLET } }, config: { locale: 'us' } });
    await workerWithWallet();
    expect(JSON.stringify(env.data.get('geroStore'))).not.toContain('SEALED');
  });

  it('a page keeps the full records the port delivered over the redacted chrome.storage copy', async () => {
    await workerWithWallet();
    env.local.holdGets = true;
    env.context = 'browser';
    vi.resetModules();
    const { geroStore } = await import('./geroStore');

    env.subscribers.get('geroStore')!({ wallets: { 1: { ...WALLET } } });
    env.pendingGets.splice(0).forEach((deliver) => deliver());

    expect(geroStore.wallets[1]).toMatchObject(SEALED);
  });
});
