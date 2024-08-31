<template>
  <v-card flat class="transparent">
    <v-row no-gutters>
      <v-col cols="6">
        <v-card flat class="transparent">
          <v-card-title class="text-left">
            <Select
              :value="sendData.selectedWallet"
              :items="[sendData.selectedWallet]"
              label="From"
              :readonly="true"
            ></Select>
          </v-card-title>
          <v-card-text>
            <v-icon>mdi-arrow-down-thin</v-icon>
            <DappAddress class="mb-4" :address="sendData.recipientAddress" :risk="risks?.addressRisk" :with-bg="false"  />
            <v-icon>mdi-arrow-down-thin</v-icon>
            <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true" :with-bg="false">
              You're giving
              <v-tooltip bottom>
                <template v-slot:activator="{ on, attrs }">
                  <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                    mdi-information-outline
                  </v-icon>
                </template>
                <div>
                  <span v-if="loggedWallet">{{networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network)}} and/or tokens<br>shown here will be </span>
                  <span style="color: #FF7777">sent<br>from your wallet</span>
                  <span> to the<br>address listed above.<br /><br />Once signed, this action<br>is irreversible.</span>
                </div>
              </v-tooltip>
            </TransactionCard>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="6" style="align-content: center">
        <TransactionRisk class="pb-8" :risk="risks?.score" :loading="loading" />
      </v-col>
    </v-row>
  </v-card>
</template>
<script>
import Select from '@/shared/components/Select.vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import { BigNum, Value } from '@emurgo/cardano-serialization-lib-browser';
import { Buffer } from 'buffer';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import networks from '@/shared/utils/networks';
import {
  cardanoValueFromRemoteFormat,
  diffAssetsFromIncomingToOutgoing,
  getAssetsFromMultiAsset, getPayAndReceiveTokens,
} from '@/shared/utils/builder';

export default {
  components: { TransactionCard, DappAddress, TransactionRisk, Select },
  name: 'SummaryStep',
  props: {
    sendData: {
      type: Object,
      required: true,
    },
    txData: {
      type: Object,
    }
  },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'utxos', 'addresses', 'baseAddress']),
    changeAddress() {
      return this.baseAddress;
    },
    recipient() {
      if (this.tx) {
        const txBody = this.tx.body();
        for (let i = 0; i < txBody.outputs().len(); i++) {
          const keyAddress = txBody.outputs().get(i).address();
          const bech32Address = keyAddress.to_bech32();
          if (this.changeAddress !== bech32Address) {
            return bech32Address;
          }
        }
      }
      return this.changeAddress;
    },
    swapDetails() {
      if (!this.tx || !this.utxos || this.utxos.length === 0) {
        return null;
      }
      const txBody = this.tx.body();
      let inputValue = Value.new(BigNum.from_str('0'));
      for (let i = 0; i < txBody.inputs().len(); i++) {
        const input = txBody.inputs().get(i);
        const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
        const inputTxIndex = input.index();
        const utxo = this.utxos.find(utxo => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);
        if (utxo) {
          inputValue = inputValue.checked_add(cardanoValueFromRemoteFormat(utxo));
        }
      }

      const inputValueAssets = getAssetsFromMultiAsset(inputValue.multiasset());
      inputValueAssets.push(new AssetWithQuantity('cardano', inputValue.coin().to_str()));

      let outputValue = Value.new(BigNum.from_str('0'));
      for (let i = 0; i < txBody.outputs().len(); i++) {
        const output = txBody.outputs().get(i);
        const bech32Address = output.address().to_bech32();
        if (bech32Address === this.changeAddress) {
          outputValue = outputValue.checked_add(output.amount());
        }
      }

      const outputValueAssets = getAssetsFromMultiAsset(outputValue.multiasset());
      outputValueAssets.push(new AssetWithQuantity('cardano', outputValue.coin().to_str()));

      const diff = diffAssetsFromIncomingToOutgoing(inputValueAssets, outputValueAssets);
      const { payTokens, receiveTokens } = getPayAndReceiveTokens(diff);

      const totalGive = payTokens.find(token => token.name === 'cardano').amount;
      const assetsGive = payTokens.filter(token => token.name !== 'cardano').map(token => {
        return { amount: token.amount, currency: token.name };
      });

      const foundAda = receiveTokens.find(token => token.name === 'cardano');
      const totalReceive = foundAda ? foundAda.amount : 0;
      const assetsReceive = receiveTokens.filter(token => token.name !== 'cardano').map(token => {
        return { amount: token.amount, currency: token.name };
      });
      const txFee = this.tx.body().fee().to_str()
      return {
        give: {
          total: Number(0 - totalGive),
          txFee,
          provider: networks.resolveCurrencySymbol(this.loggedWallet?.chain, this.loggedWallet?.network),
          assets: assetsGive,
        },
        receive: {
          total: totalReceive,
          provider: networks.resolveCurrencySymbol(this.loggedWallet?.chain, this.loggedWallet?.network),
          assets: assetsReceive,
        },
        recipient: this.recipient,
        txMetadata: this.txMetadata,
      };
    },
  },
  methods: {
    async scanTx(txData) {
      this.loading = true
      this.tx = txData
      try {
        this.risks = await appWallet.api.scanTx({
          cborHex: txData.to_hex(),
          toAddress: this.sendData.recipientAddress,
          fromAddress: this.changeAddress,
          url: 'https://gerowallet.io',
        });
      } catch (e) {
        this.risks = {
          addressRisk: 'unknown',
        };
      }
      this.loading = false;
    }
  },
  data() {
    return {
      loading: false,
      tx: undefined,
      networks,
      risks: {
        score: undefined
      },
    };
  },
};
</script>

<style scoped>
.recipient-box {
  display: flex;
  gap: 10px;
  padding: 10px;
  word-break: break-all;
  font-size: 12px;
  background: linear-gradient(to right, #005d65, #0000003d);
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black!important;

  &:disabled {
    opacity: 0.5;
    color: black!important;
  }

}

.v-tooltip__content {
  background: rgba(15, 19, 21, 1);
  border:1px solid #C4C4C4;
  line-height: 18px;
  padding: 10px;
  font-size: 14px;
}
.v-tooltip__content.menuable__content__active {
  opacity: 1;
}
</style>
