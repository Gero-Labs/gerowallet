<template>
  <component :is="layout">
    <router-view></router-view>
  </component>
</template>
<script setup lang="ts">
import { computed, watch, toRefs, getCurrentInstance } from 'vue';
import WalletStore from '@/stores/walletStore';

const vmProxy = getCurrentInstance()!.proxy as any
const route = vmProxy.$route;
const layout = computed(() => route.meta.layout || 'div');

const { config } = toRefs(WalletStore);

watch(() => config.value?.locale, async (newLocale, oldLocale) => {
  if (newLocale && vmProxy.$i18n && newLocale !== oldLocale) {
    // CRITICAL FIX: Load language file before switching
    const { loadLanguage } = await import('@/plugins/i18n');
    try {
      await loadLanguage(newLocale);
    } catch (error) {
      console.error(`Failed to load language ${newLocale}:`, error);
    }
    
    vmProxy.$i18n.locale = newLocale;
    console.log('🌐 Sidepanel language changed to:', newLocale);
  }
}, { immediate: true, deep: true });
</script>
