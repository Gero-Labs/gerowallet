<template>
  <div ref="root" class="help-layout">
    <!-- One root: ContentLayout keeps this slot alive with <keep-alive>, which renders only its first child. -->
    <ContentLayout v-if="ready"><template #help-content><div class="help-embedded-page"><HelpPageHeader variant="embedded" /><slot /></div></template></ContentLayout>
    <v-app v-else class="help-public-app">
      <v-main>
        <div class="help-public-scroll" data-help-scroll>
          <HelpPageHeader variant="public" />
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
import { walletStore } from '@/stores/walletStore';
import { isHelpReady } from '@/modules/navigation/helpAccess';
import HelpPageHeader from './HelpPageHeader.vue';
import HelpSupportAction from './HelpSupportAction.vue';
import { openSupport } from './supportIntent';

const route = useRoute();
const router = useRouter();
const ready = computed(() => isHelpReady(walletStore));
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
</style>
