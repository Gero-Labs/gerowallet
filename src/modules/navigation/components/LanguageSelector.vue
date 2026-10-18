<template>
  <v-menu v-model="menuOpen" eager transition="none">
    <template v-slot:activator="{ props: activatorProps }">
      <GButton tier="tertiary" compact v-bind="activatorProps" :ripple="false">
        <v-avatar size="20" class="mr-2">
          <flag :iso="currentLanguage.iso" style="font-size: 20px;"></flag>
        </v-avatar>
        {{ currentLanguage.short }}
        <v-icon class="toggleUpDown ml-1" :class='{ "rotate": menuOpen }' size="small">mdi-chevron-down</v-icon>
      </GButton>
    </template>
    <v-card variant="outlined" class="glass-popover">
      <v-list density="compact" class="pa-0 transparent">

          <v-list-item v-for="(item, index) in availableLanguages" :key="index" :active="selectedLang === index" @click="selectedLang = index">
            <template #prepend><v-avatar size="20">
              <flag :iso="item.iso" style="font-size: 20px;"></flag>
            </v-avatar>
            </template><v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
          </v-list-item>

      </v-list>
    </v-card>
  </v-menu>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { geroStore } from '@/stores/geroStore';
import GeroStore from '@/stores/geroStore';
import languages from '@/plugins/languages';
import i18n, { loadLanguage } from '@/plugins/i18n';
import { READY_LANGUAGES } from '@/plugins/i18n.config';
import GButton from '@/shared/components/GButton/GButton.vue';

const selectedLang = ref(-1);
const menuOpen = ref(false);

// Filter to only show ready languages
const availableLanguages = computed(() => {
  return Object.entries(languages)
    .filter(([key]) => READY_LANGUAGES.some(locale => locale === key))
    .map(([, value]) => value);
});

const availableLanguageKeys = computed(() => {
  return Object.keys(languages).filter(key => READY_LANGUAGES.some(locale => locale === key));
});

const currentLanguage = computed(() => {
  return languages[i18n.locale as keyof typeof languages] || languages.us
});

const currentLocale = computed(() => {
  // CRITICAL: Read from geroStore (global preference) instead of walletStore
  // This ensures locale persists across login/logout
  return geroStore.config?.locale || 'us';
});

watch(selectedLang, async (val, _old, onCleanup) => {
  const localeKey = availableLanguageKeys.value[val];
  if (!localeKey || localeKey === currentLocale.value) return;
  let cancelled = false;
  onCleanup(() => { cancelled = true; });

  // CRITICAL FIX: Load language file before switching (race condition fix)
  try {
    await loadLanguage(localeKey);
    if (cancelled) return;

    // Update geroStore directly (source of truth for global locale preference)
    // This updates i18n.locale internally and persists to database
    await GeroStore.setLocale(localeKey);
  } catch (error) {
    console.error(`Failed to load language ${localeKey}:`, error);
    // Don't update store if load failed - will cause UI inconsistency
  }
});

// Watch for locale changes from other sources (e.g., ProfileTab settings)
watch(currentLocale, (newLocale) => {
  const newIndex = availableLanguageKeys.value.indexOf(newLocale);
  if (newIndex !== -1 && selectedLang.value !== newIndex) {
    selectedLang.value = newIndex;
  }
});

onMounted(() => {
  // Set the selected language index based on current locale
  // The language file is already loaded by main.ts before the app mounts
  selectedLang.value = availableLanguageKeys.value.indexOf(currentLocale.value);
});
</script>
<style>
/* Global on purpose: TokenSelector's chevron reuses this class. */
.toggleUpDown {
  transition: transform var(--g-dur-fast) var(--g-ease) !important;
}

.toggleUpDown.rotate {
  transform: rotate(180deg);
}
</style>
