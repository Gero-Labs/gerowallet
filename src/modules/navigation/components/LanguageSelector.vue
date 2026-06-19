<template>
  <v-menu offset-y eager transition="none">
    <template v-slot:activator="{ on, attrs, value }">
      <v-btn large plain v-bind="attrs" v-on="on" :ripple="false" width="140" style="font-weight: 600">
        <v-avatar size="20">
          <flag :iso="currentLanguage.iso" style="font-size: 20px;"></flag>
        </v-avatar>
        &nbsp;&nbsp;{{currentLanguage.short}}&nbsp;
        <v-icon class="toggleUpDown" :class='{ "rotate": value }' small>mdi-chevron-down</v-icon>
      </v-btn>
    </template>
    <v-card outlined class="liquid-glass-dialog" style="border: 1px solid rgba(255, 255, 255, 0.15) !important;">
      <v-list dense class="pa-0 transparent">
        <v-list-item-group v-model="selectedLang" mandatory>
          <v-list-item v-for="(item, index) in availableLanguages" :key="index">
            <v-list-item-avatar size="20">
              <flag :iso="item.iso" style="font-size: 20px;"></flag>
            </v-list-item-avatar>
            <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
          </v-list-item>
        </v-list-item-group>
      </v-list>
    </v-card>
  </v-menu>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, getCurrentInstance } from 'vue';
import { geroStore } from '@/stores/geroStore';
import GeroStore from '@/stores/geroStore';
import languages from '@/plugins/languages';
import { loadLanguage } from '@/plugins/i18n';
import { READY_LANGUAGES } from '@/plugins/i18n/config';

const selectedLang = ref(-1);
const instance = getCurrentInstance();

// Filter to only show ready languages
const availableLanguages = computed(() => {
  return Object.entries(languages)
    .filter(([key]) => READY_LANGUAGES.includes(key))
    .map(([, value]) => value);
});

const availableLanguageKeys = computed(() => {
  return Object.keys(languages).filter(key => READY_LANGUAGES.includes(key));
});

const currentLanguage = computed(() => {
  return languages[instance?.proxy?.$i18n?.locale || 'us']
});

const currentLocale = computed(() => {
  // CRITICAL: Read from geroStore (global preference) instead of walletStore
  // This ensures locale persists across login/logout
  return geroStore.config?.locale || 'us';
});

watch(selectedLang, async (val) => {
  const localeKey = availableLanguageKeys.value[val]

  // CRITICAL FIX: Load language file before switching (race condition fix)
  try {
    await loadLanguage(localeKey);

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
.toggleUpDown {
  transition: transform .2s ease-in-out !important;
}

.toggleUpDown.rotate {
  transform: rotate(180deg);
}
</style>

<style>
/* Liquid glass styling for the language selector dropdown */
.liquid-glass-dialog.v-card {
  background-color: rgba(0, 0, 0, 0.4) !important;
  background-image: none !important;
  backdrop-filter: blur(20px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(20px) saturate(1.8) !important;
  border-radius: 12px !important;
  position: relative !important;
  overflow: hidden !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
  isolation: isolate !important;
}
</style>
