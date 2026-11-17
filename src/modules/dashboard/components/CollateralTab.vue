<template>
  <v-window-item>
    <v-card flat class="transparent">
      <v-card-title class="px-0 text-left d-flex align-center">
        <span>{{ $t('settings.whatIsCollateral') }}</span>
        <v-tooltip location="end"  max-width="320" content-class="custom-tooltip">
          <template v-slot:activator="{ props: activatorProps }">
            <v-icon size="small" class="ml-2" color="grey lighten-1" v-bind="activatorProps" >
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
          density="compact"
          variant="outlined"
          color="success"
          icon="mdi-check-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralAutoDetected') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralAutoDetectedDesc') }}</div>
          <v-row no-gutters class="mt-3 align-center" >
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralAmount') }}:</v-col>
            <v-col cols="auto" class="font-weight-medium">
              {{ filters.toCurrency(collateral[1].value.coins.toString(), false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 6) }}
            </v-col>
          </v-row>
          <v-row no-gutters class="mt-1 align-center" >
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralUtxoRef') }}:</v-col>
            <v-col cols="auto" class="caption">
              {{ filters.truncate(`${collateral[0].txId}#${collateral[0].index}`) }}
            </v-col>
            <v-col cols="auto" class="ml-1">
              <CopyButton x-small :value="`${collateral[0].txId}#${collateral[0].index}`" />
            </v-col>
          </v-row>
        </v-alert>

        <!-- Status: no own collateral, Gero shared pool covers (info banner).
             We don't pre-fetch a Nexus UTxO — getCollateral() lends one on
             demand when a dApp asks. The setup button stays available for
             users who'd rather hold their own pure-ADA UTxO. -->
        <v-alert
          v-else
          density="compact"
          variant="outlined"
          color="info"
          icon="mdi-shield-check-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralGeroProvided') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralGeroProvidedDesc') }}</div>
          <div class="mt-3">
            <v-btn
              size="small"
              variant="text"
              class="px-2"
              :loading="isCreating"
              @click="setCollateral"
            >
              {{ $t('settings.setCollateral') }}
            </v-btn>
          </div>
        </v-alert>
      </v-card-text>
    </v-card>

    <SetCollateralDialog
      :is-open="signDialogOpen"
      :tx="collateralTx"
      @close="closeSignDialog"
      @success="onCollateralSubmitted"
    />
  </v-window-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, toRefs, computed, onMounted } from 'vue';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import CopyButton from '@/shared/components/CopyButton.vue';
import SetCollateralDialog from '@/modules/dashboard/dialogs/SetCollateralDialog.vue';
import snackbar from '@/plugins/snackbar';
import { walletStore } from '@/stores/walletStore';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { nexusTxApi, walletUtxosToNexusInputs, type BuildTxRequest } from '@/api/nexus-tx-api';
import { currentRewardWithdrawals } from '@/shared/utils/autoWithdraw';

// Define emits
const emit = defineEmits(['close']);

// Get reactive store properties
const { loggedWallet, utxos, collateral, keys } = toRefs(walletStore);


// Reactive data
const { t } = useTranslation();

const isCreating = ref(false);
const signDialogOpen = ref(false);
const collateralTx = ref<Cardano.Tx | undefined>(undefined);

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
    // Build the request for nexus's /api/tx/build endpoint.
    // Server-side building means: nexus owns coin selection, fresh protocol params,
    // and canonical fee calculation. The wallet only signs and submits.
    const request: BuildTxRequest = {
      outputs: [
        {
          address: loggedWallet.value.baseAddress as string,
          lovelace: '5000000', // 5 ADA collateral
        },
      ],
      changeAddress: keys.value.payment[0].address,
      utxos: walletUtxosToNexusInputs(utxos.value as Cardano.Utxo[], undefined, false),
      withdrawals: currentRewardWithdrawals(),
    };

    const { tx_cbor: txCborHex } = await nexusTxApi.buildTransferTx(
      request,
      loggedWallet.value.network
    );

    if (!txCborHex) throw new Error('Nexus returned an empty transaction CBOR');

    // Sign and submit in-wallet (SetCollateralDialog → useTransactionSigning), like the
    // staking and governance flows. The dApp CIP-30 signTx route refuses the wallet's own
    // pages (it only serves whitelisted dApp origins), which surfaced as
    // "The request was refused due to lack of access" (issue 1558).
    collateralTx.value = Serialization.Transaction.fromCbor(HexBlob(txCborHex)).toCore();
    signDialogOpen.value = true;
  } catch (error) {
    console.error('Error building collateral transaction via nexus:', error);
    const err = error as { response?: { status?: number; data?: { error?: string; message?: string } }; message?: string };
    const status = err.response?.status;
    const serverMsg = err.response?.data?.error || err.response?.data?.message;
    if (status === 401 || status === 429) {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    } else if (serverMsg && /insufficient/i.test(serverMsg)) {
      snackbar.setError(t('settings.insufficientAdaForCollateral'));
    } else if (err.message?.includes('UTxO Balance Insufficient')) {
      snackbar.setError(t('settings.insufficientAdaForCollateral'));
    } else {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    }
  } finally {
    isCreating.value = false;
  }
};

const closeSignDialog = () => {
  signDialogOpen.value = false;
  collateralTx.value = undefined;
};

const onCollateralSubmitted = () => {
  closeSignDialog();
  emit('close');
};
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
