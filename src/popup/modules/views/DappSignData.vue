<template>
  <v-form ref="form" v-model="valid" class="fill-height">
    <PopupHeader title="Sign Data">
      <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
        <v-card-title class="pa-0" style="color: white; font-size: 14px">
          The website requested a signature
        </v-card-title>
        <v-card flat style="background-color: #141414!important;" class="pa-2" height="157">
          <v-card flat class="overflow-y-auto transparent" height="143" >
            <v-card-text class="dapp-sign-details pa-0">
              {{message}}
            </v-card-text>
          </v-card>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-center py-2 px-0">
        <v-layout>
          <v-row>
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
      <v-snackbar top v-model="snackbar.enabled" rounded color="red" transition="scroll-y-transition">{{snackbar.text}}</v-snackbar>
    </PopupHeader>
  </v-form>
</template>
<script>
import rules from '@/shared/utils/rules';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { useStore } from '@/store';
import { Messaging } from '@/chrome/messaging';
import { DataSignError } from '@/chrome/config';

export default {
  name: 'DappSignData',
  components: { PopupHeader },
  methods: {
    async decline() {
      await this.controller.returnData({ data: undefined, error: DataSignError.UserDeclined })
      window.close();
    },
    async confirm() {
      if (this.$refs.form.validate()) {
        const wallet = useStore().getWallet
        if (wallet.verifySpendingPassword(this.spendingPassword)) {
          try {
            const res = await wallet.signData(this.request.data.address, this.request.data.payload, this.spendingPassword, 0)
            await this.controller.returnData({ data: res, error: undefined })
            console.log(res)
          } catch (e) {
            console.log(e)
            await this.controller.returnData({ data: undefined, error: e })
          }
          window.close();
        } else {
          this.snackbar.enabled = true
        }
      }
    },
    async init() {
      const request = await this.controller.requestData();
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
