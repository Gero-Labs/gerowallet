<template>
  <v-autocomplete v-model="mnemonic" outlined dense hide-details hide-no-data
                  :search-input.sync="search"
                  :items="englishWords" auto-select-first :rules="[rules.required]"
                  @keydown.tab="handleTab"
  >
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
  methods: {
    handleTab(event) {
      console.log('event')
      event.preventDefault();
      if (this.search) {
        this.mnemonic = this.search
        // this.autocomplete(this.search);
      }
      this.$nextTick(() => {
        // this.$emit('next', this.$el)
        this.focusNextCell();
      });
    },
    focusNextCell() {
      const currentCell = this.$el.closest('.v-input'); // Find the closest .v-input parent element
      const parentRow = currentCell.closest('.row'); // Find the parent row
      const cells = Array.from(parentRow.querySelectorAll('.v-input')); // Get all .v-input elements in the row
      const currentIndex = cells.indexOf(currentCell); // Find the current cell's index
      const nextCell = cells[currentIndex + 1]; // Get the next cell

      if (nextCell) {
        const nextAutocomplete = nextCell.querySelector('input[type="text"]'); // Find the input element in the next cell
        if (nextAutocomplete) {
          nextAutocomplete.focus(); // Focus the input element
        }
      }
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
