<template>
  <BaseDialog :isOpen="isDialogVisible" @close="$emit('close')">
    <v-card-title class="display-1">Transaction</v-card-title>
    <v-card-subtitle class="text--secondary">{{
      new Date(transactionInfo.tx_timestamp * 1000).toLocaleString()
    }}</v-card-subtitle>
    <div class="transaction-info">
      <div>
        Received from: <span class="value-text">{{ transactionInfo.address }}</span>
      </div>
      <div>
        Transaction Fee: <span class="fee">{{ transactionInfo.fee | toAda }}</span>
      </div>
      <div>
        TransactionId: <a :href="`https://explorer.cardano.org/en/transaction?id=${transactionInfo.tx_hash}`" target="_blank">{{ transactionInfo.tx_hash }}</a>
      </div>
      <div>
        Block: <span class="value-text">{{ transactionInfo.block_height }}</span>
      </div>
    </div>
    <v-expansion-panels v-model="panels" multiple>
      <TransactionDetailsAccordion
        v-if="transactionInfo.receivedAmount"
        type="RECEIVED"
        :amount="transactionInfo.receivedAmount"
        :assets="transactionInfo.receivedAssets"
      ></TransactionDetailsAccordion>
      <TransactionDetailsAccordion
        v-if="transactionInfo.sentAmount"
        type="SENT"
        :amount="transactionInfo.sentAmount"
        :assets="transactionInfo.sentAssets"
      ></TransactionDetailsAccordion>
    </v-expansion-panels>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import TransactionDetailsAccordion from '../components/TransactionDetailsAccordion.vue';
import filters from "@/shared/utils/filters";

export default {
  name: 'transactionDetailsDialog',
  components: { BaseDialog, TransactionDetailsAccordion },
  props: {
    transactionInfo: {
      type: Object,
      default: null,
    },
  },
  filters,
  computed: {
    isDialogVisible: {
      get() {
        return !!this.transactionInfo;
      },
    },
  },
  data: () => ({
    panels: [0]
  })
};
</script>
<style scoped>
.transaction-info{
  margin-left: 20px;
  margin-bottom: 20px;

  & > div {
    font-size: 13px;
    color: #cecfd2;
  }

  .fee{
    color: rgb(255, 104, 104);
  }

  .value-text{
    color: #FFFFFF;
  }
}
</style>
