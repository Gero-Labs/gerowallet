<template>
  <v-dialog
    :value="value"
    persistent
    max-width="420"
    dark
    overlay-color="#000"
    overlay-opacity="0.6"
    @input="onDialogInput"
  >
    <div class="twap-dialog">
      <!-- Header -->
      <div class="td-header">
        <span class="td-title">{{ $t('perps.algo.twapTitle') }}</span>
        <button class="td-close" :title="$t('perpetuals.cancel')" @click="close()">
          <v-icon size="16">mdi-close</v-icon>
        </button>
      </div>
      <p class="td-description">{{ $t('perps.algo.twapDescription') }}</p>

      <!-- Side toggle -->
      <v-btn-toggle v-model="side" mandatory class="td-side-toggle">
        <v-btn value="BUY" class="td-side-btn td-side-btn--buy" :class="{ active: side === 'BUY' }">
          <v-icon size="13" class="mr-1">mdi-arrow-up</v-icon>
          {{ $t('perps.algo.buy') }}
        </v-btn>
        <v-btn value="SELL" class="td-side-btn td-side-btn--sell" :class="{ active: side === 'SELL' }">
          <v-icon size="13" class="mr-1">mdi-arrow-down</v-icon>
          {{ $t('perps.algo.sell') }}
        </v-btn>
      </v-btn-toggle>

      <!-- Symbol -->
      <v-text-field
        v-model="symbolModel"
        :label="$t('perps.algo.symbol')"
        outlined
        dense
        dark
        hide-details
        class="td-input mb-2"
      />

      <!-- Total size -->
      <v-text-field
        v-model="totalSize"
        :label="$t('perps.algo.totalSize')"
        outlined
        dense
        dark
        hide-details
        class="td-input mb-2"
        type="number"
        min="0"
      />

      <!-- Duration / Interval -->
      <div class="td-row">
        <v-text-field
          v-model.number="durationMinutes"
          :label="$t('perps.algo.durationMin')"
          outlined
          dense
          dark
          hide-details
          class="td-input"
          type="number"
          :min="5"
          :max="1440"
        />
        <v-text-field
          v-model.number="intervalSeconds"
          :label="$t('perps.algo.intervalSec')"
          outlined
          dense
          dark
          hide-details
          class="td-input"
          type="number"
          :min="1"
        />
      </div>

      <!-- Limit price (optional) -->
      <v-text-field
        v-model="limitPrice"
        :label="$t('perps.algo.limitPrice')"
        outlined
        dense
        dark
        hide-details
        class="td-input mb-2"
        type="number"
        min="0"
      />

      <!-- Toggles -->
      <div class="td-toggles">
        <label class="td-toggle">
          <input v-model="reduceOnly" type="checkbox" />
          <span>{{ $t('perps.algo.reduceOnly') }}</span>
        </label>
        <label class="td-toggle">
          <input v-model="randomize" type="checkbox" />
          <span>
            {{ $t('perps.algo.randomize') }}
            <small class="td-hint">{{ $t('perps.algo.randomizeHint') }}</small>
          </span>
        </label>
      </div>

      <!-- Slice preview -->
      <div class="td-preview">
        <span class="td-preview-label t-label">{{ $t('perps.algo.slices') }}</span>
        <span class="td-preview-value">{{ slicePreview }}</span>
      </div>

      <!-- Error -->
      <div v-if="errorMessage" class="td-error">{{ errorMessage }}</div>

      <!-- Actions -->
      <div class="td-actions">
        <button class="td-btn td-btn--ghost" :disabled="submitting" @click="close()">
          {{ $t('perpetuals.cancel') }}
        </button>
        <button
          class="td-btn td-btn--primary"
          :disabled="!canSubmit || submitting"
          @click="submit()"
        >
          <v-progress-circular v-if="submitting" indeterminate size="14" width="2" />
          <span v-else>{{ $t('perps.algo.create') }}</span>
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import i18n from '@/plugins/i18n';
import { useStrikeTrading } from '@/modules/market/composables/useStrikeTrading';
import type { CreateTwapRequest, TwapSide } from '@/api/strike-v2.types';

const props = withDefaults(defineProps<{
  value: boolean;
  symbol?: string;
}>(), {
  value: false,
  symbol: '',
});

const emit = defineEmits<{
  (e: 'input', val: boolean): void;
  (e: 'created', strategyId: string): void;
}>();

const t = (key: string): string => i18n.t(key) as string;
const { placeTwapOrder } = useStrikeTrading();

const side = ref<TwapSide>('BUY');
const symbolModel = ref<string>(props.symbol);
const totalSize = ref<string>('');
const durationMinutes = ref<number>(60);
const intervalSeconds = ref<number>(30);
const limitPrice = ref<string>('');
const reduceOnly = ref<boolean>(false);
const randomize = ref<boolean>(false);
const submitting = ref<boolean>(false);
const errorMessage = ref<string | null>(null);

watch(() => props.symbol, (next) => {
  if (next) symbolModel.value = next;
});

watch(() => props.value, (open) => {
  if (open) {
    errorMessage.value = null;
    submitting.value = false;
  }
});

const slicePreview = computed<number>(() => {
  const dur = Number(durationMinutes.value) * 60;
  const ivl = Number(intervalSeconds.value);
  if (!dur || !ivl || ivl <= 0) return 0;
  return Math.max(1, Math.floor(dur / ivl));
});

const canSubmit = computed<boolean>(() => {
  if (!symbolModel.value) return false;
  if (!totalSize.value) return false;
  const sizeNum = Number(totalSize.value);
  if (!Number.isFinite(sizeNum) || sizeNum <= 0) return false;
  if (durationMinutes.value < 5 || durationMinutes.value > 1440) return false;
  if (intervalSeconds.value <= 0) return false;
  return true;
});

function close(): void {
  emit('input', false);
}

function onDialogInput(val: boolean): void {
  emit('input', val);
}

function validate(): string | null {
  if (!totalSize.value) return t('perps.algo.errorSizeRequired');
  const sizeNum = Number(totalSize.value);
  if (!Number.isFinite(sizeNum) || sizeNum <= 0) return t('perps.algo.errorSizePositive');
  if (durationMinutes.value < 5) return t('perps.algo.errorDurationMin');
  if (durationMinutes.value > 1440) return t('perps.algo.errorDurationMax');
  return null;
}

async function submit(): Promise<void> {
  errorMessage.value = null;
  const v = validate();
  if (v) { errorMessage.value = v; return; }

  const req: CreateTwapRequest = {
    symbol: symbolModel.value,
    side: side.value,
    total_size: String(totalSize.value),
    duration_sec: Math.round(Number(durationMinutes.value) * 60),
    reduce_only: reduceOnly.value || undefined,
    randomize: randomize.value || undefined,
  };
  const trimmedLimit = (limitPrice.value || '').trim();
  if (trimmedLimit) req.limit_price = trimmedLimit;

  submitting.value = true;
  try {
    const res = await placeTwapOrder(req);
    if (res?.strategy_id) {
      emit('created', res.strategy_id);
      close();
    } else {
      errorMessage.value = t('perpetuals.failedToOpenPosition');
    }
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.twap-dialog {
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.td-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.td-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
}

.td-close {
  background: none;
  border: none;
  color: var(--g-text-3);
  cursor: pointer;
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
}

.td-close:hover {
  color: var(--g-text-1);
  background: rgba(255, 255, 255, 0.08);
}

.td-description {
  font-size: 11px;
  color: var(--g-text-3);
  margin: 0 0 4px 0;
  line-height: 1.4;
}

.td-side-toggle {
  display: flex;
  background: rgba(255, 255, 255, 0.04);
  border-radius: var(--g-r-control);
  padding: 3px;
  margin-bottom: 4px;
}

.td-side-btn {
  flex: 1;
  border-radius: var(--g-r-control) !important;
  text-transform: none;
  font-weight: 700;
  font-size: 12px;
  background: transparent !important;
  color: var(--g-text-3) !important;
  height: 30px !important;
  box-shadow: none !important;
}

.td-side-btn--buy.active {
  background: var(--g-success-fill) !important;
  color: var(--g-success) !important;
}

.td-side-btn--sell.active {
  background: var(--g-error-fill) !important;
  color: var(--g-error) !important;
}

.td-input :deep(.v-input__slot) {
  background: rgba(255, 255, 255, 0.03) !important;
  border-radius: var(--g-r-control) !important;
  min-height: 36px !important;
}

/* Hide native number-input spinner buttons (up/down arrows) */
.td-input :deep(input[type='number']) { -moz-appearance: textfield; appearance: textfield; }
.td-input :deep(input[type='number'])::-webkit-outer-spin-button,
.td-input :deep(input[type='number'])::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }

.td-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 4px;
}

.td-toggles {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 0;
}

.td-toggle {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--g-text-2);
  cursor: pointer;
}

.td-toggle input {
  margin-top: 2px;
  accent-color: var(--g-accent);
}

.td-hint {
  display: block;
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 1px;
}

.td-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--g-accent) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 15%, transparent);
  border-radius: var(--g-r-control);
  font-size: 11px;
}

.td-preview-value {
  color: var(--g-accent);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

.td-error {
  font-size: 11px;
  color: var(--g-error);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  border-radius: var(--g-r-control);
  padding: 6px 8px;
}

.td-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.td-btn {
  flex: 1;
  height: 36px;
  border-radius: var(--g-r-control);
  border: none;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.td-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.td-btn--ghost {
  background: rgba(255, 255, 255, 0.06);
  color: var(--g-text-2);
}

.td-btn--ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.td-btn--primary {
  background: var(--g-accent);
  color: var(--g-on-grad);
}

.td-btn--primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--g-accent) 88%, var(--g-canvas));
}
</style>