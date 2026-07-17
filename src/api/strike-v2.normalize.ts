// Strike Finance v2 API — wire-shape normalization.
//
// The live API's list endpoints do not match the published docs (which are
// also internally inconsistent between the trade-API and user-API pages).
// Verified live 2026-07-05: GET /v2/positions returns snake_case (`id`,
// `size`, `entry_price`, `iso_balance`) with NO side field — direction is the
// sign of `size` — while the docs still show PascalCase `PositionID/Side/
// Size/EntryPrice`. The same drift risk applies to open orders and the
// history endpoints, so every list entry is normalized here, accepting every
// documented alias, before it reaches the UI.

import type {
  ClosedPosition,
  FillHistoryResult,
  FundingHistoryResult,
  MarginMode,
  Order,
  OrderHistoryResult,
  OrderSide,
  OrderStatus,
  OrderType,
  Position,
  PositionSide,
  PositionWire,
  TimeInForce,
  WorkingType,
} from './strike-v2.types';

type Wire = Record<string, unknown>;

/** First present key as string (skips null/undefined; '' counts as present). */
function str(w: Wire, keys: string[], dflt = ''): string {
  for (const k of keys) {
    const v = w[k];
    if (v !== undefined && v !== null) return String(v);
  }
  return dflt;
}

/** First present key as finite number (ms timestamps, counters). */
function num(w: Wire, keys: string[], dflt = 0): number {
  for (const k of keys) {
    const v = w[k];
    if (v === undefined || v === null) continue;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    if (Number.isFinite(n)) return n;
  }
  return dflt;
}

/** First present key as boolean. */
function bool(w: Wire, keys: string[], dflt = false): boolean {
  for (const k of keys) {
    const v = w[k];
    if (v !== undefined && v !== null) return v === true || v === 'true';
  }
  return dflt;
}

/**
 * Normalize a /v2/positions entry. Live wire has no side field: the sign of
 * `size` encodes it (negative = short). Size is returned positive with the
 * sign folded into Side — what the tables and close-order builders expect.
 */
export function normalizePosition(p: PositionWire): Position {
  const rawSize = String(p.Size ?? p.size ?? '0').trim();
  const isNegative = rawSize.startsWith('-');
  return {
    symbol: p.symbol,
    PositionID: String(p.PositionID ?? p.id ?? ''),
    Side: p.Side ?? (isNegative ? 'short' : 'long'),
    Size: isNegative ? rawSize.slice(1) : rawSize,
    EntryPrice: String(p.EntryPrice ?? p.entry_price ?? '0'),
    MarginMode: p.MarginMode ?? p.margin_mode ?? 'cross',
    Leverage: Number(p.Leverage ?? p.leverage ?? 1) || 1,
    IsolatedMargin: String(p.IsolatedMargin ?? p.iso_balance ?? '0'),
    upnl: String(p.upnl ?? '0'),
    maintenance_margin: String(p.maintenance_margin ?? '0'),
    bankruptcy_price: String(p.bankruptcy_price ?? '0'),
    liquidation_price: String(p.liquidation_price ?? '0'),
    accumulated_funding_fees: p.accumulated_funding_fees,
    create_timestamp: p.create_timestamp,
    update_timestamp: p.update_timestamp,
  };
}

/** Normalize a /v2/openOrders (or single-order) entry to the canonical Order. */
export function normalizeOrder(w: Wire): Order {
  return {
    ID: str(w, ['ID', 'id', 'order_id']),
    ClientOrderID: str(w, ['ClientOrderID', 'client_order_id']),
    AccountID: str(w, ['AccountID', 'account_id']),
    Symbol: str(w, ['Symbol', 'symbol']),
    Side: str(w, ['Side', 'side']).toLowerCase() as OrderSide,
    Status: str(w, ['Status', 'status']).toLowerCase() as OrderStatus,
    Type: str(w, ['Type', 'type']).toLowerCase() as OrderType,
    Size: str(w, ['Size', 'size'], '0'),
    Filled: str(w, ['Filled', 'filled', 'executed_qty'], '0'),
    Price: str(w, ['Price', 'price'], '0'),
    StopPrice: str(w, ['StopPrice', 'stop_price'], '0'),
    TimeInForce: str(w, ['TimeInForce', 'time_in_force']) as TimeInForce,
    WorkingType: str(w, ['WorkingType', 'working_type']) as WorkingType,
    PostOnly: bool(w, ['PostOnly', 'post_only']),
    ReduceOnly: bool(w, ['ReduceOnly', 'reduce_only']),
    ClosePosition: bool(w, ['ClosePosition', 'close_position']),
    PriceProtect: bool(w, ['PriceProtect', 'price_protect']),
    StrategyID: str(w, ['StrategyID', 'Strategy', 'strategy_id']),
    CreatedAt: num(w, ['CreatedAt', 'CreateTimestamp', 'create_timestamp', 'created_at']),
    UpdatedAt: num(w, ['UpdatedAt', 'EventTimestamp', 'update_timestamp', 'updated_at', 'event_timestamp']),
  };
}

/** Normalize a /v2/history/order entry (docs disagree: PascalCase vs snake). */
export function normalizeOrderHistory(w: Wire): OrderHistoryResult {
  return {
    order_id: str(w, ['order_id', 'ID', 'id']),
    client_order_id: str(w, ['client_order_id', 'ClientOrderID']),
    symbol: str(w, ['symbol', 'Symbol']),
    side: str(w, ['side', 'Side']).toLowerCase() as OrderSide,
    type: str(w, ['type', 'Type']).toLowerCase() as OrderType,
    status: str(w, ['status', 'Status']).toLowerCase() as OrderStatus,
    price: str(w, ['price', 'Price'], '0'),
    size: str(w, ['size', 'Size'], '0'),
    filled: str(w, ['filled', 'Filled'], '0'),
    created_at: String(num(w, ['created_at', 'CreateTimestamp', 'create_timestamp'])),
    updated_at: String(num(w, ['updated_at', 'EventTimestamp', 'update_timestamp', 'event_timestamp'])),
  };
}

/**
 * Normalize a /v2/history/fill entry. Doc variants: `{id, qty, quote_qty,
 * commission, is_maker, time}` (user API) vs `{trade_id, size, fee,
 * fee_type, timestamp}` (trade API).
 */
export function normalizeFill(w: Wire): FillHistoryResult {
  const feeType = str(w, ['fee_type']).toLowerCase();
  return {
    id: str(w, ['id', 'trade_id']),
    order_id: str(w, ['order_id', 'OrderID']),
    symbol: str(w, ['symbol', 'Symbol']),
    side: str(w, ['side', 'Side']).toLowerCase() as OrderSide,
    price: str(w, ['price', 'Price'], '0'),
    qty: str(w, ['qty', 'size', 'Size'], '0'),
    quote_qty: str(w, ['quote_qty'], '0'),
    commission: str(w, ['commission', 'fee'], '0'),
    commission_asset: str(w, ['commission_asset', 'fee_asset'], 'USD'),
    realized_pnl: str(w, ['realized_pnl'], '0'),
    is_maker: bool(w, ['is_maker'], feeType === 'maker'),
    time: num(w, ['time', 'timestamp', 'Timestamp']),
    auto_close_type: str(w, ['auto_close_type']) || undefined,
  };
}

/** Normalize a /v2/history/funding entry. */
export function normalizeFunding(w: Wire): FundingHistoryResult {
  return {
    id: str(w, ['id']),
    symbol: str(w, ['symbol', 'Symbol']),
    income: str(w, ['income', 'funding_fee', 'amount'], '0'),
    asset: str(w, ['asset'], 'USD'),
    time: num(w, ['time', 'timestamp']),
  };
}

/**
 * Normalize a /v2/closedPositions entry. Like open positions, tolerate a
 * missing side field by deriving it from the sign of size.
 */
export function normalizeClosedPosition(w: Wire): ClosedPosition {
  const rawSize = str(w, ['size', 'Size'], '0').trim();
  const isNegative = rawSize.startsWith('-');
  const side = str(w, ['side', 'Side']).toLowerCase();
  return {
    symbol: str(w, ['symbol', 'Symbol']),
    position_id: str(w, ['position_id', 'PositionID', 'id']),
    side: (side || (isNegative ? 'short' : 'long')) as PositionSide,
    size: isNegative ? rawSize.slice(1) : rawSize,
    entry_price: str(w, ['entry_price', 'EntryPrice'], '0'),
    exit_price: str(w, ['exit_price', 'ExitPrice', 'close_price'], '0'),
    realized_pnl: str(w, ['realized_pnl', 'RealizedPnl'], '0'),
    margin_mode: (str(w, ['margin_mode', 'MarginMode'], 'cross')) as MarginMode,
    leverage: num(w, ['leverage', 'Leverage'], 1),
    opened_at: String(num(w, ['opened_at', 'open_timestamp', 'create_timestamp', 'CreateTimestamp'])),
    closed_at: String(num(w, ['closed_at', 'close_timestamp', 'update_timestamp', 'EventTimestamp'])),
  };
}
