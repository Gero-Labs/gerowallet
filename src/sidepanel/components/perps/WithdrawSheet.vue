<template>
  <BottomSheet :value="value" :title="$t('perpetuals.withdraw')" height="92%" @input="$emit('input', $event)">
    <div class="withdraw-content">

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

        <div class="input-row mt-3">
          <v-text-field
            v-model="amount"
            :label="$t('perpetuals.amount')"
            outlined
            dense
            dark
            hide-details
            class="perp-input"
            suffix="USD"
            type="number"
            min="0"
            autofocus
          />
          <v-btn small depressed class="max-btn" @click="setMax()">
            MAX
          </v-btn>
        </div>

        <!-- Withdrawable hint -->
        <div class="hint-row mt-2">
          <span>{{ $t('perpetuals.withdrawableBalance') }}</span>
          <span class="hint-value">${{ formatUsd(maxWithdrawable) }}</span>
        </div>

        <!-- ADA estimate preview -->
        <transition name="fade-slide">
          <div v-if="amountNum > 0" class="preview-card mt-3">
            <div class="preview-row">
              <span class="preview-label">{{ $t('perpetuals.estimatedReceived') }}</span>
              <span class="preview-value highlight">
                ~{{ formatAda(estimatedAda) }} <span class="preview-unit">ADA</span>
              </span>
            </div>
            <div class="preview-row">
              <span class="preview-label">{{ $t('perpetuals.currentAdaPrice') }}</span>
              <span class="preview-value muted">${{ formatPrice(usdPerAda) }}</span>
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

    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import BottomSheet from '@/sidepanel/components/BottomSheet.vue';
import { useStrikeWithdraw } from '@/modules/market/composables/useStrikeWithdraw';
import { useStrikeAccount } from '@/modules/market/composables/useStrikeAccount';
import { walletStore } from '@/stores/walletStore';
import i18n from '@/plugins/i18n';

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

const { account, marginRatio } = useStrikeAccount();

// ── Local state ─────────────────────────────────────────────────────────────
const amount = ref('');
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

const isPrfWallet = computed(() => walletStore.loggedWallet?.encryptionMethod === 'prf');
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
  await requestQuote(amountNum.value.toFixed(2), 'ADA');
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
  }
});
</script>

<style scoped>
.withdraw-content {
  display: flex;
  flex-direction: column;
  padding-bottom: 8px;
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

/* ── Amount row ── */
.input-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.input-row .perp-input { flex: 1; }
.max-btn {
  height: 40px !important;
  padding: 0 12px !important;
  border-radius: 8px !important;
  background: rgba(0,199,243,0.1) !important;
  color: #00c7f3 !important;
  border: 1px solid rgba(0,199,243,0.25) !important;
  font-size: 10px !important;
  font-weight: 800 !important;
  letter-spacing: 0.06em !important;
  text-transform: none !important;
  flex-shrink: 0;
  margin-top: 0 !important;
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
