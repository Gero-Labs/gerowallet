<template>
  <div class="fill-height">
    <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
      <v-card-title>Quick Actions</v-card-title>
      <v-card-text class="d-flex justify-space-between align-content-space-between">
        <v-row no-gutters>
          <v-col cols="6">
            <v-layout column style="align-items: center">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="currentDialog = dialogs.SEND">
                <v-avatar tile size="80">
                  <v-img
                    :src="require('@/assets/svg/send.svg')"
                    alt="Send"
                    contain
                    style="
                      filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);
                    "
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Send</span>
            </v-layout>
          </v-col>
          <v-col cols="6">
            <v-layout column style="align-items: center">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="currentDialog = dialogs.RECEIVE">
                <v-avatar tile size="80">
                  <v-img
                    :src="require('@/assets/svg/qr-code.svg')"
                    alt="Receive"
                    contain
                    style="
                      filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);
                    "
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Receive</span>
            </v-layout>
          </v-col>
          <v-col cols="6">
            <v-layout column style="align-items: center">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="currentDialog = dialogs.SWAP">
                <v-avatar tile size="80">
                  <v-img
                    :src="require('@/assets/svg/swap.svg')"
                    alt="Swap"
                    contain
                    style="
                      filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);
                    "
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Swap</span>
            </v-layout>
          </v-col>
          <v-col cols="6">
            <v-layout column style="align-items: center">
              <v-btn
                text
                plain
                rounded
                class="px-0"
                height="100"
                width="100"
                @click="buy"
                :disabled="isBuyDisabled"
                :style="isBuyDisabled ? { filter: 'brightness(0.5)' } : {}"
              >
                <v-avatar tile size="80">
                  <v-img :src="require('@/assets/svg/dollar-shield.svg')" alt="Swap" contain></v-img>
                </v-avatar>
              </v-btn>
              <span>Buy</span>
            </v-layout>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions></v-card-actions>
    </v-card>
    <ReceiveDialog :isOpen="currentDialog === dialogs.RECEIVE" @close="closeDialog"></ReceiveDialog>
    <SwapDialog :isOpen="currentDialog === dialogs.SWAP" @close="closeDialog"></SwapDialog>
    <BuyDialog :isOpen="currentDialog === dialogs.BUY" @close="closeDialog"></BuyDialog>
    <SendDialog :isOpen="currentDialog === dialogs.SEND" @close="closeDialog"></SendDialog>
  </div>
</template>
<script>
import ReceiveDialog from "@/modules/dashboard/dialogs/ReceiveDialog.vue";
import SwapDialog from "@/modules/dashboard/dialogs/SwapDialog.vue";
import BuyDialog from "@/modules/dashboard/dialogs/BuyDialog.vue";
import { useStore } from "@/store";
import { Blockchain, Network } from "@/models/types";
import { loadMoonPay } from "@moonpay/moonpay-js";
import SendDialog from "../dialogs/SendDialog.vue";

export default {
  name: "QuickActions",
  components: {
    BuyDialog,
    SwapDialog,
    ReceiveDialog,
    SendDialog,
  },
  computed: {
    isBuyDisabled() {
      return (
        this.store.getWallet.wallet.network !== Network.MAINNET ||
        this.store.getWallet.wallet.chain !== Blockchain.CARDANO
      );
    },
  },
  methods: {
    async buy() {
      // const moonPay = await loadMoonPay();
      // const widget = moonPay?.({
      //   flow: "buy",
      //   environment: "sandbox",
      //   variant: 'overlay',
      //   params: {
      //     apiKey: "MOONPAY_API_KEY_REMOVED",
      //     enabledPaymentMethods: "credit_debit_card",
      //     currencyCode: "ada",
      //     walletAddress: useStore().getWallet.wallet.baseAddress().to_address().to_bech32(),
      //     colorCode: '#2f9cac',
      //     baseCurrencyCode: 'usd',
      //     theme: 'dark',
      //   },
      //   handlers: {
      //     async onTransactionCompleted(props) {
      //       console.log("onTransactionCompleted", props);
      //     },
      //   },
      // });
      //
      // widget?.show();
    },
    closeDialog() {
      this.currentDialog = null;
    },
  },
  data: () => ({
    store: useStore(),
    currentDialog: null,
    dialogs: {
      SEND: "SEND",
      RECEIVE: "RECEIVE",
      SWAP: "SWAP",
      BUY: "BUY",
    },
  }),
};
</script>
<style scoped></style>
