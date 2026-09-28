<template>
  <div class="notify-snack-host" aria-live="polite">
    <transition-group name="notify-snack" tag="div" class="notify-snack-stack">
      <div v-for="snack in items" :key="snack.id" class="notify-snack" role="status">
        <div class="notify-snack__text">
          <span class="notify-snack__title">{{ snack.title }}</span>
          <span class="notify-snack__body">{{ snack.body }}</span>
          <button type="button" class="notify-snack__open" @click="open(snack)">{{ $t('notify.inbox.open') }}</button>
        </div>
        <button type="button" class="notify-snack__close" :aria-label="$t('common.close')" @click="dismiss(snack.id)">
          <v-icon size="16" color="var(--g-text-2)">mdi-close</v-icon>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
// Top-right stack for pushes that arrive while this page is focused (B8). Same material as the
// app's other snackbars, its own host so the two never move each other. "Open" follows the
// push's route the way a notification click does.
import { computed, getCurrentInstance } from 'vue';
import { notifySnackStore, type NotifySnack } from '@/stores/notifySnackStore';

const items = computed(() => notifySnackStore.state.items);
const router = getCurrentInstance()?.proxy?.$router;

function dismiss(id: number) { notifySnackStore.dismiss(id); }

function open(snack: NotifySnack) {
  if (snack.settingsTab) void chrome.storage.local.set({ openSettingsOnLoad: { tab: snack.settingsTab } });
  if (router && router.currentRoute.fullPath !== snack.path) router.push(snack.path).catch(() => undefined);
  dismiss(snack.id);
}
</script>

<style scoped lang="scss">
.notify-snack-host {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: var(--g-z-toast);
  width: max-content;
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}
.notify-snack-stack { display: flex; flex-direction: column; gap: var(--g-s-2); }
.notify-snack {
  // Popover material: solid enough to read over charts and tables (same call as the app's other snackbars).
  @include g-glass-overlay();
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: 12px 16px;
  border: 1px solid var(--g-hairline-3);
  border-radius: var(--g-r-card);
  box-shadow: var(--g-shadow-menu);
  color: var(--g-text-1);
  font-size: 14px;
  pointer-events: auto;
}
.notify-snack__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.notify-snack__title { font-weight: 600; }
.notify-snack__body { color: var(--g-text-2); overflow-wrap: anywhere; }
.notify-snack__open {
  align-self: flex-start;
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.notify-snack__close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--g-r-control);
  background: none;
  cursor: pointer;
  &:hover { background: var(--g-hairline-1); }
}
.notify-snack-enter-active,
.notify-snack-leave-active { transition: opacity var(--g-dur-base), transform var(--g-dur-base); }
.notify-snack-enter,
.notify-snack-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
