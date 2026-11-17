<template>
  <div class="sol-send">
    <!-- Sent: the signature and where to follow it -->
    <div v-if="sentSignature" class="sol-send__body" data-test="sol-sent">
      <div class="sol-notice sol-notice--success" role="status">
        <v-icon size="small">mdi-check-circle-outline</v-icon>
        <span class="sol-notice__text">{{ $t('solana.sent') }}</span>
      </div>
      <a v-if="sentUrl" :href="sentUrl" target="_blank" rel="noopener noreferrer" class="sol-link">
        {{ $t('solana.viewOnExplorer') }}
        <v-icon size="x-small">mdi-open-in-new</v-icon>
      </a>
      <div class="sol-send__nav">
        <span />
        <GButton tier="primary" @click="emit('close')">{{ $t('common.close') }}</GButton>
      </div>
    </div>

    <template v-else>
      <ol class="sol-send__steps">
        <li
          v-for="(label, i) in stepLabels"
          :key="label"
          :class="['sol-send__step', { 'sol-send__step--active': step === i + 1, 'sol-send__step--done': step > i + 1 }]"
          :aria-current="step === i + 1 ? 'step' : undefined"
        >
          <span class="sol-send__step-bar" />
          <span class="sol-send__step-label">{{ label }}</span>
        </li>
      </ol>

      <!-- Step 1: recipient, amount, fee -->
      <div v-if="step === 1" class="sol-send__body">
        <label class="sol-field">
          <span class="t-label">{{ $t('send.recipientAddress') }}</span>
          <span :class="['sol-input', { 'sol-input--error': !!addressError, 'sol-input--valid': recipient && !addressError }]">
            <input
              v-model.trim="recipient"
              class="sol-input__control g-mono"
              :placeholder="t('solana.addressPlaceholder')"
              autocomplete="off"
              spellcheck="false"
              data-test="sol-recipient"
            />
            <v-btn icon variant="text" size="small" :aria-label="t('common.paste')" :title="t('common.paste')" @click="pasteAddress()">
              <v-icon size="small">mdi-content-paste</v-icon>
            </v-btn>
          </span>
          <span v-if="addressError" class="sol-field__error">{{ addressError }}</span>
        </label>

        <label class="sol-field">
          <span class="t-label">{{ $t('send.amount') }}</span>
          <span :class="['sol-input', { 'sol-input--error': !!amountError }]">
            <span class="sol-input__unit g-mono">{{ ticker }}</span>
            <input
              v-model.trim="amountText"
              class="sol-input__control sol-input__control--amount g-num"
              inputmode="decimal"
              placeholder="0.0"
              autocomplete="off"
              data-test="sol-amount"
            />
            <GButton tier="tertiary" compact :disabled="balance === null" @click="setMax()">{{ $t('common.max') }}</GButton>
          </span>
          <span v-if="amountError" class="sol-field__error" data-test="sol-amount-error">{{ amountError }}</span>
        </label>

        <div class="sol-send__balance t-caption">
          <span>{{ $t('send.availableBalance') }}</span>
          <span class="g-num sol-send__balance-value">{{ balance === null ? '—' : formatSol(balance) }} {{ ticker }}</span>
        </div>

        <div class="sol-fees" role="radiogroup" :aria-label="t('send.fee')">
          <button
            v-for="level in FEE_LEVELS"
            :key="level"
            type="button"
            role="radio"
            :aria-checked="feeLevel === level ? 'true' : 'false'"
            :class="['glass-tier', 'sol-fee', { 'sol-fee--selected': feeLevel === level }]"
            @click="feeLevel = level"
          >
            <span class="sol-fee__name">{{ level === 'fast' ? $t('send.fast') : $t('solana.feeStandard') }}</span>
            <span class="t-caption g-num">{{ quote ? `${formatSol(quote.fees[level])} ${ticker}` : '…' }}</span>
          </button>
        </div>
        <span v-if="quote && !quote.live" class="t-caption">{{ $t('solana.feesUnavailable') }}</span>
        <span v-else class="t-caption">{{ $t('solana.feeHint') }}</span>
      </div>

      <!-- Step 2: review and sign -->
      <div v-else class="sol-send__body">
        <div class="glass-tier sol-review">
          <span class="t-label">{{ $t('perpetuals.deposit.youSend') }}</span>
          <span class="sol-review__amount">
            <span class="t-display g-num">{{ formatSol(lamports) }}</span>
            <span class="sol-review__unit g-mono">{{ ticker }}</span>
          </span>
          <span class="t-label sol-review__to">{{ $t('send.to') }}</span>
          <!-- The whole address, so it can be checked character by character before signing -->
          <span class="g-mono sol-review__address">{{ recipient }}</span>
          <dl class="sol-summary">
            <div class="sol-summary__row">
              <dt>{{ $t('send.fee') }}</dt>
              <dd class="g-num">{{ formatSol(fee) }} {{ ticker }}</dd>
            </div>
            <div class="sol-summary__row sol-summary__row--total">
              <dt>{{ $t('send.total') }}</dt>
              <dd class="g-num">{{ formatSol(lamports + fee) }} {{ ticker }}</dd>
            </div>
          </dl>
        </div>

        <template v-if="isPrfWallet">
          <div v-if="!prfBytes" class="sol-auth">
            <span class="t-caption">{{ $t('security.passKeyAuthRequired') }}</span>
            <GButton tier="secondary" block @click="authenticateWithPassKey()">
              <v-icon size="small" start>mdi-fingerprint</v-icon>
              {{ $t('security.authenticateWithPassKey') }}
            </GButton>
          </div>
          <div v-else class="sol-notice sol-notice--success">
            <v-icon size="small">mdi-check-circle-outline</v-icon>
            <span class="sol-notice__text">{{ $t('security.passKeyAuthenticated') }}</span>
          </div>
        </template>
        <label v-else class="sol-field">
          <span class="t-label">{{ $t('send.spendingPassword') }}</span>
          <span class="sol-input">
            <input
              v-model="password"
              class="sol-input__control"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              data-test="sol-password"
              @keyup.enter="confirmSend()"
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

        <div v-if="sendError" class="sol-notice sol-notice--error" role="alert" data-test="sol-send-error">
          <v-icon size="small">mdi-alert-circle-outline</v-icon>
          <span class="sol-notice__text">{{ sendError }}</span>
        </div>
      </div>

      <div class="sol-send__nav">
        <GButton v-if="step > 1 && !loading" tier="secondary" @click="step = 1">
          <v-icon size="small" start>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </GButton>
        <span v-else />
        <GButton v-if="step === 1" tier="primary" :disabled="!canContinue" data-test="sol-continue" @click="step = 2">
          {{ $t('common.continue') }}
          <v-icon size="small" end>mdi-arrow-right</v-icon>
        </GButton>
        <GButton v-else tier="primary" :disabled="!canSign" :loading="loading" data-test="sol-send" @click="confirmSend()">
          <v-icon size="small" start>mdi-send</v-icon>
          {{ $t('send.send') }}
        </GButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Gero's own SOL send, shared by the dashboard dialog and the side panel sheet. The
// worker (chrome/solanaSend.ts) re-checks everything shown here, reads the balance and
// fee price itself, signs and submits.
import { computed, onBeforeUnmount, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GButton from '@/shared/components/GButton/GButton.vue';
import networks from '@/utils/networks';
import { formatSol, parseRawAmount, parseSol } from '@/chains/solana/solanaAmount';
import { isValidSolanaAddress } from '@/chains/solana/solanaKeyManager';
import {
  checkSolTransfer,
  maxSendableLamports,
  solanaSendErrorKey,
  SOLANA_RENT_EXEMPT_MINIMUM,
  type SolanaFeeLevel,
} from '@/chains/solana/solanaSendRules';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import type { SolanaSendQuote } from '@/chrome/solanaSend';
import { debugLog } from '@/utils/debug';

/** `open` loads a fee quote; closing it clears everything typed, the PassKey answer included. */
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** While a PassKey ceremony or the send itself is in flight: the host holds its close. */
  (e: 'busy', value: boolean): void;
}>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const FEE_LEVELS: SolanaFeeLevel[] = ['standard', 'fast'];
// A valid address that is never the wallet's own, for checking the amount alone.
const SYSTEM_PLACEHOLDER = '11111111111111111111111111111111';

const step = ref(1);
const recipient = ref('');
const amountText = ref('');
const feeLevel = ref<SolanaFeeLevel>('standard');
const quote = ref<SolanaSendQuote | null>(null);
const password = ref('');
const showPassword = ref(false);
const prfBytes = ref<Uint8Array | null>(null);
const loading = ref(false);
const sendError = ref('');
const sentSignature = ref('');

const stepLabels = computed(() => [t('send.recipient'), t('send.confirm')]);
const ticker = computed(() => networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));
const ownAddress = computed(() => loggedWallet.value?.publicKey ?? '');

/** Lamports per Gero Sync; null until it has reported (never read as 0). */
const balance = computed<bigint | null>(() => {
  const lamports = walletStore.solana?.lamports;
  return lamports == null ? null : parseRawAmount(lamports);
});

const priority = computed(() => BigInt(quote.value?.prices[feeLevel.value] ?? '0'));
const fee = computed(() => (quote.value ? BigInt(quote.value.fees[feeLevel.value]) : 0n));

const lamports = computed<bigint>(() => {
  if (!amountText.value) return 0n;
  try {
    // A decimal comma (German, Spanish keyboards) reads as the point.
    return parseSol(amountText.value.replace(',', '.'));
  } catch {
    return -1n;
  }
});

function errorText(code: string): string {
  return t(solanaSendErrorKey(code), { amount: formatSol(SOLANA_RENT_EXEMPT_MINIMUM), ticker: ticker.value });
}

const addressError = computed(() => {
  if (!recipient.value) return '';
  if (!isValidSolanaAddress(recipient.value)) return errorText('INVALID_ADDRESS');
  if (recipient.value === ownAddress.value) return errorText('SAME_ADDRESS');
  return '';
});

const amountError = computed(() => {
  if (!amountText.value) return '';
  if (lamports.value <= 0n) return errorText('INVALID_AMOUNT');
  const refusal = checkSolTransfer({
    from: ownAddress.value,
    // Only the amount's rules here: the address has its own line.
    to: isValidSolanaAddress(recipient.value) && recipient.value !== ownAddress.value ? recipient.value : SYSTEM_PLACEHOLDER,
    lamports: lamports.value,
    balance: balance.value,
    priorityMicroLamports: priority.value,
  });
  return refusal && refusal !== 'INVALID_ADDRESS' && refusal !== 'SAME_ADDRESS' ? errorText(refusal) : '';
});

const canContinue = computed(() =>
  !!recipient.value && !addressError.value && lamports.value > 0n && !amountError.value && !!quote.value,
);
const canSign = computed(() => !loading.value && (isPrfWallet.value ? !!prfBytes.value : !!password.value));

const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf'
  || (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId),
);

const sentUrl = computed(() => solscanUrl('tx', sentSignature.value, loggedWallet.value?.network ?? ''));

function setMax(): void {
  const max = maxSendableLamports(balance.value, priority.value);
  amountText.value = max > 0n ? formatSol(max) : '';
}

async function pasteAddress(): Promise<void> {
  try {
    recipient.value = (await navigator.clipboard.readText()).trim();
  } catch {
    // Clipboard read refused or unavailable: the field stays as it was
  }
}

async function loadQuote(): Promise<void> {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SOLANA_SEND_QUOTE, data: {} }) as
      { data?: { success?: boolean; result?: SolanaSendQuote } };
    if (response.data?.success && response.data.result) quote.value = response.data.result;
  } catch (error) {
    debugLog('Solana send: quote failed', error);
  }
}

async function authenticateWithPassKey(): Promise<void> {
  if (!loggedWallet.value?.webAuthnCredentialId) {
    sendError.value = t('security.passKeyNotConfigured');
    return;
  }
  loading.value = true;
  try {
    const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
    prfBytes.value = new Uint8Array(await evaluateWalletPrf(loggedWallet.value));
    sendError.value = '';
  } catch {
    sendError.value = t('security.passKeyAuthFailed');
  } finally {
    loading.value = false;
  }
}

async function confirmSend(): Promise<void> {
  if (!canSign.value) return;
  loading.value = true;
  sendError.value = '';
  try {
    const data: Record<string, unknown> = {
      recipientAddress: recipient.value,
      lamports: lamports.value.toString(),
      feeLevel: feeLevel.value,
    };
    if (isPrfWallet.value && prfBytes.value) data['privateKeyBytes'] = Array.from(prfBytes.value);
    else data['password'] = password.value;
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SEND_SOLANA, data }) as
      { data?: { success?: boolean; error?: string; result?: { signature: string } } };
    if (response.data?.success && response.data.result) {
      sentSignature.value = response.data.result.signature;
    } else {
      sendError.value = errorText(response.data?.error ?? '');
      // A PassKey answer is single-use in spirit: ask again after a failure.
      prfBytes.value = null;
    }
  } catch (error) {
    debugLog('Solana send failed', error);
    sendError.value = errorText('');
  } finally {
    password.value = '';
    loading.value = false;
  }
}

function reset(): void {
  step.value = 1;
  recipient.value = '';
  amountText.value = '';
  feeLevel.value = 'standard';
  password.value = '';
  showPassword.value = false;
  prfBytes.value?.fill(0);
  prfBytes.value = null;
  sendError.value = '';
  sentSignature.value = '';
  quote.value = null;
}

// Immediate: a host's open state can outlive this form, so it can mount already open
watch(() => props.open, (open) => { if (open) void loadQuote(); else reset(); }, { immediate: true });
watch(loading, (busy) => emit('busy', busy));
onBeforeUnmount(reset);
</script>

<style scoped lang="scss">
.sol-send,
.sol-send__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.sol-send__steps {
  display: flex;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-send__step {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--g-text-3);
}

.sol-send__step-bar {
  height: 3px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
}

.sol-send__step-label {
  font-size: 12px;
  font-weight: 500;
}

.sol-send__step--active .sol-send__step-bar,
.sol-send__step--done .sol-send__step-bar {
  background: var(--g-accent);
}

.sol-send__step--active .sol-send__step-label {
  color: var(--g-accent);
}

.sol-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sol-field__error {
  color: var(--g-error);
  font-size: 12px;
}

/* Inputs are controls, not surfaces: solid raised fill. The bare input inside keeps the
   baseline focus ring; the wrapper's accent border marks which field is active. */
.sol-input {
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

.sol-input:focus-within {
  border-color: var(--g-accent);
}

.sol-input--valid {
  border-color: var(--g-success-line);
}

.sol-input--error,
.sol-input--error:focus-within {
  border-color: var(--g-error);
}

.sol-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font-size: 13px;
}

.sol-input__control::placeholder {
  color: var(--g-text-3);
}

.sol-input__control--amount {
  font-size: 16px;
  font-weight: 600;
}

.sol-input__unit {
  color: var(--g-text-3);
  font-size: 12px;
}

.sol-send__balance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.sol-send__balance-value {
  color: var(--g-text-1);
}

.sol-fees {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.sol-fee {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--g-s-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.sol-fee:hover {
  @include g-glass-tier-hover;
}

.sol-fee--selected,
.sol-fee--selected:hover {
  @include g-glass-tier-active;
}

.sol-fee__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.sol-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
}

.sol-review__amount {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.sol-review__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.sol-review__to {
  margin-top: var(--g-s-3);
}

.sol-review__address {
  color: var(--g-text-1);
  font-size: 12px;
  word-break: break-all;
}

.sol-summary {
  display: flex;
  flex-direction: column;
  margin: var(--g-s-3) 0 0;
}

.sol-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.sol-summary__row dt {
  color: var(--g-text-3);
}

.sol-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.sol-summary__row--total dd {
  font-weight: 600;
}

.sol-auth {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.sol-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
  font-size: 13px;
}

.sol-notice .v-icon {
  color: inherit;
}

.sol-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.sol-notice--success {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.sol-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

.sol-link {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-accent);
  font-size: 13px;
}

.sol-send__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
