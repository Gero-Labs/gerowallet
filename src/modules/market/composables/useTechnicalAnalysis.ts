/**
 * Pure functions for technical analysis indicator calculations.
 * Operate on arrays of close prices aligned with candle data.
 */

export function calculateSMA(closes: number[], period: number): (number | null)[] {
  if (period <= 0 || closes.length === 0) return closes.map(() => null);
  const result: (number | null)[] = [];
  let windowSum = 0;
  for (let i = 0; i < closes.length; i++) {
    windowSum += closes[i];
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (i >= period) {
      windowSum -= closes[i - period];
    }
    result.push(windowSum / period);
  }
  return result;
}

export function calculateEMA(closes: number[], period: number): (number | null)[] {
  if (period <= 0 || closes.length === 0) return closes.map(() => null);
  const result: (number | null)[] = [];
  const multiplier = 2 / (period + 1);

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    if (i === period - 1) {
      // Seed EMA with SMA
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j];
      result.push(sum / period);
      continue;
    }
    const prev = result[i - 1];
    if (prev === null) {
      result.push(null);
      continue;
    }
    result.push((closes[i] - prev) * multiplier + prev);
  }
  return result;
}

export function calculateRSI(closes: number[], period: number = 14): (number | null)[] {
  if (period <= 0 || closes.length === 0) return closes.map(() => null);
  const result: (number | null)[] = [];

  if (closes.length < period + 1) {
    return closes.map(() => null);
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // First avg gain/loss
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] > 0) avgGain += changes[i];
    else avgLoss += Math.abs(changes[i]);
  }
  avgGain /= period;
  avgLoss /= period;

  // Fill nulls for indices 0..period-1 (period nulls total)
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // First RSI value at index `period`
  if (avgLoss === 0) {
    result.push(100);
  } else {
    const rs = avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  // Remaining values using smoothed average
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] > 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push(rsi);
  }

  return result;
}

export interface MACDResult {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult[] {
  if (closes.length === 0) return [];
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  // MACD line = fast EMA - slow EMA
  const macdLine: (number | null)[] = fastEMA.map((f, i) => {
    const s = slowEMA[i];
    return f !== null && s !== null ? f - s : null;
  });

  // Signal line = EMA of MACD line (aligned with original indices)
  const validMacd = macdLine.filter((v): v is number => v !== null);
  const signalEMA = calculateEMA(validMacd, signalPeriod);

  // Align signal back with original indices
  let signalIdx = 0;
  const result: MACDResult[] = macdLine.map((m) => {
    if (m === null) {
      return { macd: null, signal: null, histogram: null };
    }
    const sig = signalEMA[signalIdx] ?? null;
    signalIdx++;
    return {
      macd: m,
      signal: sig,
      histogram: sig !== null ? m - sig : null,
    };
  });

  return result;
}

export interface BollingerBandsResult {
  upper: number | null;
  middle: number | null;
  lower: number | null;
}

export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult[] {
  if (period <= 0 || closes.length === 0) return closes.map(() => ({ upper: null, middle: null, lower: null }));
  const sma = calculateSMA(closes, period);

  return sma.map((middle, i) => {
    if (middle === null) {
      return { upper: null, middle: null, lower: null };
    }
    // Calculate standard deviation over the period
    let sumSqDiff = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSqDiff += (closes[j] - middle) ** 2;
    }
    const stdDev = Math.sqrt(sumSqDiff / period);

    return {
      upper: middle + stdDevMultiplier * stdDev,
      middle,
      lower: middle - stdDevMultiplier * stdDev,
    };
  });
}
