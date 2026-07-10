<template>
  <div v-if="active" class="loading-overlay" role="status" aria-live="polite">
    <v-progress-circular indeterminate color="primary" :size="size" :width="3" />
    <p v-if="label" class="t-body-sm loading-overlay__label">{{ label }}</p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  active?: boolean;
  label?: string;
  size?: number;
}>(), { active: true, size: 32 });
</script>

<style scoped>
/* The spinner is the only motion here: spinners inside a LoadingOverlay (or
   inside a button) are the sanctioned exception to the no-loops rule. */
.loading-overlay {
  position: absolute;
  inset: 0;
  /* Local stacking context inside the host card, not a page layer: the
     --g-z-* ladder is reserved for page-level chrome (sticky/dock/sheet/toast). */
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  /* The alpha belongs to the scrim, not the container. `opacity` here would
     also dim the spinner and label, cutting their own contrast rather than
     just letting the content behind show through. */
  background: color-mix(in srgb, var(--g-overlay) 60%, transparent);
  border-radius: inherit;
}
.loading-overlay__label {
  margin: 0;
  color: var(--g-text-2);
}
</style>
