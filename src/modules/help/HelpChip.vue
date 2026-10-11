<template>
  <!-- A chip is a label, not a surface: the accepted solid fill (--g-raised) keeps it readable on any glass. -->
  <span class="help-chip" :class="{ 'help-chip--strong': strong }"><slot /></span>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ strong?: boolean }>(), { strong: false });
</script>

<style scoped>
.help-chip {
  display: inline-flex; align-items: center; height: 24px; padding: 0 var(--g-s-2);
  border-radius: var(--g-r-chip); background: var(--g-raised); border: 1px solid var(--g-hairline-1);
  color: var(--g-text-2); font-size: 12px; font-weight: 500;
}
.help-chip--strong { font-weight: 550; }
</style>
