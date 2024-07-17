<template>
  <PopupHeader title="Connect with Gero Wallet" ref="popupHeader">
    <v-card-text class="d-flex flex-column align-content-space-between pa-0 fill-height">
      <v-card-title class="justify-center pt-0" style="color: white; font-size: 14px">
        Confirm URL before granting the access to DApps!
      </v-card-title>
          <section style="font-weight: bold; color: white; font-size: 16px">
            Allow the site to:
          </section>
          <section style="font-size: 16px">
            <div id="dapp-consent-check">
              <v-checkbox
                class="check"
                color="#00DFF3"
                v-model="consent"
                hide-details
                label="View the address and balance of the selected wallet."
              ></v-checkbox>
            </div>
            <div style="color: white">
              <br/>
              <p class="ml-9">For your security, any future transactions from this website will require you to enter your spending password
                before signing.</p>
            </div>
          </section>
    </v-card-text>
    <v-card-actions class="justify-center py-2 px-0">
      <v-layout>
        <v-row>
          <v-col cols="6">
            <v-btn block outlined color="red" style="text-transform: capitalize;" @click="decline">
              Decline
            </v-btn>
          </v-col>
          <v-col cols="6">
            <v-btn block class="geroButton" style="color: black!important;" :disabled="!consent" @click="confirm">
              Confirm
            </v-btn>
          </v-col>
        </v-row>
      </v-layout>
    </v-card-actions>
  </PopupHeader>
</template>
<script>
import { appWallet, useStore } from '@/store';
import PopupHeader from '@/popup/modules/components/PopupHeader.vue';
import { Messaging } from '@/chrome/messaging';
import { APIError } from '@/chrome/config';

export default {
  name: 'dapp-connect',
  components: { PopupHeader },
  data() {
    return {
      consent: false,
      controller: Messaging.createInternalController()
    };
  },
  methods: {
    async decline() {
      await this.controller.returnData({ data: {}, error: APIError.Refused })
      window.close();
    },
    async confirm() {
      await appWallet.addConnectedDapp(this.$refs.popupHeader.domain);
      await this.controller.returnData({ data: true, error: {} })
      window.close();
    },
  }
};
</script>
