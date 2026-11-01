// The in-app notification centre behind the bell (B-M3). The worker writes every push it
// showed to the `notifyInbox` key of the notify store (private store, notifyStorage.ts);
// pages mirror that key here and send NOTIFY_INBOX_READ / NOTIFY_INBOX_CLEAR back, so the
// worker stays the only writer.

import { reactive } from 'vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { NotifyInboxItem } from '@/services/notify/notifyStore';
import { onNotifyKeyChanged, readNotifyKey } from '@/services/notify/notifyStorage';

export type { NotifyInboxItem };

const KEY = 'notifyInbox';

interface NotifyInboxState {
  items: NotifyInboxItem[];
  loaded: boolean;
}

const state = reactive<NotifyInboxState>({ items: [], loaded: false });

function isItem(v: unknown): v is NotifyInboxItem {
  return !!v && typeof v === 'object' && typeof (v as NotifyInboxItem).e === 'string' && typeof (v as NotifyInboxItem).title === 'string' && typeof (v as NotifyInboxItem).ts === 'number';
}

function accept(v: unknown): void {
  state.items = Array.isArray(v) ? v.filter(isItem) : [];
  state.loaded = true;
}

const inExtension = () => typeof chrome !== 'undefined' && !!chrome.runtime?.id && !!chrome.storage;

function reload(): void {
  readNotifyKey(KEY).then(accept, () => accept(undefined));
}

let subscribed = false;
function subscribe(): void {
  if (subscribed || !inExtension()) return;
  subscribed = true;
  reload();
  onNotifyKeyChanged(KEY, reload);
}

export const notifyInboxStore = {
  state,
  /** Idempotent: the first caller wires the storage mirror. */
  init(): void { subscribe(); },
  items(): NotifyInboxItem[] { return state.items; },
  unread(): number { return state.items.filter((i) => i.readAt === null).length; },
  async markRead(e: string | null): Promise<void> {
    const now = Date.now();
    // Optimistic: the storage change from the worker confirms it a moment later.
    state.items = state.items.map((i) => ((e === null || i.e === e) && i.readAt === null ? { ...i, readAt: now } : i));
    await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.NOTIFY_INBOX_READ, data: e === null ? {} : { e } });
  },
  async clear(): Promise<void> {
    state.items = [];
    await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.NOTIFY_INBOX_CLEAR, data: {} });
  },
};

export default notifyInboxStore;
