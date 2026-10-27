<template>
  <BaseDialog
    size="sm"
    :isOpen="modelValue"
    :title="t('gomining.buyMiner')"
    :img="assts.depositSvg"
    img-color="var(--g-accent)"
    :min-height="0"
    :loading="busy"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text v-if="collection" class="px-5 pt-1 pb-5 gm-buy">
      <!-- What is being bought -->
      <div class="glass-tier gm-buy__preview">
        <div class="gm-buy__art" aria-hidden="true"><v-icon size="28">mdi-pickaxe</v-icon></div>
        <div class="gm-buy__meta">
          <span class="t-body-lg gm-buy__name">{{ $t('gomining.minerTitle', { value: collection.powerTh }) }}</span>
          <span class="t-caption g-num">
            {{ $t('gomining.energyEfficiencyValue', { value: collection.energyEfficiency }) }} · {{ formatUsd(collection.priceUsd) }}
          </span>
        </div>
      </div>

      <!-- ════ Step 1: review ════ -->
      <template v-if="step === 'review'">
        <dl class="gm-summary">
          <div class="t-body-sm gm-summary__row">
            <dt>{{ $t('gomining.projectedReturn') }}</dt>
            <dd class="g-num">{{ $t('gomining.percentValue', { value: collection.annualRoiPercent.toFixed(1) }) }}</dd>
          </div>
          <div class="t-body-sm gm-summary__row gm-summary__row--total">
            <dt>{{ $t('gomining.price') }}</dt>
            <dd class="g-num">{{ formatUsd(collection.priceUsd) }}</dd>
          </div>
        </dl>

        <div class="t-body-sm gm-notice">
          <v-icon size="small">mdi-information-outline</v-icon>
          <span class="gm-notice__text">{{ $t('gomining.payInBtcNote') }}</span>
        </div>
      </template>

      <!-- ════ Step 2: pay the quote ════ -->
      <template v-else-if="step === 'pay' && order">
        <dl class="gm-summary">
          <div class="t-body-sm gm-summary__row">
            <dt>{{ $t('gomining.payTo') }}</dt>
            <dd class="gm-buy__address">
              <span class="g-mono">{{ order.payment.address }}</span>
              <CopyButton x-small :value="order.payment.address" />
            </dd>
          </div>
          <div class="t-body-sm gm-summary__row">
            <dt>{{ $t('gomining.minerPrice') }}</dt>
            <dd class="g-num">{{ formatBtc(order.payment.amountSats) }} BTC</dd>
          </div>
          <div class="t-body-sm gm-summary__row">
            <dt>{{ $t('gomining.networkFee') }}</dt>
            <dd class="g-num">{{ feeSats === null ? '—' : `${formatBtc(feeSats)} BTC` }}</dd>
          </div>
          <div class="t-body-sm gm-summary__row gm-summary__row--total">
            <dt>{{ $t('gomining.totalCost') }}</dt>
            <dd class="g-num">{{ feeSats === null ? '—' : `${formatBtc(order.payment.amountSats + feeSats)} BTC` }}</dd>
          </div>
        </dl>

        <div class="t-body-sm gm-notice" role="timer">
          <v-icon size="small">mdi-timer-outline</v-icon>
          <span class="gm-notice__text">
            {{ quoteLeftMs > 0 ? $t('gomining.quoteExpiresIn', { time: countdown }) : $t('gomining.errorQuoteExpired') }}
          </span>
        </div>

        <!-- Password wallet -->
        <PassKeyPasswordField
          v-if="!isPrfWallet"
          :model-value="password"
          dense
          outlined
          hide-details="auto"
          :label="$t('wallet.spendingPassword')"
          :placeholder="$t('navigation.typeYourSpendingPassword')"
          :disabled="busy"
          required
          @update:model-value="password = $event"
          @enter="pay()"
        />
      </template>

      <!-- ════ Step 3: what happens to the order ════ -->
      <template v-else-if="step === 'status' && order">
        <div :class="['t-body-sm', 'gm-notice', `gm-notice--${statusTone}`]" role="status">
          <v-icon size="small">{{ statusIcon }}</v-icon>
          <span class="gm-notice__text">{{ $t(orderStatusKey(order.status)) }}</span>
        </div>
        <dl class="gm-summary">
          <div class="t-body-sm gm-summary__row">
            <dt>{{ $t('gomining.minerPrice') }}</dt>
            <dd class="g-num">{{ formatBtc(order.payment.amountSats) }} BTC</dd>
          </div>
          <div v-if="paidTxid" class="t-body-sm gm-summary__row">
            <dt>{{ $t('transactions.transaction') }}</dt>
            <dd class="gm-buy__address">
              <span class="g-mono">{{ shortTxid(paidTxid) }}</span>
              <CopyButton x-small :value="paidTxid" />
            </dd>
          </div>
        </dl>
        <p class="t-caption gm-buy__hint">{{ $t('gomining.orderStatusHint') }}</p>
      </template>

      <div v-if="errorMessage" class="t-body-sm gm-notice gm-notice--error" role="alert">
        <v-icon size="small">mdi-alert-circle-outline</v-icon>
        <span class="gm-notice__text">{{ errorMessage }}</span>
      </div>

      <div class="gm-buy__nav">
        <GButton tier="secondary" :disabled="busy" @click="close()">
          {{ step === 'status' ? $t('common.close') : $t('common.cancel') }}
        </GButton>

        <GButton v-if="step === 'review'" tier="primary" :loading="busy" :disabled="busy" @click="requestQuote()">
          {{ $t('gomining.getBtcPrice') }}
          <v-icon size="small" end>mdi-arrow-right</v-icon>
        </GButton>

        <template v-else-if="step === 'pay'">
          <GButton v-if="quoteLeftMs <= QUOTE_MARGIN_MS" tier="primary" :loading="busy" :disabled="busy" @click="requestQuote(true)">
            <v-icon size="small" start>mdi-refresh</v-icon>
            {{ $t('gomining.newQuote') }}
          </GButton>
          <GButton v-else tier="primary" :loading="busy" :disabled="!canPay" @click="pay()">
            <v-icon size="small" start>{{ isPrfWallet ? 'mdi-fingerprint' : 'mdi-send' }}</v-icon>
            {{ $t('gomining.payNow') }}
          </GButton>
        </template>
      </div>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount, toRefs } from 'vue';
import goMiningApi, { type GoMiningCollection, type GoMiningOrder } from '@/api/gomining-api';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtc, formatUsd } from '@/shared/utils/format';
import { walletStore } from '@/stores/walletStore';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import assts from '@/utils/assets';
import type { IUnifiedUtxo } from '@/chains/common/interfaces';
import {
  QUOTE_MARGIN_MS,
  estimatePaymentFeeSats,
  isFinalOrderStatus,
  orderPaymentProblem,
  orderStatusKey,
} from '../goMiningPayment';
import { goMiningErrorMessage } from '../useGoMiningAccount';

const props = defineProps<{
  modelValue: boolean;
  collection: GoMiningCollection | null;
  /** The logged wallet's Bitcoin network; a quote for any other is never paid. */
  walletNetwork: string;
  withSession: <T>(call: (token: string) => Promise<T>) => Promise<T>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  /** The order was created or moved on; the page refreshes its orders and miners. */
  changed: [];
}>();

const { t } = useTranslation();
const { loggedWallet, utxos } = toRefs(walletStore);

type Step = 'review' | 'pay' | 'status';

const POLL_MS = 15_000;

const step = ref<Step>('review');
const order = ref<GoMiningOrder | null>(null);
const feeRate = ref<number | null>(null);
const password = ref('');
const busy = ref(false);
const errorMessage = ref('');
const paidTxid = ref<string | null>(null);
const now = ref(Date.now());
let requestId = '';
let clock: ReturnType<typeof setInterval> | null = null;
let poll: ReturnType<typeof setTimeout> | null = null;
/** Bumped on close, so a reply that lands after it changes nothing. */
let generation = 0;

const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf'
  || (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId),
);

const utxoValues = computed(() =>
  utxos.value
    .filter((utxo): utxo is IUnifiedUtxo => !Array.isArray(utxo))
    .map((utxo) => BigInt(utxo.value)),
);

const feeSats = computed(() =>
  order.value && feeRate.value !== null ? estimatePaymentFeeSats(utxoValues.value, order.value.payment.amountSats, feeRate.value) : null,
);

const quoteLeftMs = computed(() => (order.value ? order.value.payment.expiresAt - now.value : 0));

const countdown = computed(() => {
  const seconds = Math.max(0, Math.floor(quoteLeftMs.value / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
});

const canPay = computed(() =>
  !busy.value && !paidTxid.value && feeSats.value !== null && quoteLeftMs.value > QUOTE_MARGIN_MS
  && (isPrfWallet.value || !!password.value),
);

const statusTone = computed(() => {
  const status = order.value?.status;
  if (status === 'completed') return 'success';
  if (status === 'expired' || status === 'failed') return 'error';
  return 'info';
});

const statusIcon = computed(() => ({ success: 'mdi-check-circle-outline', error: 'mdi-alert-circle-outline', info: 'mdi-progress-clock' })[statusTone.value]);

function shortTxid(txid: string): string {
  return txid.length > 20 ? `${txid.slice(0, 10)}…${txid.slice(-8)}` : txid;
}

function startClock() {
  stopClock();
  now.value = Date.now();
  clock = setInterval(() => { now.value = Date.now(); }, 1000);
}

function stopClock() {
  if (clock) clearInterval(clock);
  clock = null;
}

function stopPolling() {
  if (poll) clearTimeout(poll);
  poll = null;
}

async function loadFeeRate() {
  try {
    const { getBitcoinFeeEstimator, FeePriority } = await import('@/chains/bitcoin/bitcoinFeeEstimator');
    // Fast: the payment has to be seen before the quote runs out.
    feeRate.value = (await getBitcoinFeeEstimator().getFeeEstimate(FeePriority.FAST)).feeRate;
  } catch {
    feeRate.value = null;
    errorMessage.value = t('gomining.errorFeeUnavailable');
  }
}

/** Opens the order. A retry with the same request id returns the same order, so a lost reply costs nothing. */
async function requestQuote(fresh = false) {
  if (!props.collection || busy.value) return;
  if (fresh || !requestId) requestId = crypto.randomUUID();
  const current = generation;
  const collectionId = props.collection.id;
  busy.value = true;
  errorMessage.value = '';
  try {
    const created = await props.withSession((token) => goMiningApi.createOrder(token, { collectionId, requestId }));
    if (current !== generation) return;
    order.value = created;
    step.value = 'pay';
    startClock();
    emit('changed');
    await loadFeeRate();
  } catch (error) {
    if (current === generation) errorMessage.value = goMiningErrorMessage(error, t);
  } finally {
    if (current === generation) busy.value = false;
  }
}

async function credentials(): Promise<Record<string, unknown> | null> {
  if (!isPrfWallet.value) return { password: password.value };
  const wallet = loggedWallet.value;
  if (!wallet?.webAuthnCredentialId) {
    errorMessage.value = t('security.passKeyNotConfigured');
    return null;
  }
  try {
    const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
    const prfOutput = new Uint8Array(await evaluateWalletPrf(wallet));
    const privateKeyBytes = Array.from(prfOutput);
    prfOutput.fill(0);
    return { privateKeyBytes };
  } catch {
    errorMessage.value = t('security.passKeyAuthFailed');
    return null;
  }
}

/** Pays the quote with the wallet's own send path, once, after checking it is still payable here. */
async function pay() {
  const quoted = order.value;
  if (!quoted || !canPay.value) return;
  const current = generation;
  busy.value = true;
  errorMessage.value = '';
  let secret: Record<string, unknown> | null = null;
  try {
    const { validateBitcoinAddress } = await import('@/chains/bitcoin/bitcoinKeyManager');
    const problem = orderPaymentProblem(quoted, { network: props.walletNetwork, isValidAddress: validateBitcoinAddress });
    if (problem) {
      errorMessage.value = problem === 'expired' ? t('gomining.errorQuoteExpired') : t('gomining.errorQuoteInvalid');
      return;
    }
    if (feeSats.value === null || feeRate.value === null) {
      errorMessage.value = t('errors.insufficientBalance');
      return;
    }
    secret = await credentials();
    if (!secret || current !== generation) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sendToBackgroundFromOptions resolves an untyped messaging envelope
    const response: any = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SEND_BITCOIN,
      data: { recipientAddress: quoted.payment.address, amount: quoted.payment.amountSats, feeRate: feeRate.value, ...secret },
    });
    if (!response?.data?.success || typeof response.data.txId !== 'string') {
      const reason = typeof response?.data?.error === 'string' ? response.data.error : '';
      errorMessage.value = /password/i.test(reason) ? t('errors.wrongPassword') : t('gomining.errorPaymentFailed');
      return;
    }
    // From here on the payment is out: nothing may offer to pay this order again.
    paidTxid.value = response.data.txId;
    password.value = '';
    step.value = 'status';
    stopClock();
    order.value = { ...quoted, status: 'payment_detected', txid: response.data.txId };
    emit('changed');
    await reportPayment(quoted.id, response.data.txId, current);
  } catch (error) {
    if (current === generation && !paidTxid.value) errorMessage.value = goMiningErrorMessage(error, t);
  } finally {
    if (Array.isArray(secret?.['privateKeyBytes'])) (secret['privateKeyBytes'] as number[]).fill(0);
    if (current === generation) busy.value = false;
  }
}

/** Best effort: the backend also finds the payment by watching the deposit address. */
async function reportPayment(orderId: string, txid: string, current: number) {
  try {
    const updated = await props.withSession((token) => goMiningApi.reportPayment(token, orderId, txid));
    if (current === generation) order.value = updated;
  } catch {
    // The order is still followed by polling below.
  }
  if (current === generation) schedulePoll();
}

function schedulePoll() {
  stopPolling();
  if (!order.value || isFinalOrderStatus(order.value.status)) return;
  const current = generation;
  const orderId = order.value.id;
  poll = setTimeout(async () => {
    try {
      const updated = await props.withSession((token) => goMiningApi.getOrder(token, orderId));
      if (current !== generation) return;
      const moved = updated.status !== order.value?.status;
      order.value = updated;
      if (moved) emit('changed');
    } catch {
      // Try again on the next tick; a refused session closes the page's link anyway.
    }
    if (current === generation) schedulePoll();
  }, POLL_MS);
}

function reset() {
  generation++;
  stopClock();
  stopPolling();
  step.value = 'review';
  order.value = null;
  feeRate.value = null;
  password.value = '';
  busy.value = false;
  errorMessage.value = '';
  paidTxid.value = null;
  requestId = '';
}

function close() {
  if (busy.value) return;
  reset();
  emit('update:modelValue', false);
}

watch(() => props.modelValue, (open) => { if (!open) reset(); });
watch(() => props.collection?.id, () => reset());
onBeforeUnmount(() => reset());
</script>

<style scoped lang="scss">
/* Sits above BaseDialog's decorative rings, which are positioned. */
.gm-buy {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.gm-buy__preview {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
}

/* GoMining publishes no art for a collection, so it gets the miner glyph. */
.gm-buy__art {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  color: var(--g-text-3);
}

.gm-buy__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gm-buy__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gm-buy__address {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-width: 0;
  overflow-wrap: anywhere;
}

.gm-buy__hint {
  margin: 0;
}

/* ── Summary ────────────────────────────────────────────── */
.gm-summary {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.gm-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
}

.gm-summary__row dt {
  flex: 0 0 auto;
  color: var(--g-text-3);
}

.gm-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.gm-summary__row--total dt {
  color: var(--g-text-1);
}

.gm-summary__row--total dd {
  font-weight: 600;
}

/* ── Notice ─────────────────────────────────────────────── */
.gm-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
}

.gm-notice .v-icon {
  flex: 0 0 auto;
  color: inherit;
}

.gm-notice--success {
  color: var(--g-success);
}

.gm-notice--error {
  color: var(--g-error);
}

.gm-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.gm-buy__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
