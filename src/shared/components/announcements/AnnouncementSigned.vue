<template>
  <span class="announce-signed">
    <v-icon :size="compact ? 14 : 16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
    {{ $t('announce.signed') }}
  </span>
</template>

<script setup lang="ts">
// The provenance line under every announcement. It is true by construction: a page only ever
// renders what the worker verified against the keys pinned in this build.
defineProps<{ compact?: boolean }>();
</script>

<style scoped lang="scss">
.announce-signed { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--g-text-2); }
</style>
