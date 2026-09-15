<template>
  <span v-if="timestamp" class="as-of t-caption">{{ $t('governance.asOf', { time: formatted }) }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';

// Runtime declaration, not defineProps<{...}>: Vue 2.7 compiles a `number | null`
// type literal into a `[Number, null]` runtime validator, and null is not a
// constructor — every render warns. `default: null` makes null skip validation.
const props = defineProps({
  timestamp: { type: Number as PropType<number | null>, default: null },
});

// Every value on this surface comes from a synced index, not live chain, so it
// is always stamped. Locale-aware short time; the date is implied by recency.
const formatted = computed(() =>
  props.timestamp ? new Date(props.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '',
);
</script>

<style scoped>
.as-of {
  color: var(--g-text-3);
  font-family: var(--g-font-ui);
}
</style>
