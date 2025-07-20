<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Sign Data" :show-website="!(this.$route.query['website'] === 'undefined' || Object.keys(this.$route.query).length === 0)" :disabled="loading">
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
                    placeholder="Type your spending password"
                    label="Spending Password"
                    :type="showPassword ? 'text' : 'password'"
                    :rules="[rules.required()]"
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
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Ledger" class="pt-3 pb-0">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <ToggleSwitch text-left="USB" icon-left="mdi-usb" text-right="Bluetooth" icon-right="mdi-bluetooth" v-model="isBT" :disabled="loading" />
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
                {{txAutoSubmit ? 'Sign & Confirm' : !signature ? 'SIGN' : 'CONFIRM'}}
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
    </PopupHeader>
  </v-form>
</template>
<script setup lang="ts">
import { ref, computed, onMounted, toRefs } from 'vue';
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { appWallet } from '@/stores';
import { Messaging } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import { verifyData } from '@/shared/utils/converter';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import { walletStore } from '@/plugins/walletStore';

const { loggedWallet, config } = toRefs(walletStore);

const spendingPassword = ref('');
const showPassword = ref(false);
const request = ref<any>(null);
const message = ref('');
const password = ref('');
const valid = ref(false);
const tooltip = ref({
  enabled: false,
  text: 'Wrong Spending Password!'
});
const isBT = ref(false);
const loading = ref(false);
const controller = ref<any>(null);
const tabId = ref<number | null>(null);
const signature = ref<any>(undefined);
const form = ref<any>(null);

const txAutoSubmit = computed(() => {
  return config.value?.txAutoSubmit || true;
});

const useSidePanel = computed(() => {
  return config.value?.useSidePanel || true;
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

const sign = async () => {
  if (!txAutoSubmit.value && signature.value) {
    await confirm();
    return;
  }

  const signAndReturnTx = async () => {
    loading.value = true;
    try {
      const address = request.value.data.address;
      console.log('address', address);
      const payload = request.value.data.payload;
      console.log('payload', payload);
      const res = await appWallet.signData(address, payload, spendingPassword.value, 0, !isBT.value);
      console.log(res);
      verifyData(res, address, payload);
      signature.value = res;
      if (txAutoSubmit.value) {
        await confirm();
      }
    } catch (e) {
      snackbar.setError(e);
      console.log(e);
    }
    loading.value = false;
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
