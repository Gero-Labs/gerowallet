<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Transaction Summary" ref="popupHeader">
      <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
        <DappAddress class="mb-4" :address="recipient" :risk="risks?.addressRisk" />
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true">
          You're giving
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                class="ml-1"
                small
                color="#C4C4C4"
                v-bind="attrs"
                v-on="on"
              >
                mdi-information-outline
              </v-icon>
            </template>
            <div style="width: 100%; height: 100%">
              <span style="color: white; font-size: 14px; font-weight: 400; line-height: 14px; word-wrap: break-word">AP3X and/or tokens<br>shown here will be </span>
              <span style="color: #FF7777; font-size: 14px; font-weight: 900; line-height: 14px; word-wrap: break-word">sent<br>from your wallet</span>
              <span style="color: white; font-size: 14px; font-weight: 400; line-height: 14px; word-wrap: break-word"> to the<br>address listed above.<br /><br />Once signed, this action<br>is irreversible.</span>
            </div>
          </v-tooltip>
        </TransactionCard>
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.receive" :risk="risks?.receivingRisk">
          You're receiving
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon
                class="ml-1"
                small
                color="#C4C4C4"
                v-bind="attrs"
                v-on="on"
              >
                mdi-information-outline
              </v-icon>
            </template>
            <div style="width: 166px; height: 101px">
              <span style="color: white; font-size: 14px; font-weight: 400; line-height: 14px; word-wrap: break-word">AP3X and/or tokens shown here will be </span>
              <span style="color: #00C77A; font-size: 14px; font-weight: 900; line-height: 14px; word-wrap: break-word">sent to your wallet<br /><br /></span>
              <span style="color: white; font-size: 14px; font-weight: 400; line-height: 14px; word-wrap: break-word">Once signed, this action is irreversible.</span>
            </div>
          </v-tooltip>
        </TransactionCard>
        <!--      Fee: {{txFee | toAda}}<br>-->
        <!--      Metadata: {{txMetadata}}<br>-->
        <!--      Certificate: {{certificate}}<br>-->
        <!--      Withdrawls: {{withdrawals}}<br>-->
        <!--      Minting: {{minting}}<br>-->
        <!--      Script: {{script}}<br>-->
        <!--      Outputs: {{outputs}}<br>-->
        <!--      UTxOs: {{utxos.length}}<br>-->
        <!--      Recipient: {{recipient}}<br>-->
        <!--      {{swapDetails}}-->
      </v-card-text>
      <v-card-actions class="justify-center py-2 px-0">
        <v-layout>
          <v-row>
            <v-col cols="12" class="justify-center text-center">
              <TransactionRisk :risk="risks?.score" :loading="loading" />
            </v-col>
            <v-col cols="12">
              <v-text-field
                style="width: 100%"
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
              >
                <template v-slot:append>
                  <v-icon @click="showPassword = !showPassword" tabindex="-1">
                    {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                  </v-icon>
                </template>
              </v-text-field>
            </v-col>
            <v-col cols="6">
              <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline">
                Decline
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn block
                     class="geroButton"
                     style="color: black!important;"
                     @click="confirm" :disabled="!valid">
                Sign & Confirm
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
      <v-snackbar top v-model="snackbar.enabled" rounded color="red" transition="scroll-y-transition">
        {{ snackbar.text }}
      </v-snackbar>
    </PopupHeader>
  </v-form>
</template>
<script>
import { useStore } from '@/store';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { TxSignError } from '@/chrome/config';
import rules from '@/shared/utils/rules';
import {
  AssetName,
  decode_metadatum_to_json_str,
  MultiAsset, ScriptHash,
  Transaction,
  Value,
  BigNum, BaseAddress,
} from '@emurgo/cardano-serialization-lib-browser';
import filters from '@/shared/utils/filters';
import { mapState } from 'pinia';
import { Buffer } from 'buffer';
import Assets from '@/modules/assets/views/Assets.vue';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import { DappRisk } from '@/models/tx-scan';

export default {
  name: 'dapp-connect',
  components: { TransactionRisk, TransactionCard, DappAddress, PopupHeader },
  computed: {
    DappRisk() {
      return DappRisk;
    },
    ...mapState(useStore, ['utxos', 'baseAddress']),
    txFee() {
      if (this.tx) {
        return this.tx.body().fee().to_str();
      }
      return null;
    },
    txMetadata() {
      if (this.tx) {
        let metadata = this.tx.auxiliary_data() && this.tx.auxiliary_data().metadata();
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
      if (this.tx) {
        return this.tx.body().certs();
      }
      return null;
    },
    withdrawals() {
      if (this.tx) {
        return this.tx.body().withdrawals();
      }
      return null;
    },
    minting() {
      if (this.tx) {
        return this.tx.body().mint();
      }
      return null;
    },
    script() {
      if (this.tx) {
        return this.tx.witness_set().native_scripts();
      }
      return null;
    },
    inputs() {
      if (this.tx) {
        return this.tx.body().inputs();
      }
      return null;
    },
    outputs() {
      if (this.tx) {
        return this.tx.body().outputs();
      }
      return null;
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
        const utxo = this.utxos.find((utxo) => {
          return inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex;
        });
        if (utxo) {
          inputValue = inputValue.checked_add(this.cardanoValueFromRemoteFormat(utxo));
        }
      }

      const inputValueAssets = this.getAssetsFromMultiAsset(inputValue.multiasset());
      inputValueAssets.push(new AssetWithQuantity('cardano', inputValue.coin().to_str()));

      let outputValue = Value.new(BigNum.from_str('0'));
      for (let i = 0; i < txBody.outputs().len(); i++) {
        const output = txBody.outputs().get(i);
        const bech32Address = output.address().to_bech32();
        if (bech32Address === this.changeAddress) {
          outputValue = outputValue.checked_add(output.amount());
        }
      }

      const outputValueAssets = this.getAssetsFromMultiAsset(outputValue.multiasset());
      outputValueAssets.push(new AssetWithQuantity('cardano', outputValue.coin().to_str()));

      const diff = this.diffAssetsFromIncomingToOutgoing(inputValueAssets, outputValueAssets);
      const { payTokens, receiveTokens } = this.getPayAndReceiveTokens(diff);
      // const distinctAssetNames = Array.from(new Set([
      //     'cardano',
      //     ...payTokens.map((token) => token.name.toLowerCase()),
      //     ...receiveTokens.map((token) => token.name.toLowerCase()),
      //   ]));
      const totalGive = payTokens.find(token => token.name === 'cardano').amount;
      const assetsGive = payTokens.filter(token => token.name !== 'cardano').map(token => {
        return { amount: token.amount, currency: token.name };
      });

      const foundAda = receiveTokens.find(token => token.name === 'cardano');
      const totalReceive = foundAda ? receiveTokens.find(token => token.name === 'cardano').amount : 0;
      const assetsReceive = receiveTokens.filter(token => token.name !== 'cardano').map(token => {
        return { amount: token.amount, currency: token.name };
      });
      return {
        give: {
          // payTokens,
          total: Number(0 - totalGive),
          txFee: this.txFee,
          provider: 'AP3X',
          assets: assetsGive,
        },
        receive: {
          total: totalReceive,
          provider: 'AP3X',
          assets: assetsReceive,
        },
        recipient: this.recipient,
        txMetadata: this.txMetadata,
      };
    },
  },
  methods: {

    getAssetsFromMultiAsset(multiAsset) {
      if (!multiAsset) return [];

      const result = [];
      const hashes = multiAsset.keys();

      for (let i = 0; i < hashes.len(); i++) {
        const policyId = hashes.get(i);
        const assetsForPolicy = multiAsset.get(policyId);
        // eslint-disable-next-line
        if (assetsForPolicy == null) continue;

        const policies = assetsForPolicy.keys();

        for (let j = 0; j < policies.len(); j++) {
          const assetName = policies.get(j);
          const amount = assetsForPolicy.get(assetName);
          // eslint-disable-next-line
          if (amount == null) continue;

          const parsedQuantity = amount.to_str();
          const parsedName = Buffer.from(assetName.name()).toString('hex');
          const parsedPolicyId = Buffer.from(policyId.to_bytes()).toString('hex');
          const parsedAssetId = `${parsedPolicyId}${parsedName}`;

          result.push(new AssetWithQuantity(parsedName, parsedQuantity, parsedAssetId, parsedPolicyId));
        }
      }
      return result;
    },
    diffAssetsFromIncomingToOutgoing(inputAssets, outputAssets) {
      if (!inputAssets || !outputAssets) {
        return null;
      }
      const allAssets = new Set([
        ...inputAssets.map((input) => input.asset.name),
        ...outputAssets.map((output) => output.asset.name),
      ]);
      return Array.from(allAssets)
        .map((assetName) => {
          const inValue = inputAssets.find((input) => input.asset.name === assetName);
          const outValue = outputAssets.find((output) => output.asset.name === assetName);
          const difference = BigInt(inValue ? inValue.quantity : '') - BigInt(outValue ? outValue.quantity : '');
          if (assetName === 'cardano') {
            return { assetName, quantity: difference, id: 'cardano' };
          }
          const policy = assetName.slice(0, 56);
          return {
            assetName,
            quantity: difference,
            policy,
            id: inValue ? inValue.asset.id : outValue?.asset.id,
          };
        }).filter((asset) => asset.quantity !== BigInt(0));
    },
    getPayAndReceiveTokens(diff) {
      const payTokens = [];
      const receiveTokens = [];
      for (let i = 0; i < diff.length; i++) {
        if (diff[i].quantity > BigInt(0)) {
          payTokens.push({
            name: diff[i].assetName,
            amount: diff[i].quantity.toString(),
            id: diff[i].id,
          });
        } else if (diff[i].quantity < BigInt(0)) {
          receiveTokens.push({
            name: diff[i].assetName,
            amount: (diff[i].quantity * BigInt(-1)).toString(),
            id: diff[i].id,
          });
        }
      }
      return { payTokens, receiveTokens };
    },
    cardanoValueFromRemoteFormat(utxo) {
      const cardanoValue = Value.new(BigNum.from_str(utxo.value));
      if (!utxo.asset_list || utxo.asset_list.length === 0) {
        return cardanoValue;
      }
      const assets = MultiAsset.new();
      utxo.asset_list.forEach((asset) => {
        const policyId = ScriptHash.from_bytes(Buffer.from(asset.policyId, 'hex'));
        const assetName = AssetName.new(Buffer.from(asset.name || '', 'hex'));
        const quantity = BigNum.from_str(asset.amount);
        const policyContent = assets.get(policyId) ?? Assets.new();
        policyContent.insert(assetName, quantity);
        assets.insert(policyId, policyContent);
      });
      if (assets.len() > 0) {
        cardanoValue.set_multiasset(assets);
      }
      return cardanoValue;
    },
    async decline() {
      await this.controller.returnData({ data: {}, error: TxSignError.UserDeclined });
      window.close();
    },
    async confirm() {
      if (this.$refs.form.validate()) {
        const wallet = useStore().getWallet;
        if (wallet.verifySpendingPassword(this.spendingPassword)) {
          try {
            const res = await wallet.signTx(this.request.data.tx, this.request.data.payload, this.spendingPassword, 0, this.request.data.partialSign);
            await this.controller.returnData({ data: res, error: undefined });
            console.log(res);
          } catch (e) {
            console.log(e);
            await this.controller.returnData({ data: undefined, error: e });
          }
          window.close();
        } else {
          this.snackbar.enabled = true;
        }
      }
    },
    async init() {
      const request = await this.controller.requestData();
      if (request?.data?.tx) {
        this.tx = Transaction.from_bytes(Buffer.from(request.data.tx, 'hex'));
        console.log(this.tx);
      }
      this.request = request;
    },
  },
  filters,
  data() {
    return {
      risks: undefined,
      rules,
      spendingPassword: '',
      showPassword: false,
      request: null,
      tx: undefined,
      password: '',
      valid: false,
      snackbar: {
        enabled: false,
        text: 'Wrong Spending Password!',
      },
      loading: true,
      controller: Messaging.createInternalController(),
    };
  },
  async mounted() {
    await this.init();
    const txCbor = '84a900828258207deec26e4afa4cd5373c93db4f514da668f68544bacb248f0d02e99d2fcf12b000825820a8c5ac70414db4f8330e23c592443aabf42f2fa2be7391263b6ea2f31aca2f0f040187a30058393184cc25ea4c29951d40b443b95bbc5676bc425470f96376d1984af9ab2c967f4bd28944b06462e13c5e3f5d5fa6e03f8567569438cd833e6d011a0011a008028201d818582258209a53eccef981a9565010918e3493a332206478df48bd1b32d3a4d396b6f1d8d3825839019f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799ab8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e531a000f424082583901aea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ec2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e11a0112a880825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a150ce3ed825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0a8671f6825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad821a0011d28aa1581cf7535d3356b29a16ce50a2843c539c9a05c94abfca7b96a26a56012ca14b4d75736963426f7834393001825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a0a713131021a00036e3c031a0791c8df0b58203a5912a61f0f567682118754b8c0c06fee9231831ddf7a50cd3a9ef3d003bdd10d8182582037a0c517d3f5b9a91c92a4d38847dad806911d1cb7914f236b1d31d0929e66240210825839016f3df66b6c87c3005828000d5853e04e6bf630bf1975d9700c64f1eef536c87a81581b044d5f2a968be29caa8998b8cad49c66d2e738d9ad1a004725e6111a0005255a12818258201693c508b6132e89b932754d657d28b24068ff5ff1715fec36c010d4d6470b3d00a2049fd8799f9fd8799fd8799fd8799f581c9f09e6cad382232fca653bb90d6d86bac87d6915fd3e489c5c8799abffd8799fd8799fd8799f581c8f695697137ef1dfb761a4e0a20a9cd0d44f6e6345fdb5ce8d351e53ffffffff1a000f4240ffd8799fd8799fd8799f581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecffd8799fd8799fd8799f581c2050c6027aa4fed1942b74fed238fdc02d36eb965593f1f4fb82c2e1ffffffff1a0112a880ffff581caea616304c2974c63f3c7a575901f2f1264ae5b22fb2edcde946e8ecffff0581840000d8799f00ff821a000326a91a055457e7f5f6';
    this.tx = Transaction.from_bytes(Buffer.from(txCbor, 'hex'));
    console.log(this.tx);
    this.queryParams = this.$route.query;
    try {
      const risks = await useStore().getWallet.scanTx({
        cborHex: txCbor,
        toAddress: this.recipient,
        fromAddress: this.changeAddress,
        url: this.queryParams['website'],
      });
      console.log(risks);
      this.risks = risks;
    } catch (e) {
      this.risks = {
        addressRisk: 'unknown'
      }
      console.log(e);
    }
    this.loading = false;
  },
};
</script>
<style scoped>
.v-tooltip__content {
  background: rgba(15, 19, 21, 1);
  border: 1px solid #C4C4C4;
  line-height: 18px;
  padding: 10px;
  font-size: 14px;
}

.v-tooltip__content.menuable__content__active {
  opacity: 1;
}
</style>
