<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Transaction Summary" ref="popupHeader" :show-website="!(this.$route.query['website'] === 'undefined' || Object.keys(this.$route.query).length === 0)">
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
                <USBBluetoothSwitch v-model="isBT" />
              </v-card-subtitle>
            </v-col>
            <v-col cols="6">
              <v-btn block outlined color="red" class="capitalize" @click="decline">
                Decline
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn block class="geroButton" style="color: black!important;" @click="confirm" :disabled="!valid">
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
      txSubmitLoading: false,
      loading: true,
      controller: Messaging.createInternalController(),
      // txCbor: '84a900828258207deec26e4afa4cd5373c93db4f514da668f68544bacb248f0d02e99d2fcf12b000825820a8c5ac70414db4f8330e23c592443aabf42f2fa2be7391263b6ea2f31aca2f0f040187a30058393184cc25ea4c29951d40b443b95bbc5676bc425470f96376d1984af9ab2c967f4bd28944b06462e13c5e3f5d5fa6e03f8567569438cd833e6d011a0011a008028201d818582258209a53eccef981a9565010918e3493a332206478df48bd1b32d3a4d396b6f1d8d3825839019f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799ab8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e531a000f424082583901aea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ec2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e11a0112a880825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a150ce3ed825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0a8671f6825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a0011d28aa1581cf7535d3356b29a16ce50a2843c539c9a05c94abfca7b96a26a56012ca14b4d75736963426f7834393001825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0a713131021a00036e3c031a0791c8df0b58203a5912a61f0f567682118754b8c0c06fee9231831ddf7a50cd3a9ef3d003bdd10d8182582037a0c517d3f5b9a91c92a4d38847dad806911d1cb7914f236b1d31d0929e66240210825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a004725e6111a0005255a12818258201693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d00a2049fd8799f9fd8799fd8799fd8799f581c9f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799abffd8799fd8799fd8799f581c8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e53ffffffff1a000f4240ffd8799fd8799fd8799f581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecffd8799fd8799fd8799f581c2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e1ffffffff1a0112a880ffff581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecffff0581840000d8799f00ff821a000326a91a055457e7f5f6'
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
      console.log(this.tx);
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
      if (this.$refs.form.validate()) {
        if (appWallet.verifySpendingPassword(this.spendingPassword)) {
          try {
            const response = await appWallet.signTx(
              this.request.data.tx,
              this.request.data.partialSign,
              this.spendingPassword,
              0,
              this.utxos,
              this.addresses,
            );
            await this.controller.returnData({ data: response.witnesses, error: undefined });
          } catch (e) {
            console.log(e)
            await this.controller.returnData({ data: undefined, error: e });
          }
          window.close();
        } else {
          this.enableToolTip()
        }
      }
    }
  },
  async created() {
    const request = await this.controller.requestData();
    if (request?.data?.tx) {
      console.log(request.data.tx)
      this.tx = Transaction.from_bytes(Buffer.from(request.data.tx, 'hex'));
      this.queryParams = this.$route.query;
      try {
        this.risks = await appWallet.api.scanTx({
          cborHex: request.data.tx,
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
    this.request = request;
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
