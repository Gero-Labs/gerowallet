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

      <!-- ── Connect gate: must connect to Strike before depositing ────── -->
      <template v-if="!isConnected">
        <div class="connect-gate-sub">{{ $t('perps.connect.gateDeposit') }}</div>
        <StrikeOnboarding @connected="onConnected" />
      </template>

      <!-- ── Phase 1: Amount input ─────────────────────────────────────── -->
      <template v-else-if="phase === 'amount'">
        <div class="balance-row">
          <span class="balance-label">{{ $t('perpetuals.deposit.available') }}</span>
          <span class="balance-value" @click="setMax()">
            {{ availableAdaDisplay }} <span class="preview-unit">ADA</span>
            <v-icon size="11" class="ml-1" color="var(--g-accent)">mdi-flash</v-icon>
          </span>
        </div>

        <PerpsAmountField
          ref="amountFieldRef"
          v-model="amount"
          currency="ADA"
          class="mt-2"
          @max="setMax()"
          @submit="canQuote && goToReview()"
        />

        <div class="warning-banner mt-2">
          <v-icon size="14" color="warning" class="mr-2" style="flex-shrink:0">mdi-alert-outline</v-icon>
          <span>{{ $t('perpetuals.stablecoinWarning') }}</span>
        </div>

        <transition name="fade-slide">
          <div v-if="depositError" class="error-banner mt-3">
            <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
            <v-icon size="12" :color="quoteCountdown < 30 ? 'error' : 'warning'" class="mr-1">
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

        <!-- PRF (passkey) wallets confirm by authenticating with their PassKey -->
        <div v-else-if="isPrfWallet" class="info-banner mt-3" style="background: color-mix(in srgb, var(--g-accent) 6%, transparent); border-color: color-mix(in srgb, var(--g-accent) 22%, transparent); color: var(--g-accent);">
          <v-icon size="14" color="var(--g-accent)" class="mr-2" style="flex-shrink:0">mdi-fingerprint</v-icon>
          <span>{{ $t('perps.passkeySignHint') }}</span>
        </div>

        <div v-else class="info-banner mt-3">
          <v-icon size="14" color="warning" class="mr-2" style="flex-shrink:0">mdi-information-outline</v-icon>
          <span>{{ $t('perpetuals.deposit.hwNotSupported', { addr: truncatedAddress }) }}</span>
        </div>

        <transition name="fade-slide">
          <div v-if="depositError" class="error-banner mt-3">
            <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
          <!-- PRF wallets: tap PassKey to authenticate, then build + sign -->
          <PassKeyAuthButton
            v-else-if="isPrfWallet"
            class="flex-grow-1"
            :disabled="isSigning || quoteCountdown <= 0"
            :text="$t('perpetuals.deposit.confirmSign')"
            @success="handlePassKeyConfirm"
            @error="onPassKeyError"
          />
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
              color="var(--g-accent)"
            />
            <v-icon v-else-if="depositStatus === 'error'" size="56" color="error">
              mdi-alert-circle
            </v-icon>
            <v-icon v-else size="56" color="success">
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
              <v-icon size="10" v-if="stepIndexFor(depositStatus) > idx" color="success">mdi-check</v-icon>
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
              <v-icon size="14" color="error" class="mr-2" style="flex-shrink:0">mdi-alert-circle-outline</v-icon>
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
import { ref, computed, watch, nextTick } from 'vue';
import { useStrikeDeposit } from '@/modules/market/composables/useStrikeDeposit';
import { useStrikeOnboarding } from '@/modules/market/composables/useStrikeOnboarding';
import { walletStore } from '@/stores/walletStore';
import type { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import StrikeOnboarding from './StrikeOnboarding.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import PerpsAmountField from './PerpsAmountField.vue';
import snackbar from '@/plugins/snackbar';

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

// Gate the deposit form behind a Strike connection — opening this sheet while
// disconnected shows the inline connect/unlock UI instead of the amount form.
const { isConnected } = useStrikeOnboarding();

function onConnected() {
  // Once connected, fall through to the amount phase (already the default).
  phase.value = 'amount';
}

// ── Local state ───────────────────────────────────────────────────────────────
type Phase = 'amount' | 'review' | 'status';
const phase = ref<Phase>('amount');
const amount = ref<string>('');
const amountFieldRef = ref<{ focus: () => void } | null>(null);
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

/**
 * PRF (passkey) wallets: PassKeyAuthButton decrypted the root key and handed
 * us the bytes. Pass them to buildAndSign as privateKeyBytes (skips password
 * verification, signs via SIGN_TX's privateKeyBytes path).
 */
async function handlePassKeyConfirm(pkBytes: Uint8Array) {
  if (quoteCountdown.value <= 0) return;
  phase.value = 'status';
  const ok = await buildAndSign('', undefined, pkBytes);
  if (ok) {
    emit('deposited');
  }
}

function onPassKeyError(err: Error) {
  snackbar.setError(err?.message || t('security.passKeyAuthFailed'));
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
  } else {
    // Focus the amount field once the dialog has painted.
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

.deposit-content {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-bottom: 8px;
}

.connect-gate-sub {
  font-size: 12px;
  color: var(--g-text-3);
  text-align: center;
  line-height: 1.5;
  margin-bottom: 4px;
}

/* ── Balance row ── */
.balance-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 0 8px;
}

.balance-label {
  font-size: 11px;
  color: var(--g-text-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.balance-value {
  font-size: 12px;
  font-family: var(--g-font-mono);
  color: var(--g-accent);
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  user-select: none;
}

.balance-value:hover { opacity: 0.85; }

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
.perp-input :deep(fieldset) {
  border-color: var(--g-hairline-2) !important;
}
.perp-input :deep(.v-input--is-focused fieldset) {
  border-color: var(--g-accent) !important;
}

/* ── Preview Card ── */
.preview-card {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 12px 14px;
  margin-bottom: 4px;
}

.preview-title {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--g-text-3);
  margin-bottom: 10px;
}

.preview-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
  border-bottom: 1px solid var(--g-hairline-1);
}
.preview-row:last-child { border-bottom: none; }

.preview-label {
  font-size: 11px;
  color: var(--g-text-3);
}

.preview-value {
  font-size: 12px;
  font-family: var(--g-font-mono);
  color: var(--g-text-1);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
}
.preview-value.highlight { color: var(--g-success); }
.preview-value.muted { color: var(--g-text-3); font-weight: 400; }
.preview-value.mono-addr { font-size: 11px; }

.preview-unit {
  font-size: 11px;
  color: var(--g-text-3);
  font-weight: 400;
}

.copy-icon {
  cursor: pointer;
  opacity: 0.6;
  transition: opacity var(--g-dur-fast) ease, color var(--g-dur-fast) ease;
}
.copy-icon:hover { opacity: 1; color: var(--g-accent) !important; }

.countdown-row {
  display: flex;
  align-items: center;
  padding-top: 10px;
  margin-top: 6px;
  border-top: 1px solid var(--g-hairline-1);
}

.countdown-text {
  font-size: 11px;
  color: var(--g-warning);
  font-weight: 600;
}
.countdown-text.urgent { color: var(--g-error); }

.refresh-btn {
  font-size: 11px !important;
  font-weight: 700 !important;
  letter-spacing: 0.04em !important;
  color: var(--g-accent) !important;
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
  border-radius: var(--g-r-control);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  font-size: 11px;
  color: var(--g-warning);
  line-height: 1.5;
}

/* ── Status card ── */
.status-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 18px 14px 14px;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
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
  color: var(--g-text-1);
  margin-bottom: 4px;
}

.status-sub {
  font-size: 11px;
  color: var(--g-text-3);
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
  border-radius: var(--g-r-pill);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  color: var(--g-text-3);
}
.step-pill.active {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--g-accent) 40%, transparent);
  color: var(--g-accent);
}
.step-pill.done {
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
  color: var(--g-success);
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
  color: var(--g-accent);
  text-decoration: none;
  padding: 6px 10px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 22%, transparent);
  transition: background var(--g-dur-fast) ease;
}
.tx-link:hover { background: color-mix(in srgb, var(--g-accent) 16%, transparent); }

/* ── Error banner ── */
.error-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  font-size: 11px;
  color: var(--g-error);
  line-height: 1.5;
}

/* ── Info banner (HW/PRF "not supported") ── */
.info-banner {
  display: flex;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--g-r-control);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  font-size: 11px;
  color: var(--g-warning);
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
  color: var(--g-text-2) !important;
  font-size: 12px !important;
  font-weight: 600 !important;
  text-transform: none !important;
}

.action-btn {
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

.action-btn:hover:not(.v-btn--disabled) {
  background: color-mix(in srgb, var(--g-accent) 20%, transparent) !important;
}

.action-btn.v-btn--disabled {
  opacity: 0.35 !important;
}

/* ── Transitions ── */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity var(--g-dur-base) ease, transform var(--g-dur-base) ease;
}

.fade-slide-enter,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
