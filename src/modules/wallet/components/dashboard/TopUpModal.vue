<template>
  <BaseDialog
    :isOpen="open"
    :title="title"
    :subtitle="subtitle"
    :width="600"
    :min-height="0"
    :persistent="busy"
    @close="close"
  >
    <template #art>
      <IsoScene :name="step === 'done' ? 'approved' : 'payment'" />
    </template>

    <div class="topup">
      <AmountInputStep
        v-if="step === 'amount'"
        :model-value="amounts"
        :rate="buyRate"
        :min-ada="MIN_TOP_UP_ADA"
        @update:modelValue="amounts = $event"
      />
      <SummaryStep
        v-else-if="step === 'review'"
        :ada-amount="amounts.adaAmount"
        :eur-amount="amounts.eurAmount"
        :deposit-address="depositAddress || undefined"
        :address-loading="loadingAddress"
      />
      <SuccessStep v-else :transaction-id="txId" :credited="credited" :watching="watchingBalance" />

      <div v-if="step === 'amount'" class="topup__actions">
        <GButton tier="secondary" @click="close">{{ t('common.cancel') }}</GButton>
        <GButton tier="primary" :disabled="!amountValid" @click="toReview">{{ t('card.continueButton') }}</GButton>
      </div>

      <template v-else-if="step === 'review'">
        <!-- A top-up the largest UTxOs one request carries cannot cover goes out as merges and
             one payment: the merges being built, then the plan with each stage's fee, on screen
             before the user approves it; while it signs and sends, where it is. -->
        <SweepPlanCard
          v-if="sweepPreparing"
          :utxo-count="sweepPreparing.utxoCount"
          :merges="sweepPreparing.total"
          :preparing="{ built: sweepPreparing.built, total: sweepPreparing.total, waiting: sweepPreparing.waiting }"
        />
        <SweepTimeline v-else-if="sweepPlan" v-bind="sweepPlan" />
        <SweepProgressPanel v-if="sweepProgress || sweepStop" :progress="sweepProgress" :stop="sweepStop" />
        <CardSignSection
          ref="signSection"
          :label="t('card.signAndTopUp')"
          :prepare="buildTx"
          :disabled="!depositAddress || planning"
          :prerequisites="sweepPrerequisites"
          @busy="busy = $event"
          @progress="onSweepProgress"
          @interrupted="sweepStop = $event"
          @submitted="onSubmitted"
        />
        <GButton tier="tertiary" block :disabled="busy" @click="backToAmount">{{ t('common.back') }}</GButton>
      </template>

      <div v-else class="topup__actions">
        <GButton tier="secondary" block @click="close">{{ t('card.backToYourAccount') }}</GButton>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { usePaymentSweep, type PaymentRequest } from '@/shared/composables/usePaymentSweep';
import type { SweepProgress, SweepStop } from '@/shared/composables/useTransactionSigning';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import cardStore from '@/stores/modules/card';
import { walletStore } from '@/stores/walletStore';
import { NEXUS_MAX_INPUTS, txOutToNexusOutput } from '@/api/nexus-tx-api';
import { filterOutCollateralFromUTxOs } from '@/chrome/serialization';
import { withoutPendingSpends } from '@/shared/utils/pendingSpends';
import { formatAda } from '@/shared/utils/format';
import { debugLog } from '@/utils/debug';
import { isCardDepositAddress, networkIdOfAddress } from '@/modules/wallet/utils/cardDepositAddress';
import SweepPlanCard from '@/modules/dashboard/components/sweep/SweepPlanCard.vue';
import SweepProgressPanel from '@/modules/dashboard/components/sweep/SweepProgressPanel.vue';
import SweepTimeline from '@/modules/dashboard/components/sweep/SweepTimeline.vue';
import CardSignSection from '../ui/CardSignSection.vue';
import AmountInputStep from './top-up/AmountInputStep.vue';
import SummaryStep from './top-up/SummaryStep.vue';
import SuccessStep from './top-up/SuccessStep.vue';

/** Smallest top-up accepted, in ADA (keeps the output well above the min-UTxO). */
const MIN_TOP_UP_ADA = 2;
const BALANCE_POLL_MS = 15_000;
const BALANCE_POLL_MAX = 40; // ten minutes

defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();

const step = ref<'amount' | 'review' | 'done'>('amount');
const amounts = ref({ adaAmount: '', eurAmount: '' });
const depositAddress = ref<string | null>(null);
const loadingAddress = ref(false);
const busy = ref(false);
const txId = ref('');
const credited = ref(false);
const watchingBalance = ref(false);
const signSection = ref<{ reset: () => void; canSweep: boolean } | null>(null);
let balanceTimer: ReturnType<typeof setInterval> | null = null;

// A top-up the largest UTxOs one request carries cannot cover, from a wallet that holds it:
// merges into the wallet first, then the payment, under one approval (see usePaymentSweep).
const paymentSweep = usePaymentSweep();
const { preparing: sweepPreparing, prerequisites: sweepPrerequisites } = paymentSweep;
const sweepProgress = ref<SweepProgress | null>(null);
const sweepStop = ref<SweepStop | null>(null);
/** Signing waits while the review finds out whether the top-up needs merges first. */
const planning = ref(false);
/** Bumped when a review is left: its plan, still being worked out, no longer counts. */
let planEpoch = 0;

/** The plan the user approves, each stage's fee included, once its merges and payment are built. */
const sweepPlan = computed(() => {
  const built = paymentSweep.sweep.value;
  const payment = paymentSweep.payment.value;
  if (!built || !payment) return null;
  return {
    steps: built.merges.length + 1,
    utxoCount: built.utxoCount,
    mergeFee: formatAda(built.mergeFee),
    paymentFee: formatAda(BigInt(payment.tx.body.fee)),
  };
});

const buyRate = computed(() => {
  const rate = parseFloat(String(cardStore.state.exchangeRate?.buy ?? ''));
  return Number.isFinite(rate) && rate > 0 ? rate : 0;
});

const amountValid = computed(() => {
  const ada = parseFloat(amounts.value.adaAmount);
  return Number.isFinite(ada) && ada >= MIN_TOP_UP_ADA && amounts.value.eurAmount !== '';
});

const title = computed(() => {
  if (step.value === 'review') return t('card.feeOrderSummary');
  if (step.value === 'done') return t('card.topUpSubmitted');
  return t('card.topUpCardBalance');
});

const subtitle = computed(() => {
  if (step.value === 'review') return t('card.confirmPreferredPayment');
  if (step.value === 'done') return t('card.topUpSubmittedDesc');
  return t('card.swapAdaToEuro');
});

const walletNetworkId = () => networkIdOfAddress(walletStore.loggedWallet.baseAddress);

/** The card's deposit address, fetched now (never the copy cached at sign-in), or null. */
async function freshDepositAddress(): Promise<Cardano.PaymentAddress | null> {
  try {
    const address = await cardStore.fetchFreshDepositAddress();
    return isCardDepositAddress(address, walletNetworkId()) ? address : null;
  } catch {
    return null;
  }
}

/** Forget a review's sweep: its plan, merges and where it stopped. */
function leaveReview(): void {
  planEpoch++;
  planning.value = false;
  paymentSweep.reset();
  sweepProgress.value = null;
  sweepStop.value = null;
}

async function toReview(): Promise<void> {
  leaveReview();
  step.value = 'review';
  depositAddress.value = null;
  loadingAddress.value = true;
  depositAddress.value = await freshDepositAddress();
  loadingAddress.value = false;
  await planSweep();
}

function backToAmount(): void {
  leaveReview();
  step.value = 'amount';
}

/** The amount in lovelace, or null when it is not a valid top-up. */
function amountLovelace(): Cardano.Lovelace | null {
  const ada = parseFloat(amounts.value.adaAmount);
  if (!Number.isFinite(ada) || ada < MIN_TOP_UP_ADA) return null;
  return BigInt(Math.floor(ada * 1_000_000)) as Cardano.Lovelace;
}

/** The wallet's UTxOs a top-up may spend: not its collateral, nor any a submitted transaction already spends. */
function spendableUtxos(): Cardano.Utxo[] {
  const utxos = (walletStore.utxos ?? []) as Cardano.Utxo[];
  const collateral = walletStore.collateral as Cardano.Utxo | null | undefined;
  const withoutCollateral = collateral ? filterOutCollateralFromUTxOs(utxos, collateral) : utxos;
  // A wallet whose only UTxO is its collateral still pays from it, as before.
  return withoutPendingSpends(withoutCollateral.length > 0 ? withoutCollateral : utxos, walletStore.transactions);
}

function topUpRequest(address: Cardano.PaymentAddress, lovelace: Cardano.Lovelace): PaymentRequest {
  return {
    outputs: [txOutToNexusOutput({ address, value: { coins: lovelace, assets: new Map() } })],
    changeAddress: walletStore.loggedWallet.baseAddress,
  };
}

/**
 * A wallet holding more UTxOs than one request carries may need its top-up sent as a sweep.
 * Find out at review, so the plan is on screen before the user approves it. A failure here is
 * left to the build at signing time, which reports it.
 */
async function planSweep(): Promise<void> {
  const address = depositAddress.value;
  const lovelace = amountLovelace();
  const utxos = spendableUtxos();
  if (!address || lovelace === null || utxos.length <= NEXUS_MAX_INPUTS || !signSection.value?.canSweep) return;
  const epoch = planEpoch;
  planning.value = true;
  try {
    await paymentSweep.build(topUpRequest(address, lovelace), utxos, true);
  } catch (error) {
    debugLog('Top-up: no plan at review', error);
  } finally {
    if (epoch === planEpoch) planning.value = false;
  }
}

async function buildTx(): Promise<Cardano.Tx> {
  // Re-read the address at signing time; if it moved since the review, show the new one first.
  const address = await freshDepositAddress();
  if (!address) throw new Error(t('errors.invalidAddress'));
  if (address !== depositAddress.value) {
    depositAddress.value = address;
    throw new Error(t('card.paymentDetailsRefreshed'));
  }

  const lovelace = amountLovelace();
  if (lovelace === null) throw new Error(t('errors.invalidAmount'));

  const planned = !!paymentSweep.sweep.value;
  const tx = await paymentSweep.build(topUpRequest(address, lovelace), spendableUtxos(), signSection.value?.canSweep ?? false);
  // A sweep found only now was never on screen: show its plan and let the user approve that.
  if (!planned && paymentSweep.sweep.value) throw new Error(t('card.topUpSweepReview'));
  return tx;
}

function onSweepProgress(progress: SweepProgress | null): void {
  sweepProgress.value = progress;
  // A sweep running again replaces where it stopped.
  if (progress) sweepStop.value = null;
}

function currentBalance(): number | null {
  const amount = cardStore.getSelectedCard()?.cardBalance?.currentBalance?.amount;
  return typeof amount === 'number' ? amount : null;
}

function stopWatching(): void {
  if (balanceTimer) clearInterval(balanceTimer);
  balanceTimer = null;
  watchingBalance.value = false;
}

/** Follows the card balance until the top-up shows up (or ten minutes pass). */
function watchBalance(): void {
  const before = currentBalance();
  let polls = 0;
  watchingBalance.value = true;
  balanceTimer = setInterval(async () => {
    polls += 1;
    try {
      await cardStore.fetchCardBalance();
    } catch {
      // Try again on the next tick.
    }
    const now = currentBalance();
    if (now !== null && before !== null && now > before) {
      credited.value = true;
      stopWatching();
      cardStore.fetchCardHistory().catch(() => undefined);
    } else if (polls >= BALANCE_POLL_MAX) {
      stopWatching();
    }
  }, BALANCE_POLL_MS);
}

function onSubmitted(id: string): void {
  txId.value = id;
  step.value = 'done';
  credited.value = false;
  watchBalance();
}

function close(): void {
  if (busy.value) return;
  stopWatching();
  leaveReview();
  signSection.value?.reset();
  step.value = 'amount';
  amounts.value = { adaAmount: '', eurAmount: '' };
  depositAddress.value = null;
  txId.value = '';
  credited.value = false;
  emit('close');
}

onBeforeUnmount(stopWatching);
</script>

<style lang="scss" scoped>
.topup {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-2) 0;
}

.topup__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-3);
}
</style>
