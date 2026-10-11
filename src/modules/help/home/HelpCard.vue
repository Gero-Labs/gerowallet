<template>
  <section class="glass-panel help-card" :class="{ 'help-card--inset': inset }" :aria-labelledby="id">
    <div class="help-card__head">
      <h2 :id="id" class="t-label">{{ title }}</h2>
      <slot name="action" />
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ id: string; title: string; inset?: boolean }>(), { inset: false });
</script>

<style scoped>
.help-card { display: flex; flex-direction: column; gap: var(--g-s-3); min-width: 0; padding: var(--g-s-5); }
/* Cards whose rows draw their own 12px gutter (hover fill) pull the card padding in to match. */
.help-card--inset { padding: var(--g-s-5) var(--g-s-3) var(--card-pad-bottom, var(--g-s-3)); }
.help-card__head { display: flex; align-items: center; justify-content: space-between; gap: var(--g-s-3); }
.help-card--inset .help-card__head { padding: 0 var(--g-s-3); }
.help-card__head h2 { margin: 0; }
/* Tertiary links sit flush with the card's text edge. */
.help-card__head :deep(.g-btn) { margin-right: calc(-1 * var(--g-s-3)); }
.help-card--inset .help-card__head :deep(.g-btn) { margin-right: calc(-1 * var(--g-s-1)); }
@media (max-width: 640px) {
  .help-card { padding: 20px; gap: 10px; }
  .help-card--inset { padding: 20px var(--g-s-2) var(--g-s-2); gap: 10px; }
  .help-card--inset .help-card__head :deep(.g-btn) { margin-right: calc(-1 * var(--g-s-2)); }
}
</style>
