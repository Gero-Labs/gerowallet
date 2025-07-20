<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Transaction Summary" ref="popupHeader" :show-website="!(route.query['website'] === 'undefined' || Object.keys(route.query).length === 0)" :disabled="txSignLoading">
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
          <CopyButton x-small :value="request?.data ? request?.data.tx : ''" :title="'CBOR'"></CopyButton>
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
                <ToggleSwitch text-left="USB" icon-left="mdi-usb" text-right="Bluetooth" icon-right="mdi-bluetooth" v-model="isBT" :disabled="txSignLoading" />
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
<script setup lang="ts">
import { ref, computed, onMounted, toRefs, getCurrentInstance } from 'vue';
import { appWallet } from '@/stores';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { TxSignError } from '@/chrome/config';
import rules from '@/utils/rules';
import {
  BigNum,
  decode_metadatum_to_json_str,
  Transaction, Value,
} from '@emurgo/cardano-serialization-lib-browser';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import { AssetWithQuantity } from '@/shared/models/asset-quantity';
import {
  cardanoValueFromRemoteFormat,
  diffAssetsFromIncomingToOutgoing,
  getAssetsFromMultiAsset, getPayAndReceiveTokens,
} from '@/shared/utils/builder';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import cardanoShieldApi from '@/api/cardano-shield-api';
import CopyButton from '@/shared/components/CopyButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/plugins/walletStore';

const { loggedWallet, config, utxos, keys } = toRefs(walletStore);

const isBT = ref(false);
const risks = ref<any>(undefined);
const spendingPassword = ref('');
const showPassword = ref(false);
const request = ref<any>(null);
const tx = ref<any>(undefined);
const valid = ref(false);
const tooltip = ref({
  enabled: false,
  text: 'Wrong Spending Password!',
});
const txSignLoading = ref(false);
const loading = ref(true);
const controller = ref<any>(null);
const witnesses = ref<any>(undefined);
const form = ref<any>(null);
const popupHeader = ref<any>(null);
const tabId = ref<number>();

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit || true;
});

const useSidePanel = computed(() => {
  return config.value?.useSidePanel || true;
});

const txFee = computed(() => {
  return tx.value ? tx.value.body().fee().to_str() : null;
});

const txMetadata = computed(() => {
  if (tx.value) {
    const metadata = tx.value.auxiliary_data()?.metadata();
    if (metadata) {
      const json: any = {};
      const keys = metadata.keys();
      for (let i = 0; i < keys.len(); i++) {
        const key = keys.get(i);
        json[key.to_str()] = JSON.parse(decode_metadatum_to_json_str(metadata.get(key), 1));
      }
      return json;
    }
  }
  return null;
});

const certificate = computed(() => {
  return tx.value?.body().certs() || null;
});

const withdrawals = computed(() => {
  return tx.value?.body().withdrawals() || null;
});

const minting = computed(() => {
  return tx.value?.body().mint() || null;
});

const script = computed(() => {
  return tx.value?.witness_set()?.native_scripts() || null;
});

const outputs = computed(() => {
  return tx.value?.body().outputs() || null;
});

const changeAddress = computed(() => {
  return loggedWallet.value?.baseAddress;
});

const recipient = computed(() => {
  if (tx.value) {
    const txBody = tx.value.body();
    for (let i = 0; i < txBody.outputs().len(); i++) {
      const keyAddress = txBody.outputs().get(i).address();
      const bech32Address = keyAddress.to_bech32();
      if (!addresses.value[bech32Address]) {
        return bech32Address;
      }
    }
  }
  return changeAddress.value;
});

const swapDetails = computed(() => {
  console.log(tx.value);
  if (!tx.value || !utxos.value || utxos.value.length === 0) {
    return null;
  }
  const txBody = tx.value.body();

  let inputValue = Value.new(BigNum.from_str('0'));
  for (let i = 0; i < txBody.inputs().len(); i++) {
    const input = txBody.inputs().get(i);
    const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
    const inputTxIndex = input.index();
    const utxo = utxos.value.find(utxo => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);
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
    if (addresses.value[bech32Address]) {
      outputValue = outputValue.checked_add(output.amount());
    }
  }

  const outputValueAssets = getAssetsFromMultiAsset(outputValue.multiasset());
  outputValueAssets.push(new AssetWithQuantity('cardano', outputValue.coin().to_str()));

  const diff = diffAssetsFromIncomingToOutgoing(inputValueAssets, outputValueAssets);
  const { payTokens, receiveTokens } = getPayAndReceiveTokens(diff);

  const cardanoToken = payTokens.find(token => token.name === 'cardano');
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
      txFee: txFee.value,
      provider: networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
      assets: assetsGive,
    },
    receive: {
      total: totalReceive,
      provider: networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network),
      assets: assetsReceive,
    },
    recipient: recipient.value,
    txMetadata: txMetadata.value,
    queryParams: undefined,
  };
});

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
};

const decline = async () => {
  await controller.value.returnData({ data: undefined, error: TxSignError.UserDeclined });
  window.close();
};

const sign = async () => {
  if (!txAutoSubmit.value && witnesses.value) {
    await confirm();
  }
  const signAndReturnTx = async () => {
    txSignLoading.value = true;
    try {
      const txCbor = request.value?.data?.tx;
      const partialSign = request.value?.data?.partialSign;
      const response = await appWallet.signTx(
        txCbor,
        partialSign,
        spendingPassword.value,
        0,
        utxos.value,
        addresses.value,
        !isBT.value
      );
      console.log(response);
      witnesses.value = response.witnesses;
      if (txAutoSubmit.value) {
        await confirm();
      }
    } catch (e) {
      console.log(e);
      snackbar.setError(e);
    }
    txSignLoading.value = false;
  };
  if (appWallet.type === WalletType.Normal) {
    if (form.value.validate()) {
      if (appWallet.verifySpendingPassword(spendingPassword.value)) {
        await signAndReturnTx();
      } else {
        enableToolTip();
      }
    }
  } else {
    await signAndReturnTx();
  }
};

const confirm = async () => {
  console.log(witnesses.value);
  await controller.value.returnData({ data: witnesses.value, error: undefined });
  window.close();
};

const vmProxy = getCurrentInstance()!.proxy as any
const route = vmProxy.$route;

const init = async () => {
  let txCbor;
  request.value = await controller.value.requestData();
  if (request.value?.data?.tx) {
    txCbor = request.value?.data?.tx;
  }
  if (txCbor) {
    console.log(txCbor);
    tx.value = Transaction.from_bytes(Buffer.from(txCbor, 'hex'));
    const queryParams = route.query;
    try {
      risks.value = await cardanoShieldApi.scanTx({
        cborHex: txCbor,
        toAddress: recipient.value,
        fromAddress: changeAddress.value,
        url: queryParams['website'] as string,
      });
    } catch (e) {
      risks.value = {
        addressRisk: 'unknown',
      };
    }
    loading.value = false;
  }
};

onMounted(async () => {
  if (useSidePanel.value) {
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get("tabId"));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
  } else {
    controller.value = Messaging.createInternalController();
  }

  await init();
});
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
