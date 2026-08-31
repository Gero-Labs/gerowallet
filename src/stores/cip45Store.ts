import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import type { Cip45Session, Cip45Status } from '@/services/cip45/types';

export interface Cip45State {
  status: Cip45Status;
  session: Cip45Session | null;
}

export const cip45State = Vue.observable<Cip45State>({
  status: 'idle',
  session: null,
});

const STORE_NAME = 'cip45State';
const context = getContextType();

if (context === 'browser') {
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<Cip45State>) => {
    Object.keys(updates).forEach(key => {
      if (key in cip45State) {
        (cip45State as unknown as Record<string, unknown>)[key] = updates[key as keyof Cip45State];
      }
    });
  });

  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(cip45State, result[STORE_NAME]);
    }
  });
}

let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

function broadcastFromBackground(updates: Partial<Cip45State>) {
  if (context === 'background') {
    Object.assign(cip45State, updates);
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    if (storageWriteTimeout) clearTimeout(storageWriteTimeout);
    storageWriteTimeout = setTimeout(() => {
      chrome.storage.local.set({ [STORE_NAME]: cip45State });
    }, 300);
  }
}

const Cip45Store = {
  setSession(status: Cip45Status, session: Cip45Session | null) {
    broadcastFromBackground({ status, session });
  },

  clear() {
    broadcastFromBackground({ status: 'idle', session: null });
  },
};

export default Cip45Store;
