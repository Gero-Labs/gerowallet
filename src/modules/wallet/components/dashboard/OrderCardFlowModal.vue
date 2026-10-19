<template>
  <BaseDialog
    :isOpen="open"
    :title="title"
    :subtitle="subtitle"
    :width="680"
    :min-height="0"
    :persistent="locked"
    @close="close"
  >
    <template #art>
      <IsoScene :name="art" />
    </template>

    <div class="order-flow">
      <CardSteps
        v-if="selectedType === 'physical' && step > 1"
        compact
        :steps="stepLabels"
        :current="step === 5 ? 5 : step - 1"
        :label="t('card.orderYourGeroCard')"
      />

      <!-- Asking Zione which cardholder details it still needs -->
      <div v-if="checkingDetails" class="order-flow__checking" role="status">
        <v-progress-circular indeterminate size="28" width="3" />
        <span class="t-body-sm">{{ t('card.details.checking') }}</span>
      </div>

      <!-- 0. Missing cardholder details: Zione refuses any order until they are filled -->
      <template v-else-if="step === 0">
        <CardholderDetailsStep ref="detailsStep" :fields="missingFields" :still-missing="detailsStillMissing" />
        <div class="order-flow__actions">
          <GButton tier="secondary" :disabled="savingDetails" @click="close">{{ t('common.cancel') }}</GButton>
          <GButton tier="primary" :loading="savingDetails" @click="saveDetails">{{ t('card.details.saveAndContinue') }}</GButton>
        </div>
      </template>

      <!-- 1. Card type -->
      <template v-else-if="step === 1">
        <CardTypeSelectionStep
          :selected-type="selectedType || undefined"
          :has-virtual-card="hasVirtualCard"
          :has-physical-card="hasPhysicalCard"
          @select="selectType"
        />
        <CardDetailsRejectedNotice v-if="rejectedReason !== null" :reason="rejectedReason" />
        <div class="order-flow__actions">
          <GButton tier="secondary" @click="close">{{ t('common.cancel') }}</GButton>
          <GButton tier="primary" :disabled="!selectedType" :loading="orderingVirtual" @click="continueFromType">
            {{ t('card.continueButton') }}
          </GButton>
        </div>
      </template>

      <!-- 2. Address -->
      <template v-else-if="step === 2">
        <ShippingAddressSelectionStep
          ref="addressStep"
          :address="address"
          :known="knownAddress || undefined"
          @update:address="address = $event"
        />
        <div class="order-flow__actions">
          <GButton tier="secondary" @click="step = 1">{{ t('common.back') }}</GButton>
          <GButton tier="primary" @click="continueFromAddress">{{ t('card.continueButton') }}</GButton>
        </div>
      </template>

      <!-- 3. Shipping method -->
      <template v-else-if="step === 3">
        <ShippingMethodStep :selected-method="shippingMethod" @select="shippingMethod = $event" />
        <div class="order-flow__actions">
          <GButton tier="secondary" @click="step = 2">{{ t('common.back') }}</GButton>
          <GButton tier="primary" :loading="loadingRate" @click="continueFromShipping">{{ t('card.continueButton') }}</GButton>
        </div>
      </template>

      <!-- 4. Delivery fee: place the order first, then pay the exact quote -->
      <template v-else-if="step === 4">
        <DeliveryFeePanel
          v-if="placed"
          :amount-ada="parseFloat(placed.amountAda)"
          :amount-eur="placed.amountEur"
          :address="placed.depositAddress"
          :expires-at="placed.expiresAt || undefined"
        />
        <DeliveryFeePanel v-else :amount-ada="estimatedAda ?? undefined" :amount-eur="STANDARD_FEE_EUR" estimate />

        <template v-if="placed">
          <CardPhases v-if="signBusy" :phases="payPhases" :current="signPhase + 1" />
          <CardSignSection
            ref="signSection"
            :label="t('card.confirmPayment')"
            :prepare="prepareFeeTx"
            @busy="signBusy = $event"
            @submitted="onSubmitted"
          />
          <p class="t-caption order-flow__later">{{ t('card.payLaterNote') }}</p>
        </template>
        <CardDetailsRejectedNotice v-if="!placed && rejectedReason !== null" :reason="rejectedReason" />
        <div v-if="!placed" class="order-flow__actions">
          <GButton tier="secondary" :disabled="placing" @click="step = 3">{{ t('common.back') }}</GButton>
          <GButton tier="primary" :loading="placing" @click="placeOrder">{{ t('card.placeOrder') }}</GButton>
        </div>
      </template>

      <!-- 5. Done -->
      <template v-else>
        <PaymentConfirmationStep />
        <div class="order-flow__actions">
          <GButton tier="primary" @click="close">{{ t('common.done') }}</GButton>
        </div>
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
import type { IsoSceneName } from '@/shared/components/iso/isoScenes';
import cardStore from '@/stores/modules/card';
import { providerReason } from '@/stores/modules/cardApiErrors';
import { walletStore } from '@/stores/walletStore';
import snackbar from '@/plugins/snackbar';
import { nexusTxApi, walletUtxosToNexusInputs, txOutToNexusOutput, requiredAssetsFromOutputs, type BuildTxRequest } from '@/api/nexus-tx-api';
import { isCardDepositAddress, networkIdOfAddress } from '@/modules/wallet/utils/cardDepositAddress';
import { checkDeliveryPayment } from '@/modules/wallet/utils/cardDeliveryPayment';
import {
  emptyAddress, isMissingDetailsRejection, isStoredDetailsRejection, lovelaceFromAda, savedDeliveryAddress,
  toOrderPayload, toProviderAddress,
  type KnownAddress, type ShippingAddress, type ShippingMethod,
} from '@/modules/wallet/utils/cardOrder';
import type { CardholderField, DetailsSaveResult } from '@/modules/wallet/utils/cardholderDetails';
import CardSteps from '../ui/CardSteps.vue';
import CardPhases from '../ui/CardPhases.vue';
import CardSignSection from '../ui/CardSignSection.vue';
import CardholderDetailsStep from './card-order-steps/CardholderDetailsStep.vue';
import CardDetailsRejectedNotice from './card-order-steps/CardDetailsRejectedNotice.vue';
import CardTypeSelectionStep from './card-order-steps/CardTypeSelectionStep.vue';
import ShippingAddressSelectionStep from './card-order-steps/ShippingAddressSelectionStep.vue';
import ShippingMethodStep from './card-order-steps/ShippingMethodStep.vue';
import DeliveryFeePanel from './card-order-steps/DeliveryFeePanel.vue';
import PaymentConfirmationStep from './card-order-steps/PaymentConfirmationStep.vue';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();

/** Standard delivery, in EUR. Express prices are not published yet. */
const STANDARD_FEE_EUR = 10;
/** Details older than this are re-read before paying (the address rotates hourly). */
const FRESH_FOR_MS = 5 * 60 * 1000;

interface PlacedOrder {
  orderUuid: string;
  depositAddress: Cardano.PaymentAddress;
  /** The provider's quote, kept as its decimal string. */
  amountAda: string;
  amountEur: number;
  expiresAt: string | null;
  readAt: number;
}

/** 0 is the missing-details step, which Zione requires before any order. */
const step = ref<0 | 1 | 2 | 3 | 4 | 5>(1);
const checkingDetails = ref(false);
const missingFields = ref<CardholderField[]>([]);
const detailsStillMissing = ref(false);
const savingDetails = ref(false);
/** Where a details save returns to: the card types, or the order that was refused. */
const resumeStep = ref<1 | 4>(1);
/** The home address saved in this flow, offered for delivery. */
const residential = ref<ShippingAddress | null>(null);
/** Zione's reason when it refused characters in details it already holds; null otherwise. */
const rejectedReason = ref<string | null>(null);
let detailsCheck = 0;
const selectedType = ref<'virtual' | 'physical' | null>(null);
const address = ref<ShippingAddress>(emptyAddress());
const shippingMethod = ref<ShippingMethod>('regular');
const placed = ref<PlacedOrder | null>(null);
const orderingVirtual = ref(false);
const loadingRate = ref(false);
const placing = ref(false);
const signBusy = ref(false);
const signPhase = ref(0);
const addressStep = ref<{ validate: () => Promise<boolean> } | null>(null);
const detailsStep = ref<{ save: () => Promise<DetailsSaveResult | null> } | null>(null);
const signSection = ref<{ reset: () => void } | null>(null);

const cards = computed(() => cardStore.state.cards || []);

/** The address to offer for delivery: the home address saved in this flow, else the last delivery. */
const knownAddress = computed<KnownAddress | null>(() => {
  if (residential.value) return { source: 'residential', address: toProviderAddress(residential.value) };
  const delivered = savedDeliveryAddress(cards.value);
  return delivered ? { source: 'delivery', address: toProviderAddress(delivered) } : null;
});

const hasVirtualCard = computed(() =>
  cards.value.some(card =>
    card.cardData?.own_type === 'virtual' &&
    !!(card.cardData.card_uuid || card.cardData.order_uuid) &&
    card.cardData.status?.toLowerCase() !== 'rejected',
  ),
);

// An unpaid or failed delivery fee leaves the physical card orderable again.
const hasPhysicalCard = computed(() =>
  cards.value.some(card => {
    const data = card.cardData;
    if (data?.own_type !== 'physical' || data.status?.toLowerCase() === 'rejected') return false;
    if (data.card_uuid) return true;
    if (!data.order_uuid) return false;
    const payment = data.delivery?.payment_status?.toLowerCase();
    return !!payment && !['pending', 'failed', 'expired'].includes(payment);
  }),
);

const locked = computed(() => placing.value || signBusy.value || orderingVirtual.value || savingDetails.value);

const stepLabels = computed(() => [
  t('card.cardType'), t('card.shippingAddress'), t('card.shippingMethod'), t('card.paymentDetails'), t('card.confirm'),
]);
const payPhases = computed(() => [t('card.placingOrder'), t('card.buildingTransaction'), t('card.signingAndSubmitting')]);

const title = computed(() => {
  if (checkingDetails.value) return t('card.orderYourGeroCard');
  switch (step.value) {
    case 0: return t('card.details.title');
    case 2: return t('card.whereToShipCard');
    case 3: return t('card.selectShippingMethod');
    case 4: return t('card.shippingFeePayment');
    case 5: return t('card.paymentConfirmed');
    default: return t('card.orderYourGeroCard');
  }
});

const subtitle = computed(() => {
  if (checkingDetails.value) return '';
  switch (step.value) {
    case 0: return t('card.details.subtitle');
    case 3: return t('card.selectDeliverySpeed');
    case 4: return t('card.reviewPaymentDetails');
    case 5: return t('card.orderPlacedSuccessfully');
    case 2: return '';
    default: return t('card.chooseOptionBelow');
  }
});

const art = computed<IsoSceneName>(() => {
  if (checkingDetails.value) return 'verify';
  switch (step.value) {
    case 0: return 'verify';
    case 2: return 'shipping';
    case 3: return 'physical';
    case 4: return 'payment';
    case 5: return 'approved';
    default: return selectedType.value === 'physical' ? 'physical' : 'virtual';
  }
});

const estimatedAda = computed(() => {
  const rate = parseFloat(String(cardStore.state.exchangeRate?.buy ?? ''));
  return Number.isFinite(rate) && rate > 0 ? STANDARD_FEE_EUR / rate : null;
});

const walletNetworkId = () => networkIdOfAddress(walletStore.loggedWallet.baseAddress);

/**
 * Asks Zione which cardholder details it still needs and, when any are missing, starts on the
 * details step. A failed check lets the flow go on: Zione still refuses an incomplete order
 * with its own reason, which {@link explainOrderFailure} turns into the same step.
 */
async function checkDetails(): Promise<void> {
  const run = ++detailsCheck;
  checkingDetails.value = true;
  try {
    const missing = await cardStore.getMissingCardholderDetails();
    if (run !== detailsCheck) return;
    missingFields.value = missing;
    if (missing.length) step.value = 0;
  } catch {
    // Unknown is not "missing": the order itself reports what Zione needs.
  } finally {
    if (run === detailsCheck) checkingDetails.value = false;
  }
}

async function saveDetails(): Promise<void> {
  savingDetails.value = true;
  try {
    const result = await detailsStep.value?.save();
    if (!result) return;
    if (result.residential) residential.value = result.residential;
    if (result.remaining.length) {
      missingFields.value = result.remaining;
      detailsStillMissing.value = true;
      return;
    }
    missingFields.value = [];
    detailsStillMissing.value = false;
    snackbar.fireSuccess(t('card.details.saved'));
    step.value = resumeStep.value;
  } finally {
    savingDetails.value = false;
  }
}

function selectType(type: 'virtual' | 'physical'): void {
  selectedType.value = type;
  rejectedReason.value = null;
}

/**
 * Explains a refused order: details only Zione support can change get a notice with a way to
 * reach them, missing details send the user to the details step, anything else is a snackbar.
 */
async function explainOrderFailure(reason: string, refusedAt: 1 | 4): Promise<void> {
  if (isStoredDetailsRejection(reason)) {
    rejectedReason.value = reason;
    return;
  }
  if (isMissingDetailsRejection(reason)) {
    const run = detailsCheck;
    const missing = await cardStore.getMissingCardholderDetails().catch(() => [] as CardholderField[]);
    // The modal was reset (closed, or closed and reopened) while this was in flight.
    if (run !== detailsCheck || !props.open) return;
    if (missing.length) {
      missingFields.value = missing;
      detailsStillMissing.value = false;
      resumeStep.value = refusedAt;
      step.value = 0;
      snackbar.setError(t('card.details.neededToOrder'));
      return;
    }
  }
  snackbar.setError(`${t('card.failedToOrderCard')} ${reason || t('card.pleaseTryAgain')}`);
}

async function continueFromType(): Promise<void> {
  rejectedReason.value = null;
  if (selectedType.value === 'physical') {
    address.value = knownAddress.value ? { ...knownAddress.value.address } : emptyAddress();
    step.value = 2;
    return;
  }
  if (selectedType.value !== 'virtual') return;
  orderingVirtual.value = true;
  try {
    await cardStore.orderCard();
    snackbar.fireSuccess(t('card.cardOrderedSuccess'));
    orderingVirtual.value = false;
    close();
  } catch (error: unknown) {
    await explainOrderFailure(providerReason(error) || '', 1);
  } finally {
    orderingVirtual.value = false;
  }
}

async function continueFromAddress(): Promise<void> {
  const approvedAddress = JSON.stringify(address.value);
  if (await addressStep.value?.validate() && step.value === 2 && JSON.stringify(address.value) === approvedAddress) step.value = 3;
}

async function continueFromShipping(): Promise<void> {
  loadingRate.value = true;
  try {
    await cardStore.getExchangeRate();
  } catch {
    // The fee panel shows "—" for the estimate; the order quote is what gets paid.
  } finally {
    loadingRate.value = false;
  }
  step.value = 4;
}

async function placeOrder(): Promise<void> {
  placing.value = true;
  rejectedReason.value = null;
  try {
    const response = await cardStore.orderPhysicalCard(toOrderPayload(address.value, shippingMethod.value));
    const depositAddress = response?.depositAddress;
    const amountAda = String(response?.depositAmountAda ?? '');
    if (!response?.orderUuid || lovelaceFromAda(amountAda) === null) throw new Error(t('card.failedToGetPaymentDetails'));
    if (!isCardDepositAddress(depositAddress, walletNetworkId())) {
      // The order exists; never offer to pay an address that fails validation. The
      // dashboard re-reads the payment and offers it again if it becomes valid.
      snackbar.setError(t('errors.invalidAddress'));
      placing.value = false;
      close();
      return;
    }
    placed.value = {
      orderUuid: response.orderUuid,
      depositAddress,
      amountAda,
      amountEur: parseFloat(String(response.depositAmountEur ?? STANDARD_FEE_EUR)) || STANDARD_FEE_EUR,
      expiresAt: response.depositExpiresAt || null,
      readAt: Date.now(),
    };
  } catch (error: unknown) {
    await explainOrderFailure(providerReason(error) || (error instanceof Error ? error.message : ''), 4);
  } finally {
    placing.value = false;
  }
}

async function prepareFeeTx(): Promise<Cardano.Tx> {
  signPhase.value = 0;
  let order = placed.value;
  if (!order) throw new Error(t('errors.invalidOrder'));

  if (Date.now() - order.readAt > FRESH_FOR_MS) {
    const fresh = await cardStore.getDeliveryPayment(order.orderUuid);
    const verdict = checkDeliveryPayment(
      fresh,
      { depositAddress: order.depositAddress, depositAmountAda: order.amountAda },
      Date.now(),
    );
    if (verdict === 'expired') throw new Error(t('card.paymentExpired'));
    if (verdict === 'changed' && fresh && isCardDepositAddress(fresh.deposit_address, walletNetworkId())) {
      placed.value = {
        ...order,
        depositAddress: fresh.deposit_address,
        amountAda: String(fresh.amount_ada),
        amountEur: parseFloat(String(fresh.amount_eur ?? order.amountEur)) || order.amountEur,
        expiresAt: fresh.expires_at ?? null,
        readAt: Date.now(),
      };
      throw new Error(t('card.paymentDetailsRefreshed'));
    }
    if (verdict !== 'ok') throw new Error(t('errors.invalidPaymentDetails'));
    order = { ...order, readAt: Date.now() };
    placed.value = order;
  }

  const lovelace = lovelaceFromAda(order.amountAda);
  if (lovelace === null) throw new Error(t('errors.invalidAmount'));
  const outputs: Cardano.TxOut[] = [
    { address: order.depositAddress, value: { coins: lovelace as Cardano.Lovelace, assets: new Map() } },
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
  signPhase.value = 1;
  return Serialization.Transaction.fromCbor(HexBlob(txCbor)).toCore();
}

function onSubmitted(): void {
  step.value = 5;
  cardStore.fetchCardData().catch(() => undefined);
}

function reset(): void {
  detailsCheck++;
  checkingDetails.value = false;
  step.value = 1;
  missingFields.value = [];
  detailsStillMissing.value = false;
  resumeStep.value = 1;
  residential.value = null;
  rejectedReason.value = null;
  selectedType.value = null;
  address.value = emptyAddress();
  shippingMethod.value = 'regular';
  placed.value = null;
  signPhase.value = 0;
  signSection.value?.reset();
}

function close(): void {
  if (locked.value) return;
  reset();
  emit('close');
}

watch(
  () => props.open,
  open => {
    if (!open) return;
    reset();
    checkDetails();
  },
  { immediate: true },
);
</script>

<style lang="scss" scoped>
.order-flow {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-2) var(--g-s-2) 0;
}

.order-flow__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--g-s-3);
}

.order-flow__later {
  margin: 0;
  text-align: center;
}

.order-flow__checking {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-6) 0;
  color: var(--g-text-2);
}
</style>
