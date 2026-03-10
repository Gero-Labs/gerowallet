<template>
  <div class="portfolio-chart-root" :class="{ 'portfolio-chart-minified': isMinified }" style="position: relative; z-index: 1; align-content: center;" :style="{ height: isMinified ? 'auto' : '260px', minHeight: isMinified ? 'auto' : undefined }">
    <div v-if="isReadyToRender" class="portfolio-value-display">
      <div class="portfolio-header">
        <div class="portfolio-balance-section">
          <div class="portfolio-label">{{ $t('dashboard.portfolio') }}</div>
          <div class="portfolio-amount-row">
            <div
              class="portfolio-amount"
              @click="toggleCurrency"
              :class="{ clickable: availableCurrencies.length > 1 }"
            >
              <span class="currency-symbol">{{ currentCurrencyConfig.symbol }}</span>
              <OdometerCounter :value="Math.round(activePortfolioValue)" format="int" :duration="1000" :key="selectedCurrency" />
            </div>
            <div class="address-section" v-if="shortenAddress">
              <CopyButton
                :avatar="assets.walletSvg"
                :title="shortenAddress"
                :value="loggedWallet?.baseAddress || ''"
                x-small
              />
            </div>
          </div>
        </div>
      </div>

      <!-- P&L Summary — always visible with loading/empty states -->
      <div class="pnl-row">
        <!-- Loading state -->
        <template v-if="pnlLoading">
          <div class="pnl-chip pnl-loading">
            <span class="text-caption text--secondary">{{ $t('market.unrealizedPnlDetail') }}</span>
            <span class="pnl-skeleton"></span>
          </div>
          <div class="pnl-chip pnl-loading">
            <span class="text-caption text--secondary">{{ $t('market.realizedPnlDetail') }}</span>
            <span class="pnl-skeleton"></span>
          </div>
        </template>
        <!-- Data state -->
        <template v-else-if="totalRealizedPnl != null || totalUnrealizedPnl != null">
          <div class="pnl-chip">
            <span class="text-caption text--secondary">{{ $t('market.unrealizedPnlDetail') }}</span>
            <span
              class="pnl-value"
              :style="{ color: (totalUnrealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
            >
              {{ (totalUnrealizedPnl || 0) >= 0 ? '+' : '' }}{{ formatPnl(totalUnrealizedPnl || 0) }} &#x20B3;
            </span>
          </div>
          <div class="pnl-chip">
            <span class="text-caption text--secondary">{{ $t('market.realizedPnlDetail') }}</span>
            <span
              class="pnl-value"
              :style="{ color: (totalRealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
            >
              {{ (totalRealizedPnl || 0) >= 0 ? '+' : '' }}{{ formatPnl(totalRealizedPnl || 0) }} &#x20B3;
            </span>
          </div>
        </template>
        <!-- Empty state (loaded but no data) -->
        <template v-else>
          <div class="pnl-chip">
            <span class="text-caption text--secondary">{{ $t('market.unrealizedPnlDetail') }}</span>
            <span class="pnl-value" style="opacity: 0.35">—</span>
          </div>
          <div class="pnl-chip">
            <span class="text-caption text--secondary">{{ $t('market.realizedPnlDetail') }}</span>
            <span class="pnl-value" style="opacity: 0.35">—</span>
          </div>
        </template>
      </div>

      <!-- Chart Controls -->
      <div class="chart-controls-section">
        <!-- Empty left side for spacing -->
        <div></div>

        <!-- Right side controls group -->
        <div class="right-controls-group">
          <!-- Timeframe Pills -->
          <div v-show="!isMinified" class="timeframe-pills">
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

          <!-- Minify/Expand Toggle -->
          <v-tooltip bottom>
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                icon
                x-small
                class="ml-1"
                v-bind="attrs"
                v-on="on"
                @click="toggleMinified"
              >
                <v-icon small>{{ isMinified ? 'mdi-arrow-expand' : 'mdi-arrow-collapse' }}</v-icon>
              </v-btn>
            </template>
            <span>{{ isMinified ? $t('portfolio.expandChart') : $t('portfolio.minifyChart') }}</span>
          </v-tooltip>

          <!-- Chart Options Menu -->
          <v-menu v-show="!isMinified" offset-y left>
            <template v-slot:activator="{ on, attrs }">
              <v-btn
                icon
                x-small
                class="ml-2"
                v-bind="attrs"
                v-on="on"
              >
                <v-icon small>mdi-dots-vertical</v-icon>
              </v-btn>
            </template>
            <v-list dense>
              <!-- Portfolio Mode Toggle (Cardano only) -->
              <template v-if="!isApex">
                <v-list-item @click="togglePortfolioMode">
                  <v-list-item-icon class="mr-2">
                    <v-icon small>{{ portfolioMode === 'full' ? 'mdi-chart-line' : 'mdi-circle' }}</v-icon>
                  </v-list-item-icon>
                  <v-list-item-content>
                    <v-list-item-title>
                      {{ portfolioMode === 'full' ? $t('dashboard.fullPortfolio') : $t('dashboard.adaOnly') }}
                    </v-list-item-title>
                    <v-list-item-subtitle style="font-size: 10px;">
                      {{ portfolioMode === 'full' ? $t('dashboard.switchToAdaBalance') : $t('dashboard.switchToFullPortfolio') }}
                    </v-list-item-subtitle>
                  </v-list-item-content>
                </v-list-item>

                <v-divider></v-divider>
              </template>

              <!-- Refresh Button -->
              <v-list-item @click="handleRefresh" :disabled="isRefreshing">
                <v-list-item-icon class="mr-2">
                  <v-icon small :class="{ 'rotating': isRefreshing }">mdi-refresh</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title>{{ $t('dashboard.refreshData') }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>
    </div>

    <!-- Loading State -->
    <div v-if="globalLoading && !isMinified" class="loading-container">
      <v-progress-circular indeterminate color="primary" :size="50" :width="4"></v-progress-circular>
      <div class="loading-text">{{ $t('dashboard.loadingChart') }}</div>
    </div>

    <!-- Lightweight Charts Container -->
    <div
      ref="chartContainerRef"
      v-show="isReadyToRender && !isMinified"
      class="lw-chart-container"
    ></div>

    <!-- Crosshair Tooltip (positioned via direct DOM for zero-lag tracking) -->
    <div ref="tooltipRef" v-show="!isMinified" class="chart-tooltip" style="display: none;">
      <div class="tooltip-date"></div>
      <div class="tooltip-value"></div>
    </div>

    <!-- Empty State -->
    <v-card-text v-if="!hasAnyChartData && !globalLoading && !isMinified" style="font-size: 20px; align-content: center" class="text-center">
      <v-avatar size="24">
        <v-img :src="assets.walletSvg" :alt="$t('common.wallet')"></v-img>
      </v-avatar>
      <span>{{ $t('dashboard.noDataInWallet') }}</span>
    </v-card-text>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, onMounted, ref, watch, toRefs, nextTick, onBeforeUnmount } from 'vue';
import { createChart, AreaSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, AreaData, Time, SolidColor } from 'lightweight-charts';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
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

const { loggedWallet } = toRefs(walletStore);

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
});

// Define emits
const emit = defineEmits<{
  (e: 'refresh'): void;
  (e: 'update:minified', value: boolean): void;
}>();

// Refs
const chartContainerRef = ref<HTMLElement | null>(null);
const isRefreshing = ref(false);
const portfolioMode = ref<'full' | 'ada-only'>('full');
const selectedCurrency = ref<CurrencyType>(CurrencyType.ADA);
const selectedTimeframe = ref('WEEK');
const isMinified = ref(localStorage.getItem('chartMinified') === 'true');

// --- Minify toggle ---
const toggleMinified = () => {
  isMinified.value = !isMinified.value;
  try {
    localStorage.setItem('chartMinified', String(isMinified.value));
  } catch {
    // Silently fail
  }
  emit('update:minified', isMinified.value);

  // When expanding, reinitialize the chart after DOM updates
  if (!isMinified.value && hasAnyChartData.value) {
    nextTick(() => {
      setTimeout(() => {
        if (chart) {
          chart.applyOptions({
            width: chartContainerRef.value?.clientWidth || 0,
            height: chartContainerRef.value?.clientHeight || 0,
          });
          chart.timeScale().fitContent();
        } else {
          initChart();
        }
      }, 50);
    });
  }
};

// Chart instances
let chart: IChartApi | null = null;
let areaSeries: ISeriesApi<'Area'> | null = null;
let resizeObserver: ResizeObserver | null = null;
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

const togglePortfolioMode = () => {
  portfolioMode.value = portfolioMode.value === 'full' ? 'ada-only' : 'full';
  savePortfolioMode(portfolioMode.value);
  updateChartData();
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

const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME || loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

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
  if (props.progressiveLoading) {
    return props.loading || !hasAnyChartData.value;
  }
  return props.loading;
});

const isReadyToRender = computed(() => {
  return hasAnyChartData.value && !globalLoading.value;
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
  const isAdaOnly = portfolioMode.value === 'ada-only';
  switch (selectedCurrency.value) {
    case CurrencyType.USD:
      return (isAdaOnly ? props.adaOnlyChartDataUsd : props.chartDataUsd) || [];
    case CurrencyType.EUR:
      return (isAdaOnly ? props.adaOnlyChartDataEur : props.chartDataEur) || [];
    case CurrencyType.ADA:
    default:
      return (isAdaOnly ? props.adaOnlyChartData : props.chartData) || [];
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
const transformData = (rawData: any[]): AreaData<Time>[] => {
  if (!rawData || rawData.length === 0) return [];

  const now = Date.now();
  const cutoff = timeframeCutoffs[selectedTimeframe.value];
  const cutoffTime = cutoff ? now - cutoff : 0;

  // Use a Map to deduplicate by time (keep last value for duplicate timestamps)
  const timeMap = new Map<number, number>();

  for (const point of rawData) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [ts, val] = point;
    if (typeof ts !== 'number' || typeof val !== 'number' || isNaN(ts) || isNaN(val)) continue;
    if (cutoffTime > 0 && ts < cutoffTime) continue;
    const timeSec = Math.floor(ts / 1000);
    timeMap.set(timeSec, val);
  }

  // Convert to sorted array
  const result: AreaData<Time>[] = [];
  const sortedTimes = Array.from(timeMap.keys()).sort((a, b) => a - b);
  for (const time of sortedTimes) {
    result.push({ time: time as Time, value: timeMap.get(time)! });
  }

  return result;
};

/**
 * Determine trend direction: compare first and last values.
 */
const getTrendDirection = (data: AreaData<Time>[]): 'up' | 'down' => {
  if (data.length < 2) return 'up';
  return data[data.length - 1].value >= data[0].value ? 'up' : 'down';
};

// --- Chart initialization and update ---

const initChart = () => {
  if (!chartContainerRef.value) return;

  // Destroy existing chart
  destroyChart();

  const containerWidth = chartContainerRef.value.clientWidth || chartContainerRef.value.offsetWidth;
  const containerHeight = chartContainerRef.value.clientHeight || chartContainerRef.value.offsetHeight;

  if (containerWidth === 0 || containerHeight === 0) {
    // Retry after layout reflow
    setTimeout(() => initChart(), 100);
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

    // Create area series with default (up) colors; will be updated in updateChartData
    areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#00c7f3',
      lineWidth: 2,
      lineType: 2, // Curved (spline interpolation)
      topColor: 'rgba(0, 199, 243, 0.3)',
      bottomColor: 'rgba(0, 199, 243, 0)',
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#ffffff',
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBackgroundColor: '#00c7f3',
      priceLineVisible: false,
      lastValueVisible: false,
      priceFormat: {
        type: 'custom',
        formatter: (price: number) => {
          if (price >= 1e6) return (price / 1e6).toFixed(1) + 'M';
          if (price >= 1e3) return (price / 1e3).toFixed(1) + 'K';
          if (price >= 1) return price.toFixed(0);
          return price.toFixed(2);
        },
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
    chart.subscribeCrosshairMove((param: any) => {
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
      el.children[1].textContent = currentCurrencyConfig.value.symbol + formattedVal;

      // Position via transform3d (GPU composited, no layout thrash)
      if (param.point && chartContainerRef.value) {
        const containerRect = chartContainerRef.value.getBoundingClientRect();
        const rootEl = chartContainerRef.value.closest('.portfolio-chart-root') as HTMLElement;
        if (rootEl) {
          const rootRect = rootEl.getBoundingClientRect();
          const x = param.point.x + (containerRect.left - rootRect.left);
          const y = param.point.y + (containerRect.top - rootRect.top);
          const tooltipWidth = 160;
          const tx = x + 12 + tooltipWidth > rootRect.width ? x - tooltipWidth - 12 : x + 12;
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

const updateChartData = (animate = true) => {
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

  // Always use Gero brand teal for the chart
  areaSeries.applyOptions({
    lineColor: '#00c7f3',
    topColor: 'rgba(0, 199, 243, 0.3)',
    bottomColor: 'rgba(0, 199, 243, 0)',
    crosshairMarkerBackgroundColor: '#00c7f3',
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

const handleTimeframeClick = (tabItem: TimeframeTab) => {
  selectedTimeframe.value = tabItem.value;
  saveTimeframeSetting(tabItem.value);
  updateChartData();
};

// --- Watchers ---

// Watch for chart data changes (progressive loading and standard)
watch(
  () => [props.chartData, props.chartDataUsd, props.chartDataEur],
  () => {
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
  destroyChart();
});
</script>

<style scoped>
/* Chart container positioned at the bottom of the 212px block */
.lw-chart-container {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 165px;
  width: 100%;
  pointer-events: auto;
  animation: chartFadeIn 0.4s ease-out;
}

@keyframes chartFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.pnl-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  pointer-events: auto;
}

.pnl-chip {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pnl-value {
  font-family: 'Roboto Mono', monospace;
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  font-weight: 500;
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

/* Portfolio Value Display — transparent to chart interaction */
.portfolio-value-display {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  pointer-events: none;
}

.portfolio-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 0 16px;
}

.portfolio-balance-section {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.portfolio-label {
  font-size: 0.875rem;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 4px;
}

.portfolio-amount-row {
  display: flex;
  align-items: center;
  gap: 16px;
}

.portfolio-amount {
  font-size: 1.5rem;
  font-weight: 600;
  color: #ffffff;
  display: inline-flex;
  align-items: baseline;
  gap: 0.1em;
  transition: opacity 0.2s ease;
}

.portfolio-amount.clickable {
  cursor: pointer;
  pointer-events: auto;
}

.portfolio-amount.clickable:hover {
  opacity: 0.8;
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
  pointer-events: auto;
}

/* Chart Controls Section */
.chart-controls-section {
  position: absolute;
  top: 0;
  left: 16px;
  right: 56px; /* Clear space for chart y-axis labels */
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
  gap: 12px;
  pointer-events: auto;
}

/* Right side controls group */
.right-controls-group {
  display: flex;
  align-items: center;
  gap: 8px;
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

/* Responsive adjustments */
@media (max-width: 960px) {
  .portfolio-header {
    flex-direction: column;
    gap: 12px;
  }

  .chart-controls-section {
    left: 0;
    right: 80px; /* Extra clearance for y-axis when chart is full-width */
  }

  .portfolio-amount {
    font-size: 1.25rem;
  }
}

@media (max-width: 600px) {
  .portfolio-amount-row {
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
  }

  .portfolio-amount {
    font-size: 1.125rem;
  }

  .timeframe-pill {
    padding: 3px 7px;
    font-size: 9px;
  }
}

/* Minified state */
.portfolio-chart-minified .portfolio-value-display {
  position: relative;
}

.portfolio-chart-minified .chart-controls-section {
  position: relative;
  left: auto;
  right: auto;
  padding: 0 16px;
  justify-content: flex-end;
}

/* Refresh animation */
.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Loading State */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 60px 20px;
  min-height: 200px;
}

.loading-text {
  font-size: 16px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.7);
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% {
    opacity: 0.5;
  }
  50% {
    opacity: 1;
  }
}

/* Crosshair Tooltip — positioned via transform3d for GPU compositing */
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
</style>
