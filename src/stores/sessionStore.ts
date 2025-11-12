import Vue from 'vue';
import { getContextType, smartPersist } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

type LockReason = 'idle' | 'manual' | null;

export interface SessionState {
  isUnlocked: boolean;
  lockedReason: LockReason;
  lockedAt: number | null;
  lastActivityAt: number;
  autoLockTimeoutMs: number;
}

const DEFAULT_AUTO_LOCK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const STORE_NAME = 'sessionStore';
const context = getContextType();

const sessionState = Vue.observable<SessionState>({
  isUnlocked: false,
  lockedReason: null,
  lockedAt: null,
  lastActivityAt: Date.now(),
  autoLockTimeoutMs: DEFAULT_AUTO_LOCK_TIMEOUT_MS,
});

function broadcastFromBackground(updates: Partial<SessionState>) {
  if (context === 'background') {
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);
  }
}

function serializeSessionState(): SessionState {
  return {
    isUnlocked: sessionState.isUnlocked,
    lockedReason: sessionState.lockedReason,
    lockedAt: sessionState.lockedAt,
    lastActivityAt: sessionState.lastActivityAt,
    autoLockTimeoutMs: sessionState.autoLockTimeoutMs,
  };
}

function persistState() {
  if (context !== 'background') {
    return;
  }
  void smartPersist(STORE_NAME, serializeSessionState());
}

if (context === 'browser') {
  storeMessaging.subscribe(STORE_NAME, updates => {
    Object.assign(sessionState, updates);
  });
}

export default {
  state: sessionState,

  setUnlocked(isUnlocked: boolean, reason: LockReason = null) {
    if (sessionState.isUnlocked === isUnlocked && sessionState.lockedReason === reason) {
      return;
    }

    sessionState.isUnlocked = isUnlocked;
    sessionState.lockedReason = isUnlocked ? null : reason;
    sessionState.lockedAt = isUnlocked ? null : Date.now();

    broadcastFromBackground({
      isUnlocked: sessionState.isUnlocked,
      lockedReason: sessionState.lockedReason,
      lockedAt: sessionState.lockedAt,
    });
    persistState();
  },

  touchLastActivity(options: { broadcast?: boolean } = {}) {
    sessionState.lastActivityAt = Date.now();
    if (options.broadcast) {
      broadcastFromBackground({ lastActivityAt: sessionState.lastActivityAt });
    }
    persistState();
  },

  setAutoLockTimeout(timeoutMs: number) {
    if (sessionState.autoLockTimeoutMs === timeoutMs) {
      return;
    }
    sessionState.autoLockTimeoutMs = timeoutMs;
    broadcastFromBackground({ autoLockTimeoutMs: timeoutMs });
    persistState();
  },
};

let hydrationPromise: Promise<void> | null = null;

if (context === 'background') {
  // Hydrate session state from storage on startup
  hydrationPromise = (async () => {
    try {
      const result = await chrome.storage.local.get(STORE_NAME);
      const storedData = result[STORE_NAME] as SessionState | undefined;
      if (storedData) {
        Object.assign(sessionState, storedData);
        // Ensure autoLockTimeoutMs is at least 2 minutes
        if (sessionState.autoLockTimeoutMs < DEFAULT_AUTO_LOCK_TIMEOUT_MS) {
          sessionState.autoLockTimeoutMs = DEFAULT_AUTO_LOCK_TIMEOUT_MS;
        }
        broadcastFromBackground(serializeSessionState());
      } else {
        // First time initialization - persist defaults
        persistState();
        broadcastFromBackground(serializeSessionState());
      }
    } catch (error) {
      console.error('Failed to hydrate session store:', error);
      // Fallback to defaults
      persistState();
      broadcastFromBackground(serializeSessionState());
    }
  })();
}

export function waitForHydration(): Promise<void> {
  return hydrationPromise || Promise.resolve();
}

