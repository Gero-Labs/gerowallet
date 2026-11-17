<template>
  <!-- One note style for warnings and errors that sit beside a control: the
       glyph and text in the tone colour on the muted fill and line pair. -->
  <div class="g-note t-caption" :class="`g-note--${tone}`" :role="role" data-test="g-note">
    <v-icon v-if="icon" size="14" class="g-note__icon" aria-hidden="true">{{ icon }}</v-icon>
    <div class="g-note__body"><slot /></div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  tone?: 'warning' | 'error';
  /** An mdi glyph, drawn in the tone colour. */
  icon?: string;
  /** `status` for a state the user should know about, `alert` for an error they just caused. */
  role?: 'status' | 'alert';
}>(), { tone: 'warning', icon: undefined, role: undefined });
</script>

<style scoped lang="scss">
.g-note {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-1);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid transparent;
  border-radius: var(--g-r-control);
  text-align: left;
}

.g-note--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}

.g-note--error {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}

.g-note__icon {
  flex: none;
  color: inherit;
}

.g-note__body {
  flex: 1;
  min-width: 0;
}
</style>
