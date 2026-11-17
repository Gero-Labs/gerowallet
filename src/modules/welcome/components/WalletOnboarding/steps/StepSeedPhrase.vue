<template>
  <div class="step-seed-phrase">
    <div class="step-scroll">

    <div id="recovery-phrase-length-label" class="t-label mb-2">{{ $t('welcome.chooseRecoveryPhraseLength') }}</div>

    <!-- Seed length choices (12 / 15 / 24) -->
    <v-row no-gutters class="pb-2 justify-center">
      <div class="seed-phrase-length-toggle" role="group" aria-labelledby="recovery-phrase-length-label">
        <button
          v-for="length in ['12', '15', '24']"
          :key="length"
          type="button"
          class="seed-phrase-length-option"
          :aria-pressed="seedPhraseLength === length"
          @click="seedPhraseLength = length"
        >
          {{ length }}
        </button>
      </div>
    </v-row>

    <!-- Mnemonic autocomplete grid -->
    <div class="mnemonic-grid">
      <v-row no-gutters>
        <v-col cols="6" :md="3" v-for="index in recoverySeedPhraseLength" :key="index">
            <mnemonic-autocomplete
              v-model="recoverySeedPhrase[index - 1]"
              :index="index"
              :attach="true"
              @next="focusNextCell"
            ></mnemonic-autocomplete>
        </v-col>
      </v-row>
    </div>
    </div>

    <!-- Navigation buttons -->
    <div class="onboarding-actions d-flex">
      <GButton tier="tertiary" @click="$emit('back')">{{ $t('common.back') }}</GButton>
      <v-spacer />
      <GButton
        tier="primary"
        :disabled="!valid"
        :loading="busy"
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

defineProps<{
  network: NetworkInfo;
  /** The onboarding is reading the phrase's accounts (several seconds on Midnight). */
  busy?: boolean;
}>();

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
.seed-phrase-length-toggle {
  display: inline-flex;
  gap: var(--g-s-1);
  padding: var(--g-s-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  background: var(--g-surface);
}

.seed-phrase-length-option {
  min-width: 56px;
  height: var(--g-btn-h-compact);
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: var(--g-r-chip);
  background: transparent;
  color: var(--g-text-2);
  font-family: var(--g-font-mono);
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);

  &:hover:not([aria-pressed='true']) {
    background: var(--g-raised);
    color: var(--g-text-1);
  }

  &[aria-pressed='true'] {
    background: var(--g-accent);
    color: var(--g-on-grad);
  }

  &:focus-visible {
    outline: 2px solid var(--g-accent);
    outline-offset: 2px;
  }
}

// Mnemonic grid
.mnemonic-grid {
  :deep(.v-row--no-gutters > .v-col) {
    padding: var(--g-s-1) var(--g-s-2);
  }

  :deep(.v-input) {
    font-size: 0.875rem;
    --v-input-control-height: 44px;
  }

  :deep(.v-field) {
    min-height: 44px;
    border-radius: var(--g-r-control);
    background: var(--g-surface);
    font-size: 0.875rem;
    --v-field-padding-start: var(--g-s-3);
    --v-field-padding-end: var(--g-s-2);
    --v-field-input-padding-top: 0px;
    --v-field-input-padding-bottom: 0px;
  }

  :deep(.v-field__input) {
    min-height: 44px;
    padding-top: 0;
    padding-bottom: 0;
  }

  :deep(.mnemonic-index) {
    color: var(--g-accent);
    font-family: var(--g-font-mono);
    font-size: 0.75rem;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    opacity: 0.85;
  }

  :deep(.v-field--variant-outlined .v-field__outline) {
    --v-field-border-width: 1px;
  }

  :deep(.v-field__append-inner) {
    padding-left: var(--g-s-1);

    .v-icon {
      font-size: 18px;
    }
  }

  :deep(.v-field:hover .v-field__outline) {
    color: var(--g-hairline-3);
  }

  :deep(.v-field--focused .v-field__outline) {
    color: var(--g-accent);
  }
}
</style>
