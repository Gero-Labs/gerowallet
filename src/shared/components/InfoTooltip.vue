<template>
  <!-- The house tooltip recipe (content-class="custom-tooltip"). Vuetify's tooltip
       gives the overlay role="tooltip", ties it to the trigger with aria-describedby,
       renders it eagerly so the description is there before it opens, and opens it on
       hover and on keyboard focus. -->
  <v-tooltip
    :location="location"
    content-class="custom-tooltip"
    :transition="reducedMotion ? false : undefined"
  >
    <template #activator="{ props: activatorProps }">
      <button
        type="button"
        class="info-tooltip__trigger"
        v-bind="activatorProps"
        :aria-label="label"
      >
        <v-icon size="16" aria-hidden="true">mdi-information-outline</v-icon>
      </button>
    </template>
    <span class="t-body-sm">{{ text }}</span>
  </v-tooltip>
</template>

<script setup lang="ts">
/**
 * An info icon whose explanation lives in a tooltip, so explanatory copy stays off
 * the page. Reachable without a mouse: the trigger is a real button and keyboard
 * focus shows the tooltip.
 */
withDefaults(defineProps<{
  /** The trigger's accessible name, e.g. "About vaults". */
  label: string;
  /** The explanation. */
  text: string;
  location?: 'top' | 'bottom' | 'start' | 'end';
}>(), { location: 'bottom' });

// Reduced motion: no open or close transition at all (the global reduced-motion rule
// only shortens CSS transitions; this drops Vuetify's scale/fade).
const reducedMotion = typeof window !== 'undefined'
  && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
</script>

<style scoped>
.info-tooltip__trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: calc(-1 * var(--g-s-1));
  padding: 0;
  border: 0;
  border-radius: var(--g-r-control);
  background: transparent;
  color: var(--g-text-3);
  cursor: help;
}
.info-tooltip__trigger:hover {
  color: var(--g-text-2);
}
</style>
