// src/services/agent/swapIntent.ts
export interface SwapIntent {
  type: 'swap';
  sellSymbol: string;
  buySymbol: string;
  mode: 'amount' | 'percent';
  amount?: string; // human-entered amount (mode=amount); wallet converts to smallest unit later
  percent?: number; // mode=percent; wallet computes from real balance later
}

const AMOUNT_RE = /\bswap\s+([0-9][0-9_,]*\.?[0-9]*)\s+([a-z0-9]{2,12})\s+(?:for|to|into)\s+([a-z0-9]{2,12})\b/i;
const PERCENT_RE = /\bsell\s+([0-9]{1,3})%\s+of\s+(?:my\s+)?([a-z0-9]{2,12})\s+(?:for|to|into)\s+([a-z0-9]{2,12})\b/i;

/** Deterministic parse of a swap request. No asset resolution, no amount math (the wallet does both). */
export function parseSwapIntent(text: string): SwapIntent | null {
  const t = text || '';
  const a = AMOUNT_RE.exec(t);
  if (a) {
    return { type: 'swap', sellSymbol: a[2].toUpperCase(), buySymbol: a[3].toUpperCase(), mode: 'amount', amount: a[1].replace(/[_,]/g, '') };
  }
  const p = PERCENT_RE.exec(t);
  if (p) {
    const pct = Math.min(100, Math.max(1, parseInt(p[1], 10)));
    return { type: 'swap', sellSymbol: p[2].toUpperCase(), buySymbol: p[3].toUpperCase(), mode: 'percent', percent: pct };
  }
  return null;
}
