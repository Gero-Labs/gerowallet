import Vue from 'vue';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';
import type { WCSession } from '@/services/walletConnect/types';

export interface WalletConnectState {
  activeSessions: WCSession[];
  isInitialized: boolean;
}

export const walletConnectState = Vue.observable<WalletConnectState>({
  activeSessions: [],
  isInitialized: false,
});

const STORE_NAME = 'walletConnectState';
const context = getContextType();

if (context === 'browser') {
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<WalletConnectState>) => {
    Object.keys(updates).forEach(key => {
      if (key in walletConnectState) {
        (walletConnectState as any)[key] = updates[key as keyof WalletConnectState];
      }
    });
  });

  chrome.storage.local.get(STORE_NAME, (result) => {
    if (result[STORE_NAME]) {
      Object.assign(walletConnectState, result[STORE_NAME]);
    }
  });
}

let storageWriteTimeout: ReturnType<typeof setTimeout> | null = null;

function broadcastFromBackground(updates: Partial<WalletConnectState>) {
  if (context === 'background') {
    Object.assign(walletConnectState, updates);
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);

    if (storageWriteTimeout) clearTimeout(storageWriteTimeout);
    storageWriteTimeout = setTimeout(() => {
      chrome.storage.local.set({ [STORE_NAME]: walletConnectState });
    }, 300);
  }
}

const WalletConnectStore = {
  setActiveSessions(sessions: WCSession[]) {
    broadcastFromBackground({ activeSessions: sessions });
  },

  setInitialized(initialized: boolean) {
    broadcastFromBackground({ isInitialized: initialized });
  },

  addSession(session: WCSession) {
    const sessions = [...walletConnectState.activeSessions, session];
    broadcastFromBackground({ activeSessions: sessions });
  },

  removeSession(topic: string) {
    const sessions = walletConnectState.activeSessions.filter(s => s.topic !== topic);
    broadcastFromBackground({ activeSessions: sessions });
  },

  clear() {
    broadcastFromBackground({ activeSessions: [], isInitialized: false });
  },
};

export default WalletConnectStore;
