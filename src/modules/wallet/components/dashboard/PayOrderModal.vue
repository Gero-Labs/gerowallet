<template>
  <BaseDialog
    :isOpen="open"
    :title="done ? t('card.paymentConfirmed') : t('card.completePayment')"
    :subtitle="done ? t('card.orderPlacedSuccessfully') : t('card.paymentRequired')"
    :width="600"
    :min-height="0"
    :persistent="busy"
    @close="close"
  >
    <template #art>
      <IsoScene :name="done ? 'approved' : 'payment'" />
    </template>

    <div class="pay-order">
      <div v-if="loading" class="pay-order__loading" role="status">
        <div class="g-skeleton pay-order__skeleton" aria-hidden="true"></div>
        <span class="t-caption">{{ t('card.loadingCardDetails') }}</span>
      </div>

      <template v-else-if="done">
        <PaymentConfirmationStep />
        <div class="pay-order__actions">
          <GButton tier="primary" @click="close">{{ t('common.done') }}</GButton>
        </div>
      </template>

      <template v-else-if="details">
        <p v-if="refreshed" class="pay-order__refreshed t-body-sm" role="alert">
          <v-icon small>mdi-refresh</v-icon>
          {{ t('card.paymentDetailsRefreshed') }}
        </p>
        <DeliveryFeePanel
          :amount-ada="parseFloat(details.amountAda)"
          :amount-eur="details.amountEur"
          :address="details.depositAddress"
          :expires-at="details.expiresAt || undefined"
        />
        <CardSignSection
          ref="signSection"
          :label="t('card.confirmPayment')"
          :prepare="prepareFeeTx"
          :disabled="expired"
          @busy="busy = $event"
          @submitted="onSubmitted"
        />
        <GButton tier="tertiary" block :disabled="busy" @click="close">{{ t('common.cancel') }}</GButton>
      </template>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { useTranslation } from '@/shared/composables/useTranslation';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import IsoScene from '@/shared/components/iso/IsoScene.vue';
import cardStore from '@/stores/modules/card';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';
import { nexusTxApi, walletUtxosToNexusInputs, txOutToNexusOutput, requiredAssetsFromOutputs, type BuildTxRequest } from '@/api/nexus-tx-api';
import { isCardDepositAddress, networkIdOfAddress } from '@/modules/wallet/utils/cardDepositAddress';
import { checkDeliveryPayment } from '@/modules/wallet/utils/cardDeliveryPayment';
import { lovelaceFromAda } from '@/modules/wallet/utils/cardOrder';
import CardSignSection from '../ui/CardSignSection.vue';
import DeliveryFeePanel from './card-order-steps/DeliveryFeePanel.vue';
import PaymentConfirmationStep from './card-order-steps/PaymentConfirmationStep.vue';

const props = defineProps<{
  open: boolean;
  orderUuid: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'success'): void;
}>();

const { t } = useTranslation();

interface PaymentDetails {
  depositAddress: Cardano.PaymentAddress;
  amountAda: string;
  amountEur: number;
  expiresAt: string | null;
}

const details = ref<PaymentDetails | null>(null);
const loading = ref(false);
const busy = ref(false);
const done = ref(false);
const refreshed = ref(false);
const now = ref(Date.now());
const signSection = ref<{ reset: () => void } | null>(null);

const expired = computed(() => {
  const deadline = details.value?.expiresAt ? Date.parse(details.value.expiresAt) : NaN;
  return Number.isFinite(deadline) && deadline <= now.value;
});

const walletNetworkId = () => networkIdOfAddress(walletStore.loggedWallet.baseAddress);

/** Reads the delivery-fee payment; false (with a message) when it cannot be paid now. */
async function loadDetails(): Promise<boolean> {
  const fresh = await cardStore.getDeliveryPayment(props.orderUuid);
  now.value = Date.now();
  if (fresh?.status === 'expired') {
    snackbar.setError(t('card.paymentExpiredMessage'));
    return false;
  }
  const amountAda = String(fresh?.amount_ada ?? '');
  if (!fresh || fresh.status !== 'pending' || lovelaceFromAda(amountAda) === null) {
    snackbar.setError(t('card.failedToLoadOrderDetails'));
    return false;
  }
  if (!isCardDepositAddress(fresh.deposit_address, walletNetworkId())) {
    snackbar.setError(t('errors.invalidAddress'));
    return false;
  }
  details.value = {
    depositAddress: fresh.deposit_address,
    amountAda,
    amountEur: parseFloat(String(fresh.amount_eur ?? 0)) || 0,
    expiresAt: fresh.expires_at ?? null,
  };
  return true;
}

async function prepareFeeTx(): Promise<Cardano.Tx> {
  const shown = details.value;
  if (!shown) throw new Error(t('errors.invalidOrder'));

  // The deposit address rotates after 60 minutes: re-read right before paying, and if
  // anything moved, show the new details instead of signing them unseen.
  const fresh = await cardStore.getDeliveryPayment(props.orderUuid);
  const verdict = checkDeliveryPayment(
    fresh,
    { depositAddress: shown.depositAddress, depositAmountAda: shown.amountAda },
    Date.now(),
  );
  if (verdict === 'expired') throw new Error(t('card.paymentExpired'));
  if (verdict === 'changed') {
    if (await loadDetails()) refreshed.value = true;
    throw new Error(t('card.paymentDetailsRefreshed'));
  }
  if (verdict !== 'ok') throw new Error(t('errors.invalidPaymentDetails'));

  const lovelace = lovelaceFromAda(shown.amountAda);
  if (lovelace === null) throw new Error(t('errors.invalidAmount'));
  const outputs: Cardano.TxOut[] = [
    { address: shown.depositAddress, value: { coins: lovelace as Cardano.Lovelace, assets: new Map() } },
  ];
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

function onSubmitted(): void {
  done.value = true;
  emit('success');
}

function close(): void {
  if (busy.value) return;
  emit('close');
}

watch(
  () => props.open,
  async open => {
    signSection.value?.reset();
    details.value = null;
    done.value = false;
    refreshed.value = false;
    if (!open || !props.orderUuid) return;
    loading.value = true;
    try {
      if (!(await loadDetails())) emit('close');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
.pay-order {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-2) 0;
}

.pay-order__loading {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.pay-order__skeleton {
  height: 160px;
}

.pay-order__refreshed {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: 0;
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-control);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  color: var(--g-text-1);

  .v-icon {
    color: var(--g-warning);
  }
}

.pay-order__actions {
  display: flex;
  justify-content: flex-end;
}
</style>
