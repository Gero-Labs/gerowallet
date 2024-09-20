<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Transaction Summary" ref="popupHeader" :show-website="!(this.$route.query['website'] === 'undefined' || Object.keys(this.$route.query).length === 0)" :disabled="txSignLoading">
      <v-card-text class="d-flex flex-column justify-space-between pa-0" style="flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;">
        <DappAddress class="mb-2" :address="recipient" :risk="risks?.addressRisk" />
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true">
          You're giving
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                mdi-information-outline
              </v-icon>
            </template>
            <div>
              <span>{{ networks.resolveCurrencyTicker(loggedWallet.chain, loggedWallet.network) }} and/or tokens<br>shown here will be </span>
              <span class="warn">sent<br>from your wallet</span>
              <span> to the<br>address listed above.
                <br /><br />Once signed, this action<br>is irreversible.</span>
            </div>
          </v-tooltip>
        </TransactionCard>
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.receive" :risk="risks?.receivingRisk">
          You're receiving
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                mdi-information-outline
              </v-icon>
            </template>
            <div>
              <span>{{ networks.resolveCurrencyTicker(loggedWallet.chain, loggedWallet.network) }} and/or tokens<br>shown here will be </span>
              <span class="succ">sent<br />to your wallet.</span>
              <span><br /><br />Once signed, this action<br>is irreversible.</span>
            </div>
          </v-tooltip>
        </TransactionCard>
        <v-row no-gutters style="flex: none;">
          <v-col cols="12" class="justify-center text-center">
            <TransactionRisk :risk="risks?.score" :loading="loading" />
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions class="justify-center pa-0 pt-2">
        <v-layout>
          <v-row>
            <v-col cols="12" v-if="loggedWallet.type === WalletType.Normal">
              <v-tooltip
                v-model="tooltip.enabled"
                top
                color="red"
              >
                <template v-slot:activator="{ }">
                  <v-text-field
                    class="w-100"
                    block
                    dense
                    v-model="spendingPassword"
                    outlined
                    hide-details
                    placeholder="Type your spending password"
                    label="Spending Password"
                    :type="showPassword ? 'text' : 'password'"
                    :rules="[rules.required]"
                    required
                    @keydown.enter.stop="sign"
                  >
                    <template v-slot:append>
                      <v-icon @click="showPassword = !showPassword" tabindex="-1">
                        {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                      </v-icon>
                    </template>
                  </v-text-field>
                </template>
                <span>{{ tooltip.text }}</span>
              </v-tooltip>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Ledger" class="py-0">
              <v-alert type="warning" outlined prominent class="py-2 my-1" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  Please review the transaction details carefully before proceeding. Confirm the transaction by signing with your
                {{ loggedWallet.type }} device.
                </span>
              </v-alert>
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <USBBluetoothSwitch v-model="isBT" :disabled="txSignLoading" />
              </v-card-subtitle>
            </v-col>
            <v-col cols="6">
              <v-btn block outlined color="red" class="capitalize" @click="decline" :disabled="txSignLoading">
                Decline
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn block class="geroButton" style="color: black!important;" @click="sign" :disabled="!valid || txSignLoading" :loading="txSignLoading">
                {{txAutoSubmit ? 'Sign & Confirm' : !witnesses ? 'SIGN' : 'CONFIRM'}}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
    </PopupHeader>
  </v-form>
</template>
<script>
import { appWallet, useStore } from '@/store';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { TxSignError } from '@/chrome/config';
import rules from '@/shared/utils/rules';
import {
  BigNum,
  decode_metadatum_to_json_str,
  Transaction, Value,
} from '@emurgo/cardano-serialization-lib-browser';
import { mapActions, mapState } from 'pinia';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import {
  cardanoValueFromRemoteFormat,
  diffAssetsFromIncomingToOutgoing,
  getAssetsFromMultiAsset, getPayAndReceiveTokens,
} from '@/shared/utils/builder';
import networks from '@/shared/utils/networks';
import { WalletType } from '@/models/types';
import USBBluetoothSwitch from '@/shared/components/USBBluetoothSwitch.vue';
import snackbar from '@/plugins/snackbar';
import { walletConfigStore } from '@/store/modules/walletConfig';

export default {
  name: 'DappConnect',
  components: { USBBluetoothSwitch, TransactionRisk, TransactionCard, DappAddress, PopupHeader },
  data() {
    return {
      isBT: false,
      networks,
      risks: undefined,
      rules,
      spendingPassword: '',
      showPassword: false,
      request: null,
      tx: undefined,
      valid: false,
      tooltip: {
        enabled: false,
        text: 'Wrong Spending Password!',
      },
      txSignLoading: false,
      loading: true,
      controller: Messaging.createInternalController(),
      witnesses: undefined
    };
  },
  computed: {
    WalletType() {
      return WalletType
    },
    txAutoSubmit: {
      get() {
        return this.getTxAutoSubmit
      },
      async set(val) {
        await this.setTxAutoSubmit(val)
      }
    },
    ...mapState(useStore, ['loggedWallet', 'baseAddress']),
    ...mapState(walletConfigStore, ['config', 'utxos', 'addresses', 'getTxAutoSubmit']),
    txFee() {
      return this.tx ? this.tx.body().fee().to_str() : null;
    },
    txMetadata() {
      if (this.tx) {
        const metadata = this.tx.auxiliary_data()?.metadata();
        if (metadata) {
          const json = {};
          const keys = metadata.keys();
          for (let i = 0; i < keys.len(); i++) {
            const key = keys.get(i);
            json[key.to_str()] = JSON.parse(decode_metadatum_to_json_str(metadata.get(key), 1));
          }
          return json;
        }
      }
      return null;
    },
    certificate() {
      return this.tx?.body().certs() || null;
    },
    withdrawals() {
      return this.tx?.body().withdrawals() || null;
    },
    minting() {
      return this.tx?.body().mint() || null;
    },
    script() {
      return this.tx?.witness_set().native_scripts() || null;
    },
    inputs() {
      return this.tx?.body().inputs() || null;
    },
    outputs() {
      return this.tx?.body().outputs() || null;
    },
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

      return {
        give: {
          total: Number(0 - totalGive),
          txFee: this.txFee,
          provider: networks.resolveCurrencySymbol(this.loggedWallet.chain, this.loggedWallet.network),
          assets: assetsGive,
        },
        receive: {
          total: totalReceive,
          provider: networks.resolveCurrencySymbol(this.loggedWallet.chain, this.loggedWallet.network),
          assets: assetsReceive,
        },
        recipient: this.recipient,
        txMetadata: this.txMetadata,
        queryParams: undefined,
      };
    },
  },
  methods: {
    ...mapActions(walletConfigStore, ['setTxAutoSubmit']),
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async decline() {
      await this.controller.returnData({ data: undefined, error: TxSignError.UserDeclined });
      window.close();
    },
    async sign() {
      if (!this.txAutoSubmit && this.witnesses) {
        await this.confirm()
      }
      const signAndReturnTx = async () => {
        this.txSignLoading = true
        try {
          const txCbor = this.request.data.tx
          const partialSign = this.request.data.partialSign
          const response = await appWallet.signTx(
            txCbor,
            partialSign,
            this.spendingPassword,
            0,
            this.utxos,
            this.addresses,
            !this.isBT
          );
          console.log(response)
          this.witnesses = response.witnesses
          if (this.txAutoSubmit) {
            await this.confirm()
          }
        } catch (e) {
          console.log(e)
          snackbar.setError(e)
        }
        this.txSignLoading = false
      };
      if (appWallet.type === WalletType.Normal) {
        if (this.$refs.form.validate()) {
          if (appWallet.verifySpendingPassword(this.spendingPassword)) {
            await signAndReturnTx();
          } else {
            this.enableToolTip();
          }
        }
      } else {
        await signAndReturnTx();
      }
    },
    async confirm() {
      await this.controller.returnData({ data: this.witnesses, error: undefined });
      window.close();
    }
  },
  async created() {
    let txCbor;
    this.request = await this.controller.requestData();
    // this.request = {
    //   data: {
    //     tx: '84a8008182582071275b5db86a1f4cc6ed5d32967183e41692c5449df107edff03c6ad75515a1701018483581d7186ae9eebd8b97944a45201e4aec1330a72291af2d071644bba0159591a00d59f80582068a52b298166998c9173f81120d4111abf732282fbe8a8d4c75220068425cef282583901ffebcc9e31749eb5803e396202d84e3b436ec362463b2fd70fb4c8819086fc9117b2dadb43da1f922c46039a47d51bff09433dcdd18f1cce1a000f4240825839010bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb2658244028cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af751a001e8480825839010bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb2658244028cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af751b00000006b0e6de77021a00036415031a080b3179075820f346d417038705eafb6b09d0a9bd27aebfa05cf793074e1f6db1777db8ca93f3081a080b23690b58209862196cc4b921b6854818fbf530babc8b229b3dc46054510666ac471b3a68c10e82581c0bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb26582440581c28cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af75a1049fd8799fd8799fd8799fd8799f581c0bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb26582440ffd8799fd8799fd8799f581c28cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af75ffffffff581c0bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb265824401b00000191fcaea026d8799fd8799f4040ffd8799f581c10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6444745524fffffffd8799fd879801a4e5da6b9fffffff5a11902a2a1636d7367826f44657868756e74657220547261646571506172746e65722044455848554e544552'
    //   }
    // }
    if (this.request?.data?.tx) {
      txCbor = this.request.data.tx
    }
    if (txCbor) {
      console.log(txCbor)
      this.tx = Transaction.from_bytes(Buffer.from(txCbor, 'hex'));
      this.queryParams = this.$route.query;
      try {
        this.risks = await appWallet.api.scanTx({
          cborHex: txCbor,
          toAddress: this.recipient,
          fromAddress: this.changeAddress,
          url: this.queryParams['website'],
        });
      } catch (e) {
        this.risks = {
          addressRisk: 'unknown',
        };
      }
      this.loading = false;
    }
  },
};
</script>

<style scoped>
.warn {
  color: #FF7777;
  font-size: 14px;
  font-weight: 900;
  line-height: 14px;
}

.succ {
  color: #00C77A;
  font-size: 14px;
  font-weight: 900;
  line-height: 14px;
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

.w-100 {
  width: 100%;
}
</style>
