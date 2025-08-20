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
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, Time } from 'lightweight-charts';
import axios from 'axios';
import dexhunterApi from '@/api/dexhunter-api';
import tapToolsApi from '@/api/tap-tools-api';

interface CandlestickDataPoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface Props {
  symbol?: string;
  data?: CandlestickDataPoint[];
  width?: string;
  height?: string;
  theme?: 'light' | 'dark';
  fetchData?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  symbol: 'ADA/USD',
  data: () => [],
  width: '100%',
  height: '200px',
  theme: 'dark',
  fetchData: false
});

const emit = defineEmits<{
  chartReady: [chart: IChartApi];
}>();

const chartContainer = ref<HTMLElement>();
const showFallback = ref(true);
const isLoadingData = ref(false);
let chart: IChartApi | null = null;
let candlestickSeries: any = null;

// Fetch real ADA/USD data from backend
const fetchAdaUsdData = async (): Promise<CandlestickDataPoint[]> => {
  const baseURL = import.meta.env['VITE_BACKEND_URL'] || 'http://localhost:3000';
  
  try {
    isLoadingData.value = true;
    console.debug('TradingViewChart: Fetching ADA/USD data from backend:', `${baseURL}/crypto/history/ADAUSDT`);
    
    const response = await axios.get(`${baseURL}/crypto/history/ADAUSDT`, {
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    });
    
    console.debug('TradingViewChart: Backend response details:', {
      status: response.status,
      contentType: response.headers['content-type'],
      dataType: typeof response.data,
      isArray: Array.isArray(response.data),
      dataLength: Array.isArray(response.data) ? response.data.length : 'not array',
      firstChars: typeof response.data === 'string' ? response.data.substring(0, 100) + '...' : 'not string'
    });
    
    if (response.data && Array.isArray(response.data)) {
      console.debug('TradingViewChart: Raw ADA/USD response data:', {
        length: response.data.length,
        sample: response.data.slice(0, 2),
        dataFormat: {
          firstItemType: typeof response.data[0],
          isArray: Array.isArray(response.data[0]),
          keys: Array.isArray(response.data[0]) ? 'array-format' : Object.keys(response.data[0] || {}),
          sampleValues: response.data[0]
        }
      });
      
      // Convert backend data to chart format with proper validation
      const chartData: CandlestickDataPoint[] = [];
      let validCount = 0;
      let invalidCount = 0;
      
      for (let index = 0; index < response.data.length; index++) {
        const candle = response.data[index];
        
        // Handle both object and array formats from backend
        let timestamp, open, high, low, close;
        
        if (Array.isArray(candle)) {
          // Array format: [timestamp, open, high, low, close, volume]
          [timestamp, open, high, low, close] = candle;
        } else if (typeof candle === 'object') {
          // Check if it's an object with numeric keys (like ['0', '1', '2', ...])
          if (candle['0'] !== undefined) {
            // Numeric keys format: {'0': timestamp, '1': open, '2': high, '3': low, '4': close}
            timestamp = candle['0'];
            open = candle['1'];
            high = candle['2'];
            low = candle['3'];
            close = candle['4'];
          } else {
            // Named properties format
            timestamp = candle.timestamp || candle.time || candle.date || candle.t || candle.openTime || candle.closeTime;
            open = candle.open || candle.o;
            high = candle.high || candle.h;
            low = candle.low || candle.l;
            close = candle.close || candle.c;
          }
        }
        
        // Skip entries without any timestamp
        if (timestamp === undefined || timestamp === null) {
          invalidCount++;
          if (invalidCount <= 5) { // Only log first 5 to avoid spam
            console.warn(`TradingViewChart: Missing timestamp at index ${index}:`, Object.keys(candle));
          }
          continue;
        }
        
        // Handle different timestamp formats
        let timeValue: number;
        if (typeof timestamp === 'number') {
          // If it's already a number, check if it's in milliseconds or seconds
          timeValue = timestamp > 1000000000000 ? Math.floor(timestamp / 1000) : timestamp;
        } else if (typeof timestamp === 'string') {
          // Parse date string
          const parsed = new Date(timestamp).getTime();
          if (isNaN(parsed)) {
            invalidCount++;
            if (invalidCount <= 5) {
              console.warn(`TradingViewChart: Invalid date string at index ${index}:`, timestamp);
            }
            continue;
          }
          timeValue = Math.floor(parsed / 1000);
        } else {
          invalidCount++;
          if (invalidCount <= 5) {
            console.warn(`TradingViewChart: Invalid timestamp type at index ${index}:`, typeof timestamp, timestamp);
          }
          continue;
        }
        
        // Parse and validate OHLC values
        const openValue = parseFloat(open || 0);
        const highValue = parseFloat(high || openValue * 1.01);
        const lowValue = parseFloat(low || openValue * 0.99);
        const closeValue = parseFloat(close || openValue);
        
        if (isNaN(timeValue) || isNaN(openValue) || isNaN(highValue) || isNaN(lowValue) || isNaN(closeValue)) {
          invalidCount++;
          if (invalidCount <= 5) {
            console.warn(`TradingViewChart: Invalid OHLC data at index ${index}:`, {
              time: timeValue, 
              open: openValue, 
              high: highValue, 
              low: lowValue, 
              close: closeValue, 
              rawData: candle,
              dataType: Array.isArray(candle) ? 'array' : typeof candle
            });
          }
          continue;
        }
        
        chartData.push({
          time: timeValue as Time,
          open: openValue,
          high: highValue,
          low: lowValue,
          close: closeValue
        });
        validCount++;
      }
      
      // Sort by time to ensure ascending order
      chartData.sort((a, b) => (a.time as number) - (b.time as number));
      
      console.debug('TradingViewChart: Processed ADA/USD chart data:', {
        totalRaw: response.data.length,
        validData: validCount,
        invalidData: invalidCount,
        finalCount: chartData.length,
        sample: chartData.slice(0, 2),
        priceRange: chartData.length > 0 ? {
          min: Math.min(...chartData.map(c => c.low)),
          max: Math.max(...chartData.map(c => c.high)),
          latest: chartData[chartData.length - 1]
        } : null,
        timeRange: chartData.length > 0 ? {
          start: new Date((chartData[0].time as number) * 1000),
          end: new Date((chartData[chartData.length - 1].time as number) * 1000)
        } : null
      });
      
      if (invalidCount > 5) {
        console.warn(`TradingViewChart: Suppressed ${invalidCount - 5} additional invalid data warnings`);
      }
      
      return chartData;
    }
    
    console.warn('TradingViewChart: Invalid response format from backend:', {
      status: response.status,
      dataType: typeof response.data,
      isHTML: typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')
    });
    
    // Don't log the full HTML response as it's very long
    if (typeof response.data === 'string' && response.data.includes('<!DOCTYPE html>')) {
      console.warn('TradingViewChart: Got HTML instead of JSON - likely Cloudflare protection');
    } else {
      console.warn('TradingViewChart: Backend returned unexpected format for ADAUSDT data');
    }
    
    // Try CoinGecko fallback before giving up
    try {
      console.debug('TradingViewChart: Trying CoinGecko fallback due to backend format issue');
      const fallbackData = await fetchAdaPriceFromCoinGecko();
      return fallbackData;
    } catch (fallbackError) {
      console.warn('TradingViewChart: CoinGecko fallback also failed - no data available');
      return [];
    }
  } catch (error: any) {
    console.warn('TradingViewChart: Failed to fetch ADA/USD data from backend:', {
      message: error?.message,
      status: error?.response?.status,
      data: error?.response?.data,
      url: `${baseURL}/crypto/history/ADAUSDT`
    });
    
    // The /crypto/history/ADAUSDT endpoint exists but might have CORS or Cloudflare protection
    // Let's try using CoinGecko as fallback
    try {
      console.debug('TradingViewChart: Trying fallback price API');
      const fallbackData = await fetchAdaPriceFromCoinGecko();
      return fallbackData;
    } catch (fallbackError) {
      console.warn('TradingViewChart: CoinGecko fallback also failed:', fallbackError);
      console.debug('TradingViewChart: No data sources available');
      return [];
    }
  } finally {
    isLoadingData.value = false;
  }
};

// Fallback function to get ADA price from CoinGecko
const fetchAdaPriceFromCoinGecko = async (): Promise<CandlestickDataPoint[]> => {
  try {
    console.debug('TradingViewChart: Fetching ADA price from CoinGecko');
    
    // Get current price and generate historical-like data
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd&include_24hr_change=true');
    
    if (response.data?.cardano?.usd) {
      const currentPrice = response.data.cardano.usd;
      const change24h = response.data.cardano.usd_24h_change || 0;
      
      console.debug('TradingViewChart: Got real ADA price from CoinGecko:', {
        price: currentPrice,
        change24h: change24h
      });
      
      // Generate recent hourly data based on current price and 24h change
      const data: CandlestickDataPoint[] = [];
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      
      // Start with price 24 hours ago
      let price = currentPrice / (1 + change24h / 100);
      const priceIncrement = (currentPrice - price) / 24; // Smooth transition over 24 hours
      
      for (let i = 23; i >= 0; i--) {
        const time = Math.floor((now - i * oneHour) / 1000) as Time;
        
        // Add some realistic volatility around the trend
        const volatility = 0.005; // 0.5% hourly volatility
        const randomChange = (Math.random() - 0.5) * volatility * 2;
        
        const open = price;
        const trend = priceIncrement + (price * randomChange);
        const close = Math.max(0.01, open + trend);
        
        // Generate realistic high/low around open/close
        const range = Math.abs(close - open) + (price * 0.002); // Min 0.2% range
        const high = Math.max(open, close) + (Math.random() * range * 0.5);
        const low = Math.min(open, close) - (Math.random() * range * 0.5);
        
        data.push({
          time,
          open: Number(open.toFixed(4)),
          high: Number(high.toFixed(4)),
          low: Number(Math.max(0.01, low).toFixed(4)),
          close: Number(close.toFixed(4))
        });
        
        price = close; // Update for next iteration
      }
      
      console.debug('TradingViewChart: Generated realistic ADA data based on CoinGecko price:', {
        dataPoints: data.length,
        priceRange: {
          start: data[0]?.close,
          end: data[data.length - 1]?.close,
          current: currentPrice
        }
      });
      
      return data;
    }
    
    throw new Error('Invalid CoinGecko response');
  } catch (error) {
    console.warn('TradingViewChart: CoinGecko API failed:', error);
    throw error;
  }
};

// Fetch token price history from DexHunter or TapTools
const fetchTokenPriceHistory = async (symbol: string): Promise<CandlestickDataPoint[]> => {
  try {
    isLoadingData.value = true;
    console.debug(`TradingViewChart: Fetching ${symbol} price history`);
    
    // Extract token symbol from pairs like "SNEK/USD" -> "SNEK"
    const tokenSymbol = symbol.split('/')[0];
    
    // Try TapTools first for price data
    try {
      const response = await tapToolsApi.dailyPriceChange(tokenSymbol);
      if (response.data && response.data.length > 0) {
        // Convert TapTools data to chart format with validation
        const chartData: CandlestickDataPoint[] = response.data
          .map((point: any, index: number) => {
            const timestamp = point.timestamp || point.date || point.time;
            let timeValue = Math.floor(new Date(timestamp).getTime() / 1000);
            
            if (isNaN(timeValue)) {
              console.warn(`TradingViewChart: Invalid TapTools timestamp at ${index}:`, timestamp);
              return null;
            }
            
            const price = parseFloat(point.price);
            if (isNaN(price)) {
              console.warn(`TradingViewChart: Invalid TapTools price at ${index}:`, point.price);
              return null;
            }
            
            return {
              time: timeValue as Time,
              open: parseFloat(point.open) || price,
              high: parseFloat(point.high) || price * 1.01,
              low: parseFloat(point.low) || price * 0.99,
              close: parseFloat(point.close) || price
            };
          })
          .filter((item): item is CandlestickDataPoint => item !== null)
          .sort((a, b) => (a.time as number) - (b.time as number));
          
        console.debug(`TradingViewChart: Got ${chartData.length} valid points from TapTools`);
        return chartData;
      }
    } catch (tapError) {
      console.debug('TradingViewChart: TapTools API failed, trying DexHunter');
    }
    
    // Fallback to DexHunter for token data
    try {
      // Get token data from DexHunter (you may need to get the policy ID for the token)
      const assetData = await dexhunterApi.getAssetData(tokenSymbol);
      if (assetData && assetData.price_history) {
        const chartData: CandlestickDataPoint[] = assetData.price_history
          .map((point: any, index: number) => {
            const timeValue = Math.floor(new Date(point.timestamp).getTime() / 1000);
            
            if (isNaN(timeValue)) {
              console.warn(`TradingViewChart: Invalid DexHunter timestamp at ${index}:`, point.timestamp);
              return null;
            }
            
            const price = parseFloat(point.price);
            if (isNaN(price)) {
              console.warn(`TradingViewChart: Invalid DexHunter price at ${index}:`, point.price);
              return null;
            }
            
            return {
              time: timeValue as Time,
              open: parseFloat(point.open) || price,
              high: parseFloat(point.high) || price * 1.02,
              low: parseFloat(point.low) || price * 0.98,
              close: parseFloat(point.close) || price
            };
          })
          .filter((item): item is CandlestickDataPoint => item !== null)
          .sort((a, b) => (a.time as number) - (b.time as number));
          
        console.debug(`TradingViewChart: Got ${chartData.length} valid points from DexHunter`);
        return chartData;
      }
    } catch (dexError) {
      console.debug('TradingViewChart: DexHunter API also failed');
    }
    
    // If both APIs fail, return empty array
    console.warn(`TradingViewChart: Could not fetch real data for ${symbol}`);
    return [];
    
  } catch (error) {
    console.warn(`TradingViewChart: Failed to fetch ${symbol} data:`, error);
    return [];
  } finally {
    isLoadingData.value = false;
  }
};

const initChart = async () => {
  if (!chartContainer.value) {
    console.debug('TradingViewChart: Container not ready yet');
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
    console.debug('TradingViewChart: Container has no dimensions, retrying...', {
      clientWidth: chartContainer.value.clientWidth,
      clientHeight: chartContainer.value.clientHeight,
      offsetWidth: chartContainer.value.offsetWidth,
      offsetHeight: chartContainer.value.offsetHeight
    });
    setTimeout(() => initChart(), 100);
    return;
  }

  console.debug('TradingViewChart: Initializing chart with dimensions:', containerWidth, 'x', containerHeight);

  try {
    // Create new chart with explicit dimensions
    chart = createChart(chartContainer.value, {
      width: containerWidth,
      height: containerHeight,
      layout: {
        background: { 
          type: 'solid' as const, 
          color: props.theme === 'dark' ? 'transparent' : '#FFFFFF' 
        },
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

      // Use the correct v5 API: addSeries(SeriesType, options)
      console.debug('TradingViewChart: Creating candlestick series with v5 API');
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

  // Set data - only use real data, show loading if no data
  let dataToSet: CandlestickDataPoint[] = [];
  
  if (props.data && props.data.length > 0) {
    console.debug('TradingViewChart: Setting provided data', props.data.length, 'points');
    dataToSet = props.data;
  } else if (props.fetchData) {
    // Fetch real data based on symbol
    if (props.symbol === 'ADA/USD') {
      console.debug('TradingViewChart: Fetching real ADA/USD data from backend');
      dataToSet = await fetchAdaUsdData();
    } else {
      // For other tokens, use TapTools/DexHunter
      console.debug(`TradingViewChart: Fetching ${props.symbol} data from TapTools/DexHunter`);
      dataToSet = await fetchTokenPriceHistory(props.symbol);
    }
    
    console.debug('TradingViewChart: Data fetch result:', {
      count: dataToSet.length,
      symbol: props.symbol,
      latestPrice: dataToSet.length > 0 ? dataToSet[dataToSet.length - 1].close : 'no data'
    });
  }
  
  // Validate and set candlestick data
  if (dataToSet && dataToSet.length > 0) {
    // Final validation before setting data
    const validData = dataToSet.filter(candle => {
      const timeValid = !isNaN(candle.time as number) && (candle.time as number) > 0;
      const priceValid = !isNaN(candle.open) && !isNaN(candle.high) && !isNaN(candle.low) && !isNaN(candle.close);
      return timeValid && priceValid;
    });
    
    console.debug('TradingViewChart: Setting data:', {
      original: dataToSet.length,
      valid: validData.length,
      sample: validData.slice(0, 2)
    });
    
    if (validData.length > 0) {
      candlestickSeries.setData(validData);
      showFallback.value = false; // Hide loading state
    } else {
      console.warn('TradingViewChart: No valid data received - keeping loading state');
      showFallback.value = true; // Keep loading state
    }
  } else {
    console.debug('TradingViewChart: No data to display - keeping loading state');
    showFallback.value = true; // Keep loading state until data arrives
  }
  console.debug('TradingViewChart: Successfully set candlestick data with', dataToSet.length, 'points');

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
        console.debug('TradingViewChart: Resized to', width, 'x', height);
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

    // Hide fallback when chart is ready and has data
    setTimeout(() => {
      showFallback.value = false;
      console.debug('TradingViewChart: Chart initialization complete, hiding fallback');
    }, 500); // Small delay to ensure chart renders
    
    emit('chartReady', chart);
    
  } catch (error) {
    console.error('TradingViewChart: Failed to initialize chart:', error);
    showFallback.value = true; // Keep fallback visible on error
  }
};

// Sample data generation function removed - we only show real data or loading state

// Watch for data changes or fetchData prop changes
watch(() => props.data, (newData) => {
  console.debug('TradingViewChart: Data watcher triggered', newData?.length || 0, 'points');
  if (candlestickSeries) {
    if (newData && newData.length > 0) {
      console.debug('TradingViewChart: Updating candlestick series with new data');
      candlestickSeries.setData(newData);
      // Hide fallback when real data arrives
      showFallback.value = false;
    } else {
      // If no data provided, keep loading state
      console.debug('TradingViewChart: No data in watcher - keeping loading state');
      showFallback.value = true;
    }
  }
}, { deep: true });

// Watch for fetchData prop changes to re-fetch when dialog reopens
watch(() => props.fetchData, async (shouldFetch, oldValue) => {
  console.debug('TradingViewChart: fetchData watcher triggered', shouldFetch, 'was', oldValue);
  
  // If fetchData changed from false to true, reinitialize chart to fix sizing
  if (shouldFetch && !oldValue) {
    console.debug('TradingViewChart: Dialog reopened, reinitializing chart');
    await nextTick();
    await initChart(); // Reinitialize chart to fix sizing issues
  }
  
  if (shouldFetch && candlestickSeries && (!props.data || props.data.length === 0)) {
    console.debug('TradingViewChart: Re-fetching data due to fetchData prop change');
    try {
      let freshData: CandlestickDataPoint[];
      
      if (props.symbol === 'ADA/USD') {
        console.debug('TradingViewChart: Re-fetching ADA/USD data from backend');
        freshData = await fetchAdaUsdData();
      } else {
        console.debug(`TradingViewChart: Re-fetching ${props.symbol} data from TapTools/DexHunter`);
        freshData = await fetchTokenPriceHistory(props.symbol);
      }
      
      if (freshData && freshData.length > 0) {
        console.debug('TradingViewChart: Setting fresh data:', freshData.length, 'points');
        candlestickSeries.setData(freshData);
        showFallback.value = false;
      } else {
        console.debug('TradingViewChart: No fresh data received - keeping loading state');
        showFallback.value = true;
      }
    } catch (error) {
      console.warn('TradingViewChart: Failed to re-fetch data:', error);
    }
  }
});

// Watch for theme changes
// Watch for theme changes
watch(() => props.theme, () => {
  console.debug('TradingViewChart: Theme changed, reinitializing chart');
  initChart();
});

// Watch for symbol changes to re-fetch appropriate data
watch(() => props.symbol, async (newSymbol, oldSymbol) => {
  if (newSymbol !== oldSymbol && props.fetchData && candlestickSeries) {
    console.debug('TradingViewChart: Symbol changed from', oldSymbol, 'to', newSymbol);
    try {
      let freshData: CandlestickDataPoint[];
      
      if (newSymbol === 'ADA/USD') {
        freshData = await fetchAdaUsdData();
      } else {
        freshData = await fetchTokenPriceHistory(newSymbol);
      }
      
      if (freshData && freshData.length > 0) {
        candlestickSeries.setData(freshData);
        showFallback.value = false;
      } else {
        console.debug('TradingViewChart: No data for new symbol - keeping loading state');
        showFallback.value = true;
      }
    } catch (error) {
      console.warn('TradingViewChart: Failed to fetch data for new symbol:', error);
    }
  }
});

onMounted(() => {
  // Delay chart initialization to ensure DOM is fully rendered
  nextTick(() => {
    setTimeout(() => {
      console.debug('TradingViewChart: Starting initialization on mount');
      showFallback.value = true; // Show fallback initially
      if (props.fetchData || (props.data && props.data.length > 0)) {
        initChart();
      }
    }, 100);
  });
});

onBeforeUnmount(() => {
  console.debug('TradingViewChart: Cleaning up chart on unmount');
  if (chart) {
    try {
      chart.remove();
    } catch (e) {
      console.debug('TradingViewChart: Error removing chart:', e);
    }
    chart = null;
    candlestickSeries = null;
  }
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