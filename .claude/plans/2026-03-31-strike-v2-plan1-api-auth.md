# Strike v2 Migration — Plan 1: API Client + Auth Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 Strike Finance API client and backend proxy with v2's Ed25519-authenticated, account-based API.

**Architecture:** The v2 API uses Ed25519 signature authentication (not Cardano tx signing). The wallet's Ed25519 private key signs a message `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}` and sends the public key + signature in HTTP headers. The backend proxy injects the partner address but no longer builds/signs CBOR transactions.

**Tech Stack:** TypeScript, Axios, Ed25519 (`@noble/ed25519` or `@cardano-sdk/core`), Java/Spring Boot (backend proxy)

**Reference specs:** `strike-v2-trade-api.yaml`, `strike-v2-user-api.yaml`, `strike-v2-market-api.yaml`, `strike-v2-common.yaml`, `strike-v2-vaults.yaml`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/api/strike-v2.types.ts` | All v2 TypeScript interfaces (shared across API modules) |
| `src/api/strike-v2.auth.ts` | Ed25519 signing utility — builds auth headers from wallet keys |
| `src/api/strike-v2.client.ts` | Axios instance with auth interceptor, base URL config |
| `src/api/strike-v2.trade.ts` | Trade API: orders, leverage, margin mode |
| `src/api/strike-v2.user.ts` | User API: account, positions, history |
| `src/api/strike-v2.market.ts` | Market API: prices, orderbook, tickers, funding |
| `src/api/strike-v2.vaults.ts` | Vault API: list, deposit, withdraw, portfolio |
| `gero-backend/.../strike/StrikeV2Controller.java` | New backend proxy controller for v2 endpoints |
| `gero-backend/.../strike/model/v2/` | New v2 request/response models |

---

### Task 1: Define v2 TypeScript Types

**Files:**
- Create: `src/api/strike-v2.types.ts`

- [ ] **Step 1: Create the shared types file**

```typescript
// src/api/strike-v2.types.ts

// ── Enums ──

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market' | 'stop' | 'stop_limit' | 'take_profit' | 'take_profit_limit';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'canceled' | 'untriggered' | 'rejected' | 'expired' | 'none';
export type TimeInForce = 'GTC' | 'IOC' | 'FOK';
export type WorkingType = 'mark_price' | 'contract_price';
export type PositionSide = 'long' | 'short' | 'none';
export type MarginMode = 'cross' | 'isolated';
export type ModifyType = 'add' | 'remove';
export type TransactionType = 'deposit' | 'withdraw' | 'fee' | 'realized_pnl' | 'liquidation';
export type TransactionStatus = 'pending' | 'completed' | 'pending_settlement' | 'settled' | 'failed' | 'cancelled';
export type VaultStatus = 'active' | 'paused' | 'closed';
export type VaultPeriod = '24h' | '7d' | '30d' | '6m' | '1y' | 'all';

// ── Trade API ──

export interface CreateOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  size: string;
  client_order_id?: string;
  price?: string;
  stop_price?: string;
  time_in_force?: TimeInForce;
  working_type?: WorkingType;
  post_only?: boolean;
  reduce_only?: boolean;
  close_position?: boolean;
  price_protect?: boolean;
  vault_id?: string;
}

export interface CreateOrderResponse {
  client_order_id: string;
  account_id: string;
  symbol: string;
  sequence_id: number;
  message_id: string;
}

export interface CancelOrderRequest {
  order_id: number;
  symbol: string;
  vault_id?: string;
}

export interface CancelOrderResponse {
  order_id: number;
  symbol: string;
  sequence_id: number;
  message_id: string;
}

export interface CancelAllOrdersRequest {
  symbol?: string;
  vault_id?: string;
}

export interface CancelAllOrdersResponse {
  account_id: string;
  symbol: string;
  canceled_count: number;
  sequence_id: number;
  message_id: string;
}

export interface StrategyOrderDetails {
  type: OrderType;
  size: string;
  stop_price: string;
  client_order_id?: string;
  price?: string;
  time_in_force?: TimeInForce;
  working_type?: WorkingType;
  post_only?: boolean;
  price_protect?: boolean;
}

export interface CreateStrategyOrderRequest extends CreateOrderRequest {
  strategy_id: string;
  tp_order?: StrategyOrderDetails;
  sl_order?: StrategyOrderDetails;
}

export interface CreateStrategyOrderResponse {
  strategy_id: string;
  primary_client_order_id: string;
  tp_client_order_id?: string;
  sl_client_order_id?: string;
  account_id: string;
  symbol: string;
  sequence_id: number;
  message_id: string;
}

export interface LeverageRequest {
  symbol: string;
  leverage: number; // 1-125
  vault_id?: string;
}

export interface LeverageResponse {
  leverage: number;
  maxNotionalValue: string;
  symbol: string;
}

export interface MarginModeRequest {
  symbol: string;
  marginMode: MarginMode;
  vault_id?: string;
}

export interface ModifyMarginRequest {
  symbol: string;
  amount: string;
  modify_type: ModifyType;
  vault_id?: string;
}

export interface Order {
  ID: number;
  ClientOrderID: string;
  AccountID: string;
  Symbol: string;
  Side: OrderSide;
  Status: OrderStatus;
  Type: OrderType;
  Size: string;
  Filled: string;
  Price: string;
  StopPrice: string;
  TimeInForce: TimeInForce;
  WorkingType: WorkingType;
  PostOnly: boolean;
  ReduceOnly: boolean;
  ClosePosition: boolean;
  PriceProtect: boolean;
  StrategyID: string;
  CreatedAt: number;
  UpdatedAt: number;
}

export interface OpenOrdersResponse {
  orders: Order[];
  count: number;
}

// ── User API ──

export interface AccountResponse {
  account_id: string;
  blockchain: string;
  blockchain_address: string;
  wallet_balance: string;
  available_balance: string;
  unrealized_pnl: string;
  margin_balance: string;
  total_margin: string;
  position_initial_margin: string;
  maintenance_margin: string;
  symbol_settings: Record<string, { margin_mode: MarginMode; leverage: number }>;
}

export interface BalanceResponse {
  asset: string;
  walletBalance: string;
  unrealizedPnl: string;
  marginBalance: string;
  maintMargin: string;
  initialMargin: string;
  positionInitialMargin: string;
  openOrderInitialMargin: string;
  crossWalletBalance: string;
  crossUnPnl: string;
  availableBalance: string;
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  updateTime: number;
}

export interface Position {
  symbol: string;
  PositionID: number;
  Side: PositionSide;
  Size: string;
  EntryPrice: string;
  MarginMode: MarginMode;
  Leverage: number;
  IsolatedMargin: string;
  upnl: string;
  maintenance_margin: string;
  bankruptcy_price: string;
  liquidation_price: string;
}

export interface PositionsResponse {
  positions: Position[];
  count: number;
}

export interface ClosedPosition {
  symbol: string;
  position_id: number;
  side: PositionSide;
  size: string;
  entry_price: string;
  exit_price: string;
  realized_pnl: string;
  margin_mode: MarginMode;
  leverage: number;
  opened_at: number;
  closed_at: number;
}

export interface ClosedPositionsResponse {
  positions: ClosedPosition[];
  count: number;
}

export interface PortfolioSummaryResponse {
  account: {
    accountValue: string;
    positionValue: string;
    availableBalance: string;
    allTimePnl: string;
    realizedPnl: string;
    unrealizedPnl: string;
    allTimeVolume: string;
    currentPositionSize: string;
  };
  volume: string;
  fees: string;
  history: [number, string, string, string][]; // [timestamp_ms, accountValue, realizedPnl, unrealizedPnl]
  feeTier: number;
  feeTiers: { tier: number; minVolume: number; takerRate: number; makerRate: number }[];
  volume_history: { date: string; volume: string }[];
  feeDiscountRate: number;
  isTradingEnabled: boolean;
}

export interface OrderHistoryResult {
  order_id: number;
  client_order_id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  price: string;
  size: string;
  filled: string;
  created_at: number;
  updated_at: number;
}

export interface FillHistoryResult {
  id: number;
  order_id: number;
  symbol: string;
  side: OrderSide;
  price: string;
  qty: string;
  quote_qty: string;
  commission: string;
  commission_asset: string;
  realized_pnl: string;
  is_maker: boolean;
  time: number;
  auto_close_type?: 'liquidation' | 'adl' | 'bankrupt' | 'if_transfer' | null;
}

export interface FundingHistoryResult {
  id: number;
  symbol: string;
  income: string;
  asset: string;
  time: number;
}

export interface TransactionHistoryResult {
  id: number;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  asset: string;
  time: number;
}

// ── Market API ──

export interface ExchangeInfo {
  timezone: string;
  serverTime: number;
  rateLimits: { rateLimitType: string; interval: string; intervalNum: number; limit: number }[];
  symbols: SymbolInfo[];
}

export interface SymbolInfo {
  symbol: string;
  pair: string;
  contractType: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  marginAsset: string;
  pricePrecision: number;
  quantityPrecision: number;
  baseAssetPrecision: number;
  quotePrecision: number;
  filters: SymbolFilter[];
  orderType: string[];
  timeInForce: string[];
}

export interface SymbolFilter {
  filterType: string;
  maxPrice?: string;
  minPrice?: string;
  tickSize?: string;
  maxQty?: string;
  minQty?: string;
  stepSize?: string;
  notional?: string;
  limit?: number;
}

export interface OrderBookResponse {
  lastUpdateId: number;
  E: number;
  T: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface TradeResponse {
  id: number;
  price: string;
  qty: string;
  quoteQty: string;
  time: number;
  isBuyerMaker: boolean;
}

export interface PremiumIndexResponse {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  interestRate: string;
  time: number;
}

export interface Ticker24hrResponse {
  symbol: string;
  priceChange: string;
  priceChangePercent: string;
  weightedAvgPrice: string;
  lastPrice: string;
  lastQty: string;
  openPrice: string;
  highPrice: string;
  lowPrice: string;
  volume: string;
  quoteVolume: string;
  openTime: number;
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface TickerPriceResponse {
  symbol: string;
  price: string;
  time: number;
}

export interface BookTickerResponse {
  symbol: string;
  bidPrice: string;
  bidQty: string;
  askPrice: string;
  askQty: string;
  time: number;
}

export interface OpenInterestResponse {
  symbol: string;
  openInterest: string;
  time: number;
}

// ── Vault API ──

export interface VaultInfo {
  id: string;
  name: string;
  description: string;
  leader_account_id: string;
  type: 'user' | 'protocol';
  status: VaultStatus;
  is_verified: boolean;
  tvl: string;
  apr: string;
  pnl: string;
  sharpe_ratio: string;
  max_drawdown: string;
  depositor_count: number;
  created_at: number;
}

export interface VaultListResponse {
  vaults: VaultInfo[];
  count: number;
  limit: number;
  offset: number;
}

export interface VaultPortfolioResponse {
  tvl: string;
  apr: string;
  pnl: string;
  sharpe_ratio: string;
  max_drawdown: string;
  history: [number, string, string, string][]; // [timestamp, tvl, pnl, fees]
}

export interface VaultDepositor {
  account_id: string;
  equity: string;
  share_percentage: string;
  pnl: string;
}

export interface UserVaultPosition {
  vault_id: string;
  shares: string;
  deposited: string;
  withdrawn: string;
  entry_price: string;
  current_value: string;
  pnl: string;
}

// ── Auth ──

export interface StrikeAuthHeaders {
  'X-API-Wallet-Public-Key': string;
  'X-API-Wallet-Signature': string;
  'X-API-Wallet-Timestamp': string;
  'X-API-Wallet-Nonce': string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/strike-v2.types.ts
git commit -m "feat(strike-v2): add TypeScript types for all v2 API schemas"
```

---

### Task 2: Ed25519 Auth Signing Utility

**Files:**
- Create: `src/api/strike-v2.auth.ts`

The v2 API requires Ed25519 signing. Cardano wallets use Ed25519 keys natively — we need to:
1. Get the wallet's Ed25519 private/public key pair
2. Sign the message `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}`
3. Return the 4 auth headers

- [ ] **Step 1: Create the auth signing module**

```typescript
// src/api/strike-v2.auth.ts
import { blake2b } from 'blake2b';
import type { StrikeAuthHeaders } from './strike-v2.types';

/**
 * Build Ed25519 auth headers for Strike v2 API requests.
 *
 * The wallet's Ed25519 private key signs:
 *   {METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}
 *
 * BODY_HASH = hex(blake2b-256(body)) for POST, or empty string for GET.
 *
 * @param method - HTTP method (GET, POST, DELETE)
 * @param path - URL path (e.g., /v2/order)
 * @param body - Request body string (empty for GET)
 * @param privateKeyHex - Ed25519 private key (64 hex chars = 32 bytes)
 * @param publicKeyHex - Ed25519 public key (64 hex chars = 32 bytes)
 * @returns The 4 auth headers
 */
export async function buildStrikeAuthHeaders(
  method: string,
  path: string,
  body: string,
  privateKeyHex: string,
  publicKeyHex: string,
): Promise<StrikeAuthHeaders> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();

  // Body hash: blake2b-256 of body for POST/DELETE, empty for GET
  let bodyHash = '';
  if (body) {
    const bodyBytes = new TextEncoder().encode(body);
    const hash = blake2b(32).update(bodyBytes).digest('hex');
    bodyHash = hash;
  }

  // Message to sign
  const message = `${method.toUpperCase()}:${path}:${timestamp}:${nonce}:${bodyHash}`;
  const messageBytes = new TextEncoder().encode(message);

  // Sign with Ed25519 — use @noble/ed25519 or @cardano-sdk/crypto
  // Import dynamically to avoid WASM init issues at module level
  const { ed25519 } = await import('@noble/curves/ed25519');
  const privateKeyBytes = hexToBytes(privateKeyHex);
  const signature = ed25519.sign(messageBytes, privateKeyBytes);
  const signatureHex = bytesToHex(signature);

  return {
    'X-API-Wallet-Public-Key': publicKeyHex,
    'X-API-Wallet-Signature': signatureHex,
    'X-API-Wallet-Timestamp': timestamp,
    'X-API-Wallet-Nonce': nonce,
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
```

**Note:** The exact signing library depends on what's already available in the project. `@noble/curves` is preferred (already a transitive dep of `@noble/hashes` which is in the project). If not available, use `@cardano-sdk/crypto` which is already bundled. The implementation may need adjustment during execution based on which Ed25519 implementation is importable in the extension context.

- [ ] **Step 2: Verify `@noble/curves` is available or install it**

```bash
npm ls @noble/curves 2>/dev/null || npm install @noble/curves
```

- [ ] **Step 3: Commit**

```bash
git add src/api/strike-v2.auth.ts
git commit -m "feat(strike-v2): add Ed25519 signing utility for API auth headers"
```

---

### Task 3: Authenticated Axios Client

**Files:**
- Create: `src/api/strike-v2.client.ts`

- [ ] **Step 1: Create the base client with auth interceptor**

```typescript
// src/api/strike-v2.client.ts
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { buildStrikeAuthHeaders } from './strike-v2.auth';

const STRIKE_API_BASE = 'https://api.strikefinance.org';

// Singleton key provider — set by the wallet after login
let _privateKeyHex: string | null = null;
let _publicKeyHex: string | null = null;

export function setStrikeApiKeys(privateKeyHex: string, publicKeyHex: string): void {
  _privateKeyHex = privateKeyHex;
  _publicKeyHex = publicKeyHex;
}

export function clearStrikeApiKeys(): void {
  _privateKeyHex = null;
  _publicKeyHex = null;
}

export function hasStrikeApiKeys(): boolean {
  return !!_privateKeyHex && !!_publicKeyHex;
}

/**
 * Create an authenticated Axios instance for Strike v2 API.
 * Auth headers are auto-injected via request interceptor.
 */
function createStrikeClient(): AxiosInstance {
  const client = axios.create({
    baseURL: STRIKE_API_BASE,
    timeout: 30000,
    headers: { 'Content-Type': 'application/json' },
  });

  // Auth interceptor — signs every request
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    if (!_privateKeyHex || !_publicKeyHex) {
      // Skip auth for public endpoints (market data)
      return config;
    }

    const method = (config.method || 'GET').toUpperCase();
    const path = config.url || '';
    const body = config.data ? JSON.stringify(config.data) : '';

    const authHeaders = await buildStrikeAuthHeaders(
      method, path, body, _privateKeyHex, _publicKeyHex
    );

    Object.assign(config.headers, authHeaders);
    return config;
  });

  return client;
}

// Authenticated client (trade + user API)
export const strikeClient = createStrikeClient();

// Unauthenticated client for public market data (different base path)
export const strikeMarketClient = axios.create({
  baseURL: `${STRIKE_API_BASE}/price`,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});
```

- [ ] **Step 2: Commit**

```bash
git add src/api/strike-v2.client.ts
git commit -m "feat(strike-v2): add authenticated Axios client with Ed25519 interceptor"
```

---

### Task 4: Trade API Module

**Files:**
- Create: `src/api/strike-v2.trade.ts`

- [ ] **Step 1: Create trade API functions**

```typescript
// src/api/strike-v2.trade.ts
import { strikeClient } from './strike-v2.client';
import type {
  CreateOrderRequest, CreateOrderResponse,
  CancelOrderRequest, CancelOrderResponse,
  CancelAllOrdersRequest, CancelAllOrdersResponse,
  CreateStrategyOrderRequest, CreateStrategyOrderResponse,
  LeverageRequest, LeverageResponse,
  MarginModeRequest, ModifyMarginRequest,
  Order, OpenOrdersResponse,
} from './strike-v2.types';

export const strikeTradeApi = {
  // ── Orders ──

  async createOrder(req: CreateOrderRequest): Promise<CreateOrderResponse> {
    const { data } = await strikeClient.post('/v2/order', req);
    return data;
  },

  async getOrder(symbol: string, orderId?: number, clientOrderId?: string): Promise<Order> {
    const { data } = await strikeClient.get('/v2/order', {
      params: { symbol, order_id: orderId, client_order_id: clientOrderId },
    });
    return data;
  },

  async cancelOrder(req: CancelOrderRequest): Promise<CancelOrderResponse> {
    const { data } = await strikeClient.delete('/v2/order/cancel', { data: req });
    return data;
  },

  async cancelAllOrders(req: CancelAllOrdersRequest): Promise<CancelAllOrdersResponse> {
    const { data } = await strikeClient.delete('/v2/order/cancel-all', { data: req });
    return data;
  },

  async getOpenOrders(symbol?: string, vaultId?: string): Promise<OpenOrdersResponse> {
    const { data } = await strikeClient.get('/v2/openOrders', {
      params: { symbol, vault_id: vaultId },
    });
    return data;
  },

  async createStrategyOrder(req: CreateStrategyOrderRequest): Promise<CreateStrategyOrderResponse> {
    const { data } = await strikeClient.post('/v2/order/strategy', req);
    return data;
  },

  async createBatchOrders(orders: CreateOrderRequest[], vaultId?: string) {
    const { data } = await strikeClient.post('/v2/orders/batch', { orders, vault_id: vaultId });
    return data;
  },

  // ── Trading Settings ──

  async setLeverage(req: LeverageRequest): Promise<LeverageResponse> {
    const { data } = await strikeClient.post('/v2/leverage', req);
    return data;
  },

  async setMarginMode(req: MarginModeRequest) {
    const { data } = await strikeClient.post('/v2/marginMode', req);
    return data;
  },

  async modifyIsolatedMargin(req: ModifyMarginRequest) {
    const { data } = await strikeClient.post('/v2/isoMargin', req);
    return data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/strike-v2.trade.ts
git commit -m "feat(strike-v2): add trade API module (orders, leverage, margin)"
```

---

### Task 5: User API Module

**Files:**
- Create: `src/api/strike-v2.user.ts`

- [ ] **Step 1: Create user API functions**

```typescript
// src/api/strike-v2.user.ts
import { strikeClient } from './strike-v2.client';
import type {
  AccountResponse, BalanceResponse, PortfolioSummaryResponse,
  PositionsResponse, ClosedPositionsResponse,
  OrderHistoryResult, FillHistoryResult,
  FundingHistoryResult, TransactionHistoryResult,
} from './strike-v2.types';

export const strikeUserApi = {
  // ── Account ──

  async getAccount(vaultId?: string): Promise<AccountResponse> {
    const { data } = await strikeClient.get('/v2/account', { params: { vault_id: vaultId } });
    return data;
  },

  async getBalances(vaultId?: string): Promise<BalanceResponse[]> {
    const { data } = await strikeClient.get('/v2/balances', { params: { vault_id: vaultId } });
    return data;
  },

  async getPortfolio(vaultId?: string): Promise<PortfolioSummaryResponse> {
    const { data } = await strikeClient.get('/v2/portfolio', { params: { vault_id: vaultId } });
    return data;
  },

  // ── Positions ──

  async getPositions(symbol?: string, vaultId?: string): Promise<PositionsResponse> {
    const { data } = await strikeClient.get('/v2/positions', {
      params: { symbol, vault_id: vaultId },
    });
    return data;
  },

  async getClosedPositions(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  } = {}): Promise<ClosedPositionsResponse> {
    const { data } = await strikeClient.get('/v2/closedPositions', { params });
    return data;
  },

  // ── History ──

  async getOrderHistory(params: {
    symbol?: string;
    status?: number;
    order_id?: number;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  } = {}): Promise<{ orders: OrderHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/order', { params });
    return data;
  },

  async getFillHistory(params: {
    symbol?: string;
    order_id?: number;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  } = {}): Promise<{ fills: FillHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/fill', { params });
    return data;
  },

  async getFundingHistory(params: {
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  } = {}): Promise<{ funding: FundingHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/funding', { params });
    return data;
  },

  async getTransactionHistory(params: {
    type?: string;
    status?: number;
    startTime?: number;
    endTime?: number;
    limit?: number;
    vault_id?: string;
  } = {}): Promise<{ transactions: TransactionHistoryResult[]; count: number }> {
    const { data } = await strikeClient.get('/v2/history/transaction', { params });
    return data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/strike-v2.user.ts
git commit -m "feat(strike-v2): add user API module (account, positions, history)"
```

---

### Task 6: Market Data API Module

**Files:**
- Create: `src/api/strike-v2.market.ts`

- [ ] **Step 1: Create market API functions**

```typescript
// src/api/strike-v2.market.ts
import { strikeMarketClient } from './strike-v2.client';
import type {
  ExchangeInfo, OrderBookResponse, TradeResponse,
  PremiumIndexResponse, Ticker24hrResponse,
  TickerPriceResponse, BookTickerResponse, OpenInterestResponse,
} from './strike-v2.types';

export const strikeMarketApi = {
  async getExchangeInfo(): Promise<ExchangeInfo> {
    const { data } = await strikeMarketClient.get('/v2/exchangeInfo');
    return data;
  },

  async getOrderBook(symbol: string, limit = 20): Promise<OrderBookResponse> {
    const { data } = await strikeMarketClient.get('/v2/depth', { params: { symbol, limit } });
    return data;
  },

  async getRecentTrades(symbol: string, limit = 100): Promise<TradeResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/trades', { params: { symbol, limit } });
    return data;
  },

  async getPremiumIndex(symbol?: string): Promise<PremiumIndexResponse | PremiumIndexResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/premiumIndex', { params: { symbol } });
    return data;
  },

  async getMarkPrice(symbol?: string) {
    const { data } = await strikeMarketClient.get('/v2/markPrice', { params: { symbol } });
    return data;
  },

  async getIndexPrice(symbol?: string) {
    const { data } = await strikeMarketClient.get('/v2/indexPrice', { params: { symbol } });
    return data;
  },

  async get24hrTicker(symbol?: string): Promise<Ticker24hrResponse | Ticker24hrResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/ticker/24hr', { params: { symbol } });
    return data;
  },

  async getTickerPrice(symbol?: string): Promise<TickerPriceResponse | TickerPriceResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/ticker/price', { params: { symbol } });
    return data;
  },

  async getBookTicker(symbol?: string): Promise<BookTickerResponse | BookTickerResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/ticker/bookTicker', { params: { symbol } });
    return data;
  },

  async getOpenInterest(symbol?: string): Promise<OpenInterestResponse | OpenInterestResponse[]> {
    const { data } = await strikeMarketClient.get('/v2/openInterest', { params: { symbol } });
    return data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/strike-v2.market.ts
git commit -m "feat(strike-v2): add market data API module (prices, orderbook, tickers)"
```

---

### Task 7: Vault API Module

**Files:**
- Create: `src/api/strike-v2.vaults.ts`

- [ ] **Step 1: Create vault API functions**

```typescript
// src/api/strike-v2.vaults.ts
import { strikeClient, strikeMarketClient } from './strike-v2.client';
import type {
  VaultListResponse, VaultInfo, VaultPortfolioResponse,
  VaultDepositor, UserVaultPosition, VaultPeriod,
} from './strike-v2.types';

export const strikeVaultApi = {
  // ── Public (no auth) ──

  async listVaults(params: {
    limit?: number;
    offset?: number;
    period?: VaultPeriod;
    type?: 'user' | 'protocol';
    is_verified?: string;
    status?: string;
  } = {}): Promise<VaultListResponse> {
    const { data } = await strikeMarketClient.get('/v2/vaults', { params });
    return data;
  },

  async getVault(id: string): Promise<VaultInfo> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}`);
    return data;
  },

  async getVaultHistory(id: string, params: {
    limit?: number;
    offset?: number;
    type?: 'deposit' | 'withdrawal';
    status?: string;
  } = {}) {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}/history`, { params });
    return data;
  },

  async getVaultPortfolio(id: string, period: VaultPeriod = '30d'): Promise<VaultPortfolioResponse> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}/portfolio`, { params: { period } });
    return data;
  },

  async getVaultDepositors(id: string, params: {
    limit?: number;
    offset?: number;
  } = {}): Promise<{ depositors: VaultDepositor[]; count: number }> {
    const { data } = await strikeMarketClient.get(`/v2/vault/${id}/depositors`, { params });
    return data;
  },

  // ── Authenticated ──

  async getUserVaultPosition(vaultId: string): Promise<UserVaultPosition> {
    const { data } = await strikeClient.get('/v2/vault/position', { params: { vault_id: vaultId } });
    return data;
  },

  async getAllUserVaultPositions(): Promise<{ positions: UserVaultPosition[] }> {
    const { data } = await strikeClient.get('/v2/vault/positions');
    return data;
  },

  async getUserVaultHistory(params: {
    vault_id?: string;
    limit?: number;
    offset?: number;
    type?: 'deposit' | 'withdrawal';
    status?: string;
  } = {}) {
    const { data } = await strikeClient.get('/v2/vault/history', { params });
    return data;
  },

  async getMyDepositsHistory(vaultId?: string) {
    const { data } = await strikeClient.get('/v2/vault/my-deposits/history', {
      params: { vault_id: vaultId },
    });
    return data;
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add src/api/strike-v2.vaults.ts
git commit -m "feat(strike-v2): add vault API module (list, portfolio, deposits)"
```

---

### Task 8: Backend Proxy — v2 Controller (Java)

**Files:**
- Create: `gero-backend/src/main/java/io/gerowallet/controller/strike/StrikeV2Controller.java`

The backend proxy is simpler in v2 — it just forwards requests to `api.strikefinance.org` and injects partner-related headers if needed. The v2 API handles auth directly via Ed25519 headers (which the frontend builds), so the backend just passes them through.

However, for security reasons the backend may need to:
1. Forward auth headers from the frontend request
2. Inject any partner-specific params
3. Handle CORS for the extension

- [ ] **Step 1: Create v2 proxy controller**

The v2 backend proxy is a generic pass-through that forwards all `/api/strike/v2/**` requests to `api.strikefinance.org/v2/**`, preserving the auth headers. This replaces the endpoint-specific proxies in the v1 controller.

```java
// StrikeV2Controller.java — generic proxy for Strike v2 API
@Slf4j
@RestController
@RequestMapping("/api/strike/v2")
@Tag(name = "Strike V2 Controller", description = "Proxy for Strike Finance V2 API")
public class StrikeV2Controller {
    private final RestTemplate restTemplate;
    private final String strikeBaseUrl;

    @Autowired
    public StrikeV2Controller(RestTemplate restTemplate, ConfigProperties config) {
        this.restTemplate = restTemplate;
        this.strikeBaseUrl = config.getStrike().getBaseUrl();
    }

    // Forward all requests to Strike v2 API, preserving auth headers
    @RequestMapping(value = "/**", method = {RequestMethod.GET, RequestMethod.POST, RequestMethod.DELETE})
    public ResponseEntity<String> proxyRequest(HttpServletRequest request, @RequestBody(required = false) String body) {
        String path = request.getRequestURI().replace("/api/strike", "");
        String query = request.getQueryString();
        String url = strikeBaseUrl + path + (query != null ? "?" + query : "");

        HttpHeaders headers = new HttpHeaders();
        headers.set("Content-Type", "application/json");
        // Forward Strike auth headers
        copyHeader(request, headers, "X-API-Wallet-Public-Key");
        copyHeader(request, headers, "X-API-Wallet-Signature");
        copyHeader(request, headers, "X-API-Wallet-Timestamp");
        copyHeader(request, headers, "X-API-Wallet-Nonce");

        HttpMethod method = HttpMethod.valueOf(request.getMethod());
        HttpEntity<String> entity = body != null ? new HttpEntity<>(body, headers) : new HttpEntity<>(headers);

        try {
            ResponseEntity<String> response = restTemplate.exchange(url, method, entity, String.class);
            return ResponseEntity.status(response.getStatusCode()).body(response.getBody());
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            return ResponseEntity.status(e.getStatusCode()).body(e.getResponseBodyAsString());
        }
    }

    private void copyHeader(HttpServletRequest from, HttpHeaders to, String name) {
        String value = from.getHeader(name);
        if (value != null) to.set(name, value);
    }
}
```

- [ ] **Step 2: Update application.yml if base URL needs changing**

Check `STRIKE_BASE_URL` env var — v2 uses `https://api.strikefinance.org` (not `app.strikefinance.org`).

- [ ] **Step 3: Commit**

```bash
git add gero-backend/src/main/java/io/gerowallet/controller/strike/StrikeV2Controller.java
git commit -m "feat(strike-v2): add generic v2 proxy controller (forwards auth headers)"
```

---

### Task 9: Wire Up Key Extraction from Wallet

**Files:**
- Modify: `src/api/strike-v2.client.ts`
- Modify: `src/stores/walletStore.ts` (read-only reference)

The wallet's Ed25519 keys need to be extracted and passed to `setStrikeApiKeys()` after login. The exact key extraction depends on how the wallet stores keys — typically `walletStore.keys` contains the public key, and the private key is derived from the spending password + encrypted mnemonic.

- [ ] **Step 1: Document the key extraction flow**

For v2 auth, we need the Ed25519 private key (32 bytes) and public key (32 bytes). In Cardano wallets:
- Public key: Available from `walletStore.keys` (the account public key)
- Private key: Only available after spending password verification (decrypted from mnemonic)

The auth flow will be:
1. User enters spending password (or uses PassKey)
2. Derive Ed25519 key pair from mnemonic
3. Call `setStrikeApiKeys(privateKeyHex, publicKeyHex)`
4. Keys are cleared on wallet lock/logout

This is a design decision that needs alignment with the user — the exact implementation depends on whether Strike expects the Cardano staking key, payment key, or a derived key. **Flag for discussion.**

- [ ] **Step 2: Commit placeholder**

```bash
git commit -m "docs(strike-v2): document key extraction flow for Ed25519 auth"
```

---

## Summary

After completing this plan:
- All v2 TypeScript types are defined
- Ed25519 signing utility builds auth headers
- Authenticated Axios client auto-signs requests
- Trade, User, Market, and Vault API modules are ready
- Backend proxy forwards v2 requests with auth headers
- Key extraction flow is documented (needs alignment on which Cardano key to use)

**Dependencies for Plan 2-4:** This plan must complete first — all other plans import from these modules.
