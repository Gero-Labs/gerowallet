<template>
  <div>
    <div
      style="display: flex; height: 44px; border: 1px solid rgba(128,128,128,0.15); background-color: transparent!important; border-radius: 12px; padding: 8px; gap: 8px;">
      <div style="align-content: center; text-align: center;" v-if="!isBuyDisabled">
        <v-tooltip bottom>
          <template v-slot:activator="{ on, attrs }">
            <v-btn color="#FFF59E1A" class="px-0" height="28" min-width="28" max-width="28"
                   @click="currentDialog = dialogs.BUY" v-bind="attrs" v-on="on">
              <v-avatar tile size="18">
                <v-img
                  :src="require('@/assets/svg/dollar-shield.svg')"
                  alt="Buy"
                  contain
                ></v-img>
              </v-avatar>
            </v-btn>
          </template>
          <span>Buy {{ currencyTicker }}</span>
        </v-tooltip>
      </div>
      <div style="align-content: center; text-align: center;">
        <v-tooltip bottom>
          <template v-slot:activator="{ on, attrs }">
            <v-btn color="#00DFF31A" class="px-0" height="28" min-width="28" max-width="28"
                   @click="currentDialog = dialogs.SEND" v-bind="attrs" v-on="on">
              <v-avatar tile size="18">
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
          </template>
          <span>Send</span>
        </v-tooltip>
      </div>
      <div style="align-content: center; text-align: center;">
        <v-tooltip bottom>
          <template v-slot:activator="{ on, attrs }">
            <v-btn color="#75E0A71A" class="px-0" height="28" min-width="28" max-width="28"
                   @click="currentDialog = dialogs.RECEIVE" v-bind="attrs" v-on="on">
              <v-avatar tile size="18">
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
          </template>
          <span>Receive</span>
        </v-tooltip>
      </div>
      <div style="align-content: center; text-align: center;" v-if="!isSwapDisabled">
        <v-tooltip bottom>
          <template v-slot:activator="{ on, attrs }">
            <v-btn color="#FDA29B1A" class="px-0" height="28" min-width="28" max-width="28"
                   @click="currentDialog = dialogs.SWAP" v-bind="attrs" v-on="on">
              <v-avatar tile size="18">
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
          </template>
          <span>Swap</span>
        </v-tooltip>
      </div>
    </div>
    <ReceiveDialog :isOpen="currentDialog === dialogs.RECEIVE" @close="closeDialog"></ReceiveDialog>
    <SwapDialog v-if="!isSwapDisabled" :isOpen="currentDialog === dialogs.SWAP" @close="closeDialog"></SwapDialog>
    <BuyDialog v-if="!isBuyDisabled" :isOpen="currentDialog === dialogs.BUY" @close="closeDialog"></BuyDialog>
    <SendDialog :isOpen="currentDialog === dialogs.SEND" @close="closeDialog"></SendDialog>
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import ReceiveDialog from '@/modules/dashboard/dialogs/ReceiveDialog.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import SendDialog from '@/modules/dashboard/dialogs/SendDialog.vue';
import BuyDialog from '@/modules/dashboard/dialogs/BuyDialog.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import networks from '@/shared/utils/networks';

export default defineComponent({
  name: 'QuickActionsBox',
  components: { BuyDialog, SendDialog, SwapDialog, ReceiveDialog },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'baseAddress']),
    isBuyDisabled() {
      if (this.loggedWallet) {
        return !networks.resolveBuySupported(this.loggedWallet.chain, this.loggedWallet.network);
      }
      return true;
    },
    isSwapDisabled() {
      if (this.loggedWallet) {
        return !networks.resolveSwapSupport(this.loggedWallet?.chain, this.loggedWallet?.network);
      }
      return true;
    },
    currencyTicker() {
      if (this.loggedWallet) {
        return networks.resolveCurrencyTicker(this.loggedWallet?.chain, this.loggedWallet?.network);
      }
      return '';
    },
  },
  methods: {
    closeDialog() {
      this.currentDialog = null;
    },
  },
  data: () => ({
    currentDialog: null,
    dialogs: {
      SEND: 'SEND',
      RECEIVE: 'RECEIVE',
      SWAP: 'SWAP',
      BUY: 'BUY',
    },
  }),
});
</script>
<style scoped>

</style>
