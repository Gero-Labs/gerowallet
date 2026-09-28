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
import type { WalletPrefsWrite } from './notifyTypes';

declare const self: { registration?: { pushManager?: PushManagerLike } } & typeof globalThis;

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
  /** The logged-in wallet's id and whether it can be registered at all. */
  logged: { walletId: number; eligible: boolean } | null;
  pushSupported: boolean;
}

export async function getNotifyState(): Promise<NotifyState> {
  const logged = loggedWallet();
  return {
    device: await notifyStore.getDevice(),
    wallets: await notifyStore.getWallets(),
    logged: logged ? { walletId: logged.id, eligible: isEligibleWallet(logged) } : null,
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

/**
 * Top-level, synchronous: an MV3 worker woken by a push only sees listeners added in
 * the first turn. Feature-detected: the Firefox build has no service-worker registration.
 */
export function installNotifyListeners(): void {
  if (!self.registration?.pushManager) return;
  (self as unknown as { addEventListener: (t: string, l: (e: { waitUntil?: (p: Promise<unknown>) => void }) => void) => void })
    .addEventListener('pushsubscriptionchange', (event) => {
      const p = reassert('pushsubscriptionchange');
      try { event.waitUntil?.(p); } catch { /* not extendable */ }
    });
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
