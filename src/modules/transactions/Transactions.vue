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
            :isFullList="true"
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
import { getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';
import { walletStore } from '@/stores/walletStore';

const vmProxy = getCurrentInstance()!.proxy
const route = vmProxy.$route;

const isReportDialogOpen = ref(false);
const transactionInfo = ref<any>(null);
const reportSite = ref('');
const transactionsCard = ref<any>(null);

const handleOnTransactionsRowClick = (row: any) => {
  transactionInfo.value = row; // Update transactionInfo with the emitted row data
};

// Try to select a transaction by its ID from route query
const selectTransactionFromQuery = () => {
  const txId = route.query?.tx?.toString();
  if (!txId) return false;

  const transactions = walletStore.transactions;
  if (!transactions || transactions.length === 0) return false;

  const found = transactions.find((tx: any) => tx.id === txId);
  if (found) {
    transactionInfo.value = found;
    // Scroll the selected row into view after DOM updates
    nextTick(() => {
      setTimeout(() => {
        const el = document.querySelector('.selected-transaction');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    });
    return true;
  }
  return false;
};

// Auto-select: query param tx takes priority, then latest transaction
watch(() => walletStore.transactions, (transactions) => {
  if (transactions && transactions.length > 0 && !transactionInfo.value) {
    // Try query param first
    if (selectTransactionFromQuery()) return;

    // Fallback: select latest transaction
    transactionInfo.value = transactions.reduce((latest, current) => {
      return current.tx_timestamp > latest.tx_timestamp ? current : latest;
    });
  }
}, { immediate: true });

onMounted(() => {
  const queryParams = route.query;
  if (!queryParams || Object.keys(queryParams).length === 0) return;

  // Handle tx query param
  if (queryParams['tx']) {
    selectTransactionFromQuery();
  }

  // Handle report dialog — validate URL to prevent injection
  if (queryParams['website']) {
    const site = queryParams['website'].toString();
    try {
      const url = new URL(site);
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        reportSite.value = site;
        isReportDialogOpen.value = true;
      }
    } catch {
      // Invalid URL — ignore
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
