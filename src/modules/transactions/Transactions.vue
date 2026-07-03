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
                <TransactionsCard
                  ref="transactionsCard"
                  @row-click="handleOnTransactionsRowClick"
                  :selectedTransaction="transactionInfo"
                  style="width: 39%;"
                  :isFullList="true"
                />
                <v-card
                  v-if="transactionInfo"
                  class="liquid-glass px-3 detail-card"
                >
                  <TransactionDetails :transactionInfo="transactionInfo" />
                </v-card>
              </div>
            </v-tab-item>
            <v-tab-item>
              <div id="tsac">
                <UtxosTable
                  @row-click="handleOnUtxoRowClick"
                  :selectedUtxo="selectedUtxo"
                  style="width: 39%;"
                />
                <v-card
                  v-if="selectedUtxo"
                  class="liquid-glass px-3 detail-card"
                >
                  <UtxoDetail :utxo="selectedUtxo" />
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
import { walletStore } from '@/stores/walletStore';
import { isFeatureNew, markFeatureAsSeen } from '@/shared/composables/useFeatureNotifications';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain } from '@/models/types';

const vmProxy = getCurrentInstance()!.proxy;
const route = vmProxy.$route;

const activeTab = ref(route.query?.tab === 'utxos' ? 1 : 0);
const isReportDialogOpen = ref(false);
const transactionInfo = ref<any>(null);
const selectedUtxo = ref<any>(null);
const reportSite = ref('');
const transactionsCard = ref<any>(null);

const txCount = computed(() => walletStore.transactions?.length || 0);

const utxoCount = computed(() => {
  const utxos = walletStore.utxos;
  if (!utxos || utxos.length === 0) return 0;
  if (Array.isArray(utxos[0]) && (utxos[0] as any[]).length === 2) return utxos.length;
  return 0;
});

function markUtxosSeen() {
  markFeatureAsSeen('transactions.utxos');
}

// Cardano txs stored UTxO-only (no deserialized body) can't render certificates,
// datum, redeemers or metadata — only the UTxOs panel. When such a tx is selected,
// backfill its body on demand (fetch + deserialize CBOR in the background), then
// swap the enriched copy into the open detail view. The background also persists
// the enriched record, so the list row and future opens are fixed too.
const enrichingTxHashes = new Set<string>();

async function enrichSelectedTransaction(tx: Record<string, unknown> | null) {
  if (!tx || tx.body || tx.pending) return; // already enriched or not yet confirmed
  if (walletStore.loggedWallet?.chain !== Blockchain.CARDANO) return; // CBOR backfill is Cardano-only
  const txHash = (tx.tx_hash || tx.id) as string | undefined;
  if (!txHash || enrichingTxHashes.has(txHash)) return;

  enrichingTxHashes.add(txHash);
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.ENRICH_TRANSACTIONS,
      data: { txHashes: [txHash] },
    }) as { data?: { transactions?: Array<Record<string, unknown>> } };
    const enriched = response?.data?.transactions?.find(
      (t: Record<string, unknown>) => (t.tx_hash || t.id) === txHash
    );
    // Only swap if the same tx is still selected and we actually got a body back.
    const selectedHash = transactionInfo.value?.tx_hash || transactionInfo.value?.id;
    if (enriched?.body && selectedHash === txHash) {
      transactionInfo.value = {
        ...transactionInfo.value,
        cbor: enriched.cbor,
        body: enriched.body,
        witness: enriched.witness,
        auxiliaryData: enriched.auxiliaryData,
        isValid: enriched.isValid,
        // Backend utxo carries native-token amounts the thin (WS-synced) record may
        // lack; keep the live view consistent with the persisted DB record.
        utxo: enriched.utxo,
      };
    }
  } catch (e) {
    console.warn('[Transactions] transaction enrichment failed:', e);
  } finally {
    enrichingTxHashes.delete(txHash);
  }
}

const handleOnTransactionsRowClick = (row: any) => {
  transactionInfo.value = row;
  enrichSelectedTransaction(row);
};

const handleOnUtxoRowClick = (row: any) => {
  selectedUtxo.value = row;
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
    enrichSelectedTransaction(found);
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
    if (selectTransactionFromQuery()) return;

    transactionInfo.value = transactions.reduce((latest, current) => {
      return current.tx_timestamp > latest.tx_timestamp ? current : latest;
    });
    enrichSelectedTransaction(transactionInfo.value);
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
  max-height: calc(-163px + 100vh) !important;
  position: sticky;
  top: 0;
}
</style>
