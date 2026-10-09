<template>
  <form class="search-form" :class="'search-form--' + variant" role="search" @submit.prevent="submit()">
    <v-icon :size="variant === 'hero' ? 20 : 18" color="var(--g-text-3)" class="search-icon">mdi-magnify</v-icon>
    <label class="sr-only" :for="inputId">{{ t('help.search') }}</label>
    <input :id="inputId" v-model="query" type="search" enterkeyhint="search" :placeholder="t('help.search')" autocomplete="off" />
    <GButton v-if="variant === 'hero'" type="submit" tier="primary" compact class="search-submit">{{ t('common.search') }}</GButton>
  </form>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useHelpNavigation } from './helpNavigation';

withDefaults(defineProps<{ variant?: 'hero' | 'compact'; inputId?: string }>(), { variant: 'compact', inputId: 'help-query' });
const { t } = useTranslation();
const route = useRoute();
const router = useRouter();
const { destination } = useHelpNavigation();
const query = ref(typeof route.query.q === 'string' ? route.query.q : '');
watch(() => route.query.q, value => { query.value = typeof value === 'string' ? value : ''; });
function submit(): void {
  void router.push(destination('/help/search', { q: query.value.trim().slice(0, 200), basic: '' })).catch(() => {});
}
</script>

<style scoped>
/* The field is a control, so it keeps the accepted solid fill (--g-raised) and a visible edge. */
.search-form {
  display: flex; align-items: center; gap: var(--g-s-2); box-sizing: border-box; min-width: 0;
  background: var(--g-raised); border: 1px solid var(--g-hairline-2); border-radius: var(--g-r-control);
}
.search-form--hero { height: 52px; padding: 0 6px 0 var(--g-s-4); }
.search-form--compact { flex: 0 1 320px; max-width: 320px; height: 40px; padding: 0 var(--g-s-3); }
.search-icon { flex: none; }
.search-form input {
  flex: 1 1 auto; min-width: 0; height: 100%; background: transparent; border: 0;
  color: var(--g-text-1); font: inherit; font-size: 15px;
}
.search-form--compact input { font-size: 14px; }
.search-form input::placeholder { color: var(--g-text-3); }
.search-submit { flex: none; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 640px) {
  .search-form--compact { flex: 1 1 100%; max-width: none; }
  /* Phone: a taller field with 16px text, submitted from the keyboard's search key. */
  .search-form--hero { height: 48px; padding: 0 var(--g-s-3); }
  .search-form--hero input { font-size: 16px; }
  .search-form--hero .search-submit { display: none; }
}
</style>
