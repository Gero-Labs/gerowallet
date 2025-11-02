<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader :title="String($t('navigation.signData'))" :show-website="!(vmProxy.$route.query['website'] === 'undefined' || Object.keys(vmProxy.$route.query).length === 0)" :disabled="loading">
      <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
        <v-card-title class="pa-0" style="color: white; font-size: 14px">
          The website requested a signature
        </v-card-title>
        <v-card flat outlined style="background-color: #141414!important;flex: 1 1 auto; overflow-y: auto; max-height: 100%; height: 0;" class="pa-2" height="157">
          <v-card flat class="overflow-y-auto transparent" height="143">
            <v-card-text class="dapp-sign-details pa-0">
              {{message}}
            </v-card-text>
          </v-card>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-center pb-0 pt-3 px-0">
        <v-layout>
          <v-row>
            <v-col cols="12" v-if="loggedWallet.type === WalletType.Normal && !signature" class="pb-0">
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
                    :placeholder="$t('navigation.typeYourSpendingPassword')"
                    :label="$t('wallet.spendingPassword')"
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
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Ledger" class="pt-3 pb-0">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch :text-left="$t('wallet.usb')" icon-left="mdi-usb" :text-right="$t('wallet.bluetooth')" icon-right="mdi-bluetooth" :value="isBT" @input="isBT = $event" :disabled="loading" />
              </v-card-subtitle>
            </v-col>
            <v-col cols="6">
              <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline" :disabled="loading">
                Decline
              </v-btn>
            </v-col>
            <v-col cols="6">
              <v-btn
                block
                class="geroButton"
                style="color: black!important;"
                @click="sign"
                :loading="loading"
                :disabled="!valid || loading">
                {{txAutoSubmit ? $t('wallet.signAndConfirm') : !signature ? $t('wallet.sign') : $t('common.confirm')}}
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
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/stores/walletStore';
import { MessageTypes } from '@/models/MessageTypes';
import ledger from '@/shared/utils/ledger';
import { SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import networks from '@/utils/networks';
import { DeviceStatusError } from '@cardano-foundation/ledgerjs-hw-app-cardano';

const { t } = useTranslation();

const { loggedWallet, config, keys } = toRefs(walletStore);
const vmProxy = getCurrentInstance()!.proxy as any;
const spendingPassword = ref('');
const showPassword = ref(false);
const request = ref<any>(null);
const message = ref('');
const valid = ref(false);
const tooltip = ref({
  enabled: false,
  text: t('wallet.wrongSpendingPassword')
});
const isBT = ref(false);
const loading = ref(false);
const controller = ref<any>(null);
const tabId = ref<number | null>(null);
const signature = ref<any>(undefined);
const form = ref<any>(null);

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit;
});

const useSidePanel = computed(() => {
  return config.value?.useSidePanel;
});

const enableToolTip = () => {
  tooltip.value.enabled = true;
  setTimeout(() => {
    tooltip.value.enabled = false;
  }, 3000);
};

const decline = async () => {
  await controller.value.returnData({ data: undefined, error: DataSignError.UserDeclined });
  window.close();
};

const confirm = async () => {
  console.log(signature.value);
  await controller.value.returnData({ data: signature.value, error: undefined });
  window.close();
};

const signAndReturnTx = async () => {
  loading.value = true;
  try {
    const address = request.value.data.address;
    console.log('address', address);
    const payload = request.value.data.payload;
    console.log('payload', payload);

    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address: address,
        payload: payload,
        password: spendingPassword.value,
        accountIndex: 0,
        isUsb: !isBT.value
      }
    }) as { data: { key: string; signature: string } };
    signature.value = res.data;
    if (txAutoSubmit.value) {
      await confirm();
    }
  } catch (e: any) {
    snackbar.setError(e);
    console.log(e);
  }
  loading.value = false;
};

const sign = async () => {
  if (!txAutoSubmit.value && signature.value) {
    await confirm();
    return;
  }
  if (loggedWallet.value.type === WalletType.Normal) {
    if (form.value.validate()) {
      const passwordVerification = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: spendingPassword.value }
      }) as { data: { isValid: boolean; error?: string } };

      if (!passwordVerification.data.isValid) {
        enableToolTip();
      } else {
        await signAndReturnTx();
      }
    }
  } else if (loggedWallet.value.type === WalletType.Ledger) {
    loading.value = true;
    const address = request.value.data.address;
    console.log('address', address);
    const payload = request.value.data.payload;
    console.log('payload', payload);
    try {
      // Create known addresses from wallet keys for Ledger signing
      const network = networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network);
      const knownAddresses = ledger.createKnownAddressesFromKeys(keys.value, network);

      const response: SignedMessageData = await ledger.signData(
        address,
        payload,
        network,
        0,
        !isBT.value,
        knownAddresses
      );
      console.log('response', response);
      signature.value = { signature: response.signatureHex, key: response.signingPublicKeyHex};
      if (txAutoSubmit.value) {
        await confirm();
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
      loading.value = false;
    }
  } else {
    await signAndReturnTx();
  }
};

const init = async () => {
  console.log('init');
  try {
    const requestData = await controller.value.requestData();
    if (requestData?.data?.payload) {
      message.value = Buffer.from(requestData.data.payload, 'hex').toString('utf-8');
    }
    request.value = requestData;
  } catch (e) {
    console.log(e);
  }
};

onMounted(async () => {
  if (useSidePanel.value) {
    console.log('sidePanel')
    const params = new URLSearchParams(window.location.href);
    tabId.value = Number(params.get("tabId"));
    controller.value = Messaging.createInternalSidePanelController(tabId.value);
    console.log(controller.value);
  } else {
    controller.value = Messaging.createInternalController();
  }
  await init();

  // Set document title
  document.title = 'Gero Dashboard | Sign Data';
});
</script>
<style scoped>
.dapp-sign-details {
  font-size: 16px;
  font-weight: 500;
  text-align: left;
  line-height: 20px;
  word-wrap: break-word;
  white-space: pre-line;
  color: white !important;
}
</style>
