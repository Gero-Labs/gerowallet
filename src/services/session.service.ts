import SessionStore from '@/stores/sessionStore';
import { getContextType } from '@/utils/storageSync';

type LockReason = 'idle' | 'manual';

type LockCallback = (reason: LockReason) => void;
type UnlockCallback = () => void;

class SessionService {
  private lockCallbacks = new Set<LockCallback>();
  private unlockCallbacks = new Set<UnlockCallback>();
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private isInitialized = false;

  initialize() {
    if (this.isInitialized) return;
    if (getContextType() !== 'background') return;

    this.isInitialized = true;
    this.resetInactivityTimer();
    this.setupIdleDetection();
  }

  onLock(callback: LockCallback): () => void {
    this.lockCallbacks.add(callback);
    return () => this.lockCallbacks.delete(callback);
  }

  onUnlock(callback: UnlockCallback): () => void {
    this.unlockCallbacks.add(callback);
    return () => this.unlockCallbacks.delete(callback);
  }

  touch() {
    SessionStore.touchLastActivity();
    this.resetInactivityTimer();
  }

  lock(reason: LockReason = 'manual') {
    if (!SessionStore.state.isUnlocked) {
      return;
    }

    this.clearInactivityTimer();
    SessionStore.setUnlocked(false, reason);
    this.lockCallbacks.forEach(cb => cb(reason));
  }

  unlock() {
    if (SessionStore.state.isUnlocked) {
      return;
    }

    SessionStore.setUnlocked(true, null);
    SessionStore.touchLastActivity();
    this.resetInactivityTimer();
    this.unlockCallbacks.forEach(cb => cb());
  }

  reset() {
    this.clearInactivityTimer();
    SessionStore.setUnlocked(true, null);
    SessionStore.touchLastActivity();
  }

  isUnlocked(): boolean {
    return SessionStore.state.isUnlocked;
  }

  private setupIdleDetection() {
    if (!chrome?.idle) {
      return;
    }

    const intervalInSeconds = Math.max(15, Math.floor(SessionStore.state.autoLockTimeoutMs / 1000));
    chrome.idle.setDetectionInterval(intervalInSeconds);

    chrome.idle.onStateChanged.addListener(state => {
      if (state === 'idle' || state === 'locked') {
        this.lock('idle');
      } else if (state === 'active') {
        this.touch();
      }
    });
  }

  private resetInactivityTimer() {
    this.clearInactivityTimer();
    const timeout = SessionStore.state.autoLockTimeoutMs;
    this.inactivityTimer = setTimeout(() => {
      this.lock('idle');
    }, timeout);
  }

  private clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

export const sessionService = new SessionService();
export default sessionService;

