<template>
  <BaseDialog
    size="sm"
    :isOpen="props.modelValue"
    :title="t('send.sendBitcoin')"
    :img="assts.sendSvg"
    img-color="var(--g-accent)"
    :min-height="0"
    :scrollable="true"
    :loading="loading"
    :persistent="true"
    @close="closeDialog"
  >
    <v-card-text class="px-5 pt-1 pb-5 btc-send">

      <!-- ── Step progress ── -->
      <ol class="btc-send__steps">
        <li
          v-for="(label, i) in stepLabels"
          :key="label"
          :class="['btc-send__step', { 'btc-send__step--active': currentStep === i + 1, 'btc-send__step--done': currentStep > i + 1 }]"
          :aria-current="currentStep === i + 1 ? 'step' : undefined"
        >
          <span class="btc-send__step-bar" />
          <span class="btc-send__step-label">{{ label }}</span>
        </li>
      </ol>

      <transition name="btc-step" mode="out-in">
        <!-- ════ Step 1: recipient and amount ════ -->
        <div v-if="currentStep === 1" key="step1" class="btc-send__body">
          <label class="btc-field">
            <span class="t-label">{{ $t('send.recipientAddress') }}</span>
            <span :class="['btc-input', { 'btc-input--error': !!addressError, 'btc-input--valid': recipientAddress && !addressError }]">
              <input
                v-model="recipientAddress"
                class="btc-input__control g-mono"
                :placeholder="t('bitcoin.addressPlaceholder')"
                autocomplete="off"
                spellcheck="false"
                @input="validateAddress"
              />
              <v-btn
                icon
                variant="text"
                size="small"
                :aria-label="t('common.paste')"
                :title="t('common.paste')"
                @click="pasteAddress()"
              >
                <v-icon size="small">mdi-content-paste</v-icon>
              </v-btn>
            </span>
            <span v-if="addressError" class="btc-field__error">{{ addressError }}</span>
          </label>

          <label class="btc-field">
            <span class="t-label">{{ $t('send.amount') }}</span>
            <span :class="['btc-input', { 'btc-input--error': !!amountError }]">
              <span class="btc-input__unit g-mono">{{ ticker }}</span>
              <input
                v-model="amountBtc"
                class="btc-input__control btc-input__control--amount g-num"
                type="number"
                step="0.00000001"
                min="0"
                placeholder="0.00000000"
                @input="validateAmount"
              />
              <GButton tier="tertiary" compact @click="setMaxAmount()">{{ $t('common.max') }}</GButton>
            </span>
            <span v-if="amountError" class="btc-field__error">{{ amountError }}</span>
            <span v-else-if="amountInSats > 0" class="t-caption g-num">{{ amountLine(amountInSats) }}</span>
          </label>

          <div class="btc-send__balance t-caption">
            <span>{{ $t('send.availableBalance') }}</span>
            <span class="g-num btc-send__balance-value">{{ formatBtc(availableBalance) }} {{ ticker }}</span>
            <span class="g-num">({{ $t('bitcoin.satsValue', { value: formatSats(availableBalance) }) }})</span>
          </div>
        </div>

        <!-- ════ Step 2: fee ════ -->
        <div v-else-if="currentStep === 2" key="step2" class="btc-send__body">
          <div class="btc-fees" role="radiogroup" :aria-label="t('bitcoin.feeSpeed')">
            <button
              v-for="tier in feeTiers"
              :key="tier.key"
              type="button"
              role="radio"
              :aria-checked="selectedFeePriority === tier.key ? 'true' : 'false'"
              :class="['glass-tier', 'btc-fee', { 'btc-fee--selected': selectedFeePriority === tier.key }]"
              @click="selectedFeePriority = tier.key"
            >
              <span class="btc-fee__top">
                <span class="btc-fee__name">{{ tier.label }}</span>
                <span class="btc-fee__dots" aria-hidden="true">
                  <span v-for="d in 3" :key="d" :class="['btc-fee__dot', { 'btc-fee__dot--lit': d <= tier.dots }]" />
                </span>
              </span>
              <span class="btc-fee__rate g-num">{{ $t('bitcoin.feeRateValue', { value: feeEstimates[tier.key] }) }}</span>
              <span class="t-caption">{{ tier.time }}</span>
              <span class="t-caption g-num">≈ {{ formatBtc(estimatedFeeSatsFor(tier.key)) }}</span>
            </button>
          </div>

          <dl class="btc-summary">
            <div class="btc-summary__row">
              <dt>{{ $t('send.amount') }}</dt>
              <dd class="g-num">{{ formatBtc(amountInSats) }} {{ ticker }}</dd>
            </div>
            <div class="btc-summary__row">
              <dt>{{ $t('send.estimatedFee') }}</dt>
              <dd class="g-num">
                {{ formatBtc(estimatedFeeSats) }} {{ ticker }}
                <span class="btc-summary__sub">{{ $t('bitcoin.satsValue', { value: formatSats(estimatedFeeSats) }) }}</span>
              </dd>
            </div>
            <div class="btc-summary__row btc-summary__row--total">
              <dt>{{ $t('send.total') }}</dt>
              <dd class="g-num">{{ formatBtc(totalAmount) }} {{ ticker }}</dd>
            </div>
          </dl>

          <div v-if="totalAmount > availableBalance" class="btc-notice btc-notice--error">
            <v-icon size="small">mdi-alert-circle-outline</v-icon>
            {{ $t('send.insufficientBalance') }}
          </div>
        </div>

        <!-- ════ Step 3: review and send ════ -->
        <div v-else-if="currentStep === 3" key="step3" class="btc-send__body">
          <div class="glass-tier btc-review">
            <span class="t-label">{{ $t('perpetuals.deposit.youSend') }}</span>
            <span class="btc-review__amount">
              <span class="t-display g-num">{{ formatBtc(amountInSats) }}</span>
              <span class="btc-review__unit g-mono">{{ ticker }}</span>
            </span>
            <span v-if="fiatOf(amountInSats)" class="t-caption g-num">≈ {{ fiatOf(amountInSats) }}</span>

            <span class="t-label btc-review__to">{{ $t('send.to') }}</span>
            <!-- The whole address, so it can be checked character by character before signing -->
            <span class="g-mono btc-review__address">{{ recipientAddress }}</span>

            <dl class="btc-summary btc-review__meta">
              <div class="btc-summary__row">
                <dt>{{ $t('send.fee') }}</dt>
                <dd class="g-num">{{ formatBtc(estimatedFeeSats) }} {{ ticker }}</dd>
              </div>
              <div class="btc-summary__row btc-summary__row--total">
                <dt>{{ $t('send.total') }}</dt>
                <dd class="g-num">{{ formatBtc(totalAmount) }} {{ ticker }}</dd>
              </div>
            </dl>
          </div>

          <!-- PassKey (PRF) wallet -->
          <template v-if="isPrfWallet">
            <div v-if="!privateKeyBytes" class="btc-auth">
              <span class="t-caption">{{ $t('security.passKeyAuthRequired') }}</span>
              <GButton tier="secondary" block @click="authenticateWithPassKey()">
                <v-icon size="small" start>mdi-fingerprint</v-icon>
                {{ $t('security.authenticateWithPassKey') }}
              </GButton>
            </div>
            <div v-else class="btc-notice btc-notice--success">
              <v-icon size="small">mdi-check-circle-outline</v-icon>
              <span class="btc-notice__text">{{ $t('security.passKeyAuthenticated') }}</span>
              <v-btn
                icon
                variant="text"
                size="x-small"
                :aria-label="t('security.authenticateWithPassKey')"
                :title="t('security.authenticateWithPassKey')"
                @click="privateKeyBytes = null"
              >
                <v-icon size="small">mdi-refresh</v-icon>
              </v-btn>
            </div>
          </template>

          <!-- Password wallet -->
          <label v-else-if="!isHardwareWallet" class="btc-field">
            <span class="t-label">{{ $t('send.spendingPassword') }}</span>
            <span class="btc-input">
              <input
                v-model="password"
                class="btc-input__control"
                :type="showPassword ? 'text' : 'password'"
                autocomplete="current-password"
                @keyup.enter="confirmSend"
              />
              <v-btn
                icon
                variant="text"
                size="small"
                :aria-label="showPassword ? t('common.hidePassword') : t('common.showPassword')"
                @click="showPassword = !showPassword"
              >
                <v-icon size="small">{{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
              </v-btn>
            </span>
          </label>

          <!-- Hardware wallet -->
          <div v-else class="btc-notice">
            <v-icon size="small">mdi-usb-flash-drive</v-icon>
            {{ $t('send.hardwareWalletInstructions') }}
          </div>

          <div v-if="txStatus.message" :class="['btc-notice', `btc-notice--${txStatus.type}`]" role="status">
            <v-icon size="small">{{ STATUS_ICONS[txStatus.type] }}</v-icon>
            <span class="btc-notice__text">{{ txStatus.message }}</span>
          </div>
        </div>
      </transition>

      <!-- ── Navigation ── -->
      <div class="btc-send__nav">
        <GButton v-if="currentStep > 1 && !loading" tier="secondary" @click="prevStep()">
          <v-icon size="small" start>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </GButton>
        <span v-else />

        <GButton v-if="currentStep < 3" tier="primary" :disabled="!isStepValid" @click="nextStep()">
          {{ $t('common.continue') }}
          <v-icon size="small" end>mdi-arrow-right</v-icon>
        </GButton>
        <GButton v-else tier="primary" :disabled="!isStepValid" :loading="loading" @click="confirmSend()">
          <v-icon size="small" start>mdi-send</v-icon>
          {{ $t('send.send') }}
        </GButton>
      </div>

    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import assts from '@/utils/assets';
import networks from '@/utils/networks';
import filters from '@/shared/utils/filters';
import { formatBtc, formatSats } from '@/shared/utils/format';
import { calculateTxSize } from '@/chains/bitcoin/bitcoinCoinSelection';
import { FeePriority } from '@/chains/bitcoin/bitcoinFeeEstimator';
import type { IUnifiedUtxo } from '@/chains/common/interfaces';

const { t } = useTranslation();
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();
const { loggedWallet, utxos } = toRefs(walletStore);

// Props
const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'success', txId: string): void;
}>();

const ticker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network)
);

const STATUS_ICONS = {
  success: 'mdi-check-circle-outline',
  error: 'mdi-alert-circle-outline',
  info: 'mdi-information-outline',
} as const;

// Step state
const currentStep = ref(1);
const stepLabels = computed(() => [t('send.recipient'), t('send.fee'), t('send.confirm')]);

// Form data
const recipientAddress = ref('');
const amountBtc = ref('');
const password = ref('');
const showPassword = ref(false);

// Fee selection
const selectedFeePriority = ref<'fast' | 'medium' | 'slow'>('medium');
const feeEstimates = ref({ fast: 50, medium: 25, slow: 10 });

const feeTiers = computed(() => [
  { key: 'fast' as const,   label: t('send.fast'),   time: t('bitcoin.etaMinutes', { minutes: 10 }), dots: 3 },
  { key: 'medium' as const, label: t('send.medium'), time: t('bitcoin.etaMinutes', { minutes: 30 }), dots: 2 },
  { key: 'slow' as const,   label: t('send.slow'),   time: t('bitcoin.etaMinutes', { minutes: 60 }), dots: 1 },
]);

// Transaction state
const loading = ref(false);
const txStatus = ref<{ type: 'success' | 'error' | 'info'; message: string }>({ type: 'info', message: '' });

// Validation errors
const addressError = ref('');
const amountError = ref('');

// BTC/USD price
const btcPrice = computed(() => priceStore.btcUsd?.lastPrice ?? 0);

// Fiat at the live BTC price, in the wallet's chosen currency ('' without a price)
function fiatOf(sats: number): string {
  if (!btcPrice.value || !sats) return '';
  // Sats × USD price is the value in 1e-8 USD, hence the 8 decimals.
  return filters.toCurrency(convertFiat(sats * btcPrice.value), false, 0, getCurrencySymbol(), '', false, 8);
}

// "123,456 sats · ≈ $12.34"
function amountLine(sats: number): string {
  const fiat = fiatOf(sats);
  const satsText = t('bitcoin.satsValue', { value: formatSats(sats) });
  return fiat ? `${satsText} · ≈ ${fiat}` : satsText;
}

// Available balance (from UTXOs)
const availableBalance = computed(() => {
  return bitcoinUtxos.value.reduce((sum, utxo) => sum + BigInt(utxo.value), BigInt(0));
});
const bitcoinUtxos = computed(() => utxos.value.filter((utxo): utxo is IUnifiedUtxo => !Array.isArray(utxo)));

// Amount in satoshis
const amountInSats = computed(() => {
  const amount = parseFloat(amountBtc.value);
  if (isNaN(amount) || amount <= 0) return 0;
  return Math.round(amount * 100000000);
});

// Estimate how many inputs coin selection would pick for the current amount
function estimateInputCount(): number {
  if (!utxos.value || utxos.value.length === 0) return 1;
  const target = BigInt(amountInSats.value || 0);
  if (target <= BigInt(0)) return 1;
  // Simulate largest-first selection (default strategy)
  const sorted = [...bitcoinUtxos.value].sort((a, b) => {
    const av = BigInt(a.value), bv = BigInt(b.value);
    return bv > av ? 1 : bv < av ? -1 : 0;
  });
  let total = BigInt(0);
  let count = 0;
  for (const utxo of sorted) {
    total += BigInt(utxo.value);
    count++;
    if (total >= target) return count;
  }
  return sorted.length; // All UTXOs needed (insufficient funds case)
}

// Fee for a specific tier
function estimatedFeeSatsFor(tier: 'fast' | 'medium' | 'slow'): number {
  const inputCount = estimateInputCount();
  return calculateTxSize(inputCount, 2) * feeEstimates.value[tier];
}

// Estimated fee for selected tier
const estimatedFeeSats = computed(() => estimatedFeeSatsFor(selectedFeePriority.value));

// Total amount
const totalAmount = computed(() => BigInt(amountInSats.value) + BigInt(estimatedFeeSats.value));

// Hardware wallet
const isHardwareWallet = computed(() => {
  const type = loggedWallet.value?.type;
  return type === 'Ledger' || type === 'Trezor' || type === 'Keystone';
});

// PRF wallet
const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);

// PassKey private key bytes (set after authentication)
const privateKeyBytes = ref<Uint8Array | null>(null);

// Step validation
const isStepValid = computed(() => {
  switch (currentStep.value) {
    case 1: return !!recipientAddress.value && !!amountBtc.value && !addressError.value && !amountError.value;
    case 2: return totalAmount.value <= availableBalance.value;
    case 3:
      if (isHardwareWallet.value) return true;
      if (isPrfWallet.value) return !!privateKeyBytes.value;
      return !!password.value;
    default: return false;
  }
});

function validateAddress() {
  addressError.value = '';
  if (!recipientAddress.value) return;
  import('@/chains/bitcoin/bitcoinKeyManager').then(({ validateBitcoinAddress }) => {
    const isValid = validateBitcoinAddress(recipientAddress.value, loggedWallet.value?.network || 'Mainnet');
    if (!isValid) addressError.value = t('send.invalidAddress');
  });
}

function validateAmount() {
  amountError.value = '';
  const amount = parseFloat(amountBtc.value);
  if (isNaN(amount) || amount <= 0) { amountError.value = t('send.invalidAmount'); return; }
  if (totalAmount.value > availableBalance.value) amountError.value = t('send.insufficientBalance');
}

async function pasteAddress() {
  try {
    const text = await navigator.clipboard.readText();
    recipientAddress.value = text.trim();
    validateAddress();
  } catch {
    // Clipboard read refused or unavailable: the field stays as it was
  }
}

function setMaxAmount() {
  const maxAmount = Number(availableBalance.value - BigInt(estimatedFeeSats.value));
  if (maxAmount > 0) {
    amountBtc.value = (maxAmount / 100000000).toFixed(8);
    validateAmount();
  }
}

async function updateFeeEstimate() {
  try {
    const { getBitcoinFeeEstimator } = await import('@/chains/bitcoin/bitcoinFeeEstimator');
    const estimator = getBitcoinFeeEstimator();
    const [fast, medium, slow] = await Promise.all([
      estimator.getFeeEstimate(FeePriority.FAST),
      estimator.getFeeEstimate(FeePriority.MEDIUM),
      estimator.getFeeEstimate(FeePriority.SLOW),
    ]);
    feeEstimates.value = { fast: fast.feeRate, medium: medium.feeRate, slow: slow.feeRate };
  } catch (e) {
    console.error('Failed to fetch fee estimates:', e);
  }
}

function nextStep() {
  if (!isStepValid.value) return;
  if (currentStep.value === 1) updateFeeEstimate();
  currentStep.value++;
}

function prevStep() {
  if (currentStep.value > 1) currentStep.value--;
}

async function authenticateWithPassKey() {
  if (!loggedWallet.value?.webAuthnCredentialId) {
    txStatus.value = { type: 'error', message: t('security.passKeyNotConfigured') };
    return;
  }
  loading.value = true;
  try {
    const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
    const prfOutput = await evaluateWalletPrf(loggedWallet.value);
    privateKeyBytes.value = new Uint8Array(prfOutput);
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message;
    txStatus.value = { type: 'error', message: message || t('security.passKeyAuthFailed') };
  } finally {
    loading.value = false;
  }
}

async function confirmSend() {
  if (!isStepValid.value || loading.value) return;
  loading.value = true;
  txStatus.value = { type: 'info', message: t('send.buildingTransaction') };
  try {
    const signingData: Record<string, unknown> = {
      recipientAddress: recipientAddress.value,
      amount: amountInSats.value,
      feeRate: feeEstimates.value[selectedFeePriority.value],
    };

    if (isPrfWallet.value && privateKeyBytes.value) {
      signingData['privateKeyBytes'] = Array.from(privateKeyBytes.value);
    } else {
      signingData['password'] = password.value;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sendToBackgroundFromOptions resolves an untyped messaging envelope
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SEND_BITCOIN,
      data: signingData,
    });
    if (!response.data.success) throw new Error(response.data.error || t('send.transactionFailed'));
    txStatus.value = { type: 'success', message: t('send.transactionSent', { txId: response.data.txId }) };
    emit('success', response.data.txId);
    setTimeout(() => closeDialog(), 2000);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    txStatus.value = { type: 'error', message: t('send.transactionError', { error: msg }) };
  } finally {
    loading.value = false;
  }
}

function closeDialog() {
  emit('update:modelValue', false);
  currentStep.value = 1;
  recipientAddress.value = '';
  amountBtc.value = '';
  password.value = '';
  showPassword.value = false;
  privateKeyBytes.value = null;
  selectedFeePriority.value = 'medium';
  txStatus.value = { type: 'info', message: '' };
  addressError.value = '';
  amountError.value = '';
}

watch(() => props.modelValue, (val) => { if (val) updateFeeEstimate(); });
</script>

<style scoped lang="scss">
.btc-send {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

/* ── Step progress ──────────────────────────────────────── */
.btc-send__steps {
  display: flex;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.btc-send__step {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--g-text-3);
}

.btc-send__step-bar {
  height: 3px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
  transition: background-color var(--g-dur-base) var(--g-ease);
}

.btc-send__step-label {
  font-size: 12px;
  font-weight: 500;
  transition: color var(--g-dur-base) var(--g-ease);
}

.btc-send__step--active .btc-send__step-bar,
.btc-send__step--done .btc-send__step-bar {
  background: var(--g-accent);
}

.btc-send__step--done .btc-send__step-bar {
  opacity: 0.45;
}

.btc-send__step--active .btc-send__step-label {
  color: var(--g-accent);
}

.btc-send__step--done .btc-send__step-label {
  color: var(--g-text-2);
}

.btc-send__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-height: 200px;
}

.btc-step-enter-active,
.btc-step-leave-active {
  transition: opacity var(--g-dur-fast) var(--g-ease);
}

.btc-step-enter-from,
.btc-step-leave-to {
  opacity: 0;
}

/* ── Fields ─────────────────────────────────────────────── */
.btc-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.btc-field__error {
  color: var(--g-error);
  font-size: 12px;
}

/* Inputs are controls, not surfaces: solid raised fill. The focus ring lives on the
   wrapper, so the bare input inside needs none of its own. */
.btc-input {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-height: var(--g-btn-h);
  padding: 0 var(--g-s-1) 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.btc-input:focus-within {
  border-color: var(--g-accent);
}

.btc-input--valid {
  border-color: var(--g-success-line);
}

.btc-input--error,
.btc-input--error:focus-within {
  border-color: var(--g-error);
}

.btc-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font-size: 13px;
  outline: none;
}

.btc-input__control::placeholder {
  color: var(--g-text-3);
}

.btc-input__control--amount {
  font-size: 16px;
  font-weight: 600;
}

/* A number field without the browser's spin buttons */
.btc-input__control--amount::-webkit-outer-spin-button,
.btc-input__control--amount::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.btc-input__control--amount[type='number'] {
  -moz-appearance: textfield;
}

.btc-input__unit {
  color: var(--g-text-3);
  font-size: 12px;
}

.btc-send__balance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.btc-send__balance-value {
  color: var(--g-text-1);
}

/* ── Fee tiers ──────────────────────────────────────────── */
.btc-fees {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.btc-fee {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  min-width: 0;
  padding: var(--g-s-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.btc-fee:hover {
  @include g-glass-tier-hover;
}

.btc-fee--selected,
.btc-fee--selected:hover {
  @include g-glass-tier-active;
}

.btc-fee__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: var(--g-s-1);
}

.btc-fee__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.btc-fee__dots {
  display: inline-flex;
  gap: 3px;
}

.btc-fee__dot {
  width: 5px;
  height: 5px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
}

.btc-fee__dot--lit {
  background: var(--g-accent);
}

.btc-fee__rate {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

/* ── Summary ────────────────────────────────────────────── */
.btc-summary {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.btc-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.btc-summary__row dt {
  color: var(--g-text-3);
}

.btc-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.btc-summary__row--total dd {
  font-weight: 600;
}

.btc-summary__sub {
  display: block;
  color: var(--g-text-3);
  font-size: 12px;
}

/* ── Review ─────────────────────────────────────────────── */
.btc-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
}

.btc-review__amount {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.btc-review__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.btc-review__to {
  margin-top: var(--g-s-3);
}

.btc-review__address {
  color: var(--g-text-1);
  font-size: 12px;
  word-break: break-all;
}

.btc-review__meta {
  margin-top: var(--g-s-3);
}

/* ── Auth and notices ───────────────────────────────────── */
.btc-auth {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.btc-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
  font-size: 13px;
}

.btc-notice .v-icon {
  color: inherit;
}

.btc-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.btc-notice--success {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.btc-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

/* ── Navigation ─────────────────────────────────────────── */
.btc-send__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
