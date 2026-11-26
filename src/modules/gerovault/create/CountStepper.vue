<template>
  <div class="count-stepper">
    <div class="count-stepper__label">
      <span :id="labelId" class="t-label">{{ label }}</span>
      <InfoTooltip v-if="info" :label="label" :text="info" />
    </div>
    <div class="count-stepper__controls" role="group" :aria-labelledby="labelId">
      <GButton compact :aria-label="decreaseLabel" :disabled="value <= min" data-test="count-decrease" @click="emit('update', value - 1)">
        <v-icon size="small" aria-hidden="true">mdi-minus</v-icon>
      </GButton>
      <output class="count-stepper__value t-heading g-mono" aria-live="polite">{{ display ?? value }}</output>
      <GButton compact :aria-label="increaseLabel" :disabled="value >= max" data-test="count-increase" @click="emit('update', value + 1)">
        <v-icon size="small" aria-hidden="true">mdi-plus</v-icon>
      </GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import InfoTooltip from '@/shared/components/InfoTooltip.vue';

/** A whole number moved one step at a time between `min` and `max`, as the template's counts are. */
defineProps<{
  label: string;
  info?: string;
  value: number;
  min: number;
  max: number;
  /** What the value reads as, when not the bare number (for example "2 / 3"). */
  display?: string;
  decreaseLabel: string;
  increaseLabel: string;
}>();

const emit = defineEmits<{ update: [value: number] }>();

const labelId = `count-stepper-${useId()}`;
</script>

<style scoped>
.count-stepper {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-3);
}
.count-stepper__label {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}
.count-stepper__controls {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-3);
}
.count-stepper__value {
  min-width: 64px;
  text-align: center;
  color: var(--g-text-1);
}
</style>
