<template>
  <div class="tally">
    <div class="tally__track" role="img" :aria-label="ariaLabel">
      <div class="tally__yes" :style="{ width: yesWidth }"></div>
      <div class="tally__no" :style="{ width: noWidth }"></div>
      <div v-if="thresholdPct !== null" class="tally__threshold" :style="{ left: thresholdLeft }"></div>
    </div>
    <div v-if="!available" class="tally__unavailable t-caption">{{ $t('governance.tallyUnavailable') }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';

// Runtime declaration — `number | null` type literals compile to `[Number, null]`
// validators and warn on every render (null is not a constructor). See AsOf.vue.
const props = defineProps({
  yesPct: { type: Number as PropType<number | null>, default: null },
  noPct: { type: Number as PropType<number | null>, default: null },
  thresholdPct: { type: Number as PropType<number | null>, default: null },
  available: { type: Boolean, required: true },
});

const { t } = useTranslation();

function clamp(v: number | null): number {
  if (v === null || Number.isNaN(v)) return 0;
  return Math.min(100, Math.max(0, v));
}

const yesWidth = computed(() => `${clamp(props.yesPct)}%`);
const noWidth = computed(() => `${clamp(props.noPct)}%`);
const thresholdLeft = computed(() => `${clamp(props.thresholdPct)}%`);

const ariaLabel = computed(() =>
  props.available
    ? String(t('governance.tallyAria', { yes: clamp(props.yesPct).toFixed(2), no: clamp(props.noPct).toFixed(2) }))
    : String(t('governance.tallyUnavailable')),
);
</script>

<style scoped>
.tally__track {
  position: relative;
  display: flex;
  height: var(--g-s-2);
  border-radius: var(--g-r-pill);
  overflow: hidden;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}
.tally__yes {
  background: var(--g-success);
  transition: width var(--g-dur-base) var(--g-ease);
}
.tally__no {
  background: var(--g-error);
  transition: width var(--g-dur-base) var(--g-ease);
}
/* The ratification threshold, drawn as a hairline over the track. */
.tally__threshold {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: var(--g-text-1);
}
.tally__unavailable {
  color: var(--g-text-3);
  margin-top: var(--g-s-1);
}
</style>
