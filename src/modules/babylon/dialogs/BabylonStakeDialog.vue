<template>
  <BaseDialog
    size="sm"
    :isOpen="props.modelValue"
    :title="$t('babylon.stakeDialog.title')"
    :img="assts.coinsStacked"
    img-color="var(--g-accent)"
    :min-height="0"
    :scrollable="true"
    :loading="loading"
    :persistent="loading || !!privateKeyBytes"
    @close="closeDialog"
  >
    <v-card-text class="px-5 pt-1 pb-5 bab-stake">

      <!-- ── Step progress ── -->
      <ol class="bab-stake__steps">
        <li
          v-for="(label, i) in stepLabels"
          :key="label"
          :class="['bab-stake__step', { 'bab-stake__step--active': currentStep === i + 1, 'bab-stake__step--done': currentStep > i + 1 }]"
          :aria-current="currentStep === i + 1 ? 'step' : undefined"
        >
          <span class="bab-stake__step-bar" />
          <span class="bab-stake__step-label">{{ label }}</span>
        </li>
      </ol>

      <transition name="bab-step" mode="out-in">
        <!-- ════ Step 1: provider, amount and duration ════ -->
        <div v-if="currentStep === 1" key="step1" class="bab-stake__body">

          <div v-if="props.selectedProvider" class="glass-tier bab-provider">
            <span class="bab-provider__avatar" aria-hidden="true">{{ providerInitial }}</span>
            <span class="bab-provider__text">
              <span class="bab-provider__name">{{ props.selectedProvider.description.moniker || $t('babylon.unknownProvider') }}</span>
              <span class="t-caption">
                {{ $t('babylon.commission') }}:
                <span class="g-num" :style="{ color: commissionColor(props.selectedProvider.commission) }">
                  {{ formatCommission(props.selectedProvider.commission) }}
                </span>
              </span>
            </span>
            <span class="t-caption g-mono bab-provider__pk">{{ props.selectedProvider.btc_pk.slice(0, 8) }}…</span>
          </div>

          <label class="bab-field">
            <span class="t-label">{{ $t('babylon.stakeDialog.amount') }}</span>
            <span :class="['bab-input', { 'bab-input--error': !!amountError }]">
              <span class="bab-input__unit g-mono">BTC</span>
              <input
                v-model="amountBtc"
                class="bab-input__control bab-input__control--amount g-num"
                type="number"
                step="0.00000001"
                min="0"
                placeholder="0.00000000"
                @input="validateAmount"
              />
            </span>
            <span v-if="amountError" class="bab-field__error">{{ amountError }}</span>
            <span v-else class="t-caption g-num">
              {{ $t('babylon.minStake') }} {{ formatBtc(props.params?.min_staking_amount ?? 0) }} · {{ $t('babylon.maxStake') }} {{ formatBtc(props.params?.max_staking_amount ?? 0) }} BTC
            </span>
          </label>

          <div class="bab-stake__balance t-caption">
            <span>{{ $t('send.availableBalance') }}</span>
            <span class="g-num bab-stake__balance-value">{{ formatBtc(availableBalance) }} BTC</span>
          </div>

          <!-- Duration (timelock) -->
          <div class="bab-field">
            <span class="bab-field__head">
              <span class="t-label">{{ $t('babylon.stakeDialog.stakingDuration') }}</span>
              <span class="t-caption g-num">{{ lockDuration }}</span>
            </span>
            <v-slider
              v-model="timelockBlocks"
              :min="props.params?.min_staking_time ?? 144"
              :max="props.params?.max_staking_time ?? 64000"
              :step="144"
              color="var(--g-accent)"
              track-color="var(--g-hairline-2)"
              hide-details
              :aria-label="$t('babylon.stakeDialog.stakingDuration')"
              class="bab-slider"
            />
            <span class="bab-slider__ends t-caption g-num">
              <span>{{ formatInt(props.params?.min_staking_time) }} {{ $t('babylon.blocks') }}</span>
              <span>{{ formatInt(props.params?.max_staking_time) }} {{ $t('babylon.blocks') }}</span>
            </span>
          </div>
        </div>

        <!-- ════ Step 2: fee ════ -->
        <div v-else-if="currentStep === 2" key="step2" class="bab-stake__body">
          <div class="bab-fees" role="radiogroup" :aria-label="$t('bitcoin.feeSpeed')">
            <button
              v-for="tier in feeTiers"
              :key="tier.key"
              type="button"
              role="radio"
              :aria-checked="selectedFeePriority === tier.key ? 'true' : 'false'"
              :class="['glass-tier', 'bab-fee', { 'bab-fee--selected': selectedFeePriority === tier.key }]"
              @click="selectedFeePriority = tier.key"
            >
              <span class="bab-fee__top">
                <span class="bab-fee__name">{{ tier.label }}</span>
                <span class="bab-fee__dots" aria-hidden="true">
                  <span v-for="d in 3" :key="d" :class="['bab-fee__dot', { 'bab-fee__dot--lit': d <= tier.dots }]" />
                </span>
              </span>
              <span class="bab-fee__rate g-num">{{ $t('bitcoin.feeRateValue', { value: feeEstimates[tier.key] }) }}</span>
              <span class="t-caption">{{ tier.time }}</span>
            </button>
          </div>

          <dl class="bab-summary">
            <div class="bab-summary__row">
              <dt>{{ $t('babylon.stakeDialog.amount') }}</dt>
              <dd class="g-num">{{ formatBtc(stakingAmountSats) }} BTC</dd>
            </div>
            <div class="bab-summary__row">
              <dt>{{ $t('babylon.stakeDialog.stakingDuration') }}</dt>
              <dd class="g-num">{{ lockDuration }}</dd>
            </div>
            <div class="bab-summary__row">
              <dt>{{ $t('send.estimatedFee') }}</dt>
              <dd class="g-num">≈ {{ formatBtc(estimatedFeeSats) }} BTC</dd>
            </div>
            <div class="bab-summary__row bab-summary__row--total">
              <dt>{{ $t('babylon.stakeDialog.totalLocked') }}</dt>
              <dd class="g-num">{{ formatBtc(stakingAmountSats + estimatedFeeSats) }} BTC</dd>
            </div>
          </dl>

          <div v-if="isInsufficientBalance" class="bab-notice bab-notice--error">
            <v-icon size="small">mdi-alert-circle-outline</v-icon>
            {{ $t('send.insufficientBalance') }}
          </div>
        </div>

        <!-- ════ Step 3: review and sign ════ -->
        <div v-else-if="currentStep === 3" key="step3" class="bab-stake__body">
          <div class="glass-tier bab-review">
            <span class="t-label">{{ $t('babylon.stakeDialog.amount') }}</span>
            <span class="bab-review__amount">
              <span class="t-display g-num">{{ formatBtc(stakingAmountSats) }}</span>
              <span class="bab-review__unit g-mono">BTC</span>
            </span>
            <span class="t-caption">
              {{ $t('babylon.stakeDialog.willBeLockedFor') }}
              <span class="g-num bab-review__strong">{{ lockDuration }}</span>
            </span>

            <span class="t-label bab-review__to">{{ $t('babylon.stakeDialog.finalityProvider') }}</span>
            <span class="t-body bab-review__strong">{{ props.selectedProvider?.description.moniker || $t('babylon.unknownProvider') }}</span>

            <dl class="bab-summary bab-review__meta">
              <div class="bab-summary__row">
                <dt>{{ $t('send.estimatedFee') }}</dt>
                <dd class="g-num">{{ formatBtc(estimatedFeeSats) }} BTC</dd>
              </div>
              <div class="bab-summary__row bab-summary__row--total">
                <dt>{{ $t('babylon.stakeDialog.totalLocked') }}</dt>
                <dd class="g-num">{{ formatBtc(stakingAmountSats + estimatedFeeSats) }} BTC</dd>
              </div>
            </dl>
          </div>

          <!-- PassKey (PRF) wallet -->
          <template v-if="isPrfWallet">
            <div v-if="!privateKeyBytes" class="bab-auth">
              <span class="t-caption">{{ $t('security.passKeyAuthRequired') }}</span>
              <GButton tier="secondary" block @click="authenticateWithPassKey()">
                <v-icon size="small" start>mdi-fingerprint</v-icon>
                {{ $t('security.authenticateWithPassKey') }}
              </GButton>
            </div>
            <div v-else class="bab-notice bab-notice--success">
              <v-icon size="small">mdi-check-circle-outline</v-icon>
              <span class="bab-notice__text">{{ $t('security.passKeyAuthenticated') }}</span>
              <v-btn
                icon
                variant="text"
                size="x-small"
                :aria-label="$t('security.authenticateWithPassKey')"
                :title="$t('security.authenticateWithPassKey')"
                @click="privateKeyBytes = null"
              >
                <v-icon size="small">mdi-refresh</v-icon>
              </v-btn>
            </div>
          </template>

          <!-- Password wallet -->
          <label v-else class="bab-field">
            <span class="t-label">{{ $t('send.spendingPassword') }}</span>
            <span class="bab-input">
              <input
                v-model="password"
                class="bab-input__control"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="$t('security.enterSpendingPassword')"
                autocomplete="current-password"
                @keyup.enter="confirmStake"
              />
              <v-btn
                icon
                variant="text"
                size="small"
                :aria-label="showPassword ? $t('common.hidePassword') : $t('common.showPassword')"
                @click="showPassword = !showPassword"
              >
                <v-icon size="small">{{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
              </v-btn>
            </span>
          </label>

          <div v-if="txStatus.message" :class="['bab-notice', `bab-notice--${txStatus.type}`]" role="status">
            <v-icon size="small">{{ STATUS_ICONS[txStatus.type] }}</v-icon>
            <span class="bab-notice__text">{{ txStatus.message }}</span>
          </div>

          <a
            v-if="successTxId"
            :href="explorerUrl(successTxId)"
            target="_blank"
            rel="noopener"
            class="t-caption bab-stake__explorer"
          >
            <v-icon size="14">mdi-open-in-new</v-icon>
            {{ $t('babylon.stakeDialog.viewOnExplorer') }}
          </a>
        </div>
      </transition>

      <!-- ── Navigation ── -->
      <div class="bab-stake__nav">
        <GButton v-if="currentStep > 1 && !loading && !successTxId" tier="secondary" @click="prevStep()">
          <v-icon size="small" start>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </GButton>
        <span v-else />

        <GButton v-if="currentStep < 3 && !successTxId" tier="primary" :disabled="!isStepValid" @click="nextStep()">
          {{ $t('common.continue') }}
          <v-icon size="small" end>mdi-arrow-right</v-icon>
        </GButton>
        <GButton v-else-if="!successTxId" tier="primary" :disabled="!isStepValid" :loading="loading" @click="confirmStake()">
          <v-icon size="small" start>mdi-lock-plus-outline</v-icon>
          {{ $t('babylon.stakeDialog.stakeNow') }}
        </GButton>
        <GButton v-else tier="secondary" @click="closeDialog()">{{ $t('common.close') }}</GButton>
      </div>

    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { BabylonParamVersion, BabylonFinalityProvider } from '@/api/babylon-api';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import assts from '@/utils/assets';
import { formatBtc, formatInt } from '@/shared/utils/format';

const { t } = useTranslation();
const { loggedWallet, utxos } = toRefs(walletStore);

const props = defineProps<{
  modelValue: boolean;
  params: BabylonParamVersion | null;
  selectedProvider: BabylonFinalityProvider | null;
  btcAddress: string;
  isTestnet: boolean;
  stakerBtcPk: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'staked', txId: string): void;
}>();

const STATUS_ICONS = {
  success: 'mdi-check-circle-outline',
  error: 'mdi-alert-circle-outline',
  info: 'mdi-information-outline',
} as const;

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
  { key: 'fast' as const,   label: t('send.fast'),   time: t('bitcoin.etaMinutes', { minutes: 10 }), dots: 3 },
  { key: 'medium' as const, label: t('send.medium'), time: t('bitcoin.etaMinutes', { minutes: 30 }), dots: 2 },
  { key: 'slow' as const,   label: t('send.slow'),   time: t('bitcoin.etaMinutes', { minutes: 60 }), dots: 1 },
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

// "1,000 blocks (≈7 days)", shown on every step
const lockDuration = computed(() =>
  t('babylon.stakeDialog.lockDuration', { blocks: formatInt(timelockBlocks.value), days: timelockDays.value })
);

const providerInitial = computed(() => props.selectedProvider?.description.moniker?.charAt(0)?.toUpperCase() || '?');

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
  if (sats < min) amountError.value = t('babylon.stakeDialog.minAmount', { amount: formatBtc(min) });
  else if (sats > max) amountError.value = t('babylon.stakeDialog.maxAmount', { amount: formatBtc(max) });
}

async function updateFeeEstimate() {
  try {
    const { getBitcoinFeeEstimator, FeePriority } = await import('@/chains/bitcoin/bitcoinFeeEstimator');
    const estimator = getBitcoinFeeEstimator();
    const [fast, medium, slow] = await Promise.all([
      estimator.getFeeEstimate(FeePriority.FAST),
      estimator.getFeeEstimate(FeePriority.MEDIUM),
      estimator.getFeeEstimate(FeePriority.SLOW),
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
  emit('update:modelValue', false);
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

// Sync timelock with params when they change
watch(() => props.params, (p) => {
  if (p) timelockBlocks.value = p.min_staking_time;
}, { immediate: true });
</script>

<style scoped lang="scss">
.bab-stake {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

/* ── Step progress ──────────────────────────────────────── */
.bab-stake__steps {
  display: flex;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.bab-stake__step {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--g-text-3);
}

.bab-stake__step-bar {
  height: 3px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
  transition: background-color var(--g-dur-base) var(--g-ease);
}

.bab-stake__step-label {
  font-size: 12px;
  font-weight: 500;
  transition: color var(--g-dur-base) var(--g-ease);
}

.bab-stake__step--active .bab-stake__step-bar,
.bab-stake__step--done .bab-stake__step-bar {
  background: var(--g-accent);
}

.bab-stake__step--done .bab-stake__step-bar {
  opacity: 0.45;
}

.bab-stake__step--active .bab-stake__step-label {
  color: var(--g-accent);
}

.bab-stake__step--done .bab-stake__step-label {
  color: var(--g-text-2);
}

.bab-stake__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  min-height: 200px;
}

.bab-step-enter-active,
.bab-step-leave-active {
  transition: opacity var(--g-dur-fast) var(--g-ease);
}

.bab-step-enter-from,
.bab-step-leave-to {
  opacity: 0;
}

/* ── Provider strip ─────────────────────────────────────── */
.bab-provider {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
}

.bab-provider__avatar {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

.bab-provider__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bab-provider__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bab-provider__pk {
  flex: none;
  line-height: 1.3;
}

/* ── Fields ─────────────────────────────────────────────── */
.bab-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bab-field__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
  flex-wrap: wrap;
}

.bab-field__error {
  color: var(--g-error);
  font-size: 12px;
}

/* Inputs are controls, not surfaces: solid raised fill. The focus ring lives on the
   wrapper, so the bare input inside needs none of its own. */
.bab-input {
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

.bab-input:focus-within {
  border-color: var(--g-accent);
}

.bab-input--error,
.bab-input--error:focus-within {
  border-color: var(--g-error);
}

.bab-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font-size: 13px;
  outline: none;
}

.bab-input__control::placeholder {
  color: var(--g-text-3);
}

.bab-input__control--amount {
  font-size: 16px;
  font-weight: 600;
}

/* A number field without the browser's spin buttons */
.bab-input__control--amount::-webkit-outer-spin-button,
.bab-input__control--amount::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.bab-input__control--amount[type='number'] {
  -moz-appearance: textfield;
}

.bab-input__unit {
  color: var(--g-text-3);
  font-size: 12px;
}

.bab-stake__balance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.bab-stake__balance-value {
  color: var(--g-text-1);
}

.bab-slider__ends {
  display: flex;
  justify-content: space-between;
}

/* ── Fee tiers ──────────────────────────────────────────── */
.bab-fees {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.bab-fee {
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

.bab-fee:hover {
  @include g-glass-tier-hover;
}

.bab-fee--selected,
.bab-fee--selected:hover {
  @include g-glass-tier-active;
}

.bab-fee__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  margin-bottom: var(--g-s-1);
}

.bab-fee__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.bab-fee__dots {
  display: inline-flex;
  gap: 3px;
}

.bab-fee__dot {
  width: 5px;
  height: 5px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-3);
}

.bab-fee__dot--lit {
  background: var(--g-accent);
}

.bab-fee__rate {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

/* ── Summary ────────────────────────────────────────────── */
.bab-summary {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.bab-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.bab-summary__row dt {
  color: var(--g-text-3);
}

.bab-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.bab-summary__row--total dd {
  font-weight: 600;
}

/* ── Review ─────────────────────────────────────────────── */
.bab-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
}

.bab-review__amount {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.bab-review__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.bab-review__strong {
  color: var(--g-text-1);
}

.bab-review__to {
  margin-top: var(--g-s-3);
}

.bab-review__meta {
  margin-top: var(--g-s-3);
}

/* ── Auth and notices ───────────────────────────────────── */
.bab-auth {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.bab-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
  font-size: 13px;
}

.bab-notice .v-icon {
  color: inherit;
}

.bab-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.bab-notice--success {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.bab-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

.bab-notice--info {
  color: var(--g-info);
}

.bab-stake__explorer {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  align-self: center;
  color: var(--g-accent);
  text-decoration: none;
}

.bab-stake__explorer:hover {
  text-decoration: underline;
}

/* ── Navigation ─────────────────────────────────────────── */
.bab-stake__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
