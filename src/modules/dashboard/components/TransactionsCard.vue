<template>
  <v-card outlined class="fill-height liquid-glass" :loading="loadingTxs">
    <v-card-title class="pb-2">
      Transactions
      <v-spacer />
      <!-- Search box -->
      <v-text-field
        v-model="search"
        dense
        flat
        solo
        hide-details
        placeholder="Search"
        prepend-inner-icon="mdi-magnify"
        clearable
        style="max-width: 200px"
        class="top-level-search"
      ></v-text-field>
    </v-card-title>
    <v-card-text class="pa-0 text-center">
      <div :class="{ 'table-container': props.isFullList }">
        <v-data-table
          :header-props="{ 'sort-icon': 'mdi-menu-up' }"
          :items="displayedTransactions"
          :headers="activityHeaders"
          class="transparent transactions-table"
          :sort-by.sync="sortBy"
          :sort-desc.sync="sortDesc"
          :items-per-page="-1"
          hide-default-footer
          dense
          @click:row="handleOnTransactionsRowClick"
          :item-class="getRowClass"
        >
          <template v-slot:[`item.tx_timestamp`]="{ item }">
            <v-list-item two-line class="px-0 py-1" style="height: 55px">
              <v-list-item-content class="px-0 py-1">
                <v-list-item-title class="activity-title">
                  <span class="activity-text">{{ getTransactionStatus(item) }}</span>
                </v-list-item-title>
                <v-list-item-subtitle class="activity-date">
                  <v-tooltip top>
                    <template v-slot:activator="{ on, attrs }">
                      <span v-bind="attrs" v-on="on">
                        {{ time.format(new Date(item.tx_timestamp * 1000)) }}
                      </span>
                    </template>
                    <span>
                      {{ new Date(item.tx_timestamp * 1000).toLocaleString() }}<br />
                      Epoch: {{ item.epoch_no }}
                    </span>
                  </v-tooltip>
                </v-list-item-subtitle>
                <v-list-item-subtitle>
                  <v-chip
                    v-if="isStakeRegistration(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="red"
                    style="margin-right: 4px !important"
                    >Stake Registration</v-chip
                  >
                  <v-chip
                    v-if="isWithdrawal(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="blue"
                    style="margin-right: 4px !important"
                    >Withdrawal</v-chip
                  >
                  <v-chip
                    outlined
                    class="px-1"
                    x-small
                    color="#FEC84B"
                    style="margin-left: 1px; margin-bottom: 1px"
                    v-if="item.pending"
                    >Pending</v-chip
                  >
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
          </template>
          <template v-slot:[`item.assets`]="{ item }">
            <StackedTokens
              :tokens="item.assets"
              :style="item.status === 'Pending' ? { opacity: '0.5' } : {}"
              :token-size="30"
            ></StackedTokens>
          </template>
          <template v-slot:[`item.amount`]="{ item }">
            <div v-if="loggedWallet" style="display: flex; flex-direction: column; align-items: center">
              <div
                :style="{
                  color: getColor(item),
                  fontSize: '14px',
                  paddingBottom: '4px',
                  textWrap: 'nowrap',
                }"
              >
                {{
                  filters.toCurrency(
                    item.ada,
                    true,
                    0,
                    networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network),
                    '',
                    false
                  )
                }}
              </div>
              <div style="font-size: 12px; color: #c4c4c4">
                {{ filters.toCurrency(item.ada * adaPrice, true, 0, '$', '', false, 6) }}
              </div>
            </div>
          </template>
          <template v-slot:body.append>
            <!-- Loading indicator for infinite scroll -->
            <tr v-if="props.isFullList && isLoadingMore" class="no-hover">
              <td :colspan="activityHeaders.length" class="text-center pa-4">
                <v-progress-circular indeterminate color="primary" size="24"></v-progress-circular>
                <span class="ml-2">Loading more transactions...</span>
              </td>
            </tr>
            <!-- End of list indicator for infinite scroll -->
            <tr v-else-if="props.isFullList && hasReachedEnd && !search" class="no-hover">
              <td :colspan="activityHeaders.length" class="text-center pa-4">
                <span class="text-caption text--secondary">
                  {{ displayedTransactions.length > 0 ? 'No more transactions to load' : 'No transactions found' }}
                </span>
              </td>
            </tr>
            <!-- Intersection observer target for infinite scroll -->
            <tr v-if="props.isFullList && !hasReachedEnd && !isLoadingMore" class="no-hover">
              <td :colspan="activityHeaders.length" class="pa-0 ma-0">
                <div ref="intersectionTarget" style="height: 1px"></div>
              </td>
            </tr>
            <!-- Pagination for non-full list mode -->
            <tr v-if="!props.isFullList && transactions.length > itemsPerPage" class="no-hover">
              <td :colspan="activityHeaders.length" class="text-center pa-0 ma-0">
                <v-pagination
                  v-model="currentPage"
                  :length="Math.ceil(transactions.length / itemsPerPage)"
                  :total-visible="7"
                  circle
                  class="compact-pagination ma-0"
                  @input="handlePageChange"
                ></v-pagination>
              </td>
            </tr>
          </template>
        </v-data-table>
      </div>
    </v-card-text>
    <TransactionDetailsDialog
      v-if="transactionInfo && state === '/' && !selectedTransaction"
      :transactionInfo="transactionInfo"
      @close="handleTransactionModalClose"
    ></TransactionDetailsDialog>
  </v-card>
</template>
<script setup lang="ts">
import { computed, ref, toRefs, getCurrentInstance, watch, onMounted, onUnmounted, nextTick } from 'vue';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { Cardano } from '@cardano-sdk/core';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import stakingStoreActions from '@/stores/stakingStore';

const props = defineProps({
  selectedTransaction: {
    type: Object,
    default: null,
  },
  isFullList: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['row-click']);

const { transactions: txs, loggedWallet } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { assets } = toRefs(networkStore);
const { loadingTxs } = toRefs(loadingState);

// Use Kraken WebSocket price for ADA, fallback to network store price
const adaPrice = computed(() => priceStore.adaUsd?.lastPrice || price.value?.lastPrice || 0);

const activityHeaders = ref([
  { text: 'Activity', align: 'start overflow-x', sortable: true, value: 'tx_timestamp' },
  { text: 'Amount', align: 'center text-nowrap', sortable: false, value: 'amount' },
  { text: '', align: 'center no-padding', sortable: false, value: 'assets', width: 110 },
]);

const transactionInfo = ref<any>(null);
const sortBy = ref<string>('tx_timestamp');
const sortDesc = ref<boolean>(true);
const search = ref<string>('');

// Infinite scroll variables
const displayedTransactions = ref<any[]>([]);
const currentIndex = ref<number>(0);
const isLoadingMore = ref<boolean>(false);
const hasReachedEnd = ref<boolean>(false);
const intersectionTarget = ref<HTMLElement | null>(null);
const intersectionObserver = ref<IntersectionObserver | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);

// Pagination variables (for non-full list mode)
const currentPage = ref<number>(1);
const itemsPerPage = computed(() => {
  return state.value === '/transactions' ? 10 : 5;
});

// Items per batch for lazy loading
const itemsPerBatch = computed(() => {
  if (!props.isFullList) {
    return itemsPerPage.value;
  }
  return state.value === '/transactions' ? 20 : 10;
});

const vmProxy = getCurrentInstance()!.proxy as any;
const state = computed(() => vmProxy.$route.path);

const transactions = computed(() => {
  const filtered = txs.value.filter((tx: any) => {
    if (search.value) {
      return (
        tx.id.toLowerCase().includes(search.value.toLowerCase()) ||
        tx.assets.some((asset: any) => {
          const assetInfo = assets.value[asset.unit] as any;
          return (
            assetInfo?.metadata?.name?.toLowerCase().includes(search.value.toLowerCase()) ||
            assetInfo?.metadata?.ticker?.toLowerCase().includes(search.value.toLowerCase())
          );
        })
      );
    }
    return tx;
  });

  // Sort by timestamp descending (most recent first)
  return filtered.sort((a, b) => b.tx_timestamp - a.tx_timestamp);
});

// Store for transaction statuses with loaded pool data
const transactionStatuses = ref<Record<string, string>>({});

// Preload statuses for displayed transactions
const preloadTransactionStatuses = async (transactions: any[]): Promise<void> => {
  const promises = transactions.map(async (item) => {
    const txId = item.id;

    // Skip if already loaded
    if (transactionStatuses.value[txId]) {
      return;
    }

    // Load status with pool data
    const statuses = [];

    if (item.body?.certificates?.length > 0) {
      for (const certificate of item.body.certificates) {
        const status = await processCertificate(certificate, true);
        if (status) statuses.push(status);
      }
    }

    addFundTransferStatus(item, statuses);

    const finalStatus = statuses.join(', ');
    transactionStatuses.value[txId] = finalStatus;
  });

  await Promise.all(promises);
};

// Get transaction status (reactive)
const getTransactionStatus = (item: any): string => {
  const txId = item.id;

  // Return cached status or basic status as fallback
  return transactionStatuses.value[txId] || buildBasicStatus(item);
};

// Certificate type to status mapping
const getCertificateBaseStatus = (certificateType: string): string => {
  switch (certificateType) {
    case Cardano.CertificateType.StakeRegistrationDelegation:
    case Cardano.CertificateType.StakeDelegation:
      return 'Delegating to Pool';
    case Cardano.CertificateType.StakeDeregistration:
      return 'Stake Deregistration';
    case Cardano.CertificateType.RegisterDelegateRepresentative:
      return 'DRep Registration';
    case Cardano.CertificateType.VoteDelegation:
      return 'Vote Delegation';
    case Cardano.CertificateType.UnregisterDelegateRepresentative:
      return 'DRep Deregistration';
    default:
      return '';
  }
};

// Process single certificate and return status
const processCertificate = async (certificate: Cardano.Certificate, loadPoolData = false): Promise<string> => {
  const baseStatus = getCertificateBaseStatus(certificate.__typename);

  // For delegation certificates, try to get enhanced status with pool ticker
  if ((certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
       certificate.__typename === Cardano.CertificateType.StakeDelegation) && loadPoolData) {
    const pool = await getPoolByIdFromApi(certificate.poolId);
    if (pool && pool.ticker) {
      return 'Delegating to ' + pool.ticker;
    }
  }

  return baseStatus;
};

// Add fund transfer status if applicable
const addFundTransferStatus = (item: any, statuses: string[]): void => {
  if (item.receivedAmount - item.sentAmount > 0) {
    if (!item.body?.certificates) {
      statuses.push('Received Funds');
    }
  } else {
    if (!item.body?.certificates) {
      statuses.push('Sent Funds');
    }
  }
};

// Build basic transaction status without pool API data
const buildBasicStatus = (item: any): string => {
  const statuses = [];

  if (item.body?.certificates?.length > 0) {
    item.body.certificates.forEach((certificate: Cardano.Certificate) => {
      const status = getCertificateBaseStatus(certificate.__typename);
      if (status) statuses.push(status);
    });
  }

  addFundTransferStatus(item, statuses);
  return statuses.join(', ');
};

const getPoolByIdFromApi = async (poolId: string) => {
  if (!poolId) return null;

  try {
    await stakingStoreActions.loadPoolById(loggedWallet.value, poolId);
    return stakingStoreActions.state.currentPool;
  } catch (error) {
    console.error('Error loading pool by ID:', error);
    return null;
  }
};

// Load more transactions
const loadMoreTransactions = async () => {
  if (isLoadingMore.value || hasReachedEnd.value) return;

  isLoadingMore.value = true;

  if (props.isFullList) {
    // Simulate loading delay for better UX
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  let newTransactions = [];

  if (props.isFullList) {
    // Infinite scroll mode
    const endIndex = currentIndex.value + itemsPerBatch.value;
    newTransactions = transactions.value.slice(currentIndex.value, endIndex);

    displayedTransactions.value.push(...newTransactions);
    currentIndex.value = endIndex;

    // Check if we've reached the end
    if (endIndex >= transactions.value.length) {
      hasReachedEnd.value = true;
    }
  } else {
    // Pagination mode
    const start = (currentPage.value - 1) * itemsPerPage.value;
    const end = start + itemsPerPage.value;
    newTransactions = transactions.value.slice(start, end);
    displayedTransactions.value = newTransactions;

    // Check if we've reached the end
    if (end >= transactions.value.length) {
      hasReachedEnd.value = true;
    }
  }

  // Preload statuses for new transactions and wait for completion
  if (newTransactions.length > 0) {
    await preloadTransactionStatuses(newTransactions);
  }

  isLoadingMore.value = false;
};

// Reset infinite scroll when search changes
const resetInfiniteScroll = async () => {
  displayedTransactions.value = [];
  currentIndex.value = 0;
  hasReachedEnd.value = false;
  currentPage.value = 1;

  // Clear cached transaction statuses
  transactionStatuses.value = {};

  if (props.isFullList) {
    await loadMoreTransactions();
  } else {
    await loadMoreTransactions();
  }
};

// Watch for search term changes to reset infinite scroll
watch(
  () => search.value,
  async () => {
    await resetInfiniteScroll();
  }
);

// Watch for transactions changes to reset infinite scroll
watch(
  () => transactions.value,
  async () => {
    await resetInfiniteScroll();

    // Recreate intersection observer after reset
    if (props.isFullList) {
      if (intersectionObserver.value) {
        intersectionObserver.value.disconnect();
      }
      await nextTick();
      await new Promise(resolve => setTimeout(resolve, 100));
      setupIntersectionObserver();
    }
  },
  { deep: true }
);

// Setup intersection observer for infinite scroll
const setupIntersectionObserver = () => {
  if (!intersectionTarget.value || !props.isFullList) {
    return;
  }

  // Disconnect existing observer
  if (intersectionObserver.value) {
    intersectionObserver.value.disconnect();
  }

  // Find the scrollable container
  const scrollContainer = intersectionTarget.value.closest('.table-container');

  intersectionObserver.value = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isLoadingMore.value && !hasReachedEnd.value) {
          loadMoreTransactions();
        }
      });
    },
    {
      root: scrollContainer, // Use the scrollable container as root
      rootMargin: '100px', // Start loading when 100px away from the target
      threshold: [0, 0.1, 1.0], // Multiple thresholds for better detection
    }
  );

  intersectionObserver.value.observe(intersectionTarget.value);
};

// Fallback scroll handler
const handleScroll = () => {
  if (!scrollContainer.value || !props.isFullList || isLoadingMore.value || hasReachedEnd.value) return;

  const { scrollTop, scrollHeight, clientHeight } = scrollContainer.value;
  const scrolledToBottom = scrollTop + clientHeight >= scrollHeight - 100; // 100px threshold

  if (scrolledToBottom) {
    loadMoreTransactions();
  }
};

// Setup scroll fallback
const setupScrollFallback = () => {
  if (!props.isFullList) return;

  const container = document.querySelector('.table-container') as HTMLElement;
  if (container) {
    scrollContainer.value = container;
    container.addEventListener('scroll', handleScroll, { passive: true });
  }
};

const handleOnTransactionsRowClick = row => {
  transactionInfo.value = row;
  emit('row-click', row);
};

const handleTransactionModalClose = () => {
  transactionInfo.value = null;
};

const isWithdrawal = item => {
  return (
    item.body?.withdrawals?.length > 0 &&
    loggedWallet.value?.stakeAddress &&
    item.body.withdrawals.some(withdrawal => withdrawal.stakeAddress === loggedWallet.value.stakeAddress)
  );
};

const isStakeRegistration = item => {
  return (
    item.body?.certificates?.length > 0 &&
    item.body.certificates.some(
      certificate =>
        certificate.__typename === Cardano.CertificateType.StakeRegistration ||
        certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation
    )
  );
};

const getColor = item => {
  if (item.status === 'Pending') {
    return '#FEC84B';
  } else if (getTransactionStatus(item).includes('Received') || item.ada > 0) {
    return '#47cd89';
  } else if (getTransactionStatus(item).includes('Sent') || item.ada < 0) {
    return '#F97066';
  }
  return '';
};

const getRowClass = item => {
  if (props.selectedTransaction && props.selectedTransaction['id'] === item['id']) {
    return 'selected-transaction';
  }
  return '';
};

// Handle page change for pagination
const handlePageChange = async (page: number) => {
  currentPage.value = page;
  hasReachedEnd.value = false;
  await loadMoreTransactions();
};

// Lifecycle hooks
onMounted(async () => {
  await nextTick();
  await resetInfiniteScroll();

  if (props.isFullList) {
    // Wait for DOM to fully render before setting up observers
    await new Promise(resolve => setTimeout(resolve, 100));
    setupIntersectionObserver();
    setupScrollFallback();
  }
});

onUnmounted(() => {
  if (intersectionObserver.value) {
    intersectionObserver.value.disconnect();
  }
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', handleScroll);
  }
});
</script>
<style scoped>
.text-nowrap {
  text-wrap: nowrap;
}
.no-padding {
  padding: 0 !important;
}
.selected-transaction {
  background-color: rgba(33, 150, 243, 0.1) !important;
  border-left: 3px solid #2196f3 !important;
}
.selected-transaction:hover {
  background-color: rgba(33, 150, 243, 0.15) !important;
}

.transactions-table tbody tr {
  cursor: pointer;
}

.transactions-table tbody tr:hover:not(.selected-transaction) {
  background-color: rgba(255, 255, 255, 0.05) !important;
}

.transactions-table tbody tr {
  height: 50px !important;
  max-height: 50px !important;
  min-height: 50px !important;
}

.transactions-table tbody tr td {
  height: 50px !important;
  padding-top: 0px !important;
  padding-bottom: 0px !important;
  vertical-align: middle !important;
  text-align: center !important;
}

.transactions-table tbody tr td .v-list-item {
  min-height: auto !important;
  padding: 0 !important;
}

.transactions-table tbody tr td .v-list-item__content {
  text-align: center !important;
}

/* Left-align the Activity column content */
.transactions-table tbody tr td:first-child .v-list-item__content {
  text-align: left !important;
}

.transactions-table .v-avatar {
  height: 26px !important;
  width: 26px !important;
  min-width: 26px !important;
}

.transactions-table .v-avatar img {
  height: 26px !important;
  width: 26px !important;
}

.activity-title {
  font-size: 12px !important;
  line-height: 1.2 !important;
  min-height: 14px !important;
  overflow: hidden !important;
  display: flex !important;
  align-items: center !important;
  white-space: nowrap !important;
}

.activity-text {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  display: inline-block !important;
}

.activity-date {
  font-size: 10px !important;
  line-height: 1.1 !important;
  min-height: 11px !important;
  max-height: 11px !important;
  overflow: hidden !important;
  white-space: nowrap !important;
  text-overflow: ellipsis !important;
}

/* Infinite scroll styling */
.transactions-table .no-hover:hover {
  background-color: transparent !important;
}

.transactions-table .no-hover td {
  padding: 0 !important;
  margin: 0 !important;
  vertical-align: middle !important;
}

/* Loading indicator styling */
.transactions-table .v-progress-circular {
  margin-right: 8px;
}

.transactions-table .text--secondary {
  color: rgba(255, 255, 255, 0.6) !important;
}

/* Table container styling */
.table-container {
  max-height: calc(100vh - 200px);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
}

/* Custom scrollbar styling for webkit browsers */
.table-container::-webkit-scrollbar {
  width: 6px;
}

.table-container::-webkit-scrollbar-track {
  background: transparent;
}

.table-container::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.3);
  border-radius: 3px;
}

.table-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.5);
}

/* Ensure table takes full width within container */
.table-container .v-data-table {
  width: 100%;
}

/* Intersection observer target styling */
.transactions-table .intersection-target {
  height: 1px;
  width: 100%;
}

/* Compact pagination styling */
.transactions-table .compact-pagination .v-pagination__item {
  width: auto !important;
  height: 24px !important;
  min-width: 24px !important;
  max-height: 24px !important;
  font-size: 12px !important;
  margin: 0 4px !important;
}

.transactions-table .compact-pagination .v-pagination__item .v-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 24px !important;
  height: 24px !important;
  width: auto !important;
  min-width: 24px !important;
  max-height: 24px !important;
  padding: 0 4px !important;
  font-size: 12px !important;
  white-space: nowrap !important;
}

.transactions-table .compact-pagination .v-pagination__navigation {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  max-width: 24px !important;
  max-height: 24px !important;
  margin: 0 8px !important;
}

.transactions-table .compact-pagination .v-pagination__navigation .v-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 24px !important;
  height: 24px !important;
  width: 24px !important;
  min-width: 24px !important;
  max-width: 24px !important;
  max-height: 24px !important;
  padding: 0 !important;
}

.transactions-table .compact-pagination .v-pagination__navigation .v-icon {
  font-size: 16px !important;
}

/* Additional fallback with deep selectors */
.compact-pagination >>> .v-pagination__item {
  width: auto !important;
  height: 24px !important;
  min-width: 24px !important;
  font-size: 12px !important;
  margin: 0 4px !important;
}

.compact-pagination >>> .v-pagination__item .v-btn {
  width: auto !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 0 4px !important;
  font-size: 12px !important;
  white-space: nowrap !important;
}

.compact-pagination >>> .v-pagination__navigation {
  width: 24px !important;
  height: 24px !important;
  margin: 0 8px !important;
}

.compact-pagination >>> .v-pagination__navigation .v-btn {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 0 !important;
}

.compact-pagination.ma-0 {
  margin: 0 !important;
}

.top-level-search.v-text-field {
  background: transparent !important;
}

.top-level-search >>> .v-input__slot {
  background: transparent !important;
  box-shadow: none !important;
}

.top-level-search >>> .v-input__control {
  background: transparent !important;
}

.top-level-search >>> .v-text-field__slot {
  background: transparent !important;
}

.top-level-search >>> .v-input__slot:before {
  border: none !important;
}

.top-level-search >>> .v-input__slot:after {
  border: none !important;
}

.top-level-search.v-text-field--solo > .v-input__control > .v-input__slot {
  background: transparent !important;
}

@media (max-width: 600px) {
  .top-level-search {
    order: 2 !important;
    margin-left: 0 !important;
    flex: 1 1 auto !important;
  }

  .table-container {
    max-height: calc(100vh - 150px);
  }
}
</style>
