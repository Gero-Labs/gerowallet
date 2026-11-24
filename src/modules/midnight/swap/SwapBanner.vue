<template>
  <div class="swap-banner t-body-sm" :class="`swap-banner--${tone}`" :role="tone === 'error' ? 'alert' : 'status'">
    <v-icon size="16" class="swap-banner__icon" aria-hidden="true">{{ icon }}</v-icon>
    <span class="swap-banner__text"><slot></slot></span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ tone?: 'info' | 'success' | 'warning' | 'error' }>(), { tone: 'info' });

const icon = computed(() => ({
  info: 'mdi-information-outline',
  success: 'mdi-check-circle-outline',
  warning: 'mdi-alert-outline',
  error: 'mdi-alert-circle-outline',
})[props.tone]);
</script>

<style scoped lang="scss">
.swap-banner {
  display: flex;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-hairline-1);
  color: var(--g-text-1);
}

.swap-banner__icon { flex: 0 0 auto; margin-top: 1px; }
.swap-banner__text { display: flex; flex-direction: column; gap: var(--g-s-1); min-width: 0; }

.swap-banner--success { border-color: var(--g-success-line); background: var(--g-success-fill); }
.swap-banner--success .swap-banner__icon { color: var(--g-success); }
.swap-banner--warning { border-color: var(--g-warning-line); background: var(--g-warning-fill); }
.swap-banner--warning .swap-banner__icon { color: var(--g-warning); }
.swap-banner--error { border-color: var(--g-error-line); background: var(--g-error-fill); }
.swap-banner--error .swap-banner__icon { color: var(--g-error); }
.swap-banner--info .swap-banner__icon { color: var(--g-accent); }
</style>
