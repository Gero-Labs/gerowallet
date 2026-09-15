<template>
  <BaseDialog
    :isOpen="props.value"
    icon="mdi-lock-clock"
    :imgSize="40"
    :title="$t('babylon.stakeDialog.title')"
    :width="500"
    :height="660"
    :minHeight="480"
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
        <span
          v-for="(label, i) in stepLabels"
          :key="i"
          :class="['step-label', { 'is-active': currentStep === i + 1, 'is-done': currentStep > i + 1 }]"
        >{{ label }}</span>
      </div>

      <!-- ════════════════════════════════════════
           STEP 1 — Provider + Amount + Duration
      ════════════════════════════════════════ -->
      <transition name="step-fade" mode="out-in">
        <div v-if="currentStep === 1" key="step1" class="step-body">

          <!-- Provider info card -->
          <div v-if="props.selectedProvider" class="provider-strip">
            <div class="provider-avatar" :style="{ background: providerColorBg(props.selectedProvider.description.moniker) }">
              <span class="provider-initial" :style="{ color: providerColor(props.selectedProvider.description.moniker) }">
                {{ props.selectedProvider.description.moniker?.charAt(0)?.toUpperCase() || '?' }}
              </span>
            </div>
            <div class="provider-details">
              <div class="provider-name">{{ props.selectedProvider.description.moniker || $t('babylon.unknownProvider') }}</div>
              <div class="provider-commission">
                {{ $t('babylon.commission') }}:
                <span :style="{ color: commissionColor(props.selectedProvider.commission) }">
                  {{ formatCommission(props.selectedProvider.commission) }}
                </span>
              </div>
            </div>
            <div class="provider-pk-badge">{{ props.selectedProvider.btc_pk.slice(0, 8) }}…</div>
          </div>

          <!-- Amount -->
          <div class="field-block mt-4">
            <label class="field-label">{{ $t('babylon.stakeDialog.amount') }}</label>
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
            </div>
            <div class="amount-meta">
              <span v-if="amountError" class="field-error-msg">{{ amountError }}</span>
              <span v-else class="field-hint">
                Min: {{ formatBtc(props.params?.min_staking_amount ?? 0) }} —
                Max: {{ formatBtc(props.params?.max_staking_amount ?? 0) }} BTC
              </span>
            </div>
          </div>

          <!-- Balance pill -->
          <div class="balance-strip mt-3">
            <v-icon size="12" color="#F7931A" class="mr-1">mdi-bitcoin</v-icon>
            <span class="balance-key">{{ $t('send.availableBalance') }}:</span>
            <span class="balance-val">{{ formatBtc(Number(availableBalance)) }} BTC</span>
          </div>

          <!-- Duration (timelock) slider -->
          <div class="field-block mt-4">
            <label class="field-label">
              {{ $t('babylon.stakeDialog.stakingDuration') }}
              <span class="ml-1" style="opacity: 0.4; font-size: 11px;">
                ({{ timelockBlocks.toLocaleString() }} blocks · ≈ {{ timelockDays }} days)
              </span>
            </label>
            <v-slider
              v-model="timelockBlocks"
              :min="props.params?.min_staking_time ?? 144"
              :max="props.params?.max_staking_time ?? 64000"
              :step="144"
              color="#F7931A"
              track-color="var(--g-hairline-2)"
              hide-details
              class="babylon-slider mt-2"
            />
            <div class="slider-endpoints">
              <span>{{ props.params?.min_staking_time?.toLocaleString() ?? '—' }} blk</span>
              <span>{{ props.params?.max_staking_time?.toLocaleString() ?? '—' }} blk</span>
            </div>
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
            </div>
          </div>

          <!-- Staking summary -->
          <div class="tx-summary mt-5">
            <div class="summary-row">
              <span>{{ $t('babylon.stakeDialog.amount') }}</span>
              <span class="mono">{{ amountBtc }} BTC</span>
            </div>
            <div class="summary-row">
              <span>{{ $t('babylon.stakeDialog.stakingDuration') }}</span>
              <span class="mono">{{ timelockBlocks.toLocaleString() }} blocks (≈{{ timelockDays }} days)</span>
            </div>
            <div class="summary-row">
              <span>{{ $t('send.estimatedFee') }}</span>
              <span class="mono">~{{ formatBtc(estimatedFeeSats) }} BTC</span>
            </div>
            <div class="summary-divider" />
            <div class="summary-row summary-total">
              <span>{{ $t('babylon.stakeDialog.totalLocked') }}</span>
              <span class="mono">{{ formatBtc(stakingAmountSats + estimatedFeeSats) }} BTC</span>
            </div>
          </div>

          <div v-if="isInsufficientBalance" class="inline-error mt-3">
            <v-icon size="14" color="error" class="mr-1">mdi-alert-circle</v-icon>
            {{ $t('send.insufficientBalance') }}
          </div>

        </div>

        <!-- ════════════════════════════════════════
             STEP 3 — Confirm + Sign
        ════════════════════════════════════════ -->
        <div v-else-if="currentStep === 3" key="step3" class="step-body">

          <!-- Confirm panel -->
          <div class="confirm-panel">
            <div class="confirm-amount-row">
              <span class="confirm-btc-sign">₿</span>
              <span class="confirm-amount-val">{{ amountBtc }}</span>
            </div>
            <div class="confirm-label mt-1">{{ $t('babylon.stakeDialog.willBeLockedFor') }}</div>
            <div class="confirm-timelock">{{ timelockBlocks.toLocaleString() }} blocks (≈{{ timelockDays }} days)</div>

            <div class="confirm-flow-icon">
              <v-icon size="16" color="var(--g-text-3)">mdi-arrow-down-thin</v-icon>
            </div>

            <div class="confirm-to-label">{{ $t('babylon.stakeDialog.finalityProvider') }}</div>
            <div class="confirm-provider-name">{{ props.selectedProvider?.description.moniker || $t('babylon.unknownProvider') }}</div>

            <div class="confirm-meta-grid mt-4">
              <div class="confirm-meta-item">
                <span class="confirm-meta-key">{{ $t('send.estimatedFee') }}</span>
                <span class="confirm-meta-val">{{ formatBtc(estimatedFeeSats) }} BTC</span>
              </div>
              <div class="confirm-meta-sep" />
              <div class="confirm-meta-item">
                <span class="confirm-meta-key">{{ $t('babylon.stakeDialog.totalLocked') }}</span>
                <span class="confirm-meta-val strong">{{ formatBtc(stakingAmountSats + estimatedFeeSats) }} BTC</span>
              </div>
            </div>
          </div>

          <!-- PRF (PassKey) wallet -->
          <div v-if="isPrfWallet" class="mt-4">
            <transition name="fade" mode="out-in">
              <div v-if="!privateKeyBytes" key="prf-auth" class="prf-auth-block">
                <div class="prf-hint">
                  <v-icon size="13" color="var(--g-text-3)" class="mr-1">mdi-shield-key-outline</v-icon>
                  {{ $t('security.passKeyAuthRequired') }}
                </div>
                <button class="prf-auth-btn" @click="authenticateWithPassKey" type="button">
                  <v-icon size="16" class="mr-2">mdi-fingerprint</v-icon>
                  {{ $t('security.authenticateWithPassKey') }}
                </button>
              </div>
              <div v-else key="prf-done" class="prf-authed-strip">
                <v-icon size="14" color="success" class="mr-2">mdi-check-circle</v-icon>
                <span>{{ $t('security.passKeyAuthenticated') }}</span>
                <button class="prf-reauth-btn" @click="privateKeyBytes = null" type="button">
                  <v-icon size="12">mdi-refresh</v-icon>
                </button>
              </div>
            </transition>
          </div>

          <!-- Normal wallet: password -->
          <div v-else class="field-block mt-4">
            <label class="field-label">{{ $t('send.spendingPassword') }}</label>
            <div class="glass-input-wrap">
              <input
                v-model="password"
                class="glass-input"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="$t('send.enterPassword')"
                @keyup.enter="confirmStake"
              />
              <button class="input-icon-btn" @click="showPassword = !showPassword" type="button">
                <v-icon size="15" color="var(--g-text-3)">
                  {{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}
                </v-icon>
              </button>
            </div>
          </div>

          <!-- Transaction Status -->
          <transition name="fade">
            <div v-if="txStatus.message" class="tx-status mt-3" :class="txStatus.type">
              <v-icon size="14" class="mr-1">
                {{ txStatus.type === 'success' ? 'mdi-check-circle' : txStatus.type === 'error' ? 'mdi-alert-circle' : 'mdi-information' }}
              </v-icon>
              {{ txStatus.message }}
            </div>
          </transition>

          <!-- Success: show explorer link -->
          <div v-if="successTxId" class="mt-2 text-center">
            <a
              :href="explorerUrl(successTxId)"
              target="_blank"
              class="explorer-link"
              @click.stop
            >
              <v-icon x-small class="mr-1">mdi-open-in-new</v-icon>
              {{ $t('babylon.stakeDialog.viewOnExplorer') }}
            </a>
          </div>
        </div>
      </transition>

      <!-- ── Navigation ── -->
      <div class="nav-row">
        <button
          v-if="currentStep > 1 && !loading && !successTxId"
          class="back-btn"
          @click="prevStep"
          type="button"
        >
          <v-icon size="14" class="mr-1">mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </button>
        <div v-else />

        <button
          v-if="currentStep < 3 && !successTxId"
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
          v-else-if="!successTxId"
          class="stake-btn"
          :class="{ 'is-disabled': !isStepValid || loading }"
          :disabled="!isStepValid || loading"
          @click="confirmStake"
          type="button"
        >
          <v-progress-circular v-if="loading" indeterminate :size="14" :width="2" color="var(--g-text-1)" class="mr-2" />
          <v-icon v-else size="14" class="mr-1">mdi-lock-plus-outline</v-icon>
          {{ $t('babylon.stakeDialog.stakeNow') }}
        </button>
        <button v-else class="next-btn" @click="closeDialog" type="button">
          {{ $t('common.close') }}
        </button>
      </div>

    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { BabylonParamVersion, BabylonFinalityProvider } from '@/api/babylon-api';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';

const { t } = useTranslation();
const { loggedWallet, utxos } = toRefs(walletStore);

const props = defineProps<{
  value: boolean;
  params: BabylonParamVersion | null;
  selectedProvider: BabylonFinalityProvider | null;
  btcAddress: string;
  isTestnet: boolean;
  stakerBtcPk: string;
}>();

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'staked', txId: string): void;
}>();

// Step state
const currentStep = ref(1);
const stepLabels = computed(() => [
  t('babylon.stakeDialog.stepProvider'),
  t('babylon.stakeDialog.stepFee'),
  t('babylon.stakeDialog.stepConfirm'),
]);

// Form data
const amountBtc = ref('');
const timelockBlocks = ref(1000);
const password = ref('');
const showPassword = ref(false);
const privateKeyBytes = ref<Uint8Array | null>(null);

// Fee
const selectedFeePriority = ref<'fast' | 'medium' | 'slow'>('medium');
const feeEstimates = ref({ fast: 50, medium: 25, slow: 10 });

const feeTiers = computed(() => [
  { key: 'fast' as const,   label: t('send.fast'),   time: '~10 min', dots: 3 },
  { key: 'medium' as const, label: t('send.medium'), time: '~30 min', dots: 2 },
  { key: 'slow' as const,   label: t('send.slow'),   time: '~60 min', dots: 1 },
]);

// Transaction state
const loading = ref(false);
const txStatus = ref<{ type: 'success' | 'error' | 'info'; message: string }>({ type: 'info', message: '' });
const successTxId = ref('');
const amountError = ref('');

// Derived
const availableBalance = computed(() => {
  if (!utxos.value || utxos.value.length === 0) return BigInt(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walletStore.utxos is a chain-agnostic union (bigint | IUnifiedUtxo | Utxo); annotating a shape here type-errors rather than describes it
  return utxos.value.reduce((sum: bigint, u: any) => sum + BigInt(u.value), BigInt(0));
});

const stakingAmountSats = computed(() => {
  const n = parseFloat(amountBtc.value);
  return isNaN(n) || n <= 0 ? 0 : Math.round(n * 1e8);
});

const estimatedFeeSats = computed(() => 250 * feeEstimates.value[selectedFeePriority.value]);

const timelockDays = computed(() => Math.round((timelockBlocks.value * 10) / 60 / 24));

const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf' ||
  (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId)
);

const isInsufficientBalance = computed(() =>
  BigInt(stakingAmountSats.value + estimatedFeeSats.value) > availableBalance.value
);

// Step validation
const isStepValid = computed(() => {
  switch (currentStep.value) {
    case 1: {
      if (!props.selectedProvider) return false;
      if (!amountBtc.value || amountError.value) return false;
      const sats = stakingAmountSats.value;
      const min = props.params?.min_staking_amount ?? 0;
      const max = props.params?.max_staking_amount ?? Infinity;
      return sats >= min && sats <= max;
    }
    case 2:
      return !isInsufficientBalance.value;
    case 3:
      if (isPrfWallet.value) return !!privateKeyBytes.value;
      return !!password.value;
    default:
      return false;
  }
});

function validateAmount() {
  amountError.value = '';
  const n = parseFloat(amountBtc.value);
  if (isNaN(n) || n <= 0) { amountError.value = t('send.invalidAmount'); return; }
  const sats = Math.round(n * 1e8);
  const min = props.params?.min_staking_amount ?? 0;
  const max = props.params?.max_staking_amount ?? Infinity;
  if (sats < min) amountError.value = `Min ${formatBtc(min)} BTC`;
  else if (sats > max) amountError.value = `Max ${formatBtc(max)} BTC`;
}

async function updateFeeEstimate() {
  try {
    const { getBitcoinFeeEstimator } = await import('@/chains/bitcoin/bitcoinFeeEstimator');
    const estimator = getBitcoinFeeEstimator();
    const [fast, medium, slow] = await Promise.all([
      estimator.getFeeEstimate('fast'),
      estimator.getFeeEstimate('medium'),
      estimator.getFeeEstimate('slow'),
    ]);
    feeEstimates.value = { fast: fast.feeRate, medium: medium.feeRate, slow: slow.feeRate };
  } catch { /* fallback to defaults */ }
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
  if (!loggedWallet.value?.webAuthnCredentialId) return;
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

async function confirmStake() {
  if (!isStepValid.value || loading.value) return;
  if (!props.selectedProvider || !props.params) return;

  loading.value = true;
  txStatus.value = { type: 'info', message: t('send.buildingTransaction') };

  try {
    // Build the Babylon staking PSBT in the frontend.
    // This keeps @babylonlabs-io/btc-staking-ts out of the background bundle.
    const { buildBabylonStakingPsbt } = await import('@/chains/bitcoin/babylonStakingBuilder');
    const { psbtHex } = await buildBabylonStakingPsbt({
      stakerPkHex: props.stakerBtcPk,
      stakerAddress: props.btcAddress,
      finalityProviderPkHex: props.selectedProvider.btc_pk,
      stakingTimelock: timelockBlocks.value,
      stakingAmountSat: stakingAmountSats.value,
      feeRate: feeEstimates.value[selectedFeePriority.value],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walletStore.utxos is a chain-agnostic union (bigint | IUnifiedUtxo | Utxo); annotating a shape here type-errors rather than describes it
      utxos: (utxos.value || []) as any,
      params: props.params,
      network: loggedWallet.value?.network || 'Mainnet',
    });

    // Send pre-built PSBT to background for signing + broadcast only.
    const payload: Record<string, unknown> = { psbtHex };

    if (isPrfWallet.value && privateKeyBytes.value) {
      payload['privateKeyBytes'] = Array.from(privateKeyBytes.value);
    } else {
      payload['password'] = password.value;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sendToBackgroundFromOptions resolves an untyped messaging envelope
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.BABYLON_STAKE,
      data: payload,
    });

    if (!response.data.success) {
      throw new Error(response.data.error || t('send.transactionFailed'));
    }

    successTxId.value = response.data.txId;
    txStatus.value = {
      type: 'success',
      message: `${t('babylon.stakeDialog.stakeSuccess')} ${response.data.txId.slice(0, 16)}…`,
    };
    emit('staked', response.data.txId);
  } catch (error: unknown) {
    const message = (error as { message?: string })?.message;
    txStatus.value = { type: 'error', message: message || t('send.transactionFailed') };
  } finally {
    loading.value = false;
  }
}

function explorerUrl(txId: string): string {
  return props.isTestnet
    ? `https://mempool.space/testnet/tx/${txId}`
    : `https://mempool.space/tx/${txId}`;
}

function closeDialog() {
  emit('input', false);
  currentStep.value = 1;
  amountBtc.value = '';
  password.value = '';
  showPassword.value = false;
  privateKeyBytes.value = null;
  selectedFeePriority.value = 'medium';
  txStatus.value = { type: 'info', message: '' };
  amountError.value = '';
  successTxId.value = '';
}

// Helpers
function formatBtc(sats: number): string {
  return (sats / 1e8).toFixed(8);
}

function formatCommission(commission: string): string {
  return `${(parseFloat(commission) * 100).toFixed(1)}%`;
}

function commissionColor(commission: string): string {
  const pct = parseFloat(commission) * 100;
  if (pct <= 5) return 'var(--g-success)';
  if (pct < 10) return 'inherit';
  if (pct === 10) return 'var(--g-warning)';
  return 'var(--g-error)';
}

const PROVIDER_COLORS = ['#F7931A', '#1e88e5', '#43a047', '#e53935', '#00acc1', '#8e24aa', '#f4511e'];
function providerColor(name: string | undefined): string {
  if (!name) return PROVIDER_COLORS[0];
  return PROVIDER_COLORS[name.charCodeAt(0) % PROVIDER_COLORS.length];
}
function providerColorBg(name: string | undefined): string {
  return providerColor(name) + '18';
}

// Sync timelock with params when they change
watch(() => props.params, (p) => {
  if (p) timelockBlocks.value = p.min_staking_time;
}, { immediate: true });
</script>

<style scoped>
/* ── Step Progress ── */
.step-track {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.step-bar {
  flex: 1;
  height: 3px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
  transition: background 0.3s ease;
}

.step-bar.is-active {
  background: #F7931A;
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
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--g-text-3);
  transition: color 0.3s ease;
}

.step-label.is-active { color: #F7931A; }
.step-label.is-done   { color: rgba(247, 147, 26, 0.55); }

.step-body { min-height: 200px; }

.step-fade-enter-active,
.step-fade-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.step-fade-enter        { opacity: 0; transform: translateX(12px); }
.step-fade-leave-to     { opacity: 0; transform: translateX(-12px); }

/* ── Provider strip ── */
.provider-strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: rgba(247, 147, 26, 0.06);
  border: 1px solid rgba(247, 147, 26, 0.18);
  border-radius: var(--g-r-card);
}

.provider-avatar {
  width: 36px; height: 36px;
  border-radius: var(--g-r-control);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.provider-initial {
  font-size: 14px;
  font-weight: 800;
}

.provider-details { flex: 1; min-width: 0; }

.provider-name {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.provider-commission { font-size: 11px; opacity: 0.55; margin-top: 2px; }

.provider-pk-badge {
  font-family: var(--g-font-mono);
  font-size: 11px;
  opacity: 0.3;
  flex-shrink: 0;
}

/* ── Fields ── */
.field-block { display: flex; flex-direction: column; gap: 6px; }

.field-label {
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--g-text-3);
}

.field-hint {
  font-size: 11px;
  color: var(--g-text-3);
}

.field-error-msg { font-size: 11px; color: var(--g-error); }

/* ── Amount input ── */
.amount-wrap {
  display: flex;
  align-items: center;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.amount-wrap:focus-within {
  border-color: rgba(247, 147, 26, 0.5);
  box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.08);
}

.amount-wrap.is-error { border-color: var(--g-error); }

.btc-badge {
  padding: 0 14px;
  font-size: 16px;
  font-weight: 700;
  color: #F7931A;
  border-right: 1px solid var(--g-hairline-1);
  height: 48px;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.amount-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 0 14px;
  height: 48px;
  font-size: 20px;
  font-weight: 300;
  color: var(--g-text-1);
  letter-spacing: -0.02em;
  min-width: 0;
}

.amount-input::placeholder { color: var(--g-text-3); }
.amount-input::-webkit-outer-spin-button,
.amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.amount-input[type=number] { -moz-appearance: textfield; }

.amount-meta { min-height: 16px; margin-top: 4px; }

/* ── Balance strip ── */
.balance-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 7px 12px;
  background: rgba(247, 147, 26, 0.06);
  border: 1px solid rgba(247, 147, 26, 0.14);
  border-radius: var(--g-r-control);
}

.balance-key { font-size: 11px; color: var(--g-text-3); }
.balance-val { font-size: 12px; font-weight: 600; color: var(--g-text-2); margin-left: 2px; }

/* ── Slider ── */
.babylon-slider :deep(.v-slider__thumb) {
  background: #F7931A !important;
  border-color: #F7931A !important;
}

.babylon-slider :deep(.v-slider__track-fill) {
  background: rgba(247, 147, 26, 0.7) !important;
}

.slider-endpoints {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.3;
  margin-top: 2px;
  letter-spacing: 0.04em;
}

/* ── Fee tier cards ── */
.fee-tier-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}

.fee-card {
  padding: 14px 12px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
}

.fee-card:hover {
  background: var(--g-overlay);
  transform: translateY(-1px);
}

.fee-card.is-selected {
  background: rgba(247, 147, 26, 0.08);
  border-color: rgba(247, 147, 26, 0.45);
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
  color: var(--g-text-2);
}

.fee-card.is-selected .fee-tier-name { color: #F7931A; }

.speed-dots { display: flex; gap: 3px; }
.speed-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--g-hairline-3); }
.speed-dot.lit { background: var(--g-text-3); }
.fee-card.is-selected .speed-dot.lit { background: #F7931A; }

.fee-rate-val {
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text-1);
  letter-spacing: -0.02em;
  line-height: 1;
}

.fee-rate-unit { font-size: 11px; font-weight: 400; color: var(--g-text-3); }

.fee-time-hint {
  font-size: 11px;
  color: var(--g-text-3);
  margin-top: 3px;
}

/* ── Summary ── */
.tx-summary {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 14px 16px;
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--g-text-3);
  padding: 4px 0;
}

.summary-divider { height: 1px; background: var(--g-hairline-1); margin: 6px 0; }

.summary-total {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.summary-total .mono { color: #F7931A; }
.mono { font-family: var(--g-font-mono); }

.inline-error {
  display: flex;
  align-items: center;
  font-size: 12px;
  color: var(--g-error);
}

/* ── Confirm panel ── */
.confirm-panel {
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 20px 20px 16px;
  text-align: center;
}

.confirm-amount-row {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 6px;
  line-height: 1;
}

.confirm-btc-sign { font-size: 24px; font-weight: 700; color: #F7931A; }

.confirm-amount-val {
  font-size: 32px;
  font-weight: 300;
  color: var(--g-text-1);
  letter-spacing: -0.04em;
  font-variant-numeric: tabular-nums;
  font-family: var(--g-font-mono);
}

.confirm-label { font-size: 11px; color: var(--g-text-3); }
.confirm-timelock { font-size: 13px; font-weight: 600; color: #F7931A; margin-top: 2px; }

.confirm-flow-icon { margin: 10px auto 6px; opacity: 0.5; }

.confirm-to-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--g-text-3);
  margin-bottom: 4px;
}

.confirm-provider-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-2);
}

.confirm-meta-grid {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 0 0;
}

.confirm-meta-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
.confirm-meta-sep { width: 1px; height: 28px; background: var(--g-hairline-1); }

.confirm-meta-key {
  font-size: 11px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--g-text-3);
}

.confirm-meta-val { font-size: 12px; color: var(--g-text-2); font-family: var(--g-font-mono); }
.confirm-meta-val.strong { color: var(--g-text-1); font-weight: 600; }

/* ── PRF auth ── */
.prf-auth-block { display: flex; flex-direction: column; gap: 10px; }

.prf-hint {
  display: flex;
  align-items: center;
  font-size: 11px;
  color: var(--g-text-3);
}

.prf-authed-strip {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-control);
  font-size: 12px;
  color: var(--g-success);
  gap: 4px;
}

.prf-reauth-btn {
  margin-left: auto;
  padding: 2px 6px;
  background: transparent;
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  cursor: pointer;
  color: var(--g-text-3);
  display: flex;
  align-items: center;
}

.prf-auth-btn {
  width: 100%;
  padding: 11px 16px;
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.30);
  border-radius: var(--g-r-control);
  cursor: pointer;
  color: #F7931A;
  font-size: 13px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease;
}

.prf-auth-btn:hover { background: rgba(247, 147, 26, 0.20); }

/* ── Password field ── */
.glass-input-wrap {
  display: flex;
  align-items: center;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  overflow: hidden;
  transition: border-color 0.2s ease;
}

.glass-input-wrap:focus-within {
  border-color: rgba(247, 147, 26, 0.5);
  box-shadow: 0 0 0 3px rgba(247, 147, 26, 0.08);
}

.glass-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  padding: 11px 14px;
  font-size: 13px;
  color: var(--g-text-1);
  min-width: 0;
}

.glass-input::placeholder { color: var(--g-text-3); }

.input-icon-btn {
  flex-shrink: 0;
  padding: 0 12px;
  height: 42px;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  border-left: 1px solid var(--g-hairline-1);
}

.input-icon-btn:hover { background: var(--g-overlay); }

/* ── Tx status ── */
.tx-status {
  display: flex;
  align-items: center;
  padding: 10px 14px;
  border-radius: var(--g-r-control);
  font-size: 12px;
}

.tx-status.success { background: var(--g-success-fill); border: 1px solid var(--g-success-line); color: var(--g-success); }
.tx-status.error   { background: var(--g-error-fill); border: 1px solid var(--g-error-line); color: var(--g-error); }
.tx-status.info    { background: rgba(122, 167, 255, 0.12); border: 1px solid rgba(122, 167, 255, 0.25); color: var(--g-info); }

/* ── Explorer link ── */
.explorer-link {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  color: #F7931A;
  opacity: 0.75;
  text-decoration: none;
  transition: opacity 0.15s;
}

.explorer-link:hover { opacity: 1; text-decoration: underline; }

/* ── Navigation ── */
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
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-3);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease;
}

.back-btn:hover {
  border-color: var(--g-hairline-3);
  color: var(--g-text-2);
}

.next-btn,
.stake-btn {
  display: inline-flex;
  align-items: center;
  padding: 9px 22px;
  background: linear-gradient(135deg, #F7931A, #e8820e);
  border: none;
  border-radius: var(--g-r-pill);
  font-size: 13px;
  font-weight: 600;
  color: var(--g-on-grad);
  cursor: pointer;
  transition: opacity 0.2s ease, transform 0.15s ease;
}

.next-btn:hover:not(:disabled),
.stake-btn:hover:not(:disabled) {
  opacity: 0.92;
  transform: translateY(-1px);
}

.next-btn.is-disabled,
.stake-btn.is-disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

/* ── Transitions ── */
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter, .fade-leave-to { opacity: 0; }
</style>