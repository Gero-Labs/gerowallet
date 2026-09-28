// In-app toast for a push that arrived while a wallet page is open (handover B8).
//
// The service worker asks every open page (NOTIFY_PRESENT); the page that is
// visible and focused renders this toast and answers `{ shown: true }`, and the
// worker then shows its system notification silently. When the toast closes the
// page sends NOTIFY_TOAST_SHOWN so the worker can close that notification too.
// Clicking "View" follows the same route a notification click takes (B4).

import Vue from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

export interface NotifyToastRoute {
  dashboard: string;
  sidepanel: string | null;
  settingsTab?: 'security';
}

export interface NotifyToast {
  e: string;
  title: string;
  body: string;
  route: NotifyToastRoute;
  walletId: number | null;
}

interface NotifyToastState {
  current: NotifyToast | null;
}

const state = Vue.observable<NotifyToastState>({ current: null });

export const notifyToastStore = {
  state,
  show(toast: NotifyToast): void {
    state.current = toast;
  },
  /** Closes the toast and tells the worker, which closes its silent system notification. */
  dismiss(): void {
    const e = state.current?.e;
    state.current = null;
    if (e) void Messaging.sendToBackgroundFromOptions({ method: MessageTypes.NOTIFY_TOAST_SHOWN, data: { e } });
  },
};

export default notifyToastStore;
