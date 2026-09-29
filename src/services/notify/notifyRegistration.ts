// Push notifications — subscription, registration and re-assertion (background).
//
// Handover B2, CONTRACT.md §8. Everything runs in the service worker; the UI only
// sends messages. The rules that matter most:
//
// - Opt-in only. Nothing subscribes until the user turns notifications on for this
//   browser (`browserEnabled`), and a wallet is registered only when the user turns it
//   on. New and restored wallets start off.
// - Opt-out rule (F7, §8.2 step 0): with `browserEnabled: false` no trigger ever calls
//   `subscribe()` or sends `PUT /device` with `transport: webpush`. Pending deletes
//   still flush.
// - Re-assertion starts with `GET /device` (F2). An `invalid` target is replaced by a
//   NEW subscription, never re-sent; a second 409 stops until the next start.
// - Reconciliation restores a link the server lost from local state and the cached
//   proof (G4), deletes links whose wallet is gone, and re-sends changed credentials.
// - Wallet removal enqueues the DELETE durably BEFORE the wallet's keys go (§8.5).
//
// Dependencies are injected (push manager, identity, proof store, wallets, clock,
// randomness) so the whole machine is unit-testable without chrome.

import { bytesToHex } from './notifyAuth';
import { sha256 } from '@noble/hashes/sha2.js';
import { NotifyDeferred, NotifyError, type NotifyClient } from './notifyClient';
import type { NotifyStore, NotifyWalletState } from './notifyStore';
import { NOTIFY_PROTOCOL, type DeviceBody, type DeviceView, type NotifyConfig, type WalletLinkBody, type WalletPrefsWrite, type WalletProof, type WebPushTarget } from './notifyTypes';

export const NOTIFY_REASSERT_ALARM = 'notify-reassert';
export const NOTIFY_RETRY_ALARM = 'notify-retry';
const RENEW_BEFORE_MS = 7 * 86_400_000;
const MAX_CREDS_PER_LINK = 200;

export interface LocalWallet {
  id: number;
  chain: string;
  network: string;
  type?: string;
}

export interface LoggedWallet extends LocalWallet {
  stakeAddress?: string;
  derivePaymentCredentials(): string[];
}

/** The subset of PushSubscription the machine touches (a fake in e2e, §10.3). */
export interface PushSubscriptionLike {
  endpoint: string;
  expirationTime?: number | null;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: true; applicationServerKey: Uint8Array }): Promise<PushSubscriptionLike>;
}

export interface NotifyRegistrationDeps {
  client: NotifyClient;
  store: NotifyStore;
  identity: () => Promise<{ deviceId: string; pubKeyHex: string }>;
  /** Read at call time: the e2e fixture patches `self.registration.pushManager`. Null on Firefox. */
  pushManager: () => PushManagerLike | null;
  appVersion: () => string;
  /** The stored UI locale, one of PUSH_LOCALES (`us` | `de` | `es`). */
  locale: () => Promise<string>;
  /** Every installed wallet, for reconciliation. */
  wallets: () => Promise<LocalWallet[]>;
  /** The logged-in wallet, the only one that can derive credentials and sign a proof. */
  logged: () => LoggedWallet | null;
  loadProof: (deviceId: string, stakeAddress: string) => Promise<WalletProof | null>;
  /** walletManager.produceDeviceRegisterProof: signs and caches the proof under user auth. */
  produceProof: (auth: { password?: string; privateKeyBytes?: Uint8Array }) => Promise<boolean>;
  now?: () => number;
  random?: (n: number) => Uint8Array;
  log?: (message: string) => void;
}

export type ReassertTrigger = 'start' | 'alarm' | 'retry' | 'login' | 'pushsubscriptionchange' | 'credentials' | 'settings';
export type ReassertResult = 'opted_out' | 'registered' | 'reasserted' | 'recovered' | 'needs_attention' | 'unavailable' | 'deferred' | 'error' | 'skipped';
export type BrowserEnableResult = 'ok' | 'unavailable' | 'subscribe_failed' | 'endpoint_not_allowed' | 'needs_attention' | 'deferred' | 'error';
export type WalletEnableResult = 'ok' | 'browser_off' | 'no_wallet' | 'ineligible' | 'needs_auth' | 'proof_failed' | 'proof_invalid' | 'limit' | 'deferred' | 'error';

export interface NotifyRegistration {
  setBrowserEnabled(enabled: boolean): Promise<BrowserEnableResult | 'off'>;
  enableWallet(auth?: { password?: string; privateKeyBytes?: Uint8Array }): Promise<WalletEnableResult>;
  disableWallet(walletId: number): Promise<void>;
  setPrefs(walletId: number, write: WalletPrefsWrite): Promise<'ok' | 'not_registered' | 'error'>;
  /** Pull `GET …/prefs` for a registered wallet, so a preference another device wrote (iOS) shows in the tab (§4.8). */
  refreshPrefs(walletId: number): Promise<'ok' | 'not_registered' | 'error'>;
  /** Wallet deleted: called BEFORE the wallet record and keys are removed. */
  walletRemoved(walletId: number): Promise<void>;
  reassert(trigger: ReassertTrigger): Promise<ReassertResult>;
  /** Re-send the logged wallet's link after its credential range grew. */
  credentialsChanged(): Promise<void>;
}

// ---- pure helpers (exported for tests) ----

export function wireNetworkOf(network: string): string {
  return `cardano-${network.toLowerCase()}`;
}

/** Our locale keys are not all BCP-47 (`us` is English); the API wants BCP-47. Keys that
 *  already are a language subtag (`de`, `es`) pass through. */
export function toBcp47(locale: string): string {
  const l = (locale || 'us').toLowerCase();
  return (l === 'us' ? 'en' : l).slice(0, 16);
}

/** §1.3 plus handover B2: Normal Cardano software wallets with a key-hash reward address, on a served network. */
export function isEligibleWallet(w: { chain: string; network: string; type?: string; stakeAddress?: string }): boolean {
  return w.chain === 'Cardano'
    && (w.type === undefined || w.type === 'Normal')
    && ['Mainnet', 'Preprod', 'Preview'].includes(w.network)
    && typeof w.stakeAddress === 'string' && /^stake(_test)?1[a-z0-9]+$/.test(w.stakeAddress);
}

/**
 * This device's credential set for PUT /device/wallets (§4.5). `derivePaymentCredentials()`
 * returns external 0..N-1 then internal 0..N-1; above the 200 cap keep the lowest 100 of
 * each chain so change addresses stay covered (open question 9).
 */
export function capPaymentCredentials(creds: string[]): string[] {
  const unique = [...new Set(creds)];
  if (unique.length <= MAX_CREDS_PER_LINK) return unique;
  const half = Math.ceil(creds.length / 2);
  const external = creds.slice(0, half).slice(0, MAX_CREDS_PER_LINK / 2);
  const internal = creds.slice(half).slice(0, MAX_CREDS_PER_LINK / 2);
  return [...new Set([...external, ...internal])];
}

export function credentialsHash(creds: string[]): string {
  return bytesToHex(sha256(new TextEncoder().encode(creds.join(','))));
}

export function targetFingerprint(target: WebPushTarget | null, appVersion: string, locale: string, osPermission: boolean): string {
  return JSON.stringify({ target, appVersion, locale, osPermission });
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function createNotifyRegistration(deps: NotifyRegistrationDeps): NotifyRegistration {
  const { client, store } = deps;
  const now = deps.now ?? (() => Date.now());
  const random = deps.random ?? ((n) => { const b = new Uint8Array(n); globalThis.crypto.getRandomValues(b); return b; });
  const log = deps.log ?? (() => undefined);
  const hex16 = () => bytesToHex(random(16));

  const targetOf = (sub: PushSubscriptionLike, vapidKid: string): WebPushTarget => {
    const j = sub.toJSON();
    return { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, vapidKid, expirationTime: j.expirationTime ?? null };
  };

  async function deviceBody(target: WebPushTarget | null): Promise<DeviceBody> {
    const identity = await deps.identity();
    return {
      protocol: NOTIFY_PROTOCOL,
      relayPubKey: identity.pubKeyHex,
      platform: 'extension',
      appVersion: deps.appVersion(),
      locale: toBcp47(await deps.locale()),
      osPermission: true, // Chrome grants it with the `notifications` permission
      transport: target ? 'webpush' : 'none',
      ...(target ? { webpush: target } : {}),
    };
  }

  /** PUT /device and remember what was sent. */
  async function putDevice(target: WebPushTarget | null): Promise<DeviceView> {
    const body = await deviceBody(target);
    const view = await client.putDevice(body);
    await store.updateDevice({
      lastPutAt: now(),
      lastPutFingerprint: targetFingerprint(target, body.appVersion, body.locale ?? '', body.osPermission),
      targetStatus: view.target.status === 'active' ? 'active' : 'none',
      endpoint: target?.endpoint ?? null,
      vapidKid: target?.vapidKid ?? null,
    });
    return view;
  }

  /** A NEW subscription (unsubscribes any current one first). Never re-uses an invalid endpoint. */
  async function freshSubscription(config: NotifyConfig, current: PushSubscriptionLike | null): Promise<PushSubscriptionLike> {
    const pm = deps.pushManager();
    if (!pm) throw new Error('no pushManager');
    if (current) await current.unsubscribe().catch(() => false);
    return pm.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(config.vapidPublicKey as string) });
  }

  async function usableConfig(): Promise<NotifyConfig | null> {
    const config = await client.getConfig({ force: true });
    if (!config.enabled || !config.vapidPublicKey || !config.vapidKid) {
      await store.updateDevice({ unavailable: 'server_disabled' });
      return null;
    }
    if ((await store.getDevice()).unavailable === 'server_disabled') await store.updateDevice({ unavailable: null });
    return config;
  }

  /**
   * §8.1 steps 1–3: config, subscribe, PUT /device. `replaceCurrent` forces a new endpoint
   * (invalid-target recovery, VAPID rotation). Returns the outcome for the UI.
   */
  async function registerDevice(replaceCurrent = false): Promise<BrowserEnableResult> {
    const device = await store.getDevice();
    if (!device.browserEnabled) return 'unavailable';
    const config = await usableConfig();
    if (!config) return 'unavailable';
    const pm = deps.pushManager();
    if (!pm) {
      await store.updateDevice({ browserEnabled: false, unavailable: 'subscribe_failed' });
      return 'subscribe_failed';
    }
    let sub: PushSubscriptionLike;
    try {
      const current = await pm.getSubscription();
      sub = replaceCurrent || !current ? await freshSubscription(config, current) : current;
    } catch (e) {
      log(`notify subscribe failed: ${String(e)}`);
      await store.updateDevice({ browserEnabled: false, unavailable: 'subscribe_failed' });
      return 'subscribe_failed';
    }
    let kid = config.vapidKid as string;
    for (let attempt = 0; ; attempt++) {
      try {
        await putDevice(targetOf(sub, kid));
        await store.updateDevice({ unavailable: null });
        return 'ok';
      } catch (e) {
        if (e instanceof NotifyDeferred) return 'deferred';
        if (!(e instanceof NotifyError) || attempt > 0) { log(`notify PUT /device failed: ${String(e)}`); return 'error'; }
        if (e.code === 'endpoint_not_allowed') {
          await store.updateDevice({ browserEnabled: false, unavailable: 'endpoint_not_allowed' });
          return 'endpoint_not_allowed';
        }
        if (e.code === 'vapid_kid_stale') {
          // §8.3: unsubscribe, refetch /config, subscribe with the new key, PUT again.
          const fresh = await client.getConfig({ force: true });
          if (!fresh.vapidPublicKey || !fresh.vapidKid) return 'unavailable';
          sub = await freshSubscription(fresh, sub);
          kid = fresh.vapidKid;
          continue;
        }
        if (e.code === 'target_invalid') {
          // The browser handed back an endpoint the server marked invalid. One more new one;
          // if it is the same again, stop until the next start (§8.2 step 2).
          const previous = sub.endpoint;
          sub = await freshSubscription(config, sub);
          if (sub.endpoint === previous) {
            await store.updateDevice({ targetStatus: 'needs_attention' });
            return 'needs_attention';
          }
          continue;
        }
        log(`notify PUT /device failed: ${e.code}`);
        return 'error';
      }
    }
  }

  async function registeredWallets(): Promise<Array<[string, NotifyWalletState]>> {
    return Object.entries(await store.getWallets()).filter(([, w]) => w.registeredAt !== null);
  }

  /** PUT /device/wallets/{tag} from stored state plus the cached proof. */
  async function putWalletLink(walletId: string | number, state: NotifyWalletState, proof: WalletProof, creds: string[]): Promise<'ok' | 'proof_invalid' | 'limit' | 'ineligible' | 'deferred' | 'error'> {
    const body: WalletLinkBody = { network: state.network, stakeAddress: state.stakeAddress, proof, paymentCreds: creds, eventKey: state.eventKey };
    for (let attempt = 0; ; attempt++) {
      try {
        const view = await client.putWallet(state.walletTag, body);
        if (view.credentialCoverage.walletTruncated > 0) log(`notify wallet ${state.walletTag.slice(0, 8)}: ${view.credentialCoverage.walletTruncated} credentials truncated on the server`);
        await store.setWallet(walletId, {
          ...state, paymentCreds: creds, credsHash: credentialsHash(creds), registeredAt: now(), prefs: view.prefs,
          servedCategories: view.servedCategories[state.network] ?? [], needsProof: false,
        });
        return 'ok';
      } catch (e) {
        if (e instanceof NotifyDeferred) return 'deferred';
        if (!(e instanceof NotifyError)) { log(`notify PUT wallet failed: ${String(e)}`); return 'error'; }
        if (e.code === 'wallet_tag_conflict' && attempt === 0) {
          state = { ...state, walletTag: hex16() }; // a new tag, once
          await store.setWallet(walletId, state);
          continue;
        }
        if (e.code === 'proof_invalid') {
          await store.setWallet(walletId, { ...state, needsProof: true });
          return 'proof_invalid';
        }
        if (e.code === 'limit_exceeded') return 'limit';
        if (e.code === 'unsupported_network' || e.code === 'unsupported_stake_credential') return 'ineligible';
        log(`notify PUT wallet failed: ${e.code}`);
        return 'error';
      }
    }
  }

  async function flushPendingDeletes(): Promise<void> {
    const queue = await store.getPendingDeletes();
    if (!queue.length) return;
    // In order, and stop at the first failure: a DELETE /device queued after a wallet
    // DELETE must not overtake it. The rest waits for the next start (§8.5 step 3).
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      try {
        if (item.kind === 'wallet' && item.walletTag) await client.deleteWallet(item.walletTag);
        else if (item.kind === 'device') await client.deleteDevice();
      } catch (e) {
        if (e instanceof NotifyError && e.status >= 400 && e.status < 500 && e.code !== 'auth_clock_skew') {
          log(`notify pending delete dropped (${e.code})`); // a bug-class 4xx never succeeds later
          continue;
        }
        await store.setPendingDeletes(queue.slice(i));
        return;
      }
    }
    await store.setPendingDeletes([]);
  }

  /** §8.2 step 4. `serverLinks` is the wallets[] of the last GET or PUT response. */
  async function reconcile(serverLinks: DeviceView['wallets']): Promise<void> {
    const local = await store.getWallets();
    const installed = new Set((await deps.wallets()).map((w) => String(w.id)));
    const identity = await deps.identity();
    const logged = deps.logged();
    const serverTags = new Set(serverLinks.map((l) => l.walletTag));
    const localTags = new Map(Object.entries(local).map(([id, w]) => [w.walletTag, id]));

    // A server link whose local wallet no longer exists (a deletion this code never saw).
    for (const link of serverLinks) {
      const id = localTags.get(link.walletTag);
      if (id === undefined || !installed.has(id)) {
        await store.enqueueDelete({ kind: 'wallet', walletTag: link.walletTag, enqueuedAt: now() });
        if (id !== undefined) await store.removeWallet(id);
      }
    }
    for (const [id, w] of Object.entries(local)) {
      if (w.registeredAt === null) continue;
      if (!installed.has(id)) { // the wallet is gone locally: its link goes too
        await store.enqueueDelete({ kind: 'wallet', walletTag: w.walletTag, enqueuedAt: now() });
        await store.removeWallet(id);
        continue;
      }
      const isLogged = logged && String(logged.id) === id;
      const creds = isLogged ? capPaymentCredentials(logged.derivePaymentCredentials()) : w.paymentCreds;
      const missingOnServer = !serverTags.has(w.walletTag);
      const credsChanged = isLogged && credentialsHash(creds) !== w.credsHash;
      if (!missingOnServer && !credsChanged) continue;
      // G4: restore a link the server lacks, from stored state and the cached proof; no prompt.
      const proof = await deps.loadProof(identity.deviceId, w.stakeAddress);
      if (!proof) {
        await store.setWallet(id, { ...w, needsProof: true });
        log(`notify wallet ${w.walletTag.slice(0, 8)}: link missing and no cached proof; re-confirm needed`);
        continue;
      }
      const result = await putWalletLink(id, w, proof, creds);
      if (result === 'ok' && missingOnServer && w.prefs?.device.muted) {
        await client.putPrefs(w.walletTag, { device: { muted: true } }).catch((e) => log(`notify re-mute failed: ${String(e)}`));
      }
      if (result === 'deferred') return;
    }
  }

  async function reassertInner(trigger: ReassertTrigger): Promise<ReassertResult> {
    const device = await store.getDevice();
    if (device.protocolUnsupported) return 'skipped';
    const retry = await store.getRetry();
    if (retry && trigger !== 'retry' && now() < retry.dueAt) return 'skipped'; // an alarm is already set
    if (trigger === 'retry') await store.setRetry(null);
    // Step 0 (F7): opted out. No subscribe, no webpush PUT. Only the queue.
    if (!device.browserEnabled) {
      await flushPendingDeletes();
      return 'opted_out';
    }
    // Step 1: GET /device first.
    let view: DeviceView;
    try {
      view = await client.getDevice();
    } catch (e) {
      if (e instanceof NotifyError && e.code === 'device_unknown') {
        const r = await registerDevice();
        if (r !== 'ok') return r === 'deferred' ? 'deferred' : r === 'needs_attention' ? 'needs_attention' : 'unavailable';
        await reconcile([]);
        await flushPendingDeletes();
        return 'registered';
      }
      throw e;
    }
    // Step 2: an invalid target gets a NEW one; the old endpoint is never re-sent.
    if (view.target.status === 'invalid') {
      log(`notify target invalid (${view.target.invalidReason ?? '?'}), resubscribing`);
      await store.updateDevice({ targetStatus: 'invalid' });
      const r = await registerDevice(true);
      if (r !== 'ok') return r === 'deferred' ? 'deferred' : r === 'needs_attention' ? 'needs_attention' : 'unavailable';
      view = await client.getDevice();
      await reconcile(view.wallets);
      await flushPendingDeletes();
      return 'recovered';
    }
    // Step 3: renew the subscription or re-send the target when something changed.
    const config = await usableConfig();
    if (!config) return 'unavailable';
    const pm = deps.pushManager();
    const sub = pm ? await pm.getSubscription() : null;
    const keyMatches = (s: PushSubscriptionLike) => {
      const key = s.options?.applicationServerKey;
      if (key) return bytesToHex(new Uint8Array(key)) === bytesToHex(base64UrlToBytes(config.vapidPublicKey as string));
      return device.vapidKid === config.vapidKid;
    };
    const renew = !sub || sub.endpoint !== device.endpoint
      || (typeof sub.expirationTime === 'number' && sub.expirationTime - now() < RENEW_BEFORE_MS)
      || !keyMatches(sub);
    let sent: DeviceView | null = null;
    if (renew) {
      const r = await registerDevice(!!sub);
      if (r !== 'ok') return r === 'deferred' ? 'deferred' : r === 'needs_attention' ? 'needs_attention' : 'unavailable';
      sent = await client.getDevice();
    } else {
      const target = targetOf(sub, device.vapidKid ?? (config.vapidKid as string));
      const body = await deviceBody(target);
      const fingerprint = targetFingerprint(target, body.appVersion, body.locale ?? '', body.osPermission);
      if (fingerprint !== device.lastPutFingerprint || device.lastPutAt === null || now() - device.lastPutAt >= view.reassertAfterMs) {
        try { sent = await putDevice(target); } catch (e) { if (e instanceof NotifyDeferred) return 'deferred'; throw e; }
      }
    }
    await store.updateDevice({ targetStatus: (sent ?? view).target.status === 'active' ? 'active' : 'none' });
    // Steps 4 and 5.
    await reconcile((sent ?? view).wallets);
    await flushPendingDeletes();
    return 'reasserted';
  }

  async function reassert(trigger: ReassertTrigger): Promise<ReassertResult> {
    try {
      return await reassertInner(trigger);
    } catch (e) {
      if (e instanceof NotifyDeferred) return 'deferred';
      log(`notify reassert(${trigger}) failed: ${String(e)}`);
      return 'error';
    }
  }

  return {
    async setBrowserEnabled(enabled) {
      if (enabled) {
        await store.updateDevice({ browserEnabled: true, unavailable: null });
        const r = await registerDevice();
        if (r === 'ok') { await reconcile((await client.getDevice().catch(() => null))?.wallets ?? []); await flushPendingDeletes(); }
        return r;
      }
      // Off: the switch first (F7 applies from now on), then transport none, then unsubscribe. Links are kept.
      await store.updateDevice({ browserEnabled: false, targetStatus: 'none', endpoint: null, vapidKid: null });
      try { await putDevice(null); } catch (e) { log(`notify PUT transport none failed: ${String(e)}`); }
      const sub = await deps.pushManager()?.getSubscription().catch(() => null);
      if (sub) await sub.unsubscribe().catch(() => false);
      return 'off';
    },

    async enableWallet(auth) {
      const logged = deps.logged();
      if (!logged) return 'no_wallet';
      if (!isEligibleWallet(logged)) return 'ineligible';
      const device = await store.getDevice();
      if (!device.browserEnabled) return 'browser_off';
      const stakeAddress = logged.stakeAddress as string;
      const identity = await deps.identity();
      let proof = await deps.loadProof(identity.deviceId, stakeAddress);
      if (!proof) {
        if (!auth) return 'needs_auth';
        if (!(await deps.produceProof(auth))) return 'proof_failed';
        proof = await deps.loadProof(identity.deviceId, stakeAddress);
        if (!proof) return 'proof_failed';
      }
      // Make sure the device exists on the server first (a PUT /device on device_unknown also happens in the client).
      if (device.targetStatus !== 'active') {
        const r = await registerDevice();
        if (r !== 'ok') return r === 'deferred' ? 'deferred' : 'error';
      }
      const existing = await store.getWallet(logged.id);
      const state: NotifyWalletState = existing ?? {
        walletTag: hex16(), eventKey: hex16(), network: wireNetworkOf(logged.network), stakeAddress,
        paymentCreds: [], credsHash: '', registeredAt: null, prefs: null, servedCategories: [], needsProof: false,
      };
      if (!existing) await store.setWallet(logged.id, state);
      const creds = capPaymentCredentials(logged.derivePaymentCredentials());
      const r = await putWalletLink(logged.id, state, proof, creds);
      return r === 'ok' ? 'ok' : r;
    },

    async disableWallet(walletId) {
      const w = await store.getWallet(walletId);
      if (!w) return;
      await store.enqueueDelete({ kind: 'wallet', walletTag: w.walletTag, enqueuedAt: now() });
      await store.removeWallet(walletId);
      await flushPendingDeletes();
    },

    async setPrefs(walletId, write) {
      const w = await store.getWallet(walletId);
      if (!w || w.registeredAt === null) return 'not_registered';
      try {
        const prefs = await client.putPrefs(w.walletTag, write);
        await store.setWallet(walletId, { ...w, prefs });
        return 'ok';
      } catch (e) {
        if (e instanceof NotifyError && e.code === 'wallet_not_registered') {
          await store.setWallet(walletId, { ...w, registeredAt: null });
          return 'not_registered';
        }
        log(`notify PUT prefs failed: ${String(e)}`);
        return 'error';
      }
    },

    async refreshPrefs(walletId) {
      const w = await store.getWallet(walletId);
      if (!w || w.registeredAt === null) return 'not_registered';
      try {
        const prefs = await client.getPrefs(w.walletTag);
        await store.setWallet(walletId, { ...w, prefs });
        return 'ok';
      } catch (e) {
        if (e instanceof NotifyError && e.code === 'wallet_not_registered') {
          await store.setWallet(walletId, { ...w, registeredAt: null });
          return 'not_registered';
        }
        log(`notify GET prefs failed: ${String(e)}`);
        return 'error';
      }
    },

    async walletRemoved(walletId) {
      const w = await store.getWallet(walletId);
      if (w) {
        await store.enqueueDelete({ kind: 'wallet', walletTag: w.walletTag, enqueuedAt: now() }); // durable, BEFORE removeWallet
        await store.removeWallet(walletId);
      }
      const others = (await registeredWallets()).filter(([id]) => id !== String(walletId));
      if (others.length === 0 && (await store.getDevice()).endpoint) {
        // §8.6: the last registered wallet is gone: DELETE /device, then unsubscribe. The
        // browser switch goes off too, or the next start would re-subscribe an empty device;
        // new and restored wallets start off anyway, so the user opts in again with the next one.
        await store.enqueueDelete({ kind: 'device', enqueuedAt: now() });
        await store.updateDevice({ browserEnabled: false, targetStatus: 'none', endpoint: null, vapidKid: null, lastPutAt: null, lastPutFingerprint: null });
        const sub = await deps.pushManager()?.getSubscription().catch(() => null);
        if (sub) await sub.unsubscribe().catch(() => false);
      }
      await flushPendingDeletes();
    },

    reassert,

    async credentialsChanged() {
      const logged = deps.logged();
      if (!logged) return;
      const w = await store.getWallet(logged.id);
      if (!w || w.registeredAt === null) return;
      const creds = capPaymentCredentials(logged.derivePaymentCredentials());
      if (credentialsHash(creds) === w.credsHash) return;
      const identity = await deps.identity();
      const proof = await deps.loadProof(identity.deviceId, w.stakeAddress);
      if (proof) await putWalletLink(logged.id, w, proof, creds);
    },
  };
}
