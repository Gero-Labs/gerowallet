<template>
    <div id="tsac">
        <TransactionsCard ref="transactionsCard" @row-click="handleOnTransactionsRowClick" style=" width: 39%;"></TransactionsCard>
        <TransactionDetails :transactionInfo="transactionInfo" v-if="transactionInfo" style=" width: 60%;border:thin solid rgba(255, 255, 255, 0.12);height: fit-content;"/>
    </div>

</template>
<script>
import { defineComponent } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from './components/TransactionDetails.vue'
export default defineComponent({
    name: 'Transaction',
    components: { TransactionsCard,
      TransactionDetails,
      // TransactionDetailsDialog
     },
    data() {
    return {
      transactionInfo: null, // Initialize transactionInfo here
    };
  },
  methods: {
    handleOnTransactionsRowClick(row) {
      this.transactionInfo = row; // Update transactionInfo with the emitted row data
      // console.log("transaction",this.transactionInfo);
    }
  }
})
</script>
<style scoped>
#tsac{
    display: flex;
    width: 100%;
   justify-content: space-between;
}
</style>
