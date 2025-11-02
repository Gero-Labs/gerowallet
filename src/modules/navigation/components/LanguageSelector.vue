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
        <v-list-item v-for="(item, index) in languages" :key="index">
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
import languages from '@/plugins/languages';
import { loadLanguage } from '@/plugins/i18n';

const selectedLang = ref(-1);
const instance = getCurrentInstance();

const currentLanguage = computed(() => {
  return languages[instance?.proxy?.$i18n?.locale || 'us']
});

const currentLocale = computed(() => {
  return walletStore.config?.locale || 'us';
});

watch(selectedLang, async (val) => {
  const localeKey = Object.keys(languages)[val]
  
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

onMounted(async () => {
  selectedLang.value = Object.keys(languages).indexOf(currentLocale.value)
  
  // Load saved language on mount if not 'us'
  if (currentLocale.value !== 'us') {
    try {
      await loadLanguage(currentLocale.value);
    } catch (error) {
      console.error(`Failed to load saved language ${currentLocale.value}:`, error);
    }
  }
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
