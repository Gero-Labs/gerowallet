<template>
  <v-card class="tx-list glass-panel fill-height d-flex flex-column" outlined :loading="loadingTxs">
    <div class="tx-list__head">
      <div class="tx-list__title-row">
        <router-link v-if="!isFullList" to="/transactions" class="tx-list__title t-heading">
          {{ $t('transactions.title') }}
        </router-link>
        <h2 v-else class="tx-list__title t-heading">{{ $t('transactions.title') }}</h2>
        <span class="tx-list__count g-num">{{ transactions.length }}</span>
        <v-spacer />

        <v-tooltip bottom content-class="custom-tooltip">
          <template v-slot:activator="{ on, attrs }">
            <button
              type="button"
              class="tx-icon-btn"
              v-bind="attrs"
              :aria-label="sortLabel"
              v-on="on"
              @click="sortDesc = !sortDesc"
            >
              <v-icon small>{{ sortDesc ? 'mdi-sort-clock-descending-outline' : 'mdi-sort-clock-ascending-outline' }}</v-icon>
            </button>
          </template>
          <span>{{ sortLabel }}</span>
        </v-tooltip>

        <!-- Filter menu -->
        <v-menu
          v-if="isFullList && !isBitcoin"
          v-model="filterMenuOpen"
          :close-on-content-click="false"
          offset-y
          nudge-left="150"
          nudge-bottom="4"
          min-width="240"
          max-width="300"
          content-class="filter-menu"
          transition="none"
        >
          <template v-slot:activator="{ on, attrs }">
            <button type="button" class="tx-icon-btn" v-bind="attrs" :aria-label="$t('common.filter')" v-on="on">
              <v-icon small>mdi-tune-variant</v-icon>
              <span v-if="activeFilterCount > 0" class="tx-icon-btn__badge g-num">{{ activeFilterCount }}</span>
            </button>
          </template>
          <v-card class="glass-popover" dark>
            <v-card-text class="pa-3">
              <!-- Date range -->
              <div class="filter-section-label t-label">{{ $t('transactions.dateRange') }}</div>
              <div class="d-flex align-center" style="gap: 6px">
                <v-menu
                  v-model="dateFromMenu"
                  :close-on-content-click="false"
                  offset-y
                  min-width="auto"
                  content-class="date-picker-menu"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-text-field
                      :value="filterDateFrom || ''"
                      :placeholder="$t('transactions.from')"
                      dense
                      outlined
                      hide-details
                      readonly
                      v-bind="attrs"
                      v-on="on"
                      class="filter-date-field"
                      clearable
                      @click:clear="filterDateFrom = null"
                    >
                      <template v-slot:prepend-inner>
                        <v-icon small class="mt-1 filter-date-icon">mdi-calendar</v-icon>
                      </template>
                    </v-text-field>
                  </template>
                  <v-date-picker
                    :value="filterDateFrom"
                    @input="filterDateFrom = $event; dateFromMenu = false"
                    :min="earliestTxDate"
                    :max="filterDateTo || latestTxDate"
                    :events="transactionDates"
                    event-color="var(--g-accent)"
                    no-title
                    dark
                    color="var(--g-accent)"
                    class="filter-date-picker"
                  />
                </v-menu>
                <v-menu
                  v-model="dateToMenu"
                  :close-on-content-click="false"
                  offset-y
                  min-width="auto"
                  content-class="date-picker-menu"
                >
                  <template v-slot:activator="{ on, attrs }">
                    <v-text-field
                      :value="filterDateTo || ''"
                      :placeholder="$t('transactions.to')"
                      dense
                      outlined
                      hide-details
                      readonly
                      v-bind="attrs"
                      v-on="on"
                      class="filter-date-field"
                      clearable
                      @click:clear="filterDateTo = null"
                    >
                      <template v-slot:prepend-inner>
                        <v-icon small class="mt-1 filter-date-icon">mdi-calendar</v-icon>
                      </template>
                    </v-text-field>
                  </template>
                  <v-date-picker
                    :value="filterDateTo"
                    @input="filterDateTo = $event; dateToMenu = false"
                    :min="filterDateFrom || earliestTxDate"
                    :max="latestTxDate"
                    :events="transactionDates"
                    event-color="var(--g-accent)"
                    no-title
                    dark
                    color="var(--g-accent)"
                    class="filter-date-picker"
                  />
                </v-menu>
              </div>

              <v-divider class="my-2 filter-divider" />

              <!-- Transaction type -->
              <div class="filter-section-label t-label">{{ $t('transactions.type') }}</div>
              <v-chip-group v-model="filterTypes" multiple column>
                <v-chip
                  v-for="ft in typeFilterOptions"
                  :key="ft.value"
                  :value="ft.value"
                  small
                  outlined
                  filter
                  class="filter-type-chip"
                >{{ ft.text }}</v-chip>
              </v-chip-group>

              <v-divider class="my-2 filter-divider" />

              <!-- Token filter -->
              <div class="filter-section-label t-label">{{ $t('transactions.tokens') }}</div>
              <v-chip-group v-model="filterTokenMode" column>
                <v-chip value="all" small outlined filter class="filter-type-chip">{{ $t('common.all') }}</v-chip>
                <v-chip value="ada_only" small outlined filter class="filter-type-chip">ADA {{ $t('common.only') }}</v-chip>
                <v-chip value="with_tokens" small outlined filter class="filter-type-chip">{{ $t('transactions.withTokens') }}</v-chip>
              </v-chip-group>

              <v-divider class="my-2 filter-divider" />

              <!-- Export CSV -->
              <v-btn text block small class="justify-start" @click="exportToCsv()">
                <v-icon small class="mr-2">mdi-download</v-icon>
                {{ $t('transactions.exportCsv') }}
              </v-btn>

              <!-- Clear all -->
              <v-btn
                :disabled="activeFilterCount === 0"
                text
                block
                small
                class="justify-start mt-1"
                color="error"
                @click="clearAllFilters()"
              >
                <v-icon small class="mr-2">mdi-close-circle-outline</v-icon>
                {{ $t('common.clearFilters') }}
              </v-btn>
            </v-card-text>
          </v-card>
        </v-menu>
      </div>

      <label class="tx-search">
        <v-icon small class="tx-search__icon">mdi-magnify</v-icon>
        <input
          ref="searchField"
          v-model="search"
          type="search"
          class="tx-search__input"
          :placeholder="$t('transactions.searchPlaceholder')"
          :aria-label="$t('common.search')"
          @keydown.esc="search = ''"
        />
      </label>
    </div>

    <div ref="listScroller" class="tx-list__scroll">
      <!-- Nothing to show yet and the loader is still writing: placeholders, not
           "no transactions", which would be a claim. -->
      <div v-if="showSkeleton" aria-hidden="true">
        <div v-for="n in 6" :key="n" class="tx-skeleton">
          <span class="g-skeleton tx-skeleton__glyph"></span>
          <span class="tx-skeleton__text">
            <span class="g-skeleton tx-skeleton__line tx-skeleton__line--title"></span>
            <span class="g-skeleton tx-skeleton__line tx-skeleton__line--meta"></span>
          </span>
          <span class="g-skeleton tx-skeleton__line tx-skeleton__line--amount"></span>
        </div>
      </div>

      <div v-else-if="displayedTransactions.length === 0" class="tx-list__empty">
        <TxGlyph :icon="hasActiveQuery ? 'mdi-text-search' : 'mdi-clipboard-text-outline'" large />
        <span class="tx-list__empty-title">
          {{ hasActiveQuery ? $t('transactions.noMatches') : $t('transactions.noTransactionsFound') }}
        </span>
        <GButton v-if="hasActiveQuery" tier="secondary" compact @click="clearQuery()">
          {{ $t('common.clearFilters') }}
        </GButton>
      </div>

      <template v-else>
        <section v-for="group in groupedTransactions" :key="group.key" class="tx-day">
          <h3 class="tx-day__head">
            <span>{{ group.label }}</span>
            <span v-if="group.net" class="tx-day__net g-num">{{ group.net }}</span>
          </h3>
          <div
            v-for="item in group.items"
            :key="item.id"
            :data-id="item.id"
            :class="['tx-row', { 'selected-transaction': isSelected(item) }]"
          >
            <button
              type="button"
              class="tx-row__main"
              :aria-current="isSelected(item) ? 'true' : undefined"
              @click="handleOnTransactionsRowClick(item)"
            >
              <TxGlyph :icon="view(item).icon" :tone="view(item).tone" />
              <span class="tx-row__text">
                <span class="tx-row__title">
                  <span :class="['tx-row__title-text', { 'tx-row__title-text--failed': isPendingTooLong(item) }]">
                    {{ getTransactionStatus(item) }}
                  </span>
                  <span
                    v-if="item.pending && !isPendingTooLong(item)"
                    class="pending-indicator"
                    role="status"
                    :aria-label="$t('dashboard.transactionPendingConfirmation')"
                    :title="$t('dashboard.transactionPendingConfirmation')"
                  ></span>
                </span>
                <span class="tx-row__meta">
                  <span :title="absoluteTime(item)">{{ relativeTime(item) }}</span>
                  <TxTag v-for="tag in view(item).tags" :key="tag.key" :tag="tag" />
                </span>
              </span>
              <span
                v-if="view(item).tokens.length"
                :class="['tx-row__tokens', { 'tx-row__tokens--pending': item.pending }]"
              >
                <span v-for="token in view(item).tokens" :key="token.key" class="tx-row__token">
                  <img :src="token.img" :alt="token.name" />
                </span>
                <span v-if="view(item).moreTokens" class="tx-row__token tx-row__token--more g-num">
                  +{{ view(item).moreTokens }}
                </span>
              </span>
              <span v-if="loggedWallet" class="tx-row__value">
                <span :class="['tx-row__amount', 'g-num', amountClass(item)]">
                  <template v-if="hideBalances">••••••</template>
                  <template v-else>{{ formatRowAmount(item) }}</template>
                </span>
                <span v-if="adaPrice > 0" class="tx-row__fiat g-num">
                  <template v-if="hideBalances">{{ getCurrencySymbol() }}•••</template>
                  <template v-else>{{ formatRowFiat(item) }}</template>
                </span>
              </span>
            </button>
            <button
              v-if="isPendingTooLong(item)"
              type="button"
              class="tx-icon-btn tx-row__dismiss"
              :aria-label="$t('transactions.removePendingTransaction')"
              :title="$t('transactions.removePendingTransaction')"
              @click="handleRemovePendingTransaction(item)"
            >
              <v-icon small>mdi-delete-outline</v-icon>
            </button>
          </div>
        </section>

        <div v-if="isFullList && isLoadingMore" class="tx-list__footer">
          <v-progress-circular indeterminate :size="14" :width="2" color="var(--g-text-3)" />
          {{ $t('transactions.loadingMoreTransactions') }}
        </div>
        <div v-else-if="isFullList && hasReachedEnd && !debouncedSearch" class="tx-list__footer">
          {{ $t('transactions.noMoreTransactions') }}
        </div>
      </template>

      <!-- Intersection observer target for infinite scroll -->
      <div v-if="isFullList && !hasReachedEnd" ref="intersectionTarget" class="tx-list__sentinel"></div>
    </div>

    <v-card-actions
      v-if="!isFullList && transactions.length > itemsPerPage"
      class="pa-0 text-center justify-center"
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
    <BitcoinTransactionDetailsDialog
      v-if="transactionInfo && isBitcoin && state === '/' && !selectedTransaction"
      :transactionInfo="transactionInfo"
      @close="handleTransactionModalClose"
    />
    <TransactionDetailsDialog
      v-if="transactionInfo && !isBitcoin && state === '/' && !selectedTransaction"
      :transactionInfo="transactionInfo"
      @close="handleTransactionModalClose"
    ></TransactionDetailsDialog>
  </v-card>
</template>
<script setup lang="ts">
import '@/shared/styles/compact-pagination.css';
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import filters from '@/shared/utils/filters';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import BitcoinTransactionDetailsDialog from '@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import TxGlyph from '@/modules/transactions/components/TxGlyph.vue';
import TxTag from '@/modules/transactions/components/TxTag.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import assts from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { Cardano } from '@cardano-sdk/core';
import { Blockchain } from '@/models/types';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import stakingStoreActions from '@/stores/stakingStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import debounce from 'lodash/debounce';
import { isCardanoTx, StoredTransaction, TxAsset } from '@/models/transaction.types';
import { resolveAsset } from '@/shared/utils/resolver';
import { getCertificateBaseStatus } from '@/modules/dashboard/utils/transactionStatus';
import {
  addFundTransferStatus,
  buildClassifyContext,
  buildTxTags,
  buildTxTitle,
  classifyTxKind,
  getTxContacts,
  isCashback,
  isDexHunter,
  isDustRegistration,
  isGeroSwap,
  isInternalTransfer,
  isJpgStore,
  isMinswap,
  isMuesliSwap,
  isPendingTooLong,
  isSplash,
  isStakeRegistration,
  isSteelSwap,
  isStrike,
  isSundaeSwap,
  isVyFi,
  isWingRiders,
  isWithdrawal,
  TX_KIND_ICON,
  TX_KIND_TONE,
  TxTag as TxTagData,
  TxTone,
  withMinusSign,
} from '@/modules/dashboard/utils/transactionClassifier';

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
const { assets } = toRefs(networkStore);
const { loadingTxs } = toRefs(loadingState);

const isBitcoin = computed(() => loggedWallet.value?.chain === Blockchain.BITCOIN);

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

// Live Kraken ticker price for ADA
const adaPrice = computed(() => priceStore.adaUsd?.lastPrice || 0);

// Wallet addresses, stake address and contacts the classifiers compare against
const classifyCtx = computed(() => buildClassifyContext(loggedWallet.value, keys.value, contacts.value));

const transactionInfo = ref<StoredTransaction | null>(null);
const sortDesc = ref<boolean>(true);
const sortLabel = computed(() => (sortDesc.value ? t('governance.sortNewest') : t('governance.sortOldest')));

const searchField = ref<HTMLInputElement | null>(null);

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

// Computed search property for v-model binding (a cleared search input reports '')
const search = computed({
  get: () => searchInput.value,
  set: (value: string) => {
    searchInput.value = value || '';
  },
});

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------
const filterMenuOpen = ref(false);
const dateFromMenu = ref(false);
const dateToMenu = ref(false);
const filterDateFrom = ref<string | null>(null);

const toDateString = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

const earliestTxDate = computed(() => {
  const all = txs.value as StoredTransaction[];
  if (!all?.length) return undefined;
  const earliest = all.reduce((min, tx) => tx.tx_timestamp < min ? tx.tx_timestamp : min, all[0].tx_timestamp);
  return toDateString(earliest);
});

const latestTxDate = computed(() => {
  return toDateString(Math.floor(Date.now() / 1000));
});

// Dates that have transactions — shown as dots on the date picker
const transactionDates = computed(() => {
  const all = txs.value as StoredTransaction[];
  if (!all?.length) return [];
  const dates = new Set<string>();
  for (const tx of all) {
    dates.add(toDateString(tx.tx_timestamp));
  }
  return Array.from(dates);
});
const filterDateTo = ref<string | null>(null);
const filterTypes = ref<string[]>([]);
const filterTokenMode = ref<string>('all');

const typeFilterOptions = [
  { value: 'sent', text: t('transactions.sentFunds') },
  { value: 'received', text: t('transactions.receivedFunds') },
  { value: 'delegation', text: t('transactions.delegatingToPool') },
  { value: 'withdrawal', text: t('transactions.withdrawal') },
  { value: 'internal', text: t('common.internal') },
];

const activeFilterCount = computed(() => {
  let count = 0;
  if (filterDateFrom.value || filterDateTo.value) count++;
  count += filterTypes.value.length;
  if (filterTokenMode.value && filterTokenMode.value !== 'all') count++;
  return count;
});

const hasActiveQuery = computed(() => activeFilterCount.value > 0 || !!debouncedSearch.value);

function clearAllFilters() {
  filterDateFrom.value = null;
  filterDateTo.value = null;
  filterTypes.value = [];
  filterTokenMode.value = 'all';
}

function clearQuery() {
  clearAllFilters();
  search.value = '';
}

function exportToCsv() {
  filterMenuOpen.value = false;
  const rows = transactions.value;
  const csvHeaders = ['Date', 'Type', 'Amount (ADA)', 'Transaction ID'];
  const csvRows = rows.map(tx => {
    const date = new Date(tx.tx_timestamp * 1000).toISOString();
    const status = transactionStatuses.value[tx.id] || buildTxTitle(tx, classifyCtx.value, t);
    const ada = (tx.ada / 1_000_000).toFixed(6);
    return [date, `"${status}"`, ada, tx.id].join(',');
  });
  const csv = [csvHeaders.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Version counter to detect and cancel stale async loads (prevents race conditions when typing fast)
const loadVersion = ref(0);

// Infinite scroll variables
const displayedTransactions = ref<StoredTransaction[]>([]);
const currentIndex = ref<number>(0);
const isLoadingMore = ref<boolean>(false);
const hasReachedEnd = ref<boolean>(false);
const intersectionTarget = ref<HTMLElement | null>(null);
const intersectionObserver = ref<IntersectionObserver | null>(null);
const listScroller = ref<HTMLElement | null>(null);

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
  const ctx = classifyCtx.value;
  let result = (txs.value as StoredTransaction[]).filter((tx) => {
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

      // Check tags and certificates (fields only present on full CardanoTx records)
      let matchesChip = false;
      if (isCardanoTx(tx)) {
        matchesChip =
          ('vyfi'.includes(searchLower) && isVyFi(tx)) ||
          ('splash'.includes(searchLower) && isSplash(tx)) ||
          ('withdrawal'.includes(searchLower) && isWithdrawal(tx, ctx)) ||
          ('stake'.includes(searchLower) && isStakeRegistration(tx)) ||
          (tx.body?.certificates?.some((cert) => cert.__typename.toLowerCase().includes(searchLower)) ?? false);
      }

      // Checks that work for all transaction types (address-based detectors also
      // match thin records via the utxo set)
      matchesChip = matchesChip ||
        ('minswap'.includes(searchLower) && isMinswap(tx)) ||
        ('wingriders'.includes(searchLower) && isWingRiders(tx)) ||
        ('muesliswap'.includes(searchLower) && isMuesliSwap(tx)) ||
        ('sundaeswap'.includes(searchLower) && isSundaeSwap(tx)) ||
        ('dexhunter'.includes(searchLower) && isDexHunter(tx)) ||
        ('strike'.includes(searchLower) && isStrike(tx)) ||
        ('dust'.includes(searchLower) && isDustRegistration(tx, ctx)) ||
        ('jpg.store'.includes(searchLower) && isJpgStore(tx)) ||
        ('cashback'.includes(searchLower) && isCashback(tx)) ||
        ('steelswap'.includes(searchLower) && isSteelSwap(tx)) ||
        ('gero swap'.includes(searchLower) && isGeroSwap(tx)) ||
        ('internal'.includes(searchLower) && isInternalTransfer(tx, ctx)) ||
        ('pending'.includes(searchLower) && tx.pending);

      // Check contact name
      const contactName = getTxContacts(tx, ctx);
      const matchesContact = contactName && contactName.find(c => c.label.toLowerCase() === searchLower);

      return matchesId || matchesAsset || matchesChip || matchesContact;
    }
    return true;
  });
  if (filterDateFrom.value) {
    const from = new Date(filterDateFrom.value).getTime() / 1000;
    result = result.filter(tx => tx.tx_timestamp >= from);
  }
  if (filterDateTo.value) {
    const to = new Date(filterDateTo.value).getTime() / 1000 + 86400; // end of day
    result = result.filter(tx => tx.tx_timestamp < to);
  }

  // Apply type filters
  if (filterTypes.value.length > 0) {
    result = result.filter(tx => {
      const net = tx.receivedAmount - tx.sentAmount;
      return filterTypes.value.some(type => {
        switch (type) {
          case 'sent': return net < 0;
          case 'received': return net > 0;
          case 'delegation': return isCardanoTx(tx) && tx.body?.certificates?.some(
            c => c.__typename === Cardano.CertificateType.StakeDelegation ||
                 c.__typename === Cardano.CertificateType.StakeRegistrationDelegation
          );
          case 'withdrawal': return isWithdrawal(tx, ctx);
          case 'internal': return isInternalTransfer(tx, ctx);
          default: return false;
        }
      });
    });
  }

  // Apply token mode filter
  if (filterTokenMode.value === 'ada_only') {
    result = result.filter(tx => !tx.assets?.some(a => a.unit !== 'lovelace' && a.quantity !== 0));
  } else if (filterTokenMode.value === 'with_tokens') {
    result = result.filter(tx => tx.assets?.some(a => a.unit !== 'lovelace' && a.quantity !== 0));
  }

  // `result` is a fresh array (filter), so sorting it in place is safe
  return result.sort((a, b) => (sortDesc.value ? b.tx_timestamp - a.tx_timestamp : a.tx_timestamp - b.tx_timestamp));
});

// Store for transaction statuses with loaded pool data
const transactionStatuses = ref<Record<string, string>>({});

// Preload statuses for displayed transactions
const preloadTransactionStatuses = async (transactions: StoredTransaction[]): Promise<void> => {
  const version = loadVersion.value;
  const promises = transactions.map(async (item) => {
    const txId = item.id;

    // Skip if already loaded
    if (transactionStatuses.value[txId]) {
      return;
    }

    // Load status with pool data
    const statuses: string[] = [];

    if (isCardanoTx(item) && item.body?.certificates?.length) {
      for (const certificate of item.body?.certificates ?? []) {
        const status = await processCertificate(certificate, true);
        if (status) statuses.push(status);
      }
    }

    addFundTransferStatus(item, statuses, t, classifyCtx.value);

    if (version === loadVersion.value) {
      transactionStatuses.value = { ...transactionStatuses.value, [txId]: statuses.join(', ') };
    }
  });

  await Promise.all(promises);
};

// Get transaction status (reactive)
const getTransactionStatus = (item: StoredTransaction): string => {
  // Pending for more than an hour: it never reached the chain
  if (isPendingTooLong(item)) {
    return t('transactions.failedTransaction');
  }

  // Cached status (with pool ticker) or the basic status as fallback
  return transactionStatuses.value[item.id] || buildTxTitle(item, classifyCtx.value, t);
};

// Process single certificate and return status
const processCertificate = async (certificate: Cardano.Certificate, loadPoolData = false): Promise<string> => {
  const baseStatus = getCertificateBaseStatus(certificate.__typename, t);

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

const getPoolByIdFromApi = async (poolId: string) => {
  if (!poolId) return null;

  try {
    return await stakingStoreActions.loadPoolById(loggedWallet.value, poolId);
  } catch (error) {
    console.error('Error loading pool by ID:', error);
    return null;
  }
};

// ---------------------------------------------------------------------------
// Row presentation: glyph, tags and token stack, derived once per displayed row
// ---------------------------------------------------------------------------
interface RowToken {
  key: string;
  img: string;
  name: string;
}

interface RowView {
  icon: string;
  tone: TxTone;
  tags: TxTagData[];
  tokens: RowToken[];
  moreTokens: number;
}

const ROW_TOKEN_LIMIT = 3;

const rowToken = (asset: TxAsset): RowToken => {
  // A malformed unit must not take the whole list down
  try {
    const resolved = resolveAsset(asset);
    return { key: asset.unit, img: resolved?.img || assts.questionMarkDark, name: resolved?.name || '' };
  } catch {
    return { key: asset.unit, img: assts.questionMarkDark, name: '' };
  }
};

const rowViews = computed(() => {
  const ctx = classifyCtx.value;
  const views = new Map<string, RowView>();
  for (const item of displayedTransactions.value) {
    const kind = classifyTxKind(item, ctx);
    // ADA is implied by the amount; the stack only shows tokens that moved
    const movedTokens = (item.assets ?? []).filter(
      (asset) => asset.unit !== 'lovelace' && asset.policy_id !== '' && Number(asset.quantity) !== 0,
    );
    views.set(item.id, {
      icon: TX_KIND_ICON[kind],
      tone: TX_KIND_TONE[kind],
      tags: buildTxTags(item, ctx, t, kind),
      tokens: movedTokens.slice(0, ROW_TOKEN_LIMIT).map(rowToken),
      moreTokens: Math.max(0, movedTokens.length - ROW_TOKEN_LIMIT),
    });
  }
  return views;
});

const EMPTY_VIEW: RowView = { icon: TX_KIND_ICON.neutral, tone: 'neutral', tags: [], tokens: [], moreTokens: 0 };
const view = (item: StoredTransaction): RowView => rowViews.value.get(item.id) ?? EMPTY_VIEW;

const currencySymbol = computed(() =>
  loggedWallet.value ? networks.resolveCurrencySymbol(loggedWallet.value.chain, loggedWallet.value.network) : '',
);

const formatRowAmount = (item: StoredTransaction): string =>
  withMinusSign(filters.toCurrency(item.ada ?? 0, true, 0, currencySymbol.value, '', false));

const formatRowFiat = (item: StoredTransaction): string =>
  withMinusSign(filters.toCurrency(convertFiat((item.ada ?? 0) * adaPrice.value), true, 0, getCurrencySymbol(), '', false, 6));

const amountClass = (item: StoredTransaction): string => {
  if (isPendingTooLong(item)) return 'tx-row__amount--failed';
  if (item.pending) return 'tx-row__amount--pending';
  return item.ada > 0 ? 'tx-row__amount--in' : '';
};

const relativeTime = (item: StoredTransaction): string => time.format(new Date(item.tx_timestamp * 1000));

const absoluteTime = (item: StoredTransaction): string => {
  const when = new Date(item.tx_timestamp * 1000).toLocaleString();
  return item.epoch_no ? `${when} · ${t('transactions.epoch')} ${item.epoch_no}` : when;
};

const isSelected = (item: StoredTransaction): boolean => props.selectedTransaction?.id === item.id;

// ---------------------------------------------------------------------------
// Day groups: sticky "Today" / "Yesterday" / date headers with the day's net
// ---------------------------------------------------------------------------
const dayKey = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};

const dayLabel = (timestamp: number): string => {
  const now = Date.now() / 1000;
  const key = dayKey(timestamp);
  if (key === dayKey(now)) return t('miniGero.today');
  if (key === dayKey(now - 86400)) return t('miniGero.yesterday');
  const date = new Date(timestamp * 1000);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
};

// Net per day over the whole filtered list, not just the rows loaded so far. A failed
// attempt (pending past the hour, never on chain) moved no funds, so it doesn't count.
const dayNets = computed(() => {
  const nets = new Map<string, number>();
  for (const tx of transactions.value) {
    if (isPendingTooLong(tx)) continue;
    const key = dayKey(tx.tx_timestamp);
    nets.set(key, (nets.get(key) ?? 0) + (tx.ada ?? 0));
  }
  return nets;
});

const groupedTransactions = computed(() => {
  const groups: { key: string; label: string; net: string; items: StoredTransaction[] }[] = [];
  for (const item of displayedTransactions.value) {
    const key = dayKey(item.tx_timestamp);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const net = dayNets.value.get(key) ?? 0;
      group = {
        key,
        label: dayLabel(item.tx_timestamp),
        net: hideBalances.value || !loggedWallet.value
          ? ''
          : withMinusSign(filters.toCurrency(net, true, 0, currencySymbol.value, '', false)),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
});

// Nothing to show yet, and the loader is still writing: loading, not empty
const showSkeleton = computed(
  () => !!loadingTxs.value && displayedTransactions.value.length === 0 && !hasActiveQuery.value,
);

// Load more transactions
const loadMoreTransactions = async () => {
  if (isLoadingMore.value || hasReachedEnd.value) return;

  isLoadingMore.value = true;

  try {
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

    // Pool metadata enhances the label; it must not hold up rows or pagination.
    if (newTransactions.length > 0) void preloadTransactionStatuses(newTransactions);
  } finally {
    isLoadingMore.value = false;
  }
};

// Reset infinite scroll when search changes
const resetInfiniteScroll = async () => {
  // Increment version to invalidate any in-progress loadMoreTransactions calls
  loadVersion.value++;
  isLoadingMore.value = false;

  currentIndex.value = 0;
  hasReachedEnd.value = false;
  currentPage.value = 1;

  // Clear cached transaction statuses
  transactionStatuses.value = {};

  // Load first batch and replace atomically to prevent flicker
  const endIndex = itemsPerBatch.value;
  const firstBatch = transactions.value.slice(0, endIndex);
  currentIndex.value = endIndex;
  if (endIndex >= transactions.value.length) {
    hasReachedEnd.value = true;
  }
  displayedTransactions.value = firstBatch;
  isLoadingMore.value = false;
  // Publish pending rows immediately, using the existing basic status fallback.
  void preloadTransactionStatuses(firstBatch);
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

// Watch for filter and sort changes to reset infinite scroll
watch(
  [filterDateFrom, filterDateTo, filterTypes, filterTokenMode, sortDesc],
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
// This updates displayed transactions without clearing the list
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

  intersectionObserver.value = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !isLoadingMore.value && !hasReachedEnd.value) {
          loadMoreTransactions();
        }
      });
    },
    {
      root: listScroller.value, // The list's own scroll container
      rootMargin: '100px', // Start loading when 100px away from the target
      threshold: [0, 0.1, 1.0], // Multiple thresholds for better detection
    }
  );

  intersectionObserver.value.observe(intersectionTarget.value);
};

// Fallback scroll handler
const handleScroll = () => {
  if (!listScroller.value || !props.isFullList || isLoadingMore.value || hasReachedEnd.value) return;

  const { scrollTop, scrollHeight, clientHeight } = listScroller.value;
  const scrolledToBottom = scrollTop + clientHeight >= scrollHeight - 100; // 100px threshold

  if (scrolledToBottom) {
    loadMoreTransactions();
  }
};

// Setup scroll fallback
const setupScrollFallback = () => {
  if (!props.isFullList || !listScroller.value) return;
  listScroller.value.addEventListener('scroll', handleScroll, { passive: true });
};

const handleOnTransactionsRowClick = (row: StoredTransaction) => {
  transactionInfo.value = row;
  emit('row-click', row);
};

const handleTransactionModalClose = () => {
  transactionInfo.value = null;
};

// Handle page change for pagination
const handlePageChange = async (page: number) => {
  currentPage.value = page;
  hasReachedEnd.value = false;
  await loadMoreTransactions();
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

    if (!response.data?.success) {
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
  loadVersion.value++;
  if (intersectionObserver.value) {
    intersectionObserver.value.disconnect();
  }
  listScroller.value?.removeEventListener('scroll', handleScroll);
  // Cancel pending debounce to prevent state mutation after teardown
  debouncedUpdateSearch.cancel();
});
</script>
<style scoped lang="scss">
/* Surface comes from the shared .glass-panel material. */
.tx-list {
  overflow: hidden;
}

/* ─── Header ─────────────────────────────────────────────────── */
.tx-list__head {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4) var(--g-s-4) var(--g-s-3);
}

.tx-list__title-row {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.tx-list__title {
  margin: 0;
  color: var(--g-text-1);
  text-decoration: none;
}

a.tx-list__title:hover {
  color: var(--g-accent);
}

.tx-list__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
  color: var(--g-text-2);
  font-size: 12px;
  font-weight: 600;
}

.tx-icon-btn {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.tx-icon-btn:hover {
  background: var(--g-hairline-1);
  color: var(--g-text-1);
}

.tx-icon-btn .v-icon {
  color: inherit;
}

.tx-icon-btn__badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: var(--g-r-pill);
  background: var(--g-accent);
  color: var(--g-on-grad);
  font-size: 11px;
  font-weight: 700;
  line-height: 14px;
  text-align: center;
}

/* ─── Search ─────────────────────────────────────────────────── */
.tx-search {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  height: 36px;
  padding: 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-1);
  cursor: text;
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

/* The field's focus ring lives on the pill, so the input inside needs none of its own. */
.tx-search:focus-within {
  border-color: var(--g-accent);
}

.tx-search .tx-search__icon {
  color: var(--g-text-3);
}

.tx-search__input {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font: inherit;
  font-size: 13px;
  outline: none;
}

.tx-search__input::placeholder {
  color: var(--g-text-3);
}

.tx-search__input::-webkit-search-cancel-button {
  cursor: pointer;
}

/* ─── List ───────────────────────────────────────────────────── */
.tx-list__scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 0 var(--g-s-2) var(--g-s-2);
  scrollbar-width: thin;
  scrollbar-color: var(--g-hairline-3) transparent;
}

.tx-day__head {
  @include g-glass-chrome;
  position: sticky;
  top: 0;
  z-index: var(--g-z-sticky);
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0;
  padding: var(--g-s-3) var(--g-s-3) var(--g-s-2);
  /* Tinted so the label stays legible over the rows scrolling beneath it */
  background: rgba(6, 8, 10, 0.72);
  color: var(--g-text-2);
  font-size: 12px;
  font-weight: 600;
}

.tx-day__net {
  color: var(--g-text-3);
  font-weight: 500;
}

.tx-row {
  display: flex;
  align-items: center;
  border-radius: var(--g-r-control);
  transition: background-color var(--g-dur-fast) var(--g-ease), box-shadow var(--g-dur-fast) var(--g-ease);
}

.tx-row:hover {
  background: var(--g-hairline-1);
}

.tx-row.selected-transaction {
  background: color-mix(in srgb, var(--g-accent) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--g-accent) 30%, transparent);
}

.tx-row__main {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-height: 60px;
  padding: 10px var(--g-s-3);
  border: 0;
  border-radius: inherit;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.tx-row__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
}

.tx-row__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.3;
}

.tx-row__title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tx-row__title-text--failed {
  color: var(--g-error);
}

.tx-row__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  color: var(--g-text-3);
  font-size: 12px;
  line-height: 1.3;
  white-space: nowrap;
}

.tx-row__tokens {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
}

.tx-row__tokens--pending {
  opacity: 0.5;
}

.tx-row__token {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  overflow: hidden;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  box-shadow: 0 0 0 2px var(--g-surface);
}

.tx-row__token + .tx-row__token {
  margin-left: -6px;
}

.tx-row__token img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.tx-row__token--more {
  color: var(--g-text-2);
  font-size: 10px;
  font-weight: 600;
}

.tx-row__value {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--g-s-1);
}

/* Outgoing reads in the default text tone; the minus sign carries direction. */
.tx-row__amount {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
}

.tx-row__amount--in {
  color: var(--g-success);
}

.tx-row__amount--pending {
  color: var(--g-warning);
}

.tx-row__amount--failed {
  color: var(--g-text-3);
  text-decoration: line-through;
}

.tx-row__fiat {
  color: var(--g-text-3);
  font-size: 12px;
  white-space: nowrap;
}

.tx-row__dismiss {
  margin-right: var(--g-s-2);
}

.tx-row__dismiss .v-icon {
  color: var(--g-error);
}

/* Pending: the sanctioned status pulse */
.pending-indicator {
  display: inline-block;
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: var(--g-r-pill);
  background-color: var(--g-warning);
  animation: pulse-pending 2s ease-in-out infinite;
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

/* ─── States ─────────────────────────────────────────────────── */
.tx-skeleton {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  min-height: 60px;
  padding: 10px var(--g-s-3);
}

.tx-skeleton__glyph {
  flex: 0 0 auto;
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-pill);
}

.tx-skeleton__text {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.tx-skeleton__line {
  display: block;
  height: 10px;
  border-radius: var(--g-r-chip);
}

.tx-skeleton__line--title {
  width: 55%;
}

.tx-skeleton__line--meta {
  width: 32%;
}

.tx-skeleton__line--amount {
  flex: 0 0 auto;
  width: 56px;
}

.tx-list__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-3);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.tx-list__empty-title {
  color: var(--g-text-1);
  font-size: 14px;
  font-weight: 600;
}

.tx-list__footer {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4) 0 var(--g-s-2);
  color: var(--g-text-3);
  font-size: 12px;
}

.tx-list__sentinel {
  height: 1px;
}

/* ─── Filter popover ─────────────────────────────────────────── */
.filter-section-label {
  margin-bottom: 4px;
}

.filter-divider {
  opacity: 0.1;
}

.filter-date-icon {
  opacity: 0.5;
}

.filter-date-field {
  font-size: 12px !important;
}

.filter-date-field ::v-deep .v-input__slot {
  min-height: 30px !important;
  padding: 0 8px !important;
  align-items: center !important;
}

.filter-date-field ::v-deep .v-input__prepend-inner {
  margin-top: 4px !important;
  margin-right: 4px !important;
  padding-right: 0 !important;
  display: flex !important;
  align-items: center !important;
  height: 100% !important;
}

.filter-date-field ::v-deep .v-input__append-inner {
  margin-top: 4px !important;
  display: flex !important;
  align-items: center !important;
}

.filter-date-field ::v-deep .v-input__append-inner .v-icon {
  font-size: 14px !important;
}

.filter-date-picker {
  background: var(--g-overlay) !important;
  border-radius: var(--g-r-card) !important;
  border: 1px solid var(--g-hairline-1) !important;
}

.filter-date-picker ::v-deep .v-date-picker-header {
  padding: 8px 16px !important;
  background: transparent !important;
}

.filter-date-picker ::v-deep .v-date-picker-header .v-btn {
  color: var(--g-text-2) !important;
}

.filter-date-picker ::v-deep .v-date-picker-table {
  padding: 0 8px 8px !important;
}

.filter-date-picker ::v-deep .v-date-picker-table .v-btn {
  border-radius: var(--g-r-control) !important;
  color: var(--g-text-2) !important;
}

.filter-date-picker ::v-deep .v-date-picker-table .v-btn:hover {
  background: color-mix(in srgb, var(--g-accent) 8%, transparent) !important;
}

.filter-date-picker ::v-deep .v-btn--active {
  background-color: var(--g-accent) !important;
  color: var(--g-on-grad) !important;
}

.filter-date-picker ::v-deep .v-date-picker-table--date .v-btn--disabled {
  opacity: 0.25 !important;
}

.filter-type-chip {
  border-color: var(--g-hairline-3) !important;
  color: var(--g-text-2) !important;
}

.filter-type-chip.v-chip--active {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--g-accent) 40%, transparent) !important;
  color: var(--g-accent) !important;
}
</style>
