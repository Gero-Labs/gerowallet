<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <div id="tsac">
          <TransactionsCard
            ref="transactionsCard"
            @row-click="handleOnTransactionsRowClick"
            :selectedTransaction="transactionInfo"
            style=" width: 39%;"
          />
          <v-card
            v-if="transactionInfo"
            class="liquid-glass px-3"
            style="overflow-y: auto; width: 60%;height: fit-content; position: sticky;"
          >
            <TransactionDetails :transactionInfo="transactionInfo" />
          </v-card>
          <ReportDialog
            :isOpen="isReportDialogOpen"
            @close="isReportDialogOpen = false"
            :reportSite="reportSite"
          />
        </div>
      </v-col>
    </v-row>
  </v-layout>
</template>
<script setup lang="ts">
import { ref, onMounted, getCurrentInstance, watch } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';
import { walletStore } from '@/stores/walletStore';

const vmProxy = getCurrentInstance()!.proxy as any
const route = vmProxy.$route;

const isReportDialogOpen = ref(false);
const transactionInfo = ref<any>(null);
const reportSite = ref('');

const handleOnTransactionsRowClick = (row: any) => {
  transactionInfo.value = row; // Update transactionInfo with the emitted row data
};

// Auto-select latest transaction (by tx_timestamp) when transactions are loaded
watch(() => walletStore.transactions, (transactions) => {
  if (transactions && transactions.length > 0 && !transactionInfo.value) {
    const latestTransaction = transactions.reduce((latest, current) => {
      return current.tx_timestamp > latest.tx_timestamp ? current : latest;
    });
    transactionInfo.value = latestTransaction;
  }
}, { immediate: true });

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
