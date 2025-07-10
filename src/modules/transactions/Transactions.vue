<template>
  <div id="tsac">
    <TransactionsCard
      ref="transactionsCard"
      @row-click="handleOnTransactionsRowClick"
      style="width: 39%;"
    />
    <v-card 
      v-if="transactionInfo" 
      style="overflow-y: auto; width: 60%; border: thin solid rgba(255, 255, 255, 0.12); height: fit-content; position: sticky; top: 64px; max-height: calc(100vh - 64px);"
    >
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

<script setup lang="ts">
import { ref, onMounted, getCurrentInstance } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';
import { TransactionInfo } from '@/shared/components/TransactionDetails.vue';

// Reactive state
const isReportDialogOpen = ref<boolean>(false);
const transactionInfo = ref<TransactionInfo | null>(null);
const reportSite = ref<string>('');
// Get Vue instance for router access
const vm = getCurrentInstance()!;

// Methods
const handleOnTransactionsRowClick = (row: TransactionInfo): void => {
  transactionInfo.value = row; // Update transactionInfo with the emitted row data
};

// Lifecycle
onMounted(() => {
  const queryParams = vm.proxy.$route.query;
  if (Object.keys(queryParams).length > 0) {
    console.log(queryParams);
    reportSite.value = queryParams['website']?.toString() || '';
    isReportDialogOpen.value = true;
  }
});
</script>

<style scoped>
#tsac {
  display: flex;
  width: 100%;
  justify-content: space-between;
}
</style>
