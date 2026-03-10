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
        <v-col cols="12" xl="9" lg="9" md="8" class="pa-2">
          <v-card outlined class="liquid-glass portfolio-hero-card">
            <v-card-text>
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
                :ada-only-value-usd="adaBalance * (price?.lastPrice || 0)"
                :ada-only-value-eur="adaBalance * (price?.lastPrice || 0) * usdToEurRate"
                :loading="portfolioLoading"
                :progressive-loading="true"
                :first-loaded-currency="firstLoadedCurrency"
                :total-realized-pnl="pnlSummary?.totalRealizedPnlAda ?? null"
                :total-unrealized-pnl="pnlSummary?.totalUnrealizedPnlAda ?? null"
                :pnl-loading="pnlLoading"
                @refresh="refreshPortfolioChart"
              />
            </v-card-text>
          </v-card>
        </v-col>
        <v-col xl="3" lg="3" md="4" class="pa-2 hidden-sm-and-down">
          <div class="carousel-fixed-container">
            <FeatureCarousel
              :model-value="currentCarouselIndex"
              @update:modelValue="currentCarouselIndex = $event"
              :items="carouselItems"
              :paused="carouselPaused"
              :is-loading="false"
              :show-progress-bar="true"
              carousel-class="feature-carousel dashboard-card feature-card-full-height"
              @item-click="handleCarouselClick"
            />
          </div>
        </v-col>
      </v-row>

      <!-- Filter Chip Bar + Table -->
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <v-card flat class="liquid-glass holdings-table-card">
            <!-- Filter chip bar -->
            <div class="filter-chip-bar d-flex align-center px-3 pt-2 pb-1" style="gap: 6px; overflow-x: auto">
              <v-chip
                v-for="chip in filterChips"
                :key="chip.value"
                small
                :color="activeView === chip.value ? 'primary' : undefined"
                :outlined="activeView !== chip.value"
                @click="activeView = chip.value"
                class="flex-shrink-0"
                style="cursor: pointer"
              >
                <v-icon v-if="chip.icon" x-small class="mr-1">{{ chip.icon }}</v-icon>
                {{ chip.label }}
                <NotificationDot
                  v-if="chip.value === 'watchlist'"
                  :show="watchlistCount > 0"
                  :dot="false"
                  :content="watchlistCount"
                  color="primary"
                  class="ml-1"
                />
              </v-chip>
            </div>

            <!-- Unified search + filter controls -->
            <div class="d-flex align-center flex-wrap px-3 pt-1 pb-1" style="gap: 8px">
              <v-text-field
                v-model="searchQuery"
                :placeholder="activeView === 'collectibles'
                  ? $t('assets.searchCollections')
                  : $t('market.searchPlaceholder')"
                prepend-inner-icon="mdi-magnify"
                solo-inverted
                dense
                flat
                hide-details
                clearable
                class="search-field"
                style="max-width: 220px"
              />
              <v-spacer />

              <v-chip
                v-if="activeView !== 'collectibles'"
                small
                filter
                outlined
                :input-value="verifiedOnly"
                @click="verifiedOnly = !verifiedOnly"
                class="flex-shrink-0"
              >
                {{ $t('market.verifiedOnly') }}
              </v-chip>
              <v-chip
                small
                filter
                outlined
                :input-value="hideScam"
                @click="hideScam = !hideScam"
                class="flex-shrink-0"
              >
                {{ $t('market.hideScam') }}
              </v-chip>

              <!-- NFT table / gallery toggle (only when in collectibles mode) -->
              <template v-if="activeView === 'collectibles'">
                <div class="holdings-mode-toggle d-flex align-center ml-2" style="gap: 2px">
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on }">
                      <v-btn
                        icon
                        small
                        :class="{ 'mode-active': nftViewMode === 'table' }"
                        class="mode-btn"
                        v-on="on"
                        @click="nftViewMode = 'table'"
                      >
                        <v-icon small>mdi-table</v-icon>
                      </v-btn>
                    </template>
                    <span>{{ $t('portfolio.tableView') }}</span>
                  </v-tooltip>
                  <v-tooltip bottom>
                    <template v-slot:activator="{ on }">
                      <v-btn
                        icon
                        small
                        :class="{ 'mode-active': nftViewMode === 'gallery' }"
                        class="mode-btn"
                        v-on="on"
                        @click="nftViewMode = 'gallery'"
                      >
                        <v-icon small>mdi-view-grid</v-icon>
                      </v-btn>
                    </template>
                    <span>{{ $t('portfolio.galleryView') }}</span>
                  </v-tooltip>
                </div>
              </template>
            </div>

            <!-- Token table (all views except collectibles) -->
            <MarketTokenTable
              v-if="activeView !== 'collectibles'"
              :tokens="displayedTokens"
              :show-holdings-columns="activeView === 'holdings'"
              :show-owned-badge="activeView !== 'holdings'"
              :loading="marketLoading"
              :pnl-loading="pnlLoading"
              @token-click="openToken"
              @swap-token="openSwap"
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
import { usePortfolioData } from '@/shared/composables/usePortfolioData';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { priceStore } from '@/stores/priceStore';
import { Blockchain, Network } from '@/models/types';
import { Cardano } from '@cardano-sdk/core';
import { getBalance } from '@/chrome/serialization';
import { isNewUser as checkNewUser } from '@/modules/dashboard/utils/emptyStateConfigs';

// Components
import PortfolioChart from '@/modules/dashboard/components/PortfolioChart.vue';
import EmptyStateHero from '@/modules/dashboard/components/EmptyStateHero.vue';
import MarketTokenTable from '@/modules/market/components/MarketTokenTable.vue';
import TokenDetailPanel from '@/modules/market/components/TokenDetailPanel.vue';
import CollectiblesTab from '@/modules/assets/components/CollectiblesTab.vue';
import NftCollectionTable from '@/modules/market/components/NftCollectionTable.vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import FeatureCarousel, { type CarouselItem } from '@/modules/dashboard/components/FeatureCarousel.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import NotificationDot from '@/shared/components/NotificationDot.vue';
import assets from '@/utils/assets';

const { t } = useTranslation();
const instance = getCurrentInstance();

// ── Composables ───────────────────────────────────────────────────────────────

const { openBuyDialog, openReceiveDialog } = useQuickActionDialogs();
const {
  allTokens,
  trendingTokens,
  topGainers,
  topLosers,
  newTokens,
  loading: marketLoading,
} = useMarketData();
const { isWatched, watchlistCount } = useWatchlist();
const { pnlSummary, pnlLoading, fetchPnl, getTokenPnl } = useWalletPnl();
const { usdToEurRate, loadExchangeRate } = useCurrencyConverter();

// ── Store refs ────────────────────────────────────────────────────────────────

const { loggedWallet, transactions, account, utxos, collateral, collections, tokens: walletTokens } = toRefs(walletStore);
const { price } = toRefs(networkStore);
const { portfolio } = toRefs(tapToolsStore);

// ── Portfolio Data ────────────────────────────────────────────────────────────

const portfolioComposable = usePortfolioData({
  cacheTimeMs: 4 * 60 * 60 * 1000,
  enableCache: true,
});

const {
  adaData: adaChartData,
  usdData: usdChartData,
  eurData: eurChartData,
  isLoading: portfolioLoading,
  loadDataProgressively,
  refreshPortfolioData,
  firstLoadedCurrency,
  latestPortfolioValues,
} = portfolioComposable;

// ── UI State ──────────────────────────────────────────────────────────────────

type ViewMode = 'holdings' | 'collectibles' | 'all' | 'trending' | 'gainers' | 'losers' | 'new' | 'watchlist';
const activeView = ref<ViewMode>('holdings');
const searchQuery = ref('');
const verifiedOnly = ref(false);
const hideScam = ref(true);
const nftViewMode = ref<'table' | 'gallery'>('table');
const nftDialogData = ref<any>(null);
const selectedToken = ref<MarketToken | null>(null);
const panelOpen = ref(false);
const swapDialogOpen = ref(false);
const swapToken = ref<MarketToken | null>(null);
const currentTimestamp = ref(Date.now());

// Carousel state
const currentCarouselIndex = ref(0);
const carouselPaused = ref(false);
const carouselItems = ref<CarouselItem[]>([
  {
    id: 'gero-debit-card',
    title: t('card.geroCard'),
    subtitle: t('card.topUpAdaInstantly'),
    logoAlt: 'Gero Logo',
    backgroundImage: assets.debitCardBgImage,
    cardImage: assets.debitCardImage,
    action: 'showDebitCardInfo',
    type: 'debit-card' as const,
  },
]);

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

// NFTs: check wallet collections (synced from chain)
const hasNfts = computed(() => {
  return Object.keys(collections.value || {}).length > 0;
});

const tokensCount = computed(() => Object.keys(walletTokens.value || {}).length);

const collectiblesCount = computed(() => {
  let count = 0;
  Object.values(collections.value || {}).forEach((col: any) => {
    if (col.items) count += col.items.length;
  });
  return count;
});

// ── Computed: Portfolio values (ported from Dashboard.vue) ────────────────────

const adaBalance = computed(() => {
  return Number(getBalance(utxos.value, collateral.value).coin().toString()) / 1000000;
});

const computedValues = computed(() => {
  let assetsValue = 0;
  if (portfolio.value?.positionsFt) {
    portfolio.value.positionsFt.forEach((position: any) => { assetsValue += position.adaValue; });
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
  const sortedTransactions = [...transactions.value].sort((a: any, b: any) => a.tx_timestamp - b.tx_timestamp);
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
  sortedTransactions.forEach((tx: any) => {
    currentBalance += tx.ada;
    const balanceInAda = currentBalance / 1000000;
    const timestamp = tx.tx_timestamp * 1000;
    graphData.push([timestamp, balanceInAda]);
    const balanceInUsd = balanceInAda * (price.value?.lastPrice || 0);
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
      const balanceUsd = lastBalance * (price.value?.lastPrice || 0);
      usdData.push([currentTime, balanceUsd]);
      eurData.push([currentTime, balanceUsd * usdToEurRate.value]);
      currentTime += weekInMs;
    }
  }
  graphData.push([now, lastBalance]);
  const currentBalanceUsd = lastBalance * (price.value?.lastPrice || 0);
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

const currentPortfolioValues = computed(() => {
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    return {
      ada: latestPortfolioValues.value.ada !== null ? latestPortfolioValues.value.ada : computedValues.value.totalValue,
      usd: latestPortfolioValues.value.usd !== null ? latestPortfolioValues.value.usd : (computedValues.value.totalValue * (price.value?.lastPrice || 0)),
      eur: latestPortfolioValues.value.eur !== null ? latestPortfolioValues.value.eur : (computedValues.value.totalValue * (price.value?.lastPrice || 0)),
    };
  }
  const totalValueUsd = computedValues.value.totalValue * (price.value?.lastPrice || 0);
  return { ada: computedValues.value.totalValue, usd: totalValueUsd, eur: totalValueUsd * usdToEurRate.value };
});

// ── Computed: Holdings (wallet tokens enriched with market data + P&L) ────────

const myHoldings = computed<MarketToken[]>(() => {
  const tokens = walletTokens.value || {};
  const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
  const dhTokens = (dexHunterStore as any).dexHunterTokens || {};
  const holdings: MarketToken[] = [];

  Object.entries(tokens).forEach(([unit, token]: [string, any]) => {
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

    // P&L data from wallet P&L composable (not applicable for native ADA)
    const pnl = isNativeToken ? null : getTokenPnl(unit);

    holdings.push({
      unit,
      name: marketToken?.name || token.name || token.metadata?.name || (isNativeToken ? 'Cardano' : unit),
      ticker: marketToken?.ticker || token.metadata?.ticker || (isNativeToken ? 'ADA' : ''),
      img: marketToken?.img || dhToken?.img || '',
      verified: marketToken?.verified ?? dhToken?.verified ?? isNativeToken,
      price: priceUsd,
      priceAda,
      change1h: marketToken?.change1h || 0,
      change24h: marketToken?.change24h || 0,
      change7d: marketToken?.change7d || 0,
      volume24h: marketToken?.volume24h || 0,
      mcap: marketToken?.mcap || dhToken?.mcap || 0,
      tvl: marketToken?.tvl || null,
      liquidity: marketToken?.liquidity || 0,
      holders: marketToken?.holders || dhToken?.holders || 0,
      riskRating: marketToken?.riskRating || null,
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

  // Sort: ADA pinned to top, then by value descending
  holdings.sort((a, b) => {
    if (a.unit === 'lovelace' || a.ticker === 'ADA') return -1;
    if (b.unit === 'lovelace' || b.ticker === 'ADA') return 1;
    return (b.value || 0) - (a.value || 0);
  });

  return holdings;
});

// ── Computed: Filter chips ─────────────────────────────────────────────────────

const filterChips = computed(() => [
  { value: 'holdings' as ViewMode, label: t('portfolio.myHoldings'), icon: 'mdi-wallet' },
  { value: 'collectibles' as ViewMode, label: t('portfolio.collectibles'), icon: 'mdi-image-multiple' },
  { value: 'all' as ViewMode, label: t('portfolio.all'), icon: '' },
  { value: 'trending' as ViewMode, label: t('portfolio.trending'), icon: 'mdi-fire' },
  { value: 'gainers' as ViewMode, label: t('portfolio.gainers'), icon: 'mdi-trending-up' },
  { value: 'losers' as ViewMode, label: t('portfolio.losers'), icon: 'mdi-trending-down' },
  { value: 'new' as ViewMode, label: t('portfolio.newTokens'), icon: 'mdi-new-box' },
  { value: 'watchlist' as ViewMode, label: t('portfolio.watchlist'), icon: 'mdi-star' },
]);

const watchlistedTokens = computed(() => allTokens.value.filter(tok => isWatched(tok.unit)));

// ── Computed: Unified displayed tokens ────────────────────────────────────────

const displayedTokens = computed(() => {
  let tokens: MarketToken[] = [];

  switch (activeView.value) {
    case 'holdings':
      tokens = myHoldings.value;
      break;
    case 'all':
      tokens = allTokens.value;
      break;
    case 'trending':
      tokens = trendingTokens.value;
      break;
    case 'gainers':
      tokens = topGainers.value;
      break;
    case 'losers':
      tokens = topLosers.value;
      break;
    case 'new':
      tokens = newTokens.value;
      break;
    case 'watchlist':
      tokens = watchlistedTokens.value;
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

  // Apply verified filter
  if (verifiedOnly.value) {
    tokens = tokens.filter(tok => tok.verified);
  }

  // Apply scam filter
  if (hideScam.value) {
    tokens = tokens.filter(tok => {
      if (!tok.verified && tok.riskRating && ['C', 'D'].includes(tok.riskRating)) return false;
      return true;
    });
  }

  return tokens;
});

// ── Actions ───────────────────────────────────────────────────────────────────

let skipNextOutsideClose = false;

function openToken(token: MarketToken) {
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

function handleCarouselClick(item: CarouselItem) {
  const proxy = instance?.proxy;
  if (item.action === 'showDebitCardInfo' && proxy?.$router && proxy.$route.path !== '/card') {
    proxy.$router.push('/card');
  } else if (item.action === 'navigateToCashback' && proxy?.$router && proxy.$route.path !== '/cashback') {
    proxy.$router.push('/cashback');
  }
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

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
  loadExchangeRate();
  fetchPnl();
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick);
  if (searchDebounce) clearTimeout(searchDebounce);
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
            loadDataProgressively(newAddress).catch(error => {
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
const validViews: ViewMode[] = ['holdings', 'collectibles', 'all', 'trending', 'gainers', 'losers', 'new', 'watchlist'];
watch(
  () => instance?.proxy?.$route?.query?.view,
  (view) => {
    if (view && validViews.includes(view as ViewMode)) {
      activeView.value = view as ViewMode;
    }
    // Legacy support: ?tab=market maps to 'all'
    const tab = instance?.proxy?.$route?.query?.tab;
    if (tab === 'market') {
      activeView.value = 'all';
    }
  },
  { immediate: true }
);
</script>

<style scoped>
/* ── Filter chip bar ─────────────────────────────────────────────────────────── */

.filter-chip-bar {
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
}

.filter-chip-bar .v-chip {
  flex-shrink: 0;
  cursor: pointer;
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

/* ── Carousel ──────────────────────────────────────────────────────────────── */

.hero-row {
  align-items: stretch;
}

.carousel-fixed-container {
  overflow: hidden;
  border-radius: 12px;
  height: 100%;
}

.feature-card-full-height {
  height: 100% !important;
}

/* Constrain carousel to match chart card height */
.carousel-fixed-container ::v-deep .carousel-wrapper {
  height: 100%;
}

.carousel-fixed-container ::v-deep .carousel-text-top {
  justify-content: center;
  padding-top: 0;
}

.carousel-fixed-container ::v-deep .debit-card-container {
  margin-bottom: 8px;
}

.carousel-fixed-container ::v-deep .debit-card-floating {
  width: 140px;
}

.carousel-fixed-container ::v-deep .cashback-floating {
  width: 130px;
}

.carousel-fixed-container ::v-deep .carousel-overlay {
  padding: 12px;
}

/* ── Hero card ───────────────────────────────────────────────────────────────── */

.portfolio-hero-card {
  position: relative;
  overflow: visible !important;
  height: 100%;
}

.portfolio-hero-card > .v-card__text {
  padding-bottom: 0;
}

.portfolio-hero-card::before {
  content: '';
  position: absolute;
  top: -30px;
  left: 12%;
  right: 12%;
  height: 60px;
  background: radial-gradient(ellipse, rgba(0, 199, 243, 0.06) 0%, transparent 70%);
  pointer-events: none;
  z-index: -1;
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

/* ── Search field ────────────────────────────────────────────────────────────── */

.search-field ::v-deep .v-input__slot {
  min-height: 32px !important;
  font-size: 13px;
  background: #000000 !important;
}

.search-field ::v-deep .v-input__prepend-inner {
  margin-top: 4px !important;
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

@media (max-width: 600px) {
  .filter-chip-bar .v-chip {
    font-size: 12px;
  }
}
</style>
