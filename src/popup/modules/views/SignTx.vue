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
              <span>{{ networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) }} and/or tokens<br>shown here will be </span>
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
              <span>{{ networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) }} and/or tokens<br>shown here will be </span>
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
        <div style="text-align: right; position: absolute; float: right; right: 8px; bottom: 125px;">
          <CopyButton x-small :value="this.request?.data ? this.request?.data.tx : ''" :title="'CBOR'"></CopyButton>
        </div>
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
                    :rules="[rules.required()]"
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
import CopyButton from '@/shared/components/CopyButton.vue';

export default {
  name: 'DappConnect',
  components: { CopyButton, USBBluetoothSwitch, TransactionRisk, TransactionCard, DappAddress, PopupHeader },
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
      console.log(this.tx)
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
          const txCbor = this.request?.data?.tx
          const partialSign = this.request?.data?.partialSign
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
    //     tx: '84a400d901028b825820198781969bb47ae01c3573c9ace5b533052d957429205be43463175a4f067fea018258201f1dd28622f20ccb3d1cae2836897a113bde019ba17343163c057df157e9c31500825820278819f9e4bd92f3c33c82ad6eed6c2185915382d8601b71c25694ccc9a4699f028258203b5e2421cfc5c9e611950acd6fee5de1a08890c5a1e1c57d81d6e415b02786ec0082582054850df90a1a8a6562c71db0a62e23b8606c7499013adb7bc3b00e4c7f462415008258206022fb8e027c57461afe6997c8e11a72deb3e28446d0fb74fb2489494cbea6fc0082582060fb75c7e55478f131174ddbffa2ffe56545d0e255de544d5f306b8d69b88452008258206ba77301afbda69c94bd750ea4ea933817dd81f23b73c0d1369a2f855b966cb901825820c950099f9c166bdc8ffd1854649ad85abbbb6eba39a5d2569ca1adcb273ce29d01825820c950099f9c166bdc8ffd1854649ad85abbbb6eba39a5d2569ca1adcb273ce29d02825820fd7c80d39fb00425ec9793b40798c9a293432a4ac34ad5ced45d7bf93db8ee49020190825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a002f490aaa581c10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6a1444745524f1b0000063921dc488e581c1ddcb9c9de95361565392c5bdff64767492d61a96166cb16094e54bea1434f50541a19337d6d581c279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3fa144534e454b1904f1581c4d038d08e68f53d21462e8982a5334c6ffbf65e7ae7eb064c568dd1ea145464f524745190186581c5d16cc1a177b5d9ba9cfa9793b07e60f1fb70fea1f8aef064415d114a1434941471a54274f29581c6d06570ddd778ec7c0cca09d381eca194e90c8cffa7582879735dbdea1435845521b0000000bb0a65e15581c95a427e384527065f2f8946f5e86320d0117839a5e98ea2c0b55fb00a14448554e541a04c4b3ff581c9668ef339ea4b29a29b7a500b1a1f6769568ddb623cc463f95fe07f2a149436865717565426f781a009736ee581cdd4eff2f1e686c961c0806c3d97abe8f89f8613dd5e718d8b7541c27a14d0014df105465737443495036381903e8581cf5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4ca2582082e2b1fd27a7712a1a9cf750dfbea1a5778611b20e06dd6a611df7a643f8cb751a009c4d6b5820eec09c3b4089ef5558427b92467722f1a821023bb3ae6efe3ee79a826c66c2201a008858c0825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a0032e704ab581c02955cf4ace1eca324a4acdaa30746c349d18935c3755327f24b7beba15818416c676f47726170686963734368616f746963576f726c6401581c03bb190eb9ed60d4a52e2b314e89b6a1dbbf07ed5717942d90131a58a14847656e746f32343701581c0dc91e583eca594cb07213e4a9cf04520bb19b33682e5ef05967b45ea1456148554e5401581c2103673b9f5ee43408d78ad02805bb7bb8b2e118ffc9fb5ff81c28d3a14e4d6563686153746167303132323201581c27be886b124cf8dddf51e00c04f519af94e23ab2b864d29c583a5e9aa1444150554701581c2edd9753b85e908ac63c5ae7b3bb013ad871da4a450b5f21a5218c46a14c4765726f537461673035383801581c33a91eee1ec9d26ffc2b1b509a47b48ed63d2bf7633b46e7d58aa84fa14952756279303031343601581c38ddf5da812541c5f8b0af3fa26e02f5bcb6e558c3ce81c23fc4e010a14d54686520546f6b65722023323101581c7136e7f40b368b3f3d9656f97b2c5ae01d0545882bc3cd86f8a80159a44a57656564426f78313133014a57656564426f78313330014a57656564426f78313535014c4d75736963426f6e6733393301581cafe2e7cdf682ce7b604d2ad30b1171a3eb5867126f066f0eb6a498efa1505370616365205075677320233137313001581cefbb3e18a77e0f975f8f2a8e822c79202c5094c3d7fbf4dc78303b48a24e416c676f47656e41727433363132014e416c676f47656e4172743338303101825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a00266830a1581c123da5e4ef337161779c6729d2acd765f7a33a833b2a21a063ef65a5b8194b5369636b43697479343530014b5369636b43697479343531014b5369636b43697479343532014b5369636b43697479343533014b5369636b43697479343534014b5369636b43697479343535014b5369636b43697479343536014b5369636b43697479343538014b5369636b43697479343539014b5369636b43697479343630014b5369636b43697479343631014b5369636b43697479343633014b5369636b43697479343634014b5369636b43697479343635014b5369636b43697479343636014b5369636b43697479343637014b5369636b43697479343638014b5369636b43697479343639014b5369636b43697479343730014b5369636b43697479343731014b5369636b43697479343732014b5369636b43697479343733014b5369636b43697479343734014b5369636b43697479343833014b5369636b4369747934383401825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a002d934ea1581c85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18b4514e69646f2044696d656e73696f6e426f78015244696d656e73696f6e426f78202330303436015244696d656e73696f6e426f78202330323237015244696d656e73696f6e426f78202330323530015244696d656e73696f6e426f78202330333532015244696d656e73696f6e426f78202330333535015244696d656e73696f6e426f78202330353732015244696d656e73696f6e426f78202330363431015244696d656e73696f6e426f78202330363537015244696d656e73696f6e426f78202330373132015244696d656e73696f6e426f78202330373634015244696d656e73696f6e426f78202330373834015244696d656e73696f6e426f78202330373937015244696d656e73696f6e426f7820233039343101534453514953452044696d656e73696f6e426f780157467574757265466573742044696d656e73696f6e426f7801574765726f57616c6c65742044696d656e73696f6e426f780158184b72696d652046797465722044696d656e73696f6e426f78015819484f4f442042494c4c4f4e242044696d656e73696f6e426f7801581b4f64645368617065536861646f772044696d656e73696f6e426f7801825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a0024c34aa2581cea03a904bf809640208f60d37d5e00cec5fc3fe11d80cecf228c057cad524c6f74746572795469636b6574303733323301524c6f74746572795469636b6574303737393701524c6f74746572795469636b6574313634373701524c6f74746572795469636b6574313737383601524c6f74746572795469636b6574313933363601524c6f74746572795469636b6574313934383301524c6f74746572795469636b6574313936363701524c6f74746572795469636b6574323530363101524c6f74746572795469636b6574323534353001524c6f74746572795469636b6574323637373901524c6f74746572795469636b6574323832323901524c6f74746572795469636b6574323836363701524c6f74746572795469636b6574323837393201581cf0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9aa1486d75736963626f7801825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a00186622a1581cf7535d3356b29a16ce50a2843c539c9a05c94abfca7b96a26a56012ca94a4d75736963426f783437014a4d75736963426f783735014a4d75736963426f783736014a4d75736963426f783938014b4d75736963426f78333537014b4d75736963426f78343839014b4d75736963426f78353231014b4d75736963426f78353438014b4d75736963426f7835373001825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a03019a24825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0201116d825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a010088b6825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0703ac7f825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a021ab3bf825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0167227f825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0167227f825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a00b39145825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a00b3913f825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a00b3913f021a0005cf170758202ac5782b128f38ae318a23500c4d358bd8c4232a7568b3f15db96c1bf192d55aa0f5a11902a2a1636d7367817268747470733a2f2f756e667261636b2e6974'
    //   }
    // }
    if (this.request?.data?.tx) {
      txCbor = this.request?.data?.tx
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
