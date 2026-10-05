// The push snackbar (B8): a push that arrives while this wallet page is visible and
// focused is shown here, top right, instead of as a system notification. The app's
// other snackbars (@voerro, one global bus for every host) keep their place at the
// bottom; this store is separate so a push never moves them and they never move it.

import Vue from 'vue';

export interface NotifySnack {
  id: number;
  /** The push event id (the inbox row it belongs to). */
  e: string;
  title: string;
  body: string;
  /** Hash route on this surface, already chosen by the presenter. */
  path: string;
  /** Open the settings dialog on this tab after routing (a security push on the dashboard). */
  settingsTab?: 'security';
  /** The wallet the push is about (its network picks the ADA icon). */
  walletId?: number | null;
  /** The assets of a receipt, for the icon. */
  assets?: Array<{ unit?: string; label: string }>;
}

export const SNACK_MS = 8_000;
const SNACK_MAX = 3;

interface NotifySnackState {
  items: NotifySnack[];
}

const state = Vue.observable<NotifySnackState>({ items: [] });
let seq = 0;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

export const notifySnackStore = {
  state,
  show(snack: Omit<NotifySnack, 'id'>): number {
    const id = ++seq;
    // A repeat of the same event replaces its snack instead of stacking.
    state.items = [...state.items.filter((s) => s.e !== snack.e), { ...snack, id }].slice(-SNACK_MAX);
    timers.set(id, setTimeout(() => notifySnackStore.dismiss(id), SNACK_MS));
    return id;
  },
  dismiss(id: number): void {
    const t = timers.get(id);
    if (t) { clearTimeout(t); timers.delete(id); }
    state.items = state.items.filter((s) => s.id !== id);
  },
};

export default notifySnackStore;
