<template>
  <!-- The warning pair, so the network never reads as the chain accent. -->
  <span class="swap-net t-caption" data-test="swap-net-badge">
    <v-icon size="12" aria-hidden="true">mdi-flask-outline</v-icon>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
defineProps<{ label: string }>();
</script>

<style scoped lang="scss">
.swap-net {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 22px;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-pill);
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  white-space: nowrap;
}
</style>
