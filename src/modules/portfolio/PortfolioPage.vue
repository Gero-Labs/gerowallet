<template>
  <v-layout column>
    <!-- Empty state for wallets with no tokens -->
    <template v-if="isWalletEmpty">
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <EmptyStateHero
            :is-new-user="isNewUser"
            :show-tutorial="isNewUser"
            :should-backup="shouldBackup"
            @buy-crypto="openBuyDialog"
            @show-receive="openReceiveDialog"
            @open-learn="handleOpenLearn"
            @start-tutorial="handleStartTutorial"
            @backup-wallet="handleBackupWallet"
          />
        </v-col>
      </v-row>
    </template>

    <!-- Main unified portfolio + market view -->
    <template v-else>
      <!-- Portfolio Chart (always visible) -->
      <v-row no-gutters class="hero-row">
        <v-col cols="12" xl="9" lg="9" md="8" class="pa-2 hero-chart-col">
          <PortfolioChart
            :chart-data="computeChartData.adaData"
            :chart-data-usd="computeChartData.usdData"
            :chart-data-eur="computeChartData.eurData"
            :ada-only-chart-data="adaOnlyChartData.adaData"
            :ada-only-chart-data-usd="adaOnlyChartData.usdData"
            :ada-only-chart-data-eur="adaOnlyChartData.eurData"
            :portfolio-value-ada="currentPortfolioValues.ada"
            :portfolio-value-usd="currentPortfolioValues.usd"
            :portfolio-value-eur="currentPortfolioValues.eur"
            :ada-only-value-ada="adaBalance"
            :ada-only-value-usd="adaBalance * nativePriceUsd"
            :ada-only-value-eur="adaBalance * nativePriceUsd * usdToEurRate"
            :loading="portfolioLoading"
            :progressive-loading="true"
            :first-loaded-currency="firstLoadedCurrency"
            :total-realized-pnl="isMainnetCardano ? (pnlSummary?.totalRealizedPnlAda ?? null) : null"
            :total-unrealized-pnl="isMainnetCardano ? (pnlSummary?.totalUnrealizedPnlAda ?? null) : null"
            :pnl-incomplete="isMainnetCardano && (pnlSummary?.tokens?.some(to => to.costBasisComplete === false) ?? false)"
            :pnl-loading="isMainnetCardano && pnlLoading"
            @refresh="refreshPortfolioChart"
            @timeframe-change="handleChartTimeframeChange"
            @mode-change="handleChartModeChange"
            @withdraw-rewards="handleWithdrawRewards"
            @delegate-gero="handleDelegateGero"
          />
        </v-col>
        <!-- Recent Transactions compact card (replaces the old FeatureCarousel slot) -->
        <v-col xl="3" lg="3" md="4" class="pa-2 hidden-sm-and-down hero-tx-col">
          <RecentTransactionsCard />
        </v-col>
      </v-row>

      <!-- Filter Chip Bar + Table -->
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <v-card flat class="liquid-glass holdings-table-card">
            <!-- Filter chips + search + filter menu — single row -->
            <div class="filter-toolbar d-flex align-center px-3" style="gap: 6px; padding-top: 6px; padding-bottom: 6px;">
              <!-- Category chips (scrollable, collapse to icons at small widths) -->
              <div ref="chipBarRef" class="filter-chip-bar d-flex align-center flex-shrink-0" style="gap: 4px; overflow-x: auto; min-width: 0;">
                <v-tooltip v-for="chip in filterChips" :key="chip.value" bottom :disabled="!compactChips">
                  <template v-slot:activator="{ on, attrs }">
                    <v-chip
                      small
                      :outlined="activeView !== chip.value"
                      @click="setActiveView(chip.value)"
                      :class="['flex-shrink-0', { 'geroButton': activeView === chip.value }]"
                      style="cursor: pointer"
                      v-bind="attrs"
                      v-on="on"
                    >
                      <v-icon v-if="chip.icon" x-small :class="{ 'mr-1': !compactChips }" :color="activeView === chip.value ? 'black' : undefined">{{ chip.icon }}</v-icon>
                      <template v-if="!compactChips">{{ chip.label }}</template>
                      <span v-if="chip.value === 'watchlist' && watchlistCount > 0" class="ml-1" style="font-size: 11px; opacity: 0.7;">({{ watchlistCount }})</span>
                    </v-chip>
                  </template>
                  <span>{{ chip.label }}</span>
                </v-tooltip>
              </div>

              <!-- Visible search bar (primary) — sits left, right after the chips -->
              <v-text-field
                v-model="searchQuery"
                :placeholder="activeView === 'collectibles'
                  ? $t('assets.searchCollections')
                  : $t('market.searchPlaceholder')"
                prepend-inner-icon="mdi-magnify"
                dense flat solo rounded hide-details clearable
                background-color="rgba(255,255,255,0.04)"
                class="header-search"
              />

              <v-spacer />

              <!-- NFT view toggle (only in collectibles mode) -->
              <div v-if="activeView === 'collectibles'" class="d-flex align-center flex-shrink-0" style="gap: 2px;">
                <v-btn icon x-small :class="{ 'mode-active': nftViewMode === 'table' }" class="mode-btn" @click="nftViewMode = 'table'">
                  <v-icon small>mdi-table</v-icon>
                </v-btn>
                <v-btn icon x-small :class="{ 'mode-active': nftViewMode === 'gallery' }" class="mode-btn" @click="nftViewMode = 'gallery'">
                  <v-icon small>mdi-view-grid</v-icon>
                </v-btn>
              </div>

              <!-- Live indicator -->
              <v-tooltip v-if="isMainnetCardano" bottom content-class="custom-tooltip">
                <template v-slot:activator="{ on, attrs }">
                  <div class="live-indicator flex-shrink-0 d-flex align-center" v-bind="attrs" v-on="on">
                    <span class="live-dot" :class="{ 'live-dot--active': marketWsConnected }"></span>
                    <span class="live-label" :class="{ 'live-label--active': marketWsConnected }">LIVE</span>
                  </div>
                </template>
                <span>{{ marketWsConnected ? $t('market.liveUpdates') : $t('market.connecting') }}</span>
              </v-tooltip>

              <!-- Unified filter menu (filters + columns) -->
              <v-menu
                v-model="filterMenuOpen"
                offset-y
                left
                :close-on-content-click="false"
                nudge-bottom="4"
                content-class="filter-panel-menu"
                eager
                transition="none"
              >
                <template v-slot:activator="{ on, attrs }">
                  <v-btn icon small v-bind="attrs" v-on="on" class="flex-shrink-0 filter-menu-btn">
                    <v-badge :value="!verifiedOnly || !hideScam || !showSnekfun || (!isApex && hasCustomColumns)" dot color="primary" overlap>
                      <v-icon small>mdi-tune</v-icon>
                    </v-badge>
                  </v-btn>
                </template>
                <v-card flat class="liquid-glass-dialog">
                  <!-- Filters -->
                  <v-list dense class="transparent pa-0">
                    <v-list-item v-if="activeView !== 'collectibles'" @click="verifiedOnly = !verifiedOnly">
                      <v-list-item-action class="mr-2">
                        <v-icon small :color="verifiedOnly ? 'primary' : ''">
                          {{ verifiedOnly ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                        </v-icon>
                      </v-list-item-action>
                      <v-list-item-title style="font-size: 13px;">{{ $t('market.verifiedOnly') }}</v-list-item-title>
                    </v-list-item>
                    <v-list-item @click="hideScam = !hideScam">
                      <v-list-item-action class="mr-2">
                        <v-icon small :color="hideScam ? 'primary' : ''">
                          {{ hideScam ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                        </v-icon>
                      </v-list-item-action>
                      <v-list-item-title style="font-size: 13px;">{{ $t('market.hideScam') }}</v-list-item-title>
                    </v-list-item>
                    <!-- Graduated snek.fun tokens: show inline in the market list (like verified-only) -->
                    <v-list-item v-if="activeView !== 'collectibles'" @click="showSnekfun = !showSnekfun">
                      <v-list-item-action class="mr-2">
                        <v-icon small :color="showSnekfun ? 'primary' : ''">
                          {{ showSnekfun ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                        </v-icon>
                      </v-list-item-action>
                      <v-list-item-title style="font-size: 13px;">
                        <v-icon x-small color="#A3E635" class="mr-1">mdi-snake</v-icon>{{ $t('market.snekfun') }}
                      </v-list-item-title>
                    </v-list-item>

                    <!-- Column preferences (Cardano only) -->
                    <template v-if="!isApex">
                      <v-divider class="my-1 mx-3" style="opacity: 0.15;" />
                      <v-subheader style="height: 28px; font-size: 11px;">{{ $t('market.columns') }}</v-subheader>
                      <v-list-item
                        v-for="col in columnOptions"
                        :key="col.key"
                        @click="toggleColumn(col.key)"
                        dense
                      >
                        <v-list-item-action class="mr-2">
                          <v-icon small :color="columnPrefs[col.key] ? 'primary' : ''">
                            {{ columnPrefs[col.key] ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                          </v-icon>
                        </v-list-item-action>
                        <v-list-item-title style="font-size: 13px;">{{ col.label }}</v-list-item-title>
                      </v-list-item>
                      <v-divider class="my-1 mx-3" style="opacity: 0.15;" />
                      <v-list-item dense @click="resetToDefaults">
                        <v-list-item-title style="font-size: 12px; color: #7c4dff;">
                          {{ $t('market.resetColumns') }}
                        </v-list-item-title>
                      </v-list-item>
                    </template>
                  </v-list>
                </v-card>
              </v-menu>
            </div>

            <!-- Market overview stat bar (market view only) -->
            <MarketStatBar
              v-if="activeView === 'market' && isMainnetCardano && marketStatTokens.length"
              :tokens="marketStatTokens"
              @token-click="openTokenByUnit"
            />

            <!-- Token table (all views except collectibles) -->
            <MarketTokenTable
              v-if="activeView !== 'collectibles'"
              :tokens="displayedTokens"
              :show-holdings-columns="activeView === 'holdings'"
              :show-owned-badge="activeView !== 'holdings'"
              :loading="isMainnetCardano && marketLoading"
              :pnl-loading="isMainnetCardano && pnlLoading"
              @token-click="openToken"
            />

            <!-- Collectibles: Table view (default) -->
            <NftCollectionTable
              v-else-if="nftViewMode === 'table'"
              :hide-scam="hideScam"
              @collection-click="openNftCollection"
            />

            <!-- Collectibles: Gallery view -->
            <CollectiblesTab
              v-else
              :hide-scam="hideScam"
              :search-term="debouncedSearchQuery"
              sort-by="quantity_desc"
            />

            <!-- NFT Dialog (for table view clicks) -->
            <TokensDialog @close="nftDialogData = null" :modalData="nftDialogData" />
          </v-card>
        </v-col>
      </v-row>

      <!-- Token Detail Panel (overlay) -->
      <div class="market-content">
        <TokenDetailPanel
          v-if="panelOpen && selectedToken"
          :token="selectedToken"
          @close="panelOpen = false"
          @swap="openSwap"
        />
      </div>

      <!-- Swap Dialog -->
      <SwapDialog :isOpen="swapDialogOpen" @close="swapDialogOpen = false; swapToken = null" :buy-token-unit="swapToken?.unit" />

      <!-- Withdrawal Dialog -->
      <WithdrawalDialog :isOpen="withdrawalDialog" :tx="withdrawalTxData" @close="closeWithdrawalDialog" />

      <!-- Delegate Dialog -->
      <DelegateDialog :isOpen="isDelegateDialogOpen" :pool="selectedPool" :tx="delegateTxData" @close="closeDelegateDialog" />
    </template>
  </v-layout>
</template>

<script setup lang="ts">
import { ref, computed, watch, toRefs, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';
import { useMarketData, type MarketToken } from '@/modules/market/composables/useMarketData';
import { useWatchlist } from '@/modules/market/composables/useWatchlist';
import { useWalletPnl } from '@/modules/market/composables/useWalletPnl';
import { useColumnPreferences, type ColumnKey } from '@/modules/market/composables/useColumnPreferences';
import { usePortfolioData } from '@/shared/composables/usePortfolioData';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useWithdrawal } from '@/shared/composables/useWithdrawal';
import { useDelegation } from '@/shared/composables/useDelegation';
import { useNativeCurrency } from '@/modules/market/composables/useNativeCurrency';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';
import { priceStore } from '@/stores/priceStore';
import { coinGeckoStore } from '@/stores/coinGeckoStore';
import { Blockchain, Network } from '@/models/types';
import { getBalance } from '@/chrome/serialization';
import { isNewUser as checkNewUser } from '@/modules/dashboard/utils/emptyStateConfigs';

// Components
import PortfolioChart from '@/modules/dashboard/components/PortfolioChart.vue';
import RecentTransactionsCard from '@/modules/dashboard/components/RecentTransactionsCard.vue';
import EmptyStateHero from '@/modules/dashboard/components/EmptyStateHero.vue';
import MarketTokenTable from '@/modules/market/components/MarketTokenTable.vue';
import MarketStatBar from '@/modules/market/components/MarketStatBar.vue';
import TokenDetailPanel from '@/modules/market/components/TokenDetailPanel.vue';
import CollectiblesTab from '@/modules/assets/components/CollectiblesTab.vue';
import NftCollectionTable from '@/modules/market/components/NftCollectionTable.vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import WithdrawalDialog from '@/modules/staking/dialogs/WithdrawalDialog.vue';
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import assets from '@/utils/assets';
import networks from '@/utils/networks';

const { t } = useTranslation();
const instance = getCurrentInstance();

// ── Composables ───────────────────────────────────────────────────────────────

const { openBuyDialog, openReceiveDialog } = useQuickActionDialogs();
const {
  allTokens,
  snekTokens,
  loading: marketLoading,
  wsConnected: marketWsConnected,
} = useMarketData();
const { isWatched, watchlistCount } = useWatchlist();
const { pnlSummary, pnlLoading, fetchPnl, getTokenPnl } = useWalletPnl();
const { usdToEurRate, loadExchangeRate } = useCurrencyConverter();
const { currencyName: nativeCurrencyName, currencyTicker: nativeCurrencyTicker } = useNativeCurrency();
const { columns: columnPrefs, hasCustomColumns, toggleColumn, resetToDefaults } = useColumnPreferences();

const columnOptions = computed<{ key: ColumnKey; label: string }[]>(() => {
  const opts: { key: ColumnKey; label: string }[] = [
    { key: 'change1h', label: t('market.change1h') },
    { key: 'change24h', label: t('market.change24h') },
    { key: 'change7d', label: t('market.change7d') },
    { key: 'change30d', label: t('market.change30d') },
    { key: 'sparkline', label: t('market.sparkline') },
    { key: 'volume24h', label: t('market.volume24h') },
    { key: 'volume7d', label: t('market.volume7d') },
    { key: 'txnCount24h', label: t('market.txnCount') },
    { key: 'makerCount24h', label: t('market.makerCount') },
    { key: 'totalSupply', label: t('market.totalSupply') },
    { key: 'mcap', label: t('market.marketCap') },
    { key: 'tvl', label: t('market.liquidity') },
    { key: 'allocation', label: t('common.allocation') },
  ];
  // Avg cost + P&L only apply to the holdings view (per-holding metrics).
  if (activeView.value === 'holdings') {
    opts.push(
      { key: 'avgCostBasis', label: t('market.avgCost') },
      { key: 'totalPnl', label: t('market.totalPnl') },
    );
  }
  return opts;
});

const { txData: withdrawalTxData, withdrawalDialog, withdraw: withdrawRewards, closeWithdrawalDialog } = useWithdrawal();
const { selectedPool, txData: delegateTxData, isDelegateDialogOpen, delegateToGero, closeDelegateDialog } = useDelegation();

// ── Store refs ────────────────────────────────────────────────────────────────

const { loggedWallet, transactions, account, utxos, collateral, collections, tokens: walletTokens } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { portfolio } = toRefs(tapToolsStore);

// ── Portfolio Data ────────────────────────────────────────────────────────────

const {
  adaData: adaChartData,
  usdData: usdChartData,
  eurData: eurChartData,
  isLoading: portfolioLoading,
  refreshPortfolioData,
  loadForTimeframe,
  firstLoadedCurrency,
  latestPortfolioValues,
} = usePortfolioData();

// ── UI State ──────────────────────────────────────────────────────────────────

const isMainnetCardano = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET
);

type ViewMode = 'holdings' | 'collectibles' | 'market' | 'watchlist' | 'snekfun';
const activeView = ref<ViewMode>('holdings');

// Compact chip mode — collapse labels to icons when space is tight
const compactChips = ref(false);
const chipBarRef = ref<HTMLElement | null>(null);
let chipBarObserver: ResizeObserver | null = null;

function setActiveView(view: ViewMode) {
  activeView.value = view;
  // Sync to URL for shareable links and back/forward navigation
  const router = instance?.proxy?.$router;
  const currentView = instance?.proxy?.$route?.query?.['view'];
  if (router && currentView !== view) {
    router.replace({ query: { view } }).catch(() => {});
  }
}

const searchQuery = ref('');
const filterMenuOpen = ref(false);
const verifiedOnly = ref(true);
const hideScam = ref(true);
// Graduated snek.fun tokens shown inline in the market list (toggle, default on)
const showSnekfun = ref(true);
const nftViewMode = ref<'table' | 'gallery'>('table');
const nftDialogData = ref<Record<string, unknown> | null>(null);
const selectedToken = ref<MarketToken | null>(null);
const panelOpen = ref(false);
const swapDialogOpen = ref(false);
const swapToken = ref<MarketToken | null>(null);
const currentTimestamp = ref(Date.now());

// ── Debounced search ──────────────────────────────────────────────────────────

let searchDebounce: ReturnType<typeof setTimeout> | null = null;
const debouncedSearchQuery = ref('');
watch(searchQuery, (val) => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { debouncedSearchQuery.value = val || ''; }, 300);
});

// ── Computed: Empty state & staking ───────────────────────────────────────────

const isWalletEmpty = computed(() => !account.value || account.value?.controlled_amount === '0');
const isNewUser = computed(() => checkNewUser(transactions.value, account.value));
const shouldBackup = computed(() => {
  const config = walletStore.config;
  return config && 'backup' in config && !config.backup;
});

// ── Computed: Portfolio values (ported from Dashboard.vue) ────────────────────

const nativePriceUsd = computed(() => {
  if (isApex.value) {
    return coinGeckoStore.cache['apex-4']?.usd ?? 0;
  }
  // Prefer market API price (same source as holdings), fallback to networkStore
  const marketAdaPrice = allTokens.value.find(t => t.unit === 'lovelace')?.price;
  return marketAdaPrice || Number(price.value?.lastPrice) || 0;
});

const adaBalance = computed(() => {
  return Number(getBalance(utxos.value, collateral.value).coin().toString()) / 1000000;
});

const computedValues = computed(() => {
  let assetsValue = 0;
  if (portfolio.value?.positionsFt) {
    portfolio.value.positionsFt.forEach((position: { adaValue: number }) => { assetsValue += position.adaValue; });
  }
  if (account.value?.controlled_amount && Number(account.value.controlled_amount) > 0) {
    assetsValue += Number(account.value.controlled_amount) / 1000000;
  }
  let totalValue;
  if (portfolio.value?.adaValue) {
    totalValue = portfolio.value.adaValue;
  } else {
    totalValue = Number(getBalance(utxos.value, collateral.value).coin().toString()) / 1000000;
  }
  return { totalValue, assetsValue };
});

// Build ADA-only chart data from transaction history (works for all networks)
const adaOnlyChartData = computed(() => {
  const empty = { adaData: [] as number[][], usdData: [] as number[][], eurData: [] as number[][] };
  if (!transactions.value || transactions.value.length === 0) return empty;

  const graphData: number[][] = [];
  const usdData: number[][] = [];
  const eurData: number[][] = [];
  const sortedTransactions = [...transactions.value].sort((a: { tx_timestamp: number }, b: { tx_timestamp: number }) => a.tx_timestamp - b.tx_timestamp);
  const now = currentTimestamp.value;
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
  const firstTxTimestamp = sortedTransactions[0].tx_timestamp * 1000;
  graphData.push([oneYearAgo, 0]);
  usdData.push([oneYearAgo, 0]);
  eurData.push([oneYearAgo, 0]);
  if (firstTxTimestamp > oneYearAgo) {
    const weekInMs = 7 * 24 * 60 * 60 * 1000;
    let currentTime = oneYearAgo + weekInMs;
    while (currentTime < firstTxTimestamp) {
      graphData.push([currentTime, 0]);
      usdData.push([currentTime, 0]);
      eurData.push([currentTime, 0]);
      currentTime += weekInMs;
    }
    graphData.push([firstTxTimestamp - 1000, 0]);
    usdData.push([firstTxTimestamp - 1000, 0]);
    eurData.push([firstTxTimestamp - 1000, 0]);
  }
  let currentBalance = 0;
  sortedTransactions.forEach((tx: { ada: number; tx_timestamp: number }) => {
    currentBalance += tx.ada;
    const balanceInAda = currentBalance / 1000000;
    const timestamp = tx.tx_timestamp * 1000;
    graphData.push([timestamp, balanceInAda]);
    const balanceInUsd = balanceInAda * nativePriceUsd.value;
    usdData.push([timestamp, balanceInUsd]);
    eurData.push([timestamp, balanceInUsd * usdToEurRate.value]);
  });
  const lastTxTimestamp = sortedTransactions[sortedTransactions.length - 1].tx_timestamp * 1000;
  const lastBalance = currentBalance / 1000000;
  if (now - lastTxTimestamp > 7 * 24 * 60 * 60 * 1000) {
    const weekInMs = 7 * 24 * 60 * 60 * 1000;
    let currentTime = lastTxTimestamp + weekInMs;
    while (currentTime < now) {
      graphData.push([currentTime, lastBalance]);
      const balanceUsd = lastBalance * nativePriceUsd.value;
      usdData.push([currentTime, balanceUsd]);
      eurData.push([currentTime, balanceUsd * usdToEurRate.value]);
      currentTime += weekInMs;
    }
  }
  graphData.push([now, lastBalance]);
  const currentBalanceUsd = lastBalance * nativePriceUsd.value;
  usdData.push([now, currentBalanceUsd]);
  eurData.push([now, currentBalanceUsd * usdToEurRate.value]);
  return { adaData: graphData, usdData, eurData };
});

const computeChartData = computed(() => {
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    return { adaData: adaChartData.value, usdData: usdChartData.value, eurData: eurChartData.value };
  }
  // Non-mainnet: full portfolio IS ada-only (no token portfolio tracking)
  return adaOnlyChartData.value;
});

// Live portfolio value computed from holdings (reactive to balance + price changes)
const currentPortfolioValues = computed(() => {
  const totalUsd = myHoldings.value.reduce((sum, t) => sum + (t.value || 0), 0);
  const adaPriceUsd = nativePriceUsd.value;
  const totalAda = adaPriceUsd > 0 ? totalUsd / adaPriceUsd : adaBalance.value;
  const totalEur = totalUsd * usdToEurRate.value;
  return { ada: totalAda, usd: totalUsd, eur: totalEur };
});

// ── Computed: Holdings (wallet tokens enriched with market data + P&L) ────────

const myHoldings = computed<MarketToken[]>(() => {
  const tokens = walletTokens.value || {};
  const adaPriceUsd = isApex.value
    ? (coinGeckoStore.cache['apex-4']?.usd ?? 0)
    : (priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0);
  const dhTokens = tokenMetadataStore.tokens || {};
  const holdings: MarketToken[] = [];

  Object.entries(tokens).forEach(([unit, token]: [string, { quantity?: number | string; amount?: string; name?: string; policy_id?: string; metadata?: { name?: string; ticker?: string; decimals?: number } }]) => {
    if (!token.quantity || Number(token.quantity) <= 0) return;

    const decimals = token.metadata?.decimals || 0;
    const rawQuantity = Number(token.quantity);
    const quantity = decimals > 0 ? rawQuantity / Math.pow(10, decimals) : rawQuantity;

    // Find in market data for enrichment
    const marketToken = allTokens.value.find(t => t.unit === unit);
    const dhToken = dhTokens[unit];

    // Price: prefer market API data, then DexHunter fallback
    let priceUsd = marketToken?.price || 0;
    let priceAda = marketToken?.priceAda || 0;

    const isNativeToken = unit === 'lovelace' || token.policy_id === '';
    if (isNativeToken) {
      priceUsd = adaPriceUsd;
      priceAda = 1;
    } else if (!priceUsd && dhToken?.price) {
      priceAda = dhToken.price;
      priceUsd = priceAda * adaPriceUsd;
    }

    const value = quantity * priceUsd;

    // P&L data from wallet P&L composable (mainnet Cardano only, not applicable for native ADA)
    const pnl = (isMainnetCardano.value && !isNativeToken) ? getTokenPnl(unit) : null;

    holdings.push({
      unit,
      name: marketToken?.name || token.name || token.metadata?.name || (isNativeToken ? nativeCurrencyName.value : unit),
      ticker: marketToken?.ticker || token.metadata?.ticker || (isNativeToken ? nativeCurrencyTicker.value : ''),
      img: marketToken?.img || (token as { img?: string }).img || '',
      verified: marketToken?.verified ?? dhToken?.verified ?? isNativeToken,
      price: priceUsd,
      priceAda,
      priceEur: marketToken?.priceEur ?? 0,
      change1h: marketToken?.change1h || 0,
      change24h: marketToken?.change24h || 0,
      change7d: marketToken?.change7d || 0,
      change30d: marketToken?.change30d || 0,
      volume24h: marketToken?.volume24h || 0,
      volume7d: marketToken?.volume7d || 0,
      txnCount24h: marketToken?.txnCount24h ?? null,
      makerCount24h: marketToken?.makerCount24h ?? null,
      totalSupply: marketToken?.totalSupply ?? null,
      sparkline: marketToken?.sparkline ?? [],
      mcap: marketToken?.mcap ?? null,
      tvl: marketToken?.tvl || null,
      liquidity: marketToken?.liquidity || 0,
      holders: marketToken?.holders ?? dhToken?.holders ?? null,
      isNew: false,
      policyLocked: true,
      fingerprint: marketToken?.fingerprint || dhToken?.fingerprint || '',
      decimals: marketToken?.decimals ?? dhToken?.decimals ?? decimals,
      balance: quantity,
      value,
      allocation: value,
      avgCostBasis: pnl?.avgCostBasisAda ?? null,
      totalPnl: pnl ? pnl.realizedPnlAda + pnl.unrealizedPnlAda : null,
      realizedPnl: pnl?.realizedPnlAda ?? null,
      unrealizedPnl: pnl?.unrealizedPnlAda ?? null,
      isNative: isNativeToken,
    });
  });

  // Sort: native token pinned to top, then by value descending
  holdings.sort((a, b) => {
    if (a.unit === 'lovelace' || a.isNative) return -1;
    if (b.unit === 'lovelace' || b.isNative) return 1;
    return (b.value || 0) - (a.value || 0);
  });

  return holdings;
});

// ── Computed: Filter chips ─────────────────────────────────────────────────────

const filterChips = computed(() => {
  const chips = [
    { value: 'holdings' as ViewMode, label: t('portfolio.myHoldings'), icon: 'mdi-wallet' },
    { value: 'collectibles' as ViewMode, label: t('portfolio.collectibles'), icon: 'mdi-image-multiple' },
  ];
  // Market tabs only available on Cardano Mainnet
  if (isMainnetCardano.value) {
    chips.push(
      { value: 'market' as ViewMode, label: t('navigation.market'), icon: 'mdi-chart-line' },
      { value: 'watchlist' as ViewMode, label: t('portfolio.watchlist'), icon: 'mdi-star' },
    );
  }
  return chips;
});

const watchlistedTokens = computed(() => allTokens.value.filter(tok => isWatched(tok.unit)));

// Market overview stat bar: aggregate over all listed (non-native) market tokens
const marketStatTokens = computed(() => allTokens.value.filter(t => !t.isNative));

// ── Computed: Unified displayed tokens ────────────────────────────────────────

const displayedTokens = computed(() => {
  let tokens: MarketToken[];

  switch (activeView.value) {
    case 'holdings':
      tokens = myHoldings.value;
      break;
    case 'market':
      tokens = allTokens.value.filter(t => !t.isNative);
      // Graduated snek.fun tokens already live in the main list (rich data, flagged
      // isSnekFun); snekTokens adds the remaining bonding-curve tokens. The snek.fun
      // toggle (default on) controls visibility of ALL snek-origin tokens.
      if (showSnekfun.value) {
        tokens = [...tokens, ...snekTokens.value];
      } else {
        tokens = tokens.filter(t => !t.isSnekFun);
      }
      break;
    case 'watchlist':
      tokens = watchlistedTokens.value;
      break;
    case 'snekfun':
      // All snek.fun-origin tokens: graduated ones from the main list (rich data) +
      // pre-graduation bonding-curve ones from the snek feed.
      tokens = [...allTokens.value.filter(t => t.isSnekFun && !t.isNative), ...snekTokens.value];
      break;
    case 'collectibles':
      // Collectibles use NftCollectionTable, not MarketTokenTable
      tokens = [];
      break;
    default:
      tokens = myHoldings.value;
  }

  // Apply search filter
  if (debouncedSearchQuery.value) {
    const q = debouncedSearchQuery.value.toLowerCase();
    tokens = tokens.filter(tok =>
      tok.name?.toLowerCase().includes(q) ||
      tok.ticker?.toLowerCase().includes(q) ||
      tok.unit?.toLowerCase().includes(q)
    );
  }

  // Apply verified / scam filters — but NEVER strip snek.fun tokens (bonding-curve
  // tokens are inherently unverified) or apply these on the snek.fun tab itself.
  // TODO(product): hideScam is verified-only after Xerberus removal.
  if (activeView.value !== 'snekfun') {
    if (verifiedOnly.value) {
      tokens = tokens.filter(tok => tok.verified || tok.isSnekFun);
    }
    if (hideScam.value) {
      tokens = tokens.filter(tok => tok.verified || tok.isSnekFun);
    }
  }

  // Dedupe by unit — a token can appear in both the registered market list and the
  // snek.fun feed (and the snek feed can list the same token more than once).
  const seen = new Set<string>();
  tokens = tokens.filter(t => {
    if (seen.has(t.unit)) return false;
    seen.add(t.unit);
    return true;
  });

  return tokens;
});

// ── Actions ───────────────────────────────────────────────────────────────────

let skipNextOutsideClose = false;

function openToken(token: MarketToken) {
  // No detail panel for Apex wallets — no Cardano DEX data available
  if (isApex.value) return;
  selectedToken.value = token;
  panelOpen.value = true;
  skipNextOutsideClose = true;
}

function openTokenByUnit(unit: string) {
  const token = allTokens.value.find(t => t.unit === unit);
  if (token) {
    selectedToken.value = token;
    panelOpen.value = true;
    skipNextOutsideClose = true;
  }
}

function openNftCollection(policyId: string) {
  const col = (collections.value || {})[policyId];
  if (col) {
    nftDialogData.value = col;
  }
}

function openSwap(token: MarketToken) {
  swapToken.value = token;
  swapDialogOpen.value = true;
}

function handleOutsideClick(e: MouseEvent) {
  if (!panelOpen.value) return;
  if (skipNextOutsideClose) {
    skipNextOutsideClose = false;
    return;
  }
  const panel = document.querySelector('.token-detail-panel');
  if (panel && panel.contains(e.target as HTMLElement)) return;
  panelOpen.value = false;
}

function handleOpenLearn() {
  window.open('https://docs.gerowallet.io', '_blank');
}

function handleStartTutorial() {
  // placeholder
}

function handleBackupWallet() {
  instance?.proxy?.$emit('open-backup-dialog');
}

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME || loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

async function refreshPortfolioChart() {
  const address = loggedWallet.value?.baseAddress;
  if (address && !isApex.value) {
    await refreshPortfolioData(address);
  }
}

function handleWithdrawRewards() {
  withdrawRewards();
}

function handleDelegateGero() {
  delegateToGero();
}

// Read persisted chart settings so API calls match the UI toggle state
function getPersistedChartSettings(walletId: number | undefined) {
  if (!walletId) return { adaOnly: false, timeframe: '7d' };
  const uiToApi: Record<string, string> = { DAY: '24h', WEEK: '7d', MONTH: '30d', QUARTER: '90d', YEAR: '1y' };
  const mode = localStorage.getItem(`portfolioMode_${walletId}`) || 'full';
  const uiTimeframe = localStorage.getItem(`portfolioTab_${walletId}`) || 'WEEK';
  return { adaOnly: mode === 'ada-only', timeframe: uiToApi[uiTimeframe] || '7d' };
}

// Track current chart settings for cross-handler re-fetches
let currentTimeframe = '7d';
let currentAdaOnly = false;

async function handleChartTimeframeChange(timeframe: string) {
  const address = loggedWallet.value?.baseAddress;
  if (!address || isApex.value) return;

  currentTimeframe = timeframe;
  await loadForTimeframe(address, timeframe, currentAdaOnly);
}

async function handleChartModeChange(adaOnly: boolean) {
  const address = loggedWallet.value?.baseAddress;
  if (!address || isApex.value) return;

  currentAdaOnly = adaOnly;
  await loadForTimeframe(address, currentTimeframe, adaOnly);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
  loadExchangeRate();
  if (isMainnetCardano.value) {
    fetchPnl();
  }

  // Watch chip bar width — go compact when content would overflow
  if (chipBarRef.value) {
    // Compact chips to icons ONLY when the toolbar is genuinely narrow. Observe
    // the toolbar (the chip bar's parent) against a fixed threshold — measuring
    // the chip bar's own width was self-referential: it collapses when compact,
    // so it could never re-expand and got stuck in icon mode at fine resolutions.
    const COMPACT_BELOW = 560; // px — show full chip labels at/above this width
    const target = chipBarRef.value.parentElement ?? chipBarRef.value;
    chipBarObserver = new ResizeObserver(([entry]) => {
      compactChips.value = entry.contentRect.width < COMPACT_BELOW;
    });
    chipBarObserver.observe(target);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick);
  if (searchDebounce) clearTimeout(searchDebounce);
  chipBarObserver?.disconnect();
});

// ── Watchers ──────────────────────────────────────────────────────────────────

watch(() => transactions.value?.length, () => { currentTimestamp.value = Date.now(); });

watch(
  () => loggedWallet.value?.baseAddress,
  async (newAddress, oldAddress) => {
    if (newAddress && newAddress !== oldAddress) {
      currentTimestamp.value = Date.now();
      if (!isApex.value) {
        try {
          if (account && Number(account.value?.controlled_amount) > 0 &&
            loggedWallet.value?.chain === Blockchain.CARDANO &&
            loggedWallet.value?.network === Network.MAINNET) {
            const settings = getPersistedChartSettings(loggedWallet.value?.id);
            currentTimeframe = settings.timeframe;
            currentAdaOnly = settings.adaOnly;
            loadForTimeframe(newAddress, settings.timeframe, settings.adaOnly).catch(error => {
              console.warn('Portfolio data loading failed:', error);
            });
          }
        } catch (error) {
          console.warn('Failed to start portfolio data loading:', error);
        }
      }
    }
  },
  { immediate: true }
);

// Handle /?view= deep-link and nav drawer clicks
const validViews: ViewMode[] = ['holdings', 'collectibles', 'market', 'watchlist'];
watch(
  () => instance?.proxy?.$route?.query?.['view'],
  (view) => {
    if (view && validViews.includes(view as ViewMode)) {
      activeView.value = view as ViewMode;
    }
    // Legacy support: ?tab=market maps to 'all'
    const tab = instance?.proxy?.$route?.query?.['tab'];
    if (tab === 'market') {
      activeView.value = 'market';
    }
  },
  { immediate: true }
);

// Cardano unit/policyId validation — only hex characters, reasonable length
const CARDANO_ID_RE = /^[0-9a-f]{1,120}$/i;

// Handle /?token=<unit> deep-link (e.g. from Global Search)
watch(
  () => instance?.proxy?.$route?.query?.['token'],
  (unit) => {
    if (unit && typeof unit === 'string' && CARDANO_ID_RE.test(unit)) {
      openTokenByUnit(unit);
    }
  },
  { immediate: true }
);

// Handle /?nft=<policyId> deep-link
watch(
  () => instance?.proxy?.$route?.query?.['nft'],
  (policyId) => {
    if (policyId && typeof policyId === 'string' && CARDANO_ID_RE.test(policyId)) {
      openNftCollection(policyId);
    }
  },
  { immediate: true }
);
</script>

<style scoped>
/* ── Filter toolbar (single row: chips + search + menu) ──────────────────────── */

.filter-toolbar {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.filter-chip-bar {
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
}

.filter-chip-bar .v-chip {
  flex-shrink: 0;
  cursor: pointer;
  height: 28px !important;
}

/* ── Visible header search ────────────────────────────────────────────────────── */

.header-search {
  flex: 1 1 auto;
  min-width: 220px;   /* enough for the full "Search tokens by name" placeholder */
  max-width: 440px;
}

/* A Vuetify solo field defaults to ~48px via .v-input__control — override both
   the control and the slot so the field height matches the 34px chips. */
.header-search ::v-deep .v-input__control,
.header-search ::v-deep .v-input__slot {
  min-height: 28px !important;
  height: 28px !important;
}

.header-search ::v-deep .v-input__slot {
  border-radius: 8px !important;
  padding: 0 12px !important;
}

.header-search ::v-deep input {
  font-size: 12px;
}

.header-search ::v-deep input::placeholder {
  font-size: 12px;
  opacity: 0.5;
}

.header-search ::v-deep .v-input__prepend-inner {
  margin-top: 0 !important;
  align-self: center;
}

.header-search ::v-deep .v-input__prepend-inner .v-icon {
  font-size: 18px;
  opacity: 0.55;
}

.header-search ::v-deep .v-input__icon--clear .v-icon {
  font-size: 16px;
}

/* On narrow widths let the search shrink rather than force a fixed tiny width */
@media (max-width: 600px) {
  .header-search {
    min-width: 130px;
  }
}

/* ── Holdings mode toggle ─────────────────────────────────────────────────── */

.mode-btn {
  opacity: 0.4;
  transition: all 0.2s ease;
}

.mode-btn.mode-active {
  opacity: 1;
  color: #00c7f3 !important;
}

.mode-btn:hover:not(.v-btn--disabled) {
  opacity: 0.8;
}

/* ── Hero Row: Portfolio + Transactions same height ──────────────────────────── */

.hero-row {
  align-items: stretch;
}

.hero-chart-col {
  height: 210px;
}

.hero-tx-col {
  height: 210px;
  overflow: hidden;
}


/* ── Holdings table card ──────────────────────────────────────────────────────── */

.holdings-table-card ::v-deep .v-data-table {
  background: transparent;
}

.holdings-table-card ::v-deep .v-data-table-header th {
  background: rgba(10, 14, 20, 0.8);
  backdrop-filter: blur(10px);
  color: rgba(255, 255, 255, 0.5) !important;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-weight: 600;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;
}

.holdings-table-card ::v-deep tbody tr {
  transition: background 0.15s ease;
}

.holdings-table-card ::v-deep tbody tr:hover {
  background: rgba(0, 199, 243, 0.04) !important;
}

.holdings-table-card ::v-deep tbody tr td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
}

/* Monospace numbers in holdings */
.holdings-table-card ::v-deep td.text-right {
  font-family: 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* ── Search popover ─────────────────────────────────────────────────────────── */

/* ── Filter menu button ──────────────────────────────────────────────────────── */

.filter-menu-btn {
  transition: background 0.2s ease;
}

.filter-menu-btn:hover {
  background: rgba(255, 255, 255, 0.06) !important;
}

/* ── Live indicator ──────────────────────────────────────────────────────────── */

.live-indicator {
  gap: 4px;
  cursor: default;
  user-select: none;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  transition: background 0.3s ease;
}

.live-dot--active {
  background: #47CD89;
  box-shadow: 0 0 6px rgba(71, 205, 137, 0.6);
  animation: livePulse 2s ease-in-out infinite;
}

.live-label {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.25);
  transition: color 0.3s ease;
}

.live-label--active {
  color: #47CD89;
}

@keyframes livePulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* ── Token detail panel positioning ──────────────────────────────────────────── */

.market-content {
  position: relative;
}

/* ── Skeleton shimmer ────────────────────────────────────────────────────────── */

.skeleton-line {
  background: linear-gradient(90deg,
    rgba(255, 255, 255, 0.04) 25%,
    rgba(255, 255, 255, 0.08) 50%,
    rgba(255, 255, 255, 0.04) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.2s ease infinite;
  border-radius: 4px;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── Responsive ──────────────────────────────────────────────────────────────── */

@media (max-width: 960px) {
  .hero-chart-col {
    height: auto;
  }
}

@media (max-width: 600px) {
  .filter-chip-bar .v-chip {
    font-size: 12px;
  }
}
</style>

<style>
/* Filter panel — rendered outside scoped component by v-menu */
.filter-panel-menu {
  border-radius: 12px !important;
}

.filter-panel {
  min-width: 220px;
  padding-bottom: 4px !important;
  background:
    linear-gradient(135deg, rgba(19, 22, 27, 0.75) 0%, rgba(19, 22, 27, 0.65) 100%),
    radial-gradient(circle at 20% 50%, rgba(45, 240, 247, 0.04) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(255, 255, 255, 0.03) 0%, transparent 50%) !important;
  background-color: transparent !important;
  backdrop-filter: blur(24px) saturate(1.8) !important;
  -webkit-backdrop-filter: blur(24px) saturate(1.8) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  border-radius: 12px !important;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset -1px 0 0 rgba(45, 240, 247, 0.08) !important;
  isolation: isolate !important;
}

.filter-panel-search .v-input__slot {
  min-height: 34px !important;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.06) !important;
  border-radius: 8px !important;
  color: white !important;
}

.filter-panel-search .v-input__slot input {
  color: white !important;
  caret-color: white !important;
}

.filter-panel-search .v-input__slot input::placeholder {
  color: rgba(255, 255, 255, 0.35) !important;
}

.filter-panel-search .v-input__prepend-inner {
  margin-top: 5px !important;
}

.filter-panel .v-list-item {
  min-height: 36px !important;
}

.filter-panel .v-subheader {
  color: rgba(255, 255, 255, 0.4) !important;
}
</style>
