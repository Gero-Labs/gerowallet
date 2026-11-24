<template>
  <div class="swap-open" @dragover.prevent @drop.prevent="onDrop">
    <SwapSegmented v-if="!startWith" v-model="mode" :options="modeOptions" role="tablist" :aria-label="t('midnight.swap.open.how')" />

    <div v-if="mode === 'scan'" class="swap-open__scan">
      <div class="swap-open__camera">
        <AnimatedQRScanner
          :key="scanKey"
          :ur-types="[SWAP_OFFER_UR_TYPE]"
          :text-prefix="`${SWAP_OFFER_HRP}1`"
          width="100%"
          height="248px"
          @progress="value => (progress = value)"
          @scan="onScan"
          @error="onScanError"
        />
      </div>
      <div v-if="progress > 0" class="swap-open__progress">
        <div class="swap-open__track" aria-hidden="true"><div class="swap-open__fill" :style="{ width: `${Math.round(progress)}%` }"></div></div>
        <div class="swap-open__row t-caption">
          <span>{{ t('midnight.swap.open.scanning') }}</span>
          <span class="g-num">{{ Math.round(progress) }}%</span>
        </div>
      </div>
    </div>

    <div v-else class="swap-open__paste">
      <div class="swap-open__field">
        <label class="t-caption" :for="codeId">{{ t('midnight.swap.open.code') }}</label>
        <textarea
          :id="codeId"
          v-model="code"
          class="swap-open__code g-mono"
          rows="7"
          spellcheck="false"
          autocomplete="off"
          :placeholder="`${SWAP_OFFER_HRP}1…`"
          data-test="swap-offer-code"
        ></textarea>
      </div>
      <div class="swap-open__buttons">
        <GButton @click="pasteFromClipboard()">
          <v-icon start size="16" aria-hidden="true">mdi-content-paste</v-icon>{{ t('midnight.swap.open.pasteBtn') }}
        </GButton>
        <GButton @click="fileInput?.click()">
          <v-icon start size="16" aria-hidden="true">mdi-file-upload-outline</v-icon>{{ t('midnight.swap.open.openFile') }}
        </GButton>
        <input ref="fileInput" type="file" accept=".txt,text/plain" class="g-sr-only" tabindex="-1" @change="onFile">
      </div>
    </div>

    <SwapBanner v-if="error" tone="error">{{ error }}</SwapBanner>

    <GButton v-if="mode === 'paste'" tier="primary" block :disabled="!code.trim()" data-test="swap-review-offer" @click="submit(code)">
      {{ t('midnight.swap.reviewOffer') }}
    </GButton>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import {
  bytesFromUrCbor, decodeSwapOffer, encodeSwapOffer, SWAP_OFFER_HRP, SWAP_OFFER_UR_TYPE,
} from '@/chains/midnight/midnightSwapOffer';
import SwapSegmented from './SwapSegmented.vue';
import SwapBanner from './SwapBanner.vue';

const props = withDefaults(defineProps<{
  /** Open straight on one mode, without the switch (the dashboard's Paste code / Scan QR buttons). */
  startWith?: 'scan' | 'paste' | '';
  /** An offer string handed in (a dropped file, Gero's list). */
  initialCode?: string;
}>(), { startWith: '', initialCode: '' });
const emit = defineEmits<{ (e: 'offer', offer: string): void }>();
const { t } = useTranslation();

const mode = ref<'scan' | 'paste'>(props.startWith || (props.initialCode ? 'paste' : 'scan'));
const modeOptions = computed(() => [
  { value: 'scan' as const, label: t('midnight.swap.open.scan'), icon: 'mdi-qrcode-scan' },
  { value: 'paste' as const, label: t('midnight.swap.open.paste'), icon: 'mdi-content-paste' },
]);
const code = ref(props.initialCode);
const error = ref('');
const progress = ref(0);
const scanKey = ref(0);
const codeId = useId();
const fileInput = ref<HTMLInputElement | null>(null);

/** Hand on a well-formed offer string; the worker reads its terms. */
function submit(text: string) {
  error.value = '';
  try {
    decodeSwapOffer(text);
  } catch {
    error.value = t('midnight.swap.error.invalid');
    return;
  }
  emit('offer', text.replace(/\s+/g, ''));
}

function onScan(result: string | { type: string; cbor: Uint8Array }) {
  progress.value = 0;
  if (typeof result === 'string') { submit(result); return; }
  try {
    submit(encodeSwapOffer(bytesFromUrCbor(Uint8Array.from(result.cbor))));
  } catch {
    error.value = t('midnight.swap.error.invalid');
    scanKey.value++;
  }
}

function onScanError() {
  error.value = t('midnight.swap.error.invalid');
  scanKey.value++;
}

async function pasteFromClipboard() {
  try {
    code.value = (await navigator.clipboard.readText()).trim();
    error.value = '';
  } catch {
    error.value = t('midnight.swap.error.clipboard');
  }
}

async function readFile(file: File) {
  // An offer file is text: a few KB for a public offer, never more than the wallet reads.
  if (file.size > 2_000_000) { error.value = t('midnight.swap.error.invalid'); return; }
  code.value = (await file.text()).trim();
  mode.value = 'paste';
  submit(code.value);
}

function onFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) void readFile(file);
  (event.target as HTMLInputElement).value = '';
}

function onDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0];
  if (file) void readFile(file);
}
</script>

<style scoped lang="scss">
.swap-open {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}

.swap-open__scan,
.swap-open__paste,
.swap-open__field,
.swap-open__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* The camera view: a justified solid. */
.swap-open__camera {
  min-height: 248px;
  border-radius: var(--g-r-card);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* A control: a justified solid. */
.swap-open__code {
  width: 100%;
  resize: none;
  padding: 10px var(--g-s-3);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  word-break: break-all;
}

.swap-open__code:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 1px;
}

.swap-open__buttons {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.swap-open__track {
  height: 4px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  overflow: hidden;
}

.swap-open__fill {
  height: 100%;
  background: var(--g-accent);
}

.swap-open__row {
  display: flex;
  justify-content: space-between;
}
</style>
