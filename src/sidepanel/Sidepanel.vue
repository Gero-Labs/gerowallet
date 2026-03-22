<template>
  <component :is="layout">
    <router-view></router-view>
  </component>
</template>
<script setup lang="ts">
import { computed, watch, getCurrentInstance } from 'vue';
import { geroStore } from '@/stores/geroStore';

const vmProxy = getCurrentInstance()!.proxy
const route = vmProxy.$route;
const layout = computed(() => route.meta['layout'] || 'div');

// Watch geroStore for locale changes (global preference) instead of walletStore
// CRITICAL: The initial locale is set by main.ts BEFORE Vue mounts
// This watcher should only react to SUBSEQUENT changes made by the user
watch(() => geroStore.config?.locale, async (newLocale, oldLocale) => {
  // Skip if no locale value or i18n not ready
  if (!newLocale || !vmProxy.$i18n) return;

  // CRITICAL: Skip if this is the initial watcher run and i18n is already set correctly
  // This prevents the watcher from overwriting the locale set by main.ts
  // The geroStore default is 'us', but main.ts may have already loaded 'de' from storage
  if (vmProxy.$i18n.locale === newLocale) {
    return; // Already at the correct locale, no action needed
  }

  // Skip if oldLocale is undefined/null (first run) and newLocale is the default 'us'
  // This means geroStore hasn't been hydrated yet, so trust main.ts's locale setting
  if (!oldLocale && newLocale === 'us' && vmProxy.$i18n.locale !== 'us') {
    console.log('🔄 Sidepanel: Skipping initial hydration reset, current i18n.locale:', vmProxy.$i18n.locale);
    return;
  }

  // Proceed with locale change
  console.log('🔄 Sidepanel: Locale change detected:', oldLocale, '->', newLocale);
  const { loadLanguage } = await import('@/plugins/i18n');
  try {
    await loadLanguage(newLocale);
    vmProxy.$i18n.locale = newLocale;
    console.log('✅ Sidepanel: i18n.locale updated to:', newLocale);
  } catch (error) {
    console.error(`Failed to load language ${newLocale}:`, error);
  }
}, { immediate: true, deep: true });
</script>
