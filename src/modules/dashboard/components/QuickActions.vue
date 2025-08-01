<template>
  <div class="fill-height">
    <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
      <v-card-text class="d-flex justify-space-between align-content-space-between pa-0 fill-height">
        <v-row no-gutters>
          <v-col cols="6" class="pa-2" style="align-content: center;">
            <v-layout column style="align-items: center">
              <v-btn text plain class="px-0" height="60" width="60" @click="currentDialog = dialogs.SEND">
                <v-avatar tile size="50">
                  <v-img
                    :src="assets.sendSvg"
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
          <v-col cols="6" class="pa-2" style="align-content: center;">
            <v-layout column style="align-items: center">
              <v-btn text plain class="px-0" height="60" width="60" @click="currentDialog = dialogs.RECEIVE">
                <v-avatar tile size="50">
                  <v-img
                    :src="assets.qrCodeSvg"
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
          <v-col cols="6" class="pa-2" style="align-content: center;" v-if="!isSwapDisabled">
            <v-layout column style="align-items: center">
              <v-btn text plain class="px-0" height="60" width="60" @click="currentDialog = dialogs.SWAP"
                     :disabled="isSwapDisabled"
              >
                <v-avatar tile size="50">
                  <v-img
                    :src="assets.swapSvg"
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
          <v-col cols="6" class="pa-2" style="align-content: center;" v-if="!isBuyDisabled">
            <v-layout column style="align-items: center">
              <v-btn
                text
                plain
                class="px-0"
                height="60"
                width="60"
                @click="currentDialog = dialogs.BUY"
                :disabled="isBuyDisabled"
                :style="isBuyDisabled ? { filter: 'brightness(0.5)' } : {}"
              >
                <v-avatar tile size="50">
                  <v-img :src="assets.dollarShieldSvg" alt="Buy" contain></v-img>
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
    <SwapDialog v-if="!isSwapDisabled" :isOpen="currentDialog === dialogs.SWAP" @close="closeDialog"></SwapDialog>
    <BuyDialog v-if="!isBuyDisabled" :isOpen="currentDialog === dialogs.BUY" @close="closeDialog"></BuyDialog>
    <SendDialog :isOpen="currentDialog === dialogs.SEND" @close="closeDialog"></SendDialog>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import ReceiveDialog from "@/modules/dashboard/dialogs/ReceiveDialog.vue";
import SwapDialog from "@/modules/dashboard/dialogs/SwapDialog.vue";
import BuyDialog from "@/modules/dashboard/dialogs/BuyDialog.vue";
import SendDialog from "../dialogs/SendDialog.vue";
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';

const props = defineProps({
  utxos: {
    type: Array,
    default: () => [],
  },
});

const { loggedWallet } = toRefs(walletStore);

const currentDialog = ref<string | null>(null);

const dialogs = {
  SEND: "SEND",
  RECEIVE: "RECEIVE",
  SWAP: "SWAP",
  BUY: "BUY",
};

const isBuyDisabled = computed(() => {
  if (loggedWallet.value) {
    return !networks.resolveBuySupported(loggedWallet.value?.chain, loggedWallet.value?.network)
  }
  return true
});

const isSwapDisabled = computed(() => {
  if (loggedWallet.value) {
    return !networks.resolveSwapSupport(loggedWallet.value?.chain, loggedWallet.value?.network)
  }
  return true
});

const closeDialog = () => {
  currentDialog.value = null;
};
</script>
<style scoped></style>
