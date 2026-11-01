// Where the push-notification state lives: the extension's private store
// (privateStore.ts, extension-origin IndexedDB), not chrome.storage.local.
//
// chrome.storage.local is readable and writable by every content script, Gero's own
// and the Bring SDK inside it, in every frame of every tab. The notification state
// links this browser's wallets (stake addresses, the per-wallet event key), holds the
// bell's inbox, and carries intents the dashboard acts on (open another wallet, the
// intro prompt). From there a page could read the links or plant an inbox row in
// "Needs you". Content scripts cannot open the private store.
//
// IndexedDB raises no change events, and pages mirror some of these keys live (the
// bell, the pending-open prompt, the intro prompt). Every write therefore also bumps
// a small marker in chrome.storage.session, which only the extension's own pages and
// worker can see, and listeners re-read the key from the private store.
//
// Each key moves out of chrome.storage.local once (moveFromChromeLocal); a value a
// page writes there later is never read.

import { moveFromChromeLocal, removePrivate, setPrivate } from '@/utils/privateStore';
import type { NotifyStorage } from './notifyStore';

const SIGNAL_PREFIX = 'notifyChanged:';

async function signal(key: string): Promise<void> {
  try {
    await chrome.storage.session.set({ [SIGNAL_PREFIX + key]: Date.now() });
  } catch {
    // No live listener gets told; the value itself is written.
  }
}

export function readNotifyKey<T = unknown>(key: string): Promise<T | undefined> {
  return moveFromChromeLocal<T>(key);
}

export async function writeNotifyKey(key: string, value: unknown): Promise<void> {
  await setPrivate(key, JSON.parse(JSON.stringify(value)));
  await signal(key);
}

export async function removeNotifyKey(key: string): Promise<void> {
  await removePrivate(key);
  await signal(key);
}

/** Call `handler` whenever `key` is written or removed. Returns the unsubscribe function. */
export function onNotifyKeyChanged(key: string, handler: () => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'session' && (SIGNAL_PREFIX + key) in changes) handler();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export const privateNotifyStorage: NotifyStorage = {
  get: (key) => readNotifyKey(key),
  set: (key, value) => writeNotifyKey(key, value),
  remove: (key) => removeNotifyKey(key),
};

// A one-shot UI handoff ("open this settings tab"): session storage, so a page cannot plant it.
export const OPEN_SETTINGS_ON_LOAD_KEY = 'openSettingsOnLoad';

export async function requestSettingsTabOnLoad(value: true | { tab: string; enable?: string }): Promise<void> {
  try {
    await chrome.storage.session.set({ [OPEN_SETTINGS_ON_LOAD_KEY]: value });
  } catch {
    // The dashboard just opens on its default view.
  }
}
