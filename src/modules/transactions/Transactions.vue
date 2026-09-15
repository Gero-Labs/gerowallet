<template>
  <v-layout>
    <v-row no-gutters>
      <v-col cols="12" class="pa-2">
        <v-card class="transparent" flat>
          <v-tabs v-model="activeTab" centered icons-and-text background-color="transparent" class="mb-4">
            <v-tab>
              {{ $t('transactions.history') }} ({{ txCount }})
              <v-icon>mdi-history</v-icon>
            </v-tab>
            <v-tab @click="markUtxosSeen()">
              {{ $t('transactions.utxos') }} ({{ utxoCount }})
              <NotificationDot :show="isFeatureNew('transactions.utxos')" color="error" overlap bordered>
                <v-icon>mdi-cube-outline</v-icon>
              </NotificationDot>
            </v-tab>
          </v-tabs>
          <v-tabs-items v-model="activeTab" class="transparent">
            <v-tab-item>
              <div id="tsac">
                <MidnightTransactionsList
                  v-if="isMidnight"
                  ref="transactionsCard"
                  @row-click="handleOnTransactionsRowClick"
                  :selectedTransaction="transactionInfo"
                  style="width: 39%;"
                />
                <TransactionsCard
                  v-else
                  ref="transactionsCard"
                  @row-click="handleOnTransactionsRowClick"
                  :selectedTransaction="transactionInfo"
                  style="width: 39%;"
                  :isFullList="true"
                />
                <v-card
                  v-if="transactionInfo"
                  :class="[isMidnight ? 'glass-panel' : 'liquid-glass', 'px-3', 'detail-card']"
                >
                  <MidnightTransactionDetails v-if="isMidnight" :transactionInfo="transactionInfo" />
                  <TransactionDetails v-else :transactionInfo="transactionInfo" />
                </v-card>
              </div>
            </v-tab-item>
            <v-tab-item>
              <div id="tsac">
                <MidnightUtxosTable
                  v-if="isMidnight"
                  @row-click="handleOnUtxoRowClick"
                  :selectedUtxo="selectedUtxo"
                  style="width: 39%;"
                />
                <UtxosTable
                  v-else
                  @row-click="handleOnUtxoRowClick"
                  :selectedUtxo="selectedUtxo"
                  style="width: 39%;"
                />
                <v-card
                  v-if="selectedUtxo"
                  :class="[isMidnight ? 'glass-panel' : 'liquid-glass', 'px-3', 'detail-card']"
                >
                  <MidnightUtxoDetail v-if="isMidnight" :utxo="selectedUtxo" />
                  <UtxoDetail v-else :utxo="selectedUtxo" />
                </v-card>
              </div>
            </v-tab-item>
          </v-tabs-items>
        </v-card>
        <ReportDialog
          :isOpen="isReportDialogOpen"
          @close="isReportDialogOpen = false"
          :reportSite="reportSite"
        />
      </v-col>
    </v-row>
  </v-layout>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue';
import TransactionsCard from '@/modules/dashboard/components/TransactionsCard.vue';
import TransactionDetails from '@/shared/components/TransactionDetails.vue';
import UtxosTable from '@/modules/transactions/components/UtxosTable.vue';
import UtxoDetail from '@/modules/transactions/components/UtxoDetail.vue';
import ReportDialog from '@/shared/dialogs/ReportDialog.vue';
import NotificationDot from '@/shared/components/NotificationDot.vue';
import MidnightTransactionsList from '@/modules/transactions/components/MidnightTransactionsList.vue';
import MidnightTransactionDetails from '@/modules/transactions/components/MidnightTransactionDetails.vue';
import MidnightUtxosTable from '@/modules/transactions/components/MidnightUtxosTable.vue';
import MidnightUtxoDetail from '@/modules/transactions/components/MidnightUtxoDetail.vue';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Blockchain } from '@/models/types';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

const vmProxy = getCurrentInstance()!.proxy;
const route = vmProxy.$route;

const isMidnight = computed(() => walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT);

const activeTab = ref(route.query?.tab === 'utxos' ? 1 : 0);
const isReportDialogOpen = ref(false);
// Row shape is Cardano's StoredTransaction or Midnight's MidnightTransaction
// depending on isMidnight — neither leaf component exports a shared type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const transactionInfo = ref<any>(null);
// Row shape is Cardano UtxosTable's local UtxoRow or Midnight's MidnightUtxoRow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const selectedUtxo = ref<any>(null);
const reportSite = ref('');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const transactionsCard = ref<any>(null);

// Midnight's history/UTxO set lives in its own store (midnightStore), never
// walletStore — see midnightStore.ts's file header. Cardano's counts below
// are unchanged.
const txCount = computed(() =>
  isMidnight.value ? midnightStore.transactions.length : (walletStore.transactions?.length || 0)
);

const utxoCount = computed(() => {
  if (isMidnight.value) return midnightStore.utxos.length;
  const utxos = walletStore.utxos;
  if (!utxos || utxos.length === 0) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (Array.isArray(utxos[0]) && (utxos[0] as any[]).length === 2) return utxos.length;
  return 0;
});

function markUtxosSeen() {
  markFeatureAsSeen('transactions.utxos');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleOnTransactionsRowClick = (row: any) => {
  transactionInfo.value = row;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleOnUtxoRowClick = (row: any) => {
  selectedUtxo.value = row;
};

// Try to select a transaction by its ID from route query. Cardano-only:
// walletStore.transactions/tx_timestamp are Cardano-shaped and don't apply to
// a Midnight wallet (which has its own history in midnightStore, keyed by
// hash+token, with no equivalent auto-select today).
const selectTransactionFromQuery = () => {
  if (isMidnight.value) return false;
  const txId = route.query?.tx?.toString();
  if (!txId) return false;

  const transactions = walletStore.transactions;
  if (!transactions || transactions.length === 0) return false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const found = transactions.find((tx: any) => tx.id === txId);
  if (found) {
    transactionInfo.value = found;
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

// Auto-select: query param tx takes priority, then latest transaction.
// Cardano-only — see selectTransactionFromQuery's note.
watch(() => walletStore.transactions, (transactions) => {
  if (isMidnight.value) return;
  if (transactions && transactions.length > 0 && !transactionInfo.value) {
    if (selectTransactionFromQuery()) return;

    transactionInfo.value = transactions.reduce((latest, current) => {
      return current.tx_timestamp > latest.tx_timestamp ? current : latest;
    });
  }
}, { immediate: true });

onMounted(() => {
  const queryParams = route.query;
  if (!queryParams || Object.keys(queryParams).length === 0) return;

  if (queryParams['tx']) {
    selectTransactionFromQuery();
  }

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
#tsac {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: flex-start;
}
</style>

<style>
.detail-card {
  width: 60%;
  /* Flex items default to min-width:auto, so a wide child (e.g. an expanded
     redeemer's data) can grow the card past its 60% and shove the layout on
     expand. min-width:0 lets it hold width and clip via overflow-x. */
  min-width: 0;
  max-height: calc(-163px + 100vh) !important;
  overflow-y: auto;
  overflow-x: hidden;
  position: sticky;
  top: 0;
}
</style>
