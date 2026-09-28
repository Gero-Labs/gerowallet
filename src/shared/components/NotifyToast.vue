<template>
  <v-snackbar
    :value="!!toast"
    :timeout="8000"
    top
    right
    class="notify-toast"
    content-class="notify-toast__content glass-popover"
    transition="scroll-y-transition"
    @input="(v) => { if (!v) dismiss(); }"
  >
    <div v-if="toast" class="notify-toast__text">
      <div class="t-label notify-toast__title">{{ toast.title }}</div>
      <div class="t-body-2 notify-toast__body">{{ toast.body }}</div>
    </div>
    <template #action>
      <v-btn text small color="var(--g-accent)" @click="view">{{ $t('PUSH_TOAST_VIEW') }}</v-btn>
      <v-btn icon small :aria-label="$t('PUSH_TOAST_DISMISS')" @click="dismiss"><v-icon small>mdi-close</v-icon></v-btn>
    </template>
  </v-snackbar>
</template>

<script setup lang="ts">
// The in-app toast for a push that arrived while this page was open (B8). Same
// strings as the system notification; "View" follows the notification's route.
import { computed, getCurrentInstance } from 'vue';
import { notifyToastStore } from '@/stores/notifyToastStore';

const props = defineProps<{ surface: 'dashboard' | 'sidepanel' }>();
const toast = computed(() => notifyToastStore.state.current);
const router = getCurrentInstance()?.proxy?.$router;

function dismiss() {
  notifyToastStore.dismiss();
}

function view() {
  const t = toast.value;
  if (!t) return;
  const path = props.surface === 'sidepanel' ? (t.route.sidepanel ?? '/') : t.route.dashboard;
  if (t.route.settingsTab && props.surface === 'dashboard') chrome.storage.local.set({ openSettingsOnLoad: { tab: t.route.settingsTab } });
  if (router && router.currentRoute.path !== path) router.push(path).catch(() => undefined);
  dismiss();
}
</script>

<style lang="scss" scoped>
// The toast sits on whatever page is open: a popover material (solid is justified
// for readability over imagery and tables), tokens only.
.notify-toast :deep(.notify-toast__content) {
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
}
.notify-toast__title { color: var(--g-text-1); }
.notify-toast__body { color: var(--g-text-2); }
</style>
