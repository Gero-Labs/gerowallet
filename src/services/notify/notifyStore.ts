// Push notifications — durable client state in chrome.storage.local (background).
//
// Handover B1 `notifyStore.ts`. Every access is wrapped in try/catch: a storage failure
// must never take the service worker down, and every reader gets a sane default.
// The storage surface is injectable (an in-memory map in tests), like deviceProofStore.
//
// Keys:
//   notifyDevice          this browser's registration state (opt-in switch, last PUT, clock offset, target)
//   notifyWallets         per local walletId: the link (walletTag, eventKey, creds last sent, prefs)
//   notifyPendingDeletes  durable queue of DELETEs that must reach the server (§8.5)
//   notifyConfigCache     the last /config, cached at most 1 h (§4.1)
//   notifyRetry           one scheduled retry (chrome.alarms) after a long Retry-After (§2.5, G2)
//   notifySeen            LRU of event tags `e` (B-M2 uses it; declared here so the shape is in one place)

import type { NotifyConfig, WalletPrefs } from './notifyTypes';

export interface NotifyStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export type NotifyTargetState = 'none' | 'active' | 'invalid' | 'needs_attention';

export interface NotifyDeviceState {
  /** The user's switch for this browser (opt-in only; F7: false means never subscribe, never PUT webpush). */
  browserEnabled: boolean;
  /** When the last successful PUT /device was sent, for `reassertAfterMs`. */
  lastPutAt: number | null;
  /** Fingerprint of what the last successful PUT carried (target, appVersion, locale, osPermission). */
  lastPutFingerprint: string | null;
  /** serverTime − localNow from the last response (§3.6). */
  clockOffsetMs: number;
  /** What GET /device last said, or 'needs_attention' after a repeated 409 target_invalid. */
  targetStatus: NotifyTargetState;
  endpoint: string | null;
  vapidKid: string | null;
  /** 426: stop calling until the extension is updated. */
  protocolUnsupported: boolean;
  /** Why push is unavailable on this browser (B9 hint), or null. */
  unavailable: 'subscribe_failed' | 'endpoint_not_allowed' | 'server_disabled' | null;
}

export interface NotifyWalletState {
  walletTag: string;
  eventKey: string;
  network: string;
  stakeAddress: string;
  /** The credential set last sent, so a lost link can be restored without the wallet being logged in (G4). */
  paymentCreds: string[];
  credsHash: string;
  /** null until the server accepted the link. */
  registeredAt: number | null;
  prefs: WalletPrefs | null;
  servedCategories: string[];
  /** The cached proof was missing or rejected: restore on the next opt-in. */
  needsProof: boolean;
}

export interface PendingDelete {
  kind: 'wallet' | 'device';
  walletTag?: string;
  enqueuedAt: number;
}

export interface NotifyRetryState {
  dueAt: number;
  attempt: number;
  reason: string;
}

export interface NotifyConfigCache {
  config: NotifyConfig;
  fetchedAt: number;
}

/** A click on a notification about a wallet other than the open one (B4): confirmed after unlock. */
export interface NotifyPendingOpen {
  walletId: number;
  d: string;
  x?: Record<string, unknown>;
  at: number;
}

/** One entry of the in-app notification centre (the bell): what the worker rendered for a push (B-M3). */
export interface NotifyInboxItem {
  /** The event id (`e`): one row per event, a repeat replaces it. */
  e: string;
  t: string;
  c: string;
  d: string;
  x?: Record<string, unknown>;
  walletId: number | null;
  walletName: string | null;
  title: string;
  body: string;
  /** The push timestamp (`ts`), or the arrival time for a generic entry. */
  ts: number;
  readAt: number | null;
  /** Sticky in the "Needs you" section (security and sign requests). */
  needsYou: boolean;
}

export const INBOX_MAX = 50;
export const SEEN_MAX = 200;
export const SEEN_TTL_MS = 48 * 3_600_000;

export const DEFAULT_DEVICE_STATE: NotifyDeviceState = {
  browserEnabled: false,
  lastPutAt: null,
  lastPutFingerprint: null,
  clockOffsetMs: 0,
  targetStatus: 'none',
  endpoint: null,
  vapidKid: null,
  protocolUnsupported: false,
  unavailable: null,
};

const KEYS = {
  device: 'notifyDevice',
  wallets: 'notifyWallets',
  pendingDeletes: 'notifyPendingDeletes',
  configCache: 'notifyConfigCache',
  retry: 'notifyRetry',
  seen: 'notifySeen',
  pendingOpen: 'notifyPendingOpen',
  inbox: 'notifyInbox',
} as const;

function chromeStorage(): NotifyStorage {
  return {
    get: (key) => new Promise((resolve) => chrome.storage.local.get(key, (r) => resolve(r?.[key]))),
    set: (key, value) => new Promise((resolve) => chrome.storage.local.set({ [key]: value }, () => resolve())),
    remove: (key) => new Promise((resolve) => chrome.storage.local.remove(key, () => resolve())),
  };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface NotifyStore {
  getDevice(): Promise<NotifyDeviceState>;
  updateDevice(patch: Partial<NotifyDeviceState>): Promise<NotifyDeviceState>;
  getWallets(): Promise<Record<string, NotifyWalletState>>;
  getWallet(walletId: number | string): Promise<NotifyWalletState | null>;
  setWallet(walletId: number | string, state: NotifyWalletState): Promise<void>;
  removeWallet(walletId: number | string): Promise<void>;
  getPendingDeletes(): Promise<PendingDelete[]>;
  setPendingDeletes(queue: PendingDelete[]): Promise<void>;
  enqueueDelete(item: PendingDelete): Promise<void>;
  getConfigCache(): Promise<NotifyConfigCache | null>;
  setConfigCache(cache: NotifyConfigCache | null): Promise<void>;
  getRetry(): Promise<NotifyRetryState | null>;
  setRetry(retry: NotifyRetryState | null): Promise<void>;
  /** §6.7 rule 6: remember `e` (200 entries, 48 h); returns true when it was already seen. */
  markSeen(e: string, now: number): Promise<boolean>;
  getPendingOpen(): Promise<NotifyPendingOpen | null>;
  setPendingOpen(open: NotifyPendingOpen | null): Promise<void>;
  /** Newest first, at most INBOX_MAX; a repeated `e` replaces its row (unread again). */
  getInbox(): Promise<NotifyInboxItem[]>;
  addInbox(item: NotifyInboxItem): Promise<void>;
  /** Mark one row (`e`) or every row (null) read. */
  markInboxRead(e: string | null, now: number): Promise<void>;
  clearInbox(): Promise<void>;
}

export function createNotifyStore(storage: NotifyStorage = chromeStorage(), log: (m: string, e?: unknown) => void = () => undefined): NotifyStore {
  async function read<T>(key: string, fallback: T, valid: (v: unknown) => v is T): Promise<T> {
    try {
      const v = await storage.get(key);
      return valid(v) ? v : fallback;
    } catch (e) {
      log(`notifyStore read ${key} failed`, e);
      return fallback;
    }
  }
  async function write(key: string, value: unknown): Promise<void> {
    try {
      if (value === null || value === undefined) await storage.remove(key);
      else await storage.set(key, value);
    } catch (e) {
      log(`notifyStore write ${key} failed`, e);
    }
  }
  const isDevice = (v: unknown): v is Partial<NotifyDeviceState> => isObject(v);
  const isWallets = (v: unknown): v is Record<string, NotifyWalletState> => isObject(v);
  const isQueue = (v: unknown): v is PendingDelete[] => Array.isArray(v);
  const isConfigCache = (v: unknown): v is NotifyConfigCache => isObject(v) && isObject(v['config']) && typeof v['fetchedAt'] === 'number';
  const isRetry = (v: unknown): v is NotifyRetryState => isObject(v) && typeof v['dueAt'] === 'number' && typeof v['attempt'] === 'number';

  const getDevice = async (): Promise<NotifyDeviceState> => ({ ...DEFAULT_DEVICE_STATE, ...(await read(KEYS.device, {}, isDevice)) });
  const getWallets = () => read(KEYS.wallets, {} as Record<string, NotifyWalletState>, isWallets);
  const getPendingDeletes = () => read(KEYS.pendingDeletes, [] as PendingDelete[], isQueue);
  const isInbox = (v: unknown): v is NotifyInboxItem[] => Array.isArray(v) && v.every((i) => isObject(i) && typeof i['e'] === 'string' && typeof i['title'] === 'string' && typeof i['ts'] === 'number');
  const getInbox = () => read(KEYS.inbox, [] as NotifyInboxItem[], isInbox);

  return {
    getDevice,
    async updateDevice(patch) {
      const next = { ...(await getDevice()), ...patch };
      await write(KEYS.device, next);
      return next;
    },
    getWallets,
    async getWallet(walletId) { return (await getWallets())[String(walletId)] ?? null; },
    async setWallet(walletId, state) { await write(KEYS.wallets, { ...(await getWallets()), [String(walletId)]: state }); },
    async removeWallet(walletId) {
      const all = await getWallets();
      delete all[String(walletId)];
      await write(KEYS.wallets, all);
    },
    getPendingDeletes,
    setPendingDeletes: (queue) => write(KEYS.pendingDeletes, queue),
    async enqueueDelete(item) {
      const queue = await getPendingDeletes();
      const same = queue.some((q) => q.kind === item.kind && q.walletTag === item.walletTag);
      if (!same) await write(KEYS.pendingDeletes, [...queue, item]);
    },
    getConfigCache: () => read(KEYS.configCache, null as NotifyConfigCache | null, (v): v is NotifyConfigCache | null => v === null || isConfigCache(v)),
    setConfigCache: (cache) => write(KEYS.configCache, cache),
    getRetry: () => read(KEYS.retry, null as NotifyRetryState | null, (v): v is NotifyRetryState | null => v === null || isRetry(v)),
    setRetry: (retry) => write(KEYS.retry, retry),
    async markSeen(e, now) {
      const seen = (await read(KEYS.seen, [] as Array<{ e: string; at: number }>, (v): v is Array<{ e: string; at: number }> => Array.isArray(v)))
        .filter((s) => isObject(s) && typeof s.e === 'string' && typeof s.at === 'number' && now - s.at < SEEN_TTL_MS);
      const already = seen.some((s) => s.e === e);
      const next = [...seen.filter((s) => s.e !== e), { e, at: now }].slice(-SEEN_MAX);
      await write(KEYS.seen, next);
      return already;
    },
    getPendingOpen: () => read(KEYS.pendingOpen, null as NotifyPendingOpen | null, (v): v is NotifyPendingOpen | null => v === null || (isObject(v) && typeof v['walletId'] === 'number' && typeof v['d'] === 'string')),
    setPendingOpen: (open) => write(KEYS.pendingOpen, open),
    getInbox,
    async addInbox(item) {
      const rest = (await getInbox()).filter((i) => i.e !== item.e);
      await write(KEYS.inbox, [item, ...rest].slice(0, INBOX_MAX));
    },
    async markInboxRead(e, now) {
      const all = await getInbox();
      if (!all.some((i) => (e === null || i.e === e) && i.readAt === null)) return;
      await write(KEYS.inbox, all.map((i) => ((e === null || i.e === e) && i.readAt === null ? { ...i, readAt: now } : i)));
    },
    clearInbox: () => write(KEYS.inbox, null),
  };
}

/** In-memory storage for tests. */
export function memoryNotifyStorage(seed: Record<string, unknown> = {}): NotifyStorage & { dump(): Record<string, unknown> } {
  const store: Record<string, unknown> = { ...seed };
  return {
    get: async (k) => store[k],
    set: async (k, v) => { store[k] = JSON.parse(JSON.stringify(v)); },
    remove: async (k) => { delete store[k]; },
    dump: () => store,
  };
}
