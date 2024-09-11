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
              <span> to the<br>address listed above.<br /><br />Once signed, this action<br>is irreversible.</span>
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
              <span>{{ networks.resolveCurrencyTicker(loggedWallet.chain, loggedWallet.network) }} and/or tokens shown here will be </span>
              <span class="succ">sent to your wallet<br /><br /></span>
              <span>Once signed, this action is irreversible.</span>
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
                    @keydown.enter.stop="confirm"
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
              <v-btn block class="geroButton" style="color: black!important;" @click="confirm" :disabled="!valid || txSignLoading" :loading="txSignLoading">
                Sign & Confirm
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
  Transaction, TransactionWitnessSet,
  Value,
} from '@emurgo/cardano-serialization-lib-browser';
import { mapState } from 'pinia';
import { Buffer } from 'buffer';
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
    };
  },
  computed: {
    WalletType() {
      return WalletType
    },
    ...mapState(useStore, ['loggedWallet', 'utxos', 'addresses', 'baseAddress']),
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
        queryParams: undefined
      };
    },
  },
  methods: {
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
    async confirm() {
      const signAndReturnTx = async () => {
        this.txSignLoading = true
        try {
          const txCbor = this.request.data.tx
          const partialSign = this.request.data.partialSign
          // const txCbor = '84a90082825820117f3a40ad7ff8dd66af4e7bfbca6c310cc87f56ce5a127760bab77ac066466400825820020cf34e0333a1049279cdbd6d4966a561653e17b159df9a17575e09f5d76ef0010184a30058393184cc25ea4c29951d40b443b95bbc5676bc425470f96376d1984af9ab2c967f4bd28944b06462e13c5e3f5d5fa6e03f8567569438cd833e6d011a0011a008028201d818582258204ea1730fb6d01cca1fb672ec3422d30fb2b95deb79b7ed519aea3c628302ade7825839019f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799ab8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e531a00186a0082583901aea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ec2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e11a010980c0825839010bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb2658244028cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af75821b00000006b25f6871a1581c85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18a15244696d656e73696f6e426f7820233033343001021a0003ac72031a07feecf90b58201224772d32b8ca3901f6edb3c631e3f0a31d6defdd8938aedc74da3356f5fef80d81825820020cf34e0333a1049279cdbd6d4966a561653e17b159df9a17575e09f5d76ef00110825839010bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb2658244028cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af751b00000006b37c9830111a000582ab12818258201693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d00a20481d8799f9fd8799fd8799fd8799f581c9f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799abffd8799fd8799fd8799f581c8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e53ffffffff1a00186a00ffd8799fd8799fd8799f581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecffd8799fd8799fd8799f581c2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e1ffffffff1a010980c0ffff581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecff0581840001d8799f00ff821a000326a91a04555e60f5f6'
          // const partialSign = true
          const response = await appWallet.signTx(
            txCbor,
            partialSign,
            this.spendingPassword,
            0,
            this.utxos,
            Object.keys(this.addresses),
            !this.isBT
          );
          console.log(response)
          await this.controller.returnData({ data: response.witnesses, error: undefined });
          window.close();
        } catch (e) {
          snackbar.setError(e)
          console.log(e);
          await this.controller.returnData({ data: undefined, error: e });
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
    }
  },
  async created() {
    let txCbor;
    this.request = await this.controller.requestData();
    if (this.request?.data?.tx) {
      txCbor = this.request.data.tx
    }
    // txCbor = '84a90082825820117f3a40ad7ff8dd66af4e7bfbca6c310cc87f56ce5a127760bab77ac066466400825820020cf34e0333a1049279cdbd6d4966a561653e17b159df9a17575e09f5d76ef0010184a30058393184cc25ea4c29951d40b443b95bbc5676bc425470f96376d1984af9ab2c967f4bd28944b06462e13c5e3f5d5fa6e03f8567569438cd833e6d011a0011a008028201d818582258204ea1730fb6d01cca1fb672ec3422d30fb2b95deb79b7ed519aea3c628302ade7825839019f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799ab8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e531a00186a0082583901aea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ec2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e11a010980c0825839010bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb2658244028cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af75821b00000006b25f6871a1581c85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18a15244696d656e73696f6e426f7820233033343001021a0003ac72031a07feecf90b58201224772d32b8ca3901f6edb3c631e3f0a31d6defdd8938aedc74da3356f5fef80d81825820020cf34e0333a1049279cdbd6d4966a561653e17b159df9a17575e09f5d76ef00110825839010bb3cb520c54944c12fcadac8d65bfe6dc4c2b75c7c14bbb2658244028cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af751b00000006b37c9830111a000582ab12818258201693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d00a20481d8799f9fd8799fd8799fd8799f581c9f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799abffd8799fd8799fd8799f581c8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e53ffffffff1a00186a00ffd8799fd8799fd8799f581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecffd8799fd8799fd8799f581c2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e1ffffffff1a010980c0ffff581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecff0581840001d8799f00ff821a000326a91a04555e60f5f6'
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
