// Push notifications — wiring of the notify machine into the service worker.
//
// Handover B2. Everything network- or key-related runs here in the background; the
// UI only sends NOTIFY_* messages (background.ts handlers) and reads getState().
// Composes: notifyStore (chrome.storage.local) + notifyClient (fetch, relay identity,
// chrome.alarms for long retries) + notifyRegistration (the §8 state machine).
//
// Triggers (§8.2): worker start (background.ts, not awaited), the daily
// `notify-reassert` alarm, the `notify-retry` alarm after a long Retry-After,
// `pushsubscriptionchange`, and login. Every one of them obeys the opt-out rule
// inside reassert(): with the browser switch off, nothing subscribes.

import { debugLog } from '@/utils/debug';
import { geroStore } from '@/stores/geroStore';
import { walletManager } from '@/services/walletManager.service';
import { loadOrCreateDeviceIdentity } from '@/services/crossDevice/deviceIdentityStore';
import { loadDeviceRegisterProof } from '@/services/crossDevice/deviceProofStore';
import { createNotifyClient, DEFAULT_NOTIFY_API_URL } from './notifyClient';
import { createNotifyStore, type NotifyDeviceState, type NotifyWalletState } from './notifyStore';
import {
  createNotifyRegistration, isEligibleWallet, NOTIFY_REASSERT_ALARM, NOTIFY_RETRY_ALARM,
  type LoggedWallet, type NotifyRegistration, type PushManagerLike, type ReassertTrigger,
} from './notifyRegistration';
import { notifyHooks } from './notifyHooks';
import { createNotifyPushHandlers, type ToastRequest } from './notifyPush';
import type { RouteIntent } from './notifyRender';
import type { NotifyConfig, WalletPrefsWrite } from './notifyTypes';

interface WorkerRegistration {
  pushManager?: PushManagerLike;
  showNotification?: (title: string, options: NotificationOptions) => Promise<void>;
  getNotifications?: (filter?: { tag?: string }) => Promise<Array<{ close(): void }>>;
}
declare const self: { registration?: WorkerRegistration; addEventListener: (type: string, listener: (event: never) => void) => void } & typeof globalThis;

const log = (m: string) => debugLog('🔔', m);

export const notifyStore = createNotifyStore(undefined, (m, e) => log(`${m}: ${String(e)}`));

const notifyClient = createNotifyClient({
  baseUrl: import.meta.env['VITE_NOTIFY_API_URL'] || DEFAULT_NOTIFY_API_URL,
  fetch: (input, init) => fetch(input, init),
  store: notifyStore,
  identity: () => loadOrCreateDeviceIdentity(),
  // A Retry-After the worker cannot sit through (a nonce-store fence, up to 600 s): one alarm.
  scheduleRetry: (dueAt, reason) => {
    log(`retry scheduled in ${Math.round((dueAt - Date.now()) / 1000)} s (${reason})`);
    chrome.alarms.create(NOTIFY_RETRY_ALARM, { when: dueAt });
  },
  deviceBody: async () => {
    // device_unknown recovery keeps the current target if there is one, else transport none.
    const identity = await loadOrCreateDeviceIdentity();
    const device = await notifyStore.getDevice();
    const sub = device.browserEnabled ? await self.registration?.pushManager?.getSubscription() : null;
    const j = sub?.toJSON();
    return {
      protocol: 1, relayPubKey: identity.pubKeyHex, platform: 'extension', appVersion: chrome.runtime.getManifest().version,
      locale: (await storedLocale()) === 'de' ? 'de' : 'en', osPermission: true,
      transport: j && device.vapidKid ? 'webpush' : 'none',
      ...(j && device.vapidKid ? { webpush: { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, vapidKid: device.vapidKid, expirationTime: j.expirationTime ?? null } } : {}),
    };
  },
  log,
});

async function storedLocale(): Promise<string> {
  try {
    const saved = (await chrome.storage.local.get('geroStore')) as Record<string, { config?: { locale?: string } } | undefined>;
    return saved?.['geroStore']?.config?.locale || 'us';
  } catch { return 'us'; }
}

function loggedWallet(): LoggedWallet | null {
  const bg = walletManager.getWallet();
  if (!bg) return null;
  return {
    id: bg.id, chain: bg.chain, network: bg.network, type: bg.type, stakeAddress: bg.stakeAddress,
    derivePaymentCredentials: () => bg.derivePaymentCredentials(),
  };
}

export const notifyRegistration: NotifyRegistration = createNotifyRegistration({
  client: notifyClient,
  store: notifyStore,
  identity: () => loadOrCreateDeviceIdentity(),
  pushManager: () => self.registration?.pushManager ?? null, // read at call time (e2e patches it)
  appVersion: () => chrome.runtime.getManifest().version,
  locale: storedLocale,
  wallets: async () => Object.values(geroStore.wallets ?? {}).map((w) => ({ id: w.id, chain: w.chain, network: w.network, type: w.type })),
  logged: loggedWallet,
  loadProof: loadDeviceRegisterProof,
  produceProof: (auth) => walletManager.produceDeviceRegisterProof(auth),
  log,
});

/** What the UI (B-M3) and the debug commands read. */
export interface NotifyState {
  device: NotifyDeviceState;
  wallets: Record<string, NotifyWalletState>;
  /** The logged-in wallet's id, whether it can be registered at all, and its wire network. */
  logged: { walletId: number; eligible: boolean; network: string } | null;
  /** Every installed wallet, for the "other wallets" list; `eligible` is judged without a stake address. */
  installed: Array<{ id: number; name: string; chain: string; network: string; type?: string; eligible: boolean }>;
  /** The last /config (cached up to 1 h), or null before any fetch. */
  config: NotifyConfig | null;
  pushSupported: boolean;
}

/** Could this wallet be turned on at all (the stake address is only known once it is open)? */
function installedEligible(w: { chain: string; network: string; type?: string }): boolean {
  return w.chain === 'Cardano' && (w.type === undefined || w.type === 'Normal') && ['Mainnet', 'Preprod', 'Preview'].includes(w.network);
}

export async function getNotifyState(opts: { refreshConfig?: boolean } = {}): Promise<NotifyState> {
  const logged = loggedWallet();
  let config: NotifyConfig | null = (await notifyStore.getConfigCache())?.config ?? null;
  if (opts.refreshConfig) {
    try { config = await notifyClient.getConfig({ force: !config }); } catch (e) { log(`config refresh failed: ${String(e)}`); }
  }
  // The tab opening also pulls GET /device, so a preference another device wrote (iOS) shows here (§4.8).
  if (opts.refreshConfig && (await notifyStore.getDevice()).browserEnabled) {
    await reassert('settings');
    if (logged) await notifyRegistration.refreshPrefs(logged.id).catch((e) => log(`prefs refresh failed: ${String(e)}`));
  }
  return {
    device: await notifyStore.getDevice(),
    wallets: await notifyStore.getWallets(),
    logged: logged ? { walletId: logged.id, eligible: isEligibleWallet(logged), network: `cardano-${logged.network.toLowerCase()}` } : null,
    installed: Object.values(geroStore.wallets ?? {}).map((w) => ({ id: w.id, name: w.name, chain: w.chain, network: w.network, type: w.type, eligible: installedEligible(w) })),
    config,
    pushSupported: !!self.registration?.pushManager,
  };
}

let running: Promise<unknown> | null = null;
/** Serialise re-assertions: a login racing the start-up run must not double-register. */
export function reassert(trigger: ReassertTrigger): Promise<void> {
  const run = (running ?? Promise.resolve()).then(() => notifyRegistration.reassert(trigger)).then((r) => log(`reassert(${trigger}) -> ${r}`), (e) => log(`reassert(${trigger}) threw ${String(e)}`));
  running = run;
  return run;
}

let credentialsTimer: ReturnType<typeof setTimeout> | null = null;
notifyHooks.credentialsChanged = () => {
  if (credentialsTimer) clearTimeout(credentialsTimer);
  credentialsTimer = setTimeout(() => {
    credentialsTimer = null;
    notifyRegistration.credentialsChanged().catch((e) => log(`credentialsChanged failed: ${String(e)}`));
  }, 5_000);
};

// ---- push handling (B3, B4, B5, B8) ------------------------------------------

async function storedWalletName(walletId: number): Promise<string> {
  try {
    const saved = (await chrome.storage.local.get('geroStore')) as Record<string, { wallets?: Record<string, { name?: string }> } | undefined>;
    return saved?.['geroStore']?.wallets?.[String(walletId)]?.name || 'Wallet';
  } catch { return 'Wallet'; }
}

async function storedLoggedWalletId(): Promise<number | null> {
  try {
    const saved = (await chrome.storage.local.get('walletStore')) as Record<string, { loggedWallet?: { id?: number } | null } | undefined>;
    const id = saved?.['walletStore']?.loggedWallet?.id;
    return typeof id === 'number' ? id : null;
  } catch { return null; }
}

/** NOTIFY_PRESENT to every open extension page; true when one rendered the toast within 250 ms. */
function presentToPages(request: ToastRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 250);
    try {
      chrome.runtime.sendMessage({ method: 'NOTIFY_PRESENT', data: request, target: 'gerowallet', sender: 'extension' }, (reply?: { shown?: boolean }) => {
        clearTimeout(timer);
        void chrome.runtime.lastError; // no receiver: nothing is open
        resolve(reply?.shown === true);
      });
    } catch { clearTimeout(timer); resolve(false); }
  });
}

/** B4: focus the dashboard tab on the route, or open one. The side panel route waits on B0's click test. */
async function openDashboard(route: RouteIntent): Promise<void> {
  if (route.settingsTab) await chrome.storage.local.set({ openSettingsOnLoad: { tab: route.settingsTab } });
  const base = chrome.runtime.getURL('index.html');
  const url = `${base}#${route.dashboard}`;
  const tabs = await chrome.tabs.query({ url: `${base}*` });
  const existing = tabs.find((t) => typeof t.id === 'number');
  if (existing && typeof existing.id === 'number') {
    await chrome.tabs.update(existing.id, { active: true, url });
    if (typeof existing.windowId === 'number') await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url });
}

export const notifyPushHandlers = createNotifyPushHandlers({
  store: notifyStore,
  showNotification: async (title, options) => { await self.registration?.showNotification?.(title, options); },
  closeNotifications: async (tag) => { for (const n of (await self.registration?.getNotifications?.({ tag })) ?? []) n.close(); },
  presentToPages,
  locale: storedLocale,
  walletName: storedWalletName,
  loggedWalletId: storedLoggedWalletId,
  openDashboard,
  iconUrl: chrome.runtime.getURL('public/logo128.png'),
  log,
});

/**
 * Top-level, synchronous: an MV3 worker woken by a push only sees listeners added in
 * the first turn. Feature-detected: the Firefox build has no service-worker registration.
 * `push` starts its work BEFORE waitUntil (a synthetic PushEvent has no usable one).
 */
export function installNotifyListeners(): void {
  if (!self.registration?.pushManager) return;
  self.addEventListener('push', ((event: { data?: { text(): string } | null; waitUntil?: (p: Promise<unknown>) => void }) => {
    const p = notifyPushHandlers.handlePush(event.data ? event.data.text() : null).then(() => undefined, (e) => log(`push handler failed: ${String(e)}`));
    try { event.waitUntil?.(p); } catch { /* synthetic event */ }
  }) as (event: never) => void);
  self.addEventListener('notificationclick', ((event: { notification: { data?: unknown; tag?: string; close(): void }; waitUntil?: (p: Promise<unknown>) => void }) => {
    const p = notifyPushHandlers.handleNotificationClick(event.notification).then(() => undefined, (e) => log(`notificationclick failed: ${String(e)}`));
    try { event.waitUntil?.(p); } catch { /* synthetic event */ }
  }) as (event: never) => void);
  self.addEventListener('pushsubscriptionchange', ((event: { waitUntil?: (p: Promise<unknown>) => void }) => {
    const p = reassert('pushsubscriptionchange');
    try { event.waitUntil?.(p); } catch { /* not extendable */ }
  }) as (event: never) => void);
  chrome.alarms.create(NOTIFY_REASSERT_ALARM, { delayInMinutes: 24 * 60, periodInMinutes: 24 * 60 });
}

/** chrome.alarms.onAlarm: returns true when the alarm was one of ours. */
export function onNotifyAlarm(name: string): boolean {
  if (name === NOTIFY_REASSERT_ALARM) { void reassert('alarm'); return true; }
  if (name === NOTIFY_RETRY_ALARM) { void reassert('retry'); return true; }
  return false;
}

export const notifyActions = {
  setBrowserEnabled: (enabled: boolean) => notifyRegistration.setBrowserEnabled(enabled),
  enableWallet: (auth?: { password?: string; privateKeyBytes?: Uint8Array }) => notifyRegistration.enableWallet(auth),
  disableWallet: (walletId: number) => notifyRegistration.disableWallet(walletId),
  setPrefs: (walletId: number, write: WalletPrefsWrite) => notifyRegistration.setPrefs(walletId, write),
  walletRemoved: (walletId: number) => notifyRegistration.walletRemoved(walletId),
};
