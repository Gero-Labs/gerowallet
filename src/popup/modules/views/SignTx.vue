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
import cardanoShieldApi from '@/api/cardano-shield-api';

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
          if (!this.addresses[bech32Address]) {
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
        if (this.addresses[bech32Address]) {
          outputValue = outputValue.checked_add(output.amount());
        }
      }

      const outputValueAssets = getAssetsFromMultiAsset(outputValue.multiasset());
      outputValueAssets.push(new AssetWithQuantity('cardano', outputValue.coin().to_str()));

      const diff = diffAssetsFromIncomingToOutgoing(inputValueAssets, outputValueAssets);
      const { payTokens, receiveTokens } = getPayAndReceiveTokens(diff);

      const cardanoToken = payTokens.find(token => token.name === 'cardano')
      let totalGive = cardanoToken ? cardanoToken.amount : 0;

      const assetsGive = payTokens.filter(token => token.name !== 'cardano').map(token => {
        return { amount: token.amount, currency: token.name, id: token.id };
      });

      const foundAda = receiveTokens.find(token => token.name === 'cardano');
      const totalReceive = foundAda ? foundAda.amount : 0;
      const assetsReceive = receiveTokens.filter(token => token.name !== 'cardano').map(token => {
        return { amount: token.amount, currency: token.name, id: token.id };
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
      console.log(this.witnesses)
      await this.controller.returnData({ data: this.witnesses, error: undefined });
      window.close();
    }
  },
  async created() {
    let txCbor;
    this.request = await this.controller.requestData();
    // this.request = {
    //   data: {
    //     tx: '84a900828258207f810428ca021d0ab181c597519e5a0e8ec2c0b84e3e84572068dccdf6b44511008258200f1f8d6633d1cfa850f9a7b8208ae8687d6be24a707e75fe543fb66ac5f2f646030185a30058393184cc25ea4c29951d40b443b95bbc5676bc425470f96376d1984af9ab2c967f4bd28944b06462e13c5e3f5d5fa6e03f8567569438cd833e6d011a0011a008028201d8185822582023857b35926e17c3a922632896e0b5529ce3c0a02ec8a7c5fabb6b6806d6fc07825839019f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799ab8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e531a000f42408258390164bb13b53f6c4eddd11bfeb6294aed605c2dc43a19de738f18e6a165608d6688b93168c18ad9bcbd726cecd5561921f0fcc7058276ad20cb1a0112a88082583901e3300b85aeb4be910fbd19c61c828e621f7bb2edce8f19637724cefcf536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a009da3beb5581c02955cf4ace1eca324a4acdaa30746c349d18935c3755327f24b7beba15818416c676f47726170686963734368616f746963576f726c6401581c03bb190eb9ed60d4a52e2b314e89b6a1dbbf07ed5717942d90131a58a14847656e746f32343701581c0dc91e583eca594cb07213e4a9cf04520bb19b33682e5ef05967b45ea1456148554e5401581c10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6a1444745524f1b000001a567d81b24581c123da5e4ef337161779c6729d2acd765f7a33a833b2a21a063ef65a5b81b4b5369636b43697479343439014b5369636b43697479343530014b5369636b43697479343531014b5369636b43697479343532014b5369636b43697479343533014b5369636b43697479343534014b5369636b43697479343535014b5369636b43697479343536014b5369636b43697479343537014b5369636b43697479343538014b5369636b43697479343539014b5369636b43697479343630014b5369636b43697479343631014b5369636b43697479343633014b5369636b43697479343634014b5369636b43697479343635014b5369636b43697479343636014b5369636b43697479343637014b5369636b43697479343638014b5369636b43697479343639014b5369636b43697479343730014b5369636b43697479343731014b5369636b43697479343732014b5369636b43697479343733014b5369636b43697479343734014b5369636b43697479343833014b5369636b4369747934383401581c2103673b9f5ee43408d78ad02805bb7bb8b2e118ffc9fb5ff81c28d3a14e4d6563686153746167303132323201581c27be886b124cf8dddf51e00c04f519af94e23ab2b864d29c583a5e9aa1444150554701581c29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c6a1434d494e1a02faf080581c2edd9753b85e908ac63c5ae7b3bb013ad871da4a450b5f21a5218c46a14c4765726f537461673035383801581c33a91eee1ec9d26ffc2b1b509a47b48ed63d2bf7633b46e7d58aa84fa14952756279303031343601581c4d038d08e68f53d21462e8982a5334c6ffbf65e7ae7eb064c568dd1ea145464f524745190186581c7136e7f40b368b3f3d9656f97b2c5ae01d0545882bc3cd86f8a80159a54a57656564426f78313133014a57656564426f78313330014a57656564426f78313535014a57656564426f78333431014c4d75736963426f6e6733393301581c85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18b5514e69646f2044696d656e73696f6e426f78015244696d656e73696f6e426f78202330303436015244696d656e73696f6e426f78202330323237015244696d656e73696f6e426f78202330323530015244696d656e73696f6e426f78202330323732015244696d656e73696f6e426f78202330333532015244696d656e73696f6e426f78202330333535015244696d656e73696f6e426f78202330353732015244696d656e73696f6e426f78202330363431015244696d656e73696f6e426f78202330363537015244696d656e73696f6e426f78202330373132015244696d656e73696f6e426f78202330373634015244696d656e73696f6e426f78202330373834015244696d656e73696f6e426f78202330373937015244696d656e73696f6e426f7820233039343101534453514953452044696d656e73696f6e426f780157467574757265466573742044696d656e73696f6e426f7801574765726f57616c6c65742044696d656e73696f6e426f780158184b72696d652046797465722044696d656e73696f6e426f78015819484f4f442042494c4c4f4e242044696d656e73696f6e426f7801581b4f64645368617065536861646f772044696d656e73696f6e426f7801581c95a427e384527065f2f8946f5e86320d0117839a5e98ea2c0b55fb00a14448554e541a05f5e0ff581c9668ef339ea4b29a29b7a500b1a1f6769568ddb623cc463f95fe07f2a149436865717565426f781a009736ef581cafe2e7cdf682ce7b604d2ad30b1171a3eb5867126f066f0eb6a498efa1505370616365205075677320233137313001581cdd4eff2f1e686c961c0806c3d97abe8f89f8613dd5e718d8b7541c27a14d0014df105465737443495036381903e8581cea03a904bf809640208f60d37d5e00cec5fc3fe11d80cecf228c057cad524c6f74746572795469636b6574303733323301524c6f74746572795469636b6574303737393701524c6f74746572795469636b6574313634373701524c6f74746572795469636b6574313737383601524c6f74746572795469636b6574313933363601524c6f74746572795469636b6574313934383301524c6f74746572795469636b6574313936363701524c6f74746572795469636b6574323530363101524c6f74746572795469636b6574323534353001524c6f74746572795469636b6574323637373901524c6f74746572795469636b6574323832323901524c6f74746572795469636b6574323836363701524c6f74746572795469636b6574323837393201581cefbb3e18a77e0f975f8f2a8e822c79202c5094c3d7fbf4dc78303b48a24e416c676f47656e41727433363132014e416c676f47656e4172743338303101581cf0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9aa1486d75736963626f7801581cf7535d3356b29a16ce50a2843c539c9a05c94abfca7b96a26a56012cad4a4d75736963426f783437014a4d75736963426f783735014a4d75736963426f783736014a4d75736963426f783938014b4d75736963426f78333537014b4d75736963426f78333833014b4d75736963426f78343630014b4d75736963426f78343834014b4d75736963426f78343839014b4d75736963426f78353137014b4d75736963426f78353231014b4d75736963426f78353438014b4d75736963426f783537300182583901e3300b85aeb4be910fbd19c61c828e621f7bb2edce8f19637724cefcf536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a260a6f21021a0005dff7031a083959b70b58201f50183172321ec44855e32ced2bbbd30ee11dd9ca8b75f6085df9058d4f5f6a0d81825820d7e45594f0ab38e1cf457b376f0a39a58d879fbb74a25cd1313dd505a3fe539e041082583901e3300b85aeb4be910fbd19c61c828e621f7bb2edce8f19637724cefcf536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a00437b4d111a0008cff312818258201693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d00a20481d8799f9fd8799fd8799fd8799f581c9f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799abffd8799fd8799fd8799f581c8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e53ffffffff1a000f4240ffd8799fd8799fd8799f581c64bb13b53f6c4eddd11bfeb6294aed605c2dc43a19de738f18e6a165ffd8799fd8799fd8799f581c608d6688b93168c18ad9bcbd726cecd5561921f0fcc7058276ad20cbffffffff1a0112a880ffff581c64bb13b53f6c4eddd11bfeb6294aed605c2dc43a19de738f18e6a165ff0581840001d8799f00ff821a000326a91a04555e60f5f6'
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
        this.risks = await cardanoShieldApi.scanTx({
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
