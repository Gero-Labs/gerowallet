<template>
  <div style="position: relative; z-index: 1; align-content: center; height: 212px" class="text-center justify-center">
    <div v-if="chartData && chartData.length > 0 && !loading" class="portfolio-value-display">
      <div class="portfolio-header">
        <div class="portfolio-balance-section">
          <div class="portfolio-label">Portfolio</div>
          <div class="portfolio-amount-row">
            <div class="portfolio-amount" @click="toggleCurrency">
              {{ formatPortfolioValue() }}
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

      <!-- Chart Controls -->
      <div class="chart-controls-section">
        <!-- Empty left side for spacing -->
        <div></div>

        <!-- Right side controls group -->
        <div class="right-controls-group">
          <!-- Date Picker Tabs -->
          <div class="date-picker-tabs">
            <v-tabs
              v-model="selectedTabIndex"
              background-color="transparent"
              style="width: fit-content"
              height="28"
              active-class="white--text"
              slider-color="white"
            >
              <v-tab
                v-for="(tabItem, index) in Object.values(tabs)"
                :key="`${tabItem.value}_${index}`"
                style="font-size: 10px; letter-spacing: normal; min-width: 50px"
                @click="handleTabClick(tabItem)"
                :disabled="isDisabled(tabItem)"
                >{{ tabItem.label }}
              </v-tab>
            </v-tabs>
          </div>

          <!-- Series Toggle Buttons (next to date picker) -->
          <!-- COMMENTED OUT: Dual-axis functionality
          <div class="series-toggle-buttons">
            <v-btn-toggle
              v-model="activeSeriesToggle"
              background-color="transparent"
              multiple
              dense
              class="series-toggle compact"
            >
              <v-btn
                x-small
                :value="'ada'"
                :color="showAda ? (isApex ? '#dc753e' : '#00c7f3') : 'grey'"
                @click="toggleAdaSeries"
                class="toggle-btn compact"
              >
                {{ networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network) }}
              </v-btn>
              <v-btn
                x-small
                :value="'usd'"
                :color="showUsd ? '#4CAF50' : 'grey'"
                @click="toggleUsdSeries"
                class="toggle-btn compact"
              >
                USD
              </v-btn>
              <v-btn
                x-small
                :color="showDualAxis ? (isApex ? '#dc753e' : '#00c7f3') : 'grey'"
                @click="toggleDualAxis"
                class="toggle-btn dual-axis-btn compact"
                :disabled="!showAda || !showUsd"
              >
                <v-icon x-small>mdi-chart-line</v-icon>
              </v-btn>
            </v-btn-toggle>
          </div>
          -->
        </div>
      </div>
    </div>
    <div id="highstock-chart" v-show="chartData && chartData.length > 0" style="margin-top: 40px"></div>
    <v-card-text
      v-if="!chartData || (chartData.length === 0 && !loading)"
      style="font-size: 20px; align-content: center"
    >
      <v-avatar size="24" v-if="!loading">
        <v-img :src="assets.walletSvg" alt="Wallet"></v-img>
      </v-avatar>
      <span v-else>There seems to be no data in this wallet</span>
    </v-card-text>
    <v-progress-circular v-if="loading" :indeterminate="true"></v-progress-circular>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, toRefs } from 'vue';
import Highstock from 'highcharts/highstock';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import assets from '@/utils/assets';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { Blockchain } from '@/models/types';
import CopyButton from '@/shared/components/CopyButton.vue';

// Currency Types
enum CurrencyType {
  NATIVE = 'NATIVE', // ADA/APEX etc - зависит от сети
  USD = 'USD',
  EUR = 'EUR',
}

interface CurrencyConfig {
  symbol: string;
  displayName: string;
  color?: string; // Optional: используем primaryColor если не указан
}

// Currency Configuration
const currencyConfigs: Record<CurrencyType, CurrencyConfig> = {
  [CurrencyType.NATIVE]: {
    symbol: '', // Будет определено динамически
    displayName: 'Native Currency',
  },
  [CurrencyType.USD]: {
    symbol: '$',
    displayName: 'US Dollar',
  },
  [CurrencyType.EUR]: {
    symbol: '€',
    displayName: 'Euro',
  },
};

const { loggedWallet } = toRefs(walletStore);
const { price } = toRefs(networkStore);

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
});

// Load tab preference from localStorage or default to WEEK (7D)
const loadPortfolioTabSetting = (): string => {
  try {
    return localStorage.getItem('portfolioTab') || 'WEEK';
  } catch {
    return 'WEEK';
  }
};

// Save tab preference to localStorage
const savePortfolioTabSetting = (tabValue: string): void => {
  try {
    localStorage.setItem('portfolioTab', tabValue);
  } catch {
    // Silently fail if localStorage is not available
  }
};

const tab = ref({ value: loadPortfolioTabSetting() || 'WEEK', label: '7D', vsLabel: 'vs last week' });
const lastPrice = ref(1);
const chartInstance = ref(null);
const selectedTabIndex = ref(4); // Default to WEEK tab (index 4 = 7D)
const selectedCurrency = ref<CurrencyType>(CurrencyType.NATIVE); // Current selected currency

const tabs = {
  YEAR: { value: 'YEAR', label: '12M', vsLabel: 'vs last year' },
  QUARTER: { value: 'QUARTER', label: '3M', vsLabel: 'vs last quarter' },
  MONTH: { value: 'MONTH', label: '30D', vsLabel: 'vs last month' },
  WEEK: { value: 'WEEK', label: '7D', vsLabel: 'vs last week' },
  DAY: { value: 'DAY', label: '1D', vsLabel: 'vs last day' },
};

// Computed properties
const isApex = computed(() => {
  return loggedWallet.value?.chain === Blockchain.APEX_PRIME || loggedWallet.value?.chain === Blockchain.APEX_VECTOR;
});

const chartColors = computed(() => {
  if (isApex.value) {
    return [
      '#dc753e',
      '#e67e22',
      '#d35400',
      '#f39c12',
      '#ff8c42',
      '#a0522d',
      '#cd853f',
      '#ff7f50',
      '#ffa500',
      '#ff6347',
    ];
  } else {
    return [
      '#00DFF3',
      '#155B75',
      '#167dd6',
      '#900C3F',
      '#511849',
      '#3D3D6B',
      '#2A7B9B',
      '#00BAAD',
      '#57C785',
      '#ADD45C',
    ];
  }
});

const primaryColor = computed(() => {
  return isApex.value ? '#dc753e' : '#00c7f3';
});

const shortenAddress = computed(() => {
  return loggedWallet.value?.baseAddress ? filters.shortenStringWithEllipsis(loggedWallet.value.baseAddress, 14) : '';
});

// Currency system computed properties
const nativeCurrencySymbol = computed(() => {
  return networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const currentCurrencyConfig = computed(() => {
  const config = { ...currencyConfigs[selectedCurrency.value] };
  if (selectedCurrency.value === CurrencyType.NATIVE) {
    config.symbol = nativeCurrencySymbol.value;
    config.displayName = `${nativeCurrencySymbol.value} Balance`;
  }
  return config;
});

const activeChartData = computed(() => {
  switch (selectedCurrency.value) {
    case CurrencyType.USD:
      return props.chartDataUsd;
    case CurrencyType.EUR:
      return props.chartDataEur;
    case CurrencyType.NATIVE:
    default:
      return props.chartData;
  }
});

const activePortfolioValue = computed(() => {
  switch (selectedCurrency.value) {
    case CurrencyType.USD:
      return props.portfolioValueUsd;
    case CurrencyType.EUR:
      return props.portfolioValueEur;
    case CurrencyType.NATIVE:
    default:
      return props.portfolioValueAda;
  }
});

const availableCurrencies = computed(() => {
  const currencies = [CurrencyType.NATIVE];

  if (props.chartDataUsd.length > 0 || props.portfolioValueUsd > 0) {
    currencies.push(CurrencyType.USD);
  }

  if (props.chartDataEur.length > 0 || props.portfolioValueEur > 0) {
    currencies.push(CurrencyType.EUR);
  }

  return currencies;
});

// Portfolio value formatting for any currency
const formatPortfolioValue = (): string => {
  const value = activePortfolioValue.value;
  const config = currentCurrencyConfig.value;

  if (value > 0) {
    return filters.toCurrency(value, false, 2, config.symbol, '', true, 0);
  }

  // Fallback
  return `${config.symbol}0.00`;
};

const toggleCurrency = (): void => {
  const availableCurrs = availableCurrencies.value;
  const currentIndex = availableCurrs.indexOf(selectedCurrency.value);
  const nextIndex = (currentIndex + 1) % availableCurrs.length;
  selectedCurrency.value = availableCurrs[nextIndex];
};

// COMMENTED OUT: Dual-axis toggle functions
// // Series toggle functions
// const toggleAdaSeries = (): void => {
//   showAda.value = !showAda.value;
//   updateActiveToggle();
//   if (props.chartData.length > 0 || props.chartDataUsd.length > 0) {
//     loadChart(props.chartData);
//   }
// };

// const toggleUsdSeries = (): void => {
//   showUsd.value = !showUsd.value;
//   updateActiveToggle();
//   if (props.chartData.length > 0 || props.chartDataUsd.length > 0) {
//     loadChart(props.chartData);
//   }
// };

// const toggleDualAxis = (): void => {
//   if (showAda.value && showUsd.value) {
//     showDualAxis.value = !showDualAxis.value;
//     if (props.chartData.length > 0 || props.chartDataUsd.length > 0) {
//       loadChart(props.chartData);
//     }
//   }
// };

// const updateActiveToggle = (): void => {
//   activeSeriesToggle.value = [];
//   if (showAda.value) activeSeriesToggle.value.push('ada');
//   if (showUsd.value) activeSeriesToggle.value.push('usd');
// };

// Format numbers with K, M, B abbreviations for Y-axis
const formatAxisNumber = (value: number, currency: string = ''): string => {
  const absValue = Math.abs(value);
  let formattedValue: string;

  if (absValue >= 1000000000) {
    formattedValue = (value / 1000000000).toFixed(1) + 'B';
  } else if (absValue >= 1000000) {
    formattedValue = (value / 1000000).toFixed(1) + 'M';
  } else if (absValue >= 1000) {
    formattedValue = (value / 1000).toFixed(1) + 'K';
  } else {
    formattedValue = value.toFixed(0);
  }

  // Remove unnecessary .0 decimals
  formattedValue = formattedValue.replace(/\.0([KMB])$/, '$1');

  return currency ? `${currency}${formattedValue}` : formattedValue;
};

// Create chart series based on selected currency
const createChartSeries = (): any[] => {
  const series = [];

  const activeData = activeChartData.value;
  const config = currentCurrencyConfig.value;
  const seriesColor = primaryColor.value;

  if (activeData && activeData.length > 0) {
    series.push({
      type: 'areaspline',
      name: config.displayName,
      data: activeData,
      showInLegend: false, // Hide legend for single series
      color: seriesColor,
      marker: {
        symbol: 'circle',
        enabled: false,
        radius: 3,
        lineWidth: 1,
        lineColor: null,
      },
      fillColor: {
        linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
        stops: [
          [0.1, seriesColor + '33'],
          [1, seriesColor + '00'],
        ],
      },
    });
  }

  console.log('Total series created:', series.length, 'for', selectedCurrency.value, config.displayName);
  return series;
};

// COMMENTED OUT: Original dual-axis version
// const createChartSeries = (chartData: any[]): any[] => {
//   console.log('Creating chart series:');
//   console.log('ADA chartData:', chartData.length, 'points');
//   console.log('USD chartDataUsd:', props.chartDataUsd.length, 'points');
//   console.log('Sample ADA data point:', chartData[0]);
//   console.log('Sample USD data point:', props.chartDataUsd[0]);
//
//   const series = [];
//
//   if (showAda.value && chartData.length > 0) {
//     console.log('Adding ADA series with', chartData.length, 'points');
//     series.push({
//       type: "areaspline",
//       name: "ADA Balance",
//       data: chartData,
//       showInLegend: true,
//       yAxis: showDualAxis.value ? 0 : undefined,
//       color: primaryColor.value,
//       marker: {
//         symbol: "circle",
//         enabled: false,
//         radius: 3,
//         lineWidth: 1,
//         lineColor: null,
//       },
//       fillColor: {
//         linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
//         stops: [
//           [0.1, primaryColor.value + '33'],
//           [1, primaryColor.value + '00'],
//         ],
//       },
//     });
//   }
//
//   if (showUsd.value) {
//     // Use dedicated USD data if available, otherwise calculate from ADA data
//     const usdData = props.chartDataUsd.length > 0
//       ? props.chartDataUsd
//       : price.value?.lastPrice && chartData.length > 0
//         ? chartData.map(point => [
//             point[0], // timestamp
//             point[1] * price.value.lastPrice // ADA value * current price (not historical)
//           ])
//         : [];
//
//     console.log('USD data source:', props.chartDataUsd.length > 0 ? 'props.chartDataUsd' : 'calculated from ADA');
//     console.log('USD data length:', usdData.length);
//     console.log('Sample USD data:', usdData[0]);
//
//     if (usdData.length > 0) {
//       console.log('Adding USD series with', usdData.length, 'points');
//       series.push({
//         type: "areaspline",
//         name: "USD Balance",
//         data: usdData,
//         showInLegend: true,
//         yAxis: showDualAxis.value ? 1 : undefined,
//         color: "#4CAF50",
//         marker: {
//           symbol: "circle",
//           enabled: false,
//           radius: 3,
//           lineWidth: 1,
//           lineColor: null,
//         },
//         fillColor: {
//           linearGradient: { x1: 0, x2: 0, y1: 0, y2: 1 },
//           stops: [
//             [0.1, '#4CAF5033'],
//             [1, '#4CAF5000'],
//           ],
//         },
//       });
//     }
//   }
//
//
//   console.log('Total series created:', series.length);
//   return series;
// };
const loadChart = () => {
  const activeData = activeChartData.value;
  const config = currentCurrencyConfig.value;

  if (!activeData || !activeData.length) {
    return;
  }

  console.log('Loading chart with', selectedCurrency.value, 'data, length:', activeData.length);

  // Initial Y-axis will auto-scale, then be updated by time filtering
  const axisRange = null; // Let Highcharts auto-scale initially

  // Ensure the chart container is visible before rendering
  const chartContainer = document.getElementById('highstock-chart');
  if (!chartContainer || chartContainer.style.display === 'none') {
    return;
  }

  // Destroy existing chart instance before creating a new one
  if (chartInstance.value) {
    try {
      chartInstance.value.destroy();
    } catch (error) {
      console.warn('Error destroying chart:', error);
    }
    chartInstance.value = null;
  }

  // COMMENTED OUT: Dual-axis Y-axis update throttling
  // Create throttled version of Y-axis update for performance
  // let yAxisUpdateTimeout: NodeJS.Timeout | null = null;
  // const throttledYAxisUpdate = (min: number, max: number) => {
  //   if (yAxisUpdateTimeout) {
  //     clearTimeout(yAxisUpdateTimeout);
  //   }
  //   yAxisUpdateTimeout = setTimeout(() => {
  //     updateYAxisRange(min, max);
  //     yAxisUpdateTimeout = null;
  //   }, 100); // Reduced frequency
  // };

  const currency = config.symbol;
  const data = {
    accessibility: {
      enabled: false,
    },
    title: {
      useHTML: true,
      floating: true,
      align: 'left',
      text: '',
      style: {
        fontSize: '14px',
      },
    },
    chart: {
      spacingLeft: 0,
      spacingRight: 0,
      backgroundColor: 'transparent',
      height: 184,
      style: {
        fontFamily: 'Quicksand',
      },
      zoomType: 'x', // Enable horizontal selection/dragging only
      panning: {
        enabled: false, // Disable panning completely
      },
      zooming: {
        mouseWheel: {
          enabled: false, // Disable mouse wheel zooming
        },
      },
    },
    rangeSelector: {
      enabled: false,
      inputEnabled: false,
    },
    scrollbar: {
      enabled: false,
    },
    navigator: {
      enabled: false,
    },
    credits: {
      enabled: false,
    },
    tooltip: {
      backgroundColor: 'rgb(12,14,18)',
      borderColor: '#1F242F',
      style: {
        fontFamily: 'Inter',
        color: '#fff',
      },
      // COMMENTED OUT: Dual-axis tooltip
      shared: false,
      formatter: function (this: any) {
        const formattedValue = filters.toCurrency(this.y, false, 2, currency, '', true, 0);
        return `${new Date(this.x).toLocaleString()}<br> <b>${formattedValue}</b>`;
      },
      // COMMENTED OUT: Original dual-axis tooltip
      // shared: showDualAxis.value,
      // formatter: function () {
      //   if (showDualAxis.value && this.points) {
      //     let tooltipContent = `<span style="font-size: 12px">${new Date(this.x).toLocaleString()}</span><br/>`;
      //     this.points.forEach((point) => {
      //       const seriesColor = point.color;
      //       const value = point.y;
      //       const seriesName = point.series.name;
      //       const formattedValue = seriesName === 'ADA Balance'
      //         ? filters.toCurrency(value, false, 2, currency, '', true, 0)
      //         : filters.toCurrency(value, false, 2, '$', '', true, 0);
      //       tooltipContent += `<span style="color:${seriesColor}">●</span> ${seriesName}: <b>${formattedValue}</b><br/>`;
      //     });
      //     return tooltipContent;
      //   } else {
      //     const formattedValue = this.series.name === 'USD Balance'
      //       ? filters.toCurrency(this.y, false, 2, '$', '', true, 0)
      //       : filters.toCurrency(this.y, false, 2, currency, '', true, 0);
      //     return `${new Date(this.key).toLocaleString()}<br> <b>${formattedValue}</b>`;
      //   }
      // }
    },
    xAxis: {
      crosshair: true,
      allowDecimals: false,
      title: {
        enabled: false,
        text: 'Time',
      },
      labels: {
        style: {
          fontFamily: 'Inter',
          color: '#fff',
        },
      },
      // COMMENTED OUT: Dual-axis Y-axis update events
      // events: {
      //   // Handle drag selection only (no wheel zoom)
      //   afterSetExtremes: function(e) {
      //     // Only trigger on user drag selection, not wheel zoom
      //     if (e.trigger === 'zoom') {
      //       throttledYAxisUpdate(e.min, e.max);
      //     }
      //   }
      // },
    },
    // COMMENTED OUT: Dual-axis configuration
    // Simple single Y-axis for ADA data
    yAxis: {
      allowDecimals: false,
      min: axisRange?.min,
      max: axisRange?.max,
      labels: {
        style: {
          color: '#fff',
        },
        formatter: function (this: any) {
          return formatAxisNumber(this.value, currency);
        },
      },
      opposite: true,
      plotLines: [
        {
          value: 0,
          width: 1,
          color: '#3d3d3d',
        },
      ],
    },
    // COMMENTED OUT: Original dual-axis configuration
    // yAxis: showDualAxis.value ? [
    //   {
    //     // Left axis for ADA
    //     allowDecimals: false,
    //     min: axisRange?.min,
    //     max: axisRange?.max,
    //     labels: {
    //       style: {
    //         color: primaryColor.value,
    //       },
    //       formatter: function() {
    //         return formatAxisNumber(this.value, currency);
    //       }
    //     },
    //     title: {
    //       text: `${currency} Value`,
    //       style: {
    //         color: primaryColor.value,
    //         fontSize: '12px'
    //       }
    //     },
    //     opposite: false,
    //     gridLineColor: '#2a2a2a',
    //     plotLines: [
    //       {
    //         value: 0,
    //         width: 1,
    //         color: "#3d3d3d",
    //       },
    //     ],
    //   },
    //   {
    //     // Right axis for USD (synchronized range)
    //     allowDecimals: false,
    //     min: axisRange?.min,
    //     max: axisRange?.max,
    //     labels: {
    //       style: {
    //         color: "#4CAF50",
    //       },
    //       formatter: function() {
    //         return formatAxisNumber(this.value, '$');
    //       }
    //     },
    //     title: {
    //       text: 'USD Value',
    //       style: {
    //         color: '#4CAF50',
    //         fontSize: '12px'
    //       }
    //     },
    //     opposite: true,
    //     gridLineColor: 'transparent', // Hide grid lines on right axis to avoid overlap
    //     plotLines: [
    //       {
    //         value: 0,
    //         width: 1,
    //         color: "#3d3d3d",
    //       },
    //     ],
    //   }
    // ] : {
    //   allowDecimals: false,
    //   min: axisRange?.min,
    //   max: axisRange?.max,
    //   labels: {
    //     style: {
    //       color: "#fff",
    //     },
    //     formatter: function() {
    //       // For single axis mode, determine currency based on active series
    //       const isUsdOnly = showUsd.value && !showAda.value;
    //       const currency = isUsdOnly ? '$' : networks.resolveCurrencySymbol(loggedWallet.value?.chain, loggedWallet.value?.network);
    //       return formatAxisNumber(this.value, currency);
    //     }
    //   },
    //   opposite: true,
    //   plotLines: [
    //     {
    //       value: 0,
    //       width: 1,
    //       color: "#3d3d3d",
    //     },
    //   ],
    // },
    colors: chartColors.value,
    legend: {
      align: 'right',
      verticalAlign: 'middle',
      layout: 'vertical',
    },
    series: createChartSeries(),
    useUTC: true,
  };
  chartInstance.value = Highstock.stockChart('highstock-chart', data as any);

  // Completely disable wheel events on chart container (reuse existing chartContainer variable)
  if (chartContainer) {
    chartContainer.addEventListener(
      'wheel',
      e => {
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false }
    );
  }
};

const arraysEqual = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; ++i) {
    if (Array.isArray(a[i]) && Array.isArray(b[i])) {
      if (!arraysEqual(a[i], b[i])) return false;
    } else if (a[i] !== b[i]) return false;
  }
  return true;
};

const isDisabled = tabItem => {
  if (!props.chartData || !props.chartData[props.chartData.length - 1]) {
    return true;
  }
  const lastTxTime = props.chartData[props.chartData.length - 1][0];
  if (tabItem.value === 'DAY') {
    return (new Date().getTime() - lastTxTime) / 1000 / 24 / 60 / 60 > 1;
  } else if (tabItem.value === 'WEEK') {
    return (new Date().getTime() - lastTxTime) / 1000 / 24 / 60 / 60 > 7;
  } else if (tabItem.value === 'MONTH') {
    return (new Date().getTime() - lastTxTime) / 1000 / 24 / 60 / 60 > 30;
  } else if (tabItem.value === 'QUARTER') {
    return (new Date().getTime() - lastTxTime) / 1000 / 24 / 60 / 60 > 90;
  } else if (tabItem.value === 'YEAR') {
    return (new Date().getTime() - lastTxTime) / 1000 / 24 / 60 / 60 > 365;
  }
  return false;
};

const handleTabClick = tabItem => {
  tab.value = tabItem;

  // Save tab preference to localStorage
  savePortfolioTabSetting(tabItem.value);

  let start = new Date();
  const end = new Date();
  if (tabItem.value === tabs.YEAR.value) {
    start = new Date(start.setFullYear(end.getFullYear() - 1));
  } else if (tabItem.value === tabs.QUARTER.value) {
    start = new Date(start.setUTCMonth(end.getUTCMonth() - 3));
  } else if (tabItem.value === tabs.MONTH.value) {
    start = new Date(start.setUTCDate(end.getUTCDate() - 30));
  } else if (tabItem.value === tabs.WEEK.value) {
    start = new Date(start.setUTCDate(end.getUTCDate() - 7));
  } else if (tabItem.value === tabs.DAY.value) {
    start = new Date(start.setUTCHours(end.getUTCHours() - 24));
  } else {
    start = new Date(Date.parse('27 Sep 2017 00:00:00 GMT'));
  }
  const startUTC = Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
    start.getUTCHours(),
    start.getUTCMinutes(),
    start.getUTCSeconds()
  );
  const endUTC = Date.UTC(
    end.getUTCFullYear(),
    end.getUTCMonth(),
    end.getUTCDate(),
    end.getUTCHours(),
    end.getUTCMinutes(),
    end.getUTCSeconds()
  );

  if (chartInstance.value?.xAxis) {
    // Set time range first
    chartInstance.value.xAxis[0].setExtremes(startUTC, endUTC);

    // COMMENTED OUT: Dual-axis Y-axis range update
    // setTimeout(() => {
    //   console.log('Executing scheduled Y-axis update...');
    //   updateYAxisRange(startUTC, endUTC);
    // }, 50);

    if (chartInstance.value?.title) {
      chartInstance.value.title.update({ text: '' });
    }
  }
};

// COMMENTED OUT: Dual-axis Y-axis range update
// Optimized Y-axis range update
// const updateYAxisRange = (startTime: number, endTime: number) => {
//   if (!chartInstance.value || !chartInstance.value.yAxis) return;
//
//   // Early exit if no data
//   if (!props.chartData.length && !props.chartDataUsd.length) return;
//
//   // Efficient binary search for time range filtering (assuming sorted data)
//   const findDataInRange = (data: [number, number][]) => {
//     if (!data.length) return [];
//
//     let start = 0;
//     let end = data.length - 1;
//
//     // Find start index
//     while (start < data.length && data[start][0] < startTime) start++;
//
//     // Find end index
//     while (end >= 0 && data[end][0] > endTime) end--;
//
//     return data.slice(start, end + 1);
//   };
//
//   const visibleAdaData = showAda.value ? findDataInRange(props.chartData) : [];
//   const visibleUsdData = showUsd.value ? findDataInRange(props.chartDataUsd) : [];
//
//   // Calculate ranges efficiently
//   if (showDualAxis.value && chartInstance.value.yAxis.length > 1) {
//     // ADA axis (left)
//     if (visibleAdaData.length > 0) {
//       let adaMin = Infinity, adaMax = -Infinity;
//       for (const point of visibleAdaData) {
//         if (point[1] < adaMin) adaMin = point[1];
//         if (point[1] > adaMax) adaMax = point[1];
//       }
//       const adaPadding = (adaMax - adaMin) * 0.05;
//       chartInstance.value.yAxis[0].setExtremes(
//         Math.max(0, adaMin - adaPadding),
//         adaMax + adaPadding,
//         false // Don't redraw yet
//       );
//     }
//
//     // USD axis (right)
//     if (visibleUsdData.length > 0) {
//       let usdMin = Infinity, usdMax = -Infinity;
//       for (const point of visibleUsdData) {
//         if (point[1] < usdMin) usdMin = point[1];
//         if (point[1] > usdMax) usdMax = point[1];
//       }
//       const usdPadding = (usdMax - usdMin) * 0.05;
//       chartInstance.value.yAxis[1].setExtremes(
//         Math.max(0, usdMin - usdPadding),
//         usdMax + usdPadding,
//         true // Redraw after both axes are set
//       );
//     }
//   } else {
//     // Single axis mode
//     const allVisibleData = [...visibleAdaData, ...visibleUsdData];
//     if (allVisibleData.length === 0) return;
//
//     let dataMin = Infinity, dataMax = -Infinity;
//     for (const point of allVisibleData) {
//       if (point[1] < dataMin) dataMin = point[1];
//       if (point[1] > dataMax) dataMax = point[1];
//     }
//
//     const padding = (dataMax - dataMin) * 0.05;
//     chartInstance.value.yAxis[0].setExtremes(
//       Math.max(0, dataMin - padding),
//       dataMax + padding
//     );
//   }
// };

const generateTitleText = () => {
  return '';
};
watch(
  price,
  newVal => {
    lastPrice.value = newVal.lastPrice;
    if (chartInstance.value?.title) {
      chartInstance.value.title.update({ text: generateTitleText() });
    }
  },
  { deep: true }
);

// Watch currency chart data
watch(
  () => [props.chartData, props.chartDataUsd, props.chartDataEur],
  (newValues, oldValues) => {
    // Handle case where values might be undefined initially
    if (!newValues || !oldValues) {
      // If new values exist, try to load chart
      if (newValues) {
        const activeData = activeChartData.value;
        if (activeData && activeData.length > 0) {
          loadChart();
          console.log('Chart data initial load:', selectedCurrency.value, 'length:', activeData.length);

          setTimeout(() => {
            handleTabClick(tab.value);
          }, 100);
        }
      }
      return;
    }

    // Safe destructuring with default values
    const [newChartData = [], newChartDataUsd = [], newChartDataEur = []] = newValues;
    const [oldChartData = [], oldChartDataUsd = [], oldChartDataEur = []] = oldValues;

    if (
      arraysEqual(newChartData, oldChartData) &&
      arraysEqual(newChartDataUsd, oldChartDataUsd) &&
      arraysEqual(newChartDataEur, oldChartDataEur)
    ) {
      return;
    }

    const activeData = activeChartData.value;
    if (activeData && activeData.length > 0) {
      loadChart();
      console.log('Chart data updated:', selectedCurrency.value, 'length:', activeData.length);

      // Apply the current time range filter after chart loads with new data
      setTimeout(() => {
        handleTabClick(tab.value);
      }, 100);
    }
  },
  { deep: true, immediate: true }
);

// COMMENTED OUT: Dual-axis wallet watching
// Simple wallet watching for single chart
watch(
  loggedWallet,
  () => {
    if (props.chartData.length > 0) {
      loadChart();

      // Apply the current time range filter after wallet change
      setTimeout(() => {
        handleTabClick(tab.value);
      }, 100);
    }
  },
  { deep: true }
);

watch(selectedCurrency, () => {
  loadChart();
  handleTabClick(tab.value);
});

onBeforeUnmount(() => {
  if (chartInstance.value) {
    chartInstance.value.destroy();
  }
});

watch(
  () => props.loading,
  newVal => {
    if (!newVal) {
      loadChart();
      handleTabClick(tab.value);
    }
  }
);
// COMMENTED OUT: Dual-axis onMounted
// Simple single-axis chart mounting
onMounted(() => {
  // Set correct initial tab index based on saved preference (default to 7D)
  const savedTab = loadPortfolioTabSetting();
  const tabValues = Object.values(tabs);
  const savedTabIndex = tabValues.findIndex(t => t.value === savedTab);
  if (savedTabIndex !== -1) {
    selectedTabIndex.value = savedTabIndex;
    tab.value = tabValues[savedTabIndex];
  } else {
    // Fallback to WEEK (7D) if not found
    const weekIndex = tabValues.findIndex(t => t.value === 'WEEK');
    selectedTabIndex.value = weekIndex !== -1 ? weekIndex : 4;
    tab.value = tabs.WEEK;
  }

  const hasAnyData = props.chartData.length > 0 || props.chartDataUsd.length > 0 || props.chartDataEur.length > 0;

  if (hasAnyData) {
    loadChart();

    // Apply the initial time range filter after chart loads
    setTimeout(() => {
      handleTabClick(tab.value);
    }, 100);
  } else {
    console.log('No data to load chart');
  }
});
</script>
<style scoped>
#highstock-chart {
  min-height: 184px;
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
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.portfolio-amount:hover {
  opacity: 0.8;
}

.address-section {
  display: flex;
  align-items: center;
  gap: 4px;
}

.address-text {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.6);
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

/* Date Picker Tabs */
.date-picker-tabs {
  display: flex;
  align-items: center;
}

/* Series Toggle Buttons (next to date picker) */
.series-toggle-buttons {
  display: flex;
  align-items: center;
}

.series-toggle {
  background-color: rgba(255, 255, 255, 0.1) !important;
  border-radius: 4px !important;
  overflow: hidden;
}

.series-toggle.compact {
  background-color: rgba(255, 255, 255, 0.08) !important;
  border-radius: 3px !important;
}

.toggle-btn {
  min-width: 40px !important;
  height: 28px !important;
  font-size: 10px !important;
  font-weight: 600 !important;
  letter-spacing: 0.5px !important;
  text-transform: uppercase !important;
  transition: all 0.2s ease !important;
}

.toggle-btn.compact {
  min-width: 28px !important;
  height: 22px !important;
  font-size: 8px !important;
  font-weight: 500 !important;
  letter-spacing: 0.3px !important;
  padding: 0 6px !important;
}

.dual-axis-btn {
  min-width: 48px !important;
}

.dual-axis-btn.compact {
  min-width: 26px !important;
  padding: 0 4px !important;
}

.toggle-btn:not(.v-btn--active) {
  color: rgba(255, 255, 255, 0.6) !important;
}

.toggle-btn.v-btn--active {
  color: white !important;
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

  .toggle-btn.compact {
    min-width: 24px !important;
    height: 20px !important;
    font-size: 7px !important;
  }

  .dual-axis-btn.compact {
    min-width: 22px !important;
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
}
</style>
