<template>
  <v-autocomplete v-model="mnemonic" outlined dense hide-details hide-no-data
                  :search-input.sync="search"
                  :items="englishWords" auto-select-first :rules="[rules.required()]"
                  @keydown.tab.exact="handleTab" @keydown.shift.tab="handleShiftTab"
  >
    <template v-slot:prepend>
      <span :style="{ color: primaryColor, marginTop: '4px', minWidth: '22px' }">{{index}}.</span>
    </template>
  </v-autocomplete>
</template>
<script setup lang="ts">
import { ref, computed, watch, nextTick, getCurrentInstance } from 'vue';
import rules from "@/utils/rules";
import * as bip39 from "bip39";

const props = defineProps({
  index: {
    type: Number,
  },
  value: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['input']);

const instance = getCurrentInstance();
const mnemonic = ref('');

// Get primary color from Vuetify theme
const primaryColor = computed(() => {
  return String(instance?.proxy?.$vuetify?.theme?.currentTheme?.primary);
});
const search = ref('');

const englishWords = computed(() => {
  if (search.value) {
    return bip39.wordlists['english'].filter(item => item.startsWith(search.value.toLowerCase()));
  }
  return bip39.wordlists['english'];
});

const handleTab = (event: KeyboardEvent) => {
  event.preventDefault();
  if (search.value) {
    mnemonic.value = search.value;
  }
  nextTick(() => {
    focusNextCell();
  });
};

const handleShiftTab = (event: KeyboardEvent) => {
  event.preventDefault();
  if (search.value) {
    mnemonic.value = search.value;
  }
  nextTick(() => {
    focusPreviousCell();
  });
};

const focusPreviousCell = () => {
  const currentCell = instance?.proxy?.$el?.closest('.v-input');
  const parentRow = currentCell?.closest('.row');
  const cells = Array.from(parentRow?.querySelectorAll('.v-input') || []);
  const currentIndex = cells.indexOf(currentCell);
  const previousCell = cells[Math.max(currentIndex - 1, 0)];

  if (previousCell) {
    const previousAutocomplete = previousCell.querySelector('input[type="text"]');
    if (previousAutocomplete) {
      (previousAutocomplete as HTMLInputElement).focus();
    }
  }
};

const focusNextCell = () => {
  const currentCell = instance?.proxy?.$el?.closest('.v-input');
  const parentRow = currentCell?.closest('.row');
  const cells = Array.from(parentRow?.querySelectorAll('.v-input') || []);
  const currentIndex = cells.indexOf(currentCell);
  const nextCell = cells[currentIndex + 1];

  if (nextCell) {
    const nextAutocomplete = nextCell.querySelector('input[type="text"]');
    if (nextAutocomplete) {
      (nextAutocomplete as HTMLInputElement).focus();
    }
  }
};

watch(() => props.value, (val) => {
  mnemonic.value = val;
});

watch(mnemonic, (val) => {
  emit('input', val);
});
</script>
<style scoped>

</style>
