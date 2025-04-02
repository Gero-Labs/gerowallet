<template>
  <div class="fill-height" style="height: 100%">
    <v-card outlined class="row no-gutters fill-height d-flex justify-space-between align-content-space-between">
      <v-card-text class="d-flex justify-space-between align-content-space-between pa-0 fill-height">
        <v-row no-gutters>
          <v-col cols="6" class="pa-2" style="align-content: center;">
            <v-layout column style="align-items: center">
              <v-btn text plain rounded class="px-0" height="100" width="100" @click="currentDialog = dialogs.DEPOSIT">
                <v-avatar tile size="80">
                  <v-img
                      :src="assets.piggyBankSvg"
                      alt="Send"
                      contain
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Deposit</span>
            </v-layout>
          </v-col>
          <v-col cols="6" class="pa-2" style="align-content: center;">
            <v-layout column style="align-items: center">
              <v-btn text plain rounded class="px-0" height="100" width="100" :disabled="true" @click="currentDialog = dialogs.WITHDRAWAL">
                <v-avatar tile size="80">
                  <v-img
                      :src="assets.withdrawalSvg"
                      alt="Receive"
                      contain
                  ></v-img>
                </v-avatar>
              </v-btn>
              <span>Withdrawl</span>
            </v-layout>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions></v-card-actions>
    </v-card>
    <DepositDialog :isOpen="currentDialog === dialogs.DEPOSIT" @close="closeDialog"></DepositDialog>
  </div>
</template>
<script lang="ts">
import {defineComponent} from 'vue'
import DepositDialog from "@/modules/zkFiat/DepositDialog.vue";
import assets from '@/utils/assets';

export default defineComponent({
  name: "zkFiat",
  components: {DepositDialog},
  computed: {

  },
  methods: {
    closeDialog() {
      this.currentDialog = null;
    },
  },
  data: () => ({
    currentDialog: null,
    dialogs: {
      DEPOSIT: "DEPOSIT",
      WITHDRAWAL: "WITHDRAWAL"
    },
    assets,
  }),
})
</script>
<style scoped>

</style>
