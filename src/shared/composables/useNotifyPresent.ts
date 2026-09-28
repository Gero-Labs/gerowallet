// Handover B8: answer the worker's NOTIFY_PRESENT with `{ shown: true }` ONLY when
// this page is visible and focused, after handing the toast to notifyToastStore.
// Any other page answers `{ shown: false }` so the worker shows the audible
// system notification. Install once per extension page (dashboard, side panel).

import { onBeforeUnmount } from 'vue';
import { MessageTypes } from '@/models/MessageTypes';
import { notifyToastStore, type NotifyToast } from '@/stores/notifyToastStore';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

export function useNotifyPresent(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime?.onMessage) return;
  const listener: Listener = (message, _sender, sendResponse) => {
    const m = message as { method?: string; data?: NotifyToast } | null;
    if (!m || m.method !== MessageTypes.NOTIFY_PRESENT || !m.data) return false;
    const focused = typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus();
    if (!focused) { sendResponse({ shown: false }); return false; }
    notifyToastStore.show(m.data);
    sendResponse({ shown: true });
    return false;
  };
  chrome.runtime.onMessage.addListener(listener);
  onBeforeUnmount(() => chrome.runtime.onMessage.removeListener(listener));
}
