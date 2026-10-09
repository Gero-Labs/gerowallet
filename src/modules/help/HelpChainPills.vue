<template>
  <div role="group" :aria-label="t('help.chain')" class="chain-pills">
    <HelpPill v-for="option in options" :key="option.value" :pressed="chain === option.value" @click="select(option.value)">{{ option.label }}</HelpPill>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import HelpPill from './HelpPill.vue';
import { useHelpNavigation } from './helpNavigation';

const { t } = useTranslation();
const { chain, selectChain } = useHelpNavigation();
const options = computed(() => [
  { value: 'all', label: t('help.allChains') }, { value: 'cardano', label: 'Cardano' },
  { value: 'midnight', label: 'Midnight' }, { value: 'bitcoin', label: 'Bitcoin' },
]);
function select(value: string): void { selectChain(value); }
</script>

<style scoped>
.chain-pills { display: flex; flex-wrap: wrap; gap: var(--g-s-2); }
@media (max-width: 640px) {
  /* One scrolling row on a phone, bleeding to the screen edges like the tab row. */
  .chain-pills { flex-wrap: nowrap; overflow-x: auto; margin: 0 -16px; padding: 0 var(--g-s-4); }
}
</style>
