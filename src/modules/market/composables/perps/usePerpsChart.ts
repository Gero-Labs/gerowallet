import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';
import type { IChartApi, Time } from 'lightweight-charts';
import { strikeMarketApi } from '@/api/strike-v2.market';
import type { StrikeMarketConfig } from '@/api/strike-v2.types';

interface CandlestickDataPoint {
  time: Time;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface PerpsLivePriceRefs {
  strikeRealtimeData: Ref<{ lastPrice: number } | null>;
  liveMarkPrice: Ref<string | null>;
  liveIndexPrice: Ref<string | null>;
  liveFundingRate: Ref<string | null>;
  liveNextFundingTime: Ref<number | null>;
  markPriceFlash: Ref<'up' | 'down' | null>;
}

export function usePerpsChart(
  selectedSymbol: Ref<string>,
  currentMarketConfig: ComputedRef<StrikeMarketConfig | undefined>,
  livePrice: PerpsLivePriceRefs,
) {
  const { strikeRealtimeData } = livePrice;

  // ---------------------------------------------------------------------------
  // Chart state
  // ---------------------------------------------------------------------------

  const chartData = ref<CandlestickDataPoint[]>([]);
  const chartTimeframe = ref('5m');
  const chartPriceType = ref<'mark' | 'index' | 'last'>('mark');
  const priceTypeOptions: { value: 'mark' | 'index' | 'last'; label: string }[] = [
    { label: 'Mark Price', value: 'mark' },
    { label: 'Index Price', value: 'index' },
    { label: 'Last Traded Price', value: 'last' },
  ];
  const chartLoading = ref(false);
  let _chartInstance: IChartApi | null = null;

  // ---------------------------------------------------------------------------
  // Computed
  // ---------------------------------------------------------------------------

  const candleIntervalSeconds = computed(() => {
    const map: Record<string, number> = { '5m': 300, '1h': 3600, '1d': 86400 };
    return map[chartTimeframe.value] ?? 300;
  });

  const symbolPrecision = computed(() => {
    // ADA has 4-6 decimal places for price
    return selectedSymbol.value.startsWith('ADA') ? 5 : 2;
  });

  const symbolMinMove = computed(() => {
    return 1 / Math.pow(10, symbolPrecision.value);
  });

  // ---------------------------------------------------------------------------
  // Open interest
  // ---------------------------------------------------------------------------

  const openInterestBase = ref(0); // OI in base asset (e.g. ADA)

  // OI in USD — recalculated reactively as mark price updates
  const openInterest = computed(() => {
    if (openInterestBase.value <= 0) return '';
    const mark = strikeRealtimeData.value?.lastPrice ?? 0;
    return mark > 0 ? String(openInterestBase.value * mark) : '';
  });

  async function loadOpenInterest() {
    try {
      const res = await strikeMarketApi.getOpenInterest(selectedSymbol.value) as { openInterest: string };
      openInterestBase.value = parseFloat(res.openInterest) || 0;
    } catch {
      openInterestBase.value = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Chart callbacks
  // ---------------------------------------------------------------------------

  function onChartReady(chart: IChartApi) {
    _chartInstance = chart;
  }

  async function loadChartData() {
    chartLoading.value = true;
    try {
      const now = Date.now();
      const intervalMs: Record<string, number> = { '5m': 300_000, '1h': 3_600_000, '1d': 86_400_000 };
      const ms = intervalMs[chartTimeframe.value] ?? 3_600_000;
      const startTime = now - ms * 500;

      const klines = await strikeMarketApi.getKlines({
        symbol: selectedSymbol.value,
        interval: chartTimeframe.value,
        priceType: chartPriceType.value,
        limit: 500,
        startTime,
        endTime: now,
      });

      // Strike klines returns arrays: [openTime, open, high, low, close, volume, closeTime, ...]
      chartData.value = klines.map((k: any) => {
        const row = Array.isArray(k) ? k : k;
        if (Array.isArray(row)) {
          return {
            time: Math.floor(Number(row[0]) / 1000) as any,
            open: parseFloat(row[1]),
            high: parseFloat(row[2]),
            low: parseFloat(row[3]),
            close: parseFloat(row[4]),
            volume: parseFloat(row[5]),
          };
        }
        return {
          time: Math.floor(k.openTime / 1000) as any,
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: parseFloat(k.volume),
        };
      });
    } catch (e) {
      console.warn('[Perps] Failed to load chart data:', e);
    } finally {
      chartLoading.value = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Watchers — reload chart when timeframe or price type changes
  // ---------------------------------------------------------------------------

  watch(chartTimeframe, () => loadChartData());
  watch(chartPriceType, () => loadChartData());

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    // Chart data & config
    chartData,
    chartTimeframe,
    chartPriceType,
    priceTypeOptions,
    chartLoading,

    // Candle interval
    candleIntervalSeconds,

    // Symbol precision
    symbolPrecision,
    symbolMinMove,

    // Open interest
    openInterest,

    // Functions
    onChartReady,
    loadChartData,
    loadOpenInterest,
  };
}
