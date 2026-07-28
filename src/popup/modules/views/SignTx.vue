<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="t('navigation.transactionSummary')" ref="popupHeader" :show-website="!(route.query['website'] === 'undefined' || Object.keys(route.query).length === 0)">
      <v-card-text class="d-flex flex-column justify-space-between pa-0" style="flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;">
        <DappAddress class="mb-2" :address="recipient" :risk="risks?.addressRisk" />
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.give" :risk="true">
          {{ $t('navigation.youreGiving') }}
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-icon class="ml-1" small color="#C4C4C4" v-bind="attrs" v-on="on">
                mdi-information-outline
              </v-icon>
            </template>
            <div>
              <span>{{ $t('wallet.tokensWillBeSent', { currency: networks.resolveCurrencyTicker(loggedWallet?.chain, loggedWallet?.network) }) }}</span>
            </div>
          </v-tooltip>
        </TransactionCard>
        <TransactionCard v-if="swapDetails" :transaction="swapDetails.receive" :risk="risks?.receivingRisk">
          {{ $t('navigation.youreReceiving') }}
          <v-tooltip bottom content-class="custom-tooltip">
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
        <v-row no-gutters style="flex: none; position: relative;">
          <v-col cols="12" class="justify-center text-center">
            <TransactionRisk :risk="risks?.score" :loading="loading" />
          </v-col>
          <div style="position: absolute; bottom: 0; right: 0;">
            <CopyButton x-small :value="request?.data ? request?.data.tx : ''" :title="'CBOR'"></CopyButton>
          </div>
        </v-row>
      </v-card-text>
      <v-card-actions class="justify-center pa-0 pt-2">
        <v-layout>
          <v-row>
            <v-col cols="12" v-if="loggedWallet.type === WalletType.Normal && !isPrfWallet">
              <PassKeyPasswordField
                ref="passwordField"
                :value="spendingPassword"
                @input="spendingPassword = $event"
                outlined
                dense
                hide-details="auto"
                :placeholder="t('navigation.typeYourSpendingPassword')"
                :rules="[rules.required()]"
                required
                @enter="sign"
                @passkey-autofill-success="handlePassKeySuccess"
                @passkey-autofill-error="handlePassKeyError"
                class="w-100"
              />
            </v-col>
            <!-- PRF Wallet: PassKey Button or Submit Button -->
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Normal && isPrfWallet" class="pt-3 pb-0">
              <!-- Before signing: PassKey button -->
              <PassKeyAuthButton
                v-if="!witnesses"
                :disabled="txSignLoading"
                @success="handlePassKeyAuthSuccess"
                @error="handlePassKeyAuthError"
                block
                class="mb-2"
              />
              <!-- After signing: Submit button -->
              <v-btn
                v-else
                block
                class="geroButton"
                style="color: black!important;"
                @click="sign"
                :disabled="txSignLoading"
                :loading="txSignLoading"
              >
                {{ $t('common.confirm') }}
              </v-btn>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.btSupported" class="py-0">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch
                  :text-left="t('wallet.usb')"
                  icon-left="mdi-usb"
                  :text-right="t('wallet.bluetooth')"
                  icon-right="mdi-bluetooth"
                  v-model="isBT"
                  :disabled="txSignLoading"
                />
              </v-card-subtitle>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Keystone" class="pt-3 pb-0">
              <v-alert type="info" color="primary" text border="left" dense class="py-1 my-0" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.scanQRWithKeystone') }}
                </span>
              </v-alert>
            </v-col>
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Trezor" class="pt-3 pb-0">
              <v-alert type="info" color="primary" text border="left" dense class="py-1 my-0" style="line-height: 1.2">
                <span style="color: white; font-size: 12px">
                  {{ $t('wallet.signTxWithTrezor') }}
                </span>
              </v-alert>
            </v-col>
            <v-col :cols="isPrfWallet ? 12 : 6">
              <v-btn block outlined color="error" class="capitalize" @click="decline" :disabled="txSignLoading">
                {{ $t('wallet.decline') }}
              </v-btn>
            </v-col>
            <!-- Hide action button for PRF wallets (handled above) -->
            <v-col cols="6" v-if="!isPrfWallet">
              <v-btn block class="geroButton" style="color: black!important;" @click="sign" :disabled="!valid || txSignLoading" :loading="txSignLoading">
                {{txAutoSubmit ? $t('wallet.signAndConfirm') : !witnesses ? $t('wallet.sign') : $t('common.confirm')}}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
      <v-overlay v-show="hardwareLoading.loading" opacity="0.9" style="text-align: center; ">
        <v-card flat style="background-color: transparent!important; text-align: -webkit-center;">
          <video :src="assets.loadingAnimation" playsinline autoplay muted loop style="width: 120px; object-fit: contain; object-position: center bottom; left: 0; top: 0;">
          </video>
          <v-progress-linear
            buffer-value="0"
            color="primary"
            reverse
            stream
            value="0"
            style="color: cyan; width: 100px; text-align: center"
          ></v-progress-linear>
          <v-card-title v-if="hardwareLoading.text" v-html="hardwareLoading.text" style="word-break: break-word;" />
        </v-card>
      </v-overlay>

      <!-- Keystone QR Code Overlay -->
      <v-overlay
        :absolute="true"
        opacity="0.99"
        :value="keystoneOverlay"
        class="hardwareOverlay"
      >
        <v-alert
          color="white"
          dense
          outlined
          type="info"
          border="left"
          prominent
          v-if="!keystoneScan"
          class="mt-2 mb-2"
        >
          <b style="font-size: 16px;">{{ $t('wallet.instructions') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.unlockKeystone') }}</li>
            <li>{{ $t('wallet.selectScanQR') }} <v-icon x-small>mdi-line-scan</v-icon></li>
            <li>{{ $t('wallet.useKeystoneToScan') }}</li>
            <li>{{ $t('wallet.approveAndScanNext') }}</li>
          </ul>
        </v-alert>

        <v-alert
          color="white"
          dense
          outlined
          type="info"
          border="left"
          v-else
          class="mt-2 mb-2"
          prominent
        >
          <b style="font-size: 16px;">{{ $t('wallet.scanQRCode') }}</b>
          <ul class="text-left" style="line-height: 1.3; font-size: 11px; margin-top: 4px; padding-left: 10px;">
            <li>{{ $t('wallet.adjustDistance') }}</li>
            <li>{{ $t('wallet.useLowDensity') }}</li>
          </ul>
        </v-alert>

        <div v-if="!keystoneScan && keystoneCbor" style="max-width: 300px; margin: 0 auto;">
          <AnimatedQRCode :type="keystoneType" :cbor="keystoneCbor" :size="300" :capacity="100" />
        </div>
        <div v-else>
          <AnimatedQRScanner
            purpose="sign"
            :urTypes="['cardano-signature']"
            width="100%"
            height="260px"
            @scan="onKeystoneScan"
            @error="onKeystoneError"
            @progress="onKeystoneProgress"
          />
        </div>

        <div class="text-center pt-2">
          <v-btn text small @click="backKeystoneScan" class="mr-2">
            {{ keystoneScan ? $t('common.back') : $t('common.cancel') }}
          </v-btn>
          <v-btn
            v-if="!keystoneScan"
            small
            class="geroButton"
            style="color: black!important;"
            @click="keystoneScan = true"
          >
            {{ $t('common.next') }}
          </v-btn>
        </div>
      </v-overlay>
    </PopupHeader>
  </v-form>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import {
  BackgroundResponse,
  Messaging,
  SignTxResponse,
  VerifyPasswordResponse,
} from '@/chrome/messaging';
import { TxSignError } from '@/chrome/config';
import rules from '@/utils/rules';
import DappAddress from '@/popup/modules/components/DappAddress.vue';
import TransactionCard from '@/popup/modules/components/TransactionCard.vue';
import TransactionRisk from '@/popup/modules/components/TransactionRisk.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import {
  diffAssetsFromIncomingToOutgoing,
  getPayAndReceiveTokens,
} from '@/shared/utils/builder';
import networks from '@/utils/networks';
import { Blockchain, coin_type, purpose, WalletType, Network } from '@/models/types';
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
import ledger from '@/shared/utils/ledger';
import hardwareLoading from '@/plugins/hardwareLoading';
import assets from '@/utils/assets';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import { UR } from '@keystonehq/keystone-sdk';
import AnimatedQRCode from '@/shared/components/AnimatedQRCode.vue';
import AnimatedQRScanner from '@/shared/components/AnimatedQRScanner.vue';
import { debugLog } from '@/utils/debug';

const { t } = useTranslation();
const { loggedWallet, config, utxos, keys } = toRefs(walletStore);

const isBT = ref(false);
const risks = ref<any>(undefined);
const spendingPassword = ref('');
const privateKeyBytes = ref<Uint8Array | null>(null);
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
// Keystone state
const keystoneOverlay = ref(false);
const keystoneScan = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneUseHash = ref(false);

const addresses = computed(() => {
  return new Set([...keys.value.payment, ...keys.value.change].map(el => el.address));
})

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit;
});

// Check if wallet uses PRF encryption (PassKey)
const isPrfWallet = computed(() => {
  return loggedWallet.value?.encryptionMethod === 'prf' ||
         (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId);
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
  let foundRecipients: string[] = [];
  if (outputs.value) {
    for (let i = 0; i < outputs.value.length; i++) {
      const outputAddress = outputs.value[i].address;
      if (!addresses.value.has(outputAddress)) {
        foundRecipients.push(outputAddress)
      }
    }
  }
  if (Array.isArray(foundRecipients) && foundRecipients.length > 0) {
    return foundRecipients[0];
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

const handlePassKeyError = (error: string) => {
  debugLog('[PassKey] Autofill error in SignTx:', error);
  snackbar.setError(error || t('security.passKeyAuthFailed'));
};

const handlePassKeySuccess = () => {
  debugLog('[PassKey] Autofill successful in SignTx - triggering sign');
  // Automatically trigger sign after successful PassKey autofill
  setTimeout(() => {
    sign();
  }, 300); // Small delay for UX feedback
};

const handlePassKeyAuthSuccess = (pkBytes: Uint8Array) => {
  privateKeyBytes.value = pkBytes;
  // Automatically proceed to sign after successful authentication
  setTimeout(() => {
    sign();
  }, 300);
};

const handlePassKeyAuthError = (error: Error) => {
  console.error('PassKey authentication error:', error);
  snackbar.setError(error.message || t('security.passKeyAuthFailed'));
  privateKeyBytes.value = null;
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
            privateKeyBytes: privateKeyBytes.value ? Array.from(privateKeyBytes.value) : undefined,
          }
        }) as { data: { witnesses?: any; error?: string } };

        debugLog('[NORMAL-SIGN] Transaction signed successfully:', witnessResult);

        if (witnessResult.data.error) {
          throw new Error(witnessResult.data.error);
        }

        debugLog('[NORMAL-SIGN] Signed transaction witness:', witnessResult.data.witnesses);
        witnesses.value = witnessResult.data.witnesses;
        if (txAutoSubmit.value) {
          await confirm();
        }
      } else if (loggedWallet.value.type === WalletType.Ledger) {
        hardwareLoading.setLoading(true);
        const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);

        // Extract existing witnesses if this is a partial sign (multisig transaction)
        let existingWitnesses: Serialization.TransactionWitnessSet | undefined;
        if (mergeWitnesses || partialSign) {
          try {
            let path;
            const index = 0
            if (loggedWallet.value.chain === Blockchain.CARDANO) {
              path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/${index}'`
            }
            await ledger.initLedger(isBT.value, path)
            const fullTx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor));
            existingWitnesses = fullTx.witnessSet();
          } catch (e) {
            debugLog('[LEDGER-SIGN] Could not extract existing witnesses:', e);
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
      } else if (loggedWallet.value.type === WalletType.Trezor) {
        // Extract existing witnesses if this is a partial sign (swap/multisig transaction)
        let existingWitnesses: Serialization.TransactionWitnessSet | undefined;
        if (mergeWitnesses || partialSign) {
          try {
            const fullTx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor));
            existingWitnesses = fullTx.witnessSet();
          } catch (e) {
            debugLog('[TREZOR-SIGN] Could not extract existing witnesses:', e);
          }
        }

        const response = await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.TREZOR,
          data: {
            method: 'signTx',
            txCbor
          },
        }) as BackgroundResponse<SignTxResponse>;

        if (!response.data.success) {
          throw new Error(response.data.error || 'Trezor signing failed');
        }

        // Get signatures from Trezor response (comes as array from Chrome messaging)
        // Convert array back to Map (cast via unknown to satisfy TypeScript)
        const signaturesArray = response.data.signatures as unknown as Array<[string, string]>;
        const signatures: Cardano.Signatures = new Map(signaturesArray);

        // Merge Trezor signatures with existing witnesses if any
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

        debugLog('[TREZOR-SIGN] Signing successful:', finalWitnessSet.toCbor());
        witnesses.value = finalWitnessSet.toCbor();
        if (txAutoSubmit.value) {
          await confirm();
        }
      } else if (loggedWallet.value.type === WalletType.Keystone) {
        try {
          // Create transaction object from CBOR
          const fullTx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor));

          // Create Keystone signing request
          const walletData = {
            xfp: loggedWallet.value.xfp,
            stakeAddress: loggedWallet.value.stakeAddress
          };

          const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(fullTx, walletData, utxos.value, keys.value);

          // Store UR data for QR code and signing mode
          keystoneType.value = signRequestResponse.ur.type;
          keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
          keystoneUseHash.value = signRequestResponse.useHash;

          // Show overlay with animated QR code
          keystoneOverlay.value = true;
          keystoneScan.value = false;
        } catch (e: any) {
          debugLog('[KEYSTONE-SIGN] Error:', e);
          snackbar.setError(e.message || t('wallet.keystoneSigningFailed'));
        }
      }
    } catch (e: any) {
      hardwareLoading.setLoading(false);
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
        debugLog('[SIGN] Transaction error:', e);
        snackbar.setError(e);
      }
    } finally {
      txSignLoading.value = false;
    }
  };
  if (loggedWallet.value.type === WalletType.Normal) {
    // PRF wallets: Skip password verification, go directly to signing (will trigger PassKey in background)
    if (isPrfWallet.value) {
      await signAndReturnTx();
    } else {
      // Normal password-based wallets: Verify password first
      if (form.value.validate()) {

        const passwordVerification = await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.VERIFY_SPENDING_PASSWORD,
          data: { password: spendingPassword.value }
        }) as BackgroundResponse<VerifyPasswordResponse>;

        if (passwordVerification.data.success) {
          await signAndReturnTx();
        } else {
          passwordField.value?.showError(t('wallet.invalidSpendingPassword'));
        }
      }
    }
  } else {
    await signAndReturnTx();
  }
};

const onKeystoneScan = async (ur: UR) => {
  try {
    const txCbor = request.value?.data?.tx;
    const partialSign = request.value?.data?.partialSign;
    const mergeWitnesses = request.value?.data?.mergeWitnesses;

    debugLog('[Keystone] UR received with type:', ur.type);

    let existingWitnesses: Serialization.TransactionWitnessSet | undefined;
    if (mergeWitnesses || partialSign) {
      const fullTx = Serialization.Transaction.fromCbor(Serialization.TxCBOR(txCbor));
      existingWitnesses = fullTx.witnessSet();
    }

    // For hash-based signing, the SDK's parseSignature returns empty data
    // We need to extract the witness set directly from the UR CBOR
    let witnessSetHex: string;

    if (keystoneUseHash.value) {
      // Hash-based signing: UR CBOR contains the witness set directly
      debugLog('[Keystone] Processing hash-based signature, extracting witness set from CBOR');
      if (!ur.cbor || ur.cbor.length === 0) {
        throw new Error('Empty CBOR data in hash-based signature');
      }
      // The CBOR from hash-based signing IS the witness set
      witnessSetHex = ur.cbor.toString('hex');
      debugLog('[Keystone] Extracted witness set hex:', witnessSetHex.substring(0, 100) + '...');
    } else {
      // Full CBOR signing: use SDK's parseSignature
      debugLog('[Keystone] Processing full CBOR signature');
      const signature = parseSignature(ur);

      if (!signature.witnessSet || signature.witnessSet.length === 0) {
        throw new Error('Keystone returned empty witness set');
      }
      witnessSetHex = signature.witnessSet;
    }

    let signatures: Cardano.Signatures;
    try {
      signatures = Serialization.TransactionWitnessSet.fromCbor(witnessSetHex).toCore().signatures;
    } catch (error) {
      console.error('[Keystone] Failed to parse witness set CBOR:', error);
      console.error('[Keystone] WitnessSet hex dump:', witnessSetHex);
      throw new Error(`Failed to parse Keystone signature: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

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

    // Close overlay
    keystoneOverlay.value = false;
    keystoneScan.value = false;

    // Submit if txAutoSubmit is enabled
    if (txAutoSubmit.value) {
      await confirm();
    }
  } catch (error) {
    debugLog('[Keystone] Error processing signature:', error);
    snackbar.setError(error instanceof Error ? error.message : t('wallet.keystoneQRScanError'));
    keystoneOverlay.value = false;
    keystoneScan.value = false;
  }
};

const onKeystoneError = (error: string) => {
  debugLog('[Keystone] Scanner error:', error);
  snackbar.setError(error || t('wallet.keystoneScanError'));
};

const onKeystoneProgress = (_progress: number) => {
  // Progress updates handled silently
};

const backKeystoneScan = () => {
  if (keystoneScan.value) {
    keystoneScan.value = false;
  } else {
    keystoneOverlay.value = false;
  }
};

const confirm = async () => {
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

    // Cardano Shield only covers Cardano MAINNET. On preprod/testnet or any
    // non-Cardano chain the scan endpoint has no data and just times out — skip
    // it and report unknown risk so the UI shows N/A (mirrors dashboard
    // SummaryStep + DAppOverlay gate, PR 805).
    const w = loggedWallet.value;
    if (w?.chain !== Blockchain.CARDANO || w?.network !== Network.MAINNET) {
      risks.value = { addressRisk: 'unknown', score: 'unknown' };
      loading.value = false;
      return;
    }

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
      debugLog('[CardanoShield] Received response:', risks.value);
      debugLog('[CardanoShield] Risk score:', risks.value?.score);
    } catch (e) {
      debugLog('[CardanoShield] Scan failed or timed out:', e);
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
  // This view is only ever opened inside a standalone popup window (see
  // openPopupForSignTx in background.ts, which always targets index.html) —
  // never inside the side panel, which renders DAppOverlay.vue instead. It
  // must always speak the popup port protocol. It used to branch on the
  // now-retired Prompt Display Mode setting instead, which connected the
  // wrong port name and hung forever whenever this fallback view was reached.
  controller.value = Messaging.createInternalController();

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
