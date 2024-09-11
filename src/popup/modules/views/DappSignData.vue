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
      <v-card-actions class="justify-center py-2 px-0">
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
            <v-col cols="12" v-else-if="loggedWallet.type === WalletType.Ledger" class="pt-3 pb-0">
              <v-card-subtitle class="pa-0 text-center justify-center pt-0" style="color: white">
                <USBBluetoothSwitch v-model="isBT" :disabled="loading" />
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
                @click="confirm"
                :loading="loading"
                :disabled="!valid || loading">
                Sign & Confirm
              </v-btn>
            </v-col>
          </v-row>
        </v-layout>
      </v-card-actions>
      <v-snackbar top v-model="snackbar.enabled" rounded color="red" transition="scroll-y-transition">{{snackbar.text}}</v-snackbar>
    </PopupHeader>
  </v-form>
</template>
<script>
import rules from '@/shared/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { appWallet, useStore } from '@/store';
import { Messaging } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';
import USBBluetoothSwitch from '@/shared/components/USBBluetoothSwitch.vue';
import { mapState } from 'pinia';
import { WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';

export default {
  name: 'DappSignData',
  components: { USBBluetoothSwitch, PopupHeader },
  computed: {
    ...mapState(useStore, ['loggedWallet']),
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
    async confirm() {
      const signAndReturnTx = async () => {
        this.loading = true
        try {
          const address = this.request.data.address
          const payload = this.request.data.payload
          console.log('address', address)
          console.log('payload', payload)
          const response = await appWallet.signData(address, payload, this.spendingPassword, 0, !this.isBT)
          console.log(response)
          await this.controller.returnData({ data: response.witnesses, error: undefined })
          // window.close();
        } catch (e) {
          snackbar.setError(e)
          console.log(e);
          await this.controller.returnData({ data: undefined, error: e });
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
    async init() {
      // const request = await this.controller.requestData();
      const request = {
        data: {
          payload: '7b22707572706f7365223a224b6f696f73204163636f756e7420566572696669636174696f6e222c226163636f756e74223a2265313238636238366636626133316461363439646639346233663535393565396435336632623661373163303535643166353938643061663735222c226e6f6e6365223a313732363034373131333532367d',
          address: 'e128cb86f6ba31da649df94b3f5595e9d53f2b6a71c055d1f598d0af75'
        }
      }
      if (request?.data?.payload) {
        this.message = Buffer.from(request.data.payload, 'hex').toString('utf-8')
      }
      this.request = request;
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
      snackbar: {
        enabled: false,
        text: 'Wrong Spending Password!'
      },
      isBT: false,
      loading: false,
      controller: Messaging.createInternalController()
    };
  },
  async created() {
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
