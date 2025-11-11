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

if (context === 'background') {
  persistState();
  broadcastFromBackground(serializeSessionState());
}

