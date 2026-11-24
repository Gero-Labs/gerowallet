<template>
  <div class="swap-seg" :class="`swap-seg--${options.length}`" :role="role" :aria-labelledby="labelledby" :aria-label="ariaLabel">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="swap-seg__opt t-body-sm"
      :class="{ 'swap-seg__opt--on': option.value === modelValue }"
      :role="role === 'tablist' ? 'tab' : 'radio'"
      :aria-checked="role === 'tablist' ? undefined : option.value === modelValue"
      :aria-selected="role === 'tablist' ? option.value === modelValue : undefined"
      :data-test="`swap-seg-${option.value}`"
      @click="emit('update:modelValue', option.value)"
    >
      <v-icon v-if="option.icon" size="14" aria-hidden="true">{{ option.icon }}</v-icon>
      {{ option.label }}
    </button>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
withDefaults(defineProps<{
  modelValue: T;
  options: ReadonlyArray<{ value: T; label: string; icon?: string }>;
  /** `radiogroup` for a choice, `tablist` for switching views. */
  role?: 'radiogroup' | 'tablist';
  labelledby?: string;
  ariaLabel?: string;
}>(), { role: 'radiogroup', labelledby: undefined, ariaLabel: undefined });

const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>();
</script>

<style scoped lang="scss">
/* A control: a justified solid. */
.swap-seg {
  display: grid;
  gap: var(--g-s-1);
  padding: var(--g-s-1);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
}

.swap-seg--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.swap-seg--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

.swap-seg__opt {
  height: 32px;
  border-radius: var(--g-r-chip);
  border: 1px solid transparent;
  background: transparent;
  color: var(--g-text-2);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
}

.swap-seg__opt:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 1px;
}

.swap-seg__opt--on {
  background: var(--g-overlay);
  border-color: var(--g-hairline-3);
  color: var(--g-text-1);
}
</style>
