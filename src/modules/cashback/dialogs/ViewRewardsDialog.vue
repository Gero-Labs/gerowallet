<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Your Rewards" subtitle="View your pending and historical rewards">
    <div style="z-index: 3" class="px-4">
      <v-row>
        <v-col cols="12" xl="7" lg="7" md="7">
          <div class="card-text">
            <div style="justify-content: flex-start; align-items: center; gap: 16px; display: inline-flex">
              <div style="flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 16px; display: inline-flex">
                <div style="align-self: stretch; justify-content: center; align-items: center; gap: 12px; display: inline-flex">
                  <v-avatar size="48" class="avatar-bg">
                    <v-icon color="#00DFF3">mdi-gift-outline</v-icon>
                  </v-avatar>
                  <div class="header-text">Ready to Claim</div>
                </div>
                <div class="amount-section">
                  <div class="amount">
                    <div class="highlight-text">A100.00</div>
                  </div>
                  <div class="usd-amount">
                    <div class="usd-text">$1,280</div>
                  </div>
                </div>
              </div>
              <v-btn icon height="100" width="100" style="letter-spacing: normal; font-size: 24px; text-transform: capitalize; color: black; background: linear-gradient(134deg, #00C7F3 40%, #00FFD1 100%);">Claim</v-btn>
            </div>
          </div>
        </v-col>
        <v-col cols="12" xl="5" lg="5" md="5" class="text-center" style="align-content: center;">
          <div>
            <div style="color: white; font-size: 16px; font-weight: 600; line-height: 24px; word-wrap: break-word">Pending Rewards</div>
            <div style="align-self: stretch; color: #A3A3A3; font-size: 30px; font-weight: 600; line-height: 38px; word-wrap: break-word">A100.00</div>
            <div style="align-self: stretch; text-align: center; color: #737373; font-size: 16px; font-weight: 600; line-height: 38px; word-wrap: break-word">$1,280</div>
          </div>
        </v-col>
      </v-row>
    </div>
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-card-title class="px-0 pb-0">Transaction History</v-card-title>
      <v-data-table :headers="headers" :items="transactions" hide-default-footer hide-default-header>
        <template v-slot:[`item.retailer`]="{ item }">
          {{item}}
        </template>
      </v-data-table>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import QRCodeStyling from 'qr-code-styling';
import Vue from 'vue';
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import CopyButton from '@/shared/components/CopyButton.vue';
import BaseDialog from '@/shared/components/BaseDialog.vue';
import filters from '@/shared/utils/filters';

export default {
  name: 'ViewRewardsDialog',
  components: { BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  filters,
  computed: {

  },
  methods: {

  },
  data: () => ({
    transactions: [],
    headers: [
      { text: "Store Name", align: "start", sortable: true, value: "retailer"},
      { text: "Available In", align: "center", sortable: true, value: "available_in"},
      { text: "Claimed Amount", align: "center", sortable: true, value: "claimed_amount"},
      { text: "Transaction Date", align: "center", sortable: true, value: "tx_date"},
      { text: "Details", align: "center", sortable: true, value: "details"},
    ]
  }),
  mounted() {

  },
  watch: {
    isOpen(val) {
      if (val) {
        // appWallet.api.
      }
    }
  },
};
</script>
<style scoped>
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}

.card-text {
  width: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 24px;
}

.avatar-bg {
  background: linear-gradient(134deg, rgba(0, 199.26, 243, 0.25) 40%, rgba(0, 255, 209.10, 0.25) 100%);
}

.header-text {
  color: white;
  font-size: 24px;
  font-weight: 600;
  line-height: 24px;
  word-wrap: break-word;
}

.amount-section {
  font-weight: 700;
  align-self: stretch;
  height: 76px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: start;
}

.amount {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.highlight-text {
  align-self: stretch;
  background: linear-gradient(to right, #00c7f3, #00fad5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 30px;
  line-height: 38px;
  word-wrap: break-word;
}

.usd-amount {
  height: 38px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  color: #A3A3A3;
}
</style>
