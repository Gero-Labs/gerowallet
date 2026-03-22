<template>
  <BaseDialog
    :isOpen="props.value"
    icon="mdi-bitcoin"
    :imgSize="40"
    :title="t('send.sendBitcoin')"
    :width="500"
    :height="640"
    :minHeight="440"
    :scrollable="true"
    :loading="loading"
    :persistent="true"
    @close="closeDialog"
  >
    <v-card-text class="px-5 pt-1 pb-5">

      <!-- ── Step Progress ── -->
      <div class="step-track">
        <div
          v-for="i in 3"
          :key="i"
          class="step-bar"
          :class="{ 'is-active': currentStep === i, 'is-done': currentStep > i }"
        />
      </div>
      <div class="step-labels">
        <span v-for="(label, i) in stepLabels" :key="i"
          :class="['step-label', { 'is-active': currentStep === i + 1, 'is-done': currentStep > i + 1 }]">
          {{ label }}
        </span>
      </div>

      <!-- ════════════════════════════════════════
           STEP 1 — Recipient + Amount
      ════════════════════════════════════════ -->
      <transition name="step-fade" mode="out-in">
        <div v-if="currentStep === 1" key="step1" class="step-body">

          <!-- Recipient address -->
          <div class="field-block">
            <label class="field-label">{{ $t('send.recipientAddress') }}</label>
            <div class="glass-input-wrap" :class="{ 'is-error': !!addressError, 'is-valid': recipientAddress && !addressError }">
              <input
                v-model="recipientAddress"
                class="glass-input monospace-input"
                :placeholder="t('bitcoin.addressPlaceholder')"
                @input="validateAddress"
                autocomplete="off"
                spellcheck="false"
              />
              <button class="input-icon-btn" @click="pasteAddress" type="button" :title="t('common.paste') || 'Paste'">
                <v-icon size="15" color="rgba(255,255,255,0.5)">mdi-content-paste</v-icon>
              </button>
            </div>
            <span v-if="addressError" class="field-error-msg">{{ addressError }}</span>
          </div>

          <!-- Amount -->
          <div class="field-block mt-4">
            <label class="field-label">{{ $t('send.amount') }}</label>
            <div class="amount-wrap" :class="{ 'is-error': !!amountError }">
              <span class="btc-badge">₿</span>
              <input
                v-model="amountBtc"
                class="amount-input"
                type="number"
                step="0.00000001"
                min="0"
                placeholder="0.00000000"
                @input="validateAmount"
              />
              <button class="max-pill" @click="setMaxAmount" type="button">{{ $t('common.max') }}</button>
            </div>
            <div class="amount-meta">
              <span v-if="amountError" class="field-error-msg">{{ amountError }}</span>
              <template v-else>
                <span v-if="amountInSats > 0" class="sats-hint">
                  {{ amountInSats.toLocaleString() }} sats
                  <span v-if="btcPrice > 0" class="usd-hint">
                    ≈&nbsp;${{ (amountInSats / 1e8 * btcPrice).toLocaleString('en-US', { maximumFractionDigits: 2 }) }}
                  </span>
                </span>
              </template>
            </div>
          </div>

          <!-- Balance pill -->
          <div class="balance-strip mt-4">
            <v-icon size="12" color="#F7931A" class="mr-1">mdi-bitcoin</v-icon>
            <span class="balance-key">{{ $t('send.availableBalance') }}:</span>
            <span class="balance-val">{{ formatBtc(availableBalance) }} BTC</span>
            <span class="balance-sats">({{ Number(availableBalance).toLocaleString() }} sats)</span>
          </div>
        </div>

        <!-- ════════════════════════════════════════
             STEP 2 — Fee Selection
        ════════════════════════════════════════ -->
        <div v-else-if="currentStep === 2" key="step2" class="step-body">

          <div class="fee-tier-grid">
            <div
              v-for="tier in feeTiers"
              :key="tier.key"
              class="fee-card"
              :class="{ 'is-selected': selectedFeePriority === tier.key }"
              @click="selectedFeePriority = tier.key"
            >
              <div class="fee-card-top">
                <span class="fee-tier-name">{{ tier.label }}</span>
                <div class="speed-dots">
                  <span v-for="d in 3" :key="d" class="speed-dot" :class="{ lit: d <= tier.dots }" />
                </div>
              </div>
              <div class="fee-rate-val">{{ feeEstimates[tier.key] }}<span class="fee-rate-unit"> sat/vB</span></div>
              <div class="fee-time-hint">{{ tier.time }}</div>
              <div class="fee-cost-line">≈ {{ formatBtc(estimatedFeeSatsFor(tier.key)) }} BTC</div>
            </div>
          </div>

          <div class="tx-summary mt-5">
            <div class="summary-row">
              <span>{{ $t('send.amount') }}</span>
              <span class="mono">{{ formatBtc(amountInSats) }} BTC</span>
            </div>
            <div class="summary-row">
              <span>{{ $t('send.estimatedFee') }}</span>
              <span class="mono">{{ formatBtc(estimatedFeeSats) }} BTC <small class="muted">({{ estimatedFeeSats }} sats)</small></span>
            </div>
            <div class="summary-divider" />
            <div class="summary-row summary-total">
              <span>{{ $t('send.total') }}</span>
              <span class="mono">{{ formatBtc(totalAmount) }} BTC</span>
            </div>
          </div>

          <div v-if="totalAmount > availableBalance" class="inline-error mt-3">
            <v-icon size="14" color="#ef4444" class="mr-1">mdi-alert-circle</v-icon>
            {{ $t('send.insufficientBalance') }}
          </div>
        </div>

        <!-- ════════════════════════════════════════
             STEP 3 — Confirm + Send
        ════════════════════════════════════════ -->
        <div v-else-if="currentStep === 3" key="step3" class="step-body">

          <div class="confirm-panel">
            <!-- Amount hero -->
            <div class="confirm-amount-row">
              <span class="confirm-btc-sign">₿</span>
              <span class="confirm-amount-val">{{ formatBtc(amountInSats) }}</span>
            </div>
            <div v-if="btcPrice > 0" class="confirm-usd-equiv">
              ≈ ${{ (amountInSats / 1e8 * btcPrice).toLocaleString('en-US', { maximumFractionDigits: 2 }) }} USD
            </div>

            <div class="confirm-flow-icon">
              <v-icon size="16" color="rgba(255,255,255,0.3)">mdi-arrow-down-thin</v-icon>
            </div>

            <div class="confirm-to-label">{{ $t('send.to') }}</div>
            <div class="confirm-address mono">{{ truncateAddress(recipientAddress) }}</div>

            <div class="confirm-meta-grid mt-4">
              <div class="confirm-meta-item">
                <span class="confirm-meta-key">{{ $t('send.fee') }}</span>
                <span class="confirm-meta-val">{{ formatBtc(estimatedFeeSats) }} BTC</span>
              </div>
              <div class="confirm-meta-sep" />
              <div class="confirm-meta-item">
                <span class="confirm-meta-key">{{ $t('send.total') }}</span>
                <span class="confirm-meta-val strong">{{ formatBtc(totalAmount) }} BTC</span>
              </div>
            </div>
          </div>

          <!-- PRF (PassKey) wallet -->
          <div v-if="isPrfWallet" class="mt-4">
            <transition name="fade" mode="out-in">
              <!-- Not yet authenticated -->
              <div v-if="!privateKeyBytes" key="prf-auth" class="prf-auth-block">
                <div class="prf-hint">
                  <v-icon size="13" color="rgba(255,255,255,0.35)" class="mr-1">mdi-shield-key-outline</v-icon>
                  {{ $t('security.passKeyAuthRequired') || 'Authenticate with your PassKey to sign' }}
                </div>
                <button class="prf-auth-btn" @click="authenticateWithPassKey" type="button">
                  <v-icon size="16" class="mr-2">mdi-fingerprint</v-icon>
                  {{ $t('security.authenticateWithPassKey') || 'Authenticate with PassKey' }}
                </button>
              </div>
              <!-- Authenticated -->
              <div v-else key="prf-done" class="prf-authed-strip">
                <v-icon size="14" color="#22c55e" class="mr-2">mdi-check-circle</v-icon>
                <span>{{ $t('security.passKeyAuthenticated') || 'PassKey authenticated' }}</span>
                <button class="prf-reauth-btn" @click="privateKeyBytes = null" type="button">
                  <v-icon size="12">mdi-refresh</v-icon>
                </button>
              </div>
            </transition>
          </div>

          <!-- Normal wallet: password -->
          <div v-else-if="!isHardwareWallet" class="field-block mt-4">
            <label class="field-label">{{ $t('send.spendingPassword') }}</label>
            <div class="glass-input-wrap">
              <input
                v-model="password"
                class="glass-input"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="t('send.enterPassword') || 'Spending password'"
                @keyup.enter="confirmSend"
              />
              <button class="input-icon-btn" @click="showPassword = !showPassword" type="button">
                <v-icon size="15" color="rgba(255,255,255,0.5)">
                  {{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}
                </v-icon>
              </button>
            </div>
          </div>

          <!-- Hardware wallet -->
          <div v-else class="hw-notice mt-4">
            <v-icon size="14" color="#F7931A" class="mr-1">mdi-usb-flash-drive</v-icon>
            {{ $t('send.hardwareWalletInstructions') }}
          </div>

          <!-- Tx Status -->
          <transition name="fade">
            <div v-if="txStatus.message" class="tx-status mt-3" :class="txStatus.type">
              <v-icon size="14" class="mr-1">
                {{ txStatus.type === 'success' ? 'mdi-check-circle' : txStatus.type === 'error' ? 'mdi-alert-circle' : 'mdi-information' }}
              </v-icon>
              {{ txStatus.message }}
            </div>
          </transition>
        </div>
      </transition>

      <!-- ── Navigation ── -->
      <div class="nav-row">
        <button
          v-if="currentStep > 1 && !loading"
          class="back-btn"
          @click="prevStep"
          type="button"
        >
          <v-icon size="14" class="mr-1">mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </button>
        <div v-else />

        <button
          v-if="currentStep < 3"
          class="next-btn"
          :class="{ 'is-disabled': !isStepValid }"
          :disabled="!isStepValid"
          @click="nextStep"
          type="button"
        >
          {{ $t('common.continue') }}
          <v-icon size="14" class="ml-1">mdi-arrow-right</v-icon>
        </button>
        <button
          v-else
          class="send-btn"
          :class="{ 'is-disabled': !isStepValid || loading }"
          :disabled="!isStepValid || loading"
          @click="confirmSend"
          type="button"
        >
          <v-progress-circular v-if="loading" indeterminate :size="14" :width="2" color="white" class="mr-2" />
          <v-icon v-else size="14" class="mr-1">mdi-send</v-icon>
          {{ $t('send.send') }}
        </button>
      </div>

    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { priceStore } from '@/stores/priceStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import { calculateTxSize } from '@/chains/bitcoin/bitcoinCoinSelection';
import { FeePriority } from '@/chains/bitcoin/bitcoinFeeEstimator';

const { t } = useTranslation();
const { loggedWallet, utxos } = toRefs(walletStore);

// Props
const props = defineProps<{
  value: boolean;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'success', txId: string): void;
}>();

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
  { key: 'fast' as const,   label: t('send.fast')   || 'Fast',     time: '~10 min', dots: 3 },
  { key: 'medium' as const, label: t('send.medium') || 'Standard', time: '~30 min', dots: 2 },
  { key: 'slow' as const,   label: t('send.slow')   || 'Economy',  time: '~60 min', dots: 1 },
]);

// Transaction state
const loading = ref(false);
const txStatus = ref<{ type: 'success' | 'error' | 'info'; message: string }>({ type: 'info', message: '' });

// Validation errors
const addressError = ref('');
const amountError = ref('');

// BTC/USD price
const btcPrice = computed(() => priceStore.btcUsd?.lastPrice ?? 0);

// Available balance (from UTXOs)
const availableBalance = computed(() => {
  if (!utxos.value || utxos.value.length === 0) return BigInt(0);
  return utxos.value.reduce((sum: bigint, utxo: any) => sum + BigInt(utxo.value), BigInt(0));
});

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
  const sorted = [...utxos.value].sort((a: any, b: any) => {
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
  } catch {}
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

function formatBtc(satoshis: number | bigint): string {
  const value = typeof satoshis === 'bigint' ? Number(satoshis) : satoshis;
  return (value / 100000000).toFixed(8);
}

function truncateAddress(address: string): string {
  if (!address) return '';
  return `${address.substring(0, 14)}...${address.substring(address.length - 10)}`;
}

async function authenticateWithPassKey() {
  if (!loggedWallet.value?.webAuthnCredentialId) {
    txStatus.value = { type: 'error', message: t('security.passKeyNotConfigured') };
    return;
  }
  loading.value = true;
  try {
    const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
    const prfOutput = await evaluatePrfForWallet(
      loggedWallet.value.webAuthnCredentialId,
      loggedWallet.value.id.toString()
    );
    privateKeyBytes.value = new Uint8Array(prfOutput);
  } catch (error: any) {
    txStatus.value = { type: 'error', message: error.message || t('security.passKeyAuthFailed') };
  } finally {
    loading.value = false;
  }
}

async function confirmSend() {
  if (!isStepValid.value || loading.value) return;
  loading.value = true;
  txStatus.value = { type: 'info', message: t('send.buildingTransaction') };
  try {
    const signingData: Record<string, any> = {
      recipientAddress: recipientAddress.value,
      amount: amountInSats.value,
      feeRate: feeEstimates.value[selectedFeePriority.value],
    };

    if (isPrfWallet.value && privateKeyBytes.value) {
      signingData['privateKeyBytes'] = Array.from(privateKeyBytes.value);
    } else {
      signingData['password'] = password.value;
    }

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
  emit('input', false);
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

watch(() => props.value, (val) => { if (val) updateFeeEstimate(); });
</script>

<style scoped>
/* ── Step Progress ─────────────────────────────────────── */
.step-track {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.step-bar {
  flex: 1;
  height: 3px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.10);
  transition: background 0.3s ease;
}

.step-bar.is-active {
  background: #F7931A;
  box-shadow: 0 0 6px rgba(247, 147, 26, 0.5);
}

.step-bar.is-done {
  background: rgba(247, 147, 26, 0.45);
}

.step-labels {
  display: flex;
  margin-bottom: 20px;
}

.step-label {
  flex: 1;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.30);
  transition: color 0.3s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.step-label.is-active { color: #F7931A; }
.step-label.is-done   { color: rgba(247, 147, 26, 0.55); }

/* ── Step body transition ──────────────────────────────── */
.step-body {
  min-height: 200px;
}

.step-fade-enter-active,
.step-fade-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.step-fade-enter        { opacity: 0; transform: translateX(12px); }
.step-fade-leave-to     { opacity: 0; transform: translateX(-12px); }

/* ── Field blocks ──────────────────────────────────────── */
.field-block { display: flex; flex-direction: column; gap: 6px; }

.field-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.45);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

/* ── Glass input ───────────────────────────────────────── */
.glass-input-wrap {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 11px;
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.glass-input-wrap:focus-within {
  border-color: rgba(247, 147, 26, 0.5);
  box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.08);
}

.glass-input-wrap.is-error { border-color: rgba(239, 68, 68, 0.6); }
.glass-input-wrap.is-valid { border-color: rgba(34, 197, 94, 0.35); }

.glass-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 11px 14px;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.88);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  min-width: 0;
}

.glass-input::placeholder { color: rgba(255, 255, 255, 0.22); }

.monospace-input {
  font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', 'Courier New', monospace !important;
  font-size: 12px !important;
  letter-spacing: 0.02em;
}

.input-icon-btn {
  flex-shrink: 0;
  padding: 0 12px;
  height: 42px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  border-left: 1px solid rgba(255, 255, 255, 0.07);
  transition: background 0.15s ease;
}

.input-icon-btn:hover { background: rgba(255, 255, 255, 0.06); }

/* ── Amount input ──────────────────────────────────────── */
.amount-wrap {
  display: flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.10);
  border-radius: 11px;
  overflow: hidden;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.amount-wrap:focus-within {
  border-color: rgba(247, 147, 26, 0.5);
  box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.08);
}

.amount-wrap.is-error { border-color: rgba(239, 68, 68, 0.6); }

.btc-badge {
  padding: 0 14px;
  font-size: 18px;
  font-weight: 700;
  color: #F7931A;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  height: 48px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
}

.amount-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 0 14px;
  height: 48px;
  font-size: 22px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: -0.02em;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  min-width: 0;
}

.amount-input::placeholder { color: rgba(255, 255, 255, 0.18); }

/* hide number arrows */
.amount-input::-webkit-outer-spin-button,
.amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.amount-input[type=number] { -moz-appearance: textfield; }

.max-pill {
  margin-right: 10px;
  padding: 3px 10px;
  background: rgba(247, 147, 26, 0.15);
  border: 1px solid rgba(247, 147, 26, 0.3);
  border-radius: 20px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: #F7931A;
  cursor: pointer;
  transition: background 0.15s ease;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  flex-shrink: 0;
}

.max-pill:hover { background: rgba(247, 147, 26, 0.25); }

.amount-meta {
  min-height: 18px;
  margin-top: 4px;
}

.sats-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.usd-hint {
  margin-left: 8px;
  font-size: 11px;
  color: rgba(247, 147, 26, 0.75);
}

/* ── Balance strip ─────────────────────────────────────── */
.balance-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 12px;
  background: rgba(247, 147, 26, 0.06);
  border: 1px solid rgba(247, 147, 26, 0.14);
  border-radius: 9px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.balance-key { font-size: 11px; color: rgba(255, 255, 255, 0.45); }
.balance-val { font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.82); margin-left: 2px; }
.balance-sats { font-size: 10px; color: rgba(255, 255, 255, 0.30); }

/* ── Errors ────────────────────────────────────────────── */
.field-error-msg {
  font-size: 11px;
  color: #f87171;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

/* ── Fee tier cards ────────────────────────────────────── */
.fee-tier-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.fee-card {
  position: relative;
  padding: 14px 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 13px;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.fee-card:hover {
  background: rgba(255, 255, 255, 0.07);
  transform: translateY(-1px);
}

.fee-card.is-selected {
  background: rgba(247, 147, 26, 0.08);
  border-color: rgba(247, 147, 26, 0.45);
  box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.07), inset 0 1px 0 rgba(247, 147, 26, 0.15);
}

.fee-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.fee-tier-name {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.60);
}

.fee-card.is-selected .fee-tier-name { color: #F7931A; }

.speed-dots { display: flex; gap: 3px; align-items: center; }

.speed-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  transition: background 0.2s ease;
}

.speed-dot.lit { background: rgba(255, 255, 255, 0.45); }
.fee-card.is-selected .speed-dot.lit { background: #F7931A; }

.fee-rate-val {
  font-size: 18px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
  letter-spacing: -0.02em;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
}

.fee-rate-unit { font-size: 10px; font-weight: 400; color: rgba(255, 255, 255, 0.35); }

.fee-time-hint {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.35);
  margin-top: 3px;
}

.fee-cost-line {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 6px;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

/* ── Transaction summary ───────────────────────────────── */
.tx-summary {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 11px;
  padding: 14px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  padding: 4px 0;
}

.summary-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
  margin: 6px 0;
}

.summary-total {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.88);
}

.summary-total .mono { color: #F7931A; }

.mono { font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; }
.muted { color: rgba(255, 255, 255, 0.35); }

.inline-error {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: #f87171;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

/* ── Confirm panel ─────────────────────────────────────── */
.confirm-panel {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 20px 20px 16px;
  text-align: center;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
}

.confirm-amount-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  line-height: 1;
}

.confirm-btc-sign {
  font-size: 24px;
  font-weight: 700;
  color: #F7931A;
}

.confirm-amount-val {
  font-size: 32px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.confirm-usd-equiv {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.42);
  margin-top: 4px;
}

.confirm-flow-icon {
  margin: 10px auto 6px;
  opacity: 0.5;
}

.confirm-to-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.30);
  margin-bottom: 4px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.confirm-address {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  word-break: break-all;
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.confirm-meta-grid {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  padding: 10px 0 0;
}

.confirm-meta-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.confirm-meta-sep {
  width: 1px;
  height: 28px;
  background: rgba(255, 255, 255, 0.08);
}

.confirm-meta-key {
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.30);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.confirm-meta-val {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
  font-family: 'SF Mono', 'Fira Code', monospace;
}

.confirm-meta-val.strong {
  color: rgba(255, 255, 255, 0.88);
  font-weight: 600;
}

/* ── PRF (PassKey) auth ────────────────────────────────── */
.prf-auth-block {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.prf-hint {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.40);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.prf-authed-strip {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: rgba(34, 197, 94, 0.07);
  border: 1px solid rgba(34, 197, 94, 0.22);
  border-radius: 10px;
  font-size: 12px;
  color: #86efac;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  gap: 4px;
}

.prf-reauth-btn {
  margin-left: auto;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  cursor: pointer;
  color: rgba(255, 255, 255, 0.40);
  transition: color 0.15s ease, border-color 0.15s ease;
  display: flex;
  align-items: center;
}

.prf-reauth-btn:hover {
  color: rgba(255, 255, 255, 0.70);
  border-color: rgba(255, 255, 255, 0.25);
}

.prf-auth-btn {
  width: 100%;
  padding: 11px 16px;
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.30);
  border-radius: 10px;
  cursor: pointer;
  color: #F7931A;
  font-size: 13px;
  font-weight: 500;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.prf-auth-btn:hover {
  background: rgba(247, 147, 26, 0.20);
  border-color: rgba(247, 147, 26, 0.50);
}

/* ── Hardware wallet notice ────────────────────────────── */
.hw-notice {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: rgba(247, 147, 26, 0.06);
  border: 1px solid rgba(247, 147, 26, 0.18);
  border-radius: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.60);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

/* ── Transaction status ────────────────────────────────── */
.tx-status {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 12px;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.tx-status.success {
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.25);
  color: #86efac;
}

.tx-status.error {
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}

.tx-status.info {
  background: rgba(96, 165, 250, 0.08);
  border: 1px solid rgba(96, 165, 250, 0.20);
  color: #93c5fd;
}

/* ── Navigation row ────────────────────────────────────── */
.nav-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 20px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
}

.back-btn:hover {
  border-color: rgba(255, 255, 255, 0.25);
  color: rgba(255, 255, 255, 0.80);
  background: rgba(255, 255, 255, 0.05);
}

.next-btn,
.send-btn {
  display: inline-flex;
  align-items: center;
  padding: 9px 22px;
  background: linear-gradient(135deg, #F7931A, #e8820e);
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
  box-shadow: 0 2px 12px rgba(247, 147, 26, 0.30);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif;
  letter-spacing: -0.01em;
}

.next-btn:hover:not(:disabled),
.send-btn:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
  box-shadow: 0 4px 18px rgba(247, 147, 26, 0.40);
}

.next-btn.is-disabled,
.send-btn.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* ── Fade transition ───────────────────────────────────── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter, .fade-leave-to { opacity: 0; }
</style>
