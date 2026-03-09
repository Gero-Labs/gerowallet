<template>
  <div class="portfolio-chart-root" style="position: relative; z-index: 1; align-content: center; height: 212px">
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

      <!-- P&L Summary -->
      <div v-if="totalRealizedPnl != null || totalUnrealizedPnl != null" class="d-flex align-center px-4 pb-2" style="gap: 16px">
        <div class="pnl-item">
          <span class="text-caption text--secondary">{{ $t('market.unrealizedPnlDetail') }}</span>
          <span
            class="text-body-2 font-weight-medium"
            :style="{ color: (totalUnrealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
          >
            {{ (totalUnrealizedPnl || 0) >= 0 ? '+' : '' }}{{ formatPnl(totalUnrealizedPnl || 0) }} &#x20B3;
          </span>
        </div>
        <div class="pnl-item">
          <span class="text-caption text--secondary">{{ $t('market.realizedPnlDetail') }}</span>
          <span
            class="text-body-2 font-weight-medium"
            :style="{ color: (totalRealizedPnl || 0) >= 0 ? '#47CD89' : '#F97066' }"
          >
            {{ (totalRealizedPnl || 0) >= 0 ? '+' : '' }}{{ formatPnl(totalRealizedPnl || 0) }} &#x20B3;
          </span>
        </div>
      </div>

      <!-- Chart Controls -->
      <div class="chart-controls-section">
        <!-- Empty left side for spacing -->
        <div></div>

        <!-- Right side controls group -->
        <div class="right-controls-group">
          <!-- Timeframe Pills -->
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

          <!-- Chart Options Menu -->
          <v-menu offset-y left>
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
    <div v-if="globalLoading" class="loading-container">
      <v-progress-circular indeterminate color="primary" :size="50" :width="4"></v-progress-circular>
      <div class="loading-text">{{ $t('dashboard.loadingChart') }}</div>
    </div>

    <!-- Lightweight Charts Container -->
    <div
      ref="chartContainerRef"
      v-show="isReadyToRender"
      class="lw-chart-container"
    ></div>

    <!-- Empty State -->
    <v-card-text v-if="!hasAnyChartData && !globalLoading" style="font-size: 20px; align-content: center" class="text-center">
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
});

// Define emits
const emit = defineEmits<{
  (e: 'refresh'): void;
}>();

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

const primaryColor = computed(() => {
  return isApex.value ? '#dc753e' : '#00c7f3';
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
        visible: false,
        borderVisible: false,
      },
      timeScale: {
        visible: false,
        borderVisible: false,
      },
      crosshair: {
        mode: 0, // CrosshairMode.Normal
        vertLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 2, // LineStyle.Dashed
          labelVisible: false,
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.2)',
          width: 1,
          style: 2,
          labelVisible: false,
        },
      },
      handleScroll: false,
      handleScale: false,
    });

    if (!chart) return;

    // Create area series with default (up) colors; will be updated in updateChartData
    areaSeries = chart.addSeries(AreaSeries, {
      lineColor: '#47CD89',
      lineWidth: 2,
      topColor: 'rgba(71, 205, 137, 0.3)',
      bottomColor: 'rgba(71, 205, 137, 0)',
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: '#ffffff',
      crosshairMarkerBorderWidth: 2,
      crosshairMarkerBackgroundColor: '#47CD89',
      priceLineVisible: false,
      lastValueVisible: false,
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

    // Populate with data
    updateChartData();

  } catch (error) {
    console.error('PortfolioChart: Failed to initialize chart:', error);
  }
};

const updateChartData = () => {
  if (!areaSeries || !chart) return;

  const rawData = activeChartData.value;
  const chartData = transformData(rawData);

  if (chartData.length === 0) {
    areaSeries.setData([]);
    return;
  }

  // Determine trend and apply colors
  const trend = getTrendDirection(chartData);
  const lineColor = trend === 'up' ? '#47CD89' : '#F97066';
  const topColor = trend === 'up' ? 'rgba(71, 205, 137, 0.3)' : 'rgba(249, 112, 102, 0.3)';
  const bottomColor = trend === 'up' ? 'rgba(71, 205, 137, 0)' : 'rgba(249, 112, 102, 0)';

  areaSeries.applyOptions({
    lineColor,
    topColor,
    bottomColor,
    crosshairMarkerBackgroundColor: lineColor,
  });

  areaSeries.setData(chartData);
  chart.timeScale().fitContent();
};

const destroyChart = () => {
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
        updateChartData();
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
  updateChartData();
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
          if (chart) {
            updateChartData();
          } else {
            initChart();
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
        if (!chart) {
          initChart();
        } else {
          updateChartData();
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
  height: 110px;
  width: 100%;
  pointer-events: auto;
}

.pnl-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Portfolio Value Display */
.portfolio-value-display {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 10;
  pointer-events: auto;
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
}

/* Chart Controls Section */
.chart-controls-section {
  position: absolute;
  top: 0;
  left: 16px;
  right: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
  gap: 12px;
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
    position: relative;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    left: 0;
    right: 0;
  }

  .right-controls-group {
    flex-direction: column;
    gap: 6px;
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
</style>
