// Handover B8, as Adam wants it: a push that arrives while a wallet page is visible AND
// focused shows as the app's own snackbar, and the worker shows no system bubble at all.
// This answers the worker's NOTIFY_PRESENT with `{ shown: true }` only in that case; any
// other page answers `{ shown: false }` so the worker shows the system notification.
// Install once per extension page (dashboard, side panel).

import { onBeforeUnmount } from 'vue';
import { MessageTypes } from '@/models/MessageTypes';
import i18n from '@/plugins/i18n';

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
}

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;
type Notify = (options: { text: string; theme?: string; hideAfter?: number }) => void;

const SNACK_MS = 8_000;
const LINK_CLASS = 'notify-snack__view';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function useNotifyPresent(surface: 'dashboard' | 'sidepanel'): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;

  const listener: Listener = (message, _sender, sendResponse) => {
    const m = message as { method?: string; data?: NotifyPresentRequest } | null;
    if (!m || m.method !== MessageTypes.NOTIFY_PRESENT || !m.data) return false;
    const notify = (window as Window & { notify?: Notify }).notify;
    const focused = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
    if (!focused || !notify) { sendResponse({ shown: false }); return false; }
    const { title, body, route } = m.data;
    const path = surface === 'sidepanel' ? (route.sidepanel ?? '/') : route.dashboard;
    // The snackbar takes HTML: a bold title, the body, and a "View" link that follows the same
    // route a notification click takes. A settings-tab route sets the flag on click (below).
    const attrs = route.settingsTab && surface === 'dashboard' ? ` data-settings-tab="${route.settingsTab}"` : '';
    const text = `<strong>${escapeHtml(title)}</strong><br>${escapeHtml(body)}`
      + `<br><a class="${LINK_CLASS}" href="#${path}"${attrs}>${escapeHtml(String(i18n.t('notify.inbox.open')))}</a>`;
    notify({ text, theme: 'dark', hideAfter: SNACK_MS });
    sendResponse({ shown: true });
    return false;
  };

  // The link is plain HTML inside the snackbar: the settings-tab flag is set on the way.
  const onClick = (ev: MouseEvent) => {
    const a = (ev.target as HTMLElement | null)?.closest?.(`a.${LINK_CLASS}`) as HTMLAnchorElement | null;
    const tab = a?.dataset['settingsTab'];
    if (tab) void chrome.storage.local.set({ openSettingsOnLoad: { tab } });
  };

  chrome.runtime.onMessage.addListener(listener);
  document.addEventListener('click', onClick, true);
  onBeforeUnmount(() => {
    chrome.runtime.onMessage.removeListener(listener);
    document.removeEventListener('click', onClick, true);
  });
}
