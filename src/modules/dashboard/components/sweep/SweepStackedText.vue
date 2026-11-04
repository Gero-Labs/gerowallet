<template>
  <!-- One slot of the progress panel: the text it shows now, with every other text it can
       show laid in the same grid cell, hidden. The cell takes the size of the largest, so
       the slot, and the centred dialog around it, keeps its size when the text changes. -->
  <span class="sweep-stacked">
    <span>{{ tt(shown) }}</span>
    <span v-for="option in others" :key="option.key" class="sweep-stacked__sizer" aria-hidden="true">{{ tt(option) }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { SweepText } from './sweepProgressView';

const props = defineProps<{
  /** The text the slot shows now. */
  shown: SweepText;
  /** Every text the slot can show, `shown` among them; only their size is used. */
  options?: SweepText[];
}>();

const { t, tc } = useTranslation();

const tt = (value: SweepText): string =>
  (value.choice === undefined ? t(value.key, value.params) : tc(value.key, value.choice, value.params));
const others = computed(() => (props.options ?? []).filter((option) => option.key !== props.shown.key));
</script>

<style scoped>
.sweep-stacked {
  display: grid;
}

.sweep-stacked > * {
  grid-area: 1 / 1;
}

/* Out of sight and out of the accessibility tree, but still sizing the cell. */
.sweep-stacked__sizer {
  visibility: hidden;
}
</style>
