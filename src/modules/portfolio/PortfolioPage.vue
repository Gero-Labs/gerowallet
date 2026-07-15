<template>
  <v-layout column>
    <!-- Midnight: same layout grammar as Cardano's portfolio page.
         Top hero row: portfolio chart (9-col, with metrics panel + chart) +
         recent transactions (3-col). Below: filter chip bar + token table
         showing NIGHT/DUST as line items. Dust registration dialog is opened
         from a header-action button so the Register CTA stays accessible. -->
    <template v-if="loggedWallet?.chain === Blockchain.MIDNIGHT">
      <v-row no-gutters class="hero-row">
        <v-col cols="12" xl="9" lg="9" md="8" class="pa-2 hero-chart-col">
          <MidnightPortfolioChart />
        </v-col>
        <v-col xl="3" lg="3" md="4" class="pa-2 hidden-sm-and-down hero-tx-col">
          <MidnightTransactionsCard />
        </v-col>
      </v-row>

      <!-- DUST battery + Proof Server: two at-a-glance status widgets,
           50/50. DUST live-ticks via useMidnightDustLive; unregistered state
           opens the same DUST registration dialog as the header button. The
           proof-server widget shares its mode/health state with the full
           /proof-server page via useMidnightProofServer (never a separate
           copy - see that composable's header comment). -->
      <v-row no-gutters>
        <v-col cols="12" sm="6" class="pa-2">
          <MidnightDustGauge @register="dustRegistrationOpen = true" />
        </v-col>
        <v-col cols="12" sm="6" class="pa-2">
          <MidnightProofServerWidget />
        </v-col>
      </v-row>

      <!-- Holdings table: same liquid-glass shell + chip bar pattern as Cardano. -->
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <v-card flat class="liquid-glass holdings-table-card">
            <!-- Filter chip bar mirrors Cardano. Holdings is the only meaningful
                 view for Midnight today; Collectibles/Market/Watchlist are
                 surfaced as disabled-state chips so the layout stays uniform. -->
            <div class="filter-toolbar d-flex align-center px-3 py-1" style="gap: 6px;">
              <div class="filter-chip-bar d-flex align-center" style="gap: 4px;">
                <v-chip small class="geroButton flex-shrink-0">
                  <v-icon x-small class="mr-1" color="var(--g-on-grad)">mdi-wallet-outline</v-icon>
                  {{ $t('portfolio.holdings') }}
                </v-chip>
                <v-chip small outlined disabled class="flex-shrink-0">
                  <v-icon x-small class="mr-1">mdi-image-outline</v-icon>
                  {{ $t('assets.collectibles') }}
                </v-chip>
              </div>
              <v-spacer />
              <!-- Register-for-DUST lives in the DUST battery panel; the reset
                   icon is the only toolbar action here. -->
              <v-btn
                icon
                small
                class="flex-shrink-0 mr-1"
                :loading="resettingCache"
                :disabled="resettingCache"
                :title="$t('midnight.resetSyncCache')"
                @click="resetMidnightCache()"
              >
                <v-icon small>mdi-cached</v-icon>
              </v-btn>
            </div>

            <MidnightHoldingsTable />
          </v-card>
        </v-col>
      </v-row>

      <DustRegistrationDialog
        :is-open="dustRegistrationOpen"
        @close="dustRegistrationOpen = false"
      />
    </template>

    <!-- Empty state for wallets with no tokens. Mainnet Cardano skips this
         page: it gets the market-first empty mode inside the main view below
         (spec: docs/superpowers/specs/2026-07-15-market-first-empty-state-design.md). -->
    <template v-else-if="isWalletEmpty && !isMainnetCardano">
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
      <!-- Empty mainnet wallet: market-first hero. The ADA price chart takes
           the portfolio chart's slot and the funding CTAs take the
           transactions slot; the live market below is the page content. -->
      <template v-if="isEmptyMainnet">
        <!-- Backup rides in the hero row as a card (not a banner), LEFT of
             the chart: chart at half width while the reminder is pending,
             full width after. -->
        <v-row no-gutters class="hero-row">
          <v-col v-if="shouldBackup" cols="12" xl="3" lg="3" md="4" class="pa-2 hero-tx-col">
            <BackupCard @backup="handleBackupWallet()" />
          </v-col>
          <v-col cols="12" :xl="shouldBackup ? 6 : 9" :lg="shouldBackup ? 6 : 9" :md="shouldBackup ? 4 : 8" class="pa-2 hero-chart-col">
            <AdaPriceHeroCard />
          </v-col>
          <!-- Unlike RecentTransactionsCard this stays visible on small
               screens: funding is the one action an empty wallet has. -->
          <v-col cols="12" xl="3" lg="3" md="4" class="pa-2 hero-tx-col">
            <FundingCard @buy="openBuyDialog()" @receive="openReceiveDialog()" />
          </v-col>
        </v-row>
        <!-- What funding unlocks: staking / cashback / card / perps teasers -->
        <v-row no-gutters>
          <v-col cols="12" class="pa-2">
            <PerkTeasers />
          </v-col>
        </v-row>
      </template>

      <!-- Portfolio Chart (funded wallets) -->
      <v-row v-else no-gutters class="hero-row">
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
            :ada-only="isCardanoNonMainnet"
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
                      <v-icon v-if="chip.icon" x-small :class="{ 'mr-1': !compactChips }" :color="activeView === chip.value ? 'var(--g-accent)' : 'var(--g-text-2)'">{{ chip.icon }}</v-icon>
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
                background-color="var(--g-hairline-1)"
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
                        <v-list-item-title style="font-size: 12px; color: var(--g-info);">
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
              @dust-setup="cnightDialogOpen = true"
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
          @dust-setup="cnightDialogOpen = true"
        />
      </div>

      <!-- Swap Dialog -->
      <SwapDialog :isOpen="swapDialogOpen" @close="swapDialogOpen = false; swapToken = null" :buy-token-unit="swapToken?.unit" />

      <!-- Withdrawal Dialog -->
      <WithdrawalDialog :isOpen="withdrawalDialog" :tx="withdrawalTxData" @close="closeWithdrawalDialog" />

      <!-- Delegate Dialog -->
      <DelegateDialog :isOpen="isDelegateDialogOpen" :pool="selectedPool" :tx="delegateTxData" @close="closeDelegateDialog" />

      <!-- cNIGHT → DUST registration -->
      <CnightDustRegistrationDialog :isOpen="cnightDialogOpen" @close="cnightDialogOpen = false" />
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
import { useHoldingsValuation } from '@/shared/composables/useHoldingsValuation';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network } from '@/models/types';
import { isNewUser as checkNewUser } from '@/modules/dashboard/utils/emptyStateConfigs';

// Components
import PortfolioChart from '@/modules/dashboard/components/PortfolioChart.vue';
import RecentTransactionsCard from '@/modules/dashboard/components/RecentTransactionsCard.vue';
import EmptyStateHero from '@/modules/dashboard/components/EmptyStateHero.vue';
import BackupCard from '@/modules/portfolio/components/BackupCard.vue';
import AdaPriceHeroCard from '@/modules/portfolio/components/AdaPriceHeroCard.vue';
import FundingCard from '@/modules/portfolio/components/FundingCard.vue';
import PerkTeasers from '@/modules/portfolio/components/PerkTeasers.vue';
import MidnightPortfolioChart from '@/modules/dashboard/components/MidnightPortfolioChart.vue';
import MidnightTransactionsCard from '@/modules/dashboard/components/MidnightTransactionsCard.vue';
import MidnightDustGauge from '@/modules/dashboard/components/MidnightDustGauge.vue';
import MidnightProofServerWidget from '@/modules/dashboard/components/MidnightProofServerWidget.vue';
import MidnightHoldingsTable from '@/modules/dashboard/components/MidnightHoldingsTable.vue';
import DustRegistrationDialog from '@/modules/dashboard/dialogs/DustRegistrationDialog.vue';
import MarketTokenTable from '@/modules/market/components/MarketTokenTable.vue';
import MarketStatBar from '@/modules/market/components/MarketStatBar.vue';
import TokenDetailPanel from '@/modules/market/components/TokenDetailPanel.vue';
import CollectiblesTab from '@/modules/assets/components/CollectiblesTab.vue';
import NftCollectionTable from '@/modules/market/components/NftCollectionTable.vue';
import TokensDialog from '@/modules/assets/dialogs/TokensDialog.vue';
import SwapDialog from '@/modules/dashboard/dialogs/SwapDialog.vue';
import WithdrawalDialog from '@/modules/staking/dialogs/WithdrawalDialog.vue';
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import CnightDustRegistrationDialog from '@/modules/dashboard/dialogs/CnightDustRegistrationDialog.vue';
import snackbar from '@/plugins/snackbar';

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

const { loggedWallet, transactions, account, collections } = toRefs(walletStore);

// ── Portfolio Data ────────────────────────────────────────────────────────────

const {
  adaData: adaChartData,
  usdData: usdChartData,
  eurData: eurChartData,
  isLoading: portfolioLoading,
  refreshPortfolioData,
  loadForTimeframe,
  firstLoadedCurrency,
} = usePortfolioData();

// ── UI State ──────────────────────────────────────────────────────────────────

const isMainnetCardano = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network === Network.MAINNET
);

// ── cNIGHT → DUST registration (Path B) ──────────────────────────────────────
// The inline DUST line under the NIGHT holdings row (and the token drawer) is
// the entry point now; the standalone banner was removed. Opened via the
// table/drawer `dust-setup` events.
const cnightDialogOpen = ref(false);

// Non-mainnet Cardano (preprod/preview): render an ADA-only portfolio + chart.
// Testnet tokens have no market price, so fiat valuation and the token
// portfolio don't apply — the hero chart is locked to ADA.
const isCardanoNonMainnet = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO && loggedWallet.value?.network !== Network.MAINNET
);

type ViewMode = 'holdings' | 'collectibles' | 'market' | 'watchlist' | 'snekfun';
const activeView = ref<ViewMode>('holdings');

// DUST registration dialog state — only relevant when chain === Midnight.
const dustRegistrationOpen = ref(false);

// Midnight "reset sync cache" recovery action state. Forces a full re-sync from
// block 0 in BG (clears WS cursor + store snapshot + persisted SDK wallet-state
// blobs), so a stuck/stale local view can be recovered without reinstalling.
const resettingCache = ref(false);

async function resetMidnightCache() {
  if (resettingCache.value) return;
  resettingCache.value = true;
  try {
    const { Messaging } = await import('@/chrome/messaging');
    const { MessageTypes } = await import('@/models/MessageTypes');
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.RESYNC_MIDNIGHT,
      data: {},
    });
    if (response?.data?.success) {
      snackbar.fireSuccess(t('midnight.resetSyncCacheDone'));
    } else {
      snackbar.setError(response?.data?.error || t('midnight.resetSyncCacheFailed'));
    }
  } catch (error) {
    snackbar.setError(error instanceof Error ? error.message : t('midnight.resetSyncCacheFailed'));
  } finally {
    resettingCache.value = false;
  }
}

// Compact chip mode — collapse labels to icons when space is tight
const compactChips = ref(false);
const chipBarRef = ref<HTMLElement | null>(null);
let chipBarObserver: ResizeObserver | null = null;

// Set when the user actively picks a chip; the empty-wallet Market default
// (watcher near the deep-link handlers) never overrides an explicit choice.
let viewTouched = false;

function setActiveView(view: ViewMode) {
  viewTouched = true;
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

// Market-first empty state (mainnet Cardano only). isEmptyMainnet drives the
// hero swap and matches isWalletEmpty's semantics (a not-yet-synced account
// also renders the empty hero, exactly like the old EmptyStateHero branch).
const isEmptyMainnet = computed(() => isWalletEmpty.value && isMainnetCardano.value);

const isNewUser = computed(() => checkNewUser(transactions.value, account.value));
const shouldBackup = computed(() => {
  const config = walletStore.config;
  return config && 'backup' in config && !config.backup;
});

// ── Computed: Portfolio values (ported from Dashboard.vue) ────────────────────

// Valuation (holdings rows, totals, native price, ADA balance) is shared with
// mini-Gero via useHoldingsValuation — the sidepanel MUST show the same
// numbers as this page, so both consume one implementation.
const {
  holdings: valuationHoldings,
  totals: currentPortfolioValues,
  nativePriceUsd,
  adaBalance,
} = useHoldingsValuation();


// Build ADA-only chart data from transaction history (works for all networks)
const adaOnlyChartData = computed(() => {
  const empty = { adaData: [] as number[][], usdData: [] as number[][], eurData: [] as number[][] };
  if (!transactions.value || transactions.value.length === 0) {
    // No synced tx history yet (common right after funding a preprod wallet):
    // seed a flat line at the current balance so the ADA value + chart still
    // render instead of collapsing to the "no-data" empty state. Scoped to
    // non-mainnet Cardano only: on other chains (e.g. Apex) an empty tx list
    // must stay an honest "no data" state so a real sync stall isn't masked.
    const bal = adaBalance.value;
    if (isCardanoNonMainnet.value && bal > 0) {
      const now = currentTimestamp.value;
      const flat: number[][] = [[now - 30 * 24 * 60 * 60 * 1000, bal], [now, bal]];
      const usd = flat.map(([t, v]) => [t, v * nativePriceUsd.value]);
      return { adaData: flat, usdData: usd, eurData: usd.map(([t, v]) => [t, v * usdToEurRate.value]) };
    }
    return empty;
  }

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

// currentPortfolioValues comes from useHoldingsValuation (destructured above)
// so the dashboard and mini-Gero can never disagree on the total.

// ── Computed: Holdings (wallet tokens enriched with market data + P&L) ────────

const myHoldings = computed<MarketToken[]>(() => {
  // Shared valuation rows + page-specific P&L graft (mainnet Cardano only).
  return valuationHoldings.value.map((h) => {
    const pnl = (isMainnetCardano.value && !h.isNative) ? getTokenPnl(h.unit) : null;
    if (!pnl) return h;
    return {
      ...h,
      avgCostBasis: pnl.avgCostBasisAda ?? null,
      totalPnl: pnl.realizedPnlAda + pnl.unrealizedPnlAda,
      realizedPnl: pnl.realizedPnlAda ?? null,
      unrealizedPnl: pnl.unrealizedPnlAda ?? null,
    };
  });
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
  if (chartRefetchTimer) clearTimeout(chartRefetchTimer);
  chipBarObserver?.disconnect();
});

// ── Watchers ──────────────────────────────────────────────────────────────────

// Portfolio history loads once per address, as soon as BOTH the address and
// the synced account row are available. On a freshly imported wallet the
// account row lands only after the first sync delivers it, so keying this on
// the address alone evaluated the balance gate too early and never retried
// (the chart then showed its loading state forever). Watching
// controlled_amount re-runs the gate when the account arrives;
// lastChartAddress keeps subsequent balance updates from re-fetching.
let lastChartAddress: string | null = null;

watch(
  [() => loggedWallet.value?.baseAddress, () => account.value?.controlled_amount],
  ([newAddress], oldValues) => {
    if (!newAddress) return;
    if (newAddress !== oldValues?.[0]) {
      currentTimestamp.value = Date.now();
      // New wallet, new choice: an explicit view pick on the previous wallet
      // must not suppress the fresh-wallet Market default (the component
      // persists across wallet switches — same reason lastChartAddress exists).
      viewTouched = false;
    }
    if (newAddress === lastChartAddress || isApex.value) return;
    if (!(Number(account.value?.controlled_amount) > 0) ||
      loggedWallet.value?.chain !== Blockchain.CARDANO ||
      loggedWallet.value?.network !== Network.MAINNET) {
      return;
    }
    lastChartAddress = newAddress;
    const settings = getPersistedChartSettings(loggedWallet.value?.id);
    currentTimeframe = settings.timeframe;
    currentAdaOnly = settings.adaOnly;
    loadForTimeframe(newAddress, settings.timeframe, settings.adaOnly).catch(error => {
      console.warn('Portfolio data loading failed:', error);
    });
  },
  { immediate: true }
);

// New tx in the store: bump the timestamp (drives the tx-derived non-mainnet chart)
// and, on mainnet, refetch the backend chart history — it's otherwise a one-shot
// load per address (lastChartAddress above), so a receive would update the header
// value and holdings but leave the hero chart frozen until a manual refresh. The
// delay gives the backend indexer time to include the new tx; debounced so a burst
// of txs lands as one refetch. Skipped while lastChartAddress is null (initial
// history load hasn't run yet — it will include this tx anyway).
let chartRefetchTimer: ReturnType<typeof setTimeout> | null = null;
const CHART_REFETCH_DELAY_MS = 10_000;

watch(() => transactions.value?.length, (len, oldLen) => {
  currentTimestamp.value = Date.now();
  if (len === undefined || oldLen === undefined || len === oldLen) return;
  if (!isMainnetCardano.value || !lastChartAddress) return;
  if (chartRefetchTimer) clearTimeout(chartRefetchTimer);
  chartRefetchTimer = setTimeout(() => {
    chartRefetchTimer = null;
    const address = loggedWallet.value?.baseAddress;
    if (address && address === lastChartAddress) {
      loadForTimeframe(address, currentTimeframe, currentAdaOnly).catch(error => {
        console.warn('Portfolio chart refetch after new tx failed:', error);
      });
    }
  }, CHART_REFETCH_DELAY_MS);
});

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

// Empty mainnet wallets land on Market: with nothing to hold yet, the live
// market IS the page content. Optimistic on purpose: a brand-new address has
// no account row at all, so waiting for a confirmed zero balance never fires
// (that guard shipped in #786 and left fresh wallets on Holdings). If the
// account then loads — or fills — with funds, restore the holdings-first
// default. Deep links and user chip clicks always win.
let autoDefaulted = false;
watch(isEmptyMainnet, (empty) => {
  const q = instance?.proxy?.$route?.query;
  if (empty && !viewTouched && !q?.['view'] && !q?.['tab']) {
    activeView.value = 'market';
    autoDefaulted = true;
  } else if (!empty && autoDefaulted && !viewTouched && activeView.value === 'market') {
    activeView.value = 'holdings';
    autoDefaulted = false;
  }
}, { immediate: true });

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
  border-bottom: 1px solid var(--g-hairline-1);
}

.filter-chip-bar {
  flex-wrap: nowrap;
  -webkit-overflow-scrolling: touch;
}

.filter-chip-bar .v-chip {
  flex-shrink: 0;
  cursor: pointer;
  height: 28px !important;
  /* Match the table/search control radius (8px) instead of Vuetify's fully
     rounded chip pill, which clashed with the card's rounding. */
  border-radius: var(--g-r-control) !important;
}

/* Selected chip: cyan-accented (tint + hairline) so the active tab clearly
   reads as the chain accent. The geroButton gradient doesn't apply to a v-chip
   (it rendered a dull grey), so we tint it here instead. The icon stays
   var(--g-accent) via its :color prop; the label stays readable white. */
.filter-chip-bar .v-chip.geroButton {
  background: color-mix(in srgb, var(--g-accent) 16%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--g-accent) 45%, transparent) !important;
  color: var(--g-text-1) !important;
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
  border-radius: var(--g-r-control) !important;
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
  transition: color var(--g-dur-base) ease, opacity var(--g-dur-base) ease;
}

.mode-btn.mode-active {
  opacity: 1;
  color: var(--g-accent) !important;
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
  background: var(--g-surface);
  color: var(--g-text-3) !important;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 11px;
  font-weight: 600;
  border-bottom: 1px solid var(--g-hairline-1) !important;
}

.holdings-table-card ::v-deep tbody tr {
  transition: background var(--g-dur-fast) ease;
}

.holdings-table-card ::v-deep tbody tr:hover {
  background: var(--g-hairline-1) !important;
}

.holdings-table-card ::v-deep tbody tr td {
  border-bottom: 1px solid var(--g-hairline-1) !important;
}

/* Monospace numbers in holdings */
.holdings-table-card ::v-deep td.text-right {
  font-family: var(--g-font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: 'tnum' 1;
}

/* ── Search popover ─────────────────────────────────────────────────────────── */

/* ── Filter menu button ──────────────────────────────────────────────────────── */

.filter-menu-btn {
  transition: background var(--g-dur-base) ease;
}

.filter-menu-btn:hover {
  background: var(--g-hairline-1) !important;
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
  background: var(--g-hairline-3);
  transition: background var(--g-dur-slow) ease;
}

.live-dot--active {
  background: var(--g-success);
  box-shadow: 0 0 6px rgba(71, 205, 137, 0.6);
  animation: livePulse 2s ease-in-out infinite;
}

.live-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--g-text-3);
  transition: color var(--g-dur-slow) ease;
}

.live-label--active {
  color: var(--g-success);
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
  border-radius: var(--g-r-card) !important;
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
  border: 1px solid var(--g-hairline-3) !important;
  border-radius: var(--g-r-card) !important;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    inset -1px 0 0 rgba(45, 240, 247, 0.08) !important;
  isolation: isolate !important;
}

.filter-panel-search .v-input__slot {
  min-height: 34px !important;
  font-size: 13px;
  background: var(--g-hairline-1) !important;
  border-radius: var(--g-r-control) !important;
  color: var(--g-text-1) !important;
}

.filter-panel-search .v-input__slot input {
  color: var(--g-text-1) !important;
  caret-color: var(--g-text-1) !important;
}

.filter-panel-search .v-input__slot input::placeholder {
  color: var(--g-text-3) !important;
}

.filter-panel .v-list-item {
  min-height: 36px !important;
}

.filter-panel .v-subheader {
  color: var(--g-text-3) !important;
}
</style>
