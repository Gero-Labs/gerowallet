<template>
  <component :is="layout">
    <router-view></router-view>
  </component>
</template>
<script setup lang="ts">
import { computed, watch, getCurrentInstance } from 'vue';
import { walletStore } from '@/stores/walletStore';

const vmProxy = getCurrentInstance()!.proxy
const route = vmProxy.$route;
const layout = computed(() => route.meta['layout'] || 'div');

watch(() => walletStore.config?.locale, async (newLocale, oldLocale) => {
  if (newLocale && vmProxy.$i18n && newLocale !== oldLocale) {
    // CRITICAL FIX: Load language file before switching (race condition fix)
    const { loadLanguage } = await import('@/plugins/i18n');
    try {
      await loadLanguage(newLocale);

      // Update i18n locale ONLY after successful load
      vmProxy.$i18n.locale = newLocale;
      console.log('🌐 Sidepanel language changed to:', newLocale);
    } catch (error) {
      console.error(`Failed to load language ${newLocale}:`, error);
      // Don't update i18n if load failed
    }
  }
}, { immediate: true, deep: true });
</script>
