<template>
  <div id="tsac">
    <TransactionsCard
      ref="transactionsCard"
      @row-click="handleOnTransactionsRowClick"
      style=" width: 39%;"
    />
    <v-card v-if="transactionInfo" style="overflow-y: auto; width: 60%;border:thin solid rgba(255, 255, 255, 0.12);height: fit-content; position: sticky; top: 64px; max-height: calc(100vh - 64px);">
      <TransactionDetails :transactionInfo="transactionInfo" />
    </v-card>
    <ReportDialog
      :isOpen="isReportDialogOpen"
      @close="isReportDialogOpen = false"
      :reportSite="reportSite"
    />
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted, getCurrentInstance } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';

const vmProxy = getCurrentInstance()!.proxy as any
const route = vmProxy.$route;

const isReportDialogOpen = ref(false);
const transactionInfo = ref<any>(null);
const reportSite = ref('');

const handleOnTransactionsRowClick = (row: any) => {
  transactionInfo.value = row; // Update transactionInfo with the emitted row data
};

onMounted(() => {
  const queryParams = route.query;
  if (Object.keys(queryParams).length > 0) {
    console.log(queryParams);
    reportSite.value = queryParams['website']?.toString() || '';
    isReportDialogOpen.value = true;
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
