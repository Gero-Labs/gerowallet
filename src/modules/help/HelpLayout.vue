<template>
  <div ref="root" class="help-layout">
    <ContentLayout v-if="ready"><template #help-content><slot /></template></ContentLayout>
    <v-app v-else class="help-public-app">
      <v-main>
        <div class="help-public-scroll" data-help-scroll>
          <header class="help-public-header">
            <router-link to="/help" class="help-brand">Gero <span>{{ t('help.title') }}</span></router-link>
            <nav :aria-label="t('help.title')">
              <GButton compact tier="tertiary" @click="openSupport()">{{ t('help.contact') }}</GButton>
              <GButton compact :to="welcomePath">{{ t(hasWallets ? 'help.unlock' : 'help.setup') }}</GButton>
              <LanguageSelector />
            </nav>
          </header>
          <slot />
        </div>
      </v-main>
    </v-app>
    <HelpSupportAction />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router/composables';
import ContentLayout from '@/modules/navigation/layouts/ContentLayout.vue';
import LanguageSelector from '@/modules/navigation/components/LanguageSelector.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { walletStore } from '@/stores/walletStore';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';
import { useTranslation } from '@/shared/composables/useTranslation';
import { helpUnlockPath, isHelpReady } from '@/modules/navigation/helpAccess';
import HelpSupportAction from './HelpSupportAction.vue';
import { openSupport } from './supportIntent';

const route = useRoute();
const router = useRouter();
const { t } = useTranslation();
const { hasWallets } = useAvailableWallets();
const ready = computed(() => isHelpReady(walletStore));
const welcomePath = computed(() => hasWallets.value ? helpUnlockPath(route.fullPath) : '/welcome');
const root = ref<HTMLElement | null>(null);
const scrollPositions = new Map<string, number>();
watch(() => route.fullPath, async (path, previous) => {
  const scroll = root.value?.querySelector<HTMLElement>('[data-help-scroll]');
  if (previous) scrollPositions.set(previous, scroll?.scrollTop ?? 0);
  await nextTick();
  if (path !== route.fullPath) return;
  const target = root.value?.querySelector<HTMLElement>('[data-help-scroll]');
  if (target) target.scrollTop = scrollPositions.get(path) ?? 0;
});
watch(ready, async () => {
  const path = route.fullPath;
  const scroll = root.value?.querySelector<HTMLElement>('[data-help-scroll]');
  scrollPositions.set(path, scroll?.scrollTop ?? 0);
  await nextTick();
  if (path !== route.fullPath) return;
  const target = root.value?.querySelector<HTMLElement>('[data-help-scroll]');
  if (target) target.scrollTop = scrollPositions.get(path) ?? 0;
});
watch(() => route.query.support, async intent => {
  if (intent !== '1') return;
  await nextTick();
  openSupport();
  const query = { ...route.query };
  delete query.support;
  void router.replace({ path: route.path, query }).catch(() => {});
}, { immediate: true });
</script>

<style scoped>
.help-public-scroll { height: 100vh; overflow-y: auto; background: var(--g-canvas); color: var(--g-text-1); }
.help-public-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--g-s-4); padding: var(--g-s-5) var(--g-s-6); border-bottom: 1px solid var(--g-hairline-1); }
.help-public-header nav { display: flex; flex-wrap: wrap; align-items: center; gap: var(--g-s-2); }
.help-brand { color: var(--g-text-1); text-decoration: none; font: 600 1.25rem var(--g-font-ui); }
.help-brand span { margin-left: var(--g-s-3); color: var(--g-text-2); font: 400 0.875rem var(--g-font-mono); }
@media (max-width: 600px) { .help-public-header { padding: var(--g-s-4); } }
</style>
