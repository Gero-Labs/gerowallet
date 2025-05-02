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
<script>
import { mapActions, mapState } from 'pinia';
import { useStore } from "@/stores";
import languages from '@/plugins/languages';

export default {
  name: "LanguageSelector",
  computed: {
    ...mapState(useStore, ['locale']),
    currentLanguage() {
      return this.languages[this.$i18n.locale]
    }
  },
  methods: {
    ...mapActions(useStore, ['setLocale']),
  },
  watch: {
    selectedLang(val) {
      const locale = Object.keys(this.languages)[val]
      this.setLocale(locale)
      this.$i18n.locale = Object.keys(this.languages)[val];
    }
  },
  data: () => ({
    languages,
    selectedLang: -1,
  }),
  mounted() {
    this.selectedLang = Object.keys(this.languages).indexOf(this.locale)
  }
}
</script>
<style>
.toggleUpDown {
  transition: transform .2s ease-in-out !important;
}

.toggleUpDown.rotate {
  transform: rotate(180deg);
}
</style>
