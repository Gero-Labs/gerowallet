<template>
  <div class="trading-view-chart-container" :style="{height: height}">
    <div ref="chartContainer" class="chart-container" :style="{width: '100%', height: '100%', minHeight: height}"></div>
    <!-- Fallback for debugging -->
    <div v-if="showFallback" class="chart-fallback">
      <div class="fallback-content">
        <div class="chart-title">{{ symbol }}</div>
        <div class="chart-loading">{{ chart ? 'Loading data...' : 'Initializing chart...' }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { IChartApi, SolidColor, Time } from 'lightweight-charts';
import { CandlestickSeries, createChart } from 'lightweight-charts';

interface CandlestickDataPoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  symbol?: string;
  data: CandlestickDataPoint[];
  width?: string;
  height?: string;
  theme?: 'light' | 'dark';
  enableRealtime?: boolean;
  realtimeData?: any;
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'ADA/USD',
  width: '100%',
  height: '200px',
  theme: 'dark',
  enableRealtime: false,
  realtimeData: undefined
});

// Define emit with proper function signature
interface Emits {
  (e: 'chartReady', chart: IChartApi): void;
}

const emit = defineEmits<Emits>();

const chartContainer = ref<HTMLElement>();
const showFallback = ref(true);
let chart: IChartApi | null = null;
let candlestickSeries: any = null;

// Internal chart data state
let chartData: CandlestickDataPoint[] = [];


const initChart = async () => {
  if (!chartContainer.value) {
    return;
  }

  // Destroy existing chart
  if (chart) {
    chart.remove();
    chart = null;
    candlestickSeries = null;
  }

  await nextTick();

  // Force container to recalculate dimensions
  if (chartContainer.value) {
    // Trigger reflow to ensure dimensions are calculated
    chartContainer.value.style.display = 'none';
    chartContainer.value.offsetHeight; // Force reflow
    chartContainer.value.style.display = 'block';
  }

  // Wait a bit for container to be fully rendered
  await new Promise(resolve => setTimeout(resolve, 50));

  // Ensure container has dimensions
  const containerWidth = chartContainer.value.clientWidth || chartContainer.value.offsetWidth;
  const containerHeight = chartContainer.value.clientHeight || chartContainer.value.offsetHeight;

  if (containerWidth === 0 || containerHeight === 0) {
    setTimeout(() => initChart(), 100);
    return;
  }


  try {
    chart = createChart(chartContainer.value, {
      width: containerWidth,
      height: containerHeight,
      layout: {
        attributionLogo: false,
        background: {
          type: 'solid' as const,
          color: props.theme === 'dark' ? 'transparent' : '#FFFFFF'
        } as SolidColor,
        textColor: props.theme === 'dark' ? '#D1D4DC' : '#191919',
      },
      grid: {
        vertLines: {
          color: props.theme === 'dark' ? 'rgba(197, 203, 206, 0.1)' : 'rgba(197, 203, 206, 0.5)'
        },
        horzLines: {
          color: props.theme === 'dark' ? 'rgba(197, 203, 206, 0.1)' : 'rgba(197, 203, 206, 0.5)'
        },
      },
      crosshair: {
        mode: 1, // CrosshairMode.Normal
      },
      rightPriceScale: {
        borderColor: props.theme === 'dark' ? 'rgba(197, 203, 206, 0.2)' : 'rgba(197, 203, 206, 0.8)',
        visible: true,
      },
      timeScale: {
        borderColor: props.theme === 'dark' ? 'rgba(197, 203, 206, 0.2)' : 'rgba(197, 203, 206, 0.8)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    if (!chart) {
      console.error('TradingViewChart: Failed to create chart instance');
      return;
    }

    // Create candlestick series using the correct v5 API
    try {
      const candlestickOptions = {
        upColor: '#26FAB0', // Strike Finance green for bullish candles
        downColor: '#FF5252', // Red for bearish candles
        borderVisible: false,
        wickUpColor: '#26FAB0',
        wickDownColor: '#FF5252',
        priceFormat: {
          type: 'price' as const,
          precision: 4,
          minMove: 0.0001,
        },
        title: props.symbol,
      };

      candlestickSeries = chart.addSeries(CandlestickSeries, candlestickOptions);

      if (!candlestickSeries) {
        console.error('TradingViewChart: Failed to create candlestick series');
        return;
      }
    } catch (err) {
      console.error('TradingViewChart: Failed to add candlestick series:', err);
      return;
    }

    if (!candlestickSeries) {
      console.error('TradingViewChart: Failed to create candlestick series');
      return;
    }

  // Set data from props
  const dataToSet = props.data || [];

  // Validate and set candlestick data
  if (dataToSet.length > 0) {
    // Final validation before setting data
    const validData = dataToSet.filter(candle => {
      const timeValid = !isNaN(candle.time as number) && (candle.time as number) > 0;
      const priceValid = !isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close);
      return timeValid && priceValid;
    });

    if (validData.length > 0) {
      candlestickSeries.setData(validData);
      chartData = validData; // Store data for real-time updates
      showFallback.value = false; // Hide loading state
    } else {
      showFallback.value = true;
    }
  } else {
    showFallback.value = true;
  }

  // Handle resize and ensure chart fills container
  const resizeChart = () => {
    if (chart && chartContainer.value) {
      const containerRect = chartContainer.value.getBoundingClientRect();
      const width = containerRect.width || chartContainer.value.offsetWidth;
      const height = containerRect.height || chartContainer.value.offsetHeight;

      if (width > 0 && height > 0) {
        chart.applyOptions({
          width: width,
          height: height
        });
      }
    }
  };

  // Initial resize to ensure proper fitting
  setTimeout(() => resizeChart(), 200);

  window.addEventListener('resize', resizeChart);

  // Use ResizeObserver for better container size detection
  if (chartContainer.value && 'ResizeObserver' in window) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          resizeChart();
        }
      }
    });
    resizeObserver.observe(chartContainer.value);
  }

    setTimeout(() => {
      showFallback.value = false;
    }, 500);

    emit('chartReady', chart);

  } catch (error) {
    console.error('TradingViewChart: Failed to initialize chart:', error);
    showFallback.value = true; // Keep fallback visible on error
  }
};


// Update chart with real-time data
const updateLastCandle = (realtimeData: any) => {
  if (!realtimeData || !realtimeData.lastPrice || chartData.length === 0) {
    return;
  }

  const now = Math.floor(Date.now() / 1000);
  const lastCandle = chartData[chartData.length - 1];
  const candleInterval = 300; // 5 minutes in seconds

  const timeSinceLastCandle = now - (lastCandle.time as number);

  if (timeSinceLastCandle >= candleInterval) {
    // Create new candle
    const newCandle: CandlestickDataPoint = {
      time: (Math.floor(now / candleInterval) * candleInterval) as Time,
      open: realtimeData.lastPrice,
      high: realtimeData.lastPrice,
      low: realtimeData.lastPrice,
      close: realtimeData.lastPrice
    };

    chartData.push(newCandle);

    if (candlestickSeries) {
      candlestickSeries.setData(chartData);
    }
  } else {
    // Update the last candle
    const updatedCandle: CandlestickDataPoint = {
      ...lastCandle,
      close: realtimeData.lastPrice,
      high: Math.max(lastCandle.high, realtimeData.lastPrice),
      low: Math.min(lastCandle.low, realtimeData.lastPrice)
    };

    chartData[chartData.length - 1] = updatedCandle;

    if (candlestickSeries) {
      candlestickSeries.update(updatedCandle);
    }
  }
};

// Watch for data changes
watch(() => props.data, (newData) => {
  if (candlestickSeries && newData) {
    if (newData.length > 0) {
      const validData = newData.filter(candle => {
        const timeValid = !isNaN(candle.time as number) && (candle.time as number) > 0;
        const priceValid = !isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close);
        return timeValid && priceValid;
      });
      
      if (validData.length > 0) {
        candlestickSeries.setData(validData);
        chartData = validData;
        showFallback.value = false;
      } else {
        showFallback.value = true;
      }
    } else {
      showFallback.value = true;
    }
  }
}, { deep: true });

// Watch for real-time data updates
watch(() => props.realtimeData, (newRealtimeData) => {
  if (props.enableRealtime && newRealtimeData && candlestickSeries && chartData.length > 0) {
    updateLastCandle(newRealtimeData);
  }
}, { deep: true });

// Watch for theme changes
watch(() => props.theme, () => {
  initChart();
});

onMounted(() => {
  nextTick(() => {
    setTimeout(() => {
      showFallback.value = props.data.length === 0;
      initChart();
    }, 100);
  });
});

onBeforeUnmount(() => {
  if (chart) {
    try {
      chart.remove();
    } catch (e) {
      // Silent fail
    }
    chart = null;
    candlestickSeries = null;
  }

  chartData = [];
  window.removeEventListener('resize', () => {});
});
</script>

<style scoped>
.trading-view-chart-container {
  width: 100%;
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: transparent;
  min-height: 160px;
  height: 100%;
}

.chart-container {
  border-radius: 8px;
  position: relative;
  min-height: 160px;
  min-width: 200px;
  height: 100%;
}

/* Dark theme adjustments */
.trading-view-chart-container {
  border: 1px solid rgba(255, 255, 255, 0.12);
}

/* Chart loading overlay */
.chart-loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  backdrop-filter: blur(2px);
}

.loading-content {
  text-align: center;
  color: #ffffff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.loading-text {
  font-size: 14px;
  font-weight: 500;
  color: #26FAB0;
}

.loading-symbol {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.7);
  font-weight: 600;
}
</style>
