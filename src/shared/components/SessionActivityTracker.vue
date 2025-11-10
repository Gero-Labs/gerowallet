<template>
  <div class="session-activity-tracker" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue';
import SessionStore from '@/stores/sessionStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';

const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'wheel',
];

let inactivityTimer: ReturnType<typeof setTimeout> | null = null;
let activityThrottleTimer: ReturnType<typeof setTimeout> | null = null;
let activityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lockRetryTimer: ReturnType<typeof setTimeout> | null = null;
let isLocking = false;
let lastScheduleTimestamp = 0;
let lastVisibilityState = document.visibilityState;

const clearInactivityTimer = () => {
  if (!inactivityTimer) {
    return;
  }
  clearTimeout(inactivityTimer);
  inactivityTimer = null;
};

const sendActivityPing = () => {
  if (activityThrottleTimer) {
    return;
  }

  activityThrottleTimer = setTimeout(() => {
    activityThrottleTimer = null;
  }, 5_000);

  Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SESSION_ACTIVITY,
    data: {},
  }).catch(() => {
    /* no-op */
  });
};

const scheduleAutoLock = () => {
  clearInactivityTimer();

  if (!SessionStore.state.isUnlocked) {
    return;
  }

  const now = Date.now();
  if (now - lastScheduleTimestamp < 250) {
    return;
  }
  lastScheduleTimestamp = now;

  inactivityTimer = setTimeout(() => {
    if (isLocking || !SessionStore.state.isUnlocked) {
      return;
    }
    isLocking = true;
    clearInactivityTimer();
    SessionStore.setUnlocked(false, 'idle');
    requestBackgroundLock();
  }, SessionStore.state.autoLockTimeoutMs);
};

const requestBackgroundLock = (attempt = 0) => {
  if (lockRetryTimer) {
    clearTimeout(lockRetryTimer);
    lockRetryTimer = null;
  }

  Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.LOCK_SESSION,
    data: { reason: 'idle' },
  })
    .then((response: any) => {
      if (response?.data?.success) {
        isLocking = false;
        return;
      }

      scheduleLockRetry(attempt);
    })
    .catch(() => {
      scheduleLockRetry(attempt);
    });
};

const scheduleLockRetry = (attempt: number) => {
  if (attempt >= 3) {
    isLocking = false;
    return;
  }
  lockRetryTimer = setTimeout(() => {
    requestBackgroundLock(attempt + 1);
  }, 1000 * (attempt + 1));
};

const processActivity = () => {
  if (!SessionStore.state.isUnlocked) {
    return;
  }

  sendActivityPing();
  scheduleAutoLock();
};

const ACTIVITY_DEBOUNCE_MS = 600;

const debouncedActivity = () => {
  if (activityDebounceTimer) {
    clearTimeout(activityDebounceTimer);
  }
  activityDebounceTimer = setTimeout(() => {
    processActivity();
    activityDebounceTimer = null;
  }, ACTIVITY_DEBOUNCE_MS);
};

const handleVisibilityChange = () => {
  const currentState = document.visibilityState;
  if (currentState === 'visible' && lastVisibilityState !== 'visible') {
    processActivity();
  }
  lastVisibilityState = currentState;
};

onMounted(() => {
  scheduleAutoLock();
  sendActivityPing();

  ACTIVITY_EVENTS.forEach(eventName => {
    window.addEventListener(eventName, debouncedActivity, { passive: true });
  });

  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  clearInactivityTimer();

  ACTIVITY_EVENTS.forEach(eventName => {
    window.removeEventListener(eventName, debouncedActivity);
  });

  document.removeEventListener('visibilitychange', handleVisibilityChange);

  if (activityThrottleTimer) {
    clearTimeout(activityThrottleTimer);
    activityThrottleTimer = null;
  }
  if (activityDebounceTimer) {
    clearTimeout(activityDebounceTimer);
    activityDebounceTimer = null;
  }
  if (lockRetryTimer) {
    clearTimeout(lockRetryTimer);
    lockRetryTimer = null;
  }
});

watch(
  () => SessionStore.state.autoLockTimeoutMs,
  () => {
    scheduleAutoLock();
  }
);

watch(
  () => SessionStore.state.isUnlocked,
  isUnlocked => {
    if (isUnlocked) {
      isLocking = false;
      if (lockRetryTimer) {
        clearTimeout(lockRetryTimer);
        lockRetryTimer = null;
      }
      scheduleAutoLock();
      sendActivityPing();
    } else {
      clearInactivityTimer();
    }
  }
);
</script>

<style scoped>
.session-activity-tracker {
  display: none;
}
</style>

