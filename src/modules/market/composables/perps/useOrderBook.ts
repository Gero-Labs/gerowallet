/**
 * Order Book composable for perpetuals trading.
 *
 * Owns all order-book state (asks, bids, recent trades, tick size, display
 * computeds) **and** the WebSocket subscriptions for depth, trades, and mark
 * price — because the mark price callback also feeds `strikeRealtimeData`
 * which is shared with the chart.
 *
 * Usage:
 *   const { obAsks, obBids, displayAsks, displayBids, ... } = useOrderBook(selectedSymbol);
 */

import { computed, ref, watch, onBeforeUnmount, type Ref } from 'vue';
import { useStrikeMarketWs } from '@/modules/market/composables/useStrikeMarketWs';
import { strikeMarketApi } from '@/api/strike-v2.market';
import type { TradeResponse } from '@/api/strike-v2.types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OBLevel {
  price: string;
  size: string;
  total: string;
  pct: number;
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export function useOrderBook(selectedSymbol: Ref<string>) {
  const { subscribeDepth, subscribeTrades, subscribeMarkPrice } = useStrikeMarketWs();

  // ── Raw order book data ──────────────────────────────────────────────
  const obAsks = ref<[string, string][]>([]);
  const obBids = ref<[string, string][]>([]);
  const recentTrades = ref<TradeResponse[]>([]);

  // ── UI state ─────────────────────────────────────────────────────────
  const obView = ref<'book' | 'trades'>('book');
  const obFilter = ref<'both' | 'bids' | 'asks'>('both');
  const obTickSize = ref('0.00001');
  const tickSizeOptions = ['0.00001', '0.00005', '0.0001', '0.0005', '0.001'];

  // ── Container sizing (ResizeObserver) ────────────────────────────────
  const obContainerRef = ref<HTMLElement | null>(null);
  const obRowHeight = 20; // px per row
  const obContainerHeight = ref(0);

  let obResizeObserver: ResizeObserver | null = null;

  watch(obContainerRef, (el, _, onCleanup) => {
    if (!el) return;
    const update = () => { obContainerHeight.value = el.clientHeight; };
    update();
    obResizeObserver = new ResizeObserver(update);
    obResizeObserver.observe(el);
    onCleanup(() => { obResizeObserver?.disconnect(); obResizeObserver = null; });
  }, { immediate: true });

  const obDepth = computed(() => {
    const fixedHeader = 30 + 24; // filter row + col headers
    const fixedSpread = 32;      // spread row always visible
    const fixedRatio = 36;
    const available = obContainerHeight.value - fixedHeader - fixedSpread - fixedRatio;
    const sides = obFilter.value === 'both' ? 2 : 1;
    const perSide = Math.floor(available / sides / obRowHeight);
    return Math.max(4, Math.min(perSide, 50));
  });

  // ── Live price refs (shared with chart via return) ───────────────────
  const strikeRealtimeData = ref<{ lastPrice: number } | null>(null);
  const liveMarkPrice = ref<string | null>(null);
  const liveIndexPrice = ref<string | null>(null);
  const liveFundingRate = ref<string | null>(null);
  const liveNextFundingTime = ref<number | null>(null);
  const markPriceFlash = ref<'up' | 'down' | null>(null);
  let markPriceFlashTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Formatting ───────────────────────────────────────────────────────

  function formatOBSize(val: string): string {
    const n = parseFloat(val);
    if (isNaN(n)) return val;
    return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  // ── WebSocket subscription management ────────────────────────────────

  let unsubDepth: (() => void) | null = null;
  let unsubTrades: (() => void) | null = null;
  let unsubMarkPrice: (() => void) | null = null;
  // Bumped on every (re)subscribe so a stale snapshot/WS callback from a previous
  // symbol can't clobber the current book.
  let depthGen = 0;

  function subscribeSymbolWs(symbol: string) {
    // Clean up previous
    if (unsubDepth) { unsubDepth(); unsubDepth = null; }
    if (unsubTrades) { unsubTrades(); unsubTrades = null; }
    if (unsubMarkPrice) { unsubMarkPrice(); unsubMarkPrice = null; }
    obAsks.value = [];
    obBids.value = [];
    recentTrades.value = [];

    // WS depth is a Binance-style DIFF stream: each `depthUpdate` carries only the
    // levels that CHANGED, and qty "0" means REMOVE that level. We maintain a local
    // book and apply deltas on top of a REST snapshot — replacing the whole book per
    // event (the old behaviour) collapses it to just the few changed levels each tick,
    // which is the blank/flicker bug. Protocol (strike-orderbook skill): subscribe →
    // buffer → fetch snapshot (record lastUpdateId) → replay buffered where
    // u > lastUpdateId → apply live. `u` continuity is NOT guaranteed, so gate on `u`.
    type DepthEvent = { a?: [string, string][]; b?: [string, string][]; u?: number };
    const gen = ++depthGen;
    const bookAsks = new Map<string, string>(); // price -> size
    const bookBids = new Map<string, string>();
    let buffer: DepthEvent[] = [];
    let synced = false;
    let lastUpdateId = 0;

    const applyDelta = (ev: DepthEvent): void => {
      if (ev.a) for (const [p, q] of ev.a) { if (parseFloat(q) === 0) bookAsks.delete(p); else bookAsks.set(p, q); }
      if (ev.b) for (const [p, q] of ev.b) { if (parseFloat(q) === 0) bookBids.delete(p); else bookBids.set(p, q); }
      if (typeof ev.u === 'number') lastUpdateId = ev.u;
    };
    const publish = (): void => {
      // best ask = lowest price first; best bid = highest price first
      obAsks.value = Array.from(bookAsks.entries()).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0]));
      obBids.value = Array.from(bookBids.entries()).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0]));
    };

    unsubDepth = subscribeDepth(symbol, (data: unknown) => {
      if (gen !== depthGen) return; // superseded by a newer symbol subscription
      const ev = data as DepthEvent;
      if (!synced) { buffer.push(ev); return; } // not synced yet — buffer until snapshot lands
      if (typeof ev.u === 'number' && ev.u <= lastUpdateId) return; // stale/duplicate
      applyDelta(ev);
      publish();
    });

    // REST snapshot seeds the book, then we replay buffered deltas newer than it.
    strikeMarketApi.getOrderBook(symbol, 100).then((snap) => {
      if (gen !== depthGen) return; // symbol changed while fetching
      bookAsks.clear();
      bookBids.clear();
      for (const [p, q] of (snap.asks ?? [])) if (parseFloat(q) !== 0) bookAsks.set(p, q);
      for (const [p, q] of (snap.bids ?? [])) if (parseFloat(q) !== 0) bookBids.set(p, q);
      lastUpdateId = snap.lastUpdateId ?? 0;
      for (const ev of buffer) { if (typeof ev.u === 'number' && ev.u <= lastUpdateId) continue; applyDelta(ev); }
      buffer = [];
      synced = true;
      publish();
    }).catch(() => {
      if (gen !== depthGen) return;
      // Snapshot unavailable — apply what we buffered and go live (best effort).
      for (const ev of buffer) applyDelta(ev);
      buffer = [];
      synced = true;
      publish();
    });

    // Fetch initial recent trades
    strikeMarketApi.getRecentTrades(symbol, 50).then((trades) => {
      // Sort newest first
      recentTrades.value = trades.sort((a, b) => b.time - a.time);
    }).catch(() => {});

    // WS trades — prepend new trades in real-time
    unsubTrades = subscribeTrades(symbol, (data: unknown) => {
      const t = data as TradeResponse;
      if (t && t.price) {
        recentTrades.value = [t, ...recentTrades.value].slice(0, 50);
      }
    });

    // WS mark price → feed chart realtime + live mark/index price display
    // Event: { e: "markPriceUpdate", p: markPrice, i: indexPrice, r: fundingRate, ... }
    unsubMarkPrice = subscribeMarkPrice(symbol, (data: unknown) => {
      const d = data as { p?: string; i?: string; r?: string; T?: number };
      const markStr = d.p ?? '';
      const mark = parseFloat(markStr);
      if (mark > 0) {
        // Flash direction
        const prev = strikeRealtimeData.value?.lastPrice;
        if (prev != null && mark !== prev) {
          markPriceFlash.value = mark > prev ? 'up' : 'down';
          if (markPriceFlashTimer) clearTimeout(markPriceFlashTimer);
          markPriceFlashTimer = setTimeout(() => { markPriceFlash.value = null; }, 300);
        }
        liveMarkPrice.value = markStr;
        strikeRealtimeData.value = { lastPrice: mark };
      }
      if (d.i) liveIndexPrice.value = d.i;
      if (d.r) liveFundingRate.value = d.r;
      if (d.T) liveNextFundingTime.value = d.T;
    });
  }

  // ── Tick aggregation ─────────────────────────────────────────────────

  const tickDecimals = computed(() => obTickSize.value.split('.')[1]?.length ?? 5);

  function aggregateByTick(levels: [string, string][], side: 'ask' | 'bid', displayDepth: number): [string, string][] {
    const tick = parseFloat(obTickSize.value);
    const dec = tickDecimals.value;
    if (tick <= 0) return levels.slice(0, displayDepth);
    const map = new Map<string, number>();
    // Process raw levels until we have enough distinct buckets for the display
    for (const [p, q] of levels) {
      const price = parseFloat(p);
      const bucketed = Math.floor(price / tick) * tick;
      const key = (Math.round(bucketed * Math.pow(10, dec)) / Math.pow(10, dec)).toFixed(dec);
      map.set(key, (map.get(key) ?? 0) + parseFloat(q));
      // Stop once we have enough buckets — +1 so slice later trims cleanly
      if (map.size > displayDepth) break;
    }
    const entries: [string, string][] = Array.from(map.entries()).map(([p, q]) => [p, String(Math.round(q))]);
    entries.sort((a, b) => {
      const diff = parseFloat(a[0]) - parseFloat(b[0]);
      return side === 'ask' ? diff : -diff;
    });
    return entries.slice(0, displayDepth);
  }

  // Midpoint bucket: aggregated asks must be strictly above this, bids strictly below
  const midBucket = computed(() => {
    const tick = parseFloat(obTickSize.value);
    const dec = tickDecimals.value;
    const bestAsk = obAsks.value.length > 0 ? parseFloat(obAsks.value[0][0]) : 0;
    const bestBid = obBids.value.length > 0 ? parseFloat(obBids.value[0][0]) : 0;
    const mid = (bestAsk + bestBid) / 2;
    const bucketed = Math.floor(mid / tick) * tick;
    return Math.round(bucketed * Math.pow(10, dec)) / Math.pow(10, dec);
  });

  // ── Display computeds ────────────────────────────────────────────────

  const displayAsks = computed<OBLevel[]>(() => {
    const aggregated = aggregateByTick(obAsks.value, 'ask', obDepth.value + 5);
    // Remove buckets at or below the mid bucket
    const clean = aggregated.filter(([p]) => parseFloat(p) > midBucket.value);
    const sliced = clean.slice(0, obDepth.value);
    let cumTotal = 0;
    const levels = sliced.map(([p, q]) => {
      cumTotal += parseFloat(q);
      return { price: p, size: q, total: String(Math.round(cumTotal)), cumTotal };
    });
    const maxTotal = levels.length > 0 ? levels[levels.length - 1].cumTotal : 1;
    return levels.reverse().map((l) => ({
      price: l.price,
      size: l.size,
      total: l.total,
      pct: (l.cumTotal / maxTotal) * 100,
    }));
  });

  const displayBids = computed<OBLevel[]>(() => {
    const aggregated = aggregateByTick(obBids.value, 'bid', obDepth.value + 5);
    // Remove buckets at or above the mid bucket
    const clean = aggregated.filter(([p]) => parseFloat(p) < midBucket.value);
    const sliced = clean.slice(0, obDepth.value);
    let cumTotal = 0;
    const levels = sliced.map(([p, q]) => {
      cumTotal += parseFloat(q);
      return { price: p, size: q, total: String(Math.round(cumTotal)), cumTotal };
    });
    const maxTotal = levels.length > 0 ? levels[levels.length - 1].cumTotal : 1;
    return levels.map((l) => ({
      price: l.price,
      size: l.size,
      total: l.total,
      pct: (l.cumTotal / maxTotal) * 100,
    }));
  });

  // ── Spread ───────────────────────────────────────────────────────────

  const spreadValue = computed(() => {
    if (obAsks.value.length === 0 || obBids.value.length === 0) return '—';
    const bestAsk = parseFloat(obAsks.value[0][0]);
    const bestBid = parseFloat(obBids.value[0][0]);
    const spread = Math.abs(bestAsk - bestBid);
    return spread.toFixed(tickDecimals.value);
  });

  const spreadPercent = computed(() => {
    if (obAsks.value.length === 0 || obBids.value.length === 0) return '—';
    const bestAsk = parseFloat(obAsks.value[0][0]);
    const bestBid = parseFloat(obBids.value[0][0]);
    const mid = (bestAsk + bestBid) / 2;
    if (mid === 0) return '0%';
    return (Math.abs(bestAsk - bestBid) / mid * 100).toFixed(3) + '%';
  });

  // ── Buy/Sell ratio ───────────────────────────────────────────────────

  const buyRatioPct = computed(() => {
    const bidVol = obBids.value.slice(0, obDepth.value).reduce((s, [, q]) => s + parseFloat(q), 0);
    const askVol = obAsks.value.slice(0, obDepth.value).reduce((s, [, q]) => s + parseFloat(q), 0);
    const total = bidVol + askVol;
    return total > 0 ? (bidVol / total) * 100 : 50;
  });

  // ── Last trade direction ─────────────────────────────────────────────

  const lastTradeClass = computed(() => {
    if (recentTrades.value.length === 0) return 'clr-green';
    return recentTrades.value[0].isBuyerMaker ? 'clr-red' : 'clr-green';
  });

  // ── Auto-subscribe on symbol change ──────────────────────────────────

  watch(selectedSymbol, (sym) => {
    subscribeSymbolWs(sym);
  }, { immediate: true });

  // ── Cleanup ──────────────────────────────────────────────────────────

  onBeforeUnmount(() => {
    if (unsubDepth) unsubDepth();
    if (unsubTrades) unsubTrades();
    if (unsubMarkPrice) unsubMarkPrice();
    if (markPriceFlashTimer) clearTimeout(markPriceFlashTimer);
  });

  // ── Public API ───────────────────────────────────────────────────────

  return {
    // Raw OB data
    obAsks,
    obBids,
    recentTrades,

    // UI state
    obView,
    obFilter,
    obTickSize,
    tickSizeOptions,

    // Container sizing
    obContainerRef,
    obRowHeight,
    obContainerHeight,
    obDepth,

    // Tick aggregation
    tickDecimals,
    aggregateByTick,
    midBucket,

    // Display computeds
    displayAsks,
    displayBids,

    // Spread
    spreadValue,
    spreadPercent,

    // Buy/Sell ratio
    buyRatioPct,

    // Last trade direction
    lastTradeClass,

    // Formatting
    formatOBSize,

    // Live price data (shared with chart)
    strikeRealtimeData,
    liveMarkPrice,
    liveIndexPrice,
    liveFundingRate,
    liveNextFundingTime,
    markPriceFlash,

    // WS management (exposed for manual re-subscribe if needed)
    subscribeSymbolWs,
  };
}
