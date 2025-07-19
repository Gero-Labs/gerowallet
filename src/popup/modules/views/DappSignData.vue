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
<script>
import rules from '@/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { appWallet, useStore } from '@/stores';
import { Messaging } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import { mapState } from 'pinia';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import { verifyData } from '@/shared/utils/converter';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';

export default {
  name: 'DappSignData',
  components: { ToggleSwitch, PopupHeader },
  computed: {
    ...mapState(useStore, ['loggedWallet']),
    ...mapState(walletConfigStore, ['getTxAutoSubmit', 'getUseSidePanel']),
    txAutoSubmit: {
      get() {
        return this.getTxAutoSubmit
      }
    },
    useSidePanel: {
      get() {
        return this.getUseSidePanel
      }
    },
    WalletType() {
      return WalletType
    }
  },
  methods: {
    enableToolTip() {
      this.tooltip.enabled = true;
      setTimeout(() => {
        this.tooltip.enabled = false;
      }, 3000);
    },
    async decline() {
      await this.controller.returnData({ data: undefined, error: DataSignError.UserDeclined })
      window.close();
    },
    async sign() {
      if (!this.txAutoSubmit && this.signature) {
        await this.confirm()
      }
      const signAndReturnTx = async () => {
        this.loading = true
        try {
          const address = this.request.data.address
          console.log('address', address)
          const payload = this.request.data.payload
          console.log('payload', payload)
          const res = await appWallet.signData(address, payload, this.spendingPassword, 0, !this.isBT)
          console.log(res)
          verifyData(res, address, payload)
          this.signature = res;
          if (this.txAutoSubmit) {
            await this.confirm()
          }
        } catch (e) {
          snackbar.setError(e)
          console.log(e);
        }
        this.loading = false
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
      console.log(this.signature)
      await this.controller.returnData({ data: this.signature, error: undefined })
      window.close();
    },
    async init() {
      console.log('init')
      try {
        const request = await this.controller.requestData();
        if (request?.data?.payload) {
          this.message = Buffer.from(request.data.payload, 'hex').toString('utf-8')
        }
        this.request = request;
      } catch (e) {
        console.log(e);
      }
    }
  },
  data() {
    return {
      rules,
      spendingPassword: '',
      showPassword: false,
      request: null,
      message: ``,
      password: '',
      valid: false,
      tooltip: {
        enabled: false,
        text: 'Wrong Spending Password!'
      },
      isBT: false,
      loading: false,
      controller: null,
      tabId: null,
      signature: undefined,
    };
  },
  async mounted() {
    if (this.useSidePanel) {
      const params = new URLSearchParams(window.location.href);
      this.tabId = Number(params.get("tabId"));
      this.controller = Messaging.createInternalSidePanelController(this.tabId)
    } else {
      this.controller = Messaging.createInternalController()
    }

    await this.init();
  },
};
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
