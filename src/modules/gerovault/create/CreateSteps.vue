<template>
  <!-- Where the create flow stands. Steps are not links: each one is reached with Continue. -->
  <ol class="create-steps" :aria-label="$t('gerovault.create.steps.label')">
    <li
      v-for="(name, i) in CREATE_STEPS"
      :key="name"
      class="create-steps__step t-body-sm"
      :class="{ 'create-steps__step--done': i < current || saved, 'create-steps__step--current': i === current && !saved }"
      :aria-current="i === current ? 'step' : undefined"
    >
      <span class="create-steps__mark t-caption" aria-hidden="true">
        <v-icon v-if="i < current || saved" size="14">mdi-check</v-icon>
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span>{{ $t(STEP_KEYS[name]) }}</span>
    </li>
  </ol>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CREATE_STEPS, type CreateStep } from './useCreateVault';
import { STEP_KEYS } from './messages';

const props = defineProps<{ step: CreateStep; saved: boolean }>();

const current = computed(() => CREATE_STEPS.indexOf(props.step));
</script>

<style scoped>
.create-steps {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-3);
  margin: 0;
  padding: 0;
  list-style: none;
}
.create-steps__step {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  color: var(--g-text-3);
}
.create-steps__step--done {
  color: var(--g-accent);
}
.create-steps__step--current {
  color: var(--g-text-1);
}
.create-steps__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
}
.create-steps__step--done .create-steps__mark {
  border-color: var(--g-accent);
}
.create-steps__step--current .create-steps__mark {
  border-color: var(--g-accent);
  background: var(--g-accent);
  color: var(--g-on-grad);
}
</style>
