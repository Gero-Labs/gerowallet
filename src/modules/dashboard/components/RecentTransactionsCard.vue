<template>
  <v-card
    flat
    class="fill-height d-flex flex-column glass-panel recent-tx-card"
  >
    <div class="recent-tx-header flex-grow-0">
      <span class="recent-tx-heading">{{ $t('dashboard.recentTransactions') }}</span>
      <router-link to="/transactions" class="recent-tx-view-all">
        {{ $t('dashboard.viewAll') }}
      </router-link>
    </div>

    <v-card-text class="pa-0 flex-grow-1 d-flex flex-column recent-tx-body">
      <div
        v-if="recent.length === 0"
        class="recent-tx-empty d-flex flex-column align-center justify-center flex-grow-1"
      >
        <v-icon small color="grey">mdi-clipboard-text-outline</v-icon>
        <span class="text-caption text--secondary mt-1">
          {{ $t('transactions.noTransactionsFound') }}
        </span>
      </div>

      <div v-else class="recent-tx-list flex-grow-1">
        <div
          v-for="tx in recent"
          :key="tx.id"
          class="recent-tx-row"
          @click="handleRowClick(tx)"
        >
          <div class="recent-tx-meta">
            <div class="recent-tx-status">{{ statusLabel(tx) }}</div>
            <div class="recent-tx-time">{{ formatTime(tx.tx_timestamp) }}</div>
          </div>
          <div class="recent-tx-amount" :style="{ color: getTransactionColor(tx) }">
            {{ formatAmount(tx) }}
          </div>
        </div>
      </div>
    </v-card-text>

    <BitcoinTransactionDetailsDialog
      v-if="transactionInfo && isBitcoin"
      :transactionInfo="transactionInfo"
      @close="closeDetails"
    />
    <TransactionDetailsDialog
      v-if="transactionInfo && !isBitcoin"
      :transactionInfo="transactionInfo"
      @close="closeDetails"
    />
  </v-card>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { StoredTransaction } from '@/models/transaction.types';
import { Blockchain } from '@/models/types';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import BitcoinTransactionDetailsDialog from '@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import { buildBasicStatus, getTransactionColor } from '@/modules/dashboard/utils/transactionStatus';

const { t } = useTranslation();
const { transactions, loggedWallet } = toRefs(walletStore);

const isBitcoin = computed(() => loggedWallet.value?.chain === Blockchain.BITCOIN);

const recent = computed<StoredTransaction[]>(() =>
  [...(transactions.value ?? [])]
    .sort((a, b) => b.tx_timestamp - a.tx_timestamp)
    .slice(0, 5),
);

const transactionInfo = ref<StoredTransaction | null>(null);

function handleRowClick(tx: StoredTransaction) {
  transactionInfo.value = tx;
}

function closeDetails() {
  transactionInfo.value = null;
}

function statusLabel(tx: StoredTransaction): string {
  const status = buildBasicStatus(tx, t);
  return status || t('transactions.transaction');
}

function formatTime(timestamp: number): string {
  return time.format(new Date(timestamp * 1000));
}

function formatAmount(tx: StoredTransaction): string {
  if (!loggedWallet.value) return '';
  return filters.toCurrency(
    tx.ada ?? 0,
    true,
    0,
    networks.resolveCurrencySymbol(loggedWallet.value.chain, loggedWallet.value.network),
    '',
    false,
  );
}
</script>

<style scoped lang="scss">
/* Surface comes from the shared .glass-panel material (v-card flags included),
   so all three hero cards read as one material. */
.recent-tx-card {
  overflow: hidden;
}

.recent-tx-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 6px 12px;
  line-height: 1;
}

.recent-tx-heading {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
  line-height: 1;
}

.recent-tx-view-all {
  font-size: 11px;
  color: #c4c4c4;
  text-decoration: none;
  line-height: 1;
}

.recent-tx-view-all:hover {
  color: #ffffff;
}

.recent-tx-body {
  overflow: hidden;
}

.recent-tx-empty {
  opacity: 0.7;
}

.recent-tx-list {
  display: flex;
  flex-direction: column;
  padding: 2px 6px 6px 6px;
  overflow: hidden;
}

.recent-tx-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  min-height: 30px;
}

.recent-tx-row:hover {
  background: rgba(255, 255, 255, 0.05);
}

.recent-tx-meta {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
}

.recent-tx-status {
  font-size: 11px;
  font-weight: 500;
  color: #ffffff;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recent-tx-time {
  font-size: 10px;
  color: #8a8a8a;
  line-height: 1;
}

.recent-tx-amount {
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  text-align: right;
  white-space: nowrap;
  max-width: 45%;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
