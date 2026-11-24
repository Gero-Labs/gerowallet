<template>
  <span class="swap-chip t-caption" :class="`swap-chip--${SWAP_STATUS_TONE[status]}`" :data-test="`swap-status-${status}`">
    <slot>{{ t(`midnight.swap.status.${status}`) }}</slot>
  </span>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { SWAP_STATUS_TONE, type SwapDisplayStatus } from './swapStatus';

defineProps<{ status: SwapDisplayStatus }>();
const { t } = useTranslation();
</script>

<style scoped lang="scss">
/* A chip: a justified solid. */
.swap-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  height: 22px;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-raised);
  color: var(--g-text-2);
  white-space: nowrap;
}

.swap-chip--accent {
  color: var(--g-accent);
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.swap-chip--success { color: var(--g-success); background: var(--g-success-fill); border-color: var(--g-success-line); }
.swap-chip--warning { color: var(--g-warning); background: var(--g-warning-fill); border-color: var(--g-warning-line); }
</style>
