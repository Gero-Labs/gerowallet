<template>
  <div class="sol-stake">
    <!-- Done: what happens next and where to follow it -->
    <div v-if="sentSignature" class="sol-stake__body" data-test="stake-done">
      <div class="sol-notice sol-notice--success" role="status">
        <v-icon size="small">mdi-check-circle-outline</v-icon>
        <span class="sol-notice__text">{{ $t(`solana.staking.done.${props.action}`) }}</span>
      </div>
      <a v-if="sentUrl" :href="sentUrl" target="_blank" rel="noopener noreferrer" class="sol-link">
        {{ $t('solana.viewOnExplorer') }}
        <v-icon size="x-small">mdi-open-in-new</v-icon>
      </a>
      <div class="sol-stake__nav">
        <span />
        <GButton tier="primary" @click="emit('close')">{{ $t('common.close') }}</GButton>
      </div>
    </div>

    <template v-else>
      <!-- Step 1: what to do -->
      <div v-if="step === 1" class="sol-stake__body">
        <template v-if="props.action === 'stake'">
          <div class="sol-field">
            <span class="t-label">{{ $t('solana.staking.validator') }}</span>
            <v-autocomplete
              v-model="voteAccount"
              :items="validatorItems"
              item-title="title"
              item-value="value"
              :placeholder="t('solana.staking.validatorPlaceholder')"
              :custom-filter="filterValidator"
              :loading="!props.validators && !props.validatorsFailed"
              variant="outlined"
              density="compact"
              hide-details
              attach
              data-test="stake-validator"
            />
            <span v-if="props.validatorsFailed && !props.validators" class="sol-field__error">{{ $t('solana.staking.validatorsUnavailable') }}</span>
          </div>
          <div v-if="validator" class="glass-tier sol-validator" data-test="stake-validator-detail">
            <span class="sol-validator__name">{{ validatorLabel(validator) }}</span>
            <span class="t-caption">{{ $t('solana.staking.voteAccount') }}</span>
            <span class="g-mono sol-review__address">{{ validator.votePubkey }}</span>
            <span class="t-caption">{{ $t('solana.staking.commission', { percent: validator.commission }) }}</span>
          </div>
          <div v-if="validator && validator.commission > HIGH_COMMISSION" class="sol-notice sol-notice--warning" role="status" data-test="stake-high-commission">
            <v-icon size="small">mdi-alert-outline</v-icon>
            <span class="sol-notice__text">{{ $t('solana.staking.highCommission', { percent: validator.commission }) }}</span>
          </div>
          <span class="t-caption">{{ $t('solana.staking.selfDeclared') }}</span>

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
                data-test="stake-amount"
              />
              <GButton tier="tertiary" compact :disabled="maxStake <= 0n" @click="setMax()">{{ $t('common.max') }}</GButton>
            </span>
            <span v-if="amountError" class="sol-field__error" data-test="stake-amount-error">{{ amountError }}</span>
          </label>
          <div class="sol-stake__balance t-caption">
            <span>{{ $t('send.availableBalance') }}</span>
            <span class="g-num sol-stake__balance-value">{{ balance === null ? '—' : formatSol(balance) }} {{ ticker }}</span>
            <span v-if="props.info">· {{ $t('solana.staking.minimum', { amount: formatSol(props.info.minimumDelegation), ticker }) }}</span>
          </div>
        </template>

        <div v-else-if="props.account" class="glass-tier sol-review" data-test="stake-account">
          <span class="t-label">{{ $t('solana.staking.stakeAccount') }}</span>
          <span class="g-mono sol-review__address">{{ props.account.address }}</span>
          <dl class="sol-summary">
            <div v-if="accountValidator" class="sol-summary__row">
              <dt>{{ $t('solana.staking.validator') }}</dt>
              <dd>{{ accountValidator }}</dd>
            </div>
            <div class="sol-summary__row">
              <dt>{{ props.action === 'withdraw' ? $t('solana.staking.youWithdraw') : $t('solana.staking.youUnstake') }}</dt>
              <dd class="g-num">{{ formatSol(existingAmount) }} {{ ticker }}</dd>
            </div>
          </dl>
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
            <span class="t-caption g-num">{{ prices ? `${formatSol(levelFee(level))} ${ticker}` : '…' }}</span>
          </button>
        </div>
        <span class="t-caption">{{ props.action === 'stake' ? $t('solana.staking.activateHint') : props.action === 'unstake' ? $t('solana.staking.unstakeHint') : $t('solana.feeHint') }}</span>

        <div v-if="quoteError" class="sol-notice sol-notice--error" role="alert" data-test="stake-quote-error">
          <v-icon size="small">mdi-alert-circle-outline</v-icon>
          <span class="sol-notice__text">{{ quoteError }}</span>
        </div>
      </div>

      <!-- Step 2: review and sign -->
      <div v-else-if="quote" class="sol-stake__body">
        <div class="glass-tier sol-review" data-test="stake-review">
          <span class="t-label">{{ reviewLabel }}</span>
          <span class="sol-review__amount">
            <span class="t-display g-num">{{ formatSol(quote.lamports) }}</span>
            <span class="sol-review__unit g-mono">{{ ticker }}</span>
          </span>
          <template v-if="quoteValidator">
            <span class="t-label sol-review__gap">{{ $t('solana.staking.validator') }}</span>
            <span class="sol-validator__name">{{ quoteValidator }}</span>
          </template>
          <template v-if="quote.voteAccount">
            <span class="t-label sol-review__gap">{{ $t('solana.staking.voteAccount') }}</span>
            <span class="g-mono sol-review__address">{{ quote.voteAccount }}</span>
          </template>
          <span class="t-label sol-review__gap">{{ $t('solana.staking.stakeAccount') }}</span>
          <span class="g-mono sol-review__address" data-test="stake-review-account">{{ quote.stakeAccount }}</span>
          <dl class="sol-summary">
            <div v-if="props.action === 'stake'" class="sol-summary__row">
              <dt>{{ $t('solana.staking.reserve') }}</dt>
              <dd class="g-num">{{ formatSol(quote.reserveLamports) }} {{ ticker }}</dd>
            </div>
            <div class="sol-summary__row">
              <dt>{{ $t('send.fee') }}</dt>
              <dd class="g-num">{{ formatSol(quote.feeLamports) }} {{ ticker }}</dd>
            </div>
            <div v-if="props.action === 'stake'" class="sol-summary__row sol-summary__row--total">
              <dt>{{ $t('send.total') }}</dt>
              <dd class="g-num">{{ formatSol(BigInt(quote.lamports) + BigInt(quote.reserveLamports) + BigInt(quote.feeLamports)) }} {{ ticker }}</dd>
            </div>
          </dl>
        </div>
        <span v-if="props.action === 'stake'" class="t-caption">
          {{ $t('solana.staking.reserveHint', { amount: formatSol(quote.reserveLamports), ticker }) }}
        </span>

        <div v-if="isHardware" class="sol-auth" data-test="stake-hardware">
          <span class="t-caption">{{ $t('solana.hardware.signOnDevice', { device: loggedWallet?.type }) }}</span>
          <ToggleSwitch
            v-if="showBluetoothToggle"
            :text-left="$t('dashboard.usb')"
            icon-left="mdi-usb"
            :text-right="$t('dashboard.bluetooth')"
            icon-right="mdi-bluetooth"
            v-model="isBluetooth"
          />
        </div>
        <template v-else-if="isPrfWallet">
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
              data-test="stake-password"
              @keyup.enter="confirm()"
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

        <div v-if="sendError" class="sol-notice sol-notice--error" role="alert" data-test="stake-error">
          <v-icon size="small">mdi-alert-circle-outline</v-icon>
          <span class="sol-notice__text">{{ sendError }}</span>
        </div>
      </div>

      <div class="sol-stake__nav">
        <GButton v-if="step > 1 && !loading" tier="secondary" @click="backToDetails()">
          <v-icon size="small" start>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </GButton>
        <span v-else />
        <GButton v-if="step === 1" tier="primary" :disabled="!canContinue" :loading="quoting" data-test="stake-continue" @click="toReview()">
          {{ $t('common.continue') }}
          <v-icon size="small" end>mdi-arrow-right</v-icon>
        </GButton>
        <GButton v-else tier="primary" :disabled="!canSign" :loading="loading" data-test="stake-confirm" @click="confirm()">
          {{ actionLabel }}
        </GButton>
      </div>
    </template>

    <template v-if="isHardware">
      <KeystoneSignSheet
        v-if="props.inPanel"
        :isOpen="keystone.keystoneShow.value"
        :keystoneType="keystone.keystoneType.value"
        :keystoneCbor="keystone.keystoneCbor.value"
        :urTypes="['sol-signature']"
        @scan="keystone.onKeystoneScan"
        @error="keystone.failKeystone"
        @close="keystone.cancelKeystone()"
      />
      <KeystoneSignDialog
        v-else
        :isOpen="keystone.keystoneShow.value"
        :keystoneType="keystone.keystoneType.value"
        :keystoneCbor="keystone.keystoneCbor.value"
        :urTypes="['sol-signature']"
        @scan="keystone.onKeystoneScan"
        @error="keystone.failKeystone"
        @close="keystone.cancelKeystone()"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
// Stake, Unstake and Withdraw for the logged Solana account. The page sends only what the user
// chose; the worker (chrome/solanaStake.ts) reads the chain again, builds and simulates the
// message before the review, and holds the send to what the review showed.
import { computed, onBeforeUnmount, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GButton from '@/shared/components/GButton/GButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import KeystoneSignSheet from '@/sidepanel/components/KeystoneSignSheet.vue';
import networks from '@/utils/networks';
import { debugLog } from '@/utils/debug';
import { WalletType } from '@/models/types';
import { formatSol, parseRawAmount, parseSol } from '@/chains/solana/solanaAmount';
import { solanaSendErrorKey, SOLANA_RENT_EXEMPT_MINIMUM, type SolanaFeeLevel } from '@/chains/solana/solanaSendRules';
import { estimateStakeFee, type SolanaStakeAction } from '@/chains/solana/solanaStakeTransfer';
import { STAKE_KEEP_LAMPORTS, type SolanaStakeAccount, type SolanaStakeInfo, type SolanaValidator } from '@/chains/solana/solanaStaking';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import { isSolanaHardware } from '@/chains/solana/solanaHardwarePolicy';
import { useSolanaHardwareSigner, SolanaHardwareSignError } from '@/shared/composables/useSolanaHardwareSigner';
import type { SolanaSendQuote } from '@/chrome/solanaSend';
import type { SolanaStakeQuote } from '@/chrome/solanaStake';

const props = defineProps<{
  open: boolean;
  action: SolanaStakeAction;
  /** Unstake / Withdraw: the stake account acted on. */
  account?: SolanaStakeAccount | null;
  validators: SolanaValidator[] | null;
  validatorsFailed?: boolean;
  info: SolanaStakeInfo | null;
  inPanel?: boolean;
}>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'busy', value: boolean): void;
  /** The action was submitted: the host reloads its stake accounts. */
  (e: 'done'): void;
}>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const FEE_LEVELS: SolanaFeeLevel[] = ['standard', 'fast'];
/** Above this commission (percent) the user is told how much of the rewards the validator keeps. */
const HIGH_COMMISSION = 10;

const step = ref(1);
const voteAccount = ref<string | null>(null);
const amountText = ref('');
const feeLevel = ref<SolanaFeeLevel>('standard');
const prices = ref<Record<SolanaFeeLevel, string> | null>(null);
const quote = ref<SolanaStakeQuote | null>(null);
const quoting = ref(false);
const quoteError = ref('');
const password = ref('');
const showPassword = ref(false);
const prfBytes = ref<Uint8Array | null>(null);
const loading = ref(false);
const sendError = ref('');
const sentSignature = ref('');

const ticker = computed(() => networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));
const balance = computed<bigint | null>(() => {
  const lamports = walletStore.solana?.lamports;
  return lamports == null ? null : parseRawAmount(lamports);
});

function shortId(id: string): string {
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

/** A validator's published name (self-declared), else its vote account shortened. */
function validatorLabel(v: SolanaValidator): string {
  return v.name ?? shortId(v.votePubkey);
}

// Delinquent validators earn nothing: never offered.
const validatorItems = computed(() => (props.validators ?? [])
  .filter((v) => !v.delinquent)
  .map((v) => ({ value: v.votePubkey, title: `${validatorLabel(v)} · ${t('solana.staking.commission', { percent: v.commission })}`, search: `${v.name ?? ''} ${v.votePubkey}`.toLowerCase() })));

function filterValidator(_value: string, query: string, item?: { raw?: { search?: string } }): boolean {
  return !!item?.raw?.search?.includes(query.trim().toLowerCase());
}

const validator = computed(() => props.validators?.find((v) => v.votePubkey === voteAccount.value) ?? null);
const byVote = computed(() => new Map((props.validators ?? []).map((v) => [v.votePubkey, v])));
const accountValidator = computed(() => {
  const voter = props.account?.voter;
  if (!voter) return '';
  const v = byVote.value.get(voter);
  return v ? validatorLabel(v) : shortId(voter);
});
const quoteValidator = computed(() => {
  const vote = quote.value?.voteAccount;
  const v = vote ? byVote.value.get(vote) : undefined;
  return v?.name ?? '';
});
const existingAmount = computed(() => {
  const account = props.account;
  if (!account) return 0n;
  return props.action === 'withdraw' ? account.withdrawableLamports : account.activeStake + account.activatingStake;
});

function levelFee(level: SolanaFeeLevel): bigint {
  return estimateStakeFee(props.action, BigInt(prices.value?.[level] ?? '0'));
}
const fee = computed(() => levelFee(feeLevel.value));

/** The amount in lamports; -1 for text that is not an amount. */
const amount = computed<bigint>(() => {
  if (!amountText.value) return 0n;
  try {
    return parseSol(amountText.value.replace(',', '.'));
  } catch {
    return -1n;
  }
});

const reserve = computed(() => props.info?.rentExemptReserve ?? 0n);
/** The most that can be staked while keeping STAKE_KEEP_LAMPORTS for later fees. */
const maxStake = computed(() => {
  if (balance.value === null || !props.info) return 0n;
  const max = balance.value - reserve.value - fee.value - STAKE_KEEP_LAMPORTS;
  return max > 0n ? max : 0n;
});

function errorText(code: string): string {
  const amountFor = code === 'STAKE_BELOW_MINIMUM' ? props.info?.minimumDelegation ?? 0n
    : code === 'STAKE_KEEP_SOL' ? STAKE_KEEP_LAMPORTS : SOLANA_RENT_EXEMPT_MINIMUM;
  return t(solanaSendErrorKey(code), { amount: formatSol(amountFor), ticker: ticker.value });
}

const amountError = computed(() => {
  if (!amountText.value) return '';
  if (amount.value <= 0n) return errorText('INVALID_AMOUNT');
  if (props.info && amount.value < props.info.minimumDelegation) return errorText('STAKE_BELOW_MINIMUM');
  if (balance.value === null || !props.info) return '';
  const remaining = balance.value - amount.value - reserve.value - fee.value;
  if (remaining < 0n) return errorText('INSUFFICIENT_FUNDS');
  if (remaining < STAKE_KEEP_LAMPORTS) return errorText('STAKE_KEEP_SOL');
  return '';
});

const canContinue = computed(() => {
  if (quoting.value || !prices.value) return false;
  if (props.action !== 'stake') return !!props.account && existingAmount.value > 0n;
  return !!validator.value && amount.value > 0n && !amountError.value && !!props.info;
});

const isHardware = computed(() => isSolanaHardware(loggedWallet.value?.type));
const isBluetooth = ref(false);
const showBluetoothToggle = computed(() => !props.inPanel && loggedWallet.value?.type === WalletType.Ledger && !!loggedWallet.value?.btSupported);
const { sign: signOnDevice, keystone } = useSolanaHardwareSigner({ getIsBT: () => showBluetoothToggle.value && isBluetooth.value });
const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf'
  || (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId),
);
const canSign = computed(() => !loading.value && !!quote.value
  && (isHardware.value || (isPrfWallet.value ? !!prfBytes.value : !!password.value)));

const actionLabel = computed(() => t(`solana.staking.${props.action}`));
const reviewLabel = computed(() => t(props.action === 'stake' ? 'solana.staking.youStake'
  : props.action === 'unstake' ? 'solana.staking.youUnstake' : 'solana.staking.youWithdraw'));
const sentUrl = computed(() => solscanUrl('tx', sentSignature.value, loggedWallet.value?.network ?? ''));

function setMax(): void {
  amountText.value = maxStake.value > 0n ? formatSol(maxStake.value) : '';
}

/** What the worker plans from: never more than the user chose. */
function request(): Record<string, unknown> {
  if (props.action === 'stake') {
    return { action: 'stake', voteAccount: voteAccount.value, lamports: amount.value.toString(), feeLevel: feeLevel.value };
  }
  return { action: props.action, stakeAccount: props.account?.address, feeLevel: feeLevel.value };
}

/** The reviewed limits the worker holds the send to. */
function limits(q: SolanaStakeQuote): Record<string, string> {
  const fee = BigInt(q.feeLamports);
  if (q.action === 'stake') return { maxSolCost: (BigInt(q.lamports) + BigInt(q.reserveLamports) + fee).toString() };
  if (q.action === 'withdraw') return { maxSolCost: fee.toString(), minReceived: q.lamports };
  return { maxSolCost: fee.toString() };
}

async function loadPrices(): Promise<void> {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SOLANA_SEND_QUOTE, data: {} }) as
      { data?: { success?: boolean; result?: SolanaSendQuote } };
    if (response.data?.success && response.data.result) prices.value = response.data.result.prices;
  } catch (error) {
    debugLog('Solana staking: fee prices failed', error);
  }
}

async function toReview(): Promise<void> {
  if (!canContinue.value) return;
  quoteError.value = '';
  quoting.value = true;
  try {
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SOLANA_STAKE_QUOTE, data: request() }) as
      { data?: { success?: boolean; error?: string; result?: SolanaStakeQuote } };
    if (response.data?.success && response.data.result) {
      quote.value = response.data.result;
      step.value = 2;
    } else {
      quoteError.value = errorText(response.data?.error ?? '');
    }
  } catch (error) {
    debugLog('Solana staking: quote failed', error);
    quoteError.value = errorText('LOOKUP_FAILED');
  } finally {
    quoting.value = false;
  }
}

function backToDetails(): void {
  step.value = 1;
  quote.value = null;
  sendError.value = '';
}

watch([voteAccount, amountText, feeLevel], () => { quoteError.value = ''; });

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

type SendResponse = { data?: { success?: boolean; error?: string; result?: { signature: string } } };

/** The device signs the message the worker built; the worker checks it and submits. */
async function sendFromDevice(data: Record<string, unknown>): Promise<SendResponse> {
  const prepared = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.PREPARE_SOLANA_STAKE, data }) as
    { data?: { success?: boolean; error?: string; result?: { message: number[] } } };
  if (!prepared.data?.success || !prepared.data.result) return { data: { success: false, error: prepared.data?.error } };
  let signature: Uint8Array;
  try {
    signature = await signOnDevice(Uint8Array.from(prepared.data.result.message), 'transaction');
  } catch (error) {
    debugLog('Solana staking: device did not sign', error);
    return { data: { success: false, error: error instanceof SolanaHardwareSignError && error.cancelled ? 'CANCELLED' : 'DEVICE_FAILED' } };
  }
  return await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_SOLANA_SEND,
    data: { signature: Array.from(signature) },
  }) as SendResponse;
}

async function confirm(): Promise<void> {
  if (!canSign.value || !quote.value) return;
  loading.value = true;
  sendError.value = '';
  try {
    const data: Record<string, unknown> = { ...request(), ...limits(quote.value) };
    let response: SendResponse;
    if (isHardware.value) {
      response = await sendFromDevice(data);
    } else {
      if (isPrfWallet.value && prfBytes.value) data['privateKeyBytes'] = Array.from(prfBytes.value);
      else data['password'] = password.value;
      response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SOLANA_STAKE, data }) as SendResponse;
    }
    if (response.data?.success && response.data.result) {
      sentSignature.value = response.data.result.signature;
      emit('done');
    } else if (response.data?.error !== 'CANCELLED') {
      sendError.value = errorText(response.data?.error ?? '');
      // A PassKey answer is single-use in spirit: ask again after a failure.
      prfBytes.value = null;
    }
  } catch (error) {
    debugLog('Solana staking failed', error);
    sendError.value = errorText('');
  } finally {
    password.value = '';
    loading.value = false;
  }
}

function reset(): void {
  if (keystone.keystoneShow.value) keystone.cancelKeystone();
  isBluetooth.value = false;
  step.value = 1;
  voteAccount.value = null;
  amountText.value = '';
  feeLevel.value = 'standard';
  quote.value = null;
  quoting.value = false;
  quoteError.value = '';
  password.value = '';
  showPassword.value = false;
  prfBytes.value?.fill(0);
  prfBytes.value = null;
  sendError.value = '';
  sentSignature.value = '';
  prices.value = null;
}

watch(() => props.open, (open) => {
  if (!open) return reset();
  void loadPrices();
}, { immediate: true });
watch(loading, (busy) => emit('busy', busy));
onBeforeUnmount(reset);
</script>

<style scoped lang="scss">
.sol-stake,
.sol-stake__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
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

/* Inputs are controls, not surfaces: solid raised fill. */
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

.sol-stake__balance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.sol-stake__balance-value {
  color: var(--g-text-1);
}

.sol-validator {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3);
}

.sol-validator__name {
  color: var(--g-text-1);
  font-weight: 600;
  overflow-wrap: anywhere;
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

.sol-review__gap {
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

.sol-notice--warning {
  border-color: var(--g-warning-line);
  background: var(--g-warning-fill);
  color: var(--g-warning);
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

.sol-stake__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
