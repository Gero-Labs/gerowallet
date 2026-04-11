<template>
  <v-tab-item>
    <v-card flat class="transparent">
      <v-card-title class="px-0 text-left d-flex align-center">
        <span>{{ $t('settings.whatIsCollateral') }}</span>
        <v-tooltip right max-width="320" content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <v-icon small class="ml-2" color="grey lighten-1" v-bind="attrs" v-on="on">
              mdi-information-outline
            </v-icon>
          </template>
          <span>{{ $t('settings.collateralTooltip') }}</span>
        </v-tooltip>
      </v-card-title>
      <v-card-subtitle class="px-0 text-left">
        {{ $t('settings.collateralDescription') }}
      </v-card-subtitle>

      <v-card-text class="text-left px-0">
        <!-- Status: auto-detected (success) -->
        <v-alert
          v-if="collateral"
          dense
          outlined
          color="success"
          icon="mdi-check-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralAutoDetected') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralAutoDetectedDesc') }}</div>
          <v-row no-gutters class="mt-3" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralAmount') }}:</v-col>
            <v-col cols="auto" class="font-weight-medium">
              {{ filters.toCurrency(collateral[1].value.coins.toString(), false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 6) }}
            </v-col>
          </v-row>
          <v-row no-gutters class="mt-1" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralUtxoRef') }}:</v-col>
            <v-col cols="auto" class="caption">
              {{ filters.truncate(`${collateral[0].txId}#${collateral[0].index}`) }}
            </v-col>
            <v-col cols="auto" class="ml-1">
              <CopyButton x-small :value="`${collateral[0].txId}#${collateral[0].index}`" />
            </v-col>
          </v-row>
        </v-alert>

        <!-- Status: not found (warning + setup action) -->
        <v-alert
          v-else
          dense
          outlined
          color="warning"
          icon="mdi-alert-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralNotFound') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralNotFoundDesc') }}</div>
          <div class="mt-3">
            <v-btn
              small
              class="geroButton"
              style="color: black!important;"
              :loading="isCreating"
              @click="setCollateral"
            >
              {{ $t('settings.setCollateral') }}
            </v-btn>
          </div>
        </v-alert>
      </v-card-text>
    </v-card>
  </v-tab-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, toRefs, computed, onMounted } from 'vue';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { METHOD } from '@/chrome/config';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import CopyButton from '@/shared/components/CopyButton.vue';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { MessageTypes } from '@/models/MessageTypes';
import { HexBlob } from '@cardano-sdk/util';

// Define emits
const emit = defineEmits(['close']);

// Get reactive store properties
const { loggedWallet, utxos, collateral, keys } = toRefs(walletStore);
const { tip, epochParams } = toRefs(networkStore);


// Reactive data
const { t } = useTranslation();

const isCreating = ref(false);

const hasNewCollateralFeature = computed(() => isFeatureNew('settings.collateral.autoDetect'));

onMounted(() => {
  if (hasNewCollateralFeature.value) {
    markFeatureAsSeen('settings.collateral.autoDetect');
  }
});

// Methods
const setCollateral = async () => {
  isCreating.value = true;
  try {
    // Check if we have epoch parameters
    if (!epochParams.value) {
      throw new Error(t('common.epochParametersNotAvailable'));
    }

    // Create a collateral output of 5 ADA
    const collateralOutput: Cardano.TxOut = {
      address: loggedWallet.value.baseAddress as Cardano.PaymentAddress,
      value: {
        coins: BigInt(5000000) // 5 ADA
      }
    };

    // Build the transaction using the modern SDK with wallet context for accurate fee calculation
    const txData = await buildCardanoTransaction({
      outputs: [collateralOutput],
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      walletContext: {
        keys: keys.value,
        stakeAddress: loggedWallet.value.stakeAddress,
        accountIndex: 0
      },
      excludeCollateral: false
    });

    // Convert to CBOR for signing
    const transaction: Serialization.Transaction = Serialization.Transaction.fromCore(txData)
    const txCbor = transaction.toCbor();

    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign: true, origin: 'https://gerowallet.io/', mergeWitnesses: false },
    });
    console.log('signaturesRes', signaturesRes)
    if (signaturesRes.error) {
      snackbar.setError(signaturesRes.error.info)
    } else {
      console.log(signaturesRes)
      const witnessSet = Serialization.TransactionWitnessSet.fromCbor(HexBlob(signaturesRes.data));
      const newTx: Serialization.Transaction = new Serialization.Transaction(transaction.body(), witnessSet)
      await submit(newTx.toCbor())
    }
  } catch (error: any) {
    console.error('Error building collateral transaction:', error);
    if (error.message?.includes('UTxO Balance Insufficient')) {
      snackbar.setError(t('settings.insufficientAdaForCollateral'));
    } else {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    }
  } finally {
    isCreating.value = false;
  }
};

const submit = async (cborHex: string) => {
  const submitResult = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_TX,
    data: {
      txCbor: cborHex,
      witnessHex: null,
      utxos: utxos.value
    }
  }) as { data: { txId?: string; error?: string } };
  if (submitResult.data.error) {
    throw new Error(submitResult.data.error);
  }
  const txId = submitResult.data.txId;
  snackbar.fireSuccess(t('settings.collateralTxSetSuccess', { txId }));
  console.log(txId)
  emit('close')
}
</script>

<style scoped>

.title {
  font-size: 18px;
  font-weight: 600;
  line-height: 28px;
  text-align: left;
}

.subtitle {
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  text-align: left;
  color: #94969C;
}

</style>
