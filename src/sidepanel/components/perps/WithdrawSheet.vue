<template>
  <v-dialog
    :value="value"
    max-width="480"
    scrollable
    @input="$emit('input', $event)"
  >
    <v-card class="perps-action-dialog">
      <v-card-title class="dialog-title">
        <span class="text-subtitle-1 font-weight-bold">{{ $t('perpetuals.withdraw') }}</span>
        <v-spacer />
        <v-btn icon small @click="closeSheet()">
          <v-icon small>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="dialog-body">
        <div class="withdraw-content">

      <!-- ── Connect gate: must connect to Strike before withdrawing ──── -->
      <template v-if="!isConnected">
        <div class="connect-gate-sub">{{ $t('perps.connect.gateWithdraw') }}</div>
        <StrikeOnboarding />
      </template>

      <template v-else>
      <!-- ── Step indicator ─────────────────────────────────────── -->
      <div class="step-rail">
        <div class="step-dot" :class="{ active: stepNum >= 1, done: stepNum > 1 }">1</div>
        <div class="step-line" :class="{ filled: stepNum > 1 }" />
        <div class="step-dot" :class="{ active: stepNum >= 2, done: stepNum > 2 }">2</div>
        <div class="step-line" :class="{ filled: stepNum > 2 }" />
        <div class="step-dot" :class="{ active: stepNum >= 3 }">3</div>
      </div>

      <!-- ──────────────────────────────────────────────────────────
           STEP 1: Amount
      ────────────────────────────────────────────────────────── -->
      <div v-if="stepNum === 1" class="step-pane">
        <div class="step-title">{{ $t('perps.withdraw.step1Title') }}</div>
        <div class="step-sub">{{ $t('perps.withdraw.step1Sub') }}</div>

        <!-- Amount field (custom — no native number spinners) -->
        <div class="amount-field" :class="{ 'amount-field--focus': amountFocused }">
          <input
            ref="amountInput"
            :value="amount"
            inputmode="decimal"
            type="text"
            spellcheck="false"
            autocomplete="off"
            placeholder="0"
            class="amount-field__input"
            @input="onAmountInput"
            @focus="amountFocused = true"
            @blur="amountFocused = false"
            @keydown.enter="canQuote && requestQuoteClick()"
          />
          <span class="amount-field__ccy">USD</span>
          <button type="button" class="amount-field__max" @click="setMax()">MAX</button>
        </div>

        <!-- Withdrawable balance (click to fill max) -->
        <button type="button" class="balance-row" @click="setMax()">
          <span class="balance-row__label">{{ $t('perpetuals.withdrawableBalance') }}</span>
          <span class="balance-row__value">${{ formatUsd(maxWithdrawable) }}</span>
        </button>

        <!-- ADA estimate -->
        <transition name="fade-slide">
          <div v-if="amountNum > 0" class="estimate-card mt-3">
            <div class="estimate-main">
              <span class="estimate-main__label">{{ $t('perpetuals.estimatedReceived') }}</span>
              <span class="estimate-main__value">
                ~{{ formatAda(estimatedAda) }}<span class="estimate-main__unit">ADA</span>
              </span>
            </div>
            <div class="estimate-sub">
              <span>{{ $t('perpetuals.currentAdaPrice') }}</span>
              <span class="estimate-sub__value">${{ formatPrice(usdPerAda) }}</span>
            </div>
          </div>
        </transition>

        <!-- Margin safety -->
        <transition name="fade-slide">
          <div v-if="showMarginWarning" class="warn-banner mt-3">
            <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ $t('perpetuals.marginSafetyWarning') }}</span>
          </div>
        </transition>

        <transition name="fade-slide">
          <div v-if="quoteError" class="error-banner mt-3">
            <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ quoteError }}</span>
          </div>
        </transition>

        <v-btn
          block
          depressed
          :loading="withdrawStatus === 'quoting'"
          :disabled="!canQuote"
          class="action-btn mt-4"
          @click="requestQuoteClick()"
        >
          <template v-if="withdrawStatus === 'quoting'">
            <v-icon size="14" class="mr-2">mdi-loading mdi-spin</v-icon>
            {{ $t('perps.withdraw.quoting') }}
          </template>
          <template v-else>
            {{ $t('perps.withdraw.continue') }}
          </template>
        </v-btn>
      </div>

      <!-- ──────────────────────────────────────────────────────────
           STEP 2: Review & sign
      ────────────────────────────────────────────────────────── -->
      <div v-else-if="stepNum === 2" class="step-pane">
        <div class="step-title">{{ $t('perps.withdraw.step2Title') }}</div>
        <div class="step-sub">{{ $t('perps.withdraw.step2Sub') }}</div>

        <div class="review-card mt-3">
          <div class="review-row">
            <span class="review-label">{{ $t('perpetuals.amount') }}</span>
            <span class="review-value">${{ formatUsd(amountNum) }}</span>
          </div>
          <div v-if="quote?.fee" class="review-row">
            <span class="review-label">{{ $t('perpetuals.fee') }}</span>
            <span class="review-value">${{ formatUsd(parseFloat(quote.fee)) }}</span>
          </div>
          <div class="review-row">
            <span class="review-label">{{ $t('perps.withdraw.youReceive') }}</span>
            <span class="review-value highlight">
              {{ youReceiveLabel }}
            </span>
          </div>
          <div v-if="quote?.expiresAtMs" class="review-row">
            <span class="review-label">{{ $t('perps.withdraw.quoteExpiresIn') }}</span>
            <span class="review-value" :class="expiryClass">{{ countdownLabel }}</span>
          </div>
        </div>

        <!-- Message preview -->
        <div class="message-card mt-3">
          <div class="message-head">
            <span class="message-label">{{ $t('perps.withdraw.messageToSign') }}</span>
            <button type="button" class="link-btn" @click="showFullMessage = !showFullMessage">
              {{ showFullMessage ? $t('perps.withdraw.collapse') : $t('perps.withdraw.viewFull') }}
            </button>
          </div>
          <pre class="message-body" :class="{ collapsed: !showFullMessage }">{{ quote?.message_to_sign ?? '' }}</pre>
        </div>

        <!-- Spending password (skipped for HW / PRF) -->
        <v-text-field
          v-if="needsPassword"
          v-model="password"
          :label="$t('perpetuals.spendingPassword')"
          outlined
          dense
          dark
          hide-details
          class="perp-input mt-3"
          :type="showPassword ? 'text' : 'password'"
          :append-icon="showPassword ? 'mdi-eye-off' : 'mdi-eye'"
          @click:append="showPassword = !showPassword"
          @keydown.enter="confirmAndSign()"
        />

        <transition name="fade-slide">
          <div v-if="withdrawError" class="error-banner mt-3">
            <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ withdrawError }}</span>
          </div>
        </transition>

        <div class="btn-row mt-4">
          <v-btn
            depressed
            class="ghost-btn"
            :disabled="withdrawStatus === 'signing' || withdrawStatus === 'submitting'"
            @click="goBackToAmount()"
          >
            {{ $t('perps.withdraw.back') }}
          </v-btn>

          <v-btn
            v-if="quoteExpired"
            depressed
            class="action-btn"
            :loading="withdrawStatus === 'quoting'"
            @click="requestQuoteClick()"
          >
            {{ $t('perps.withdraw.requote') }}
          </v-btn>
          <!-- PRF wallets: tap PassKey to authenticate, then sign + submit -->
          <PassKeyAuthButton
            v-else-if="isPrfWallet"
            class="action-btn"
            :disabled="!canSign || withdrawStatus === 'signing' || withdrawStatus === 'submitting'"
            :text="$t('perps.withdraw.confirmSign')"
            @success="handlePassKeyConfirm"
            @error="onPassKeyError"
          />
          <v-btn
            v-else
            depressed
            :loading="withdrawStatus === 'signing' || withdrawStatus === 'submitting'"
            :disabled="!canSign"
            class="action-btn"
            @click="confirmAndSign()"
          >
            <v-icon size="14" class="mr-2">mdi-shield-check-outline</v-icon>
            {{ $t('perps.withdraw.confirmSign') }}
          </v-btn>
        </div>
      </div>

      <!-- ──────────────────────────────────────────────────────────
           STEP 3: Status
      ────────────────────────────────────────────────────────── -->
      <div v-else-if="stepNum === 3" class="step-pane status-pane">
        <div class="status-icon-wrap">
          <v-progress-circular
            v-if="withdrawStatus === 'pending' || withdrawStatus === 'submitting'"
            indeterminate
            size="56"
            width="3"
            color="#00c7f3"
          />
          <v-icon v-else-if="withdrawStatus === 'settled'" size="56" color="#26FAB0">
            mdi-check-circle-outline
          </v-icon>
          <v-icon v-else-if="withdrawStatus === 'error'" size="56" color="#F97066">
            mdi-alert-circle-outline
          </v-icon>
        </div>

        <div class="status-title">{{ statusTitle }}</div>
        <div class="status-sub">{{ statusSub }}</div>

        <transition name="fade-slide">
          <div v-if="withdrawError && withdrawStatus === 'error'" class="error-banner mt-3" style="text-align:left;">
            <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ withdrawError }}</span>
          </div>
        </transition>

        <div class="btn-row mt-5" style="width:100%;">
          <v-btn
            v-if="withdrawStatus === 'settled'"
            depressed
            block
            class="action-btn"
            @click="closeAndEmit()"
          >
            {{ $t('perps.withdraw.done') }}
          </v-btn>
          <template v-else-if="withdrawStatus === 'error'">
            <v-btn depressed class="ghost-btn" @click="closeSheet()">
              {{ $t('perps.withdraw.close') }}
            </v-btn>
            <v-btn depressed class="action-btn" @click="retry()">
              {{ $t('perps.withdraw.retry') }}
            </v-btn>
          </template>
        </div>
      </div>
      </template>

        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useStrikeWithdraw } from '@/modules/market/composables/useStrikeWithdraw';
import { useStrikeAccount } from '@/modules/market/composables/useStrikeAccount';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import { walletStore } from '@/stores/walletStore';
import i18n from '@/plugins/i18n';
import StrikeOnboarding from './StrikeOnboarding.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import snackbar from '@/plugins/snackbar';

// ── Props & Emits ───────────────────────────────────────────────────────────
const props = defineProps<{
  value: boolean;
}>();
const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'withdrawn'): void;
}>();

// ── Composables ─────────────────────────────────────────────────────────────
const {
  quote,
  withdrawStatus,
  withdrawError,
  usdPerAda,
  usdToAdaRate,
  requestQuote,
  signAndSubmit,
  resetWithdraw,
} = useStrikeWithdraw();

const { account, marginRatio, loadAccount } = useStrikeAccount();

// Gate the withdraw flow behind a Strike connection — opening this sheet while
// disconnected shows the inline connect/unlock UI instead of the step form.
const { isConnected } = useStrikeOnboarding();

// ── Local state ─────────────────────────────────────────────────────────────
const amount = ref('');
const amountFocused = ref(false);
const amountInput = ref<HTMLInputElement | null>(null);
const password = ref('');
const showPassword = ref(false);
const showFullMessage = ref(false);
const quoteError = ref<string | null>(null);
const now = ref(Date.now());
let tickHandle: number | null = null;

// ── Computed ────────────────────────────────────────────────────────────────
const stepNum = computed<1 | 2 | 3>(() => {
  switch (withdrawStatus.value) {
    case 'idle':
    case 'quoting':
    case 'error':
      // On error pre-quote (no quote object) stay on step 1 to retry; if a
      // quote already existed, error belongs to step 3.
      if (withdrawStatus.value === 'error' && quote.value) return 3;
      return 1;
    case 'quoted':
      return 2;
    case 'signing':
    case 'submitting':
    case 'pending':
    case 'settled':
      return 3;
    default:
      return 1;
  }
});

const amountNum = computed(() => {
  const n = parseFloat(amount.value);
  return Number.isFinite(n) && n > 0 ? n : 0;
});

const maxWithdrawable = computed(() => {
  const v = parseFloat(account.value?.available_balance ?? '0');
  return Number.isFinite(v) ? v : 0;
});

const estimatedAda = computed(() => amountNum.value * usdToAdaRate.value);

const showMarginWarning = computed(() => {
  if (!marginRatio.value || amountNum.value <= 0) return false;
  // marginRatio in useStrikeAccount is a percent; warn when over 70.
  return marginRatio.value >= 70;
});

const canQuote = computed(() =>
  amountNum.value > 0 &&
  amountNum.value <= maxWithdrawable.value + 1e-6 &&
  withdrawStatus.value !== 'quoting',
);

const isPrfWallet = computed(() => {
  const w = walletStore.loggedWallet;
  return w?.encryptionMethod === 'prf' ||
    (!!w?.prfEncryptedPrivateKey && !!w?.webAuthnCredentialId);
});
const isHwWallet = computed(() => {
  const t = walletStore.loggedWallet?.type;
  return t === 'Ledger' || t === 'Trezor' || t === 'Keystone';
});
const needsPassword = computed(() => !isPrfWallet.value && !isHwWallet.value);

const canSign = computed(() => {
  if (quoteExpired.value) return false;
  if (needsPassword.value && !password.value) return false;
  return withdrawStatus.value === 'quoted';
});

const quoteExpired = computed(() => {
  if (!quote.value?.expiresAtMs) return false;
  return now.value > quote.value.expiresAtMs;
});

const countdownLabel = computed(() => {
  if (!quote.value?.expiresAtMs) return '—';
  const ms = quote.value.expiresAtMs - now.value;
  if (ms <= 0) return i18n.t('perps.withdraw.expired') as string;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
});

const expiryClass = computed(() => {
  if (!quote.value?.expiresAtMs) return '';
  const ms = quote.value.expiresAtMs - now.value;
  if (ms <= 0) return 'expired';
  if (ms < 30_000) return 'warn';
  return '';
});

const youReceiveLabel = computed(() => {
  if (quote.value?.amount_received) {
    return `${formatAda(parseFloat(quote.value.amount_received))} ADA`;
  }
  return `~${formatAda(estimatedAda.value)} ADA`;
});

const statusTitle = computed(() => {
  switch (withdrawStatus.value) {
    case 'submitting':  return i18n.t('perps.withdraw.statusSubmitting') as string;
    case 'pending':     return i18n.t('perps.withdraw.statusPending') as string;
    case 'settled':     return i18n.t('perps.withdraw.statusSettled') as string;
    case 'error':       return i18n.t('perps.withdraw.statusError') as string;
    case 'signing':     return i18n.t('perps.withdraw.statusSigning') as string;
    default:            return '';
  }
});

const statusSub = computed(() => {
  switch (withdrawStatus.value) {
    case 'signing':     return i18n.t('perps.withdraw.statusSigningSub') as string;
    case 'submitting':  return i18n.t('perps.withdraw.statusSubmittingSub') as string;
    case 'pending':     return i18n.t('perps.withdraw.statusPendingSub') as string;
    case 'settled':     return i18n.t('perps.withdraw.statusSettledSub') as string;
    case 'error':       return '';
    default:            return '';
  }
});

// ── Formatters ──────────────────────────────────────────────────────────────
function formatUsd(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'));
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatAda(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'));
  if (!Number.isFinite(v)) return '0.00';
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatPrice(n: number | null | undefined): string {
  const v = typeof n === 'number' ? n : parseFloat(String(n ?? '0'));
  if (!Number.isFinite(v) || v <= 0) return '—';
  return v.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 5 });
}

// ── Methods ─────────────────────────────────────────────────────────────────
function setMax() {
  if (maxWithdrawable.value > 0) {
    amount.value = maxWithdrawable.value.toFixed(2);
  }
}

/**
 * Sanitise free-text amount input to a decimal string (digits + a single dot).
 * Replaces the native number input so there are no spinner up/down controls.
 */
function onAmountInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot !== -1) {
    // collapse any further dots after the first
    cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  }
  amount.value = cleaned;
}

async function requestQuoteClick() {
  quoteError.value = null;
  if (!canQuote.value) return;
  // No asset arg: Strike defaults to the chain-native asset (ADA). Passing
  // 'ADA' explicitly is rejected by the backend ("unsupported asset").
  await requestQuote(amountNum.value.toFixed(2));
  if (withdrawStatus.value === 'error') {
    // Capture error and reset to step 1 so user can fix the input.
    quoteError.value = withdrawError.value;
    resetWithdraw();
  }
}

async function confirmAndSign() {
  if (!canSign.value) return;
  const ok = await signAndSubmit(needsPassword.value ? password.value : '');
  password.value = '';
  if (ok) {
    emit('withdrawn');
  }
}

/**
 * PRF (passkey) wallets: PassKeyAuthButton decrypted the root key and handed
 * us the bytes. Pass them to signAndSubmit as privateKeyBytes (signs the CIP-8
 * withdrawal message via SIGN_DATA's privateKeyBytes path).
 */
async function handlePassKeyConfirm(pkBytes: Uint8Array) {
  if (!canSign.value) return;
  const ok = await signAndSubmit('', pkBytes);
  if (ok) {
    emit('withdrawn');
  }
}

function onPassKeyError(err: Error) {
  snackbar.setError(err?.message || (i18n.t('security.passKeyAuthFailed') as string));
}

function goBackToAmount() {
  // Only safe before any submit attempt — buttons are disabled during signing.
  resetWithdraw();
  password.value = '';
  showFullMessage.value = false;
}

function retry() {
  resetWithdraw();
  password.value = '';
  showFullMessage.value = false;
}

function closeSheet() {
  emit('input', false);
}

function closeAndEmit() {
  emit('withdrawn');
  emit('input', false);
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(() => {
  tickHandle = window.setInterval(() => { now.value = Date.now(); }, 1000) as unknown as number;
});
onBeforeUnmount(() => {
  if (tickHandle !== null) window.clearInterval(tickHandle);
});

watch(() => props.value, (val) => {
  if (val) {
    resetWithdraw();
    amount.value = '';
    password.value = '';
    showPassword.value = false;
    showFullMessage.value = false;
    quoteError.value = null;
    // Load this sheet's own Strike account so the Withdrawable Balance and the
    // Get Quote gate reflect real funds. WithdrawSheet uses its own
    // useStrikeAccount instance (separate from the trading view's), so without
    // this it stays at $0.00 and Get Quote is disabled. Harmless if not yet
    // connected — the call just 401s and the form shows the connect UI.
    loadAccount().catch(() => { /* not connected / transient — stays at $0 */ });
    // Focus the amount field once the dialog has painted (avoids the native
    // `autofocus` race warning the dialog triggers).
    nextTick(() => { amountInput.value?.focus(); });
  }
});
</script>

<style scoped>
.perps-action-dialog {
  background: linear-gradient(180deg, #13161B 0%, #0A0C10 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.dialog-title {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  color: #fff;
}

.dialog-body {
  padding: 16px !important;
  color: #fff;
}

.withdraw-content {
  display: flex;
  flex-direction: column;
  padding-bottom: 8px;
}

.connect-gate-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
  text-align: center;
  line-height: 1.5;
  margin-bottom: 4px;
}

/* ── Step rail ── */
.step-rail {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 14px;
}
.step-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: rgba(255,255,255,0.35);
  background: rgba(255,255,255,0.02);
  transition: all 0.2s ease;
}
.step-dot.active {
  border-color: #00c7f3;
  color: #00c7f3;
  background: rgba(0,199,243,0.08);
}
.step-dot.done {
  border-color: rgba(0,199,243,0.5);
  background: rgba(0,199,243,0.18);
  color: #00c7f3;
}
.step-line {
  width: 38px;
  height: 1px;
  background: rgba(255,255,255,0.1);
  transition: background 0.2s ease;
}
.step-line.filled { background: rgba(0,199,243,0.5); }

/* ── Step pane ── */
.step-pane {
  display: flex;
  flex-direction: column;
}
.step-title {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: 0.01em;
}
.step-sub {
  font-size: 11px;
  color: rgba(255,255,255,0.45);
  margin-top: 2px;
  line-height: 1.5;
}

/* ── Amount field (custom, no spinners) ── */
.amount-field {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 16px;
  padding: 0 8px 0 16px;
  height: 66px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 14px;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}
.amount-field--focus {
  border-color: rgba(0,199,243,0.7);
  background: rgba(0,199,243,0.04);
  box-shadow: 0 0 0 3px rgba(0,199,243,0.08);
}
.amount-field__input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: #ffffff;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
  caret-color: #00c7f3;
  padding: 0;
}
.amount-field__input::placeholder { color: rgba(255,255,255,0.22); }
.amount-field__ccy {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255,255,255,0.4);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.amount-field__max {
  flex-shrink: 0;
  padding: 7px 13px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #00c7f3;
  background: rgba(0,199,243,0.1);
  border: 1px solid rgba(0,199,243,0.25);
  cursor: pointer;
  transition: background 0.15s ease;
}
.amount-field__max:hover { background: rgba(0,199,243,0.2); }

/* ── Withdrawable balance row ── */
.balance-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-top: 10px;
  padding: 2px 4px;
  background: none;
  border: none;
  cursor: pointer;
}
.balance-row__label {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
}
.balance-row__value {
  font-size: 11px;
  font-weight: 600;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.75);
  transition: color 0.15s ease;
}
.balance-row:hover .balance-row__value { color: #00c7f3; }

/* ── Estimate card ── */
.estimate-card {
  background: linear-gradient(180deg, rgba(0,199,243,0.07), rgba(0,199,243,0.02));
  border: 1px solid rgba(0,199,243,0.18);
  border-radius: 12px;
  padding: 14px 16px;
}
.estimate-main {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}
.estimate-main__label {
  font-size: 12px;
  color: rgba(255,255,255,0.55);
}
.estimate-main__value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 22px;
  font-weight: 700;
  color: #00c7f3;
  white-space: nowrap;
}
.estimate-main__unit {
  font-size: 11px;
  font-weight: 600;
  color: rgba(0,199,243,0.65);
  margin-left: 5px;
}
.estimate-sub {
  display: flex;
  justify-content: space-between;
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid rgba(255,255,255,0.06);
  font-size: 11px;
  color: rgba(255,255,255,0.4);
}
.estimate-sub__value {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.6);
  font-weight: 500;
}

/* ── Inputs ── */
.perp-input :deep(.v-input__slot) {
  background: rgba(255,255,255,0.04) !important;
  min-height: 40px !important;
}
.perp-input :deep(.v-label) {
  font-size: 12px !important;
  color: rgba(255,255,255,0.4) !important;
}
.perp-input :deep(input) {
  font-size: 13px !important;
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  color: #ffffff !important;
  caret-color: #00c7f3 !important;
}
.perp-input :deep(.v-text-field__suffix) {
  font-size: 11px !important;
  color: rgba(255,255,255,0.35) !important;
  font-weight: 600 !important;
}
.perp-input :deep(fieldset) { border-color: rgba(255,255,255,0.1) !important; }
.perp-input :deep(.v-input--is-focused fieldset) { border-color: #00c7f3 !important; }

/* ── Hint row ── */
.hint-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: rgba(255,255,255,0.4);
}
.hint-value {
  color: rgba(255,255,255,0.7);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-weight: 600;
}

/* ── Preview / Review cards ── */
.preview-card,
.review-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 12px 14px;
}
.preview-row,
.review-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid rgba(255,255,255,0.04);
}
.preview-row:last-child,
.review-row:last-child { border-bottom: none; }

.preview-label,
.review-label {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
}
.preview-value,
.review-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255,255,255,0.85);
  font-weight: 600;
}
.preview-value.highlight,
.review-value.highlight { color: #00c7f3; }
.preview-value.muted { color: rgba(255,255,255,0.45); font-weight: 400; }
.preview-unit {
  font-size: 9px;
  color: rgba(255,255,255,0.35);
  font-weight: 400;
}
.review-value.warn { color: #FFA726; }
.review-value.expired { color: #F97066; }

/* ── Message preview ── */
.message-card {
  background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  padding: 10px 12px;
}
.message-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.message-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255,255,255,0.35);
}
.link-btn {
  background: none;
  border: none;
  color: #00c7f3;
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  font-weight: 600;
}
.link-btn:hover { text-decoration: underline; }
.message-body {
  margin: 0;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255,255,255,0.7);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}
.message-body.collapsed {
  max-height: 60px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(180deg, #000 50%, transparent 100%);
          mask-image: linear-gradient(180deg, #000 50%, transparent 100%);
}

/* ── Banners ── */
.warn-banner,
.error-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.5;
}
.warn-banner {
  background: rgba(249,112,102,0.08);
  border: 1px solid rgba(249,112,102,0.25);
  color: #F97066;
}
.error-banner {
  background: rgba(249,112,102,0.08);
  border: 1px solid rgba(249,112,102,0.22);
  color: #F97066;
}

/* ── Status pane ── */
.status-pane {
  align-items: center;
  text-align: center;
  padding-top: 16px;
}
.status-icon-wrap {
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.status-title {
  font-size: 15px;
  font-weight: 700;
  color: #ffffff;
}
.status-sub {
  font-size: 11px;
  color: rgba(255,255,255,0.5);
  margin-top: 4px;
  line-height: 1.5;
  max-width: 280px;
}

/* ── Buttons ── */
.btn-row {
  display: flex;
  gap: 8px;
}
.action-btn {
  flex: 1;
  height: 44px !important;
  border-radius: 10px !important;
  background: rgba(0,199,243,0.12) !important;
  color: #00c7f3 !important;
  border: 1px solid rgba(0,199,243,0.3) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}
.action-btn:hover:not(.v-btn--disabled) { background: rgba(0,199,243,0.2) !important; }
.action-btn.v-btn--disabled { opacity: 0.35 !important; }
.ghost-btn {
  flex: 1;
  height: 44px !important;
  border-radius: 10px !important;
  background: rgba(255,255,255,0.04) !important;
  color: rgba(255,255,255,0.7) !important;
  border: 1px solid rgba(255,255,255,0.1) !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  text-transform: none !important;
}

/* ── Transitions ── */
.fade-slide-enter-active,
.fade-slide-leave-active { transition: all 0.22s ease; }
.fade-slide-enter,
.fade-slide-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
