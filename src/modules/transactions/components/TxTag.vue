<template>
  <span class="tx-tag">
    <v-icon v-if="tag.icon" x-small class="tx-tag__icon">{{ tag.icon }}</v-icon>
    <span v-if="tag.handle" class="tx-tag__handle">$</span>{{ tag.label }}
  </span>
</template>

<script setup lang="ts">
import type { TxTag } from '@/modules/dashboard/utils/transactionClassifier';

// A quiet outlined tag for a protocol event, venue or contact. Deliberately
// neutral: the chain accent is the only color a transaction row may use for
// state, so venue brands are named, not painted.
defineProps<{ tag: TxTag }>();
</script>

<style scoped>
.tx-tag {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  height: 18px;
  padding: 0 6px;
  border: 1px solid var(--g-hairline-3);
  border-radius: var(--g-r-chip);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  color: var(--g-text-2);
  white-space: nowrap;
}

.tx-tag .tx-tag__icon {
  color: var(--g-text-3);
}

.tx-tag__handle {
  color: var(--g-success);
  font-weight: 700;
}
</style>
