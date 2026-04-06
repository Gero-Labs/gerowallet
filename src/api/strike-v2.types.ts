// Strike Finance v2 API — TypeScript types
// API is account-based, Ed25519-authenticated, Binance-like interface

// ---------------------------------------------------------------------------
// Enums / Union types
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell';

export type OrderType =
  | 'limit'
  | 'market'
  | 'stop'
  | 'stop_limit'
  | 'take_profit'
  | 'take_profit_limit';

export type OrderStatus =
  | 'pending'
  | 'open'
  | 'filled'
  | 'canceled'
  | 'untriggered'
  | 'rejected'
  | 'expired'
  | 'none';

export type TimeInForce = 'GTC' | 'IOC' | 'FOK';

export type WorkingType = 'mark_price' | 'contract_price';

export type PositionSide = 'long' | 'short' | 'none';

export type MarginMode = 'cross' | 'isolated';

export type ModifyType = 'add' | 'remove';

export type TransactionType =
  | 'deposit'
  | 'withdraw'
  | 'fee'
  | 'realized_pnl'
  | 'liquidation';

export type TransactionStatus =
  | 'pending'
  | 'completed'
  | 'pending_settlement'
  | 'settled'
  | 'failed'
  | 'cancelled';

export type VaultStatus = 'active' | 'paused' | 'closed';

export type VaultPeriod = '24h' | '7d' | '30d' | '6m' | '1y' | 'all';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface StrikeAuthHeaders {
  /** Ed25519 public key (64 hex characters) */
  'X-API-Wallet-Public-Key': string;
  /** Ed25519 signature of the canonical message (128 hex characters) */
  'X-API-Wallet-Signature': string;
  /** Unix timestamp in seconds */
  'X-API-Wallet-Timestamp': string;
  /** Unique UUID v4 per request */
  'X-API-Wallet-Nonce': string;
}

// ---------------------------------------------------------------------------
// Trade API — Orders
// ---------------------------------------------------------------------------

export interface CreateOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  /** Quantity expressed as a string-encoded decimal */
  size: string;
  client_order_id?: string;
  /** Limit price — string-encoded decimal */
  price?: string;
  /** Stop/trigger price — string-encoded decimal */
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
  sequence_id: string;
  message_id: string;
}

export interface CancelOrderRequest {
  order_id: string;
  symbol: string;
  vault_id?: string;
}

export interface CancelOrderResponse {
  order_id: string;
  client_order_id: string;
  symbol: string;
  status: OrderStatus;
}

export interface CancelAllOrdersRequest {
  symbol: string;
  vault_id?: string;
}

export interface CancelAllOrdersResponse {
  symbol: string;
  count: number;
}

export interface StrategyOrderDetails {
  type: OrderType;
  /** Quantity — string-encoded decimal */
  size: string;
  /** Trigger price — string-encoded decimal */
  stop_price: string;
  client_order_id?: string;
  /** Limit price — string-encoded decimal */
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

export interface CreateStrategyOrderResponse extends CreateOrderResponse {
  strategy_id: string;
}

// ---------------------------------------------------------------------------
// Trade API — Leverage / Margin
// ---------------------------------------------------------------------------

export interface LeverageRequest {
  symbol: string;
  /** 1–125 */
  leverage: number;
  vault_id?: string;
}

export interface LeverageResponse {
  leverage: number;
  /** String-encoded decimal */
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
  /** String-encoded decimal */
  amount: string;
  modify_type: ModifyType;
  vault_id?: string;
}

// ---------------------------------------------------------------------------
// Trade API — Order object & list
// ---------------------------------------------------------------------------

/** Order record returned by the API (PascalCase field names per v2 schema) */
export interface Order {
  ID: string;
  ClientOrderID: string;
  AccountID: string;
  Symbol: string;
  Side: OrderSide;
  Status: OrderStatus;
  Type: OrderType;
  /** String-encoded decimal */
  Size: string;
  /** String-encoded decimal */
  Filled: string;
  /** String-encoded decimal */
  Price: string;
  /** String-encoded decimal */
  StopPrice: string;
  TimeInForce: TimeInForce;
  WorkingType: WorkingType;
  PostOnly: boolean;
  ReduceOnly: boolean;
  ClosePosition: boolean;
  PriceProtect: boolean;
  StrategyID: string;
  /** Unix timestamp in milliseconds */
  CreatedAt: number;
  /** Unix timestamp in milliseconds */
  UpdatedAt: number;
}

export interface OpenOrdersResponse {
  orders: Order[];
  count: number;
}

// ---------------------------------------------------------------------------
// User API — Account & Balance
// ---------------------------------------------------------------------------

export interface SymbolSettings {
  symbol: string;
  leverage: number;
  margin_mode: MarginMode;
}

export interface AccountResponse {
  account_id: string;
  blockchain: string;
  blockchain_address: string;
  /** String-encoded decimal */
  wallet_balance: string;
  /** String-encoded decimal */
  available_balance: string;
  /** String-encoded decimal */
  unrealized_pnl: string;
  /** String-encoded decimal */
  margin_balance: string;
  /** String-encoded decimal */
  total_margin: string;
  /** String-encoded decimal */
  position_initial_margin: string;
  /** String-encoded decimal */
  maintenance_margin: string;
  symbol_settings: SymbolSettings[];
}

export interface BalanceResponse {
  asset: string;
  /** String-encoded decimal */
  walletBalance: string;
  /** String-encoded decimal */
  unrealizedPnl: string;
  /** String-encoded decimal */
  marginBalance: string;
  /** String-encoded decimal */
  maintMargin: string;
  /** String-encoded decimal */
  initialMargin: string;
  /** String-encoded decimal */
  positionInitialMargin: string;
  /** String-encoded decimal */
  openOrderInitialMargin: string;
  /** String-encoded decimal */
  crossWalletBalance: string;
  /** String-encoded decimal */
  crossUnPnl: string;
  /** String-encoded decimal */
  availableBalance: string;
  /** String-encoded decimal */
  maxWithdrawAmount: string;
  marginAvailable: boolean;
  /** Unix timestamp in milliseconds */
  updateTime: number;
}

// ---------------------------------------------------------------------------
// User API — Positions
// ---------------------------------------------------------------------------

export interface Position {
  symbol: string;
  PositionID: string;
  Side: PositionSide;
  /** String-encoded decimal */
  Size: string;
  /** String-encoded decimal */
  EntryPrice: string;
  MarginMode: MarginMode;
  Leverage: number;
  /** String-encoded decimal */
  IsolatedMargin: string;
  /** Unrealized PnL — string-encoded decimal */
  upnl: string;
  /** String-encoded decimal */
  maintenance_margin: string;
  /** String-encoded decimal */
  bankruptcy_price: string;
  /** String-encoded decimal */
  liquidation_price: string;
}

export interface PositionsResponse {
  positions: Position[];
  count: number;
}

export interface ClosedPosition {
  symbol: string;
  position_id: string;
  side: PositionSide;
  /** String-encoded decimal */
  size: string;
  /** String-encoded decimal */
  entry_price: string;
  /** String-encoded decimal */
  exit_price: string;
  /** String-encoded decimal */
  realized_pnl: string;
  margin_mode: MarginMode;
  leverage: number;
  /** ISO 8601 or Unix timestamp string */
  opened_at: string;
  /** ISO 8601 or Unix timestamp string */
  closed_at: string;
}

export interface ClosedPositionsResponse {
  positions: ClosedPosition[];
  count: number;
}

// ---------------------------------------------------------------------------
// User API — Portfolio Summary
// ---------------------------------------------------------------------------

export interface FeeTier {
  /** String-encoded decimal */
  volume: string;
  /** String-encoded decimal */
  maker_fee: string;
  /** String-encoded decimal */
  taker_fee: string;
}

export interface PortfolioSummaryResponse {
  account: {
    /** String-encoded decimal */
    accountValue: string;
    /** String-encoded decimal */
    positionValue: string;
    /** String-encoded decimal */
    availableBalance: string;
    /** String-encoded decimal */
    allTimePnl: string;
    /** String-encoded decimal */
    realizedPnl: string;
    /** String-encoded decimal */
    unrealizedPnl: string;
    /** String-encoded decimal */
    allTimeVolume: string;
    /** String-encoded decimal */
    currentPositionSize: string;
  };
  /** String-encoded decimal */
  volume: string;
  /** String-encoded decimal */
  fees: string;
  /**
   * Each entry: [timestamp_ms, accountValue, realizedPnl, unrealizedPnl]
   * All values are string-encoded decimals except the timestamp (number).
   */
  history: [number, string, string, string][];
  feeTier: FeeTier;
  feeTiers: FeeTier[];
  /** Array of [timestamp_ms, volume] tuples */
  volume_history: [number, string][];
  /** String-encoded decimal */
  feeDiscountRate: string;
  isTradingEnabled: boolean;
}

// ---------------------------------------------------------------------------
// User API — History results
// ---------------------------------------------------------------------------

export interface OrderHistoryResult {
  order_id: string;
  client_order_id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  /** String-encoded decimal */
  price: string;
  /** String-encoded decimal */
  size: string;
  /** String-encoded decimal */
  filled: string;
  /** ISO 8601 or Unix timestamp string */
  created_at: string;
  /** ISO 8601 or Unix timestamp string */
  updated_at: string;
}

export interface FillHistoryResult {
  id: string;
  order_id: string;
  symbol: string;
  side: OrderSide;
  /** String-encoded decimal */
  price: string;
  /** String-encoded decimal */
  qty: string;
  /** String-encoded decimal */
  quote_qty: string;
  /** String-encoded decimal */
  commission: string;
  commission_asset: string;
  /** String-encoded decimal */
  realized_pnl: string;
  is_maker: boolean;
  /** Unix timestamp in milliseconds */
  time: number;
  auto_close_type?: string;
}

export interface FundingHistoryResult {
  id: string;
  symbol: string;
  /** String-encoded decimal */
  income: string;
  asset: string;
  /** Unix timestamp in milliseconds */
  time: number;
}

export interface TransactionHistoryResult {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  /** String-encoded decimal */
  amount: string;
  asset: string;
  /** Unix timestamp in milliseconds */
  time: number;
}

// ---------------------------------------------------------------------------
// Market API
// ---------------------------------------------------------------------------

export interface RateLimit {
  rateLimitType: string;
  interval: string;
  intervalNum: number;
  limit: number;
}

export interface SymbolFilter {
  filterType: string;
  /** String-encoded decimal */
  maxPrice?: string;
  /** String-encoded decimal */
  minPrice?: string;
  /** String-encoded decimal */
  tickSize?: string;
  /** String-encoded decimal */
  maxQty?: string;
  /** String-encoded decimal */
  minQty?: string;
  /** String-encoded decimal */
  stepSize?: string;
  /** String-encoded decimal */
  notional?: string;
  limit?: number;
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
  orderType: OrderType[];
  timeInForce: TimeInForce[];
}

export interface ExchangeInfo {
  timezone: string;
  /** Unix timestamp in milliseconds */
  serverTime: number;
  rateLimits: RateLimit[];
  symbols: SymbolInfo[];
}

export interface OrderBookResponse {
  lastUpdateId: number;
  /** Exchange event timestamp */
  E: number;
  /** Transaction timestamp */
  T: number;
  /** [price, quantity] pairs — string-encoded decimals */
  bids: [string, string][];
  /** [price, quantity] pairs — string-encoded decimals */
  asks: [string, string][];
}

export interface TradeResponse {
  id: number;
  /** String-encoded decimal */
  price: string;
  /** String-encoded decimal */
  qty: string;
  /** String-encoded decimal */
  quoteQty: string;
  /** Unix timestamp in milliseconds */
  time: number;
  isBuyerMaker: boolean;
}

export interface PremiumIndexResponse {
  symbol: string;
  /** String-encoded decimal */
  markPrice: string;
  /** String-encoded decimal */
  indexPrice: string;
  /** String-encoded decimal */
  estimatedSettlePrice: string;
  /** String-encoded decimal */
  lastFundingRate: string;
  /** Unix timestamp in milliseconds */
  nextFundingTime: number;
  /** String-encoded decimal */
  interestRate: string;
  /** Unix timestamp in milliseconds */
  time: number;
}

export interface Ticker24hrResponse {
  symbol: string;
  /** String-encoded decimal */
  priceChange: string;
  /** String-encoded decimal */
  priceChangePercent: string;
  /** String-encoded decimal */
  weightedAvgPrice: string;
  /** String-encoded decimal */
  lastPrice: string;
  /** String-encoded decimal */
  lastQty: string;
  /** String-encoded decimal */
  openPrice: string;
  /** String-encoded decimal */
  highPrice: string;
  /** String-encoded decimal */
  lowPrice: string;
  /** String-encoded decimal */
  volume: string;
  /** String-encoded decimal */
  quoteVolume: string;
  /** Unix timestamp in milliseconds */
  openTime: number;
  /** Unix timestamp in milliseconds */
  closeTime: number;
  firstId: number;
  lastId: number;
  count: number;
}

export interface TickerPriceResponse {
  symbol: string;
  /** String-encoded decimal */
  price: string;
  /** Unix timestamp in milliseconds */
  time: number;
}

export interface BookTickerResponse {
  symbol: string;
  /** String-encoded decimal */
  bidPrice: string;
  /** String-encoded decimal */
  bidQty: string;
  /** String-encoded decimal */
  askPrice: string;
  /** String-encoded decimal */
  askQty: string;
  /** Unix timestamp in milliseconds */
  time: number;
}

export interface OpenInterestResponse {
  symbol: string;
  /** String-encoded decimal */
  openInterest: string;
  /** Unix timestamp in milliseconds */
  time: number;
}

// ---------------------------------------------------------------------------
// Market Configuration
// ---------------------------------------------------------------------------

export interface MarginTier {
  max_notional: string;
  max_leverage: number;
  maintenance_margin_rate: string;
  maintenance_amount: string;
}

export interface StrikeMarketConfig {
  symbol: string;
  name: string;
  base_asset: string;
  status: string;
  base_prec: number;
  quote_prec: number;
  default_leverage: number;
  order_tick_price: string;
  order_min_price: string;
  order_max_price: string;
  order_limit_step_size: string;
  order_limit_min_size: string;
  order_limit_max_size: string;
  order_market_step_size: string;
  order_market_min_size: string;
  order_market_max_size: string;
  order_min_notional: string;
  margin_tiers: MarginTier[];
  liquidation_fee_rate: string;
  mark_price?: string;
  index_price?: string;
  last_price?: string;
  funding_rate?: string;
  next_funding_time?: number;
}

// ---------------------------------------------------------------------------
// Deposit & Withdrawal
// ---------------------------------------------------------------------------

export interface DepositQuoteRequest {
  blockchain: string;
  asset_symbol: string;
  asset_amount: string;
}

export interface DepositQuoteResponse {
  request_id: string;
  quote: {
    asset_symbol: string;
    asset_amount: string;
    usd_value: string;
    exchange_rate: string;
    expiration_at: number;
  };
  deposit_address: string;
  confirmations_required: number;
}

export interface WithdrawQuoteRequest {
  usd_value: string;
  blockchain: string;
  recipient_address: string;
  asset: string;
}

export interface WithdrawQuoteResponse {
  withdraw_id: string;
  message_to_sign: string;
}

export interface TransactionStatusResponse {
  status: 'pending' | 'completed' | 'failed';
}

export interface StrikeMarketsResponse {
  markets: Record<string, StrikeMarketConfig>;
}

export interface StrikeKline {
  /** Open time (Unix ms) */
  openTime: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  /** Close time (Unix ms) */
  closeTime: number;
}

// ---------------------------------------------------------------------------
// Vault API
// ---------------------------------------------------------------------------

export interface VaultInfo {
  id: string;
  name: string;
  description: string;
  leader_account_id: string;
  type: string;
  status: VaultStatus;
  is_verified: boolean;
  /** String-encoded decimal */
  tvl: string;
  /** String-encoded decimal */
  apr: string;
  /** String-encoded decimal */
  pnl: string;
  /** String-encoded decimal */
  sharpe_ratio: string;
  /** String-encoded decimal */
  max_drawdown: string;
  depositor_count: number;
  /** ISO 8601 or Unix timestamp string */
  created_at: string;
}

export interface VaultListResponse {
  vaults: VaultInfo[];
  count: number;
  limit: number;
  offset: number;
}

export interface VaultPortfolioHistoryEntry {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** String-encoded decimal */
  tvl: string;
  /** String-encoded decimal */
  pnl: string;
}

export interface VaultPortfolioResponse {
  /** String-encoded decimal */
  tvl: string;
  /** String-encoded decimal */
  apr: string;
  /** String-encoded decimal */
  pnl: string;
  /** String-encoded decimal */
  sharpe_ratio: string;
  /** String-encoded decimal */
  max_drawdown: string;
  history: VaultPortfolioHistoryEntry[];
}

export interface VaultDepositor {
  account_id: string;
  /** String-encoded decimal */
  equity: string;
  /** String-encoded decimal — percentage 0–100 */
  share_percentage: string;
  /** String-encoded decimal */
  pnl: string;
}

export interface UserVaultPosition {
  vault_id: string;
  /** String-encoded decimal */
  shares: string;
  /** String-encoded decimal */
  deposited: string;
  /** String-encoded decimal */
  withdrawn: string;
  /** String-encoded decimal */
  entry_price: string;
  /** String-encoded decimal */
  current_value: string;
  /** String-encoded decimal */
  pnl: string;
}
