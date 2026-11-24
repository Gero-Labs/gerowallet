<template>
  <!-- A short explanation behind an info icon: on hover and on keyboard focus, and read out by screen readers. -->
  <v-tooltip location="top" max-width="300" content-class="custom-tooltip" :open-on-focus="true">
    <template #activator="{ props: activator }">
      <button v-bind="activator" type="button" class="swap-hint" :aria-label="text" data-test="swap-hint">
        <v-icon size="14" aria-hidden="true">mdi-information-outline</v-icon>
      </button>
    </template>
    <span>{{ text }}</span>
  </v-tooltip>
</template>

<script setup lang="ts">
defineProps<{ text: string }>();
</script>

<style scoped lang="scss">
.swap-hint {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: var(--g-r-pill);
  background: none;
  color: var(--g-text-3);
  cursor: help;
  vertical-align: middle;
}

.swap-hint:hover {
  color: var(--g-text-1);
}

.swap-hint:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 1px;
}
</style>
