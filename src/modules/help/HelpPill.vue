<template>
  <!-- A toggle pill. The pressed state is the only thing that changes the fill, so it never relies on colour alone: weight and border change too. -->
  <button type="button" class="help-pill" :aria-pressed="pressed ? 'true' : 'false'" v-on="$listeners">
    <slot />
  </button>
</template>

<script setup lang="ts">
defineProps<{ pressed: boolean }>();
</script>

<style scoped>
/* Pills are controls: the accepted solid fill (--g-overlay) marks the pressed one, the rest stay transparent. */
.help-pill {
  display: inline-flex; align-items: center; gap: var(--g-s-2); flex: none;
  height: 36px; padding: 0 14px;
  border: 1px solid var(--g-hairline-1); border-radius: var(--g-r-pill);
  background: transparent; color: var(--g-text-2);
  font: inherit; font-size: 13px; font-weight: 500; white-space: nowrap; cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);
}
.help-pill[aria-pressed="true"] { background: var(--g-overlay); border-color: var(--g-hairline-3); color: var(--g-text-1); font-weight: 550; }
</style>
