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

        <!-- Amount field (shared component — no native number spinners) -->
        <PerpsAmountField
          ref="amountFieldRef"
          v-model="amount"
          currency="USD"
          class="mt-4"
          @max="setMax()"
          @submit="canQuote && requestQuoteClick()"
        />

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
            <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ $t('perpetuals.marginSafetyWarning') }}</span>
          </div>
        </transition>

        <transition name="fade-slide">
          <div v-if="quoteError" class="error-banner mt-3">
            <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
            <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
            color="var(--g-accent)"
          />
          <v-icon v-else-if="withdrawStatus === 'settled'" size="56" color="success">
            mdi-check-circle-outline
          </v-icon>
          <v-icon v-else-if="withdrawStatus === 'error'" size="56" color="error">
            mdi-alert-circle-outline
          </v-icon>
        </div>

        <div class="status-title">{{ statusTitle }}</div>
        <div class="status-sub">{{ statusSub }}</div>

        <transition name="fade-slide">
          <div v-if="withdrawError && withdrawStatus === 'error'" class="error-banner mt-3" style="text-align:left;">
            <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
import PerpsAmountField from './PerpsAmountField.vue';
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
const amountFieldRef = ref<{ focus: () => void } | null>(null);
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
    // Load the Strike account so the Withdrawable Balance and the Get Quote
    // gate reflect real funds. useStrikeAccount's `account` is a module-level
    // singleton, but the trading view populates a DIFFERENT composable
    // (useStrikeTrading, which has its own separate account) — nothing had
    // called useStrikeAccount.loadAccount() in the withdraw context, so it sat
    // at $0.00 with Get Quote disabled. Harmless if not yet connected — the
    // call just 401s and the form shows the connect UI.
    loadAccount().catch(() => { /* not connected / transient — stays at $0 */ });
    // Focus the amount field once the dialog has painted (avoids the native
    // `autofocus` race warning the dialog triggers).
    nextTick(() => { amountFieldRef.value?.focus(); });
  }
});
</script>

<style scoped>
.perps-action-dialog {
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-1);
}

.dialog-title {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  color: var(--g-text-1);
}

.dialog-body {
  padding: 16px !important;
  color: var(--g-text-1);
}

.withdraw-content {
  display: flex;
  flex-direction: column;
  padding-bottom: 8px;
}

.connect-gate-sub {
  font-size: 12px;
  color: var(--g-text-3);
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
  border: 1px solid var(--g-hairline-3);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--g-text-3);
  background: var(--g-hairline-1);
  transition: color var(--g-dur-base) ease, background-color var(--g-dur-base) ease, border-color var(--g-dur-base) ease;
}
.step-dot.active {
  border-color: var(--g-accent);
  color: var(--g-accent);
  background: color-mix(in srgb, var(--g-accent) 8%, transparent);
}
.step-dot.done {
  border-color: color-mix(in srgb, var(--g-accent) 50%, transparent);
  background: color-mix(in srgb, var(--g-accent) 18%, transparent);
  color: var(--g-accent);
}
.step-line {
  width: 38px;
  height: 1px;
  background: var(--g-hairline-2);
  transition: background var(--g-dur-base) ease;
}
.step-line.filled { background: color-mix(in srgb, var(--g-accent) 50%, transparent); }

/* ── Step pane ── */
.step-pane {
  display: flex;
  flex-direction: column;
}
.step-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
  letter-spacing: 0.01em;
}
.step-sub {
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 2px;
  line-height: 1.5;
}

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
  color: var(--g-text-3);
}
.balance-row__value {
  font-size: 11px;
  font-weight: 600;
  font-family: var(--g-font-mono);
  color: var(--g-text-2);
  transition: color var(--g-dur-fast) ease;
}
.balance-row:hover .balance-row__value { color: var(--g-accent); }

/* ── Estimate card ── */
.estimate-card {
  background: color-mix(in srgb, var(--g-accent) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 18%, transparent);
  border-radius: var(--g-r-card);
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
  color: var(--g-text-3);
}
.estimate-main__value {
  font-family: var(--g-font-mono);
  font-size: 20px;
  font-weight: 700;
  color: var(--g-accent);
  white-space: nowrap;
}
.estimate-main__unit {
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in srgb, var(--g-accent) 65%, transparent);
  margin-left: 5px;
}
.estimate-sub {
  display: flex;
  justify-content: space-between;
  margin-top: 9px;
  padding-top: 9px;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 11px;
  color: var(--g-text-3);
}
.estimate-sub__value {
  font-family: var(--g-font-mono);
  color: var(--g-text-2);
  font-weight: 500;
}

/* ── Inputs ── */
.perp-input :deep(.v-input__slot) {
  background: var(--g-hairline-1) !important;
  min-height: 40px !important;
}
.perp-input :deep(.v-label) {
  font-size: 12px !important;
  color: var(--g-text-3) !important;
}
.perp-input :deep(input) {
  font-size: 13px !important;
  font-family: var(--g-font-mono) !important;
  color: var(--g-text-1) !important;
  caret-color: var(--g-accent) !important;
}
.perp-input :deep(.v-text-field__suffix) {
  font-size: 11px !important;
  color: var(--g-text-3) !important;
  font-weight: 600 !important;
}
.perp-input :deep(fieldset) { border-color: var(--g-hairline-2) !important; }
.perp-input :deep(.v-input--is-focused fieldset) { border-color: var(--g-accent) !important; }

/* ── Hint row ── */
.hint-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--g-text-3);
}
.hint-value {
  color: var(--g-text-2);
  font-family: var(--g-font-mono);
  font-weight: 600;
}

/* ── Preview / Review cards ── */
.preview-card,
.review-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 12px 14px;
}
.preview-row,
.review-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 5px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}
.preview-row:last-child,
.review-row:last-child { border-bottom: none; }

.preview-label,
.review-label {
  font-size: 11px;
  color: var(--g-text-3);
}
.preview-value,
.review-value {
  font-size: 12px;
  font-family: var(--g-font-mono);
  color: var(--g-text-1);
  font-weight: 600;
}
.preview-value.highlight,
.review-value.highlight { color: var(--g-accent); }
.preview-value.muted { color: var(--g-text-3); font-weight: 400; }
.preview-unit {
  font-size: 11px;
  color: var(--g-text-3);
  font-weight: 400;
}
.review-value.warn { color: var(--g-warning); }
.review-value.expired { color: var(--g-error); }

/* ── Message preview ── */
.message-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px 12px;
}
.message-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.message-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--g-text-3);
}
.link-btn {
  background: none;
  border: none;
  color: var(--g-accent);
  font-size: 11px;
  cursor: pointer;
  padding: 0;
  font-weight: 600;
}
.link-btn:hover { text-decoration: underline; }
.message-body {
  margin: 0;
  font-family: var(--g-font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--g-text-2);
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
  border-radius: var(--g-r-control);
  font-size: 11px;
  line-height: 1.5;
}
.warn-banner {
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  color: var(--g-error);
}
.error-banner {
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  color: var(--g-error);
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
  font-size: 14px;
  font-weight: 700;
  color: var(--g-text-1);
}
.status-sub {
  font-size: 11px;
  color: var(--g-text-3);
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
  border-radius: var(--g-r-control) !important;
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  color: var(--g-accent) !important;
  border: 1px solid color-mix(in srgb, var(--g-accent) 30%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}
.action-btn:hover:not(.v-btn--disabled) { background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important; }
.action-btn.v-btn--disabled { opacity: 0.35 !important; }
.ghost-btn {
  flex: 1;
  height: 44px !important;
  border-radius: var(--g-r-control) !important;
  background: var(--g-hairline-1) !important;
  color: var(--g-text-2) !important;
  border: 1px solid var(--g-hairline-2) !important;
  font-size: 13px !important;
  font-weight: 600 !important;
  text-transform: none !important;
}

/* ── Transitions ── */
.fade-slide-enter-active,
.fade-slide-leave-active { transition: opacity var(--g-dur-base) ease, transform var(--g-dur-base) ease; }
.fade-slide-enter,
.fade-slide-leave-to { opacity: 0; transform: translateY(-6px); }
</style>