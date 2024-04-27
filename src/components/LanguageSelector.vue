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
import {mapState} from "pinia";
import {useStore} from "@/store";

export default {
  name: "LanguageSelector",
  computed: {
    ...mapState(useStore, ['locale']),
    currentLanguage() {
      return this.languages[this.$i18n.locale]
    }
  },
  watch: {
    selectedLang(val) {
      const locale = Object.keys(this.languages)[val]
      this.store.setLocale(locale)
      this.$i18n.locale = Object.keys(this.languages)[val];
    }
  },
  data: () => ({
    languages: {
      cn: { name: "中国人", short: "中国人", iso: "cn" },
      cz: { name: "Čeština", short: "Češ", iso: "cz" },
      de: { name: "Deutsch", short: "Deu", iso: "de" },
      en: { name: "English", short: "Eng", iso: "us" },
      es: { name: "Español", short: "Esp", iso: "es" },
      fr: { name: "Français", short: "Fra", iso: "fr" },
      gr: { name: "Ελληνικά", short: "Ελλ", iso: "gr" },
      he: { name: "עברית", short: "עבר", iso: "il" },
      hr: { name: "Hrvatski", short: "Hrv", iso: "hr" },
      id: { name: "Indonesia", short: "Ind", iso: "id" },
      in: { name: "हिंदी", short: "हिंदी", iso: "in" },
      it: { name: "Italiano", short: "Ita", iso: "it" },
      jp: { name: "日本語", short: "日本語", iso: "jp" },
      nl: { name: "Nederlands", short: "Ned", iso: "nl" },
      pk: { name: "اردو", short: "ارد", iso: "pk" },
      pt: { name: "Português", short: "Por", iso: "pt" },
      ru: { name: "Русский", short: "Рус", iso: "ru" },
      th: { name: "ภาษาไทย", short: "ภาษ", iso: "th" },
      tr: { name: "Türkçe", short: "Tür", iso: "tr" },
      tz: { name: "Kiswahili", short: "Kis", iso: "tz" },
      vn: { name: "Tiếng Việt", short: "Việ", iso: "vn" },
    },
    selectedLang: -1,
    store: useStore()
  }),
  async mounted() {
    console.log(this.store.getLocale)
    this.selectedLang = Object.keys(this.languages).indexOf(this.locale)
  }
}
</script>
<style scoped>
.toggleUpDown {
  transition: transform .2s ease-in-out !important;
}

.toggleUpDown.rotate {
  transform: rotate(180deg);
}
</style>