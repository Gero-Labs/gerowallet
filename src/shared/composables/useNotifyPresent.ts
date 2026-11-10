// Handover B8, as Adam wants it: a push that arrives while a wallet page is visible AND
// focused shows as the wallet's own snackbar (top right, NotifySnackbar.vue), and the
// worker shows no system bubble at all. This answers the worker's NOTIFY_PRESENT with
// `{ shown: true }` only in that case; any other page answers `{ shown: false }` so the
// worker shows the system notification. Install once per extension page.
//
// A broadcast announcement is the one case where the words do not come from the message. The
// request names an announcement id; the title and summary shown are read from the private store,
// where only the worker writes and only after it verified Gero's signature. So whoever sends a
// NOTIFY_PRESENT with an announcement id can at most make a real announcement's snack appear.

import { onBeforeUnmount } from 'vue';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { announcementsStore, isHeadline } from '@/stores/announcementsStore';
import { notifySnackStore } from '@/stores/notifySnackStore';

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
  /** A verified broadcast announcement: the page shows its own stored copy of it. */
  announcementId?: string;
}

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

export function useNotifyPresent(surface: 'dashboard' | 'sidepanel'): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  const { t } = useTranslation();
  const listener: Listener = (message, _sender, sendResponse) => {
    const m = message as { method?: string; data?: NotifyPresentRequest } | null;
    if (!m || m.method !== MessageTypes.NOTIFY_PRESENT || !m.data) return false;
    const focused = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
    if (!focused) { sendResponse({ shown: false }); return false; }
    const { e, title, body, route, assets, walletId, announcementId } = m.data;
    if (announcementId !== undefined) {
      // Asynchronous: the stored copy is read first. `true` keeps the channel open for the answer.
      announcementsStore.find(announcementId).then((item) => {
        if (!item) { sendResponse({ shown: false }); return; }
        const text = announcementsStore.text(item);
        notifySnackStore.show({
          e: `announcement:${item.document.id}`,
          title: text.title,
          body: isHeadline(item) ? t('announce.headline.source') : text.summary,
          path: '',
          walletId: null,
          announcementId: item.document.id,
        });
        sendResponse({ shown: true });
      }, () => sendResponse({ shown: false }));
      return true;
    }
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
