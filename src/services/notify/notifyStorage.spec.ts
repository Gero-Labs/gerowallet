import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrivate, resetPrivateStoreForTest } from '@/utils/privateStore';
import {
  onNotifyKeyChanged,
  privateNotifyStorage,
  readNotifyKey,
  removeNotifyKey,
  requestSettingsTabOnLoad,
  writeNotifyKey,
} from './notifyStorage';
import { createNotifyStore } from './notifyStore';

type Listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => void;
let local: Map<string, unknown>;
let session: Map<string, unknown>;
let listeners: Listener[];

function area(map: Map<string, unknown>, name: string) {
  return {
    get: async (key: string) => (map.has(key) ? { [key]: map.get(key) } : {}),
    set: async (items: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(items)) {
        const oldValue = map.get(k);
        map.set(k, v);
        listeners.forEach((l) => l({ [k]: { oldValue, newValue: v } }, name));
      }
    },
    remove: async (key: string) => { map.delete(key); },
  };
}

beforeEach(async () => {
  local = new Map();
  session = new Map();
  listeners = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: { id: 'ext-id' },
    storage: {
      local: area(local, 'local'),
      session: area(session, 'session'),
      onChanged: {
        addListener: (l: Listener) => listeners.push(l),
        removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l); },
      },
    },
  };
  resetPrivateStoreForTest();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('gero-private-store');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

describe('notification storage', () => {
  it('keeps the wallet links, event key and inbox out of chrome.storage.local', async () => {
    const store = createNotifyStore();
    await store.setWallet(3, {
      walletTag: 'tag', eventKey: 'secret-event-key', network: 'mainnet', stakeAddress: 'stake1u...', paymentCreds: [],
      credsHash: 'h', registeredAt: 1, prefs: null, servedCategories: [], needsProof: false,
    });
    expect(local.size).toBe(0);
    expect((await store.getWallet(3))?.eventKey).toBe('secret-event-key');
    expect(await getPrivate('notifyWallets')).toBeTruthy();
  });

  it('moves an older release\'s copy once, then never reads chrome.storage.local again', async () => {
    local.set('notifyWallets', { '1': { eventKey: 'old' } });
    expect(await readNotifyKey('notifyWallets')).toEqual({ '1': { eventKey: 'old' } });
    expect(local.has('notifyWallets')).toBe(false);

    expect(await readNotifyKey('notifyInbox')).toBeUndefined(); // first read: nothing to move
    local.set('notifyInbox', [{ e: 'x', title: 'Planted', ts: 1, readAt: null, needsYou: true }]);
    expect(await readNotifyKey('notifyInbox')).toBeUndefined();
  });

  it('tells live listeners through session storage, which pages cannot write', async () => {
    const handler = vi.fn();
    const stop = onNotifyKeyChanged('notifyInbox', handler);
    await writeNotifyKey('notifyInbox', []);
    await removeNotifyKey('notifyInbox');
    expect(handler).toHaveBeenCalledTimes(2);

    listeners.forEach((l) => l({ notifyInbox: { newValue: [] } }, 'local')); // a chrome.storage.local write
    expect(handler).toHaveBeenCalledTimes(2);
    stop();
    await writeNotifyKey('notifyInbox', []);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('round-trips through the NotifyStorage adapter', async () => {
    await privateNotifyStorage.set('notifyDevice', { browserEnabled: true });
    expect(await privateNotifyStorage.get('notifyDevice')).toEqual({ browserEnabled: true });
    await privateNotifyStorage.remove('notifyDevice');
    expect(await privateNotifyStorage.get('notifyDevice')).toBeUndefined();
  });

  it('hands the dashboard its settings tab through session storage', async () => {
    await requestSettingsTabOnLoad({ tab: 'notifications', enable: 'notify' });
    expect(session.get('openSettingsOnLoad')).toEqual({ tab: 'notifications', enable: 'notify' });
    expect(local.has('openSettingsOnLoad')).toBe(false);
  });
});
