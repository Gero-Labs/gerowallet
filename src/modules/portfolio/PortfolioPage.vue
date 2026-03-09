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
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <!-- Top-level tabs -->
          <v-tabs
            v-model="activeTab"
            class="portfolio-tabs mb-3"
            background-color="transparent"
            height="40"
            show-arrows
          >
            <v-tab>{{ $t('portfolio.holdings') }}</v-tab>
            <v-tab>{{ $t('portfolio.market') }}</v-tab>
            <v-tab v-if="hasNfts">{{ $t('portfolio.nfts') }}</v-tab>
          </v-tabs>

          <!-- ========== HOLDINGS TAB ========== -->
          <div v-show="activeTab === 0" class="tab-content">
            <!-- Hero: Portfolio Chart -->
            <v-card outlined class="liquid-glass portfolio-hero-card mb-3">
              <v-card-text>
                <PortfolioChart
                  :chart-data="computeChartData.adaData"
                  :chart-data-usd="computeChartData.usdData"
                  :chart-data-eur="computeChartData.eurData"
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
                  @refresh="refreshPortfolioChart"
                />
              </v-card-text>
            </v-card>

            <!-- Holdings Table -->
            <v-card flat class="liquid-glass holdings-table-card">
              <div class="d-flex align-center flex-wrap px-3 pt-2" style="gap: 8px">
                <v-text-field
                  v-model="holdingsSearch"
                  :placeholder="$t('market.searchPlaceholder')"
                  prepend-inner-icon="mdi-magnify"
                  solo-inverted
                  dense
                  flat
                  hide-details
                  clearable
                  class="search-field"
                  style="max-width: 240px"
                />
                <v-spacer />
                <v-chip
                  small
                  filter
                  outlined
                  :input-value="verifiedOnly"
                  @click="verifiedOnly = !verifiedOnly"
                >
                  {{ $t('market.verifiedOnly') }}
                </v-chip>
              </div>
              <MarketTokenTable
                :tokens="filteredHoldings"
                :show-holdings-columns="true"
                :loading="marketLoading"
                @token-click="openToken"
                @swap-token="openSwap"
              />
            </v-card>

            <!-- Staking Widget (collapsible) -->
            <v-expansion-panels
              v-if="isStakingEnabled && hasStaking"
              flat
              class="staking-panel mt-2"
            >
              <v-expansion-panel class="liquid-glass-subtle">
                <v-expansion-panel-header class="staking-panel-header">
                  <div class="d-flex align-center">
                    <v-icon small class="mr-2" color="primary">mdi-layers-triple</v-icon>
                    {{ $t('portfolio.stakingCollapsed') }}
                  </div>
                </v-expansion-panel-header>
                <v-expansion-panel-content>
                  <StakingCard2 />
                </v-expansion-panel-content>
              </v-expansion-panel>
            </v-expansion-panels>
          </div>

          <!-- ========== MARKET TAB ========== -->
          <div v-show="activeTab === 1" class="tab-content">
            <!-- Market Stat Bar -->
            <MarketStatBar :tokens="allTokens" @token-click="openTokenByUnit" />

            <v-card flat class="liquid-glass mt-2">
              <div class="d-flex align-center flex-wrap px-3 pt-2">
                <!-- Market sub-tabs -->
                <v-tabs
                  v-model="marketSubTab"
                  dense
                  show-arrows
                  background-color="transparent"
                  class="market-sub-tabs flex-grow-0"
                  height="36"
                >
                  <v-tab>{{ $t('market.allTokens') }}</v-tab>
                  <v-tab>{{ $t('market.trending') }}</v-tab>
                  <v-tab>{{ $t('market.topGainers') }}</v-tab>
                  <v-tab>{{ $t('market.topLosers') }}</v-tab>
                  <v-tab>{{ $t('market.newTokens') }}</v-tab>
                  <v-tab>
                    {{ $t('market.watchlist') }}
                    <NotificationDot
                      :show="watchlistCount > 0"
                      :dot="false"
                      :content="watchlistCount"
                      color="primary"
                      class="ml-1"
                    />
                  </v-tab>
                </v-tabs>

                <v-spacer />

                <!-- Search + Filters -->
                <div class="d-flex align-center" style="gap: 8px">
                  <v-text-field
                    v-model="marketSearch"
                    :placeholder="$t('market.searchPlaceholder')"
                    prepend-inner-icon="mdi-magnify"
                    solo-inverted
                    dense
                    flat
                    hide-details
                    clearable
                    class="search-field"
                    style="max-width: 240px"
                  />
                  <v-chip
                    small
                    filter
                    outlined
                    :input-value="marketVerifiedOnly"
                    @click="marketVerifiedOnly = !marketVerifiedOnly"
                  >
                    {{ $t('market.verifiedOnly') }}
                  </v-chip>
                  <v-chip
                    small
                    filter
                    outlined
                    :input-value="hideScam"
                    @click="hideScam = !hideScam"
                  >
                    {{ $t('market.hideScam') }}
                  </v-chip>
                </div>
              </div>

              <MarketTokenTable
                :tokens="marketFilteredTokens"
                :show-holdings-columns="false"
                :loading="marketLoading"
                @token-click="openToken"
                @swap-token="openSwap"
              />
            </v-card>
          </div>

          <!-- ========== NFTs TAB ========== -->
          <div v-show="activeTab === nftTabIndex && hasNfts" class="tab-content">
            <NftCollectionTable />
          </div>

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
          <SwapDialog :isOpen="swapDialogOpen" @close="swapDialogOpen = false" />
        </v-col>
      </v-row>
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
import { useNftMarketData } from '@/modules/market/composables/useNftMarketData';
import { usePortfolioData } from '@/shared/composables/usePortfolioData';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { tapToolsStore } from '@/stores/tapToolsStore';
import { Blockchain, Network } from '@/models/types';
import { Cardano } from '@cardano-sdk/core';
import { getBalance } from '@/chrome/serialization';
import { isNewUser as checkNewUser } from '@/modules/dashboard/utils/emptyStateConfigs';

// Components
import PortfolioChart from '@/modules/dashboard/components/PortfolioChart.vue';
import StakingCard2 from '@/modules/dashboard/components/StakingCard2.vue';
import EmptyStateHero from '@/modules/dashboard/components/EmptyStateHero.vue';
import MarketTokenTable from '@/modules/market/components/MarketTokenTable.vue';
import MarketStatBar from '@/modules/market/components/MarketStatBar.vue';
import TokenDetailPanel from '@/modules/market/components/TokenDetailPanel.vue';
import NftCollectionTable from '@/modules/market/components/NftCollectionTable.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import NotificationDot from '@/shared/components/NotificationDot.vue';

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
  searchTokens,
} = useMarketData();
const { isWatched, watchlistCount } = useWatchlist();
const { pnlSummary, fetchPnl, getTokenPnl } = useWalletPnl();
const { hasNfts } = useNftMarketData();
const { usdToEurRate, loadExchangeRate } = useCurrencyConverter();

// ── Store refs ────────────────────────────────────────────────────────────────

const { loggedWallet, transactions, account, utxos, collateral, tokens: userTokens } = toRefs(walletStore);
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

const activeTab = ref(0);
const marketSubTab = ref(0);
const holdingsSearch = ref('');
const marketSearch = ref('');
const verifiedOnly = ref(false);
const marketVerifiedOnly = ref(false);
const hideScam = ref(false);
const selectedToken = ref<MarketToken | null>(null);
const panelOpen = ref(false);
const swapDialogOpen = ref(false);
const currentTimestamp = ref(Date.now());

// ── Debounced search ──────────────────────────────────────────────────────────

let holdingsDebounce: ReturnType<typeof setTimeout> | null = null;
const debouncedHoldingsSearch = ref('');
watch(holdingsSearch, (val) => {
  if (holdingsDebounce) clearTimeout(holdingsDebounce);
  holdingsDebounce = setTimeout(() => { debouncedHoldingsSearch.value = val || ''; }, 300);
});

let marketDebounce: ReturnType<typeof setTimeout> | null = null;
const debouncedMarketSearch = ref('');
watch(marketSearch, (val) => {
  if (marketDebounce) clearTimeout(marketDebounce);
  marketDebounce = setTimeout(() => { debouncedMarketSearch.value = val || ''; }, 300);
});

// ── Computed: Empty state & staking ───────────────────────────────────────────

const isWalletEmpty = computed(() => !account.value || account.value?.controlled_amount === '0');
const isNewUser = computed(() => checkNewUser(transactions.value, account.value));
const shouldBackup = computed(() => {
  const config = walletStore.config;
  return config && 'backup' in config && !config.backup;
});

const isStakingEnabled = computed(() => {
  if (loggedWallet.value?.baseAddress) {
    return Cardano.Address.fromBech32(loggedWallet.value.baseAddress).getType() !== Cardano.AddressType.EnterpriseScript;
  }
  return false;
});

const hasStaking = computed(() => {
  return !!(account.value?.controlled_amount && account.value?.pool_id);
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

const computeChartData = computed(() => {
  if (loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET) {
    return { adaData: adaChartData.value, usdData: usdChartData.value, eurData: eurChartData.value };
  }
  let graphData: number[][] | undefined;
  let usdData: number[][] | undefined;
  let eurData: number[][] | undefined;

  if (transactions.value && transactions.value.length > 0) {
    graphData = [];
    usdData = [];
    eurData = [];
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
      graphData!.push([timestamp, balanceInAda]);
      const balanceInUsd = balanceInAda * (price.value?.lastPrice || 0);
      usdData!.push([timestamp, balanceInUsd]);
      eurData!.push([timestamp, balanceInUsd * usdToEurRate.value]);
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
  }
  return { adaData: graphData || [], usdData: usdData || [], eurData: eurData || [] };
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

// ── Computed: Holdings tab tokens ─────────────────────────────────────────────

const myHoldings = computed(() => {
  const holdings = userTokens.value || {};
  return allTokens.value
    .filter(tok => {
      if (tok.unit === 'lovelace') return true;
      return !!holdings[tok.unit];
    })
    .map(tok => {
      const held = holdings[tok.unit];
      const pnl = getTokenPnl(tok.unit);
      const result: MarketToken = { ...tok };
      if (held) {
        result.balance = held.quantity ? Number(held.quantity) / Math.pow(10, held.decimals || 0) : 0;
        result.value = result.balance ? result.balance * tok.price : 0;
      }
      if (pnl) {
        result.avgCostBasis = pnl.avgCostBasisAda;
        result.totalPnl = pnl.realizedPnlAda + pnl.unrealizedPnlAda;
        result.realizedPnl = pnl.realizedPnlAda;
        result.unrealizedPnl = pnl.unrealizedPnlAda;
      }
      return result;
    });
});

const filteredHoldings = computed(() => {
  let result = myHoldings.value;
  if (debouncedHoldingsSearch.value) {
    const q = debouncedHoldingsSearch.value.toLowerCase();
    result = result.filter(tok => tok.name.toLowerCase().includes(q) || tok.ticker.toLowerCase().includes(q));
  }
  if (verifiedOnly.value) {
    result = result.filter(tok => tok.verified);
  }
  return result;
});

// ── Computed: Market tab tokens ───────────────────────────────────────────────

const watchlistedTokens = computed(() => allTokens.value.filter(tok => isWatched(tok.unit)));

const marketTabTokens = computed(() => {
  switch (marketSubTab.value) {
    case 0: return allTokens.value;
    case 1: return trendingTokens.value;
    case 2: return topGainers.value;
    case 3: return topLosers.value;
    case 4: return newTokens.value;
    case 5: return watchlistedTokens.value;
    default: return allTokens.value;
  }
});

const marketFilteredTokens = computed(() => {
  let result = marketTabTokens.value;
  if (debouncedMarketSearch.value) {
    const q = debouncedMarketSearch.value.toLowerCase();
    result = result.filter(tok => tok.name.toLowerCase().includes(q) || tok.ticker.toLowerCase().includes(q));
  }
  if (marketVerifiedOnly.value) {
    result = result.filter(tok => tok.verified);
  }
  if (hideScam.value) {
    result = result.filter(tok => {
      if (!tok.verified && tok.riskRating && ['C', 'D'].includes(tok.riskRating)) return false;
      return true;
    });
  }
  return result;
});

// ── Computed: NFT tab index ───────────────────────────────────────────────────

const nftTabIndex = computed(() => hasNfts.value ? 2 : -1);

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

function openSwap(_token: MarketToken) {
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

// ── Auto-refresh market data ──────────────────────────────────────────────────

let refreshInterval: ReturnType<typeof setInterval> | null = null;

// ── Lifecycle ─────────────────────────────────────────────────────────────────

onMounted(() => {
  document.addEventListener('click', handleOutsideClick);
  loadExchangeRate();
  fetchPnl();

  // Auto-refresh market data every 30s when visible
  refreshInterval = setInterval(() => {
    if (document.visibilityState === 'visible') {
      searchTokens('');
    }
  }, 30_000);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleOutsideClick);
  if (holdingsDebounce) clearTimeout(holdingsDebounce);
  if (marketDebounce) clearTimeout(marketDebounce);
  if (refreshInterval) clearInterval(refreshInterval);
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

// Handle /?tab=market deep-link and nav drawer clicks
const proxy = instance?.proxy;
watch(
  () => proxy?.$route?.query?.tab,
  (tab) => {
    if (tab === 'market') activeTab.value = 1;
    else if (tab === 'nfts' && hasNfts.value) activeTab.value = 2;
  },
  { immediate: true }
);
</script>

<style scoped>
/* ── Tab bar ─────────────────────────────────────────────────────────────────── */

.portfolio-tabs ::v-deep .v-tab {
  text-transform: none;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0;
  min-width: unset;
  padding: 0 20px;
  opacity: 0.5;
  transition: opacity 0.2s ease, color 0.2s ease;
}

.portfolio-tabs ::v-deep .v-tab--active {
  opacity: 1;
}

.portfolio-tabs ::v-deep .v-tabs-slider {
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(90deg, #00c7f3, #00ffd1);
}

.portfolio-tabs ::v-deep .v-tabs-bar {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

/* ── Hero card ───────────────────────────────────────────────────────────────── */

.portfolio-hero-card {
  position: relative;
  overflow: visible !important;
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

/* ── Holdings table card ─────────────────────────────────────────────────────── */

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
  background: rgba(0, 199, 243, 0.04);
}

.holdings-table-card ::v-deep tbody tr td {
  border-bottom: 1px solid rgba(255, 255, 255, 0.04) !important;
}

.holdings-table-card ::v-deep td.text-right {
  font-family: 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* ── Market sub-tabs ─────────────────────────────────────────────────────────── */

.market-sub-tabs ::v-deep .v-tab {
  text-transform: none !important;
  font-size: 13px;
  min-width: unset;
  padding: 0 12px;
  letter-spacing: 0;
}

.market-sub-tabs ::v-deep .v-tabs-slider {
  height: 2px;
}

/* ── Search field ────────────────────────────────────────────────────────────── */

.search-field ::v-deep .v-input__slot {
  min-height: 32px !important;
  font-size: 13px;
}

.search-field ::v-deep .v-input__prepend-inner {
  margin-top: 4px !important;
}

/* ── Staking panel ───────────────────────────────────────────────────────────── */

.staking-panel ::v-deep .v-expansion-panel {
  border-radius: 12px;
}

.staking-panel ::v-deep .v-expansion-panel::before {
  box-shadow: none;
}

.staking-panel-header {
  font-size: 13px;
  font-weight: 500;
  min-height: 40px !important;
  padding: 8px 16px !important;
}

.staking-panel ::v-deep .v-expansion-panel-content__wrap {
  padding: 0;
}

/* ── Token detail panel positioning ──────────────────────────────────────────── */

.market-content {
  position: relative;
}

/* ── Tab content transitions ─────────────────────────────────────────────────── */

.tab-content {
  animation: fadeIn 0.15s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
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
  .portfolio-tabs ::v-deep .v-tab {
    font-size: 13px;
    padding: 0 12px;
  }
}
</style>
