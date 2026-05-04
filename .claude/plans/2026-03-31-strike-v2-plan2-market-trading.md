# Strike v2 Migration — Plan 2: Market Data + Trading UI

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real-time market data streaming and the v2 order-based trading UI, replacing the v1 CBOR-based perpetuals flow.

**Architecture:** Market data comes from `api.strikefinance.org/price/v2/*` (REST) and WebSocket streams. The trading UI shifts from "open/close position" to a proper order book model with limit/market/stop orders, bracket (TP/SL) strategy orders, and cross/isolated margin modes.

**Tech Stack:** Vue.js 2.7, TypeScript, WebSocket (native), `strike-v2.market.ts` + `strike-v2.trade.ts` from Plan 1

**Depends on:** Plan 1 (API Client + Auth)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/modules/market/composables/useStrikeMarket.ts` | Composable: exchange info, symbols, tickers, funding rates |
| `src/modules/market/composables/useStrikeMarketWs.ts` | WebSocket: real-time price/orderbook/trade streaming |
| `src/modules/market/composables/useStrikeTrading.ts` | Composable: order placement, cancellation, leverage, margin |
| `src/sidepanel/pages/PerpetualsPage.vue` | Rewrite: v2 trading interface (mini-gero) |
| `src/modules/dashboard/dialogs/PerpetualsDialog.vue` | Rewrite: v2 trading dialog (full dashboard) |
| `src/sidepanel/components/perps/OrderForm.vue` | New: order entry form (market/limit/stop + TP/SL) |
| `src/sidepanel/components/perps/SymbolSelector.vue` | New: market selector (BTC-USD, ETH-USD, ADA-USD, etc.) |
| `src/sidepanel/components/perps/PriceTicker.vue` | New: live price display with mark/index/funding |
| `src/sidepanel/components/perps/OrderBook.vue` | New: real-time order book display |

---

### Task 1: Exchange Info + Available Markets Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeMarket.ts`

- [ ] **Step 1: Create composable for exchange info and symbols**

```typescript
// src/modules/market/composables/useStrikeMarket.ts
import { ref, computed, type Ref, type ComputedRef } from 'vue';
import { strikeMarketApi } from '@/api/strike-v2.market';
import type { ExchangeInfo, SymbolInfo, Ticker24hrResponse, PremiumIndexResponse } from '@/api/strike-v2.types';

// Singleton state
const exchangeInfo: Ref<ExchangeInfo | null> = ref(null);
const tickers: Ref<Record<string, Ticker24hrResponse>> = ref({});
const fundingRates: Ref<Record<string, PremiumIndexResponse>> = ref({});
const loading = ref(false);
let initialized = false;

async function fetchExchangeInfo(): Promise<void> {
  try {
    exchangeInfo.value = await strikeMarketApi.getExchangeInfo();
  } catch (e) {
    console.error('Failed to fetch Strike exchange info:', e);
  }
}

async function fetchTickers(): Promise<void> {
  try {
    const data = await strikeMarketApi.get24hrTicker();
    const arr = Array.isArray(data) ? data : [data];
    const map: Record<string, Ticker24hrResponse> = {};
    arr.forEach(t => { map[t.symbol] = t; });
    tickers.value = map;
  } catch (e) {
    console.error('Failed to fetch Strike tickers:', e);
  }
}

async function fetchFundingRates(): Promise<void> {
  try {
    const data = await strikeMarketApi.getPremiumIndex();
    const arr = Array.isArray(data) ? data : [data];
    const map: Record<string, PremiumIndexResponse> = {};
    arr.forEach(p => { map[p.symbol] = p; });
    fundingRates.value = map;
  } catch (e) {
    console.error('Failed to fetch Strike funding rates:', e);
  }
}

export function useStrikeMarket() {
  if (!initialized) {
    initialized = true;
    loading.value = true;
    Promise.all([fetchExchangeInfo(), fetchTickers(), fetchFundingRates()])
      .finally(() => { loading.value = false; });

    // Refresh tickers + funding every 30s
    setInterval(() => {
      fetchTickers();
      fetchFundingRates();
    }, 30_000);
  }

  const symbols: ComputedRef<SymbolInfo[]> = computed(() =>
    exchangeInfo.value?.symbols?.filter(s => s.status === 'TRADING') || []
  );

  const symbolNames: ComputedRef<string[]> = computed(() =>
    symbols.value.map(s => s.symbol)
  );

  function getSymbolInfo(symbol: string): SymbolInfo | undefined {
    return symbols.value.find(s => s.symbol === symbol);
  }

  function getTicker(symbol: string): Ticker24hrResponse | undefined {
    return tickers.value[symbol];
  }

  function getFunding(symbol: string): PremiumIndexResponse | undefined {
    return fundingRates.value[symbol];
  }

  return {
    exchangeInfo,
    symbols,
    symbolNames,
    tickers,
    fundingRates,
    loading,
    getSymbolInfo,
    getTicker,
    getFunding,
    fetchTickers,
    fetchFundingRates,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeMarket.ts
git commit -m "feat(strike-v2): add exchange info and tickers composable"
```

---

### Task 2: Market Data WebSocket Streaming

**Files:**
- Create: `src/modules/market/composables/useStrikeMarketWs.ts`

The v2 market WebSocket provides real-time price updates, order book changes, and trade feeds. Connection URL pattern (from docs): `wss://api.strikefinance.org/ws/market` or similar.

- [ ] **Step 1: Create WebSocket composable**

```typescript
// src/modules/market/composables/useStrikeMarketWs.ts
import { ref, onUnmounted } from 'vue';
import type { Ticker24hrResponse } from '@/api/strike-v2.types';

const WS_BASE = 'wss://stream.strikefinance.org';

// Shared connection state
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const connected = ref(false);
const subscriptions = new Map<string, Set<(data: any) => void>>();

function connect(): void {
  if (ws) return;
  ws = new WebSocket(WS_BASE);

  ws.onopen = () => {
    connected.value = true;
    // Re-subscribe to active channels
    for (const channel of subscriptions.keys()) {
      ws?.send(JSON.stringify({ method: 'SUBSCRIBE', params: [channel] }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      // Route message to subscribers based on stream/channel
      const stream = msg.stream || msg.e; // stream name or event type
      if (stream && subscriptions.has(stream)) {
        subscriptions.get(stream)!.forEach(cb => cb(msg.data || msg));
      }
    } catch { /* ignore non-JSON */ }
  };

  ws.onclose = () => {
    ws = null;
    connected.value = false;
    reconnectTimer = setTimeout(connect, 5000);
  };

  ws.onerror = () => ws?.close();
}

function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  connected.value = false;
}

function subscribe(channel: string, callback: (data: any) => void): () => void {
  if (!subscriptions.has(channel)) {
    subscriptions.set(channel, new Set());
    ws?.send(JSON.stringify({ method: 'SUBSCRIBE', params: [channel] }));
  }
  subscriptions.get(channel)!.add(callback);

  // Return unsubscribe function
  return () => {
    const subs = subscriptions.get(channel);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        subscriptions.delete(channel);
        ws?.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [channel] }));
      }
    }
  };
}

export function useStrikeMarketWs() {
  if (!ws) connect();

  return {
    connected,
    subscribe,
    disconnect,

    // Convenience: subscribe to symbol ticker
    subscribeTicker(symbol: string, cb: (ticker: Ticker24hrResponse) => void) {
      return subscribe(`${symbol.toLowerCase()}@ticker`, cb);
    },

    // Convenience: subscribe to order book updates
    subscribeOrderBook(symbol: string, cb: (update: any) => void) {
      return subscribe(`${symbol.toLowerCase()}@depth`, cb);
    },

    // Convenience: subscribe to recent trades
    subscribeTrades(symbol: string, cb: (trade: any) => void) {
      return subscribe(`${symbol.toLowerCase()}@trade`, cb);
    },

    // Convenience: subscribe to mark price
    subscribeMarkPrice(symbol: string, cb: (data: any) => void) {
      return subscribe(`${symbol.toLowerCase()}@markPrice`, cb);
    },
  };
}
```

**Note:** The exact WebSocket URL and message format need to be verified against the actual Strike v2 WebSocket docs (the docs pages returned 403). The channel naming convention (`symbol@stream`) follows the Binance-like pattern that Strike v2 appears to use. Adjust during implementation.

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeMarketWs.ts
git commit -m "feat(strike-v2): add market data WebSocket composable"
```

---

### Task 3: Trading Composable (Order Management)

**Files:**
- Create: `src/modules/market/composables/useStrikeTrading.ts`

- [ ] **Step 1: Create trading composable**

```typescript
// src/modules/market/composables/useStrikeTrading.ts
import { ref, computed } from 'vue';
import { strikeTradeApi } from '@/api/strike-v2.trade';
import { strikeUserApi } from '@/api/strike-v2.user';
import type {
  CreateOrderRequest, Order, OpenOrdersResponse,
  AccountResponse, PositionsResponse,
  OrderSide, OrderType, MarginMode,
} from '@/api/strike-v2.types';

const account = ref<AccountResponse | null>(null);
const openOrders = ref<Order[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

export function useStrikeTrading() {

  async function loadAccount(): Promise<void> {
    try {
      account.value = await strikeUserApi.getAccount();
    } catch (e: any) {
      console.error('Failed to load Strike account:', e);
    }
  }

  async function loadOpenOrders(symbol?: string): Promise<void> {
    try {
      const res = await strikeTradeApi.getOpenOrders(symbol);
      openOrders.value = res.orders;
    } catch (e: any) {
      console.error('Failed to load open orders:', e);
    }
  }

  async function placeOrder(params: {
    symbol: string;
    side: OrderSide;
    type: OrderType;
    size: string;
    price?: string;
    stopPrice?: string;
    tpPrice?: string;
    slPrice?: string;
    reduceOnly?: boolean;
    closePosition?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    loading.value = true;
    error.value = null;

    try {
      // If TP or SL, use strategy order
      if (params.tpPrice || params.slPrice) {
        await strikeTradeApi.createStrategyOrder({
          strategy_id: crypto.randomUUID(),
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          size: params.size,
          price: params.price,
          stop_price: params.stopPrice,
          reduce_only: params.reduceOnly,
          close_position: params.closePosition,
          tp_order: params.tpPrice ? {
            type: 'take_profit',
            size: params.size,
            stop_price: params.tpPrice,
          } : undefined,
          sl_order: params.slPrice ? {
            type: 'stop',
            size: params.size,
            stop_price: params.slPrice,
          } : undefined,
        });
      } else {
        await strikeTradeApi.createOrder({
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          size: params.size,
          price: params.price,
          stop_price: params.stopPrice,
          reduce_only: params.reduceOnly,
          close_position: params.closePosition,
        });
      }

      // Refresh orders + account after placing
      await Promise.all([loadOpenOrders(params.symbol), loadAccount()]);
      return { success: true };
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Order failed';
      error.value = msg;
      return { success: false, error: msg };
    } finally {
      loading.value = false;
    }
  }

  async function cancelOrder(orderId: number, symbol: string) {
    try {
      await strikeTradeApi.cancelOrder({ order_id: orderId, symbol });
      await loadOpenOrders(symbol);
    } catch (e: any) {
      error.value = e?.response?.data?.error || 'Cancel failed';
    }
  }

  async function cancelAllOrders(symbol?: string) {
    try {
      await strikeTradeApi.cancelAllOrders({ symbol });
      await loadOpenOrders(symbol);
    } catch (e: any) {
      error.value = e?.response?.data?.error || 'Cancel all failed';
    }
  }

  async function setLeverage(symbol: string, leverage: number) {
    try {
      await strikeTradeApi.setLeverage({ symbol, leverage });
      await loadAccount();
    } catch (e: any) {
      error.value = e?.response?.data?.error || 'Failed to set leverage';
    }
  }

  async function setMarginMode(symbol: string, marginMode: MarginMode) {
    try {
      await strikeTradeApi.setMarginMode({ symbol, marginMode });
      await loadAccount();
    } catch (e: any) {
      error.value = e?.response?.data?.error || 'Failed to set margin mode';
    }
  }

  const availableBalance = computed(() => {
    if (!account.value) return '0';
    return account.value.available_balance;
  });

  const walletBalance = computed(() => {
    if (!account.value) return '0';
    return account.value.wallet_balance;
  });

  return {
    account,
    openOrders,
    loading,
    error,
    availableBalance,
    walletBalance,
    loadAccount,
    loadOpenOrders,
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    setLeverage,
    setMarginMode,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeTrading.ts
git commit -m "feat(strike-v2): add trading composable (orders, leverage, margin)"
```

---

### Task 4: Symbol Selector Component

**Files:**
- Create: `src/sidepanel/components/perps/SymbolSelector.vue`

- [ ] **Step 1: Create symbol selector**

A dropdown/bottom-sheet that shows available trading pairs (BTC-USD, ETH-USD, SOL-USD, ADA-USD, etc.) with their 24h change and last price. Used in both mini-gero and full dashboard.

The component should:
- List all symbols from `useStrikeMarket().symbols`
- Show last price and 24h change from tickers
- Emit `select` event with symbol string
- Highlight currently selected symbol

- [ ] **Step 2: Commit**

---

### Task 5: Price Ticker Component

**Files:**
- Create: `src/sidepanel/components/perps/PriceTicker.vue`

- [ ] **Step 1: Create live price display**

Shows for the selected symbol:
- Mark price (from WebSocket or REST)
- Index price
- 24h change %
- Funding rate + countdown to next funding
- Open interest

- [ ] **Step 2: Commit**

---

### Task 6: Order Form Component

**Files:**
- Create: `src/sidepanel/components/perps/OrderForm.vue`

- [ ] **Step 1: Create order entry form**

The core trading component. Features:
- **Side toggle:** Buy (Long) / Sell (Short)
- **Order type selector:** Market, Limit, Stop, Stop Limit
- **Size input** with slider (% of available balance)
- **Price input** (for limit/stop orders)
- **TP/SL toggle** with price inputs (strategy order)
- **Leverage display/edit** (tap to change, 1-125x)
- **Margin mode indicator** (Cross/Isolated)
- **Reduce only / Close position** toggles
- **Cost/margin estimation** preview
- **Place Order button** with loading state

Uses `useStrikeTrading().placeOrder()` for execution.

- [ ] **Step 2: Commit**

---

### Task 7: Order Book Component

**Files:**
- Create: `src/sidepanel/components/perps/OrderBook.vue`

- [ ] **Step 1: Create order book display**

Real-time order book showing:
- Bid/ask levels (price + quantity)
- Spread indicator
- Click-to-fill: clicking a price level sets it in the order form
- Depth visualization (bar widths proportional to quantity)

Uses `useStrikeMarketWs().subscribeOrderBook()` for live updates, with `strikeMarketApi.getOrderBook()` for initial snapshot.

- [ ] **Step 2: Commit**

---

### Task 8: Rewrite PerpetualsPage.vue (Mini-Gero)

**Files:**
- Modify: `src/sidepanel/pages/PerpetualsPage.vue`

- [ ] **Step 1: Replace v1 implementation with v2 components**

The page layout becomes:
1. **Header:** Back button + SymbolSelector + PriceTicker
2. **Segment toggle:** Trade | Positions | Orders | History
3. **Trade segment:** OrderForm + OrderBook (side by side or stacked)
4. **Positions segment:** Live positions from `useStrikeTrading`
5. **Orders segment:** Open orders with cancel actions
6. **History segment:** Closed positions + fill history

Remove all v1-specific code:
- UTXO-based position management (`outRef`, `txHash`)
- CBOR transaction building/signing
- `strike-finance.api.ts` imports
- Manual PnL calculations (v2 API provides `upnl`)

- [ ] **Step 2: Commit**

---

### Task 9: Rewrite PerpetualsDialog.vue (Full Dashboard)

**Files:**
- Modify: `src/modules/dashboard/dialogs/PerpetualsDialog.vue`

- [ ] **Step 1: Rewrite full dashboard perpetuals dialog**

Same feature set as PerpetualsPage but in a dialog/full-page layout. Can reuse the same components (OrderForm, SymbolSelector, PriceTicker, OrderBook) with layout differences.

- [ ] **Step 2: Commit**

---

### Task 10: i18n Keys for New UI

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add translation keys**

New keys needed for:
- Order types: `perpetuals.orderTypeMarket`, `perpetuals.orderTypeLimit`, `perpetuals.orderTypeStop`, etc.
- Margin modes: `perpetuals.marginCross`, `perpetuals.marginIsolated`
- Order form labels: `perpetuals.size`, `perpetuals.price`, `perpetuals.takeProfitPrice`, `perpetuals.stopLossPrice`
- Actions: `perpetuals.placeOrder`, `perpetuals.cancelOrder`, `perpetuals.cancelAll`
- Account: `perpetuals.availableBalance`, `perpetuals.walletBalance`, `perpetuals.marginBalance`

- [ ] **Step 2: Commit**

---

## Summary

After completing this plan:
- Real-time market data via REST + WebSocket
- Full order book trading UI (market/limit/stop + TP/SL brackets)
- Cross/isolated margin mode support
- Per-symbol leverage configuration (1-125x)
- Both mini-gero and full dashboard updated
- No more CBOR transaction signing for perps trades
