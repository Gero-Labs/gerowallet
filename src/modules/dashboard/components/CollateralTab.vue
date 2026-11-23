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
      :is-open="!!review"
      :tx="review?.tx"
      :collateral-output="review?.output"
      @close="closeSignDialog"
      @success="onCollateralSubmitted"
    />
  </v-window-item>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, shallowRef, toRefs, computed, onMounted, onScopeDispose, watch } from 'vue';
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
const collateralAmount = 5_000_000n;
const review = shallowRef<{ tx: Cardano.Tx; output: Cardano.TxOut }>();
let pendingBuild: AbortController | undefined;

const hasNewCollateralFeature = computed(() => isFeatureNew('settings.collateral.autoDetect'));

onMounted(() => {
  if (hasNewCollateralFeature.value) {
    markFeatureAsSeen('settings.collateral.autoDetect');
  }
});

const closeSignDialog = () => {
  pendingBuild?.abort();
  pendingBuild = undefined;
  isCreating.value = false;
  review.value = undefined;
};

watch([
  () => loggedWallet.value?.id, () => loggedWallet.value?.accountIndex,
  () => loggedWallet.value?.chain, () => loggedWallet.value?.network,
  () => loggedWallet.value?.baseAddress, () => walletStore.isLocked,
], closeSignDialog, { flush: 'sync' });
onScopeDispose(closeSignDialog);

const setCollateral = async () => {
  if (isCreating.value || review.value || walletStore.isLocked) return;
  const wallet = loggedWallet.value;
  const changeAddress = keys.value?.payment?.[0]?.address;
  if (!wallet?.baseAddress || !changeAddress) {
    snackbar.setError(t('settings.failedToBuildCollateral'));
    return;
  }
  const address = wallet.baseAddress;
  const build = new AbortController();
  pendingBuild = build;
  isCreating.value = true;
  try {
    // Build the request for nexus's /api/tx/build endpoint.
    // Server-side building means: nexus owns coin selection, fresh protocol params,
    // and canonical fee calculation. The wallet only signs and submits.
    const request: BuildTxRequest = {
      outputs: [
        {
          address,
          lovelace: collateralAmount.toString(),
        },
      ],
      changeAddress,
      utxos: walletUtxosToNexusInputs(utxos.value as Cardano.Utxo[], undefined, false),
      withdrawals: currentRewardWithdrawals(),
    };

    const { tx_cbor: txCborHex } = await nexusTxApi.buildTransferTx(
      request,
      wallet.network,
      { signal: build.signal },
    );

    if (build.signal.aborted) return;
    if (!txCborHex) throw new Error('Nexus returned an empty transaction CBOR');

    // Sign and submit in-wallet (SetCollateralDialog → useTransactionSigning), like the
    // staking and governance flows. The dApp CIP-30 signTx route refuses the wallet's own
    // pages (it only serves whitelisted dApp origins), which surfaced as
    // "The request was refused due to lack of access" (issue 1558).
    const tx = Serialization.Transaction.fromCbor(HexBlob(txCborHex)).toCore();
    // The change output may come first and may use the very same address.
    const output = tx.body.outputs.find(out =>
      out.address === address && out.value.coins === collateralAmount && !out.value.assets?.size);
    if (!output) throw new Error('The built transaction has no matching pure-ADA collateral output');
    review.value = { tx, output };
  } catch (error) {
    if (build.signal.aborted) return;
    console.error('Error building collateral transaction via nexus:', error);
    const err = error as { response?: { status?: number; data?: { error?: string; message?: string } }; message?: string };
    const status = err.response?.status;
    const insufficientFunds = [err.message, err.response?.data?.message, err.response?.data?.error]
      .some(message => typeof message === 'string' && /insufficient/i.test(message));
    if (status === 401 || status === 429) {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    } else if (insufficientFunds) {
      snackbar.setError(t('settings.insufficientAdaForCollateral'));
    } else {
      snackbar.setError(t('settings.failedToBuildCollateral'));
    }
  } finally {
    if (pendingBuild === build) {
      pendingBuild = undefined;
      isCreating.value = false;
    }
  }
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
