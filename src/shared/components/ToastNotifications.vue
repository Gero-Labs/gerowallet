<template>
  <div class="gero-toast-host" aria-live="polite" aria-atomic="false">
    <div v-for="message in toastMessages" :key="message.id"
      class="gero-toast" :class="`gero-toast--${message.theme}`" role="status">
      <span>{{ message.text }}</span>
      <v-btn icon="mdi-close" variant="text" size="small"
        :aria-label="$t('common.close')" @click="dismissToast(message.id)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { toastMessages, dismissToast } from '@/plugins/snackbar';
</script>

<style scoped>
.gero-toast-host {
  position: fixed;
  top: var(--g-s-4);
  right: var(--g-s-4);
  z-index: var(--g-z-toast);
  display: grid;
  gap: var(--g-s-2);
  max-width: min(480px, calc(100vw - 40px));
  pointer-events: none;
}
.gero-toast {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3) var(--g-s-4);
  border: 1px solid var(--g-hairline-3);
  border-radius: var(--g-r-control);
  background: var(--g-overlay);
  color: var(--g-text-1);
  box-shadow: var(--g-shadow-menu);
  overflow-wrap: anywhere;
  pointer-events: auto;
}
.gero-toast--error { border-color: rgb(var(--v-theme-error)); }
.gero-toast--success { border-color: rgb(var(--v-theme-success)); }
</style>
