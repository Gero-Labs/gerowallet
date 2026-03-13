<template>
  <v-card outlined class="fill-height liquid-glass d-flex flex-column" :loading="loadingTxs">
    <v-card-title class="pb-2 flex-grow-0">
      <router-link v-if="!isFullList" to="/transactions" style="text-decoration: auto; color: white"
        >{{ $t('transactions.title') }}</router-link
      >
      <span v-else>{{ $t('transactions.title') }}</span>
      <v-spacer />
      <!-- Search box -->
      <v-text-field
        v-model="search"
        dense
        flat
        solo
        hide-details
        :placeholder="$t('transactions.search')"
        prepend-inner-icon="mdi-magnify"
        clearable
        style="max-width: 200px"
        class="top-level-search"
      ></v-text-field>
    </v-card-title>
    <v-card-text class="pa-0 text-center flex-grow-1 d-flex flex-column">
      <div :class="{ 'table-container': props.isFullList }" class="flex-grow-1">
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
                  <span class="activity-text" :class="{ 'failed-transaction-text': isPendingTooLong(item) }">{{ getTransactionStatus(item) }}</span>
                  <v-tooltip v-if="item.pending" content-class="custom-tooltip" top>
                    <template v-slot:activator="{ on, attrs }">
                      <span
                        v-bind="attrs"
                        v-on="on"
                        :class="isPendingTooLong(item) ? 'pending-indicator-remove' : 'pending-indicator'"
                        @click.stop="isPendingTooLong(item) && handleRemovePendingTransaction(item)"
                      >
                        <v-icon v-if="isPendingTooLong(item)" x-small color="error">mdi-close-circle</v-icon>
                      </span>
                    </template>
                    <span>{{ isPendingTooLong(item) ? $t('transactions.removePendingTransaction') : $t('dashboard.transactionPendingConfirmation') }}</span>
                  </v-tooltip>
                </v-list-item-title>
                <v-list-item-subtitle class="activity-date">
                  <v-tooltip content-class="custom-tooltip" top>
                    <template v-slot:activator="{ on, attrs }">
                      <span v-bind="attrs" v-on="on">
                        {{ time.format(new Date(item.tx_timestamp * 1000)) }}
                      </span>
                    </template>
                    <span>
                      {{ new Date(item.tx_timestamp * 1000).toLocaleString() }}
                      <br v-if="item.epoch_no" />
                      {{ item.epoch_no ? `${$t('transactions.epoch')}: ${item.epoch_no}` : '' }}
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
                    >{{ $t('transactions.stakeRegistration') }}</v-chip
                  >
                  <v-chip
                    v-if="isStakeDeRegistration(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="red"
                    style="margin-right: 4px !important"
                    >{{ $t('transactions.stakeDeregistration') }}</v-chip
                  >
                  <v-chip
                    v-if="isWithdrawal(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="blue"
                    style="margin-right: 4px !important"
                    >{{ $t('transactions.withdrawal') }}</v-chip
                  >
                  <v-chip
                    v-if="isCashback(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#E77DFF"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('cashback.cashback') }}</v-chip
                  >
                  <v-chip
                    v-if="isInternalTransfer(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#9C27B0"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('common.internal') }}</v-chip
                  >
                  <template v-for="(contact, index) in (getContactName(item) || [])">
                    <v-chip
                      v-if="contact.isHandle"
                      outlined
                      class="px-1"
                      x-small
                      color="white"
                      style="margin-left: 1px; margin-bottom: 1px"
                      :key="'h-' + index"
                    ><span style="color: #0fd25b; font-weight: 600">$</span>{{ contact.label.replace(/^\$/, '') }}</v-chip>
                    <v-chip
                      v-else
                      outlined
                      class="px-1"
                      x-small
                      color="#FF9800"
                      style="margin-left: 1px; margin-bottom: 1px"
                      :key="'c-' + index"
                    ><v-icon x-small class="mr-1">mdi-account</v-icon>{{ contact.label }}</v-chip>
                  </template>
                  <v-chip
                    v-if="isStrike(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#26FAB0"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.strike') }}</v-chip
                  >
                  <v-chip
                    v-if="isDexHunter(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#007DFF"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.dexHunter') }}</v-chip
                  >
                  <v-chip
                    v-if="isMinswap(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#89AAFF"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.minswap') }}</v-chip
                  >
                  <v-chip
                    v-if="isJpgStore(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#ffdb24"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >jpg.store</v-chip
                  >
                  <v-chip
                    v-if="isWingRiders(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#e5e7eb"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.wingRiders') }}</v-chip
                  >
                  <v-chip
                    v-if="isMuesliSwap(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#5B4EFF"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.muesliswap') }}</v-chip
                  >
                  <span v-if="isVyFi(item)" class="vyfi-chip"></span>
                  <span v-if="isSundaeSwap(item)" class="sundaeswap-chip" :data-label="$t('transactions.sundaeswap')"></span>
                  <span v-if="isSplash(item)" class="splash-chip" :data-label="$t('transactions.splash')"></span>
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
                    item.ada ?? 0,
                    true,
                    0,
                    networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network),
                    '',
                    false
                  )
                }}
              </div>
              <div style="font-size: 12px; color: #c4c4c4; white-space: nowrap">
                {{ filters.toCurrency(convertFiat((item.ada ?? 0) * adaPrice), true, 0, getCurrencySymbol(), '', false, 6) }}
              </div>
            </div>
          </template>
          <template v-slot:body.append>
            <!-- Loading indicator for infinite scroll -->
            <tr v-if="props.isFullList && isLoadingMore" class="no-hover">
              <td :colspan="activityHeaders.length" class="text-center pa-4">
                <v-progress-circular indeterminate color="primary" size="24"></v-progress-circular>
                <span class="ml-2">{{ $t('transactions.loadingMoreTransactions') }}</span>
              </td>
            </tr>
            <!-- End of list indicator for infinite scroll -->
            <tr v-else-if="props.isFullList && hasReachedEnd && !debouncedSearch" class="no-hover">
              <td :colspan="activityHeaders.length" class="text-center pa-4">
                <span class="text-caption text--secondary">
                  {{ displayedTransactions.length > 0 ? $t('transactions.noMoreTransactions') : $t('transactions.noTransactionsFound') }}
                </span>
              </td>
            </tr>
            <!-- Intersection observer target for infinite scroll -->
            <tr v-if="props.isFullList && !hasReachedEnd && !isLoadingMore" class="no-hover">
              <td :colspan="activityHeaders.length" class="pa-0 ma-0">
                <div ref="intersectionTarget" style="height: 1px"></div>
              </td>
            </tr>
          </template>
        </v-data-table>
      </div>
    </v-card-text>
    <v-card-actions
      v-if="!props.isFullList && transactions.length > itemsPerPage"
      class="pa-0 no-hover text-center justify-center"
    >
      <v-pagination
        v-model="currentPage"
        :length="Math.ceil(transactions.length / itemsPerPage)"
        :total-visible="7"
        circle
        class="compact-pagination ma-0"
        @input="handlePageChange"
      ></v-pagination>
    </v-card-actions>
    <TransactionDetailsDialog
      v-if="transactionInfo && state === '/' && !selectedTransaction"
      :transactionInfo="transactionInfo"
      @close="handleTransactionModalClose"
    ></TransactionDetailsDialog>
  </v-card>
</template>
<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import stakingStoreActions from '@/stores/stakingStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import debounce from 'lodash/debounce';
import { StoredTransaction, CardanoTx, isCardanoTx } from '@/models/transaction.types';

const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

// Get instance for i18n
const { t } = useTranslation();
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

const { transactions: txs, loggedWallet, keys, contacts } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { assets } = toRefs(networkStore);
const { loadingTxs } = toRefs(loadingState);

// Use Kraken WebSocket price for ADA, fallback to network store price
const adaPrice = computed(() => priceStore.adaUsd?.lastPrice || price.value?.lastPrice || 0);

const activityHeaders = computed(() => [
  { text: t('transactions.activity'), align: 'start overflow-x', sortable: true, value: 'tx_timestamp' },
  { text: t('transactions.amount'), align: 'center text-nowrap', sortable: false, value: 'amount' },
  { text: '', align: 'center no-padding', sortable: false, value: 'assets', width: 110 },
]);

const transactionInfo = ref<StoredTransaction | null>(null);
const sortBy = ref<string>('tx_timestamp');
const sortDesc = ref<boolean>(true);

// Search input and debounced search value
const searchInput = ref<string>('');
const debouncedSearch = ref<string>('');

// Debounce function to update debouncedSearch after user stops typing
const debouncedUpdateSearch = debounce((value: string) => {
  debouncedSearch.value = value;
}, 300); // 300ms debounce delay

// Watch searchInput and trigger debounced update
watch(searchInput, (newValue) => {
  debouncedUpdateSearch(newValue);
});

// Cancel pending debounce on unmount to prevent state mutation after teardown
onUnmounted(() => debouncedUpdateSearch.cancel());

// Computed search property for v-model binding
// Note: Vuetify clearable sets value to null, so we coerce to empty string
const search = computed({
  get: () => searchInput.value,
  set: (value: string) => {
    searchInput.value = value || '';
  },
});

// Version counter to detect and cancel stale async loads (prevents race conditions when typing fast)
const loadVersion = ref(0);

// Infinite scroll variables
const displayedTransactions = ref<StoredTransaction[]>([]);
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

const vmProxy = getCurrentInstance()!.proxy as { $route: { path: string } };
const state = computed(() => vmProxy.$route.path);

const transactions = computed<StoredTransaction[]>(() => {
  const filtered = (txs.value as StoredTransaction[]).filter((tx) => {
    if (debouncedSearch.value) {
      const searchLower = debouncedSearch.value.toLowerCase();

      // Check transaction ID
      const matchesId = tx.id.toLowerCase().includes(searchLower);

      // Check assets
      const matchesAsset = tx.assets.some((asset) => {
        const assetInfo = assets.value[asset.unit];
        return (
          assetInfo?.metadata?.name?.toLowerCase().includes(searchLower) ||
          assetInfo?.metadata?.ticker?.toLowerCase().includes(searchLower)
        );
      });

      // Check tags/chips and certificates (CardanoTx-specific fields)
      let matchesChip = false;
      if (isCardanoTx(tx)) {
        matchesChip =
          ('minswap'.includes(searchLower) && isMinswap(tx)) ||
          ('wingriders'.includes(searchLower) && isWingRiders(tx)) ||
          ('muesliswap'.includes(searchLower) && isMuesliSwap(tx)) ||
          ('vyfi'.includes(searchLower) && isVyFi(tx)) ||
          ('sundaeswap'.includes(searchLower) && isSundaeSwap(tx)) ||
          ('splash'.includes(searchLower) && isSplash(tx)) ||
          ('dexhunter'.includes(searchLower) && isDexHunter(tx)) ||
          ('strike'.includes(searchLower) && isStrike(tx)) ||
          ('jpg.store'.includes(searchLower) && isJpgStore(tx)) ||
          ('withdrawal'.includes(searchLower) && isWithdrawal(tx)) ||
          ('stake'.includes(searchLower) && isStakeRegistration(tx)) ||
          (tx.body.certificates?.some((cert) => cert.__typename.toLowerCase().includes(searchLower)) ?? false);
      }

      // Checks that work for all transaction types
      matchesChip = matchesChip ||
        ('cashback'.includes(searchLower) && isCashback(tx)) ||
        ('internal'.includes(searchLower) && isInternalTransfer(tx)) ||
        ('pending'.includes(searchLower) && tx.pending);

      // Check contact name
      const contactName = getContactName(tx);
      const matchesContact = contactName && contactName.find(c => c.label.toLowerCase() === searchLower);

      return matchesId || matchesAsset || matchesChip || matchesContact;
    }
    return true;
  });

  // Sort by timestamp descending (most recent first)
  return filtered.sort((a, b) => b.tx_timestamp - a.tx_timestamp);
});

// Store for transaction statuses with loaded pool data
const transactionStatuses = ref<Record<string, string>>({});

// Preload statuses for displayed transactions
const preloadTransactionStatuses = async (transactions: StoredTransaction[]): Promise<void> => {
  const promises = transactions.map(async (item) => {
    const txId = item.id;

    // Skip if already loaded
    if (transactionStatuses.value[txId]) {
      return;
    }

    // Load status with pool data
    const statuses: string[] = [];

    if (isCardanoTx(item) && item.body.certificates?.length) {
      for (const certificate of item.body.certificates) {
        const status = await processCertificate(certificate, true);
        if (status) statuses.push(status);
      }
    }

    addFundTransferStatus(item, statuses);

    transactionStatuses.value[txId] = statuses.join(', ');
  });

  await Promise.all(promises);
};

// Get transaction status (reactive)
const getTransactionStatus = (item: StoredTransaction): string => {
  // Check if transaction is pending for too long (> 1 hour) - show as "Failed Transaction"
  if (isPendingTooLong(item)) {
    return t('transactions.failedTransaction');
  }

  const txId = item.id;

  // Return cached status or basic status as fallback
  return transactionStatuses.value[txId] || buildBasicStatus(item);
};

// Certificate type to status mapping
const getCertificateBaseStatus = (certificateType: string): string => {
  switch (certificateType) {
    case Cardano.CertificateType.StakeRegistrationDelegation:
    case Cardano.CertificateType.StakeDelegation:
      return t('transactions.delegatingToPool');
    case Cardano.CertificateType.Unregistration:
    case Cardano.CertificateType.StakeDeregistration:
      return t('transactions.stakeDeregistration');
    case Cardano.CertificateType.RegisterDelegateRepresentative:
      return t('dashboard.dRepRegistration');
    case Cardano.CertificateType.VoteDelegation:
      return t('transactions.voteDelegation');
    case Cardano.CertificateType.VoteRegistrationDelegation:
      return t('transactions.voteRegistrationDelegation');
    case Cardano.CertificateType.StakeVoteRegistrationDelegation:
      return t('transactions.stakeVoteRegistration');
    case Cardano.CertificateType.UnregisterDelegateRepresentative:
      return t('dashboard.dRepDeregistration');
    default:
      return '';
  }
};

// Process single certificate and return status
const processCertificate = async (certificate: Cardano.Certificate, loadPoolData = false): Promise<string> => {
  const baseStatus = getCertificateBaseStatus(certificate.__typename);

  // For delegation certificates, try to get enhanced status with pool ticker
  if (
    (certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
      certificate.__typename === Cardano.CertificateType.StakeDelegation) &&
    loadPoolData
  ) {
    const pool = await getPoolByIdFromApi(certificate.poolId);
    if (pool && pool.ticker) {
      return t('transactions.delegatingTo', { pool: pool.ticker });
    }
  } else if (
    certificate.__typename === Cardano.CertificateType.Unregistration ||
    certificate.__typename === Cardano.CertificateType.StakeDeregistration
  ) {
    return t('transactions.stakeDeregistration');
  }

  return baseStatus;
};

// Add fund transfer status if applicable
const addFundTransferStatus = (item: StoredTransaction, statuses: string[]): void => {
  // Skip if transaction has certificates (delegation, registration, etc.)
  if (isCardanoTx(item) && item.body.certificates && item.body.certificates.length > 0) {
    return;
  }
  const hasReceivedFunds = item.receivedAmount - item.sentAmount > 0;
  const hasSentFunds = item.receivedAmount - item.sentAmount < 0;
  const hasReceivedTokens = item.assets?.some((asset) => asset.unit !== 'lovelace' && asset.quantity > 0);
  const hasSentTokens = item.assets?.some((asset) => asset.unit !== 'lovelace' && asset.quantity < 0);

  // Build smart status message
  if (hasReceivedFunds && hasReceivedTokens) {
    statuses.push(t('transactions.receivedFundsAndTokens'));
  } else if (hasSentFunds && hasSentTokens) {
    statuses.push(t('transactions.sentFundsAndTokens'));
  } else if (hasReceivedFunds && hasSentTokens) {
    statuses.push(t('transactions.receivedFundsAndSentTokens'));
  } else if (hasSentFunds && hasReceivedTokens) {
    statuses.push(t('transactions.sentFundsAndReceivedTokens'));
  } else if (hasReceivedFunds) {
    statuses.push(t('transactions.receivedFunds'));
  } else if (hasSentFunds) {
    statuses.push(t('transactions.sentFunds'));
  } else if (hasReceivedTokens) {
    statuses.push(t('transactions.receivedTokens'));
  } else if (hasSentTokens) {
    statuses.push(t('transactions.sentTokens'));
  }
};

// Build basic transaction status without pool API data
const buildBasicStatus = (item: StoredTransaction): string => {
  const statuses: string[] = [];

  if (isCardanoTx(item) && item.body.certificates?.length) {
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

  const version = loadVersion.value;
  isLoadingMore.value = true;

  if (props.isFullList) {
    // Simulate loading delay for better UX
    await new Promise(resolve => setTimeout(resolve, 300));
    // Bail out if a new search/reset happened during the delay
    if (version !== loadVersion.value) return;
  }

  let newTransactions: StoredTransaction[];

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
    // Bail out if a new search/reset happened during preload
    if (version !== loadVersion.value) return;
  }

  isLoadingMore.value = false;
};

// Reset infinite scroll when search changes
const resetInfiniteScroll = async () => {
  // Increment version to invalidate any in-progress loadMoreTransactions calls
  loadVersion.value++;
  isLoadingMore.value = false;

  displayedTransactions.value = [];
  currentIndex.value = 0;
  hasReachedEnd.value = false;
  currentPage.value = 1;

  // Clear cached transaction statuses
  transactionStatuses.value = {};

  await loadMoreTransactions();
};

// Watch for debounced search term changes to reset infinite scroll
watch(
  () => debouncedSearch.value,
  async () => {
    if (props.isFullList) {
      await resetInfiniteScroll();
    }
  }
);

// Watch for transactions changes to reset infinite scroll
// Only reset if the transaction count changes (not for status updates)
const transactionCount = ref(0);
watch(
  () => transactions.value.length,
  async (newLength, oldLength) => {
    // Only reset if transaction count actually changed
    if (newLength !== oldLength) {
      transactionCount.value = newLength;
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
    }
  }
);

// Watch for changes in transaction data (e.g., pending status updates)
// This updates displayed transactions without clearing the table
watch(
  () => transactions.value,
  (newTransactions, oldTransactions) => {
    // Only update if it's a data change (not a count change)
    if (newTransactions.length === oldTransactions?.length) {
      // Update displayed transactions to reflect changes (like pending -> confirmed)
      if (!props.isFullList) {
        // Pagination mode - update the current page
        const start = (currentPage.value - 1) * itemsPerPage.value;
        const end = start + itemsPerPage.value;
        displayedTransactions.value = transactions.value.slice(start, end);
      } else {
        // Infinite scroll mode - update existing items while maintaining scroll position
        const currentLength = displayedTransactions.value.length;
        displayedTransactions.value = transactions.value.slice(0, currentLength);
      }
    }
    // If length changed, the other watcher will handle it
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

const handleOnTransactionsRowClick = (row: StoredTransaction) => {
  transactionInfo.value = row;
  emit('row-click', row);
};

const handleTransactionModalClose = () => {
  transactionInfo.value = null;
};

const isWithdrawal = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  return (
    item.body.withdrawals?.length > 0 &&
    loggedWallet.value?.stakeAddress &&
    item.body.withdrawals.some((withdrawal) => withdrawal.stakeAddress === loggedWallet.value.stakeAddress)
  ) ?? false;
};

const getContactName = (item: StoredTransaction): { label: string; isHandle: boolean }[] | null => {
  const contactsResult = new Map<string, { label: string; isHandle: boolean }>();
  // Check if contacts are available (contacts is an object, not an array)
  if (!contacts.value || !item.utxo) {
    return null;
  }

  // Create a map of contact addresses to display info
  const contactMap = new Map<string, { label: string; isHandle: boolean }>();
  Object.values(contacts.value).forEach((contact) => {
    if (contact.address && contact.name) {
      contactMap.set(contact.address, {
        label: contact.handle || contact.name,
        isHandle: !!contact.handle,
      });
    }
  });

  // Check if there are any contacts to compare
  if (contactMap.size === 0) {
    return null;
  }

  // Check inputs for contact addresses
  for (const input of item.utxo.inputs || []) {
    if (contactMap.has(input.address)) {
      const info = contactMap.get(input.address)!;
      contactsResult.set(info.label, info);
    }
  }

  // Check outputs for contact addresses (CardanoTx only)
  if (isCardanoTx(item)) {
    for (const output of item.body.outputs || []) {
      if (contactMap.has(output.address)) {
        const info = contactMap.get(output.address)!;
        contactsResult.set(info.label, info);
      }
    }
  }

  return Array.from(contactsResult.values());
};

const isInternalTransfer = (item: StoredTransaction): boolean => {
  // Check if keys are available
  if (!keys.value || !item.utxo) {
    return false;
  }

  // Collect all wallet addresses from keys
  const walletAddresses = new Set<string>();

  // Add payment addresses
  if (keys.value.payment) {
    keys.value.payment.forEach(key => {
      if (key.address) {
        walletAddresses.add(key.address);
      }
    });
  }

  // Add change addresses
  if (keys.value.change) {
    keys.value.change.forEach(key => {
      if (key.address) {
        walletAddresses.add(key.address);
      }
    });
  }

  // Check if there are any addresses to compare
  if (walletAddresses.size === 0) {
    return false;
  }

  // Check all input addresses
  const allInputsInternal = item.utxo.inputs?.every((input) => walletAddresses.has(input.address));

  // Check all output addresses (CardanoTx only)
  const allOutputsInternal = isCardanoTx(item)
    ? item.body.outputs?.every((output) => walletAddresses.has(output.address))
    : true;

  // Transaction is internal if ALL inputs AND ALL outputs belong to this wallet
  return allInputsInternal && allOutputsInternal;
};

const isStrike = (item: CardanoTx): boolean => {
  // Strike Finance perpetual trading transactions
  const STRIKE_SCRIPT_HASH = 'be7544ca7d42c903268caecae465f3f8b5a7e7607d09165e471ac8b5';
  const STRIKE_CONTRACT_ADDRESS = 'addr1wytzw530pgjxm4wxsxj5ufp23cxacrvzmytpjnlcgq6t7vsgz25ef';

  // Check for Strike contract address (primary indicator of platform interaction)
  const hasStrikeAddress =
    item.utxo?.inputs?.some((input) => input.address === STRIKE_CONTRACT_ADDRESS) ||
    item.body.outputs?.some((output) => output.address === STRIKE_CONTRACT_ADDRESS);

  // Check for Strike script hash in witness (indicates contract execution)
  const hasStrikeScript = item.witness?.scripts?.some(
    (script) => Serialization.Script.fromCore(script).hash() === STRIKE_SCRIPT_HASH
  );

  // Only tag as Strike if there's actual platform interaction, not just position NFT transfers
  return hasStrikeAddress || hasStrikeScript || false;
};

const isDexHunter = (item: CardanoTx): boolean => {
  // Check for DexHunter order contract address (primary indicator)
  const DEXHUNTER_ORDER_ADDRESS =
    'addr1z8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcn84xmy84q2crvzy6he2j69798923xvt3jk5n3nd9eecmxks7hfyu8';
  const hasDexHunterOrderAddress =
    item.utxo?.inputs?.some((input) => input.address === DEXHUNTER_ORDER_ADDRESS) ||
    item.body.outputs?.some((output) => output.address === DEXHUNTER_ORDER_ADDRESS);

  // Check for DexHunter fee address (indicates completed trade)
  const DEXHUNTER_FEE_ADDRESS =
    'addr1q8l7hny7x96fadvq8cukyqkcfca5xmkrvfrrkt7hp76v3qvssm7fz9ajmtd58ksljgkyvqu6gl23hlcfgv7um5v0rn8qtnzlfk';
  const hasDexHunterFeeAddress = item.body.outputs?.some((output) => output.address === DEXHUNTER_FEE_ADDRESS);

  // Check metadata for DexHunter Trade message (indicates trade execution)
  const msg = item.auxiliaryData?.blob?.[674]?.msg;
  const hasDexHunterMetadata =
    msg && Array.isArray(msg) ? msg.some((m: string) => m.includes('Dexhunter') || m.includes('DexHunter')) : false;

  // Only tag as DexHunter if there's actual platform interaction
  return hasDexHunterOrderAddress || hasDexHunterFeeAddress || hasDexHunterMetadata || false;
};

const isMinswap = (item: CardanoTx): boolean => {
  // Minswap V1 addresses
  const MINSWAP_V1_MARKET_ORDER_ADDRESS = 'addr1wxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uwc0h43gt';
  const MINSWAP_V1_LIMIT_ORDER_ADDRESS =
    'addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70';

  // Minswap V2 order contract address
  const MINSWAP_V2_ORDER_ADDRESS =
    'addr1zxn9efv2f6w82hagxqtn62ju4m293tqvw0uhmdl64ch8uw6j2c79gy9l76sdg0xwhd7r0c0kna0tycz4y5s6mlenh8pq6s3z70';

  // Check for Minswap order contract addresses (indicates DEX interaction)
  const hasMinswapOrderAddress =
    item.utxo?.inputs?.some(
      (input) =>
        input.address === MINSWAP_V1_MARKET_ORDER_ADDRESS ||
        input.address === MINSWAP_V1_LIMIT_ORDER_ADDRESS ||
        input.address === MINSWAP_V2_ORDER_ADDRESS
    ) ||
    item.body.outputs?.some(
      (output) =>
        output.address === MINSWAP_V1_MARKET_ORDER_ADDRESS ||
        output.address === MINSWAP_V1_LIMIT_ORDER_ADDRESS ||
        output.address === MINSWAP_V2_ORDER_ADDRESS
    );

  // Check for Minswap metadata message (indicates platform interaction)
  const msg = item.auxiliaryData?.blob?.[674]?.msg;
  const hasMinswapMetadata = msg && Array.isArray(msg) ? msg.some((m: string) => m.includes('Minswap')) : false;

  // Check for Minswap pool NFT policy in datum CBOR (indicates pool interaction)
  const hasMinswapInOutputDatum = (item.body.outputs as Array<Cardano.TxOut & { datum?: { cbor?: string } }>)?.some(
    (output) => output.datum?.cbor?.includes('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c')
  );

  // Check for Minswap pool NFT policy in witness datums (indicates pool interaction)
  const hasMinswapInWitnessDatum = (item.witness?.datums as Array<{ cbor?: string }> | undefined)?.some(
    (datum) => datum.cbor?.includes('f5808c2c990d86da54bfc97d89cee6efa20cd8461616359478d96b4c')
  );

  // Only tag as Minswap if there's actual DEX interaction, not just LP token transfers
  return hasMinswapOrderAddress || hasMinswapMetadata || hasMinswapInOutputDatum || hasMinswapInWitnessDatum || false;
};

const isJpgStore = (item: CardanoTx): boolean => {
  // Check for jpg.store marketplace script address
  const JPGSTORE_SCRIPT_ADDRESS =
    'addr1zxgx3far7qygq0k6epa0zcvcvrevmn0ypsnfsue94nsn3tvpw288a4x0xf8pxgcntelxmyclq83s0ykeehchz2wtspks905plm';

  // Check for jpg.store Ask V1 Contract address (inputs only)
  const JPGSTORE_ASK_V1_ADDRESS =
    'addr1x8rjw3pawl0kelu4mj3c8x20fsczf5pl744s9mxz9v8n7efvjel5h55fgjcxgchp830r7h2l5msrlpt8262r3nvr8ekstg4qrx';

  const hasJpgStoreAddress =
    item.utxo?.inputs?.some(
      (input) => input.address === JPGSTORE_SCRIPT_ADDRESS || input.address === JPGSTORE_ASK_V1_ADDRESS
    ) || item.body.outputs?.some((output) => output.address === JPGSTORE_SCRIPT_ADDRESS);

  // Check for jpg.store auxiliary data structure (fields 0-10, 30)
  const hasJpgStoreMetadata =
    item.auxiliaryData?.blob &&
    (item.auxiliaryData.blob[0] ||
      item.auxiliaryData.blob[1] ||
      item.auxiliaryData.blob[2] ||
      item.auxiliaryData.blob[3] ||
      item.auxiliaryData.blob[4] ||
      item.auxiliaryData.blob[5] ||
      item.auxiliaryData.blob[6] ||
      item.auxiliaryData.blob[7] ||
      item.auxiliaryData.blob[8] ||
      item.auxiliaryData.blob[9] ||
      item.auxiliaryData.blob[10] ||
      item.auxiliaryData.blob[30]);

  // Check for datum hash (indicating a marketplace listing)
  const hasDatumHash = item.body.outputs?.some((output) => output.datumHash);

  return hasJpgStoreAddress || (hasJpgStoreMetadata && hasDatumHash) || false;
};

const isWingRiders = (item: CardanoTx): boolean => {
  // WingRiders V1 order address
  const WINGRIDERS_V1_ORDER_ADDRESS = 'addr1wxr2a8htmzuhj39y2gq7ftkpxv98y2g67tg8zezthgq4jkg0a4ul4';

  // WingRiders V2 order address
  const WINGRIDERS_V2_ORDER_ADDRESS = 'addr1w8qnfkpe5e99m7umz4vxnmelxs5qw5dxytmfjk964rla98q605wte';

  // Check for WingRiders order contract addresses (indicates DEX interaction)
  const hasWingRidersOrderAddress =
    item.utxo?.inputs?.some(
      (input) => input.address === WINGRIDERS_V1_ORDER_ADDRESS || input.address === WINGRIDERS_V2_ORDER_ADDRESS
    ) ||
    item.body.outputs?.some(
      (output) => output.address === WINGRIDERS_V1_ORDER_ADDRESS || output.address === WINGRIDERS_V2_ORDER_ADDRESS
    );

  // Check for WingRiders V1 pool validity asset policy in datum CBOR (indicates pool interaction)
  const enrichedOutputs = item.body.outputs as Array<Cardano.TxOut & { datum?: { cbor?: string } }>;
  const enrichedDatums = item.witness?.datums as Array<{ cbor?: string }> | undefined;

  const hasWingRidersV1InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a5704c')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('026a18d04a0c642759bb3d83b12e3344894e5c1c7b2aeb1a2113a5704c')
    );

  // Check for WingRiders V2 pool validity asset policy in datum CBOR (indicates pool interaction)
  const hasWingRidersV2InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed7374c')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('6fdc63a1d71dc2c65502b79baae7fb543185702b12c3c5fb639ed7374c')
    );

  return hasWingRidersOrderAddress || hasWingRidersV1InDatum || hasWingRidersV2InDatum || false;
};

const isVyFi = (item: CardanoTx): boolean => {
  // Check for VyFi metadata message (indicates platform interaction)
  const msg = item.auxiliaryData?.blob?.[674]?.msg;
  return typeof msg === 'string' && msg.includes('VyFi');
};

const isSundaeSwap = (item: CardanoTx): boolean => {
  // SundaeSwap V1 addresses
  const SUNDAESWAP_V1_ORDER_ADDRESS = 'addr1wxaptpmxcxawvr3pzlhgnpmzz3ql43n2tc8mn3av5kx0yzs09tqh8';
  const SUNDAESWAP_V1_POOL_ADDRESS = 'addr1w9qzpelu9hn45pefc0xr4ac4kdxeswq7pndul2vuj59u8tqaxdznu';

  // SundaeSwap V3 pool address (primary indicator)
  const SUNDAESWAP_V3_POOL_ADDRESS =
    'addr1x8srqftqemf0mjlukfszd97ljuxdp44r372txfcr75wrz26rnxqnmtv3hdu2t6chcfhl2zzjh36a87nmd6dwsu3jenqsslnz7e';

  // Check for SundaeSwap contract addresses (indicates DEX interaction)
  return (
    item.utxo?.inputs?.some(
      (input) =>
        input.address === SUNDAESWAP_V1_ORDER_ADDRESS ||
        input.address === SUNDAESWAP_V1_POOL_ADDRESS ||
        input.address === SUNDAESWAP_V3_POOL_ADDRESS
    ) ||
    item.body.outputs?.some(
      (output) =>
        output.address === SUNDAESWAP_V1_ORDER_ADDRESS ||
        output.address === SUNDAESWAP_V1_POOL_ADDRESS ||
        output.address === SUNDAESWAP_V3_POOL_ADDRESS
    )
  ) ?? false;
};

const isSplash = (item: CardanoTx): boolean => {
  // Splash DEX batcher key (primary indicator)
  const SPLASH_BATCHER_KEY = '5cb2c968e5d1c7197a6ce7615967310a375545d9bc65063a964335b2';

  // Splash order script hash
  const SPLASH_ORDER_SCRIPT_HASH = '464eeee89f05aff787d40045af2a40a83fd96c513197d32fbc54ff02';

  // Check for Splash batcher key in required signatures (indicates DEX interaction)
  const hasSplashBatcherKey = item.body.requiredExtraSignatures?.some((sig) => sig === SPLASH_BATCHER_KEY);

  // Check for Splash order script in witness scripts
  const hasSplashScript = item.witness?.scripts?.some(
    (script) => Serialization.Script.fromCore(script).hash() === SPLASH_ORDER_SCRIPT_HASH
  );

  return hasSplashBatcherKey || hasSplashScript || false;
};

const isMuesliSwap = (item: CardanoTx): boolean => {
  // MuesliSwap order address
  const MUESLISWAP_ORDER_ADDRESS =
    'addr1zyq0kyrml023kwjk8zr86d5gaxrt5w8lxnah8r6m6s4jp4g3r6dxnzml343sx8jweqn4vn3fz2kj8kgu9czghx0jrsyqqktyhv';

  // Check for MuesliSwap order contract address (indicates DEX interaction)
  const hasMuesliSwapOrderAddress =
    item.utxo?.inputs?.some((input) => input.address === MUESLISWAP_ORDER_ADDRESS) ||
    item.body.outputs?.some((output) => output.address === MUESLISWAP_ORDER_ADDRESS);

  const enrichedOutputs = item.body.outputs as Array<Cardano.TxOut & { datum?: { cbor?: string } }>;
  const enrichedDatums = item.witness?.datums as Array<{ cbor?: string }> | undefined;

  // Check for MuesliSwap V1 pool NFT policy in datum CBOR (indicates pool interaction)
  const hasMuesliSwapV1InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('909133088303c49f3a30f1cc8ed553a73857a29779f6c6561cd8093f')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('909133088303c49f3a30f1cc8ed553a73857a29779f6c6561cd8093f')
    );

  // Check for MuesliSwap V2 pool NFT policy in datum CBOR (indicates pool interaction)
  const hasMuesliSwapV2InDatum =
    enrichedDatums?.some((datum) =>
      datum.cbor?.includes('7a8041a0693e6605d010d5185b034d55c79eaf7ef878aae3bdcdbf67')
    ) ||
    enrichedOutputs?.some((output) =>
      output.datum?.cbor?.includes('7a8041a0693e6605d010d5185b034d55c79eaf7ef878aae3bdcdbf67')
    );

  // Check for MuesliSwap factory token in assets (indicates pool interaction)
  const hasMuesliSwapFactoryToken = item.assets?.some((asset) =>
    asset.unit?.includes('de9b756719341e79785aa13c164e7fe68c189ed04d61c9876b2fe53f4d7565736c69537761705f414d4d')
  );

  return hasMuesliSwapOrderAddress || hasMuesliSwapV1InDatum || hasMuesliSwapV2InDatum || hasMuesliSwapFactoryToken || false;
};

const isCashback = (item: StoredTransaction): boolean => {
  return !!item.utxo?.inputs?.some((input) =>
    [
      'DdzFFzCqrhtBatWqyFge4w6M6VLgNUwRHiXTAg3xfQCUdTcjJxSrPHVZJBsQprUEc5pRhgMWQaGciTssoZVwrSKmG1fneZ1AeCtLgs5Y',
      'addr1qxj7hjwxkxlf2tyahw5fchm2w5tjm5xcedqywyd9gjh8hhpq3lssfl2enmaypvwdyfmpcvzkpdtlpa8ur332rnc0ksyq7eq6sd',
    ].includes(input.address)
  );
};

const isStakeRegistration = (item: CardanoTx): boolean => {
  return (
    (item.body.certificates?.length ?? 0) > 0 &&
    item.body.certificates!.some(
      (certificate) =>
        certificate.__typename === Cardano.CertificateType.StakeRegistration ||
        certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
        certificate.__typename === Cardano.CertificateType.Registration
    )
  );
};

const isStakeDeRegistration = (item: CardanoTx): boolean => {
  return (
    (item.body.certificates?.length ?? 0) > 0 &&
    item.body.certificates!.some(
      (certificate) =>
        certificate.__typename === Cardano.CertificateType.Unregistration ||
        certificate.__typename === Cardano.CertificateType.StakeDeregistration
    )
  );
};

const getColor = (item: StoredTransaction): string => {
  if (item.pending) {
    return '#FEC84B';
  } else if (item.ada > 0) {
    return '#47cd89';
  } else if (item.ada < 0) {
    return '#F97066';
  }
  return '';
};

const getRowClass = (item: StoredTransaction): string => {
  if (props.selectedTransaction && props.selectedTransaction['id'] === item.id) {
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

// Check if transaction has been pending for more than 1 hour
const isPendingTooLong = (item: StoredTransaction): boolean => {
  if (!item.pending) return false;

  const currentTime = Date.now() / 1000; // Current time in seconds
  const pendingDuration = currentTime - item.tx_timestamp; // Duration in seconds
  const oneHourInSeconds = 60 * 60; // 1 hour = 3600 seconds

  return pendingDuration > oneHourInSeconds;
};

// Remove pending transaction
const handleRemovePendingTransaction = async (item: StoredTransaction) => {
  try {
    const { Messaging } = await import('@/chrome/messaging');
    const { MessageTypes } = await import('@/models/MessageTypes');

    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.REMOVE_PENDING_TRANSACTION,
      data: { txId: item.id }
    }) as { data: { success: boolean; error?: string } };

    if (response.data?.success) {
      console.log('Pending transaction removed successfully');
    } else {
      console.error('Failed to remove pending transaction:', response.data?.error);
    }
  } catch (error) {
    console.error('Error removing pending transaction:', error);
  }
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
  // Cancel any pending debounced search updates (VueUse provides cancel method)
  if ('cancel' in debouncedUpdateSearch && typeof debouncedUpdateSearch.cancel === 'function') {
    debouncedUpdateSearch.cancel();
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
  padding-top: 0 !important;
  padding-bottom: 0 !important;
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

/* VyFi gradient text and border - matches v-chip x-small */
.vyfi-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-left: 1px;
  margin-bottom: 1px;
  font-size: 10px;
  font-weight: 400;
  border-radius: 12px;
  background: transparent;
  cursor: default;
  vertical-align: middle;
  height: 16px;
  line-height: 20px;
  white-space: nowrap;
  text-decoration: none;
  transition-duration: 0.28s;
  transition-property: box-shadow, opacity;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.vyfi-chip::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
  padding: 1px;
  background: linear-gradient(135deg, #935aaf 5%, #6fc7ff 95%);
  mask-image: linear-gradient(to bottom, #fff 0%, #fff 100%), linear-gradient(to bottom, #fff 0%, #fff 100%);
  mask-clip: content-box, padding-box;
  mask-composite: exclude;
}

.vyfi-chip::after {
  content: 'VyFi';
  position: relative;
  z-index: 1;
  padding: 0 4px;
  display: inline-block;
  background: linear-gradient(135deg, #935aaf 5%, #6fc7ff 95%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  height: 14px;
  line-height: 14px;
}

.vyfi-chip:hover {
  background-color: #ffffff0d;
}

/* SundaeSwap gradient text and border - matches v-chip x-small */
.sundaeswap-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-left: 1px;
  margin-bottom: 1px;
  font-size: 10px;
  font-weight: 400;
  border-radius: 12px;
  background: transparent;
  cursor: default;
  vertical-align: middle;
  height: 16px;
  line-height: 20px;
  white-space: nowrap;
  text-decoration: none;
  transition-duration: 0.28s;
  transition-property: box-shadow, opacity;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.sundaeswap-chip::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
  padding: 1px;
  background: linear-gradient(90deg, #e85ce8, #6fb3ff);
  mask-image: linear-gradient(to bottom, #fff 0%, #fff 100%), linear-gradient(to bottom, #fff 0%, #fff 100%);
  mask-clip: content-box, padding-box;
  mask-composite: exclude;
}

.sundaeswap-chip::after {
  content: 'SundaeSwap';
  position: relative;
  z-index: 1;
  padding: 0 4px;
  display: inline-block;
  background: linear-gradient(90deg, #e85ce8, #6fb3ff);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  height: 14px;
  line-height: 14px;
}

.sundaeswap-chip:hover {
  background-color: #ffffff0d;
}

/* Splash gradient text and border - matches v-chip x-small */
.splash-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin-left: 1px;
  margin-bottom: 1px;
  font-size: 10px;
  font-weight: 400;
  border-radius: 12px;
  background: transparent;
  cursor: default;
  vertical-align: middle;
  height: 16px;
  line-height: 20px;
  white-space: nowrap;
  text-decoration: none;
  transition-duration: 0.28s;
  transition-property: box-shadow, opacity;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}

.splash-chip::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  border-radius: 12px;
  padding: 1px;
  background: linear-gradient(90deg, #0059ff, #00fff6);
  mask-image: linear-gradient(to bottom, #fff 0%, #fff 100%), linear-gradient(to bottom, #fff 0%, #fff 100%);
  mask-clip: content-box, padding-box;
  mask-composite: exclude;
}

.splash-chip::after {
  content: attr(data-label);
  position: relative;
  z-index: 1;
  padding: 0 4px;
  display: inline-block;
  background: linear-gradient(90deg, #0059ff, #00fff6);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  height: 14px;
  line-height: 14px;
}

.splash-chip:hover {
  background-color: #ffffff0d;
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

/* Pending indicator - pulsing yellow circle */
.pending-indicator {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #FEC84B;
  margin-left: 6px;
  animation: pulse-pending 2s ease-in-out infinite;
  flex-shrink: 0;
}

/* Pending indicator for transactions pending > 1 hour - red X icon, clickable */
.pending-indicator-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.pending-indicator-remove:hover {
  transform: scale(1.2);
}

@keyframes pulse-pending {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.85);
  }
}

/* Failed transaction text - red/error color */
.failed-transaction-text {
  color: #F97066 !important;
}
</style>
