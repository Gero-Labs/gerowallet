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
import { appWallet } from '@/stores';
import { buildTx } from '@/shared/utils/builder';
import {
  Address, Transaction,
  TransactionOutput,
  TransactionOutputs,
  TransactionUnspentOutputs, TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { assetsToValue, toUTxO } from '@/shared/utils/converter';
import { METHOD } from '@/chrome/config';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import CopyButton from '@/shared/components/CopyButton.vue';
import snackbar from '@/plugins/snackbar';
import { Messaging } from '@/chrome/messaging';
import { walletStore } from '@/plugins/walletStore';
import { networkStore } from '@/plugins/networkStore';
import { Cardano } from '@cardano-sdk/core';

// Define emits
const emit = defineEmits(['close']);

// Get reactive store properties
const { loggedWallet, config, utxos, collateral } = toRefs(walletStore);
const { tip } = toRefs(networkStore);


// Reactive data
const headers = ref([
  {text: 'UTxO', sortable: false, value: 'utxo'},
  {text: 'Address', sortable: false, value: 'address'},
  {text: 'Balance', sortable: false, value: 'balance'},
]);

const collateralCandidate = computed<any>(() => {
  if (collateral.value) {
    const res = [collateral.value].map((utxo: Cardano.Utxo) => ({
      utxo: `${utxo[0].txId}#${utxo[0].index}`,
      address: utxo[1].address,
      balance: utxo[1].value.coins.toString()
    }));
    console.log('Collateral', res);
    return res;
  }
  return [];
});

// Methods
const setCollateral = async () => {
  const outputs = TransactionOutputs.new();
  outputs.add(TransactionOutput.new(Address.from_bech32(baseAddress.value), assetsToValue([{ unit: 'lovelace', quantity: "5000000" }])));
  const transactionUnspentOutputs = TransactionUnspentOutputs.new();
  utxos.value.forEach((utxo: any) => transactionUnspentOutputs.add(toUTxO(utxo)));
  const txBody = buildTx(loggedWallet.value, outputs, transactionUnspentOutputs, latestTip.value.slot, baseAddress.value);
  const tx = Transaction.new(txBody, TransactionWitnessSet.new());

  const res = await Messaging.sendToBackground({
    method: METHOD.signTx,
    data: { tx: tx.to_hex(), partialSign: true },
  });

  if (res.data) {
    const signedTx = Transaction.new(
      tx.body(),
      TransactionWitnessSet.from_bytes(Buffer.from(res.data, "hex")),
      undefined // TODO Transaction metadata
    );
    const txId = await appWallet.submitTx(signedTx, utxos.value);
    console.log(txId);
    snackbar.fireSuccess(`Collateral Tx Set Successfully. Tx ID: ${txId}`);
    emit('close');
    //TODO Wait for Collateral to load up in UI
  } else if (res.error) {
    snackbar.setError(res.error.info);
  }
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
