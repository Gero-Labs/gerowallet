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
            <span class="mr-1">{{ `${item.tx_hash}#${item.tx_index}` | truncate }}</span>
            <CopyButton x-small :value="`${item.tx_hash}#${item.tx_index}`"></CopyButton>
          </template>
          <template v-slot:[`item.address`]="{ item }">
            <span class="mr-1">{{ `${item.payment_addr.bech32}` | truncate }}</span>
            <CopyButton x-small :value="`${item.payment_addr.bech32}`"></CopyButton>
          </template>
          <template v-slot:[`item.balance`]="{ item }">
            <span>{{ `${item.value}` | toCurrency(false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 6) }}</span>
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
<script>
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/stores';
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
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { Messaging } from '@/chrome/messaging';
// import { Cardano, Serialization } from '@cardano-sdk/core';
// import { assetsToValue, toUTxO } from '@/chrome/serialization';
// import { GenericTxBuilder } from '@cardano-sdk/tx-construction';
// import { TxBuilderDependencies } from '@cardano-sdk/tx-construction/dist/esm/tx-builder/types';
// import { TxBuilderProviders } from '@cardano-sdk/tx-construction/dist/esm/types';

export default {
  name: 'CollateralTab',
  components: { CopyButton },
  computed: {
    networks() {
      return networks
    },
    ...mapState(useStore, ['loggedWallet', 'baseAddress', 'latestTip']),
    ...mapState(walletConfigStore, ['utxos', 'collateral']),
    collateralCandidate() {
      if (this.collateral) {
        return [this.collateral]
      }
      return []
    }
  },
  filters,
  methods: {
    async setCollateral() {
      // const outputs: Serialization.TransactionOutput[] = []
      // outputs.push(new Serialization.TransactionOutput(Cardano.Address.fromBech32(this.baseAddress), assetsToValue([{ unit: 'lovelace', quantity: "5000000" }])))
      // const transactionUnspentOutputs: Serialization.TransactionUnspentOutput[] = []
      // this.utxos.forEach((utxo) => transactionUnspentOutputs.push(toUTxO(utxo)));
      // const txBuilderProviders: TxBuilderProviders
      // const txBuilderDependencies: TxBuilderDependencies = {
      //
      // }
      // const txBuilder: GenericTxBuilder = new GenericTxBuilder()

      // const txBody = buildTx(this.loggedWallet, outputs, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress);


      const outputs = TransactionOutputs.new();
      outputs.add(TransactionOutput.new(Address.from_bech32(this.baseAddress), assetsToValue([{ unit: 'lovelace', quantity: "5000000" }])));
      const transactionUnspentOutputs = TransactionUnspentOutputs.new();
      this.utxos.forEach((utxo) => transactionUnspentOutputs.add(toUTxO(utxo)));
      const txBody = buildTx(this.loggedWallet, outputs, transactionUnspentOutputs, this.latestTip.slot, this.baseAddress);
      const tx = Transaction.new(txBody, TransactionWitnessSet.new())
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
        const txId = await appWallet.submitTx(signedTx, this.utxos);
        console.log(txId)
        snackbar.fireSuccess(`Collateral Tx Set Successfully. Tx ID: ${txId}`)
        this.$emit('close')
        //TODO Wait for Collateral to load up in UI
      } else if (res.error) {
        snackbar.setError(res.error.info)
      }
    }
  },
  data: () => ({
    headers: [
      {text: 'UTxO', sortable: false, value: 'utxo'},
      {text: 'Address', sortable: false, value: 'address'},
      {text: 'Balance', sortable: false, value: 'balance'},
    ]
  }),
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
