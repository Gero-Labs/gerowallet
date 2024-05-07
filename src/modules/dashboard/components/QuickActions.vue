<template>
  <div class="fill-height">
    <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
      <v-card-title>Quick Actions</v-card-title>
      <v-card-text class="d-flex justify-space-between align-content-space-between">
        <v-row no-gutters>
          <v-col cols="6">
            <v-layout column style="align-items: center;">
              <v-btn text plain rounded class="px-0" height="100" width="100">
                <v-avatar tile size="80">
                  <v-img :src="require('@/assets/svg/send.svg')" alt="Send" contain
                         style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Send</span>
            </v-layout>
          </v-col>
          <v-col cols="6">
            <v-layout column style="align-items: center;">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="receiveDialog = true">
                <v-avatar tile size="80">
                  <v-img :src="require('@/assets/svg/qr-code.svg')" alt="Receive" contain
                         style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Receive</span>
            </v-layout>
          </v-col>
          <v-col cols="6">
            <v-layout column style="align-items: center;">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="swapDialog = true">
                <v-avatar tile size="80">
                  <v-img :src="require('@/assets/svg/swap.svg')" alt="Swap" contain
                         style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Swap</span>
            </v-layout>
          </v-col>
          <v-col cols="6">
            <v-layout column style="align-items: center;">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="buyDialog = true" :disabled="true" style="filter: brightness(0.5)">
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
    <receive-dialog :dialog="receiveDialog" @dialogChange="receiveDialogChange"></receive-dialog>
    <swap-dialog :dialog="swapDialog" @dialogChange="swapDialogChange"></swap-dialog>
    <buy-dialog :dialog="buyDialog" @dialogChange="buyDialogChange"></buy-dialog>
  </div>
</template>
<script>
import ReceiveDialog from "@/modules/dashboard/dialogs/ReceiveDialog.vue";
import SwapDialog from "@/modules/dashboard/dialogs/SwapDialog.vue";
import BuyDialog from "@/modules/dashboard/dialogs/BuyDialog.vue";

export default {
  name: "QuickActions",
  components: {BuyDialog, SwapDialog, ReceiveDialog},
  methods: {
    receiveDialogChange(val) {
      this.receiveDialog = val
    },
    swapDialogChange(val) {
      this.swapDialog = val
    },
    buyDialogChange(val) {
      this.buyDialog = val
    }
  },
  data: () => ({
    receiveDialog: false,
    swapDialog: false,
    buyDialog: false,
  }),
}
</script>
<style scoped>

</style>