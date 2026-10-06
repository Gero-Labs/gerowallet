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
        <CardSignSection
          ref="signSection"
          :label="t('card.signAndTopUp')"
          :prepare="buildTx"
          :disabled="!depositAddress"
          @busy="busy = $event"
          @submitted="onSubmitted"
        />
        <GButton tier="tertiary" block :disabled="busy" @click="step = 'amount'">{{ t('common.back') }}</GButton>
      </template>

      <div v-else class="topup__actions">
        <GButton tier="secondary" block @click="close">{{ t('card.backToYourAccount') }}</GButton>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import cardStore from '@/stores/modules/card';
import { walletStore } from '@/stores/walletStore';
import { nexusTxApi, walletUtxosToNexusInputs, txOutToNexusOutput, requiredAssetsFromOutputs, type BuildTxRequest } from '@/api/nexus-tx-api';
import { isCardDepositAddress, networkIdOfAddress } from '@/modules/wallet/utils/cardDepositAddress';
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
const signSection = ref<{ reset: () => void } | null>(null);
let balanceTimer: ReturnType<typeof setInterval> | null = null;

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

async function toReview(): Promise<void> {
  step.value = 'review';
  depositAddress.value = null;
  loadingAddress.value = true;
  depositAddress.value = await freshDepositAddress();
  loadingAddress.value = false;
}

async function buildTx(): Promise<Cardano.Tx> {
  // Re-read the address at signing time; if it moved since the review, show the new one first.
  const address = await freshDepositAddress();
  if (!address) throw new Error(t('errors.invalidAddress'));
  if (address !== depositAddress.value) {
    depositAddress.value = address;
    throw new Error(t('card.paymentDetailsRefreshed'));
  }

  const ada = parseFloat(amounts.value.adaAmount);
  if (!Number.isFinite(ada) || ada < MIN_TOP_UP_ADA) throw new Error(t('errors.invalidAmount'));
  const lovelace = BigInt(Math.floor(ada * 1_000_000)) as Cardano.Lovelace;

  const outputs: Cardano.TxOut[] = [{ address, value: { coins: lovelace, assets: new Map() } }];
  const nexusOutputs = outputs.map(txOutToNexusOutput);
  const request: BuildTxRequest = {
    outputs: nexusOutputs,
    changeAddress: walletStore.loggedWallet.baseAddress,
    utxos: walletUtxosToNexusInputs(walletStore.utxos as Cardano.Utxo[], walletStore.collateral, true, {
      requiredAssets: requiredAssetsFromOutputs(nexusOutputs),
    }),
  };
  const { tx_cbor: txCbor } = await nexusTxApi.buildTransferTx(request, walletStore.loggedWallet.network);
  if (!txCbor) throw new Error(t('errors.buildTransactionFailed'));
  return Serialization.Transaction.fromCbor(HexBlob(txCbor)).toCore();
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
