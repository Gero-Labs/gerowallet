<template>
  <v-card
    :class="['fill-height d-flex flex-column', isBitcoin ? 'tx-glass-card' : 'liquid-glass']"
    :outlined="!isBitcoin"
    :loading="loadingTxs"
  >
    <!-- Bitcoin header -->
    <v-card-title v-if="isBitcoin" class="px-3 pt-3 pb-2 flex-grow-0 tx-card-title">
      <div class="tx-icon-box">
        <svg viewBox="0 0 20 20" fill="none" width="13" height="13">
          <path d="M3 5h14M3 9h14M3 13h8M3 17h5" stroke="#F7931A" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="tx-heading-group ml-2">
        <router-link v-if="!isFullList" to="/transactions" class="tx-heading-link">
          {{ $t('transactions.title') }}
        </router-link>
        <span v-else class="tx-heading">{{ $t('transactions.title') }}</span>
        <span class="tx-count">{{ transactions.length }} TXS</span>
      </div>
      <v-spacer />
      <v-text-field
        v-model="search"
        dense
        flat
        solo
        hide-details
        :placeholder="$t('common.search')"
        prepend-inner-icon="mdi-magnify"
        clearable
        class="top-level-search tx-search-field"
      />
    </v-card-title>

    <!-- Cardano/Apex header (original) -->
    <v-card-title v-else class="pb-0 flex-grow-0">
      <router-link v-if="!isFullList" to="/transactions" style="text-decoration: auto; color: var(--g-text-1)">
        {{ $t('transactions.title') }}
      </router-link>
      <span v-else>{{ $t('transactions.title') }}</span>
      <v-spacer />

      <!-- Expandable search (grows to the left) -->
      <div class="expanding-search-wrap">
        <input
          ref="searchField"
          v-model="search"
          type="text"
          class="expanding-search-input"
          :placeholder="t('common.search')"
          @keydown.esc="searchField?.blur()"
        />
        <v-icon small class="expanding-search-icon" color="var(--g-text-1)">mdi-magnify</v-icon>
      </div>

      <!-- Filter menu -->
      <v-menu
        v-if="props.isFullList"
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
          <v-btn icon small v-bind="attrs" v-on="on" class="ml-1">
            <v-badge color="transparent" avatar :value="activeFilterCount > 0" :content="activeFilterCount" overlap>
              <template v-slot:badge>
                <v-avatar size="14" height="14" style="height: 14px!important;" color="primary">
                  <span style="font-size: 11px; color: var(--g-on-grad)">{{ activeFilterCount }}</span>
                </v-avatar>
              </template>
              <v-icon small>mdi-tune-variant</v-icon>
            </v-badge>
          </v-btn>
        </template>
        <v-card class="liquid-glass-compact" dark>
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
                      <v-icon small class="mt-1" style="opacity: 0.5">mdi-calendar</v-icon>
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
                  @click:clear="filterDateTo = null"
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
                  >
                    <template v-slot:prepend-inner>
                      <v-icon small class="mt-1" style="opacity: 0.5">mdi-calendar</v-icon>
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

            <v-divider class="my-2" style="opacity: 0.1" />

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

            <v-divider class="my-2" style="opacity: 0.1" />

            <!-- Token filter -->
            <div class="filter-section-label t-label">{{ $t('transactions.tokens') }}</div>
            <v-chip-group v-model="filterTokenMode" column>
              <v-chip value="all" small outlined filter class="filter-type-chip">{{ $t('common.all') }}</v-chip>
              <v-chip value="ada_only" small outlined filter class="filter-type-chip">ADA {{ $t('common.only') }}</v-chip>
              <v-chip value="with_tokens" small outlined filter class="filter-type-chip">{{ $t('transactions.withTokens') }}</v-chip>
            </v-chip-group>

            <v-divider class="my-2" style="opacity: 0.1" />

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
              {{ $t('transactions.clearFilters') }}
            </v-btn>
          </v-card-text>
        </v-card>
      </v-menu>
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
                <v-list-item-subtitle class="chips-row">
                  <v-chip
                    v-if="isStakeRegistration(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="error"
                    style="margin-right: 4px !important"
                    >{{ $t('transactions.stakeRegistration') }}</v-chip
                  >
                  <v-chip
                    v-if="isStakeDeRegistration(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="error"
                    style="margin-right: 4px !important"
                    >{{ $t('transactions.stakeDeregistration') }}</v-chip
                  >
                  <v-chip
                    v-if="isWithdrawal(item)"
                    x-small
                    outlined
                    class="px-1"
                    color="info"
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
                      color="var(--g-text-1)"
                      style="margin-left: 1px; margin-bottom: 1px"
                      :key="'h-' + index"
                    ><span style="color: var(--g-success); font-weight: 600">$</span>{{ contact.label.replace(/^\$/, '') }}</v-chip>
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
                    v-if="isDustRegistration(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="rgb(232, 199, 137)"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.dustRegistration') }}</v-chip
                  >
                  <v-chip
                    v-if="isDexHunter(item)"
                    outlined
                    class="px-1"
                    x-small
                    color="#007DFF"
                    style="margin-left: 1px; margin-bottom: 1px"
                    >{{ $t('transactions.swap') }}</v-chip
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
                <template v-if="hideBalances">••••••</template>
                <template v-else>
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
                </template>
              </div>
              <div style="font-size: 12px; color: var(--g-text-2); white-space: nowrap">
                <template v-if="hideBalances">$•••</template>
                <template v-else>
                  {{ filters.toCurrency(convertFiat((item.ada ?? 0) * adaPrice), true, 0, getCurrencySymbol(), '', false, 6) }}
                </template>
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
      :class="['pa-0 no-hover text-center justify-center', isBitcoin ? 'tx-pagination-bar' : '']"
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
import { computed, getCurrentInstance, nextTick, onMounted, onUnmounted, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import BitcoinTransactionDetailsDialog from '@/modules/dashboard/dialogs/BitcoinTransactionDetailsDialog.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Blockchain } from '@/models/types';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import stakingStoreActions from '@/stores/stakingStore';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import debounce from 'lodash/debounce';
import { isCardanoTx, StoredTransaction } from '@/models/transaction.types';
import { DUST_MAPPING_VALIDATOR } from '@/shared/composables/useCnightDustRegistration';

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

const isBitcoin = computed(() => loggedWallet.value?.chain === Blockchain.BITCOIN);

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

// Use Kraken WebSocket price for ADA, fallback to network store price
const adaPrice = computed(() => priceStore.adaUsd?.lastPrice || price.value?.lastPrice || 0);

const activityHeaders = computed(() => [
  { text: t('transactions.activity'), align: 'start overflow-x', sortable: true, value: 'tx_timestamp' },
  { text: '', align: 'center no-padding', sortable: false, value: 'assets', width: '78px' },
  { text: t('transactions.amount'), align: 'end text-nowrap', sortable: false, value: 'amount', width: '90px' },
]);

const transactionInfo = ref<StoredTransaction | null>(null);
const sortBy = ref<string>('tx_timestamp');
const sortDesc = ref<boolean>(true);

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

function clearAllFilters() {
  filterDateFrom.value = null;
  filterDateTo.value = null;
  filterTypes.value = [];
  filterTokenMode.value = 'all';
}

function exportToCsv() {
  filterMenuOpen.value = false;
  const rows = transactions.value;
  const csvHeaders = ['Date', 'Type', 'Amount (ADA)', 'Transaction ID'];
  const csvRows = rows.map(tx => {
    const date = new Date(tx.tx_timestamp * 1000).toISOString();
    const status = transactionStatuses.value[tx.id] || buildBasicStatus(tx);
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
  // Apply date range filter
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
          ('dust'.includes(searchLower) && isDustRegistration(tx)) ||
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
          case 'delegation': return isCardanoTx(tx) && tx.body.certificates?.some(
            c => c.__typename === Cardano.CertificateType.StakeDelegation ||
                 c.__typename === Cardano.CertificateType.StakeRegistrationDelegation
          );
          case 'withdrawal': return isWithdrawal(tx);
          case 'internal': return isInternalTransfer(tx);
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

  // Sort by timestamp descending (most recent first)
  return result.sort((a, b) => b.tx_timestamp - a.tx_timestamp);
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
  const receivedTokenCount = item.assets?.filter((asset) => asset.unit !== 'lovelace' && asset.quantity > 0).length ?? 0;
  const sentTokenCount = item.assets?.filter((asset) => asset.unit !== 'lovelace' && asset.quantity < 0).length ?? 0;
  const hasReceivedTokens = receivedTokenCount > 0;
  const hasSentTokens = sentTokenCount > 0;

  // When tokens are present, a small ADA amount is just the min UTxO locked with the tokens.
  // In that case, label as token-only (e.g. "Received Tokens" instead of "Received Funds & Tokens").
  // TODO: min UTxO threshold (currently 2 ADA) should be derived from protocol params
  // (coinsPerUtxoByte) rather than hardcoded, as it can change with protocol updates.
  const netAdaAbs = Math.abs(item.receivedAmount - item.sentAmount) / 1_000_000;
  const isMinUtxoOnly = netAdaAbs <= 2;

  const receivedTokenLabel = receivedTokenCount === 1 ? t('transactions.receivedToken') : t('transactions.receivedTokens');
  const sentTokenLabel = sentTokenCount === 1 ? t('transactions.sentToken') : t('transactions.sentTokens');
  const receivedFundsAndTokensLabel = receivedTokenCount === 1 ? t('transactions.receivedFundsAndToken') : t('transactions.receivedFundsAndTokens');
  const sentFundsAndTokensLabel = sentTokenCount === 1 ? t('transactions.sentFundsAndToken') : t('transactions.sentFundsAndTokens');

  // Build smart status message
  if (hasReceivedFunds && hasReceivedTokens && isMinUtxoOnly) {
    statuses.push(receivedTokenLabel);
  } else if (hasSentFunds && hasSentTokens && isMinUtxoOnly) {
    statuses.push(sentTokenLabel);
  } else if (hasReceivedFunds && hasReceivedTokens) {
    statuses.push(receivedFundsAndTokensLabel);
  } else if (hasSentFunds && hasSentTokens) {
    statuses.push(sentFundsAndTokensLabel);
  } else if (hasReceivedFunds && hasSentTokens) {
    statuses.push(t('transactions.receivedFundsAndSentTokens'));
  } else if (hasSentFunds && hasReceivedTokens) {
    statuses.push(t('transactions.sentFundsAndReceivedTokens'));
  } else if (hasReceivedFunds) {
    statuses.push(t('transactions.receivedFunds'));
  } else if (hasSentFunds) {
    statuses.push(t('transactions.sentFunds'));
  } else if (hasReceivedTokens) {
    statuses.push(receivedTokenLabel);
  } else if (hasSentTokens) {
    statuses.push(sentTokenLabel);
  }
};

// Build basic transaction status without pool API data
const buildBasicStatus = (item: StoredTransaction): string => {
  const statuses: string[] = [];

  // Bitcoin transaction status (simpler than Cardano)
  if (item.type) {
    // Bitcoin transaction with type field
    switch (item.type) {
      case 'receive':
        return t('transactions.receivedFunds');
      case 'send':
        return t('transactions.sentFunds');
      case 'self':
        return t('transactions.selfTransfer');
      default:
        return t('transactions.transaction');
    }
  }

  // Cardano transaction status (complex with certificates)
  if (isCardanoTx(item) && item.body?.certificates?.length > 0) {
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

    // Preload statuses for new transactions and wait for completion
    if (newTransactions.length > 0) {
      await preloadTransactionStatuses(newTransactions);
      // Bail out if a new search/reset happened during preload
      if (version !== loadVersion.value) return;
    }
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
  if (firstBatch.length > 0) {
    await preloadTransactionStatuses(firstBatch);
  }
  displayedTransactions.value = firstBatch;
  isLoadingMore.value = false;
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

// Watch for filter changes to reset infinite scroll
watch(
  [filterDateFrom, filterDateTo, filterTypes, filterTokenMode],
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

const isStrike = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

// Detects a cNIGHT→DUST registration: it locks its mapping NFT at the DUST
// mapping validator, so a registration has an OUTPUT to the validator address.
// (Deregistration spends that UTxO as an input, so keying on the output keeps
// this registration-specific.)
const isDustRegistration = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  const validator = DUST_MAPPING_VALIDATOR[loggedWallet.value?.network ?? ''];
  if (!validator) return false;
  return item.body.outputs?.some((output) => output.address === validator.address)
    || item.utxo?.outputs?.some((output) => output.address === validator.address)
    || false;
};

// Detects historical DexHunter swap transactions (pre-aggregator-embed migration).
// Displayed with the neutral 'transactions.swap' label since DexHunter is no longer
// the branded swap provider.
// TODO: add aggregator swap-tx heuristic (order/fee address or metadata) once the
// Gero aggregator's on-chain order/fee address is confirmed, so newly created
// aggregator swaps are also tagged here.
const isDexHunter = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isMinswap = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isJpgStore = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isWingRiders = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isVyFi = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  // Check for VyFi metadata message (indicates platform interaction)
  const msg = item.auxiliaryData?.blob?.[674]?.msg;
  return typeof msg === 'string' && msg.includes('VyFi');
};

const isSundaeSwap = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isSplash = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isMuesliSwap = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
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

const isStakeRegistration = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  const certs = item.body?.certificates;
  return (
    (certs?.length ?? 0) > 0 &&
    certs!.some(
      (certificate) =>
        certificate.__typename === Cardano.CertificateType.StakeRegistration ||
        certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation ||
        certificate.__typename === Cardano.CertificateType.Registration
    )
  );
};

const isStakeDeRegistration = (item: StoredTransaction): boolean => {
  if (!isCardanoTx(item)) return false;
  const certs = item.body?.certificates;
  return (
    (certs?.length ?? 0) > 0 &&
    certs!.some(
      (certificate) =>
        certificate.__typename === Cardano.CertificateType.Unregistration ||
        certificate.__typename === Cardano.CertificateType.StakeDeregistration
    )
  );
};

const getColor = (item: StoredTransaction): string => {
  if (item.pending) {
    return 'var(--g-warning)';
  } else if (item.ada > 0) {
    return 'var(--g-success)';
  } else if (item.ada < 0) {
    return 'var(--g-error)';
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
/* ─── TX Liquid Glass Card ──────────────────────────────────── */
.tx-glass-card {
  position: relative;
  background: rgba(255, 255, 255, 0.07) !important;
  backdrop-filter: blur(24px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(24px) saturate(180%) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 22px !important;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.18),
    0 16px 48px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.06) !important;
  transition: box-shadow 0.3s ease !important;
  overflow: hidden;
}

.tx-glass-card:hover {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.22),
    0 24px 60px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(255, 255, 255, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.22),
    inset 0 -1px 0 rgba(0, 0, 0, 0.08) !important;
}

/* ─── Card Title Header ─────────────────────────────────────── */
.tx-card-title {
  border-bottom: 1px solid var(--g-hairline-1) !important;
}

.tx-icon-box {
  width: 30px;
  height: 30px;
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.2);
  border-radius: var(--g-r-control);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.tx-heading-group {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.tx-heading,
.tx-heading-link {
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif !important;
  font-size: 14px !important;
  font-weight: 600 !important;
  letter-spacing: -0.01em !important;
  color: var(--g-text-1) !important;
  text-decoration: none !important;
  line-height: 1 !important;
}

.tx-heading-link:hover {
  color: #F7931A !important;
}

.tx-count {
  font-size: 11px;
  font-weight: 400;
  color: var(--g-text-3);
  line-height: 1;
}

.tx-search-field {
  max-height: 28px;
  max-width: 170px !important;
}

.filter-section-label {
  margin-bottom: 4px;
}

.filter-date-field {
  font-size: 12px !important;
}

.filter-date-field >>> .v-input__slot {
  min-height: 30px !important;
  padding: 0 8px !important;
  align-items: center !important;
}

.filter-date-field >>> .v-input__prepend-inner {
  margin-top: 4px !important;
  margin-right: 4px !important;
  padding-right: 0 !important;
  display: flex !important;
  align-items: center !important;
  height: 100% !important;
}

.filter-date-field >>> .v-input__append-inner {
  margin-top: 4px !important;
  display: flex !important;
  align-items: center !important;
}

.filter-date-field >>> .v-input__append-inner .v-icon {
  font-size: 14px !important;
}

/* Date picker menu styling */
.date-picker-menu {
  border-radius: var(--g-r-card) !important;
  overflow: hidden;
  box-shadow: var(--g-shadow-menu) !important;
}

.filter-date-picker {
  background: var(--g-overlay) !important;
  border-radius: var(--g-r-card) !important;
  border: 1px solid var(--g-hairline-1) !important;
}

.filter-date-picker >>> .v-date-picker-header {
  padding: 8px 16px !important;
  background: transparent !important;
}

.filter-date-picker >>> .v-date-picker-header .v-btn {
  color: var(--g-text-2) !important;
}

.filter-date-picker >>> .v-date-picker-table {
  padding: 0 8px 8px !important;
}

.filter-date-picker >>> .v-date-picker-table .v-btn {
  border-radius: var(--g-r-control) !important;
  color: var(--g-text-2) !important;
}

.filter-date-picker >>> .v-date-picker-table .v-btn:hover {
  background: color-mix(in srgb, var(--g-accent) 8%, transparent) !important;
}

.filter-date-picker >>> .v-btn--active {
  background-color: var(--g-accent) !important;
  color: var(--g-on-grad) !important;
}

.filter-date-picker >>> .v-date-picker-table--date .v-btn--disabled {
  opacity: 0.25 !important;
}

/* Expanding search — grows to the left */
.expanding-search-wrap {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.expanding-search-icon {
  position: absolute;
  right: 6px;
  pointer-events: none;
  color: var(--g-text-1) !important;
  z-index: 1;
  transition: right 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              opacity 0.2s ease;
}

.expanding-search-input {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--g-r-pill);
  padding: 6px;
  background-color: transparent;
  outline: none;
  font-size: 13px;
  color: transparent;
  cursor: pointer;
  transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              padding 0.4s cubic-bezier(0.4, 0, 0.2, 1),
              background-color 0.3s ease,
              color 0.2s ease;
  overflow: hidden;
}

.expanding-search-input::placeholder {
  color: transparent;
  transition: color 0.2s ease;
}

.expanding-search-input:focus {
  width: 180px;
  padding: 6px 12px 6px 30px;
  background-color: var(--g-hairline-1);
  color: var(--g-text-1);
  cursor: text;
}

.expanding-search-input:focus::placeholder {
  color: var(--g-text-3);
}

.expanding-search-wrap:focus-within .expanding-search-icon {
  right: calc(100% - 22px);
  opacity: 0.4;
}

/* Filter type chips */
.filter-type-chip {
  border-color: var(--g-hairline-3) !important;
  color: var(--g-text-2) !important;
}

.filter-type-chip.v-chip--active {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--g-accent) 40%, transparent) !important;
  color: var(--g-accent) !important;
}

.filter-menu .v-chip--active {
  background: color-mix(in srgb, var(--g-accent) 12%, transparent) !important;
  border-color: color-mix(in srgb, var(--g-accent) 40%, transparent) !important;
  color: var(--g-accent) !important;
}

/* ─── Data Table Glass Overrides ────────────────────────────── */
.tx-glass-card >>> .v-data-table__wrapper thead th {
  background: var(--g-hairline-1) !important;
  border-bottom: 1px solid var(--g-hairline-1) !important;
  font-size: 11px !important;
  font-weight: 500 !important;
  letter-spacing: 0.02em !important;
  color: var(--g-text-2) !important;
  font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif !important;
}

.tx-glass-card >>> .v-data-table__wrapper tbody td {
  border-bottom-color: var(--g-hairline-1) !important;
}

/* ─── Pagination Bar ────────────────────────────────────────── */
.tx-pagination-bar {
  border-top: 1px solid var(--g-hairline-1) !important;
  background: var(--g-hairline-1) !important;
  padding: 4px 0 !important;
}

/* ─── Existing Styles ───────────────────────────────────────── */
.text-nowrap {
  text-wrap: nowrap;
}

.transactions-table >>> .no-padding {
  padding: 0 !important;
}
.chips-row {
  overflow: hidden !important;
  white-space: nowrap !important;
  text-overflow: ellipsis !important;
}

.transactions-table >>> table {
  table-layout: fixed !important;
  width: 100% !important;
}


.transactions-table >>> tr.selected-transaction {
  background: var(--g-hairline-2) !important;
}

.transactions-table >>> tr {
  cursor: pointer;
}

.transactions-table >>> tr:hover {
  background: var(--g-hairline-1) !important;
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
  font-size: 11px !important;
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
  color: var(--g-text-2) !important;
}

/* Table container styling */
.table-container {
  max-height: calc(100vh - 227px);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: var(--g-hairline-3) transparent;
}

/* Custom scrollbar styling for webkit browsers */
.table-container::-webkit-scrollbar {
  width: 6px;
}

.table-container::-webkit-scrollbar-track {
  background: transparent;
}

.table-container::-webkit-scrollbar-thumb {
  background-color: var(--g-hairline-3);
  border-radius: 3px;
}

.table-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.28);
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
  font-size: 11px;
  font-weight: 400;
  border-radius: var(--g-r-card);
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
  border-radius: var(--g-r-card);
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
  background-color: var(--g-hairline-1);
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
  font-size: 11px;
  font-weight: 400;
  border-radius: var(--g-r-card);
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
  border-radius: var(--g-r-card);
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
  background-color: var(--g-hairline-1);
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
  font-size: 11px;
  font-weight: 400;
  border-radius: var(--g-r-card);
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
  border-radius: var(--g-r-card);
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
  background-color: var(--g-hairline-1);
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
  background-color: var(--g-warning);
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
  color: var(--g-error) !important;
}
</style>
