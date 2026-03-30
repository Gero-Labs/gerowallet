# Strike v2 Migration — Plan 3: Account, Positions & History

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the account management, position tracking, and comprehensive trade history views using the v2 User Data API and WebSocket.

**Architecture:** v2 uses an account-based model (not UTXO-based). Positions have IDs, margin modes, and real-time unrealized PnL calculated server-side. History includes orders, fills, funding payments, and transactions — all paginated with cursor support.

**Tech Stack:** Vue.js 2.7, TypeScript, `strike-v2.user.ts` from Plan 1, User Data WebSocket

**Depends on:** Plan 1 (API Client + Auth), Plan 2 (Market composables)

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/modules/market/composables/useStrikeAccount.ts` | Composable: account state, balances, portfolio summary |
| `src/modules/market/composables/useStrikePositions.ts` | Composable: open + closed positions, real-time PnL |
| `src/modules/market/composables/useStrikeHistory.ts` | Composable: order/fill/funding/transaction history with pagination |
| `src/modules/market/composables/useStrikeUserWs.ts` | WebSocket: real-time account/position/order updates |
| `src/sidepanel/components/perps/AccountPanel.vue` | Account summary: balance, margin, unrealized PnL |
| `src/sidepanel/components/perps/PositionsTable.vue` | Open positions table with live PnL, close button |
| `src/sidepanel/components/perps/ClosedPositionsTable.vue` | Closed positions with realized PnL |
| `src/sidepanel/components/perps/OrdersTable.vue` | Open orders + order history with status filters |
| `src/sidepanel/components/perps/HistoryTabs.vue` | Tab container: Fills, Funding, Transactions |
| `src/sidepanel/components/perps/PortfolioChart.vue` | Equity curve chart from portfolio history data |

---

### Task 1: Account State Composable

**Files:**
- Create: `src/modules/market/composables/useStrikeAccount.ts`

- [ ] **Step 1: Create account composable**

```typescript
// src/modules/market/composables/useStrikeAccount.ts
import { ref, computed } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import type { AccountResponse, BalanceResponse, PortfolioSummaryResponse } from '@/api/strike-v2.types';

const account = ref<AccountResponse | null>(null);
const balances = ref<BalanceResponse[]>([]);
const portfolio = ref<PortfolioSummaryResponse | null>(null);
const loading = ref(false);

export function useStrikeAccount() {

  async function loadAccount(): Promise<void> {
    loading.value = true;
    try {
      const [acc, bal] = await Promise.all([
        strikeUserApi.getAccount(),
        strikeUserApi.getBalances(),
      ]);
      account.value = acc;
      balances.value = bal;
    } catch (e: any) {
      console.error('Strike account load failed:', e);
    } finally {
      loading.value = false;
    }
  }

  async function loadPortfolio(): Promise<void> {
    try {
      portfolio.value = await strikeUserApi.getPortfolio();
    } catch (e: any) {
      console.error('Strike portfolio load failed:', e);
    }
  }

  const walletBalance = computed(() => account.value?.wallet_balance || '0');
  const availableBalance = computed(() => account.value?.available_balance || '0');
  const unrealizedPnl = computed(() => account.value?.unrealized_pnl || '0');
  const marginBalance = computed(() => account.value?.margin_balance || '0');
  const totalMargin = computed(() => account.value?.total_margin || '0');

  const allTimePnl = computed(() => portfolio.value?.account?.allTimePnl || '0');
  const realizedPnl = computed(() => portfolio.value?.account?.realizedPnl || '0');
  const allTimeVolume = computed(() => portfolio.value?.account?.allTimeVolume || '0');
  const feeTier = computed(() => portfolio.value?.feeTier || 0);
  const isTradingEnabled = computed(() => portfolio.value?.isTradingEnabled ?? false);

  // Equity history for chart: [timestamp_ms, accountValue, realizedPnl, unrealizedPnl]
  const equityHistory = computed(() => portfolio.value?.history || []);

  return {
    account,
    balances,
    portfolio,
    loading,
    walletBalance,
    availableBalance,
    unrealizedPnl,
    marginBalance,
    totalMargin,
    allTimePnl,
    realizedPnl,
    allTimeVolume,
    feeTier,
    isTradingEnabled,
    equityHistory,
    loadAccount,
    loadPortfolio,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeAccount.ts
git commit -m "feat(strike-v2): add account state composable (balances, portfolio)"
```

---

### Task 2: Positions Composable

**Files:**
- Create: `src/modules/market/composables/useStrikePositions.ts`

- [ ] **Step 1: Create positions composable**

```typescript
// src/modules/market/composables/useStrikePositions.ts
import { ref, computed } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import type { Position, ClosedPosition } from '@/api/strike-v2.types';

const positions = ref<Position[]>([]);
const closedPositions = ref<ClosedPosition[]>([]);
const loadingOpen = ref(false);
const loadingClosed = ref(false);

export function useStrikePositions() {

  async function loadPositions(symbol?: string): Promise<void> {
    loadingOpen.value = true;
    try {
      const res = await strikeUserApi.getPositions(symbol);
      positions.value = res.positions;
    } catch (e: any) {
      console.error('Failed to load positions:', e);
    } finally {
      loadingOpen.value = false;
    }
  }

  async function loadClosedPositions(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  } = {}): Promise<void> {
    loadingClosed.value = true;
    try {
      const res = await strikeUserApi.getClosedPositions(params);
      closedPositions.value = res.positions;
    } catch (e: any) {
      console.error('Failed to load closed positions:', e);
    } finally {
      loadingClosed.value = false;
    }
  }

  const openPositionCount = computed(() => positions.value.length);

  const totalUnrealizedPnl = computed(() =>
    positions.value.reduce((sum, p) => sum + parseFloat(p.upnl || '0'), 0)
  );

  function getPositionBySymbol(symbol: string): Position | undefined {
    return positions.value.find(p => p.symbol === symbol && p.Side !== 'none');
  }

  return {
    positions,
    closedPositions,
    loadingOpen,
    loadingClosed,
    openPositionCount,
    totalUnrealizedPnl,
    getPositionBySymbol,
    loadPositions,
    loadClosedPositions,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikePositions.ts
git commit -m "feat(strike-v2): add positions composable (open + closed)"
```

---

### Task 3: History Composable (Orders, Fills, Funding, Transactions)

**Files:**
- Create: `src/modules/market/composables/useStrikeHistory.ts`

- [ ] **Step 1: Create history composable with pagination**

```typescript
// src/modules/market/composables/useStrikeHistory.ts
import { ref } from 'vue';
import { strikeUserApi } from '@/api/strike-v2.user';
import type {
  OrderHistoryResult, FillHistoryResult,
  FundingHistoryResult, TransactionHistoryResult,
} from '@/api/strike-v2.types';

const orderHistory = ref<OrderHistoryResult[]>([]);
const fillHistory = ref<FillHistoryResult[]>([]);
const fundingHistory = ref<FundingHistoryResult[]>([]);
const transactionHistory = ref<TransactionHistoryResult[]>([]);
const loading = ref(false);

export function useStrikeHistory() {

  async function loadOrderHistory(params: {
    symbol?: string;
    status?: number;
    limit?: number;
  } = {}): Promise<void> {
    loading.value = true;
    try {
      const res = await strikeUserApi.getOrderHistory({ limit: 100, ...params });
      orderHistory.value = res.orders;
    } catch (e: any) {
      console.error('Failed to load order history:', e);
    } finally {
      loading.value = false;
    }
  }

  async function loadFillHistory(params: {
    symbol?: string;
    limit?: number;
  } = {}): Promise<void> {
    loading.value = true;
    try {
      const res = await strikeUserApi.getFillHistory({ limit: 500, ...params });
      fillHistory.value = res.fills;
    } catch (e: any) {
      console.error('Failed to load fill history:', e);
    } finally {
      loading.value = false;
    }
  }

  async function loadFundingHistory(params: {
    symbol?: string;
    limit?: number;
  } = {}): Promise<void> {
    loading.value = true;
    try {
      const res = await strikeUserApi.getFundingHistory({ limit: 500, ...params });
      fundingHistory.value = res.funding;
    } catch (e: any) {
      console.error('Failed to load funding history:', e);
    } finally {
      loading.value = false;
    }
  }

  async function loadTransactionHistory(params: {
    type?: string;
    limit?: number;
  } = {}): Promise<void> {
    loading.value = true;
    try {
      const res = await strikeUserApi.getTransactionHistory({ limit: 100, ...params });
      transactionHistory.value = res.transactions;
    } catch (e: any) {
      console.error('Failed to load transaction history:', e);
    } finally {
      loading.value = false;
    }
  }

  return {
    orderHistory,
    fillHistory,
    fundingHistory,
    transactionHistory,
    loading,
    loadOrderHistory,
    loadFillHistory,
    loadFundingHistory,
    loadTransactionHistory,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeHistory.ts
git commit -m "feat(strike-v2): add history composable (orders, fills, funding, transactions)"
```

---

### Task 4: User Data WebSocket

**Files:**
- Create: `src/modules/market/composables/useStrikeUserWs.ts`

- [ ] **Step 1: Create user data WebSocket composable**

The user WebSocket provides real-time updates for:
- Account balance changes
- Position updates (new, modified, closed)
- Order status changes (filled, canceled, etc.)

```typescript
// src/modules/market/composables/useStrikeUserWs.ts
import { ref } from 'vue';
import { hasStrikeApiKeys } from '@/api/strike-v2.client';

const WS_USER_BASE = 'wss://stream.strikefinance.org/ws/user';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const connected = ref(false);

type EventCallback = (data: any) => void;
const listeners = new Map<string, Set<EventCallback>>();

function connect(listenKey?: string): void {
  if (ws || !hasStrikeApiKeys()) return;

  const url = listenKey ? `${WS_USER_BASE}?listenKey=${listenKey}` : WS_USER_BASE;
  ws = new WebSocket(url);

  ws.onopen = () => { connected.value = true; };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const eventType = msg.e || msg.type;
      if (eventType && listeners.has(eventType)) {
        listeners.get(eventType)!.forEach(cb => cb(msg));
      }
      // Also fire wildcard listeners
      if (listeners.has('*')) {
        listeners.get('*')!.forEach(cb => cb(msg));
      }
    } catch { /* ignore */ }
  };

  ws.onclose = () => {
    ws = null;
    connected.value = false;
    reconnectTimer = setTimeout(() => connect(listenKey), 5000);
  };
}

function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  connected.value = false;
}

function on(event: string, callback: EventCallback): () => void {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event)!.add(callback);
  return () => listeners.get(event)?.delete(callback);
}

export function useStrikeUserWs() {
  return {
    connected,
    connect,
    disconnect,

    // Subscribe to specific event types
    onAccountUpdate: (cb: EventCallback) => on('ACCOUNT_UPDATE', cb),
    onOrderUpdate: (cb: EventCallback) => on('ORDER_TRADE_UPDATE', cb),
    onPositionUpdate: (cb: EventCallback) => on('POSITION_UPDATE', cb),
    onBalanceUpdate: (cb: EventCallback) => on('BALANCE_UPDATE', cb),
    onAny: (cb: EventCallback) => on('*', cb),
  };
}
```

**Note:** The exact WebSocket URL, authentication method (listenKey vs auth headers), and event type names need verification against the actual Strike v2 docs. The pattern shown follows the Binance-like model that Strike v2 appears to use.

- [ ] **Step 2: Commit**

```bash
git add src/modules/market/composables/useStrikeUserWs.ts
git commit -m "feat(strike-v2): add user data WebSocket composable"
```

---

### Task 5: Account Panel Component

**Files:**
- Create: `src/sidepanel/components/perps/AccountPanel.vue`

- [ ] **Step 1: Create account summary panel**

Shows:
- Wallet balance
- Available balance
- Margin balance (used / total)
- Unrealized PnL (colored)
- All-time PnL + volume (from portfolio)
- Fee tier indicator
- Deposit/Withdraw buttons (links to on-chain flow)

Uses `useStrikeAccount()` composable.

- [ ] **Step 2: Commit**

---

### Task 6: Positions Table Component

**Files:**
- Create: `src/sidepanel/components/perps/PositionsTable.vue`

- [ ] **Step 1: Create open positions table**

Shows per position:
- Symbol + side badge (Long/Short)
- Entry price
- Mark price (live from WebSocket)
- Size
- Leverage + margin mode
- Unrealized PnL (colored, from API `upnl` field)
- Liquidation price
- Close button (places market close-position order)
- Edit TP/SL action

Uses `useStrikePositions()` for data, `useStrikeTrading().placeOrder()` for close actions.

- [ ] **Step 2: Commit**

---

### Task 7: Orders Table Component

**Files:**
- Create: `src/sidepanel/components/perps/OrdersTable.vue`

- [ ] **Step 1: Create orders table with tabs (Open / History)**

Open Orders tab:
- Type, side, symbol, price, size, filled, status, time
- Cancel button per order
- Cancel All button

Order History tab:
- Same columns + status filter chips (filled, canceled, rejected)
- Pagination (load more)

Uses `useStrikeTrading()` for open orders + cancel, `useStrikeHistory()` for history.

- [ ] **Step 2: Commit**

---

### Task 8: History Tabs Component

**Files:**
- Create: `src/sidepanel/components/perps/HistoryTabs.vue`

- [ ] **Step 1: Create history tabs (Fills / Funding / Transactions)**

**Fills tab:**
- Symbol, side, price, quantity, fee, realized PnL, time
- Highlight liquidation/ADL fills

**Funding tab:**
- Symbol, income (+ received / - paid), time
- Running total

**Transactions tab:**
- Type (deposit/withdraw/fee/pnl/liquidation), amount, status, time

All tabs use `useStrikeHistory()` with lazy loading per tab.

- [ ] **Step 2: Commit**

---

### Task 9: Equity Curve Chart Component

**Files:**
- Create: `src/sidepanel/components/perps/PortfolioChart.vue`

- [ ] **Step 1: Create equity curve chart**

Uses `portfolio.history` data from `useStrikeAccount().equityHistory`:
- Line chart showing account value over time
- Overlay: realized PnL, unrealized PnL
- Time range selector (matches portfolio API period param)

Can reuse existing lightweight-charts or chart.js patterns from the market chart.

- [ ] **Step 2: Commit**

---

### Task 10: Deprecate v1 Position/History Code

**Files:**
- Modify: `src/api/strike-finance.api.ts` — mark as deprecated, keep for reference
- Modify: `src/modules/dashboard/dialogs/PerpetualsDialog.vue` — remove v1 position management
- Modify: `src/sidepanel/pages/PerpetualsPage.vue` — remove v1 position management

- [ ] **Step 1: Remove v1 position-specific code**

Delete:
- `getPositions(address)` → replaced by `strikeUserApi.getPositions()`
- `closePosition(request)` → replaced by close-position market order
- `openPosition(request)` → replaced by `strikeTradeApi.createOrder()`
- `submitTx(cbor, witness)` → no longer needed (no CBOR in v2)
- `getPerpetualHistory(address)` → replaced by `strikeUserApi.getOrderHistory()`
- `calculatePnL()` → server provides `upnl` directly
- `calculateLiquidationPrice()` → server provides `liquidation_price` directly

- [ ] **Step 2: Commit**

```bash
git commit -m "refactor(strike-v2): deprecate v1 position/history code"
```

---

## Summary

After completing this plan:
- Full account management (balances, margins, portfolio summary)
- Real-time position tracking with server-calculated PnL
- Comprehensive trade history (orders, fills, funding, transactions)
- User data WebSocket for live updates
- Equity curve chart from portfolio history
- v1 UTXO-based position code deprecated
