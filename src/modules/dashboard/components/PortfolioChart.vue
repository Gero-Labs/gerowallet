<template>
  <div class="portfolio-split-root">
    <!-- Left Panel: Portfolio Metrics (30%) -->
    <div class="portfolio-metrics-panel">
      <div class="metrics-inner">
        <!-- Header row: label + mode toggle + refresh -->
        <div class="metrics-header-row">
          <div class="portfolio-label">{{ $t('dashboard.portfolio') }}</div>
          <v-spacer />
          <v-tooltip v-if="!isApex" bottom content-class="custom-tooltip">
            <template v-slot:activator="{ on, attrs }">
              <div class="mode-segmented-toggle" v-bind="attrs" v-on="on">
                <button
                  class="mode-segment"
                  :class="{ active: portfolioMode === 'ada-only' }"
                  @click="setPortfolioMode('ada-only')"
                >₳</button>
                <button
                  class="mode-segment"
                  :class="{ active: portfolioMode === 'full' }"
                  @click="setPortfolioMode('full')"
                >{{ $t('dashboard.all') }}</button>
              </div>
            </template>
            <span>{{ portfolioMode === 'ada-only' ? $t('dashboard.adaOnlyTooltip') : $t('dashboard.fullPortfolioTooltip') }}</span>
          </v-tooltip>
          <v-btn icon x-small @click="handleRefresh" :disabled="isRefreshing">
            <v-icon small :class="{ 'rotating': isRefreshing }">mdi-refresh</v-icon>
          </v-btn>
        </div>

        <div
          class="portfolio-amount"
          @click="!hideBalances && toggleCurrency()"
          :class="{ clickable: !hideBalances && availableCurrencies.length > 1 }"
        >
          <transition name="balance-fade" mode="out-in">
            <span v-if="hideBalances" key="masked" class="portfolio-amount-masked">••••••</span>
            <span v-else key="visible" class="portfolio-amount-visible">
              <span class="currency-symbol">{{ currentCurrencyConfig.symbol }}</span>
              <OdometerCounter v-if="isReadyToRender" :value="activePortfolioValue" format="decimal" :duration="1000" :key="selectedCurrency" />
              <span v-else class="portfolio-amount-placeholder">—</span>
            </span>
          </transition>
        </div>

        <div class="address-section" v-if="shortenAddress">
          <CopyButton
            :avatar="assets.walletSvg"
            :title="shortenAddress"
            :value="loggedWallet?.baseAddress || ''"
            x-small
          />
        </div>

        <v-divider class="my-1" style="opacity: 0.15" />

        <!-- P&L Summary -->
        <div class="pnl-column">
          <!-- Loading state -->
          <template v-if="pnlLoading">
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('market.unrealizedPnlDetail') }}</span>
              <span class="pnl-skeleton"></span>
            </div>
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('market.realizedPnlDetail') }}</span>
              <span class="pnl-skeleton"></span>
            </div>
          </template>
          <!-- Data state -->
          <template v-else-if="totalRealizedPnl != null || totalUnrealizedPnl != null">
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('market.unrealizedPnlDetail') }}</span>
              <v-tooltip v-if="pnlIncomplete" bottom max-width="220" content-class="custom-tooltip">
                <template v-slot:activator="{ on }">
                  <span
                    class="pnl-value"
                    :style="{ color: (totalUnrealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
                    v-on="on"
                  >
                    {{ hideBalances ? '••••••' : '~' + ((totalUnrealizedPnl || 0) >= 0 ? '+' : '') + formatPnl(totalUnrealizedPnl || 0) + ' \u20B3' }}
                  </span>
                </template>
                <span>{{ $t('market.pnlIncompleteHint') }}</span>
              </v-tooltip>
              <span
                v-else
                class="pnl-value"
                :style="{ color: hideBalances ? 'rgba(255,255,255,0.35)' : (totalUnrealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
              >
                {{ hideBalances ? '••••••' : ((totalUnrealizedPnl || 0) >= 0 ? '+' : '') + formatPnl(totalUnrealizedPnl || 0) + ' \u20B3' }}
              </span>
            </div>
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('market.realizedPnlDetail') }}</span>
              <v-tooltip v-if="pnlIncomplete" bottom max-width="220" content-class="custom-tooltip">
                <template v-slot:activator="{ on }">
                  <span
                    class="pnl-value"
                    :style="{ color: hideBalances ? 'rgba(255,255,255,0.35)' : (totalRealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
                    v-on="on"
                  >
                    {{ hideBalances ? '••••••' : '~' + ((totalRealizedPnl || 0) >= 0 ? '+' : '') + formatPnl(totalRealizedPnl || 0) + ' \u20B3' }}
                  </span>
                </template>
                <span>{{ $t('market.pnlIncompleteHint') }}</span>
              </v-tooltip>
              <span
                v-else
                class="pnl-value"
                :style="{ color: hideBalances ? 'rgba(255,255,255,0.35)' : (totalRealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
              >
                {{ hideBalances ? '••••••' : ((totalRealizedPnl || 0) >= 0 ? '+' : '') + formatPnl(totalRealizedPnl || 0) + ' \u20B3' }}
              </span>
            </div>
          </template>
          <!-- Empty state -->
          <template v-else>
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('market.unrealizedPnlDetail') }}</span>
              <span class="pnl-value" style="opacity: 0.35">—</span>
            </div>
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('market.realizedPnlDetail') }}</span>
              <span class="pnl-value" style="opacity: 0.35">—</span>
            </div>
          </template>
        </div>

        <v-divider class="my-1" style="opacity: 0.15" />

        <!-- Staking Rewards -->
        <div class="staking-rewards-section">
          <template v-if="account && account.pool_id">
            <div
              class="pnl-item staking-reward-row"
              :class="{ clickable: hasWithdrawableRewards }"
              @click="hasWithdrawableRewards && $emit('withdraw-rewards')"
            >
              <span class="pnl-label">{{ $t('dashboard.stakingRewards') }}</span>
              <span
                class="pnl-value"
                :style="{ color: hasWithdrawableRewards ? '#47CD89' : 'rgba(255,255,255,0.35)' }"
              >
                {{ hideBalances ? '••••••' : (hasWithdrawableRewards ? formatRewards(account.withdrawable_amount) + ' \u20B3' : '—') }}
              </span>
            </div>
          </template>
          <template v-else>
            <div class="pnl-item">
              <span class="pnl-label">{{ $t('dashboard.stakingRewards') }}</span>
              <a class="stake-gero-link" @click.prevent="$emit('delegate-gero')">
                {{ $t('dashboard.stakeWithGero') }}
              </a>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Right Panel: Chart (70%) -->
    <div class="portfolio-chart-panel">
      <!-- Chart Controls Bar -->
      <div class="chart-controls-bar">
        <div class="timeframe-pills">
          <button
            v-for="tabItem in timeframeTabs"
            :key="tabItem.value"
            class="timeframe-pill"
            :class="{ active: selectedTimeframe === tabItem.value }"
            @click="handleTimeframeClick(tabItem)"
          >
            {{ tabItem.label }}
          </button>
        </div>
      </div>

      <!-- Chart Area -->
      <div class="chart-area">
        <!-- Loading State -->
        <div v-if="globalLoading" class="loading-container">
          <v-progress-circular indeterminate color="primary" :size="40" :width="3"></v-progress-circular>
          <div class="loading-text">{{ $t('dashboard.loadingChart') }}</div>
        </div>

        <!-- Lightweight Charts Container -->
        <div
          ref="chartContainerRef"
          v-show="isReadyToRender"
          class="lw-chart-container"
        ></div>

        <!-- Crosshair Tooltip -->
        <div ref="tooltipRef" class="chart-tooltip" style="display: none;">
          <div class="tooltip-date"></div>
          <div class="tooltip-value"></div>
        </div>

        <!-- Empty State -->
        <div v-if="!hasAnyChartData && !globalLoading" class="empty-state text-center">
          <v-avatar size="24">
            <v-img :src="assets.walletSvg" :alt="$t('common.wallet')"></v-img>
          </v-avatar>
          <span class="ml-2" style="color: rgba(255,255,255,0.5)">{{ $t('dashboard.noDataInWallet') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref, watch, toRefs, nextTick, onBeforeUnmount } from 'vue';
import { createChart, AreaSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, AreaData, Time, SolidColor, MouseEventParams } from 'lightweight-charts';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { themes } from '@/config/themes';
import CopyButton from '@/shared/components/CopyButton.vue';
import OdometerCounter from '@/shared/components/OdometerCounter.vue';

const { t } = useTranslation();


// Currency Types
enum CurrencyType {
  ADA = 'ADA',
  USD = 'USD',
  EUR = 'EUR',
}

interface CurrencyConfig {
  symbol: string;
  displayName: string;
}

interface TimeframeTab {
  value: string;
  label: string;
}

// Currency Configuration
const currencyConfigs: Record<CurrencyType, CurrencyConfig> = {
  [CurrencyType.ADA]: {
    symbol: '',
    displayName: t('dashboard.nativeCurrency'),
  },
  [CurrencyType.USD]: {
    symbol: '$',
    displayName: t('dashboard.usDollar'),
  },
  [CurrencyType.EUR]: {
    symbol: '\u20AC',
    displayName: 'Euro',
  },
};

const { loggedWallet, account } = toRefs(walletStore);

const hideBalances = computed(() => walletStore.config?.hideBalances || false);

const priceFormatter = (price: number) => {
  if (hideBalances.value) return '••••••';
  if (price >= 1e6) return (price / 1e6).toFixed(2) + 'M';
  if (price >= 1e3) return (price / 1e3).toFixed(2) + 'K';
  if (price >= 1) return price.toFixed(2);
  return price.toFixed(4);
};

const isApex = computed(() => {
  const chain = loggedWallet.value?.chain;
  return chain === Blockchain.APEX_PRIME || chain === Blockchain.APEX_VECTOR;
});

const chartTheme = computed(() => {
  const t = isApex.value ? themes.apex : themes.cardano;
  const hex = t.primary;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    line: hex,
    topFill: `rgba(${r}, ${g}, ${b}, 0.3)`,
    bottomFill: `rgba(${r}, ${g}, ${b}, 0)`,
  };
});

const props = defineProps({
  chartData: {
    type: Array,
    default: () => [],
  },
  chartDataUsd: {
    type: Array,
    default: () => [],
  },
  chartDataEur: {
    type: Array,
    default: () => [],
  },
  portfolioValueAda: {
    type: Number,
    default: 0,
  },
  portfolioValueUsd: {
    type: Number,
    default: 0,
  },
  portfolioValueEur: {
    type: Number,
    default: 0,
  },
  loading: {
    type: Boolean,
    default: true,
  },
  progressiveLoading: {
    type: Boolean,
    default: false,
  },
  firstLoadedCurrency: {
    type: String,
    default: null,
  },
  adaOnlyChartData: {
    type: Array,
    default: () => [],
  },
  adaOnlyChartDataUsd: {
    type: Array,
    default: () => [],
  },
  adaOnlyChartDataEur: {
    type: Array,
    default: () => [],
  },
  adaOnlyValueAda: {
    type: Number,
    default: 0,
  },
  adaOnlyValueUsd: {
    type: Number,
    default: 0,
  },
  adaOnlyValueEur: {
    type: Number,
    default: 0,
  },
  totalRealizedPnl: {
    type: Number,
    default: null,
  },
  totalUnrealizedPnl: {
    type: Number,
    default: null,
  },
  pnlLoading: {
    type: Boolean,
    default: false,
  },
  pnlIncomplete: {
    type: Boolean,
    default: false,
  },
});

// Define emits
const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'timeframe-change', timeframe: string): void;
  (e: 'mode-change', adaOnly: boolean): void;
  (e: 'withdraw-rewards'): void;
  (e: 'delegate-gero'): void;
}>();

// Staking rewards
const hasWithdrawableRewards = computed(() => {
  return account.value && Number(account.value.withdrawable_amount) > 0;
});

const formatRewards = (lovelace: string | number) => {
  const ada = Number(lovelace) / 1_000_000;
  return ada.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Refs
const chartContainerRef = ref<HTMLElement | null>(null);
const isRefreshing = ref(false);
const portfolioMode = ref<'full' | 'ada-only'>('full');
const selectedCurrency = ref<CurrencyType>(CurrencyType.ADA);
const selectedTimeframe = ref('WEEK');

// Chart instances
let chart: IChartApi | null = null;
let areaSeries: ISeriesApi<'Area'> | null = null;
let resizeObserver: ResizeObserver | null = null;
let initRetryTimer: ReturnType<typeof setTimeout> | null = null;
let animationFrameId: number | null = null;

// Tooltip DOM ref (direct manipulation for zero-lag tracking)
const tooltipRef = ref<HTMLElement | null>(null);

// Timeframe tabs (ordered as displayed)
const timeframeTabs: TimeframeTab[] = [
  { value: 'DAY', label: '24H' },
  { value: 'WEEK', label: '7D' },
  { value: 'MONTH', label: '1M' },
  { value: 'QUARTER', label: '3M' },
  { value: 'YEAR', label: '1Y' },
];

// Timeframe cutoff durations in milliseconds
const timeframeCutoffs: Record<string, number> = {
  DAY: 24 * 60 * 60 * 1000,
  WEEK: 7 * 24 * 60 * 60 * 1000,
  MONTH: 30 * 24 * 60 * 60 * 1000,
  QUARTER: 90 * 24 * 60 * 60 * 1000,
  YEAR: 365 * 24 * 60 * 60 * 1000,
};


// --- Portfolio mode persistence ---

const loadPortfolioMode = (): 'full' | 'ada-only' => {
  try {
    const walletId = loggedWallet.value?.id;
    if (!walletId) return 'full';
    return (localStorage.getItem(`portfolioMode_${walletId}`) as 'full' | 'ada-only') || 'full';
  } catch {
    return 'full';
  }
};

const savePortfolioMode = (mode: 'full' | 'ada-only'): void => {
  try {
    const walletId = loggedWallet.value?.id;
    if (!walletId) return;
    localStorage.setItem(`portfolioMode_${walletId}`, mode);
  } catch {
    // Silently fail
  }
};

portfolioMode.value = loadPortfolioMode();

const setPortfolioMode = (mode: 'full' | 'ada-only') => {
  if (portfolioMode.value === mode) return;
  console.log(`📊 setPortfolioMode: ${portfolioMode.value} → ${mode}`);
  portfolioMode.value = mode;
  savePortfolioMode(mode);
  emit('mode-change', mode === 'ada-only');
};

// --- Timeframe persistence ---

const loadTimeframeSetting = (): string => {
  try {
    const walletId = loggedWallet.value?.id;
    if (!walletId) return 'WEEK';
    return localStorage.getItem(`portfolioTab_${walletId}`) || 'WEEK';
  } catch {
    return 'WEEK';
  }
};

const saveTimeframeSetting = (value: string): void => {
  try {
    const walletId = loggedWallet.value?.id;
    if (!walletId) return;
    localStorage.setItem(`portfolioTab_${walletId}`, value);
  } catch {
    // Silently fail
  }
};

selectedTimeframe.value = loadTimeframeSetting();

// --- Refresh ---

const handleRefresh = () => {
  isRefreshing.value = true;
  emit('refresh');
  setTimeout(() => {
    isRefreshing.value = false;
  }, 500);
};

// --- Computed properties ---

const shortenAddress = computed(() => {
  return loggedWallet.value?.baseAddress ? filters.shortenStringWithEllipsis(loggedWallet.value.baseAddress, 14) : '';
});

const hasAnyChartData = computed(() => {
  return (
    (props.chartData && props.chartData.length > 0) ||
    (props.chartDataUsd && props.chartDataUsd.length > 0) ||
    (props.chartDataEur && props.chartDataEur.length > 0)
  );
});

const firstAvailableCurrency = computed(() => {
  if (props.chartData && props.chartData.length > 0) return CurrencyType.ADA;
  if (props.chartDataUsd && props.chartDataUsd.length > 0) return CurrencyType.USD;
  if (props.chartDataEur && props.chartDataEur.length > 0) return CurrencyType.EUR;
  return null;
});

const globalLoading = computed(() => {
  // Only show loading spinner when there's no data to show yet
  if (props.progressiveLoading) {
    return !hasAnyChartData.value;
  }
  return props.loading && !hasAnyChartData.value;
});

const isReadyToRender = computed(() => {
  return hasAnyChartData.value;
});

const nativeCurrencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const currentCurrencyConfig = computed(() => {
  const config = { ...currencyConfigs[selectedCurrency.value] };
  if (selectedCurrency.value === CurrencyType.ADA) {
    config.symbol = nativeCurrencySymbol.value;
    config.displayName = `${nativeCurrencySymbol.value} Balance`;
  }
  return config;
});

const activeChartData = computed(() => {
  // Data already reflects the current mode (adaOnly) — parent fetches the right data
  switch (selectedCurrency.value) {
    case CurrencyType.USD:
      return props.chartDataUsd || [];
    case CurrencyType.EUR:
      return props.chartDataEur || [];
    case CurrencyType.ADA:
    default:
      return props.chartData || [];
  }
});

const activePortfolioValue = computed(() => {
  const isAdaOnly = portfolioMode.value === 'ada-only';
  switch (selectedCurrency.value) {
    case CurrencyType.USD:
      return isAdaOnly ? props.adaOnlyValueUsd : props.portfolioValueUsd;
    case CurrencyType.EUR:
      return isAdaOnly ? props.adaOnlyValueEur : props.portfolioValueEur;
    case CurrencyType.ADA:
    default:
      return isAdaOnly ? props.adaOnlyValueAda : props.portfolioValueAda;
  }
});

const availableCurrencies = computed(() => {
  const currencies: CurrencyType[] = [];

  if ((props.chartData && props.chartData.length > 0) || props.portfolioValueAda > 0) {
    currencies.push(CurrencyType.ADA);
  }
  if ((props.chartDataUsd && props.chartDataUsd.length > 0) || props.portfolioValueUsd > 0) {
    currencies.push(CurrencyType.USD);
  }
  if ((props.chartDataEur && props.chartDataEur.length > 0) || props.portfolioValueEur > 0) {
    currencies.push(CurrencyType.EUR);
  }

  if (currencies.length === 0 && props.progressiveLoading) {
    currencies.push(CurrencyType.ADA);
  }

  return currencies;
});

// --- Currency toggle ---

const toggleCurrency = (): void => {
  const availableCurrs = availableCurrencies.value;
  if (availableCurrs.length === 0) return;

  const currentIndex = availableCurrs.indexOf(selectedCurrency.value);
  const nextIndex = (currentIndex + 1) % availableCurrs.length;
  selectedCurrency.value = availableCurrs[nextIndex];
};

const selectCurrency = (currency: CurrencyType): void => {
  selectedCurrency.value = currency;
};

const convertStringToCurrencyType = (currencyString: string): CurrencyType | null => {
  switch (currencyString) {
    case 'ADA': return CurrencyType.ADA;
    case 'USD': return CurrencyType.USD;
    case 'EUR': return CurrencyType.EUR;
    default: return null;
  }
};

// --- Formatting ---

const formatPnl = (value: number): string => {
  if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + 'M';
  if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'K';
  return value.toFixed(2);
};

// --- Data transformation ---

/**
 * Transform raw [timestamp_ms, value][] to lightweight-charts format,
 * filtered by the selected timeframe.
 */
const transformData = (rawData: [number, number][]): AreaData<Time>[] => {
  if (!rawData || rawData.length === 0) return [];

  const cutoff = timeframeCutoffs[selectedTimeframe.value];

  // Parse and sort all valid points
  const allPoints: { ts: number; val: number }[] = [];
  for (const point of rawData) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [ts, val] = point;
    if (typeof ts !== 'number' || typeof val !== 'number' || isNaN(ts) || isNaN(val)) continue;
    allPoints.push({ ts, val });
  }
  allPoints.sort((a, b) => a.ts - b.ts);
  if (allPoints.length === 0) return [];

  // Cutoff is relative to the newest data point, not today
  const newestTs = allPoints[allPoints.length - 1].ts;
  const cutoffTime = cutoff ? newestTs - cutoff : 0;

  // Deduplicate by second-level timestamp (keep last value per second)
  const timeMap = new Map<number, number>();

  if (cutoffTime > 0) {
    // Find the last data point before the cutoff as the window-start anchor
    let anchorVal: number | null = null;
    for (const p of allPoints) {
      if (p.ts < cutoffTime) {
        anchorVal = p.val;
      } else {
        break;
      }
    }

    // Place anchor at the window edge so the chart starts there
    if (anchorVal !== null) {
      timeMap.set(Math.floor(cutoffTime / 1000), anchorVal);
    }

    // Include all actual data points within the window
    for (const p of allPoints) {
      if (p.ts < cutoffTime) continue;
      timeMap.set(Math.floor(p.ts / 1000), p.val);
    }

  } else {
    // No cutoff (shouldn't happen with current tabs) — show all data
    for (const p of allPoints) {
      timeMap.set(Math.floor(p.ts / 1000), p.val);
    }
  }

  // Convert to sorted array
  const result: AreaData<Time>[] = [];
  const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
  for (const time of sortedTimes) {
    result.push({ time: time as Time, value: timeMap.get(time)! });
  }

  return result;
};

// Trend direction is compared by caller via first/last value directly

// --- Chart initialization and update ---

const initChart = () => {
  if (!chartContainerRef.value) return;

  // Destroy existing chart
  destroyChart();

  const containerWidth = chartContainerRef.value.clientWidth || chartContainerRef.value.offsetWidth;
  const containerHeight = chartContainerRef.value.clientHeight || chartContainerRef.value.offsetHeight;

  if (containerWidth === 0 || containerHeight === 0) {
    // Retry after layout reflow
    initRetryTimer = setTimeout(() => initChart(), 100);
    return;
  }

  try {
    chart = createChart(chartContainerRef.value, {
      width: containerWidth,
      height: containerHeight,
      layout: {
        attributionLogo: false,
        background: {
          type: 'solid' as const,
          color: 'transparent',
        } as SolidColor,
        textColor: 'rgba(255, 255, 255, 0.5)',
        fontFamily: 'Quicksand, Inter, sans-serif',
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      rightPriceScale: {
        visible: true,
        borderVisible: false,
        scaleMargins: { top: 0.25, bottom: 0.25 },
        entireTextOnly: false,
        ticksVisible: true,
        textColor: 'rgba(255, 255, 255, 0.35)',
        minimumWidth: 60,
      },
      timeScale: {
        visible: true,
        borderVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: 1, // CrosshairMode.Magnet — snaps to nearest point but follows mouse smoothly
        vertLine: {
          color: 'rgba(255, 255, 255, 0.15)',
          width: 1,
          style: 2, // LineStyle.Dashed
          labelVisible: false,
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.15)',
          width: 1,
          style: 2,
          labelVisible: true,
          labelBackgroundColor: 'rgba(30, 34, 45, 0.9)',
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });

    if (!chart) return;

    // Create area series with theme colors
    areaSeries = chart.addSeries(AreaSeries, {
      lineColor: chartTheme.value.line,
      lineWidth: 2,
      lineType: 2, // Curved (spline interpolation)
      topColor: chartTheme.value.topFill,
      bottomColor: chartTheme.value.bottomFill,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#ffffff',
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBackgroundColor: chartTheme.value.line,
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'custom',
        formatter: priceFormatter,
        minMove: 1,
      },
    });

    // Set up resize observer
    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0 && chart) {
            chart.applyOptions({ width, height });
          }
        }
      });
      resizeObserver.observe(chartContainerRef.value);
    }

    // Subscribe to crosshair move for tooltip — direct DOM for instant tracking
    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const el = tooltipRef.value;
      if (!el) return;

      if (!param.time || !param.seriesData || param.seriesData.size === 0) {
        el.style.display = 'none';
        return;
      }

      const data = param.seriesData.get(areaSeries);
      if (!data || data.value === undefined) {
        el.style.display = 'none';
        return;
      }

      // Format date
      const timestamp = typeof param.time === 'number' ? param.time * 1000 : 0;
      if (timestamp > 0) {
        const date = new Date(timestamp);
        const dateStr = date.toLocaleDateString(undefined, {
          month: 'short', day: 'numeric', year: 'numeric',
        }) + ' ' + date.toLocaleTimeString(undefined, {
          hour: '2-digit', minute: '2-digit',
        });
        el.children[0].textContent = dateStr;
      }

      // Format value
      const val = data.value as number;
      const formattedVal = val >= 1000
        ? val.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      el.children[1].textContent = hideBalances.value
        ? '••••••'
        : currentCurrencyConfig.value.symbol + formattedVal;

      // Position via transform3d (GPU composited, no layout thrash)
      if (param.point && chartContainerRef.value) {
        const chartArea = chartContainerRef.value.closest('.chart-area') as HTMLElement;
        if (chartArea) {
          const areaRect = chartArea.getBoundingClientRect();
          const containerRect = chartContainerRef.value.getBoundingClientRect();
          const x = param.point.x + (containerRect.left - areaRect.left);
          const y = param.point.y + (containerRect.top - areaRect.top);
          const tooltipWidth = 160;
          const tx = x + 12 + tooltipWidth > areaRect.width ? x - tooltipWidth - 12 : x + 12;
          const ty = Math.max(0, y - 20);
          el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        }
      }

      el.style.display = '';
    });

    // Populate with data
    updateChartData();

  } catch (error) {
    console.error('PortfolioChart: Failed to initialize chart:', error);
  }
};

const updateChartData = () => {
  if (!areaSeries || !chart) return;

  // Cancel any running animation
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }

  const rawData = activeChartData.value;
  const chartData = transformData(rawData);

  if (chartData.length === 0) {
    areaSeries.setData([]);
    return;
  }

  // Use theme-appropriate chart color
  areaSeries.applyOptions({
    lineColor: chartTheme.value.line,
    topColor: chartTheme.value.topFill,
    bottomColor: chartTheme.value.bottomFill,
    crosshairMarkerBackgroundColor: chartTheme.value.line,
  });

  areaSeries.setData(chartData);
  chart.timeScale().fitContent();
  chart.priceScale('right').applyOptions({ autoScale: true });
};

const destroyChart = () => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  if (tooltipRef.value) tooltipRef.value.style.display = 'none';
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (chart) {
    try {
      chart.remove();
    } catch (e) {
      // Silent fail
    }
    chart = null;
    areaSeries = null;
  }
};

// --- Timeframe handling ---

// Map UI timeframe values to API timeframe strings
const uiToApiTimeframe: Record<string, string> = {
  DAY: '24h',
  WEEK: '7d',
  MONTH: '30d',
  QUARTER: '90d',
  YEAR: '1y',
};

const handleTimeframeClick = (tabItem: TimeframeTab) => {
  const apiTimeframe = uiToApiTimeframe[tabItem.value] || '1y';
  console.log(`📊 handleTimeframeClick: ${tabItem.value} → ${apiTimeframe}`);
  selectedTimeframe.value = tabItem.value;
  saveTimeframeSetting(tabItem.value);
  emit('timeframe-change', apiTimeframe);
};

// --- Watchers ---

// Watch for chart data changes (progressive loading and standard)
watch(
  () => [props.chartData, props.chartDataUsd, props.chartDataEur],
  () => {
    console.log(`📊 Chart data watcher fired: chartData=${props.chartData?.length}, usd=${props.chartDataUsd?.length}, eur=${props.chartDataEur?.length}`);
    // Progressive loading: switch to the first loaded currency if current has no data
    if (props.progressiveLoading) {
      const firstLoadedString = props.firstLoadedCurrency;
      const firstLoaded = firstLoadedString ? convertStringToCurrencyType(firstLoadedString) : null;
      const currentData = activeChartData.value;

      if (firstLoaded && (!currentData || currentData.length === 0)) {
        selectCurrency(firstLoaded);
      }
    }

    if (hasAnyChartData.value) {
      if (chart && areaSeries) {
        try {
          updateChartData();
        } catch (error) {
          console.error('PortfolioChart: Failed to update chart data:', error);
        }
      } else {
        // Chart not initialized yet, try now
        nextTick(() => initChart());
      }
    }
  },
  { deep: true, immediate: true }
);

// Watch currency changes
watch(selectedCurrency, () => {
  try {
    updateChartData();
  } catch (error) {
    console.error('PortfolioChart: Failed to update chart on currency change:', error);
  }
});

// Watch timeframe changes — re-filter displayed data to match the selected window
watch(selectedTimeframe, () => {
  try {
    updateChartData();
  } catch (error) {
    console.error('PortfolioChart: Failed to update chart on timeframe change:', error);
  }
});

// Watch wallet changes
watch(
  loggedWallet,
  (newWallet, oldWallet) => {
    if (newWallet?.baseAddress !== oldWallet?.baseAddress) {
      // Reload preferences for new wallet
      portfolioMode.value = loadPortfolioMode();
      selectedTimeframe.value = loadTimeframeSetting();

      if (hasAnyChartData.value) {
        nextTick(() => {
          try {
            if (chart) {
              updateChartData();
            } else {
              initChart();
            }
          } catch (error) {
            console.error('PortfolioChart: Failed to update chart on wallet change:', error);
          }
        });
      }
    }
  },
  { deep: false }
);

// Watch loading state (non-progressive mode)
watch(
  () => props.loading,
  (newVal, oldVal) => {
    if (props.progressiveLoading) return;

    if (oldVal && !newVal && hasAnyChartData.value) {
      nextTick(() => {
        try {
          if (!chart) {
            initChart();
          } else {
            updateChartData();
          }
        } catch (error) {
          console.error('PortfolioChart: Failed to update chart on loading change:', error);
        }
      });
    }
  }
);

// Watch isReadyToRender to initialize chart when component becomes visible
watch(isReadyToRender, (ready) => {
  if (ready && !chart) {
    nextTick(() => {
      // Small delay to ensure DOM is updated
      setTimeout(() => initChart(), 50);
    });
  }
});

// Watch hideBalances — re-apply price formatter and crosshair label visibility
watch(hideBalances, () => {
  if (areaSeries && chart) {
    areaSeries.applyOptions({
      priceFormat: {
        type: 'custom',
        formatter: priceFormatter,
        minMove: 1,
      },
    });
    // Also hide crosshair price label when balances hidden
    chart.applyOptions({
      crosshair: {
        horzLine: {
          labelVisible: !hideBalances.value,
        },
      },
    });
  }
});

// --- Lifecycle ---

onMounted(() => {
  // Restore persisted timeframe
  const savedTimeframe = loadTimeframeSetting();
  selectedTimeframe.value = savedTimeframe;

  // Progressive loading: initialize if data already available
  if (props.progressiveLoading && hasAnyChartData.value) {
    const firstLoadedString = props.firstLoadedCurrency;
    const firstLoaded = firstLoadedString
      ? convertStringToCurrencyType(firstLoadedString)
      : firstAvailableCurrency.value;

    if (firstLoaded) {
      selectCurrency(firstLoaded);
    }

    nextTick(() => {
      setTimeout(() => initChart(), 50);
    });
  } else if (!props.loading && hasAnyChartData.value) {
    nextTick(() => {
      setTimeout(() => initChart(), 100);
    });
  }
});

onBeforeUnmount(() => {
  if (initRetryTimer) { clearTimeout(initRetryTimer); initRetryTimer = null; }
  destroyChart();
});
</script>

<style scoped>
/* ── Split Layout ─────────────────────────────────────────────────────────────── */

.portfolio-split-root {
  display: flex;
  gap: 6px;
  height: 100%;
}

/* ── Metrics Panel (Left 30%) ─────────────────────────────────────────────────── */

.portfolio-metrics-panel {
  flex: 0 0 30%;
  min-width: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.metrics-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.metrics-header-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

.portfolio-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.5);
}

.portfolio-amount {
  font-size: 1.4rem;
  font-weight: 600;
  color: #ffffff;
  display: inline-flex;
  align-items: baseline;
  gap: 0.1em;
  transition: opacity 0.2s ease;
  margin-bottom: 4px;
}

.portfolio-amount.clickable {
  cursor: pointer;
}

.portfolio-amount.clickable:hover {
  opacity: 0.8;
}

.portfolio-amount-placeholder {
  opacity: 0.3;
}

.portfolio-amount-masked {
  font-size: inherit;
  letter-spacing: 2px;
  opacity: 0.5;
}

.portfolio-amount-visible {
  display: inline;
}

/* Balance fade transition */
.balance-fade-enter-active,
.balance-fade-leave-active {
  transition: opacity 0.22s ease, filter 0.22s ease;
}

.balance-fade-enter,
.balance-fade-leave-to {
  opacity: 0;
  filter: blur(4px);
}

.currency-symbol {
  font-weight: 600;
  margin-right: 0.1em;
  line-height: 1;
  display: inline-block;
}

.address-section {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}

/* P&L items stacked vertically */
.pnl-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.pnl-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.pnl-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
}

.pnl-value {
  font-family: 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}

.pnl-skeleton {
  display: inline-block;
  width: 60px;
  height: 14px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(255,255,255,0.06) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.06) 75%);
  background-size: 200% 100%;
  animation: pnlShimmer 1.5s infinite;
}

@keyframes pnlShimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.staking-reward-row.clickable {
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 4px;
  margin: -2px -4px;
  transition: background 0.15s ease;
}

.staking-reward-row.clickable:hover {
  background: rgba(255, 255, 255, 0.06);
}

.stake-gero-link {
  font-size: 11px;
  font-weight: 600;
  color: var(--v-primary-base, #47CD89);
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
}

.stake-gero-link:hover {
  text-decoration: underline;
  opacity: 0.85;
}

.mode-segmented-toggle {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 2px;
}

.mode-segment {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1.2;
  outline: none;
  white-space: nowrap;
}

.mode-segment:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
}

.mode-segment.active {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

/* ── Chart Panel (Right 70%) ──────────────────────────────────────────────────── */

.portfolio-chart-panel {
  flex: 1 1 0%;
  min-width: 0;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(20px) saturate(1.8);
  -webkit-backdrop-filter: blur(20px) saturate(1.8);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

.chart-controls-bar {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  gap: 6px;
  z-index: 10;
  flex-shrink: 0;
}

/* Timeframe Pills */
.timeframe-pills {
  display: flex;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 2px;
}

.timeframe-pill {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.5);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  line-height: 1.2;
  outline: none;
  white-space: nowrap;
}

.timeframe-pill:hover {
  color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.06);
}

.timeframe-pill.active {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.12);
}

/* Chart area fills remaining space */
.chart-area {
  flex: 1;
  position: relative;
  min-height: 80px;
}

.lw-chart-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: 100%;
  pointer-events: auto;
  animation: chartFadeIn 0.4s ease-out;
}

@keyframes chartFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Loading State */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  position: absolute;
  inset: 0;
}

.loading-text {
  font-size: 12px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.5);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  inset: 0;
}

/* Crosshair Tooltip */
.chart-tooltip {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 20;
  background: rgba(20, 24, 32, 0.88);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 8px 12px;
  pointer-events: none;
  white-space: nowrap;
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  will-change: transform;
}

.tooltip-date {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  margin-bottom: 3px;
  letter-spacing: 0.02em;
}

.tooltip-value {
  font-size: 14px;
  font-weight: 600;
  color: #ffffff;
  font-variant-numeric: tabular-nums;
}

/* Refresh animation */
.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ── Responsive ───────────────────────────────────────────────────────────────── */

@media (max-width: 768px) {
  .portfolio-split-root {
    flex-direction: column;
    height: auto;
    min-height: auto;
  }

  .portfolio-metrics-panel {
    flex: none;
  }

  .portfolio-chart-panel {
    flex: none;
    height: 180px;
  }

  .portfolio-amount {
    font-size: 1.25rem;
  }
}

@media (max-width: 480px) {
  .portfolio-amount {
    font-size: 1.125rem;
  }

  .timeframe-pill {
    padding: 3px 7px;
    font-size: 9px;
  }
}
</style>
