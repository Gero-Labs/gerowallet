<template>
  <v-dialog
    :value="value"
    max-width="480"
    scrollable
    @input="$emit('input', $event)"
  >
    <v-card class="perps-action-dialog">
      <v-card-title class="dialog-title">
        <span class="text-subtitle-1 font-weight-bold">{{ $t('perpetuals.deposit') }}</span>
        <v-spacer />
        <v-btn icon small @click="closeAndReset()">
          <v-icon small>mdi-close</v-icon>
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="dialog-body">
        <div class="deposit-content">

      <!-- ── Phase 1: Amount input ─────────────────────────────────────── -->
      <template v-if="phase === 'amount'">
        <div class="balance-row">
          <span class="balance-label">{{ $t('perpetuals.deposit.available') }}</span>
          <span class="balance-value" @click="setMax()">
            {{ availableAdaDisplay }} <span class="preview-unit">ADA</span>
            <v-icon size="11" class="ml-1" color="#00c7f3">mdi-flash</v-icon>
          </span>
        </div>

        <div class="input-row">
          <v-text-field
            v-model="amount"
            :label="$t('perpetuals.deposit.amountLabel')"
            outlined
            dense
            dark
            hide-details
            class="perp-input"
            suffix="ADA"
            type="number"
            min="0"
          />
          <v-btn small depressed class="max-btn" @click="setMax()">
            MAX
          </v-btn>
        </div>

        <div class="warning-banner mt-2">
          <v-icon size="14" color="#FFA726" class="mr-2" style="flex-shrink:0">mdi-alert-outline</v-icon>
          <span>{{ $t('perpetuals.stablecoinWarning') }}</span>
        </div>

        <transition name="fade-slide">
          <div v-if="depositError" class="error-banner mt-3">
            <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ depositError }}</span>
          </div>
        </transition>

        <v-btn
          block
          depressed
          :loading="depositStatus === 'quoting'"
          :disabled="!canQuote"
          class="action-btn mt-4"
          @click="goToReview()"
        >
          {{ $t('perpetuals.deposit.continue') }}
          <v-icon size="14" class="ml-2">mdi-arrow-right</v-icon>
        </v-btn>
      </template>

      <!-- ── Phase 2: Review & sign ────────────────────────────────────── -->
      <template v-else-if="phase === 'review'">
        <div class="preview-card">
          <div class="preview-title">{{ $t('perpetuals.deposit.review') }}</div>

          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.deposit.youSend') }}</span>
            <span class="preview-value highlight">
              {{ requiredAdaDisplay }} <span class="preview-unit">ADA</span>
            </span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.estimatedCredit') }}</span>
            <span class="preview-value highlight">${{ usdValueDisplay }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.deposit.exchangeRate') }}</span>
            <span class="preview-value muted">{{ exchangeRateDisplay }}</span>
          </div>
          <div class="preview-row">
            <span class="preview-label">{{ $t('perpetuals.deposit.depositAddress') }}</span>
            <span class="preview-value mono-addr" :title="quote?.deposit_address || ''">
              {{ truncatedAddress }}
              <v-icon size="12" class="ml-1 copy-icon" @click="copyAddress()">
                {{ addressCopied ? 'mdi-check' : 'mdi-content-copy' }}
              </v-icon>
            </span>
          </div>

          <div class="countdown-row">
            <v-icon size="12" :color="quoteCountdown < 30 ? '#F97066' : '#FFA726'" class="mr-1">
              mdi-clock-outline
            </v-icon>
            <span class="countdown-text" :class="{ urgent: quoteCountdown < 30 }">
              <template v-if="quoteCountdown > 0">
                {{ $t('perpetuals.quoteExpires') }} {{ formatCountdown(quoteCountdown) }}
              </template>
              <template v-else>
                {{ $t('perpetuals.deposit.quoteExpired') }}
              </template>
            </span>
            <v-btn
              x-small
              text
              class="ml-auto refresh-btn"
              :loading="depositStatus === 'quoting'"
              @click="refreshQuote()"
            >
              <v-icon size="12" class="mr-1">mdi-refresh</v-icon>
              {{ $t('perpetuals.deposit.refresh') }}
            </v-btn>
          </div>
        </div>

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
          :disabled="quoteCountdown <= 0"
          @click:append="showPassword = !showPassword"
        />

        <div v-else class="info-banner mt-3">
          <v-icon size="14" color="#FFB454" class="mr-2" style="flex-shrink:0">mdi-information-outline</v-icon>
          <span>{{ $t('perpetuals.deposit.hwNotSupported', { addr: truncatedAddress }) }}</span>
        </div>

        <transition name="fade-slide">
          <div v-if="depositError" class="error-banner mt-3">
            <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
            <span>{{ depositError }}</span>
          </div>
        </transition>

        <div class="action-row mt-4">
          <v-btn text small class="back-btn" @click="goBackToAmount()">
            <v-icon size="14" class="mr-1">mdi-arrow-left</v-icon>
            {{ $t('common.back') }}
          </v-btn>
          <v-btn
            v-if="needsPassword"
            depressed
            :loading="isSigning"
            :disabled="!canConfirm"
            class="action-btn flex-grow-1"
            @click="handleConfirm()"
          >
            <v-icon size="14" class="mr-2">mdi-shield-check</v-icon>
            {{ $t('perpetuals.deposit.confirmSign') }}
          </v-btn>
          <v-btn
            v-else
            depressed
            class="action-btn flex-grow-1"
            @click="copyAddress()"
          >
            <v-icon size="14" class="mr-2">mdi-content-copy</v-icon>
            {{ $t('perpetuals.deposit.copyAddress') }}
          </v-btn>
        </div>
      </template>

      <!-- ── Phase 3: Status / progress ────────────────────────────────── -->
      <template v-else-if="phase === 'status'">
        <div class="status-card">
          <div class="status-icon-wrap">
            <v-progress-circular
              v-if="depositStatus !== 'credited' && depositStatus !== 'confirmed' && depositStatus !== 'error'"
              indeterminate
              size="56"
              width="3"
              color="#00c7f3"
            />
            <v-icon v-else-if="depositStatus === 'error'" size="56" color="#F97066">
              mdi-alert-circle
            </v-icon>
            <v-icon v-else size="56" color="#26FAB0">
              mdi-check-circle
            </v-icon>
          </div>

          <div class="status-title">{{ statusLabel }}</div>
          <div class="status-sub" v-if="statusSub">{{ statusSub }}</div>

          <!-- Step pills -->
          <div class="step-pills">
            <div
              v-for="(s, idx) in statusSteps"
              :key="s.key"
              class="step-pill"
              :class="{
                active: stepIndexFor(depositStatus) === idx,
                done: stepIndexFor(depositStatus) > idx,
              }"
            >
              <v-icon size="10" v-if="stepIndexFor(depositStatus) > idx" color="#26FAB0">mdi-check</v-icon>
              <span>{{ s.label }}</span>
            </div>
          </div>

          <transition name="fade-slide">
            <div v-if="(depositStatus === 'credited' || depositStatus === 'confirmed') && txHash" class="tx-link-row mt-4">
              <a class="tx-link" :href="explorerUrl" target="_blank" rel="noopener noreferrer">
                <v-icon size="13" class="mr-1">mdi-open-in-new</v-icon>
                {{ $t('perpetuals.deposit.viewExplorer') }}
              </a>
            </div>
          </transition>

          <transition name="fade-slide">
            <div v-if="depositError" class="error-banner mt-3">
              <v-icon size="14" color="#F97066" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
              <span>{{ depositError }}</span>
            </div>
          </transition>
        </div>

        <div class="action-row mt-4" v-if="depositStatus === 'credited' || depositStatus === 'confirmed' || depositStatus === 'error'">
          <v-btn
            v-if="depositStatus === 'error'"
            depressed
            class="action-btn flex-grow-1"
            @click="retryFromError()"
          >
            <v-icon size="14" class="mr-2">mdi-refresh</v-icon>
            {{ $t('perpetuals.deposit.retry') }}
          </v-btn>
          <v-btn
            v-else
            depressed
            class="action-btn flex-grow-1"
            @click="closeAndReset()"
          >
            <v-icon size="14" class="mr-2">mdi-check</v-icon>
            {{ $t('common.done') }}
          </v-btn>
        </div>
      </template>

        </div>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useStrikeDeposit } from '@/modules/market/composables/useStrikeDeposit';
import { walletStore } from '@/stores/walletStore';
import type { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';

// ── Props & Emits ─────────────────────────────────────────────────────────────
const props = defineProps<{
  value: boolean;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'deposited'): void;
}>();

const { t } = useTranslation();

// ── Composable ────────────────────────────────────────────────────────────────
const {
  quote,
  txHash,
  depositStatus,
  depositError,
  quoteCountdown,
  adaToUsdRate,
  requestQuote,
  buildAndSign,
  resetDeposit,
} = useStrikeDeposit();

// ── Local state ───────────────────────────────────────────────────────────────
type Phase = 'amount' | 'review' | 'status';
const phase = ref<Phase>('amount');
const amount = ref<string>('');
const password = ref<string>('');
const showPassword = ref(false);
const addressCopied = ref(false);

// ── Computed ──────────────────────────────────────────────────────────────────
const amountNum = computed(() => {
  const n = parseFloat(amount.value);
  return isNaN(n) || n < 0 ? 0 : n;
});

/**
 * Compute available ADA from on-chain UTxOs (matches the SendDialog approach
 * — walletStore doesn't expose a precomputed `balances` map). We subtract a
 * 2 ADA buffer to leave room for the network fee + min-UTxO change output.
 */
const availableAda = computed<number>(() => {
  const utxos = walletStore.utxos as Cardano.Utxo[] | undefined;
  if (!utxos || utxos.length === 0) return 0;
  let total = BigInt(0);
  for (const utxo of utxos) {
    try {
      total += BigInt(utxo[1]?.value?.coins ?? 0);
    } catch {
      // Skip malformed UTxOs rather than crash the UI.
    }
  }
  const ada = Number(total) / 1_000_000;
  return Math.max(0, ada - 2);
});

const availableAdaDisplay = computed(() => availableAda.value.toFixed(2));

const requiredAdaDisplay = computed(() => {
  const lovelace = quote.value?.quote.asset_amount;
  if (!lovelace) return '0.00';
  return (Number(lovelace) / 1_000_000).toFixed(6);
});

const usdValueDisplay = computed(() => {
  const usd = quote.value?.quote.usd_value;
  if (usd) return Number(usd).toFixed(2);
  // Fallback: estimate from local ADA price if Strike didn't return a usd value
  return (amountNum.value * (adaToUsdRate.value ?? 0)).toFixed(2);
});

const exchangeRateDisplay = computed(() => {
  const rate = quote.value?.quote.exchange_rate;
  if (rate) return `1 ADA ≈ $${Number(rate).toFixed(4)}`;
  return adaToUsdRate.value > 0 ? `1 ADA ≈ $${adaToUsdRate.value.toFixed(4)}` : '—';
});

const truncatedAddress = computed(() => {
  const addr = quote.value?.deposit_address ?? '';
  if (!addr) return '—';
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}…${addr.slice(-6)}`;
});

const explorerUrl = computed(() => {
  if (!txHash.value) return '#';
  const network = walletStore.loggedWallet?.network;
  const prefix = network === 'Preprod' ? 'preprod.' : '';
  return `https://${prefix}cexplorer.io/tx/${txHash.value}`;
});

const canQuote = computed(() => amountNum.value > 0 && amountNum.value <= availableAda.value);

// Hardware-wallet (Ledger/Trezor/Keystone) and PRF/PassKey wallets sign via
// an interactive flow that the deposit composable doesn't yet drive (the
// Send dialog handles those paths). Until that's wired, surface a clear
// "not supported" message instead of a permanently-disabled confirm button.
const isPrfWallet = computed(() => walletStore.loggedWallet?.encryptionMethod === 'prf');
const isHwWallet = computed(() => {
  const t = walletStore.loggedWallet?.type;
  return t === 'Ledger' || t === 'Trezor' || t === 'Keystone';
});
const needsPassword = computed(() => !isPrfWallet.value && !isHwWallet.value);
const canConfirm = computed(() => {
  if (!needsPassword.value) return false; // HW / PRF — show the explainer instead
  return !!password.value && quoteCountdown.value > 0 && !isSigning.value;
});

const isSigning = computed(() =>
  ['building', 'signing', 'submitting', 'confirming'].includes(depositStatus.value),
);

// ── Status pill model ─────────────────────────────────────────────────────────
const statusSteps = computed(() => [
  { key: 'building', label: t('perpetuals.deposit.statusBuilding') },
  { key: 'signing', label: t('perpetuals.deposit.statusSigning') },
  { key: 'submitting', label: t('perpetuals.deposit.statusSubmitting') },
  { key: 'confirming', label: t('perpetuals.deposit.statusConfirming') },
  { key: 'credited', label: t('perpetuals.deposit.statusCredited') },
]);

function stepIndexFor(s: string): number {
  switch (s) {
    case 'building': return 0;
    case 'signing': return 1;
    case 'submitting': return 2;
    case 'confirming': return 3;
    case 'credited':
    case 'confirmed': return 4;
    default: return -1;
  }
}

const statusLabel = computed(() => {
  switch (depositStatus.value) {
    case 'building': return t('perpetuals.deposit.statusBuilding');
    case 'signing': return t('perpetuals.deposit.statusSigning');
    case 'submitting': return t('perpetuals.deposit.statusSubmitting');
    case 'confirming': return t('perpetuals.deposit.statusConfirming');
    case 'credited':
    case 'confirmed': return t('perpetuals.depositConfirmed');
    case 'error': return t('perpetuals.deposit.statusError');
    default: return t('perpetuals.deposit.statusBuilding');
  }
});

const statusSub = computed(() => {
  switch (depositStatus.value) {
    case 'confirming': return t('perpetuals.deposit.statusConfirmingSub');
    case 'credited':
    case 'confirmed': return t('perpetuals.deposit.statusCreditedSub');
    default: return '';
  }
});

// ── Methods ───────────────────────────────────────────────────────────────────
function setMax() {
  amount.value = availableAda.value.toFixed(2);
}

function formatCountdown(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

async function copyAddress() {
  const addr = quote.value?.deposit_address;
  if (!addr) return;
  try {
    await navigator.clipboard.writeText(addr);
    addressCopied.value = true;
    setTimeout(() => { addressCopied.value = false; }, 1800);
  } catch {
    // Fail silently — clipboard isn't critical.
  }
}

async function goToReview() {
  if (!canQuote.value) return;
  await requestQuote(amountNum.value);
  if (depositStatus.value === 'quoted') {
    phase.value = 'review';
  }
}

async function refreshQuote() {
  await requestQuote(amountNum.value);
}

function goBackToAmount() {
  phase.value = 'amount';
}

async function handleConfirm() {
  if (!canConfirm.value) return;
  phase.value = 'status';
  const ok = await buildAndSign(password.value);
  if (ok) {
    emit('deposited');
  }
}

function retryFromError() {
  // Send the user back to the amount step with a clean slate; the quote may
  // be stale, the password may have been wrong, or the build may have failed.
  resetDeposit();
  password.value = '';
  phase.value = 'amount';
}

function closeAndReset() {
  emit('input', false);
}

// ── Reset on close ────────────────────────────────────────────────────────────
watch(() => props.value, (val) => {
  if (!val) {
    amount.value = '';
    password.value = '';
    showPassword.value = false;
    addressCopied.value = false;
    phase.value = 'amount';
    resetDeposit();
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

.deposit-content {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 8px;
}

/* ── Balance row ── */
.balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0 8px;
}

.balance-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.balance-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: #00c7f3;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  user-select: none;
}

.balance-value:hover { opacity: 0.85; }

/* ── Amount Row ── */
.input-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}

.input-row .perp-input { flex: 1; }

.max-btn {
  height: 40px !important;
  padding: 0 12px !important;
  border-radius: 8px !important;
  background: color-mix(in srgb, var(--chain-primary) 10%, transparent) !important;
  color: var(--chain-primary) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary) 25%, transparent) !important;
  font-size: 10px !important;
  font-weight: 800 !important;
  letter-spacing: 0.06em !important;
  text-transform: none !important;
  flex-shrink: 0;
  margin-top: 0 !important;
}

/* ── Inputs ── */
.perp-input :deep(.v-input__slot) {
  background: rgba(255, 255, 255, 0.04) !important;
  min-height: 40px !important;
}
.perp-input :deep(.v-label) {
  font-size: 12px !important;
  color: rgba(255, 255, 255, 0.4) !important;
}
.perp-input :deep(input) {
  font-size: 13px !important;
  font-family: 'JetBrains Mono', 'Fira Code', monospace !important;
  color: #ffffff !important;
  caret-color: var(--chain-primary) !important;
}
.perp-input :deep(.v-text-field__suffix) {
  font-size: 11px !important;
  color: rgba(255, 255, 255, 0.35) !important;
  font-weight: 600 !important;
}
.perp-input :deep(fieldset) {
  border-color: rgba(255, 255, 255, 0.1) !important;
}
.perp-input :deep(.v-input--is-focused fieldset) {
  border-color: var(--chain-primary) !important;
}

/* ── Preview Card ── */
.preview-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 4px;
}

.preview-title {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.3);
  margin-bottom: 10px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
.preview-row:last-child { border-bottom: none; }

.preview-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.preview-value {
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}
.preview-value.highlight { color: #26FAB0; }
.preview-value.muted { color: rgba(255, 255, 255, 0.45); font-weight: 400; }
.preview-value.mono-addr { font-size: 11px; }

.preview-unit {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  font-weight: 400;
}

.copy-icon {
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s ease, color 0.15s ease;
}
.copy-icon:hover { opacity: 1; color: #00c7f3 !important; }

.countdown-row {
  display: flex;
  align-items: center;
  padding-top: 10px;
  margin-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.countdown-text {
  font-size: 10px;
  color: #FFA726;
  font-weight: 600;
}
.countdown-text.urgent { color: #F97066; }

.refresh-btn {
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: 0.04em !important;
  color: #00c7f3 !important;
  text-transform: none !important;
  padding: 0 6px !important;
  min-width: 0 !important;
  height: 22px !important;
}

/* ── Warning Banner ── */
.warning-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 167, 38, 0.08);
  border: 1px solid rgba(255, 167, 38, 0.22);
  font-size: 11px;
  color: rgba(255, 167, 38, 0.9);
  line-height: 1.5;
}

/* ── Status card ── */
.status-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 18px 14px 14px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
}

.status-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 80px;
  margin-bottom: 14px;
}

.status-title {
  font-size: 14px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.92);
  margin-bottom: 4px;
}

.status-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 12px;
  line-height: 1.4;
}

.step-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  margin-top: 8px;
}

.step-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.4);
}
.step-pill.active {
  background: rgba(0, 199, 243, 0.12);
  border-color: rgba(0, 199, 243, 0.4);
  color: #00c7f3;
}
.step-pill.done {
  background: rgba(38, 250, 176, 0.08);
  border-color: rgba(38, 250, 176, 0.25);
  color: #26FAB0;
}

.tx-link-row {
  display: flex;
  justify-content: center;
}

.tx-link {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: #00c7f3;
  text-decoration: none;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 199, 243, 0.08);
  border: 1px solid rgba(0, 199, 243, 0.22);
  transition: background 0.15s ease;
}
.tx-link:hover { background: rgba(0, 199, 243, 0.16); }

/* ── Error banner ── */
.error-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(249, 112, 102, 0.08);
  border: 1px solid rgba(249, 112, 102, 0.22);
  font-size: 11px;
  color: #F97066;
  line-height: 1.5;
}

/* ── Info banner (HW/PRF "not supported") ── */
.info-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 180, 84, 0.08);
  border: 1px solid rgba(255, 180, 84, 0.22);
  font-size: 11px;
  color: #FFB454;
  line-height: 1.5;
}

/* ── Action row & buttons ── */
.action-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flex-grow-1 { flex-grow: 1; }

.back-btn {
  height: 44px !important;
  color: rgba(255, 255, 255, 0.6) !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  text-transform: none !important;
}

.action-btn {
  height: 44px !important;
  border-radius: 10px !important;
  background: color-mix(in srgb, var(--chain-primary) 12%, transparent) !important;
  color: var(--chain-primary) !important;
  border: 1px solid color-mix(in srgb, var(--chain-primary) 30%, transparent) !important;
  font-size: 13px !important;
  font-weight: 700 !important;
  text-transform: none !important;
  letter-spacing: 0.02em !important;
}

.action-btn:hover:not(.v-btn--disabled) {
  background: color-mix(in srgb, var(--chain-primary) 20%, transparent) !important;
}

.action-btn.v-btn--disabled {
  opacity: 0.35 !important;
}

/* ── Transitions ── */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.25s ease;
}

.fade-slide-enter,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
