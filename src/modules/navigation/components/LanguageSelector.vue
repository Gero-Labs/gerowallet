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
import { toRefs } from 'vue';
import { walletStore } from '@/plugins/walletStore';
import languages from '@/plugins/languages';
import { geroStore } from '@/plugins/geroStore';

const { locale } = toRefs(geroStore);
const selectedLang = ref(-1);
const instance = getCurrentInstance();

const currentLanguage = computed(() => {
  return languages[instance?.proxy?.$i18n?.locale || 'en']
});

watch(selectedLang, (val) => {
  const localeKey = Object.keys(languages)[val]
  walletStore.setLocale(localeKey)
  if (instance?.proxy?.$i18n) {
    instance.proxy.$i18n.locale = Object.keys(languages)[val];
  }
});

onMounted(() => {
  selectedLang.value = Object.keys(languages).indexOf(locale.value)
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
