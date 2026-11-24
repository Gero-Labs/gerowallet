<template>
  <ol class="numbered-steps t-body">
    <li v-for="(step, i) in steps" :key="i">
      <span>{{ step.text }} <v-icon v-if="step.icon" size="small">{{ step.icon }}</v-icon></span>
    </li>
  </ol>
</template>

<script setup lang="ts">
/** One instruction; `icon` (an mdi name) follows the text, e.g. the device's scan button. */
export interface NumberedStep {
  text: string;
  icon?: string;
}

defineProps<{ steps: NumberedStep[] }>();
</script>

<style scoped lang="scss">
// Device instructions as numbered steps: the number in an accent ring, the text
// in the secondary tone. Shared by Keystone pairing and the Keystone sign dialog.
.numbered-steps {
  counter-reset: numbered-step;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  color: var(--g-text-2);
  text-align: left;

  li {
    counter-increment: numbered-step;
    display: flex;
    align-items: flex-start;
    gap: var(--g-s-3);
    line-height: 1.5;

    &::before {
      content: counter(numbered-step);
      flex: none;
      width: 1.5em;
      height: 1.5em;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--g-accent);
      border-radius: var(--g-r-pill);
      color: var(--g-accent);
    }
  }
}
</style>
