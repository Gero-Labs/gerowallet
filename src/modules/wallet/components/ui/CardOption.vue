<template>
  <!-- A choice card: a real radio input, so arrow keys and screen readers work. -->
  <label class="card-option" :class="{ 'is-selected': selected, 'is-disabled': disabled }">
    <input
      type="radio"
      class="card-option__input"
      :name="name"
      :value="value"
      :checked="selected"
      :disabled="disabled"
      @change="emit('select', value)"
    />
    <span class="card-option__radio" aria-hidden="true"></span>
    <span class="card-option__body">
      <span class="card-option__head">
        <span class="t-body-lg">{{ title }}</span>
        <slot name="badge" />
      </span>
      <span v-if="description" class="t-body-sm">{{ description }}</span>
      <slot />
    </span>
    <span v-if="$slots.aside" class="card-option__aside">
      <slot name="aside" />
    </span>
  </label>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  name: string;
  value: string;
  title: string;
  description?: string;
  selected?: boolean;
  disabled?: boolean;
}>(), { description: '', selected: false, disabled: false });

const emit = defineEmits<{ (e: 'select', value: string): void }>();
</script>

<style lang="scss" scoped>
.card-option {
  @include g-glass-tier;
  position: relative;
  display: flex;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
  border-color: var(--g-hairline-2);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease-out, background-color var(--g-dur-fast) ease-out;
}

.card-option:hover:not(.is-disabled) {
  @include g-glass-tier-hover;
}

.card-option:focus-within {
  border-color: var(--g-accent);
}

.card-option.is-selected {
  @include g-glass-tier-active;
  border-color: var(--g-accent);
  box-shadow: inset 0 0 0 1px var(--g-accent);
}

.card-option.is-disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

/* Visually hidden but still focusable and announced. */
.card-option__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.card-option__radio {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  margin-top: 2px;
  border-radius: var(--g-r-pill);
  border: 1.5px solid var(--g-hairline-3);
}

.is-selected .card-option__radio {
  border-color: var(--g-accent);
  background: radial-gradient(circle, var(--g-accent) 0 4px, transparent 4.5px);
}

.card-option__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  flex: 1;
  min-width: 0;
}

.card-option__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.card-option__aside {
  display: flex;
  align-items: center;
  flex: none;
}
</style>
