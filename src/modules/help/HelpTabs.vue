<template>
  <nav class="help-tabs" :aria-label="t('help.title')">
    <router-link
      v-for="tab in tabs" :key="tab.id" :to="tab.to" class="help-tab"
      :class="{ 'help-tab--current': section === tab.id }" :aria-current="section === tab.id ? 'page' : undefined"
    >{{ tab.label }}</router-link>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useHelpNavigation } from './helpNavigation';

const { t } = useTranslation();
const { section, homeTo, answersTo, updatesTo } = useHelpNavigation();
const tabs = computed(() => [
  { id: 'home', label: t('help.overview'), to: homeTo() },
  { id: 'answers', label: t('help.answers'), to: answersTo() },
  { id: 'updates', label: t('help.updates'), to: updatesTo() },
]);
</script>

<style scoped>
.help-tabs { display: flex; gap: var(--g-s-1); min-width: 0; }
.help-tab {
  position: relative; display: inline-flex; align-items: center; height: 44px; padding: 0 var(--g-s-3);
  color: var(--g-text-2); font-size: 14px; font-weight: 500; text-decoration: none; white-space: nowrap;
  transition: color var(--g-dur-fast) var(--g-ease);
}
.help-tab:hover { color: var(--g-text-1); }
.help-tab--current { color: var(--g-text-1); font-weight: 550; }
/* The one gradient slot a tab row owns: the current-tab indicator. */
.help-tab--current::after {
  content: ''; position: absolute; left: var(--g-s-3); right: var(--g-s-3); bottom: 0;
  height: 2px; border-radius: 2px; background: var(--g-grad);
}
</style>
