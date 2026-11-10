// Handover B8, as Adam wants it: a push that arrives while a wallet page is visible AND
// focused shows as the wallet's own snackbar (top right, NotifySnackbar.vue), and the
// worker shows no system bubble at all. This answers the worker's NOTIFY_PRESENT with
// `{ shown: true }` only in that case. A page that does not show it answers NOTHING: the
// worker keeps only the first answer to its message, so a `{ shown: false }` from an unfocused
// page (the side panel beside a focused dashboard) could arrive first and add the system
// notification to the snackbar. With no answer at all the worker's callback returns at once
// and it shows the system notification. Install once per extension page.
//
// runtime.onMessage on an extension page also receives what a content script sends, and the
// content-script world is hostile (senderTrust.ts). So the real sender must be this extension's
// worker or one of its pages (the worker reports `chrome-extension://<id>/<its script>`, a
// content script the web page's URL), and the route must be one routeFor() can return.

import { onBeforeUnmount } from 'vue';
import { MessageTypes } from '@/models/MessageTypes';
import { notifySnackStore } from '@/stores/notifySnackStore';
import { isOwnExtensionPageSender, ownExtension } from '@/chrome/senderTrust';
import { isPushRoute } from '@/services/notify/notifyRender';

export interface NotifyPresentRoute {
  dashboard: string;
  sidepanel: string | null;
  settingsTab?: 'security';
}

export interface NotifyPresentRequest {
  e: string;
  title: string;
  body: string;
  route: NotifyPresentRoute;
  walletId: number | null;
  assets?: Array<{ unit?: string; label: string }>;
}

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

export function useNotifyPresent(surface: 'dashboard' | 'sidepanel'): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  const listener: Listener = (message, sender, sendResponse) => {
    const m = message as { method?: string; data?: NotifyPresentRequest } | null;
    if (!m || m.method !== MessageTypes.NOTIFY_PRESENT || !m.data) return false;
    if (!isOwnExtensionPageSender(sender, ownExtension())) return false;
    const focused = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
    if (!focused) return false;
    const { e, title, body, route, assets, walletId } = m.data;
    // Not shown here, so the worker shows the system notification, whose click it routes itself.
    if (!isPushRoute(route)) return false;
    notifySnackStore.show({
      e, title, body, walletId,
      ...(assets?.length ? { assets } : {}),
      path: surface === 'sidepanel' ? (route.sidepanel ?? '/') : route.dashboard,
      ...(route.settingsTab && surface === 'dashboard' ? { settingsTab: route.settingsTab } : {}),
    });
    sendResponse({ shown: true });
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  onBeforeUnmount(() => chrome.runtime.onMessage.removeListener(listener));
}
