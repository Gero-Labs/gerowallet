<template>
  <div class="fill-height">
    <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
      <v-card-title>Quick Actions</v-card-title>
      <v-card-text class="d-flex justify-space-between align-content-space-between">
        <v-layout column style="align-items: center;">
          <v-btn text plain rounded class="px-0" height="100" width="100">
            <v-avatar tile size="80">
              <v-img :src="require('@/assets/svg/send-01.svg')" alt="Send"
                     style="filter: invert(83%) sepia(48%) saturate(3753%) hue-rotate(133deg) brightness(92%) contrast(108%);"
              ></v-img>
            </v-avatar>
          </v-btn>
          <span>Send</span>
        </v-layout>
        <v-layout column style="align-items: center;">
          <v-btn text plain rounded class="px-0" height="100" width="100" @click="receiveDialog = true">
            <v-avatar tile size="80">
              <v-img :src="require('@/assets/svg/qr-code-01.svg')" alt="Receive"
                     style="filter: invert(83%) sepia(16%) saturate(992%) hue-rotate(92deg) brightness(94%) contrast(92%);"
              ></v-img>
            </v-avatar>
          </v-btn>
          <span>Receive</span>
        </v-layout>
        <v-layout column style="align-items: center;">
          <v-btn text plain rounded class="px-0" height="100" width="100" @click="swapDialog = true">
            <v-avatar tile size="80">
              <v-img :src="require('@/assets/svg/coins-swap-02.svg')" alt="Swap"
                     style="filter: invert(62%) sepia(76%) saturate(306%) hue-rotate(314deg) brightness(105%) contrast(98%);"
              ></v-img>
            </v-avatar>
          </v-btn>
          <span>Swap</span>
        </v-layout>
      </v-card-text>
      <v-card-actions></v-card-actions>
    </v-card>
    <receive-dialog :dialog="receiveDialog" @dialogChange="receiveDialogChange"></receive-dialog>
    <swap-dialog :dialog="swapDialog" @dialogChange="swapDialogChange"></swap-dialog>
  </div>
</template>
<script>
import ReceiveDialog from "@/components/dialogs/ReceiveDialog.vue";
import SwapDialog from "@/components/dialogs/SwapDialog.vue";

export default {
  name: "QuickActions",
  components: {SwapDialog, ReceiveDialog},
  methods: {
    receiveDialogChange(val) {
      this.receiveDialog = val
    },
    swapDialogChange(val) {
      this.swapDialog = val
    }
  },
  data: () => ({
    receiveDialog: false,
    swapDialog: false,

  }),
}
</script>
<style scoped>

</style>