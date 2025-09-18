<template>
  <v-tab-item>
    <v-card flat class="transparent">
      <v-card-title class="px-0 text-left">
        Setting Collateral for Smart Contract Interactions
      </v-card-title>
      <v-card-subtitle class="px-0 text-left">
        Gero automatically manages collateral using a UTxO with no tokens and a value between 5 and 20.
        If none is available, use the 'Set Collateral' button to manually assign one.
      </v-card-subtitle>
      <v-card-text class="text-left px-0">
        <v-data-table class="transparent" :items="collateralCandidate" :headers="headers" hide-default-footer disable-pagination :header-props="{ 'sort-icon': 'mdi-menu-up' }">
          <template v-slot:[`item.utxo`]="{ item }">
            <span class="mr-1">{{ filters.truncate(`${item.utxo}`) }}</span>
            <CopyButton x-small :value="`${item.utxo}`"></CopyButton>
          </template>
          <template v-slot:[`item.address`]="{ item }">
            <span class="mr-1">{{ filters.truncate(`${item.address}`) }}</span>
            <CopyButton x-small :value="`${item.address}`"></CopyButton>
          </template>
          <template v-slot:[`item.balance`]="{ item }">
            <span>{{ filters.toCurrency(`${item.balance}`, false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 6) }}</span>
          </template>
        </v-data-table>
        <v-row no-gutters class="mt-4">
          <v-col cols="9" class="text-left">
          </v-col>
          <v-col cols="3" class="text-right">
            <v-btn
              large
              class="geroButton"
              style="color: black!important;"
              :disabled="collateralCandidate.length !== 0"
              @click="setCollateral"
            >
              Set Collateral
            </v-btn>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>
  </v-tab-item>
</template>
<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
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
const headers = ref([
  {text: 'UTxO', sortable: false, value: 'utxo'},
  {text: 'Address', sortable: false, value: 'address'},
  {text: 'Balance', sortable: false, value: 'balance'},
]);

const collateralCandidate = computed<any>(() => {
  if (collateral.value) {
    return [collateral.value].map((utxo: Cardano.Utxo) => ({
      utxo: `${utxo[0].txId}#${utxo[0].index}`,
      address: utxo[1].address,
      balance: utxo[1].value.coins.toString()
    }));
  }
  return [];
});

// Methods
const setCollateral = async () => {
  try {
    // Check if we have epoch parameters
    if (!epochParams.value) {
      throw new Error('Epoch parameters not available');
    }

    // Create a collateral output of 5 ADA
    const collateralOutput: Cardano.TxOut = {
      address: loggedWallet.value.baseAddress as Cardano.PaymentAddress,
      value: {
        coins: BigInt(5000000) // 5 ADA
      }
    };

    // Build the transaction using the modern SDK
    const txData = await buildCardanoTransaction({
      outputs: [collateralOutput],
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value
    });

    // Convert to CBOR for signing
    const transaction: Serialization.Transaction = Serialization.Transaction.fromCore(txData)
    const txCbor = transaction.toCbor();

    const signaturesRes: any = await Messaging.sendToBackground({
      method: METHOD.signTx,
      data: { tx: txCbor, partialSign: true, mergeWitnesses: false },
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
  } catch (error) {
    console.error('Error building collateral transaction:', error);
    snackbar.setError('Failed to build collateral transaction');
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
  snackbar.fireSuccess(`Collateral Tx Set Successfully. Tx ID: ${txId}`);
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
