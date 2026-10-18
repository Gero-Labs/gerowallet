<template>
  <div class="step-seed-phrase">
    <div class="step-scroll">

    <div class="t-label mb-2">{{ $t('welcome.chooseRecoveryPhraseLength') }}</div>

    <!-- Seed length toggle (12 / 15 / 24) -->
    <v-row no-gutters class="pb-2">
      <v-spacer></v-spacer>
      <v-btn-toggle color="primary" v-model="seedPhraseLength" mandatory>
        <v-btn size="small" value="12">
          <v-icon style="right: -5px">mdi-numeric-1</v-icon>
          <v-icon style="left: -5px">mdi-numeric-2</v-icon>
        </v-btn>
        <v-btn size="small" value="15">
          <v-icon style="right: -5px">mdi-numeric-1</v-icon>
          <v-icon style="left: -5px">mdi-numeric-5</v-icon>
        </v-btn>
        <v-btn size="small" value="24">
          <v-icon style="right: -5px">mdi-numeric-2</v-icon>
          <v-icon style="left: -5px">mdi-numeric-4</v-icon>
        </v-btn>
      </v-btn-toggle>
    </v-row>

    <!-- Mnemonic autocomplete grid -->
    <v-card flat class="mb-0 pa-0 transparent mnemonic-grid">
      <v-row no-gutters>
        <v-col class="pa-half" cols="6" :md="3" v-for="index in recoverySeedPhraseLength" :key="index">
          <mnemonic-autocomplete
            v-model="recoverySeedPhrase[index - 1]"
            :index="index"
            :attach="true"
            @next="focusNextCell"
          ></mnemonic-autocomplete>
        </v-col>
      </v-row>
    </v-card>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        tier="primary"
        :disabled="!valid"
        @click="handleContinue()"
        class="step-next"
      >
        {{ $t('common.continue') }}
      </GButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import * as bip39 from 'bip39';
import MnemonicAutocomplete from '@/modules/welcome/components/MnemonicAutocomplete.vue';
import { NetworkInfo } from '@/utils/networks';
import GButton from '@/shared/components/GButton/GButton.vue';

defineProps<{ network: NetworkInfo }>();

const emit = defineEmits<{
  (e: 'change', mnemonic: string[]): void;
  (e: 'next'): void;
  (e: 'back'): void;
}>();

// ─── Seed phrase state ────────────────────────────────────────────────────────
const seedPhraseLength = ref<string>('24');
const recoverySeedPhrase = ref<string[]>(Array(24).fill(''));

const recoverySeedPhraseLength = computed(() => Number(seedPhraseLength.value));

// Reset / resize the phrase array when the length toggle changes
watch(seedPhraseLength, (newLen) => {
  const n = Number(newLen);
  const current = recoverySeedPhrase.value;
  if (current.length < n) {
    recoverySeedPhrase.value = [...current, ...Array(n - current.length).fill('')];
  } else {
    recoverySeedPhrase.value = current.slice(0, n);
  }
});

const computedRecoverySeedPhrase = computed(() => {
  if (recoverySeedPhrase.value) {
    return recoverySeedPhrase.value.filter((item, index) => item && index < recoverySeedPhraseLength.value);
  }
  return undefined;
});

// BIP39 validity — verbatim from RestoreWallet.vue ~519-534
const valid = computed({
  get() {
    if (computedRecoverySeedPhrase.value) {
      try {
        return (
          computedRecoverySeedPhrase.value.length === Number(seedPhraseLength.value) &&
          bip39.validateMnemonic(computedRecoverySeedPhrase.value.join(' '))
        );
      } catch {
        return false;
      }
    }
    return false;
  },
  set(_value: boolean) {},
});

// Emit change whenever the mnemonic array changes
watch(recoverySeedPhrase, (val) => {
  emit('change', [...val]);
}, { deep: true });

// ─── Focus helpers (verbatim from RestoreWallet.vue) ──────────────────────────
const focusNextCell = (el: HTMLElement) => {
  const currentCell = el.closest('.v-input');
  const nextCell = currentCell?.nextElementSibling;
  if (nextCell) {
    const nextAutocomplete = nextCell.querySelector('.v-autocomplete input') as HTMLInputElement;
    if (nextAutocomplete) {
      nextAutocomplete.focus();
    }
  }
};

// ─── Clipboard paste (Ctrl/Cmd+V) — verbatim from RestoreWallet.vue ──────────
const pasteFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (!text?.trim()) return;
    recoverySeedPhrase.value = text.trim().split(/\s+/);
    if ([12, 15, 24].includes(recoverySeedPhrase.value.length)) {
      seedPhraseLength.value = recoverySeedPhrase.value.length.toString();
    }
  } catch {
    // Clipboard access denied or unavailable
  }
};

const onKeydown = (event: KeyboardEvent) => {
  if ((event.code === 'KeyV' && event.ctrlKey) || (event.code === 'KeyV' && event.metaKey)) {
    pasteFromClipboard();
  }
};

onMounted(() => {
  document.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown);
});

// ─── Continue ─────────────────────────────────────────────────────────────────
const handleContinue = (): void => {
  if (valid.value) {
    emit('next');
  }
};
</script>

<style scoped lang="scss">
// Mnemonic grid — compact inputs
.pa-half {
  padding: 2px !important;
}

.mnemonic-grid {
  :deep(.v-input) {
    font-size: 12px;
    --v-input-control-height: 30px;
  }
  :deep(.v-field) {
    --v-field-padding-start: 6px;
    --v-field-padding-end: 6px;
    --v-field-input-padding-top: 0px;
    --v-field-input-padding-bottom: 0px;
  }
  :deep(.v-field__input) {
    min-height: 30px !important;
  }
  :deep(.v-input__prepend) {
    margin-top: 4px !important;
    margin-right: 2px !important;

    span {
      font-size: 10px !important;
      min-width: 18px !important;
    }
  }
  :deep(.v-field--variant-outlined .v-field__outline) {
    --v-field-border-width: 1px;
  }
  :deep(input) {
    padding: 2px 0 !important;
    font-size: 11px;
  }
  :deep(.v-field__append-inner) {
    margin-top: 2px !important;
    padding-left: 0 !important;

    .v-icon {
      font-size: 16px !important;
    }
  }
}
</style>
