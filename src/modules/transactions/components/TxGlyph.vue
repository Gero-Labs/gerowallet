<template>
  <span :class="['tx-glyph', `tx-glyph--${tone}`, { 'tx-glyph--large': large }]" aria-hidden="true">
    <v-icon :small="!large">{{ icon }}</v-icon>
  </span>
</template>

<script setup lang="ts">
import type { TxTone } from '@/modules/dashboard/utils/transactionClassifier';

// The round type glyph of a transaction (received, sent, swap, stake…). Purely
// decorative: the row's title carries the meaning for assistive tech.
withDefaults(defineProps<{
  icon: string;
  tone?: TxTone;
  large?: boolean;
}>(), { tone: 'neutral', large: false });
</script>

<style scoped>
.tx-glyph {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
}

.tx-glyph--large {
  width: 44px;
  height: 44px;
}

.tx-glyph .v-icon {
  color: var(--g-text-2);
}

.tx-glyph--in {
  background: var(--g-success-fill);
}

.tx-glyph--in .v-icon {
  color: var(--g-success);
}

.tx-glyph--accent {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
}

.tx-glyph--accent .v-icon {
  color: var(--g-accent);
}

.tx-glyph--warning {
  background: var(--g-warning-fill);
}

.tx-glyph--warning .v-icon {
  color: var(--g-warning);
}

.tx-glyph--error {
  background: var(--g-error-fill);
}

.tx-glyph--error .v-icon {
  color: var(--g-error);
}
</style>
