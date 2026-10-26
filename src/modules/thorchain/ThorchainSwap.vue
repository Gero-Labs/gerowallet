<template>
  <div class="thor">
    <!-- Header -->
    <div class="thor__header">
      <div class="thor__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title">{{ $t('thorchain.title') }}</h1>
        <p class="t-body thor__subtitle">{{ $t('thorchain.subtitle') }}</p>
      </div>
    </div>

    <!-- Swap form. Shared glass-panel material; only layout lives here. -->
    <section class="glass-panel thor__card" :aria-label="$t('thorchain.title')">
      <!-- From -->
      <div class="thor__leg">
        <span class="t-label">{{ $t('thorchain.from') }}</span>
        <div class="thor__row">
          <span class="thor-input thor-input--asset">
            <select
              v-model="fromAsset"
              class="t-body-sm thor-input__select"
              :aria-label="$t('thorchain.from')"
              @change="debouncedGetQuote"
            >
              <option v-for="asset in assetOptions" :key="asset.value" :value="asset.value">{{ asset.label }}</option>
            </select>
            <v-icon size="small" class="thor-input__chevron" aria-hidden="true">mdi-chevron-down</v-icon>
          </span>
          <span class="thor-input thor-input--amount">
            <span class="thor-input__unit g-mono">{{ fromTicker }}</span>
            <input
              :value="fromAmount"
              class="t-body-lg g-num thor-input__control thor-input__control--amount"
              type="number"
              min="0"
              step="0.0001"
              placeholder="0.00"
              :aria-label="$t('thorchain.amount')"
              @input="onAmountInput"
            />
          </span>
        </div>
      </div>

      <!-- Swap direction -->
      <div class="thor__flip">
        <v-btn
          icon
          variant="text"
          size="small"
          :aria-label="$t('thorchain.switchAssets')"
          :title="$t('thorchain.switchAssets')"
          @click="swapAssets()"
        >
          <v-icon size="small">mdi-swap-vertical</v-icon>
        </v-btn>
      </div>

      <!-- To -->
      <div class="thor__leg">
        <span class="t-label">{{ $t('thorchain.to') }}</span>
        <div class="thor__row">
          <span class="thor-input thor-input--asset">
            <select
              v-model="toAsset"
              class="t-body-sm thor-input__select"
              :aria-label="$t('thorchain.to')"
              @change="debouncedGetQuote"
            >
              <option v-for="asset in assetOptions" :key="asset.value" :value="asset.value">{{ asset.label }}</option>
            </select>
            <v-icon size="small" class="thor-input__chevron" aria-hidden="true">mdi-chevron-down</v-icon>
          </span>
          <span class="thor-input thor-input--amount">
            <span class="thor-input__unit g-mono">{{ toTicker }}</span>
            <input
              :value="expectedOut"
              readonly
              class="t-body-lg g-num thor-input__control thor-input__control--amount thor-input__control--out"
              placeholder="0.00"
              :aria-label="$t('thorchain.youReceive')"
            />
            <v-progress-circular v-if="quoteLoading" indeterminate size="16" width="2" color="var(--g-accent)" />
          </span>
        </div>
      </div>

      <!-- Destination address -->
      <label class="thor-field">
        <span class="t-label">{{ $t('thorchain.destinationAddress') }}</span>
        <span :class="['thor-input', { 'thor-input--error': !!addressError }]">
          <v-icon size="small" class="thor-input__icon" aria-hidden="true">mdi-wallet-outline</v-icon>
          <input
            v-model="destinationAddress"
            class="g-mono thor-input__control"
            :placeholder="$t('thorchain.destinationPlaceholder')"
            autocomplete="off"
            spellcheck="false"
            @input="debouncedGetQuote"
          />
        </span>
        <span v-if="addressError" class="t-caption thor-field__error">{{ addressError }}</span>
      </label>

      <!-- Quote -->
      <transition name="thor-fade">
        <dl v-if="quote && !quoteLoading" class="glass-tier thor-quote">
          <div class="t-body-sm thor-quote__row">
            <dt>{{ $t('thorchain.slippage') }}</dt>
            <dd :class="['g-num', { 'thor-quote__warn': quote.fees.slippage_bps > 100 }]">
              {{ (quote.fees.slippage_bps / 100).toFixed(2) }}%
            </dd>
          </div>
          <div class="t-body-sm thor-quote__row">
            <dt>{{ $t('thorchain.networkFees') }}</dt>
            <dd class="g-num">{{ formatFees(quote) }}</dd>
          </div>
          <div class="t-body-sm thor-quote__row">
            <dt>{{ $t('thorchain.estimatedTime') }}</dt>
            <dd class="g-num">{{ $t('bitcoin.etaMinutes', { minutes: Math.round(quote.total_swap_seconds / 60) }) }}</dd>
          </div>
          <div class="t-body-sm thor-quote__row thor-quote__row--total">
            <dt>{{ $t('thorchain.youReceive') }}</dt>
            <dd class="g-num thor-quote__out">{{ expectedOut }} {{ toTicker }}</dd>
          </div>
        </dl>
      </transition>

      <!-- Warnings and errors -->
      <div v-if="quote?.warning" class="t-body-sm thor-notice thor-notice--warning" role="status">
        <v-icon size="small">mdi-alert-outline</v-icon>
        <span class="thor-notice__text">{{ quote.warning }}</span>
      </div>
      <div v-if="quoteError" class="t-body-sm thor-notice thor-notice--error" role="alert">
        <v-icon size="small">mdi-alert-circle-outline</v-icon>
        <span class="thor-notice__text">{{ quoteError }}</span>
      </div>

      <GButton tier="primary" block :disabled="!isValid || !quote" @click="initiateSwap()">
        <v-icon size="small" start>mdi-swap-horizontal</v-icon>
        {{ $t('thorchain.initiateSwap') }}
      </GButton>
    </section>

    <!-- Info note -->
    <div class="t-body-sm thor-notice">
      <v-icon size="small">mdi-information-outline</v-icon>
      <span class="thor-notice__text">{{ $t('thorchain.infoNote') }}</span>
    </div>

    <!-- How it works -->
    <section :class="['glass-panel', 'thor-how', { 'thor-how--open': howOpen }]">
      <button
        type="button"
        class="thor-how__head"
        :aria-expanded="howOpen ? 'true' : 'false'"
        aria-controls="thor-how-steps"
        @click="howOpen = !howOpen"
      >
        <span class="thor-how__icon"><v-icon size="18">mdi-information-outline</v-icon></span>
        <span class="t-body thor-how__title">{{ $t('thorchain.howItWorks') }}</span>
        <v-icon size="small" class="thor-how__chevron">mdi-chevron-down</v-icon>
      </button>
      <ol v-show="howOpen" id="thor-how-steps" class="thor-how__steps">
        <li v-for="(stepKey, i) in howSteps" :key="stepKey" class="thor-how__step">
          <span class="t-caption g-num thor-how__num">{{ i + 1 }}</span>
          <span class="t-body-sm">{{ $t(stepKey) }}</span>
        </li>
      </ol>
    </section>

    <!-- Confirm -->
    <BaseDialog
      size="sm"
      :isOpen="confirmDialog"
      :title="t('thorchain.confirmSwap')"
      :img="assts.swapSvg"
      img-color="var(--g-accent)"
      :min-height="0"
      @close="confirmDialog = false"
    >
      <v-card-text v-if="quote" class="px-5 pt-1 pb-5 thor-confirm">
        <div class="t-body-sm thor-notice thor-notice--warning" role="status">
          <v-icon size="small">mdi-alert-outline</v-icon>
          <span class="thor-notice__text">{{ $t('thorchain.sendExactAmount') }}</span>
        </div>

        <!-- The whole address and memo, wrapping: the user copies and checks them. -->
        <dl class="thor-facts">
          <div class="thor-fact">
            <dt class="t-label">{{ $t('thorchain.sendTo') }}</dt>
            <dd>
              <span class="g-mono thor-fact__mono">{{ quote.inbound_address }}</span>
              <CopyButton x-small :value="quote.inbound_address" />
            </dd>
          </div>
          <div class="thor-fact">
            <dt class="t-label">{{ $t('thorchain.amount') }}</dt>
            <dd><span class="t-body-lg g-num thor-fact__amount">{{ fromAmount }} {{ fromTicker }}</span></dd>
          </div>
          <div class="thor-fact">
            <dt class="t-label">{{ $t('thorchain.memo') }}</dt>
            <dd>
              <span class="g-mono thor-fact__mono">{{ quote.memo }}</span>
              <CopyButton x-small :value="quote.memo" />
            </dd>
          </div>
        </dl>

        <div class="thor-confirm__nav">
          <GButton tier="secondary" @click="confirmDialog = false">{{ $t('common.cancel') }}</GButton>
          <GButton tier="primary" @click="executeSwap()">{{ $t('thorchain.confirmSwap') }}</GButton>
        </div>
      </v-card-text>
    </BaseDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { isAxiosError } from 'axios';
import thorchainApi, { type ThorQuote } from '@/api/thorchain-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import assts from '@/utils/assets';

const { t } = useTranslation();

const fromAsset = ref('BTC.BTC');
const toAsset = ref('ADA.ADA');
const fromAmount = ref('');
const destinationAddress = ref('');
const quote = ref<ThorQuote | null>(null);
const quoteLoading = ref(false);
const quoteError = ref<string | null>(null);
const confirmDialog = ref(false);
const howOpen = ref(false);

// Venues and assets are named, not painted: no per-asset colour.
const assetOptions = [
  { value: 'BTC.BTC', label: 'Bitcoin (BTC)', ticker: 'BTC', name: 'Bitcoin' },
  { value: 'ADA.ADA', label: 'Cardano (ADA)', ticker: 'ADA', name: 'Cardano' },
  { value: 'ETH.ETH', label: 'Ethereum (ETH)', ticker: 'ETH', name: 'Ethereum' },
];

const howSteps = ['thorchain.step1', 'thorchain.step2', 'thorchain.step3', 'thorchain.step4'];

const fromTicker = computed(() => fromAsset.value.split('.')[1]);
const toTicker = computed(() => toAsset.value.split('.')[1]);

const expectedOut = computed(() => {
  if (!quote.value) return '';
  const out = parseInt(quote.value.expected_amount_out);
  if (isNaN(out)) return '';
  return (out / 1e8).toFixed(8);
});

const isValid = computed(() => {
  const n = parseFloat(fromAmount.value);
  return !isNaN(n) && n > 0 && destinationAddress.value.length > 10 && fromAsset.value !== toAsset.value;
});

const addressRule = (v: string) => {
  if (!v) return true;
  if (v.length < 10) return t('thorchain.invalidDestination');
  return true;
};

const addressError = computed(() => {
  const result = addressRule(destinationAddress.value);
  return result === true ? '' : result;
});

function formatFees(q: ThorQuote): string {
  const total = parseInt(q.fees.total);
  return isNaN(total) ? '—' : `${(total / 1e8).toFixed(8)} ${q.fees.asset}`;
}

// The amount stays a string, as the text field kept it: no number cast from the input.
function onAmountInput(event: Event) {
  fromAmount.value = (event.target as HTMLInputElement).value;
  debouncedGetQuote();
}

function swapAssets() {
  const temp = fromAsset.value;
  fromAsset.value = toAsset.value;
  toAsset.value = temp;
  quote.value = null;
  fromAmount.value = '';
}

let quoteTimeout: ReturnType<typeof setTimeout> | null = null;
function debouncedGetQuote() {
  quote.value = null;
  quoteError.value = null;
  if (quoteTimeout) clearTimeout(quoteTimeout);
  if (!isValid.value) return;
  quoteTimeout = setTimeout(fetchQuote, 600);
}

async function fetchQuote() {
  if (!isValid.value) return;
  quoteLoading.value = true;
  quoteError.value = null;
  try {
    const amountInSats = Math.round(parseFloat(fromAmount.value) * 1e8);
    quote.value = await thorchainApi.getSwapQuote(
      fromAsset.value,
      toAsset.value,
      amountInSats,
      destinationAddress.value,
    );
  } catch (e: unknown) {
    const fallback = t('thorchain.quoteFailed');
    quoteError.value = isAxiosError<{ error?: string }>(e) ? e.response?.data?.error || fallback : fallback;
  } finally {
    quoteLoading.value = false;
  }
}

function initiateSwap() {
  confirmDialog.value = true;
}

function executeSwap() {
  const txUrl = `https://track.ninerealms.com/`;
  window.open(txUrl, '_blank');
  confirmDialog.value = false;
}
</script>

<style scoped lang="scss">
.thor {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  max-width: 640px;
  margin: 0 auto;
  padding: var(--g-s-4);
}

/* ── Header ─────────────────────────────────────────────── */
.thor__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.thor__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.thor__headline h1,
.thor__subtitle {
  margin: 0;
}

/* ── Form ───────────────────────────────────────────────── */
.thor__card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.thor__leg {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.thor__row {
  display: flex;
  gap: var(--g-s-2);
}

.thor__flip {
  display: flex;
  justify-content: center;
  margin: calc(-1 * var(--g-s-2)) 0;
}

.thor-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.thor-field__error {
  color: var(--g-error);
}

/* Inputs are controls, not surfaces: solid raised fill. The focus ring lives on the
   wrapper, so the bare control inside needs none of its own. */
.thor-input {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-height: var(--g-btn-h);
  padding: 0 var(--g-s-2) 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.thor-input:focus-within {
  border-color: var(--g-accent);
}

.thor-input--error,
.thor-input--error:focus-within {
  border-color: var(--g-error);
}

.thor-input--asset {
  flex: 0 0 150px;
  padding-right: 0;
}

.thor-input--amount {
  flex: 1 1 auto;
  min-width: 0;
}

.thor-input__select {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  padding-right: var(--g-s-6);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font-family: inherit;
  font-weight: 600;
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

/* The wrapper paints focus (focus-within). The bare control keeps its own ring but
   transparent, so forced-colors mode can still paint one. */
.thor-input__select:focus-visible,
.thor-input__control:focus-visible {
  outline-color: transparent;
}

/* The native option list is a popover: a solid is the justified material. */
.thor-input__select option {
  background: var(--g-overlay);
  color: var(--g-text-1);
}

.thor-input .thor-input__chevron {
  position: absolute;
  right: var(--g-s-2);
  color: var(--g-text-3);
  pointer-events: none;
}

.thor-input .thor-input__icon {
  color: var(--g-text-3);
}

.thor-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
}

.thor-input__control::placeholder {
  color: var(--g-text-3);
}

.thor-input__control--amount {
  font-weight: 600;
}

.thor-input__control--out {
  color: var(--g-success);
}

/* A number field without the browser's spin buttons */
.thor-input__control--amount::-webkit-outer-spin-button,
.thor-input__control--amount::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.thor-input__control--amount[type='number'] {
  -moz-appearance: textfield;
}

.thor-input__unit {
  color: var(--g-text-3);
}

/* ── Quote ──────────────────────────────────────────────── */
.thor-quote {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: var(--g-s-1) var(--g-s-4);
}

.thor-quote__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.thor-quote__row:first-child {
  border-top: 0;
}

.thor-quote__row dt {
  color: var(--g-text-3);
}

.thor-quote__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.thor-quote__row--total dd {
  font-weight: 600;
}

.thor-quote__row dd.thor-quote__warn {
  color: var(--g-warning);
}

.thor-quote__row dd.thor-quote__out {
  color: var(--g-success);
}

.thor-fade-enter-active,
.thor-fade-leave-active {
  transition: opacity var(--g-dur-base) var(--g-ease);
}

.thor-fade-enter-from,
.thor-fade-leave-to {
  opacity: 0;
}

/* ── Notices ────────────────────────────────────────────── */
.thor-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}

.thor-notice .v-icon {
  flex: 0 0 auto;
  color: inherit;
}

.thor-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.thor-notice--warning {
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
  color: var(--g-warning);
}

.thor-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── How it works ───────────────────────────────────────── */
.thor-how__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  height: 52px;
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease);
}

.thor-how__head:hover {
  background: var(--g-hairline-1);
}

.thor-how__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.thor-how__icon .v-icon {
  color: var(--g-text-2);
}

.thor-how__title {
  color: var(--g-text-1);
  font-weight: 600;
}

.thor-how__head .thor-how__chevron {
  margin-left: auto;
  color: var(--g-text-3);
  transition: transform var(--g-dur-base) var(--g-ease);
}

.thor-how--open .thor-how__head .thor-how__chevron {
  transform: rotate(180deg);
}

.thor-how__steps {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0 var(--g-s-4) var(--g-s-4);
  list-style: none;
}

.thor-how__step {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}

.thor-how__num {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
  color: var(--g-text-1);
  font-weight: 600;
}

/* ── Confirm dialog ─────────────────────────────────────── */
/* Sits above BaseDialog's decorative rings, which are positioned. */
.thor-confirm {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.thor-facts {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.thor-fact {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--g-s-3) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.thor-fact dd {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-1);
  min-width: 0;
  margin: 0;
}

.thor-fact__mono {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--g-text-1);
  overflow-wrap: anywhere;
}

.thor-fact__amount {
  font-weight: 600;
}

.thor-confirm__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
