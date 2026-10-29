<template>
  <div class="lnl-page">
    <!-- Header -->
    <div class="lnl-page__header">
      <div class="lnl-page__headline">
        <span class="t-label">{{ $t('bitcoin.ecosystem') }}</span>
        <h1 class="t-title">{{ $t('lightning.title') }}</h1>
        <p class="t-body lnl-page__subtitle">{{ $t('lightning.subtitle') }}</p>
      </div>
    </div>

    <!-- Resolve -->
    <section class="glass-panel lnl-panel" aria-labelledby="lnl-resolve-title">
      <h2 id="lnl-resolve-title" class="t-body-lg lnl-panel__title">{{ $t('lightning.resolve') }}</h2>
      <form class="lnl-form" @submit.prevent="resolve()">
        <label class="lnl-field">
          <!-- The input is the box itself, so the baseline focus ring is its focus style;
               the type icon and the clear button sit over its padding. -->
          <span :class="['lnl-input', { 'lnl-input--known': inputType !== 'unknown' }]">
            <v-icon size="small" class="lnl-input__icon">{{ inputTypeIcon }}</v-icon>
            <input
              v-model="input"
              class="g-mono lnl-input__control lnl-input__control--icon lnl-input__control--clearable"
              :placeholder="$t('lightning.inputPlaceholder')"
              :aria-label="$t('lightning.resolve')"
              autocomplete="off"
              spellcheck="false"
            />
            <v-btn
              v-if="input"
              icon
              variant="text"
              size="small"
              class="lnl-input__clear"
              :aria-label="$t('notify.inbox.clear')"
              :title="$t('notify.inbox.clear')"
              @click="clearInput()"
            >
              <v-icon size="small">mdi-close</v-icon>
            </v-btn>
          </span>
          <span class="t-caption">{{ $t('lightning.inputHint') }}</span>
        </label>
        <div class="lnl-actions">
          <GButton
            :tier="primaryAction === 'resolve' ? 'primary' : 'secondary'"
            type="submit"
            :loading="resolving"
            :disabled="!input.trim()"
          >
            <v-icon size="small" start>mdi-magnify</v-icon>
            {{ $t('lightning.resolveBtn') }}
          </GButton>
        </div>
      </form>
    </section>

    <!-- Error -->
    <div v-if="error" class="t-body-sm lnl-notice lnl-notice--error" role="alert">
      <v-icon size="small">mdi-alert-circle-outline</v-icon>
      <span class="lnl-notice__text">{{ error }}</span>
      <v-btn
        icon
        variant="text"
        size="x-small"
        :aria-label="$t('common.close')"
        :title="$t('common.close')"
        @click="error = null"
      >
        <v-icon size="small">mdi-close</v-icon>
      </v-btn>
    </div>

    <!-- LNURL-pay endpoint -->
    <section v-if="lnurlEndpoint" class="glass-panel lnl-panel" :aria-label="$t('lightning.lnurlPay')">
      <div class="lnl-endpoint">
        <span class="lnl-endpoint__avatar">
          <img v-if="metadataImage" :src="metadataImage" class="lnl-endpoint__image" alt="" />
          <v-icon v-else size="small">mdi-lightning-bolt</v-icon>
        </span>
        <span class="lnl-endpoint__text">
          <span class="t-body lnl-endpoint__name">{{ metadataDescription || $t('lightning.lnurlPay') }}</span>
          <span class="t-caption g-num">
            {{ formatMsats(lnurlEndpoint.minSendable) }} – {{ formatMsats(lnurlEndpoint.maxSendable) }}
          </span>
        </span>
      </div>

      <label class="lnl-field">
        <span class="t-label">{{ $t('lightning.payAmount') }}</span>
        <span :class="['lnl-input', { 'lnl-input--error': !!payAmountError }]">
          <input
            v-model="payAmount"
            class="t-body-lg g-num lnl-input__control lnl-input__control--amount lnl-input__control--unit"
            type="number"
            inputmode="numeric"
            :min="minSats"
            :max="maxSats"
          />
          <span class="t-caption g-mono lnl-input__unit">{{ $t('bitcoin.sats') }}</span>
        </span>
        <span v-if="payAmountError" class="t-caption lnl-field__error">{{ payAmountError }}</span>
        <span v-else class="t-caption g-num">
          {{ $t('lightning.amountRange', { min: formatSats(minSats), max: formatSats(maxSats) }) }}
        </span>
      </label>

      <label v-if="lnurlEndpoint.commentAllowed" class="lnl-field">
        <span class="t-label">{{ $t('lightning.comment') }}</span>
        <span class="lnl-input">
          <input
            v-model="comment"
            class="t-body-sm lnl-input__control lnl-input__control--unit"
            :maxlength="lnurlEndpoint.commentAllowed"
            :placeholder="$t('lightning.optionalComment')"
          />
          <span class="t-caption g-num lnl-input__unit">{{ comment.length }}/{{ lnurlEndpoint.commentAllowed }}</span>
        </span>
      </label>

      <div class="t-body-sm lnl-notice" role="note">
        <v-icon size="small">mdi-information-outline</v-icon>
        <span class="lnl-notice__text">{{ $t('lightning.submarineNote') }}</span>
      </div>

      <div class="lnl-actions">
        <GButton
          :tier="primaryAction === 'invoice' ? 'primary' : 'secondary'"
          :loading="requestingInvoice"
          :disabled="!isPayAmountValid"
          @click="requestInvoice()"
        >
          <v-icon size="small" start>mdi-lightning-bolt</v-icon>
          {{ $t('lightning.getInvoice') }}
        </GButton>
        <GButton tier="secondary" @click="openBoltz()">
          <v-icon size="small" start>mdi-open-in-new</v-icon>
          {{ $t('lightning.openBoltz') }}
        </GButton>
      </div>
    </section>

    <!-- Decoded BOLT11 invoice -->
    <section v-if="bolt11" class="glass-panel lnl-panel" aria-labelledby="lnl-bolt11-title">
      <h2 id="lnl-bolt11-title" class="t-body-lg lnl-panel__title">
        <v-icon size="small" class="lnl-panel__title-icon">mdi-qrcode</v-icon>
        {{ $t('lightning.bolt11Invoice') }}
      </h2>
      <dl class="lnl-facts">
        <div v-if="bolt11.amount" class="t-body-sm lnl-facts__row">
          <dt>{{ $t('lightning.amount') }}</dt>
          <dd class="g-num">{{ formatMsats(bolt11.amount) }}</dd>
        </div>
        <div class="t-body-sm lnl-facts__row">
          <dt>{{ $t('lightning.network') }}</dt>
          <dd><span class="g-mono">{{ bolt11.network }}</span></dd>
        </div>
        <div v-if="bolt11.expiry" class="t-body-sm lnl-facts__row">
          <dt>{{ $t('lightning.expiry') }}</dt>
          <dd class="g-num">{{ bolt11.expiry / 60 }} {{ $t('lightning.minutes') }}</dd>
        </div>
      </dl>

      <div class="t-body-sm lnl-notice" role="note">
        <v-icon size="small">mdi-information-outline</v-icon>
        <span class="lnl-notice__text">{{ $t('lightning.submarineNote') }}</span>
      </div>

      <div class="lnl-actions">
        <GButton :tier="primaryAction === 'boltz' ? 'primary' : 'secondary'" @click="openBoltz()">
          <v-icon size="small" start>mdi-open-in-new</v-icon>
          {{ $t('lightning.payViaBoltz') }}
        </GButton>
      </div>
    </section>

    <!-- The invoice the endpoint issued -->
    <section v-if="generatedInvoice" class="glass-panel lnl-panel" aria-labelledby="lnl-invoice-title">
      <h2 id="lnl-invoice-title" class="t-body-lg lnl-panel__title">{{ $t('lightning.paymentRequest') }}</h2>
      <!-- The whole invoice, wrapped and never truncated: it is pasted into Boltz
           and can be checked there character by character. -->
      <pre class="lnl-code g-mono">{{ generatedInvoice }}</pre>
      <div class="lnl-actions">
        <GButton :tier="primaryAction === 'pay' ? 'primary' : 'secondary'" @click="openBoltzWithInvoice(generatedInvoice)">
          <v-icon size="small" start>mdi-open-in-new</v-icon>
          {{ $t('lightning.payViaBoltz') }}
        </GButton>
        <GButton tier="secondary" @click="copyInvoice()">
          <v-icon size="small" start>{{ copied ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
          {{ copied ? $t('common.copied') : $t('common.copy') }}
        </GButton>
      </div>
    </section>

    <!-- What Lightning is. Native disclosure: keyboard-operable with no script,
         closed by default, costs no space until opened. -->
    <details class="glass-panel lnl-explainer">
      <summary class="lnl-explainer__summary">
        <v-icon size="small" class="lnl-explainer__icon">mdi-help-circle-outline</v-icon>
        <span class="t-body-sm lnl-explainer__title">{{ $t('lightning.whatIsLightning') }}</span>
        <v-icon size="small" class="lnl-explainer__chevron">mdi-chevron-down</v-icon>
      </summary>
      <p class="t-body-sm lnl-explainer__body">{{ $t('lightning.lightningExplainer') }}</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import lightningApi, { type LnurlPayEndpoint, type Bolt11Decoded } from '@/api/lightning-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatSats } from '@/shared/utils/format';
import GButton from '@/shared/components/GButton/GButton.vue';

const { t } = useTranslation();

const input = ref('');
const resolving = ref(false);
const requestingInvoice = ref(false);
const error = ref<string | null>(null);

const lnurlEndpoint = ref<LnurlPayEndpoint | null>(null);
const bolt11 = ref<Partial<Bolt11Decoded> | null>(null);
const payAmount = ref('');
const comment = ref('');
const generatedInvoice = ref<string | null>(null);
const copied = ref(false);

const inputType = computed(() => lightningApi.detectInputType(input.value.trim()));

const inputTypeIcon = computed(() => {
  switch (inputType.value) {
    case 'lnaddress': return 'mdi-email-outline';
    case 'lnurl': return 'mdi-link-variant';
    case 'bolt11': return 'mdi-qrcode';
    default: return 'mdi-lightning-bolt-outline';
  }
});

// The one gradient CTA on the page is the furthest step the user can take now
const primaryAction = computed<'resolve' | 'invoice' | 'boltz' | 'pay'>(() => {
  if (generatedInvoice.value) return 'pay';
  if (lnurlEndpoint.value) return 'invoice';
  if (bolt11.value) return 'boltz';
  return 'resolve';
});

const metadataDescription = computed(() => {
  if (!lnurlEndpoint.value) return '';
  return lightningApi.parseMetadata(lnurlEndpoint.value.metadata).description;
});

const metadataImage = computed(() => {
  if (!lnurlEndpoint.value) return null;
  return lightningApi.parseMetadata(lnurlEndpoint.value.metadata).image;
});

const minSats = computed(() => lnurlEndpoint.value ? lnurlEndpoint.value.minSendable / 1000 : 0);
const maxSats = computed(() => lnurlEndpoint.value ? lnurlEndpoint.value.maxSendable / 1000 : 0);

const isPayAmountValid = computed(() => {
  const n = parseFloat(payAmount.value);
  return !isNaN(n) && n >= minSats.value && n <= maxSats.value;
});

const amountRule = (v: string) => {
  const n = parseFloat(v);
  if (!v || isNaN(n) || n <= 0) return t('send.invalidAmount');
  if (n < minSats.value) return t('lightning.minimumSats', { value: formatSats(minSats.value) });
  if (n > maxSats.value) return t('lightning.maximumSats', { value: formatSats(maxSats.value) });
  return true;
};

const payAmountError = computed(() => {
  const result = amountRule(payAmount.value);
  return result === true ? '' : result;
});

function formatMsats(msats: number): string {
  return lightningApi.formatMsats(msats);
}

function clear() {
  lnurlEndpoint.value = null;
  bolt11.value = null;
  generatedInvoice.value = null;
  error.value = null;
  payAmount.value = '';
  comment.value = '';
}

function clearInput() {
  input.value = '';
  clear();
}

async function resolve() {
  if (!input.value.trim()) return;
  resolving.value = true;
  clear();
  try {
    const result = await lightningApi.resolve(input.value.trim());
    if (result.error) {
      error.value = result.error;
    } else if (result.lnurlEndpoint) {
      lnurlEndpoint.value = result.lnurlEndpoint;
      payAmount.value = String(Math.floor(lnurlEndpoint.value.minSendable / 1000));
    } else if (result.bolt11) {
      bolt11.value = result.bolt11;
    }
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('lightning.resolveFailed');
  } finally {
    resolving.value = false;
  }
}

async function requestInvoice() {
  if (!lnurlEndpoint.value || !isPayAmountValid.value) return;
  requestingInvoice.value = true;
  generatedInvoice.value = null;
  try {
    const amountMsats = parseFloat(payAmount.value) * 1000;
    const result = await lightningApi.requestInvoice(
      lnurlEndpoint.value,
      amountMsats,
      comment.value || undefined,
    );
    generatedInvoice.value = result.pr;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : t('lightning.invoiceFailed');
  } finally {
    requestingInvoice.value = false;
  }
}

function openBoltz() {
  window.open('https://boltz.exchange', '_blank');
}

function openBoltzWithInvoice(invoice: string) {
  window.open(`https://boltz.exchange?invoice=${encodeURIComponent(invoice)}`, '_blank');
}

async function copyInvoice() {
  if (generatedInvoice.value) {
    await navigator.clipboard.writeText(generatedInvoice.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  }
}
</script>

<style scoped lang="scss">
.lnl-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: var(--g-s-4);
}

/* ─── Header ─────────────────────────────────────────────────── */
.lnl-page__header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-4);
  flex-wrap: wrap;
}

.lnl-page__headline {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.lnl-page__headline h1,
.lnl-page__subtitle {
  margin: 0;
}

/* ─── Panels ─────────────────────────────────────────────────── */
/* Surface comes from the shared .glass-panel material; only layout lives here. */
.lnl-panel {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.lnl-panel__title {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  font-weight: 600;
}

.lnl-panel__title-icon {
  color: var(--g-text-3);
}

.lnl-form {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.lnl-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

/* ─── Fields ─────────────────────────────────────────────────── */
.lnl-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.lnl-field__error {
  color: var(--g-error);
}

/* The field box: the input itself. Icons, units and the clear button are laid
   over its padding, so the baseline focus ring on the input is the one ring. */
.lnl-input {
  position: relative;
  display: block;
}

.lnl-input__icon {
  position: absolute;
  top: 50%;
  left: var(--g-s-3);
  color: var(--g-text-3);
  transform: translateY(-50%);
  pointer-events: none;
  transition: color var(--g-dur-fast) var(--g-ease);
}

.lnl-input--known .lnl-input__icon {
  color: var(--g-accent);
}

/* Inputs are controls, not surfaces: solid raised fill. */
.lnl-input__control {
  display: block;
  width: 100%;
  height: var(--g-btn-h);
  padding: 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  color: var(--g-text-1);
  line-height: inherit;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

/* The mono input keeps g-mono's face; every other input takes the page's. */
.lnl-input__control:not(.g-mono) {
  font-family: inherit;
}

.lnl-input__control:focus {
  border-color: var(--g-accent);
}

.lnl-input--error .lnl-input__control,
.lnl-input--error .lnl-input__control:focus {
  border-color: var(--g-error);
}

.lnl-input__control::placeholder {
  color: var(--g-text-3);
}

/* Room for the type icon on the left, the clear button or unit on the right */
.lnl-input__control--icon {
  padding-left: calc(var(--g-s-5) + var(--g-s-4));
}

.lnl-input__control--clearable {
  padding-right: calc(var(--g-s-6) + var(--g-s-3));
}

.lnl-input__control--unit {
  padding-right: calc(var(--g-s-6) * 2);
}

.lnl-input__control--amount {
  font-weight: 600;
}

/* A number field without the browser's spin buttons */
.lnl-input__control--amount::-webkit-outer-spin-button,
.lnl-input__control--amount::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.lnl-input__control--amount[type='number'] {
  -moz-appearance: textfield;
}

.lnl-input__unit {
  position: absolute;
  top: 50%;
  right: var(--g-s-3);
  color: var(--g-text-3);
  transform: translateY(-50%);
  pointer-events: none;
}

.lnl-input__clear {
  position: absolute;
  top: 50%;
  right: var(--g-s-1);
  transform: translateY(-50%);
}

/* ─── Endpoint ───────────────────────────────────────────────── */
.lnl-endpoint {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.lnl-endpoint__avatar {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  overflow: hidden;
  border-radius: var(--g-r-card);
  background: var(--g-hairline-1);
  color: var(--g-text-2);
}

.lnl-endpoint__avatar .v-icon {
  color: inherit;
}

.lnl-endpoint__image {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.lnl-endpoint__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lnl-endpoint__name {
  color: var(--g-text-1);
  font-weight: 600;
  overflow-wrap: anywhere;
}

/* ─── Facts ──────────────────────────────────────────────────── */
.lnl-facts {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.lnl-facts__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.lnl-facts__row dt {
  color: var(--g-text-3);
}

.lnl-facts__row dd {
  min-width: 0;
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.lnl-facts__row dd .g-mono {
  color: var(--g-text-1);
}

/* A code block: solid raised, so the invoice reads against a known backdrop. */
.lnl-code {
  margin: 0;
  padding: var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  color: var(--g-text-1);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

/* ─── Notices ────────────────────────────────────────────────── */
.lnl-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}

.lnl-notice .v-icon {
  color: inherit;
}

.lnl-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.lnl-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ─── Explainer ──────────────────────────────────────────────── */
.lnl-explainer {
  padding: 0 var(--g-s-4);
}

.lnl-explainer__summary {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-height: var(--g-row-h-panel);
  color: var(--g-text-2);
  cursor: pointer;
  /* Drops the default triangle only. Nothing here removes an outline. */
  list-style: none;
}

.lnl-explainer__summary::-webkit-details-marker {
  display: none;
}

/* baseline.css draws the focus ring on a, button, inputs and [tabindex];
   `summary` is on none of those lists, so the same ring is restated here. */
.lnl-explainer__summary:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
  border-radius: var(--g-r-control);
}

.lnl-explainer__summary:hover {
  color: var(--g-text-1);
}

.lnl-explainer__icon {
  color: var(--g-text-3);
}

.lnl-explainer__title {
  flex: 1 1 auto;
  color: inherit;
  font-weight: 600;
}

.lnl-explainer__chevron {
  color: var(--g-text-3);
  transition: transform var(--g-dur-fast) var(--g-ease);
}

.lnl-explainer[open] .lnl-explainer__chevron {
  transform: rotate(180deg);
}

.lnl-explainer__body {
  margin: 0;
  padding: 0 0 var(--g-s-4);
}
</style>
