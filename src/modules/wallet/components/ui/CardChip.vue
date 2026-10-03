<template>
  <button v-if="clickable" type="button" class="card-chip is-clickable" :class="`card-chip--${tone}`" v-on="$listeners">
    <v-icon v-if="icon" x-small>{{ icon }}</v-icon>
    <slot />
  </button>
  <span v-else class="card-chip" :class="`card-chip--${tone}`">
    <v-icon v-if="icon" x-small>{{ icon }}</v-icon>
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'accent' | 'success' | 'warning' | 'error' | 'neutral';
  icon?: string;
  /** Renders a real <button> (listeners pass through). */
  clickable?: boolean;
}>(), { tone: 'neutral', icon: undefined, clickable: false });
</script>

<style lang="scss" scoped>
/* A chip is a control-scale label, so its tinted fill is a justified solid. */
.card-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  height: 24px;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-2);
  background: var(--g-hairline-1);
  color: var(--g-text-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;

  .v-icon {
    color: inherit;
  }
}

.is-clickable {
  cursor: pointer;
  transition: background-color var(--g-dur-fast) ease-out, border-color var(--g-dur-fast) ease-out;
}

.card-chip--accent {
  border-color: color-mix(in srgb, var(--g-accent) 25%, transparent);
  background: color-mix(in srgb, var(--g-accent) 10%, transparent);
  color: var(--g-accent);
}

.card-chip--accent.is-clickable:hover {
  border-color: color-mix(in srgb, var(--g-accent) 45%, transparent);
}

.card-chip--success {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.card-chip--warning {
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.card-chip--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}
</style>
