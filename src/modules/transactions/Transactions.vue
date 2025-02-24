<template>
  <div id="tsac">
    <TransactionsCard
      ref="transactionsCard"
      @row-click="handleOnTransactionsRowClick"
      style=" width: 39%;"
    />
    <v-card v-if="transactionInfo" style="overflow-y: auto; width: 60%;border:thin solid rgba(255, 255, 255, 0.12);height: fit-content; position: sticky; top: 64px; max-height: calc(100vh - 64px);">
      <TransactionDetails
        :transactionInfo="transactionInfo"
      />
    </v-card>

    <ReportDialog
      :isOpen="isReportDialogOpen"
      @close="isReportDialogOpen = false"
      :reportSite="reportSite"
    />
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';

export default defineComponent({
  name: 'Transactions',
  components: { TransactionDetails, TransactionsCard, ReportDialog },
  methods: {
    handleOnTransactionsRowClick(row) {
      this.transactionInfo = row; // Update transactionInfo with the emitted row data
    }
  },
  data: () => ({
    isReportDialogOpen: false,
    transactionInfo: null,
    reportSite: '' as string,
  }),
  created() {
    const queryParams = this.$route.query;
    if (Object.keys(queryParams).length > 0) {
      console.log(queryParams)
      this.reportSite = queryParams['website'].toString();
      this.isReportDialogOpen = true;
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
