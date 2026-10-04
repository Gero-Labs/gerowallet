<template>
  <div class="tx-page">
    <div class="tx-tabs" role="tablist" :aria-label="$t('transactions.title')">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 0 ? 'true' : 'false'"
        :class="['tx-tab', { 'tx-tab--active': activeTab === 0 }]"
        @click="activeTab = 0"
      >
        <v-icon small>mdi-history</v-icon>
        {{ $t('transactions.history') }}
        <span class="tx-tab__count g-num">{{ txCount }}</span>
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 1 ? 'true' : 'false'"
        :class="['tx-tab', { 'tx-tab--active': activeTab === 1 }]"
        @click="selectUtxosTab()"
      >
        <NotificationDot :show="isFeatureNew('transactions.utxos')" color="error" overlap bordered>
          <v-icon small>mdi-cube-outline</v-icon>
        </NotificationDot>
        {{ $t('transactions.utxos') }}
        <span class="tx-tab__count g-num">{{ utxoCount }}</span>
      </button>
    </div>

    <!-- History. v-show keeps the list (scroll position, search, filters) alive across tab switches. -->
    <div v-show="activeTab === 0" class="tx-split" role="tabpanel">
      <MidnightTransactionsList
        v-if="isMidnight"
        ref="transactionsCard"
        class="tx-split__list"
        @row-click="handleOnTransactionsRowClick"
        :selectedTransaction="transactionInfo"
      />
      <TransactionsCard
        v-else
        ref="transactionsCard"
        class="tx-split__list"
        @row-click="handleOnTransactionsRowClick"
        :selectedTransaction="transactionInfo"
        :isFullList="true"
      />
      <section
        v-if="transactionInfo"
        class="tx-split__detail glass-panel"
        :aria-label="$t('transactions.transactionDetails')"
      >
        <MidnightTransactionDetails v-if="isMidnight" :transactionInfo="transactionInfo" />
        <TransactionDetails v-else :transactionInfo="transactionInfo" />
      </section>
    </div>

    <!-- UTxOs, mounted on first visit -->
    <div v-if="utxosVisited" v-show="activeTab === 1" class="tx-split" role="tabpanel">
      <MidnightUtxosTable
        v-if="isMidnight"
        class="tx-split__list"
        @row-click="handleOnUtxoRowClick"
        :selectedUtxo="selectedUtxo"
      />
      <UtxosTable
        v-else
        class="tx-split__list"
        @row-click="handleOnUtxoRowClick"
        :selectedUtxo="selectedUtxo"
      />
      <section v-if="selectedUtxo" class="tx-split__detail glass-panel">
        <MidnightUtxoDetail v-if="isMidnight" :utxo="selectedUtxo" />
        <UtxoDetail v-else :utxo="selectedUtxo" />
      </section>
    </div>

    <ReportDialog
      :isOpen="isReportDialogOpen"
      @close="isReportDialogOpen = false"
      :reportSite="reportSite"
    />
  </div>
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
import { liveMidnightRow } from '@/modules/transactions/components/midnightTxSelection';
import { Blockchain } from '@/models/types';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';

const vmProxy = getCurrentInstance()!.proxy;
const route = vmProxy.$route;

const isMidnight = computed(() => walletStore.loggedWallet?.chain === Blockchain.MIDNIGHT);

const activeTab = ref(route.query?.tab === 'utxos' ? 1 : 0);
const utxosVisited = ref(activeTab.value === 1);
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

function selectUtxosTab() {
  activeTab.value = 1;
  utxosVisited.value = true;
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

// Try to select a transaction by its ID from route query. A Midnight wallet's
// history lives in midnightStore, one row per hash+token: the first row for
// the hash stands for the transaction there.
const selectTransactionFromQuery = () => {
  // The live route, not the one captured at setup: a notification opened while this page is
  // already showing navigates to the same path with a different `tx`.
  const txId = vmProxy.$route.query?.tx?.toString();
  if (!txId) return false;

  const found = isMidnight.value
    ? midnightStore.transactions.find((tx) => tx.hash === txId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : walletStore.transactions?.find((tx: any) => tx.id === txId);
  if (found) {
    transactionInfo.value = found;
    // `?tx=` asks to SEE this transaction. The page is kept alive, so it may
    // still be on UTxOs from an earlier visit, where the selection is hidden.
    activeTab.value = 0;
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
// Cardano-only; Midnight's history is followed by the watcher further down.
watch(() => walletStore.transactions, (transactions) => {
  if (isMidnight.value) return;
  if (transactions && transactions.length > 0 && !transactionInfo.value) {
    if (selectTransactionFromQuery()) return;

    transactionInfo.value = transactions.reduce((latest, current) => {
      return current.tx_timestamp > latest.tx_timestamp ? current : latest;
    });
  }
}, { immediate: true });

// A new `tx` in the query while the page stays mounted (a push notification, the bell, global
// search) selects that transaction even though one is already open.
watch(() => vmProxy.$route.query?.tx, (txId, previous) => {
  if (txId && txId !== previous) selectTransactionFromQuery();
});

// Same for `?tab=utxos`: the page sits in ContentLayout's keep-alive, so the
// setup-time read above only covers its first visit.
watch(() => vmProxy.$route.query?.tab, (tab) => {
  if (tab === 'utxos') selectUtxosTab();
});

// Midnight rows are replaced, not mutated (see liveMidnightRow): a pane holding
// the clicked object kept rendering the dead pending row — "Pending", and a
// UTxO fetch that failed while the tx was still unindexed — after the list had
// moved on. Follow the row by key on every list change. Until something is
// selected, a `?tx=` that arrived before the history did gets another try.
watch(() => midnightStore.transactions, (transactions) => {
  if (!isMidnight.value) return;
  if (!transactionInfo.value) {
    selectTransactionFromQuery();
    return;
  }
  const live = liveMidnightRow(transactionInfo.value, transactions);
  if (live !== transactionInfo.value) transactionInfo.value = live;
});

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
/* A definite height, so both panes can scroll on their own: ContentLayout is a
   natural-flow scroll page, where height: 100% would resolve to auto. */
.tx-page {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  height: calc(100vh - 80px);
  padding: 0 var(--g-s-2) var(--g-s-2);
}

/* ─── Segmented History / UTxOs control ──────────────────────── */
.tx-tabs {
  flex: 0 0 auto;
  align-self: flex-start;
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
}

.tx-tab {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 32px;
  padding: 0 var(--g-s-4);
  border: 0;
  border-radius: var(--g-r-pill);
  background: transparent;
  color: var(--g-text-2);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.tx-tab:hover {
  color: var(--g-text-1);
}

.tx-tab--active {
  background: var(--g-hairline-2);
  color: var(--g-text-1);
}

.tx-tab .v-icon {
  color: inherit;
}

.tx-tab__count {
  color: var(--g-text-3);
  font-size: 12px;
  font-weight: 500;
}

/* ─── List / detail split ────────────────────────────────────── */
.tx-split {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(360px, 5fr) minmax(0, 7fr);
  gap: var(--g-s-4);
}

.tx-split__list {
  min-width: 0;
  min-height: 0;
}

.tx-split__detail {
  min-width: 0;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: var(--g-s-5);
  scrollbar-width: thin;
  scrollbar-color: var(--g-hairline-3) transparent;
}

/* Narrow windows: one column, list first, each pane with its own scroll. */
@media (max-width: 960px) {
  .tx-page {
    height: auto;
  }

  .tx-split {
    grid-template-columns: minmax(0, 1fr);
  }

  .tx-split__list {
    height: 70vh;
  }
}
</style>
