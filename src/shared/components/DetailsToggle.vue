<template>
  <div class="details-toggle">
    <span :id="labelId" class="t-body-sm details-toggle__label">{{ $t('common.details') }}</span>
    <!-- The key hint is decoration for sighted users; the switch's description says the same. -->
    <kbd
      class="t-caption g-mono details-toggle__key"
      :class="{ 'details-toggle__key--held': peeking }"
      :title="$t('detailsLayer.peekHint')"
      aria-hidden="true"
    >Alt</kbd>
    <button
      type="button"
      role="switch"
      class="details-toggle__switch"
      :class="{ 'details-toggle__switch--on': modelValue }"
      :aria-checked="modelValue ? 'true' : 'false'"
      :aria-labelledby="labelId"
      :aria-describedby="hintId"
      @click="emit('update:modelValue', !modelValue)"
    >
      <span class="details-toggle__thumb" aria-hidden="true" />
    </button>
    <span :id="hintId" class="g-sr-only">{{ $t('detailsLayer.peekHint') }}</span>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';

/**
 * The Details layer switch with its Alt hint. Bind it to `useDetailsLayer(screen)`:
 * `v-model` to `enabled` and `peeking` to `peeking`. The switch shows (and announces)
 * only the remembered state; a peek lights the key hint instead of moving the switch.
 */
withDefaults(defineProps<{
  modelValue: boolean;
  /** Alt is held: the technical layer is shown for the moment, whatever the switch says. */
  peeking?: boolean;
}>(), { peeking: false });

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

const id = useId();
const labelId = `details-toggle-label-${id}`;
const hintId = `details-toggle-hint-${id}`;
</script>

<style scoped>
.details-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
}
.details-toggle__label {
  color: var(--g-text-2);
}
.details-toggle__key {
  padding: 0 var(--g-s-1);
  border: 1px solid var(--g-hairline-2);
  border-bottom-width: 2px;
  border-radius: var(--g-r-chip);
  color: var(--g-text-3);
  transition: border-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}
.details-toggle__key--held {
  border-color: var(--g-accent);
  color: var(--g-text-1);
}
.details-toggle__switch {
  display: inline-flex;
  align-items: center;
  width: 36px;
  height: 20px;
  padding: 2px;
  border: 0;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}
.details-toggle__switch--on {
  background: var(--g-accent);
}
.details-toggle__thumb {
  width: 16px;
  height: 16px;
  border-radius: var(--g-r-pill);
  background: var(--g-text-1);
  transition: transform var(--g-dur-fast) var(--g-ease);
}
.details-toggle__switch--on .details-toggle__thumb {
  transform: translateX(16px);
  background: var(--g-on-grad);
}
</style>
