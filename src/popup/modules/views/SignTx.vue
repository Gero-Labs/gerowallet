<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="String($t('navigation.transactionSummary'))" ref="popupHeader" :show-website="!(route.query['website'] === 'undefined' || Object.keys(route.query).length === 0)" :disabled="txSignLoading">
      <v-card-text class="d-flex flex-column justify-space-between pa-0" style="flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;">
        <DappAddress class="mb-2" :address="recipient" :risk="risks?.addressRisk" />
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true">
          {{ $t('navigation.youreGiving') }}
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                mdi-information-outlƒine
              </v-icon>
            </template>
            <div>
              <span>{{ $t('wallet.tokensWillBeSent', { currency: networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) }) }}</span>
            </div>
          </v-tooltip>
        </TransactionCard>
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.receive" :risk="risks?.receivingRisk">
          {{ $t('navigation.youreReceiving') }}
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                mdi-information-outline
              </v-icon>
            </template>
            <div>
              <span>{{ $t('wallet.tokensWillBeReceived', { currency: networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) }) }}</span>
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
              <BiometricPasswordField
                ref="passwordField"
                :value="spendingPassword"
                @input="spendingPassword = $event"
                outlined
                dense
                hide-details
                :placeholder="$t('navigation.typeYourSpendingPassword')"
                :rules="[rules.required()]"
                required
                @enter="sign"
                @biometric-autofill-success="handleBiometricSuccess"
                @biometric-autofill-error="handleBiometricError"
                class="w-100"
              />
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Ledger" class="py-0">
              <v-alert type="warning" outlined prominent class="py-2 my-1" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.pleaseReviewCarefully', { walletType: loggedWallet.type }) }}
                </span>
              </v-alert>
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch :text-left="$t('wallet.usb')" icon-left="mdi-usb" :text-right="$t('wallet.bluetooth')" icon-right="mdi-bluetooth" v-model="isBT" :disabled="txSignLoading" />
              </v-card-subtitle>
            </v-col>
            <v-col cols="6">
              <v-btn block outlined color="red" class="capitalize" @click="decline" :disabled="txSignLoading">
                {{ $t('wallet.decline') }}
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn block class="geroButton" style="color: black!important;" @click="sign" :disabled="!valid || txSignLoading" :loading="txSignLoading">
                {{txAutoSubmit ? $t('wallet.signAndConfirm') : !witnesses ? $t('wallet.sign') : $t('common.confirm')}}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
    </PopupHeader>
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, toRefs, getCurrentInstance } from 'vue';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { TxSignError } from '@/chrome/config';
import rules from '@/utils/rules';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import BiometricPasswordField from '@/shared/components/BiometricPasswordField.vue';
import {
  diffAssetsFromIncomingToOutgoing,
  getPayAndReceiveTokens,
} from '@/shared/utils/builder';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import cardanoShieldApi from '@/api/cardano-shield-api';
import CopyButton from '@/shared/components/CopyButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { coalesceValueQuantities } from '@cardano-sdk/core';
import { MessageTypes } from '@/models/MessageTypes';
import ledgerUtils from '@/shared/utils/ledger';
import { DeviceStatusError } from '@cardano-foundation/ledgerjs-hw-app-cardano';

const { t } = useTranslation();
const { loggedWallet, config, utxos, keys } = toRefs(walletStore);

const isBT = ref(false);
const risks = ref<any>(undefined);
const spendingPassword = ref('');
const request = ref<any>(null);
const tx = ref<Cardano.Tx | undefined>(undefined);
const valid = ref(false);
const passwordField = ref<any>(null);
const txSignLoading = ref(false);
const loading = ref(true);
const controller = ref<any>(null);
const witnesses = ref<any>(undefined);
const form = ref<any>(null);
const popupHeader = ref<any>(null);
const tabId = ref<number>();

const addresses = computed(() => {
  return new Set([...keys.value.payment, ...keys.value.change].map(el => el.address));
})

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit;
});

const useSidePanel = computed(() => {
  return config.value?.useSidePanel;
});

const txFee = computed<bigint | undefined>(() => {
  return txBody.value?.fee;
});

const txMetadata = computed(() => {
  return tx.value?.auxiliaryData?.blob;
});

const txBody = computed<Cardano.TxBody | undefined>(() => {
  return tx.value?.body;
})

const certificate = computed(() => {
  return txBody.value?.certificates;
});

const withdrawals = computed(() => {
  return txBody.value?.withdrawals;
});

const minting = computed(() => {
  return txBody.value?.mint;
});

const script = computed(() => {
  return tx.value?.witness;
});

const outputs = computed<Cardano.TxOut[]>(() => {
  return txBody.value?.outputs || [];
});

const inputs = computed<Cardano.TxIn[]>(() => {
  return txBody.value?.inputs || [];
});

const changeAddress = computed(() => {
  return loggedWallet.value?.baseAddress;
});

const recipient = computed(() => {
  if (tx.value) {
    for (let i = 0; i < outputs.value.length; i++) {
      const outputAddress = outputs.value[i].address;
      if (!addresses.value.has(outputAddress)) {
        return outputAddress;
      }
    }
  }
  return changeAddress.value;
});

const reconstructedUTxOs = computed(() => {
  return utxos.value?.map((utxo: Cardano.Utxo) => {
    // Reconstruct the value with proper Map for assets (needed after JSON deserialization)
    let value = utxo[1].value;
    if (value?.assets && !(value.assets instanceof Map)) {
      const assetsMap = new Map<Cardano.AssetId, bigint>();
      // Convert plain object back to Map
      Object.entries(value.assets).forEach(([assetId, quantity]) => {
        assetsMap.set(assetId as Cardano.AssetId, BigInt(quantity as any));
      });
      value = {
        coins: BigInt(value.coins),
        assets: assetsMap
      };
    } else if (value) {
      // Ensure coins is BigInt even if no assets
      value = {
        coins: BigInt(value.coins),
        assets: value.assets || undefined
      };
    }
    return [{
      txId: utxo[0].txId,
      index: utxo[0].index
    }, {
      address: utxo[1].address,
      value: value,
      datumHash: utxo[1].datumHash,
      datum: utxo[1].datum,
      scriptReference: utxo[1].scriptReference
    }] as Cardano.Utxo;
  })
})

const swapDetails = computed(() => {
  console.log(tx.value);
  if (!tx.value || !reconstructedUTxOs.value || reconstructedUTxOs.value.length === 0) {
    return null;
  }

  let inputValues: Cardano.Value[] = inputs.value.map((input: Cardano.TxIn) => {
    return reconstructedUTxOs.value.find(utxo => input.txId === utxo[0].txId && utxo[0].index === input.index)
  }).filter(utxo => !!utxo).map((utxo: Cardano.Utxo) => utxo[1].value);
  const inputValue: Cardano.Value = coalesceValueQuantities(inputValues);

  let outputValues: Cardano.Value[] = outputs.value
    .filter((output: Cardano.TxOut) => addresses.value.has(output.address))
    .map((output: Cardano.TxOut) => output.value);
  const outputValue: Cardano.Value = coalesceValueQuantities(outputValues);

  const diff = diffAssetsFromIncomingToOutgoing(inputValue, outputValue);
  const { payTokens, receiveTokens } = getPayAndReceiveTokens(diff);

  const cardanoToken = payTokens.find(token => token.name === 'cardano');
  let totalGive = cardanoToken ? cardanoToken.amount : 0;

  const assetsGive = payTokens.filter(token => token.name !== 'cardano').map(token => {
    return { amount: token.amount, currency: token.name, id: token.id };
  });
  console.log('receiveTokens: ', receiveTokens);
  const foundAda = receiveTokens.find(token => token.name === 'cardano');
  const totalReceive = foundAda ? foundAda.amount : 0;
  const assetsReceive = receiveTokens.filter(token => token.name !== 'cardano').map(token => {
    return { amount: token.amount, currency: token.name, id: token.id };
  });

  return {
    give: {
      total: Number(0 - totalGive),
      txFee: txFee.value ? txFee.value.toString() : '0',
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

const handleBiometricError = (error: string) => {
  console.error('Biometric autofill error in SignTx:', error);
  snackbar.setError(error || t('security.biometricAuthFailed'));
};

const handleBiometricSuccess = () => {
  console.log('✅ Biometric autofill successful in SignTx - triggering sign');
  // Automatically trigger sign after successful biometric autofill
  setTimeout(() => {
    sign();
  }, 300); // Small delay for UX feedback
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
      const mergeWitnesses = request.value?.data?.mergeWitnesses;
      if (loggedWallet.value.type === WalletType.Normal) {
        const witnessResult = await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.SIGN_TX,
          data: {
            txCbor: txCbor,
            partialSign: partialSign,
            password: spendingPassword.value,
            accountIndex: 0,
            utxos: utxos.value,
            addresses: keys.value,
            mergeWitnesses: mergeWitnesses || false,
          }
        }) as { data: { witnesses?: any; error?: string } };

        console.log('Transaction signed successfully:', witnessResult);

        if (witnessResult.data.error) {
          throw new Error(witnessResult.data.error);
        }

        console.log('Signed transaction witness:', witnessResult.data.witnesses);
        witnesses.value = witnessResult.data.witnesses;
        if (txAutoSubmit.value) {
          await confirm();
        }
      } else if (loggedWallet.value.type === WalletType.Ledger) {
        const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);

        // Extract existing witnesses if this is a partial sign (multisig transaction)
        let existingWitnesses: Serialization.TransactionWitnessSet | undefined;
        if (mergeWitnesses || partialSign) {
          try {
            const fullTx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor));
            existingWitnesses = fullTx.witnessSet();
          } catch (e) {
            console.warn('[LEDGER-SIGN] Could not extract existing witnesses:', e);
          }
        }

        const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
          tx,
          keys.value,
          utxos.value,
          !isBT.value, // isUsb flag (inverted from isBT)
          networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
          txCbor // Pass original CBOR for multisig transactions to preserve exact byte representation
        );

        // Merge Ledger signatures with existing witnesses
        let finalWitnessSet: Serialization.TransactionWitnessSet;
        if (existingWitnesses) {
          // Convert existing witnesses to Core format
          const existingCore = existingWitnesses.toCore();

          // Merge signatures (combine both Maps)
          const mergedSignatures = new Map([
            ...(existingCore.signatures || new Map()),
            ...(signatures || new Map()),
          ]);

          // Create merged witness set - only include properties that are defined
          const mergedWitnessCore: Cardano.Witness = {
            signatures: mergedSignatures,
            ...(existingCore.bootstrap && { bootstrap: existingCore.bootstrap }),
            ...(existingCore.scripts && { scripts: existingCore.scripts }),
            ...(existingCore.redeemers && { redeemers: existingCore.redeemers }),
            ...(existingCore.datums && { datums: existingCore.datums }),
          };

          finalWitnessSet = Serialization.TransactionWitnessSet.fromCore(mergedWitnessCore);
        } else {
          finalWitnessSet = Serialization.TransactionWitnessSet.fromCore({
            signatures,
          });
        }

        witnesses.value = finalWitnessSet.toCbor();
        if (txAutoSubmit.value) {
          await confirm();
        }
      }
    } catch (e: any) {
      if (e instanceof DeviceStatusError) {
        const error: DeviceStatusError = e;
        switch (error.code) {
          case 0x5515:
          case 0x6E11:
            snackbar.setError(String(t('wallet.ledgerDeviceLocked')));
            break;
          default:
            snackbar.setError(String(t('wallet.ledgerDeviceError', { message: error.message })));
        }
      } else {
        console.log(e);
        snackbar.setError(e);
      }
    } finally {
      txSignLoading.value = false;
    }
  };
  if (loggedWallet.value.type === WalletType.Normal) {
    if (form.value.validate()) {

      const passwordVerification = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: spendingPassword.value }
      }) as { data: { isValid: boolean; error?: string } };

      if (passwordVerification.data.isValid) {
        await signAndReturnTx();
      } else {
        passwordField.value?.showError(t('wallet.invalidSpendingPassword'));
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
    loading.value = true;
    tx.value = deserializeCardanoJsSdkTx(txCbor);
    const queryParams = route.query;

    // Make Cardano Shield scan non-blocking with 5-second timeout
    // Don't block the UI if the scan is slow or fails
    const scanWithTimeout = Promise.race([
      cardanoShieldApi.scanTx({
        cborHex: txCbor,
        toAddress: recipient.value,
        fromAddress: changeAddress.value,
        url: queryParams['website'] as string,
      }),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error('Cardano Shield scan timeout')), 10000)
      )
    ]);

    try {
      risks.value = await scanWithTimeout;
      console.log('SignTx received Cardano Shield response:', risks.value);
      console.log('SignTx passing risks.score to TransactionRisk:', risks.value?.score);
    } catch (e) {
      console.warn('Cardano Shield scan failed or timed out:', e);
      risks.value = {
        addressRisk: 'unknown',
        score: 'unknown',  // Default score when scan fails
      };
    } finally {
      loading.value = false;
    }
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

  // Set document title
  document.title = `Gero Dashboard | ${t('wallet.signTransaction')}`;
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
