// UI-side mirror of the push-notification state that lives in the service worker
// (handover B7), modelled on remoteSigningStore. Every mutation round-trips through
// the worker's NOTIFY_* handlers and stores the fresh state the reply carries; the
// worker owns the subscription, the relay-key signatures and every API call.

import Vue from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { NotifyState } from '@/services/notify/notifyBackground';
import type { BrowserEnableResult, WalletEnableResult } from '@/services/notify/notifyRegistration';
import type { WalletPrefsWrite } from '@/services/notify/notifyTypes';

export type { NotifyState };

interface NotifySettingsState {
  state: NotifyState | null;
  loaded: boolean;
  loading: boolean;
  /** The last mutation's outcome, for inline hints. */
  lastResult: string | null;
  error: string | null;
  /** Settings was opened from the offer (notifyIntro.ts): the tab starts the enable step as soon as it is ready. */
  enableRequested: boolean;
}

const state = Vue.observable<NotifySettingsState>({ state: null, loaded: false, loading: false, lastResult: null, error: null, enableRequested: false });

export interface NotifyRefreshOptions {
  /** Also refetch /config (cached up to 1 h). */
  config?: boolean;
  /** Also pull GET /device and this wallet's server prefs, so another device's choices show (the tab opening). */
  sync?: boolean;
}

interface Reply { success: boolean; result?: string; state?: NotifyState; error?: string }

async function send(method: MessageTypes, data?: Record<string, unknown>): Promise<Reply> {
  const res = (await Messaging.sendToBackgroundFromOptions({ method, data })) as { data?: Reply; error?: string };
  return res?.data ?? { success: false, error: res?.error ?? 'no reply' };
}

function apply(reply: Reply): void {
  if (reply.state) state.state = reply.state;
  state.lastResult = reply.result ?? null;
  state.error = reply.success ? null : (reply.error ?? 'failed');
}

export const notifySettingsStore = {
  state,

  /** Load the worker's state. With no options this is a storage read, no network. */
  async refresh(opts: NotifyRefreshOptions = {}): Promise<void> {
    state.loading = true;
    try {
      apply(await send(MessageTypes.NOTIFY_GET_STATE, { refreshConfig: opts.config === true, syncServer: opts.sync === true }));
      state.loaded = true;
    } catch (e) {
      state.error = (e as Error)?.message || 'failed';
    } finally {
      state.loading = false;
    }
  },

  /** The offer's "Turn on": Settings > Notifications opens and runs the enable step once the tab is ready. */
  requestEnable(): void { state.enableRequested = true; },
  /** Consumed by the tab: true once per request. */
  takeEnableRequest(): boolean {
    const requested = state.enableRequested;
    state.enableRequested = false;
    return requested;
  },

  /** The offer was answered: "Turn on" for one wallet (`walletId`), or "Not now" for this install (`dismiss`). */
  async answerIntro(answer: { walletId?: number; dismiss?: boolean }): Promise<void> {
    await send(MessageTypes.NOTIFY_INTRO_ANSWER, answer);
  },

  async setBrowserEnabled(enabled: boolean): Promise<BrowserEnableResult | 'off' | 'error'> {
    state.loading = true;
    try {
      const reply = await send(MessageTypes.NOTIFY_SET_BROWSER_ENABLED, { enabled });
      apply(reply);
      return (reply.result as BrowserEnableResult | 'off') ?? 'error';
    } finally { state.loading = false; }
  },

  /** Turn the open wallet on; `auth` is needed only when no wallet proof is cached (needs_auth). */
  async enableWallet(auth?: { password?: string; privateKeyBytes?: number[] }): Promise<WalletEnableResult | 'error'> {
    state.loading = true;
    try {
      const reply = await send(MessageTypes.NOTIFY_ENABLE_WALLET, auth as Record<string, unknown> | undefined);
      apply(reply);
      return (reply.result as WalletEnableResult) ?? 'error';
    } finally { state.loading = false; }
  },

  async disableWallet(walletId: number): Promise<void> {
    state.loading = true;
    try { apply(await send(MessageTypes.NOTIFY_DISABLE_WALLET, { walletId })); } finally { state.loading = false; }
  },

  async setPrefs(walletId: number, prefs: WalletPrefsWrite): Promise<boolean> {
    state.loading = true;
    try {
      const reply = await send(MessageTypes.NOTIFY_SET_PREFS, { walletId, prefs });
      apply(reply);
      return reply.success;
    } finally { state.loading = false; }
  },

  // ---- getters --------------------------------------------------------------

  device() { return state.state?.device ?? null; },
  config() { return state.state?.config ?? null; },
  /** The open wallet's stored link, or null when it is not registered. */
  loggedLink() {
    const id = state.state?.logged?.walletId;
    return id === undefined ? null : (state.state?.wallets[String(id)] ?? null);
  },
};

export default notifySettingsStore;
