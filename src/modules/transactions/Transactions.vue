<template>
  <v-card class="transparent" flat>
    <ReportDialog :isOpen="isReportDialogOpen" @close="isReportDialogOpen = false"   :reportSite="reportSite" />
    <div id="tsac" >
        <TransactionsCard ref="transactionsCard" @row-click="handleOnTransactionsRowClick" style=" width: 39%;"></TransactionsCard>
        <TransactionDetails :transactionInfo="transactionInfo" v-if="transactionInfo" style=" width: 60%;border:thin solid rgba(255, 255, 255, 0.12);height: fit-content;"/>
    </div>

  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import ReportDialog from '@/modules/transactions/dialogs/ReportDialog.vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from './components/TransactionDetails.vue'
export default defineComponent({
  name: 'Transactions',
  components: { TransactionsCard,TransactionDetails ,ReportDialog},
  data: () => ({
    isReportDialogOpen: false,
    reportSite: '' as string | string[],
    transactionInfo: null, 
  }),
  created() {
    const queryParams = this.$route.query;
    if (Object.keys(queryParams).length > 0) {
      console.log("queryParams",queryParams)
      this.reportSite = queryParams['website'];
      this.isReportDialogOpen = true;

    }
    console.log("transaction has",this.$route.query,this.reportSite);
  },
  methods: {
    handleOnTransactionsRowClick(row) {
      this.transactionInfo = row; 
    }
  }
});
</script>
<style scoped>
#tsac{
    display: flex;
    width: 100%;
   justify-content: space-between;
}
</style>