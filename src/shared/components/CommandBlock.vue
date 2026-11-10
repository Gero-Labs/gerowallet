<template>
  <!-- A shell command to copy: the code wraps instead of hiding its end, and the
       copy button sits inside the block. Solid on purpose: a code block is one of
       the design system's justified solids. -->
  <div class="command-block" data-test="command-block">
    <code class="command-block__code g-mono" data-test="command-block-code">{{ command }}</code>
    <CopyButton :value="command" small :label="copyLabel" class="command-block__copy" data-test="command-block-copy" />
  </div>
</template>

<script setup lang="ts">
import CopyButton from '@/shared/components/CopyButton.vue';

defineProps<{
  command: string;
  /** What the copy button is announced as ("Copy to clipboard" when omitted). */
  copyLabel?: string;
}>();
</script>

<style scoped lang="scss">
.command-block {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  background: var(--g-canvas);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: var(--g-s-2) var(--g-s-3);
}

.command-block__code {
  flex: 1;
  min-width: 0;
  color: var(--g-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.command-block__copy {
  flex: none;
}
</style>
