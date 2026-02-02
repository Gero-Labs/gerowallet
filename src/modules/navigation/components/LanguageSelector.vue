<template>
  <v-menu offset-y transition="scroll-y-transition" max-height="200">
    <template v-slot:activator="{ on, attrs, value }">
      <v-btn large plain v-bind="attrs" v-on="on" :ripple="false" width="128" style="font-weight: 600">
        <v-avatar size="20">
          <flag :iso="currentLanguage.iso" style="font-size: 20px;"></flag>
        </v-avatar>
        &nbsp;&nbsp;{{currentLanguage.short}}&nbsp;
        <v-icon class="toggleUpDown" :class='{ "rotate": value }' small>mdi-chevron-down</v-icon>
      </v-btn>
    </template>
    <v-list dense class="pa-0" light style="background-color: #ffffff88;">
      <v-list-item-group v-model="selectedLang" mandatory>
        <v-list-item v-for="(item, index) in availableLanguages" :key="index">
          <v-list-item-avatar size="20">
            <flag :iso="item.iso" style="font-size: 20px;"></flag>
          </v-list-item-avatar>
          <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
        </v-list-item>
      </v-list-item-group>
    </v-list>
  </v-menu>
</template>
<script setup lang="ts">
import { ref, computed, watch, onMounted, getCurrentInstance } from 'vue';
import { walletStore } from '@/stores/walletStore';
import WalletStore from '@/stores/walletStore';
import { geroStore } from '@/stores/geroStore';
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

    // Update store and i18n locale ONLY after successful load
    WalletStore.setLocale(localeKey);
    if (instance?.proxy?.$i18n) {
      instance.proxy.$i18n.locale = localeKey;
    }
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
