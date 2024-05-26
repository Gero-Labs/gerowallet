<template>
  <v-autocomplete v-model="mnemonic" outlined dense hide-details hide-no-data
                  :search-input.sync="search"
                  :items="englishWords" auto-select-first :rules="[rules.required]">
    <template v-slot:prepend>
      <span style="color: #2f9cac;margin-top: 4px; min-width: 22px">{{index}}.</span>
    </template>
  </v-autocomplete>
</template>
<script>
import rules from "@/shared/utils/rules";
import * as bip39 from "bip39";

export default {
  name: "MnemonicAutocomplete",
  props: {
    index: {
      type: Number,
    },
    value: {
      type: String,
      default: () => '',
    },
  },
  watch: {
    value(val) {
      this.mnemonic = val
    },
    mnemonic(val) {
      this.$emit('input', val)
    }
  },
  computed: {
    englishWords() {
      if (this.search) {
        return bip39.wordlists.english.filter(item => item.startsWith(this.search.toLowerCase()))
      }
      return bip39.wordlists.english
    },
  },
  data: () => ({
    rules,
    mnemonic: '',
    search: '',
  })
}
</script>
<style scoped>

</style>
