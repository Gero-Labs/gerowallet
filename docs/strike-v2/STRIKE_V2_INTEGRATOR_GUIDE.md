# Strike Finance v2 — Integrator Guide

Complete reference for building a trading frontend against the Strike Finance API. Covers every endpoint, WebSocket message, formula, and data structure needed to render a fully functional perpetuals trading interface.

All formulas include worked numerical examples so you can verify your implementation.

---

## Table of Contents

1. [API Base URLs](#1-api-base-urls)
2. [WebSocket Streams](#2-websocket-streams)
3. [Market Configuration](#3-market-configuration)
4. [Order Book](#4-order-book)
5. [Account & Balances](#5-account--balances)
6. [Positions Table (All Math)](#6-positions-table-all-math)
7. [PnL Calculations](#7-pnl-calculations)
8. [Liquidation Price](#8-liquidation-price)
9. [Margin Tiers](#9-margin-tiers)
10. [Order Placement](#10-order-placement)
11. [Estimated Entry, Slippage & Fees](#11-estimated-entry-slippage--fees)
12. [Margin & Order Value](#12-margin--order-value)
13. [Leverage & Margin Mode](#13-leverage--margin-mode)
14. [Funding Rate](#14-funding-rate)
15. [Fee Tiers](#15-fee-tiers)
16. [Deposit & Withdrawal](#16-deposit--withdrawal)
17. [History Endpoints](#17-history-endpoints)
18. [Vault Endpoints](#18-vault-endpoints)
19. [Referral Endpoints](#19-referral-endpoints)

---

## Reference Position (Used in All Examples)

Throughout this doc we use a consistent example so you can cross-check every formula:

```
Position:
  symbol          = "BTC-USD"
  side            = LONG
  size            = 0.5 BTC
  entryPrice      = $43,000
  markPrice       = $43,500   (live from WebSocket)
  leverage        = 20x
  marginMode      = isolated
  isoBalance      = $1,075    (margin locked)

Market (BTC-USD) margin tiers:
  Tier 1: max_notional=$50,000,  max_leverage=50, mmr=0.004, ma=$0
  Tier 2: max_notional=$250,000, max_leverage=25, mmr=0.005, ma=$50
  Tier 3: max_notional=$1,000,000, max_leverage=20, mmr=0.01, ma=$1,300

Account:
  walletBalance       = $10,500
  availableBalance    = $8,200
  accumulatedFunding  = -$12.50 (paid $12.50 in funding)

Fee tier:
  takerRate = 0.0005  (0.05%)
  makerRate = 0.0002  (0.02%)
  feeDiscountRate = 10%
```

---

## 1. API Base URLs

| Service | Default URL | Env Variable |
|---------|-------------|--------------|
| **Main API** (trading, account) | `https://api.strikefinance.org` | `NEXT_PUBLIC_API_URL` |
| **Price API** (market data REST) | Same as main, or dedicated price host | `NEXT_PUBLIC_PRICE_URL` |
| **Stats API** (analytics, leaderboard) | `https://api.strikefinance.org/stat` | `NEXT_PUBLIC_STATS_URL` |
| **Price WebSocket** | `wss://v2.strikefinance.org/ws/stream` | `NEXT_PUBLIC_PRICE_WS_URL` |
| **User WebSocket** | `wss://v2.strikefinance.org/ws` | `NEXT_PUBLIC_USER_STREAM_WS_URL` |

All authenticated endpoints require:
```
Authorization: Bearer <JWT_TOKEN>
Content-Type: application/json
```

---

## 2. WebSocket Streams

### 2.1 Price Stream (`wss://v2.strikefinance.org/ws/stream`)

#### Subscribe/Unsubscribe

```json
{
  "id": 1712345678,
  "method": "subscribe",
  "channel": "markPrice",
  "symbol": "BTC-USD"
}
```

Available channels: `markPrice`, `trade`, `depth`, `kline_<interval>`, `kline_<interval>_mark`, `kline_<interval>_index`, `!miniTicker@arr`

Kline intervals: `1m`, `3m`, `5m`, `15m`, `30m`, `1h`, `2h`, `4h`, `6h`, `8h`, `12h`, `1d`, `3d`, `1w`, `1M`

#### markPriceUpdate

This is the most important event — it drives all real-time position calculations (PnL, liquidation, etc.).

```json
{
  "e": "markPriceUpdate",
  "E": 1700000000000,
  "s": "BTC-USD",
  "p": "43500.50",
  "i": "43498.30",
  "P": "43499.00",
  "r": "0.0001",
  "T": 1700028800000
}
```

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `e` | string | Event type | `"markPriceUpdate"` |
| `E` | number | Event time (ms) | `1700000000000` |
| `s` | string | Symbol | `"BTC-USD"` |
| `p` | string | **Mark price** (use this for PnL calculations) | `"43500.50"` |
| `i` | string | Index price | `"43498.30"` |
| `P` | string | Estimated settlement price | `"43499.00"` |
| `r` | string | Funding rate (decimal) | `"0.0001"` = 0.01% |
| `T` | number | Next funding time (ms) | `1700028800000` |

#### depthUpdate

```json
{
  "e": "depthUpdate",
  "s": "BTC-USD",
  "u": 12345678,
  "b": [["43249.00", "2.5"], ["43248.50", "1.2"]],
  "a": [["43251.00", "1.8"], ["43251.50", "3.0"]]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `e` | string | `"depthUpdate"` |
| `s` | string | Symbol |
| `u` | number/string | Update ID (for sequencing/dedup) |
| `b` | string[][] | Bids `[[price, qty], ...]` — highest first |
| `a` | string[][] | Asks `[[price, qty], ...]` — lowest first |

Notes:
- Quantity `"0"` means remove that level
- Backend sends full-book snapshots — clear and rebuild your local state on each event

#### trade

```json
{
  "e": "trade",
  "s": "BTC-USD",
  "p": "43250.00",
  "q": "0.5",
  "T": 1700000000000,
  "t": 98765,
  "m": true
}
```

| Field | Type | Description |
|-------|------|-------------|
| `p` | string | Trade price |
| `q` | string | Trade quantity |
| `T` | number | Trade time (ms) |
| `t` | number | Trade ID |
| `m` | boolean | `true` = seller is taker (sell), `false` = buyer is taker (buy) |

#### kline

```json
{
  "e": "kline",
  "k": {
    "s": "BTC-USD",
    "i": "1h",
    "t": 1700000000000,
    "o": "43200.00",
    "h": "43350.00",
    "l": "43150.00",
    "c": "43250.00",
    "v": "125.5"
  }
}
```

#### 24hrMiniTicker

```json
{
  "e": "24hrMiniTicker",
  "E": 1700000000000,
  "s": "BTC-USD",
  "c": "43250.00",
  "o": "43100.00",
  "h": "43500.00",
  "l": "42900.00",
  "v": "5432.1",
  "q": "234567890.00"
}
```

Can arrive as single object or array. Subscribe with channel `!miniTicker@arr`.

---

### 2.2 User Stream (`wss://v2.strikefinance.org/ws`)

#### Authenticate

```json
{ "method": "AUTH", "params": { "token": "eyJhbG..." } }
```

Response:
```json
{ "id": null, "result": { "account_id": "a1b2c3d4-...", "authenticated": true }, "status": 200 }
```

#### Subscribe

```json
{ "method": "subscribe", "channel": "userstream", "account_id": "a1b2c3d4-...", "id": "1" }
```

For vault mode:
```json
{ "method": "subscribe", "channel": "userstream", "vault_id": "vault-uuid-...", "id": "1" }
```

#### ACCOUNT_UPDATE

Fired on balance changes, position changes, deposits, withdrawals, funding, liquidations, ADL.

```json
{
  "e": "ACCOUNT_UPDATE",
  "E": 1700000000000,
  "T": 1700000000000,
  "r": "ORDER",
  "B": [
    { "a": "USDT", "wb": "10500.00", "cw": "10500.00", "bc": "-1075.00" }
  ],
  "P": [
    { "s": "BTC-USD", "pa": "0.5", "ep": "43000.00", "mt": "isolated", "ib": "1075.00", "ps": "LONG", "i": "pos-uuid-123" }
  ]
}
```

| Field | Description |
|-------|-------------|
| `r` | Reason: `DEPOSIT`, `WITHDRAW`, `FUNDING`, `LIQUIDATION`, `ADL`, `ORDER` |
| `B[].a` | Asset name |
| `B[].wb` | Wallet balance (after change) |
| `B[].cw` | Cross wallet balance |
| `B[].bc` | Balance change amount |
| `P[].s` | Symbol |
| `P[].pa` | Position amount (absolute size) |
| `P[].ep` | Entry price |
| `P[].mt` | Margin type: `"cross"` or `"isolated"` |
| `P[].ib` | Isolated balance |
| `P[].ps` | Position side: `"LONG"` or `"SHORT"` |
| `P[].i` | Position ID (optional) |

#### ORDER_TRADE_UPDATE

Fired on every order state change and fill.

```json
{
  "e": "ORDER_TRADE_UPDATE",
  "i": 12345,
  "c": "strat-uuid-primary",
  "s": "BTC-USD",
  "S": "BUY",
  "o": "LIMIT",
  "ot": "LIMIT",
  "f": "GTC",
  "q": "0.5",
  "p": "43000.00",
  "sp": "0",
  "X": "FILLED",
  "x": "TRADE",
  "z": "0.5",
  "l": "0.5",
  "L": "43000.00",
  "n": "10.75",
  "N": "USDT",
  "T": 1700000001000,
  "E": 1700000001000,
  "t": 9876,
  "m": false,
  "R": false,
  "cp": false,
  "wt": "MARK_PRICE",
  "rp": "0",
  "cr": "",
  "act": "",
  "C": "21500.00"
}
```

| Field | Description |
|-------|-------------|
| `i` | Order ID |
| `c` | Client order ID |
| `S` | Side: `"BUY"` or `"SELL"` |
| `o` | Order type: `"MARKET"`, `"LIMIT"`, `"STOP"`, `"STOP_LIMIT"`, `"TAKE_PROFIT"`, `"TAKE_PROFIT_LIMIT"` |
| `ot` | Original order type (before trigger) |
| `X` | **Status**: `"NEW"`, `"PENDING_NEW"`, `"PARTIALLY_FILLED"`, `"OPEN"`, `"FILLED"`, `"CANCELED"`, `"REJECTED"`, `"EXPIRED"` |
| `q` | Original quantity |
| `p` | Limit price (`"0"` for market) |
| `sp` | Stop/trigger price |
| `z` | Cumulative filled quantity |
| `l` | Last filled quantity (this fill) |
| `L` | Last filled price (this fill) |
| `n` | Commission/fee for this fill |
| `rp` | Realized profit from this fill |
| `m` | Is maker (true/false) |
| `R` | Reduce only |
| `wt` | Working type: `"MARK_PRICE"` or `"CONTRACT_PRICE"` |
| `act` | Auto close type: `""`, `"liquidation"`, `"ADL"` |

**Final statuses** (remove from open orders list): `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED`

---

## 3. Market Configuration

### GET /v2/markets

No authentication required. Fetch once on startup, cache in memory.

```
Response:
{
  "markets": {
    "BTC-USD": {
      "symbol": "BTC-USD",
      "name": "Bitcoin",
      "base_asset": "BTC",
      "status": "trading",
      "base_prec": 4,
      "quote_prec": 2,
      "default_leverage": 20,

      "order_tick_price": "0.01",
      "order_min_price": "0.01",
      "order_max_price": "1000000",
      "order_limit_price_bound": "0.05",
      "order_market_price_bound": "0.05",

      "order_limit_step_size": "0.0001",
      "order_limit_min_size": "0.001",
      "order_limit_max_size": "100",
      "order_market_step_size": "0.0001",
      "order_market_min_size": "0.001",
      "order_market_max_size": "100",
      "order_min_notional": "5",

      "margin_tiers": [
        { "max_notional": "50000",   "max_leverage": 50, "maintenance_margin_rate": "0.004", "maintenance_amount": "0" },
        { "max_notional": "250000",  "max_leverage": 25, "maintenance_margin_rate": "0.005", "maintenance_amount": "50" },
        { "max_notional": "1000000", "max_leverage": 20, "maintenance_margin_rate": "0.01",  "maintenance_amount": "1300" }
      ],

      "reduce_only": false,
      "liquidation_fee_rate": "0.0025",
      "trigger_protect": "0.05",

      "mark_price": "43500.50",
      "index_price": "43498.30",
      "last_price": "43500.00",
      "bid1_price": "43499.00",
      "bid1_size": "2.5",
      "ask1_price": "43501.00",
      "ask1_size": "1.8",
      "funding_rate": "0.0001",
      "next_funding_time": 1700028800000
    }
  }
}
```

Key fields for integrators:
- `base_prec`: how many decimals to show for sizes (e.g. `4` -> `"0.5000"`)
- `order_tick_price`: snap all prices to multiples of this
- `order_limit_step_size` / `order_market_step_size`: snap all sizes to multiples of this
- `order_min_notional`: minimum order value (`size * price`) in USD
- `margin_tiers`: used for liquidation price, max leverage, maintenance margin (see Section 9)

---

## 4. Order Book

### 4.1 REST Snapshot

```
GET /v2/depth?symbol=BTC-USD&limit=100

Response:
{
  "lastUpdateId": 12345678,
  "symbol": "BTC-USD",
  "bids": [["43249.00", "2.5"], ["43248.50", "1.2"], ["43248.00", "3.0"]],
  "asks": [["43251.00", "1.8"], ["43251.50", "3.0"], ["43252.00", "0.5"]]
}
```

### 4.2 WebSocket Updates

Subscribe to `depth` channel. Each `depthUpdate` is a full-book snapshot — clear and rebuild.

### 4.3 Rendering Logic

#### Grouping/Aggregation

Choose a grouping increment based on the current price:

| Price Range | Base Increment | Options |
|-------------|---------------|---------|
| >= 10,000 | 1 | 1, 5, 10, 50, 100 |
| >= 1,000 | 0.1 | 0.1, 0.5, 1, 5, 10 |
| >= 100 | 0.01 | 0.01, 0.05, 0.1, 0.5, 1 |
| >= 10 | 0.001 | 0.001, 0.005, 0.01, 0.05, 0.1 |
| >= 1 | 0.0001 | 0.0001, 0.0005, 0.001, 0.005, 0.01 |
| < 1 | 0.00001 | 0.00001, 0.00005, 0.0001, 0.0005, 0.001 |

**Example**: BTC at $43,250 -> base = 1 -> user can pick grouping of 1, 5, 10, 50, or 100.

With grouping = 10:
- **Bids**: `floor(43249 / 10) * 10 = 43240` -> all bids from $43,240-$43,249.99 aggregate here
- **Asks**: `ceil(43251 / 10) * 10 = 43260` -> all asks from $43,250.01-$43,260 aggregate here

Sum quantities at each grouped level, then compute **cumulative totals** from the best bid/ask outward.

#### Spread

Always from **raw (ungrouped)** data:

```
spread = lowestAsk - highestBid = 43251.00 - 43249.00 = $2.00
spreadPercent = (2.00 / 43251.00) * 100 = 0.0046%
```

**Display**: `"$2.00 (0.005%)"` or just `"2.00"`

#### Mid Price

```
midPrice = (43249.00 + 43251.00) / 2 = $43,250.00
```

#### Buy/Sell Percentage Bar

From displayed levels (e.g. top 10):
```
totalBidSize = 2.5 + 1.2 + 3.0 = 6.7
totalAskSize = 1.8 + 3.0 + 0.5 = 5.3
buyPercent = 6.7 / (6.7 + 5.3) * 100 = 55.8%
sellPercent = 44.2%
```

**Display**: A colored bar that's 55.8% green, 44.2% red.

### 4.4 Market Fill Price Estimation (VWAP)

Walk the order book to estimate what price you'd get for a market order.

**Example**: Long 1.0 BTC market order, asks are:
```
$43,251.00 x 1.8 BTC
$43,251.50 x 3.0 BTC
$43,252.00 x 0.5 BTC
```

Walk the asks:
```
Fill 1.0 BTC at $43,251.00 (available: 1.8, take 1.0)
Cost = 1.0 * 43,251.00 = $43,251.00

VWAP = $43,251.00 / 1.0 = $43,251.00
```

**Example**: Long 2.5 BTC:
```
Fill 1.8 BTC at $43,251.00   -> cost = 1.8 * 43,251 = $77,851.80
Fill 0.7 BTC at $43,251.50   -> cost = 0.7 * 43,251.50 = $30,276.05
Total cost = $108,127.85

VWAP = $108,127.85 / 2.5 = $43,251.14
```

**For position flips** (e.g. you're Long 0.3 BTC and want to Short 0.5 BTC):
- Closing portion = 0.3 BTC (skip this cost)
- Opening portion = 0.2 BTC (VWAP only this part)
- Use `skipSize = 0.3` in the VWAP calculation

**Pseudocode**:
```
function estimateMarketFillPrice(orderBook, side, size, skipSize = 0):
    levels = (side == "Long") ? orderBook.asks : orderBook.bids
    totalSize = size + skipSize
    remainingTotal = totalSize
    skipped = 0
    costAccumulator = 0

    for each [price, qty] in levels:
        fillQty = min(remainingTotal, qty)
        skipRemaining = skipSize - skipped

        if skipRemaining > 0:
            skippedQty = min(fillQty, skipRemaining)
            countedQty = fillQty - skippedQty
            skipped += skippedQty
            costAccumulator += countedQty * price
        else:
            costAccumulator += fillQty * price

        remainingTotal -= fillQty
        if remainingTotal <= 0: break

    if remainingTotal > 0: return null   // insufficient liquidity
    return costAccumulator / size         // VWAP
```

---

## 5. Account & Balances

### 5.1 Get Account

```
GET /v2/account?account_id=a1b2c3d4-...
Headers: Authorization: Bearer <JWT>

Response:
{
  "account_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "blockchain": "cardano",
  "blockchain_address": "addr1qx2fxv2...",
  "wallet_balance": "10500.00",
  "available_balance": "8200.00",
  "withdrawable_balance": "7500.00",
  "unrealized_pnl": "250.00",
  "margin_balance": "10750.00",
  "total_margin": "2300.00",
  "position_initial_margin": "2000.00",
  "maintenance_margin": "450.00",
  "symbol_settings": {
    "BTC-USD": { "margin_mode": "cross", "leverage": 20, "allow_pre_trade": false },
    "ETH-USD": { "margin_mode": "isolated", "leverage": 10, "allow_pre_trade": true }
  }
}
```

Also supports `?vault_id={id}` or `?blockchain={chain}&blockchain_address={addr}`.

### 5.2 Balance Formulas (with Examples)

Using: walletBalance = $10,500, one isolated position with isoBalance = $1,075, one cross position requiring $1,000 initial margin with $200 uPnL and $45 maintenance margin. Open order costs = $500. Locked rewards = $100.

```
marginBalance = walletBalance + totalUnrealizedPnL
             = $10,500 + $200 = $10,700

crossRequirement = max(crossInitialMargin - crossUPnL, crossMaintenanceMargin)
                = max($1,000 - $200, $45)
                = max($800, $45) = $800

availableBalance = max(0, walletBalance - openOrderCosts - isolatedMargin - crossRequirement)
                = max(0, $10,500 - $500 - $1,075 - $800)
                = $8,125

withdrawableBalance = max(0, baseBalance - crossRequirement - lockedRewards)
    where baseBalance = walletBalance - openOrderCosts - isolatedMargin
                     = $10,500 - $500 - $1,075 = $8,925
    withdrawableBalance = max(0, $8,925 - $800 - $100) = $8,025
```

**Display** (Account panel):
```
Account Value:      $10,700.00
Available Balance:  $8,125.00
Position Value:     $1,275.00  (margin + uPnL = $1,075 + $200)
```

### 5.3 Portfolio Summary

```
GET /v2/portfolio?account_id=a1b2c3d4-...
Headers: Authorization: Bearer <JWT>

Response:
{
  "volume": "125000.00",
  "fees": "62.50",
  "fee_tier": 1,
  "fee_discount_rate": 0.10,
  "is_trading_enabled": true,
  "capital_flows": {
    "all_time_deposits": "15000.00",
    "all_time_withdrawals": "3000.00"
  },
  "history": [
    [1700000000, "10500.00", "500.00", "250.00"]
  ],
  "fee_tiers": [
    { "Tier": 0, "MinVolume": 0,       "TakerRate": 0.0005, "MakerRate": 0.0002 },
    { "Tier": 1, "MinVolume": 100000,  "TakerRate": 0.0004, "MakerRate": 0.00015 }
  ]
}
```

`history` arrays: `[timestamp, accountValue, realizedPnl, unrealizedPnl]`

---

## 6. Positions Table (All Math)

This is the core of the trading UI. Every field is either from the API or **derived in real-time from the mark price**.

### 6.1 Fetch Positions

```
GET /v2/positions?account_id=a1b2c3d4-...
Headers: Authorization: Bearer <JWT>
```

Positions also arrive via the `ACCOUNT_UPDATE` WebSocket event.

### 6.2 Base Fields (from API/WS)

| Field | Example | Description |
|-------|---------|-------------|
| `symbol` | `"BTC-USD"` | Trading pair |
| `size` | `0.5` | Absolute position size (always positive) |
| `entryPrice` | `43000.00` | Average entry price |
| `positionSide` | `"LONG"` | `"LONG"` or `"SHORT"` |
| `marginMode` | `"isolated"` | `"cross"` or `"isolated"` |
| `isoBalance` | `1075.00` | Isolated margin (only for isolated) |
| `leverage` | `20` | Position leverage from API |
| `accumulatedFundingFees` | `-12.50` | Cumulative funding paid/received |

### 6.3 Derived Fields (recalculate on EVERY mark price update)

Using our reference position: Long 0.5 BTC at $43,000 entry, mark = $43,500, isolated with $1,075 balance.

---

#### Unrealized PnL

```
Formula:
  Long:  uPnL = (markPrice - entryPrice) * size
  Short: uPnL = -(markPrice - entryPrice) * size

Example (Long):
  uPnL = ($43,500 - $43,000) * 0.5 = $500 * 0.5 = $250.00
```

**Display**: `+$250.00` in green. Does NOT include funding fees.

---

#### Notional

```
Formula:
  notional = markPrice * abs(size)

Example:
  notional = $43,500 * 0.5 = $21,750.00
```

**Display**: shown below the size as `"$21,750.00"` or as "Position Value".

---

#### Current Margin (what's locked up)

```
Isolated: currentMargin = isoBalance = $1,075.00
Cross:    currentMargin = notional / leverage = $21,750 / 20 = $1,087.50
```

**Display**: `"$1,075.00"` with "Isolated" badge (or "Cross" badge for cross positions).

---

#### Required Margin (isolated only — min margin at set leverage)

```
Formula:
  requiredMargin = notional / leverage

Example:
  requiredMargin = $21,750 / 20 = $1,087.50
```

---

#### Maintenance Margin

Uses tier lookup from market config. First find the tier:
```
notional = $21,750 -> falls in Tier 1 (max_notional $50,000)
mmr = 0.004
maintAmount (MA) = $0

maintenanceMargin = (notional * mmr) - MA
                  = ($21,750 * 0.004) - $0
                  = $87.00
```

**Display**: usually not shown directly, but used for liquidation price and margin ratio calculations.

---

#### Leverage (actual)

```
Isolated: leverage = notional / isoBalance = $21,750 / $1,075 = 20.23x
Cross:    leverage = from API, or notional / currentMargin
```

**Display**: `"20x"` (rounded) — clickable to open leverage modal.

---

#### PnL Percentage (ROE)

```
Formula:
  pnlPercentage = (uPnL / currentMargin) * 100

Example:
  pnlPercentage = ($250.00 / $1,075.00) * 100 = 23.26%
```

**Display**: `"+23.26%"` in green next to the PnL.

---

#### Margin Ratio

Only when uPnL is negative. Shows how close you are to liquidation:

```
Formula (only when uPnL < 0):
  marginRatio = (abs(uPnL) / currentMargin) * 100

Example (if uPnL were -$800):
  marginRatio = ($800 / $1,075) * 100 = 74.42%
```

**Display**: `"74.42%"` — at 100% you're liquidated.

---

### 6.4 Enrichment Flow (How to Update Positions in Real-Time)

On every `markPriceUpdate` WebSocket event:

```
Step 1: For each position, calculate derived fields:
  - Get markPrice from the price stream for this symbol
  - Calculate uPnL, notional, currentMargin, requiredMargin,
    maintenanceMargin, leverage, pnlPercentage, marginRatio
  - For ISOLATED positions: calculate liquidationPrice (Section 8.1)

Step 2: Aggregate across ALL positions:
  - totalIsolatedMargin = sum of isoBalance for all isolated positions
  - totalCrossUPnL = sum of uPnL for all cross positions
  - totalCrossMaintenanceMargin = sum of maintenanceMargin for all cross positions

Step 3: For each CROSS position, calculate liquidation price:
  - Exclude THIS position from the totals:
      otherCrossUPnL = totalCrossUPnL - thisPosition.uPnL
      otherCrossMM = totalCrossMaintenanceMargin - thisPosition.maintenanceMargin
  - Calculate cross liquidation (Section 8.2)
```

### 6.5 What Each Column Shows

| Column | Value | Format Example | Color |
|--------|-------|---------------|-------|
| Symbol | `"BTC-USD"` + `"LONG"` badge | `BTC-USD Long 20x` | Badge: cyan=Long, red=Short |
| Size | `0.5` BTC + notional below | `0.5000 BTC` / `$21,750.00` | White/default |
| Entry Price | `$43,000.00` | Dynamic decimals | White/default |
| Mark Price | `$43,500.00` (live) | Dynamic decimals | White/default |
| Liq. Price | `$42,119.28` or `"--"` | Dynamic decimals | Yellow/warning |
| Margin | `$1,075.00` + mode badge | `$1,075.00 Isolated` | White + badge |
| PnL (ROE%) | `+$250.00 (+23.26%)` | Signed currency + % | Green >= 0, Red < 0 |
| Funding | `-$12.50` | Signed currency | Green > 0, Red < 0, Gray = 0 |
| TP/SL | TP/SL prices or "View" | `45,000 / 41,000` | White/default |
| Actions | Close button | Button | |

### 6.6 TP/SL Display

Strategy orders are linked via `strategy_id` or client order ID pattern:
```
"strat-{strategyId}-primary"  ->  the main order
"strat-{strategyId}-tp"       ->  take profit
"strat-{strategyId}-sl"       ->  stop loss
```

Filter open orders by matching strategy ID. Extract `stop_price` from TP/SL orders.

If there are multiple TP or SL orders (partial sizes), show a "View" button instead of prices.

### 6.7 Modify Margin (Isolated Only)

```
Max removable:
  threshold = max(requiredMargin - uPnL, maintenanceMargin)
            = max($1,087.50 - $250.00, $87.00)
            = max($837.50, $87.00) = $837.50
  maxRemovable = max(0, currentMargin - threshold)
              = max(0, $1,075.00 - $837.50)
              = $237.50
```

**Display**: "Max removable: $237.50". After removing $237.50, the new liquidation price would shift closer to the current price.

### 6.8 Position Merging (WS Updates)

When `ACCOUNT_UPDATE` arrives:
- Key positions by `symbol-positionSide` (e.g. `"BTC-USD-LONG"`)
- Delete positions where `size < 0.000000000001` (closed)
- **Preserve** `accumulatedFundingFees` and `id` from existing position (WS doesn't send these)
- Handle position flips (LONG -> SHORT): remove the old side entry

---

## 7. PnL Calculations

### 7.1 Unrealized PnL (per position)

```
Long:  uPnL = (markPrice - entryPrice) * size
Short: uPnL = -(markPrice - entryPrice) * size
```

**Example (Long)**: (43500 - 43000) * 0.5 = **+$250.00**
**Example (Short, same numbers)**: -(43500 - 43000) * 0.5 = **-$250.00**

Always uses **mark price** (the `p` field from `markPriceUpdate`), not last trade price.

### 7.2 PnL Percentage / ROE

```
pnlPercentage = (uPnL / currentMargin) * 100
             = ($250 / $1,075) * 100 = +23.26%
```

### 7.3 Realized PnL (from trades)

From trade history response:
```
grossPnl = realized_pnl  (e.g. $500.00)
fee = fee                 (e.g. $10.75)
netPnl = $500.00 - $10.75 = $489.25
```

### 7.4 All-Time PnL

```
externalNetFlow = allTimeDeposits - allTimeWithdrawals = $15,000 - $3,000 = $12,000
perpRealizedPnl = walletBalance - externalNetFlow = $10,500 - $12,000 = -$1,500
allTimePnl = perpRealizedPnl + totalUnrealizedPnL = -$1,500 + $250 = -$1,250
```

### 7.5 TP/SL PnL Conversions

Convert between ROI%, USD, and trigger price:

```
// ROI% -> Price
targetPnl = (roiPercent * margin) / 100
Long TP price  = entryPrice + targetPnl / size
Short TP price = entryPrice - targetPnl / size

Example: 50% ROI TP on our Long position:
  targetPnl = (50 * $1,075) / 100 = $537.50
  tpPrice = $43,000 + $537.50 / 0.5 = $43,000 + $1,075 = $44,075.00

// Price -> ROI%
pnl = (tpPrice - entryPrice) * size = ($44,075 - $43,000) * 0.5 = $537.50
roiPercent = ($537.50 / $1,075) * 100 = 50.00%

// Price -> USD PnL
usdPnl = (side == Long) ? (price - entryPrice) * size : (entryPrice - price) * size
Example: TP at $44,075 -> ($44,075 - $43,000) * 0.5 = $537.50
```

---

## 8. Liquidation Price

### 8.1 Isolated Margin

```
Formula:
  LP = (EP - (IsoBalance + MA) / Size) / (1 - Direction * MMR)

Where:
  EP        = Entry Price
  IsoBalance = Isolated margin balance
  MA        = Maintenance Amount (from tier)
  Size      = SIGNED size (+0.5 for Long, -0.5 for Short)
  Direction = +1 for Long, -1 for Short
  MMR       = Maintenance Margin Rate (from tier)
```

**Example** (our reference Long position):
```
EP = 43000, IsoBalance = 1075, MA = 0, Size = +0.5, Direction = +1, MMR = 0.004

Numerator = EP - (IsoBalance + MA) / Size
         = 43000 - (1075 + 0) / 0.5
         = 43000 - 2150
         = 40850

Denominator = 1 - Direction * MMR
           = 1 - 1 * 0.004
           = 0.996

LP = 40850 / 0.996 = $41,014.06
```

**Display**: `"$41,014.06"` — if BTC drops to this price, you get liquidated.

**Validation**:
- Long: LP must be < entryPrice ($41,014 < $43,000 -> valid)
- Short: LP must be > entryPrice
- If validation fails, return 0 (immediate liquidation)

**Example** (Short position: Short 0.5 BTC at $43,000, isoBalance = $1,075):
```
Size = -0.5, Direction = -1

Numerator = 43000 - (1075 + 0) / (-0.5) = 43000 + 2150 = 45150
Denominator = 1 - (-1) * 0.004 = 1 + 0.004 = 1.004

LP = 45150 / 1.004 = $44,960.16
```

**Display**: `"$44,960.16"` — if BTC rises to this price, you get liquidated.

### 8.2 Cross Margin

```
Formula:
  LP = (EP - (W + TU - TM + MA) / Size) / (1 - Direction * MMR)

Where:
  W  = WalletBalance - sum(all isolated positions' IsoBalance)
  TU = sum(OTHER cross positions' uPnL)         <-- exclude THIS position
  TM = sum(OTHER cross positions' maintenanceMargin)  <-- exclude THIS position
  MA = Maintenance Amount (from tier)
```

**Example**: Cross Long 0.5 BTC at $43,000. Wallet = $10,500. One other cross position (ETH) with uPnL = +$100 and maintenanceMargin = $30. One isolated position with isoBalance = $500. MMR = 0.004, MA = $0.

```
W = $10,500 - $500 = $10,000
TU = $100  (other cross positions' uPnL)
TM = $30   (other cross positions' maintenance margin)

Numerator = 43000 - (10000 + 100 - 30 + 0) / 0.5
         = 43000 - 10070 / 0.5
         = 43000 - 20140
         = 22860

Denominator = 1 - 1 * 0.004 = 0.996

LP = 22860 / 0.996 = $22,951.81
```

**Display**: `"$22,951.81"` — much lower than isolated because the entire wallet balance backs the position.

Cross liquidation price **changes in real-time** as:
- Wallet balance changes (deposits/withdrawals)
- Other cross positions' PnL moves
- New positions are opened/closed

### 8.3 Order Liquidation Price Estimation (for order form)

Before placing an order, estimate what the liquidation price would be:

```
1. Use limit price (for limit orders) or mark price (for market orders) as entry
2. Calculate notional = size * estimatedEntry
3. Look up MMR and MA from tiers for that notional
4. For isolated: margin = notional / leverage
5. For cross: build context from existing positions
6. Apply the isolated or cross formula

Validation:
  Long:  if estimated LP >= markPrice -> show "--" (would liquidate immediately)
  Short: if estimated LP <= markPrice -> show "--"
```

---

## 9. Margin Tiers

Each market has tiers sorted by `max_notional` ascending:

```json
[
  { "max_notional": "50000",   "max_leverage": 50, "maintenance_margin_rate": "0.004", "maintenance_amount": "0" },
  { "max_notional": "250000",  "max_leverage": 25, "maintenance_margin_rate": "0.005", "maintenance_amount": "50" },
  { "max_notional": "1000000", "max_leverage": 20, "maintenance_margin_rate": "0.01",  "maintenance_amount": "1300" }
]
```

### Tier Lookup

```
getMarginTier(tiers, notional):
    Return first tier where max_notional >= notional
    If notional exceeds all tiers, return the last tier

Example: notional = $21,750 -> Tier 1 ($50,000 >= $21,750) -> mmr=0.004, ma=$0
Example: notional = $80,000 -> Tier 2 ($250,000 >= $80,000) -> mmr=0.005, ma=$50
Example: notional = $500,000 -> Tier 3 ($1,000,000 >= $500,000) -> mmr=0.01, ma=$1,300

getMMR(market, notional):
    Return tier's maintenance_margin_rate as decimal

getMaintenanceAmount(market, notional):
    Return tier's maintenance_amount as number

getMaxLeverage(market):
    Return first tier's max_leverage (= highest possible)
    Example: 50x

getMaxLeverageForNotional(market, notional):
    Return the applicable tier's max_leverage
    Example: notional=$80,000 -> Tier 2 -> 25x max

getMaxPositionSizeForLeverage(market, leverage):
    Find the highest-notional tier whose max_leverage >= leverage
    Return that tier's max_notional
    Example: leverage=30 -> Tier 1 (max_leverage=50 >= 30) -> max $50,000
    Example: leverage=20 -> Tier 3 (max_leverage=20 >= 20) -> max $1,000,000
```

---

## 10. Order Placement

### 10.1 Place Order (Market, Limit, Stop)

```
POST /v2/order
Headers: Authorization: Bearer <JWT>

Example: Buy 0.5 BTC limit at $43,000

Body:
{
  "symbol": "BTC-USD",
  "side": "buy",
  "type": "limit",
  "size": "0.5",
  "price": "43000.00",
  "time_in_force": "GTC",
  "reduce_only": false,
  "vault_id": null
}

Response:
{
  "client_order_id": "auto-generated-uuid",
  "account_id": "a1b2c3d4-...",
  "symbol": "BTC-USD",
  "sequence_id": 12345,
  "message_id": "msg-uuid-..."
}
```

### 10.2 Strategy Order (with TP/SL)

```
POST /v2/order/strategy
Headers: Authorization: Bearer <JWT>

Example: Market buy 0.5 BTC with TP at $45,000 and SL at $41,000

Body:
{
  "strategy_id": "d4e5f6a7-b8c9-...",
  "client_order_id": "strat-d4e5f6a7-primary",
  "symbol": "BTC-USD",
  "side": "buy",
  "type": "market",
  "size": "0.5",
  "reduce_only": false,

  "take_profit_orders": [
    {
      "type": "take_profit",
      "size": "0.5",
      "stop_price": "45000.00",
      "client_order_id": "strat-d4e5f6a7-tp",
      "working_type": "mark_price"
    }
  ],
  "stop_loss_orders": [
    {
      "type": "stop",
      "size": "0.5",
      "stop_price": "41000.00",
      "client_order_id": "strat-d4e5f6a7-sl",
      "working_type": "mark_price"
    }
  ]
}
```

### 10.3 Replace Order (Atomic Cancel + Create)

```
POST /v2/order/replace
Headers: Authorization: Bearer <JWT>

Body:
{
  "cancel": { "order_id": 12345, "symbol": "BTC-USD" },
  "new_order": {
    "symbol": "BTC-USD",
    "side": "buy",
    "type": "limit",
    "size": "0.5",
    "price": "43100.00",
    "time_in_force": "GTC"
  }
}
```

### 10.4 Cancel Order / Cancel All

```
DELETE /v2/order/cancel
Body: { "order_id": 12345, "symbol": "BTC-USD" }

DELETE /v2/order/cancel-all
Body: { "symbol": "BTC-USD" }     // optional: omit to cancel ALL
```

### 10.5 Mappings

| UI | API `side` | | UI | API `type` |
|---|---|---|---|---|
| Long (open) | `"buy"` | | Market | `"market"` |
| Short (open) | `"sell"` | | Limit | `"limit"` |
| Close Long | `"sell"` | | Stop Market | `"stop"` |
| Close Short | `"buy"` | | Stop Limit | `"stop_limit"` |
| | | | Take Profit | `"take_profit"` |
| | | | Take Profit Limit | `"take_profit_limit"` |

### 10.6 Size & Price Formatting

Before submitting, snap to valid increments:
```
snappedSize = floor(0.5123 / 0.0001) * 0.0001 = 0.5123  (already valid)
snappedPrice = floor(43001.57 / 0.01) * 0.01 = 43001.57  (already valid)
formattedSize = "0.5123"   (string with base_prec decimals)
```

---

## 11. Estimated Entry, Slippage & Fees

### 11.1 Estimated Entry Price

**No existing position**: VWAP from order book (market) or limit price (limit).

**Increasing position (same direction)**:
```
Example: Already Long 0.3 BTC at $42,800. Adding 0.2 BTC at fill price $43,100.

newEntry = (0.3 * 42800 + 0.2 * 43100) / (0.3 + 0.2)
        = (12840 + 8620) / 0.5
        = $42,920.00
```

**Display**: `"Est. Entry: $42,920.00"` (blended entry)

**Position flip**: skip closing portion, VWAP only opening portion (see Section 4.4).

### 11.2 Slippage

Only for market orders. Compares VWAP fill to current mark price:

```
Long:  slippage% = ((fillPrice - markPrice) / markPrice) * 100
Short: slippage% = ((markPrice - fillPrice) / markPrice) * 100

Example: Long market, VWAP fill = $43,260, markPrice = $43,250
  slippage = ((43260 - 43250) / 43250) * 100 = 0.0231%
```

**Display**: `"Est. Slippage: 0.0231%"`

### 11.3 Estimated Fee

```
orderValue = size * assumedPrice = 0.5 * 43000 = $21,500

// Market order -> taker rate, with 10% discount
takerRate = 0.0005
discountedRate = 0.0005 * (100 - 10) / 100 = 0.0005 * 0.9 = 0.00045
estimatedFee = $21,500 * 0.00045 = $9.675 -> rounded to $9.675

// Limit order -> maker rate, with 10% discount
makerRate = 0.0002
discountedRate = 0.0002 * 0.9 = 0.00018
estimatedFee = $21,500 * 0.00018 = $3.870
```

**Display**: `"Est. Fee: $9.68"` (market) or `"Est. Fee: $3.87"` (limit)

---

## 12. Margin & Order Value

### 12.1 Order Value

```
orderValue = size * assumedPrice
           = 0.5 * $43,000 = $21,500.00
```

**Display**: `"Order Value: $21,500.00"`

### 12.2 Required Margin for Order

Only the **opening portion** needs margin (closing existing position doesn't):

```
Example: You're Short 0.2 BTC and place a Long 0.5 BTC order.
  oppositePositionSize = 0.2
  openingSize = max(0, 0.5 - 0.2) = 0.3   (only 0.3 BTC opens new Long)
  openingNotional = 0.3 * $43,000 = $12,900
  margin = $12,900 / 20 + 0.3 * 0 = $645.00

Example: You have no position, Long 0.5 BTC at 20x:
  openingSize = 0.5
  margin = (0.5 * $43,000) / 20 = $21,500 / 20 = $1,075.00
```

**Display**: `"Margin: $1,075.00"`

### 12.3 Max Order Size

```
costPerUnit = (currentPrice / leverage) + openLossPerUnit
            = ($43,000 / 20) + $0 = $2,150 per BTC

maxOpeningSize = availableBalance / costPerUnit
              = $8,200 / $2,150 = 3.8139 BTC

maxOrderSize = oppositePositionSize + maxOpeningSize
             = 0 + 3.8139 = 3.8139 BTC
```

**Display**: "Max" button fills size to `3.8139`.

### 12.4 Tier Validation

```
Before submitting a Long 2.0 BTC order at 30x with no existing position:
  resultingNotional = 2.0 * $43,000 = $86,000
  maxLevForNotional = getMaxLeverageForNotional(market, $86,000) = 25x (Tier 2)

  30x > 25x -> ERROR: "Max leverage at this size is 25x"
```

---

## 13. Leverage & Margin Mode

### 13.1 Update Leverage

```
POST /v2/leverage?account_id=a1b2c3d4-...
Headers: Authorization: Bearer <JWT>

Body: { "symbol": "BTC-USD", "leverage": 25 }

Response: { "leverage": 25, "maxNotionalValue": "250000", "symbol": "BTC-USD" }
```

### 13.2 Update Margin Mode

```
POST /v2/marginMode?account_id=a1b2c3d4-...
Headers: Authorization: Bearer <JWT>

Body: { "symbol": "BTC-USD", "marginMode": "isolated" }

Response: { "symbol": "BTC-USD", "marginMode": "isolated" }
```

### 13.3 Modify Isolated Margin

```
POST /v2/isoMargin
Headers: Authorization: Bearer <JWT>

Body: { "symbol": "BTC-USD", "amount": "200.00", "modify_type": "add" }

Response: { "symbol": "BTC-USD", "sequence_id": 123, "message_id": "..." }
```

---

## 14. Funding Rate

### 14.1 Data Source

From `markPriceUpdate` WS event:
- `r` = current funding rate as decimal string
- `T` = next funding time (unix ms)

### 14.2 Display

```
fundingRatePercent = parseFloat("0.0001") * 100 = 0.01%
annualizedRate = 0.0001 * 100 * 3 * 365 = 10.95%
                 (3 funding periods per day * 365 days)
```

**Display**: `"Funding: 0.0100% / 8h"` and `"Annualized: 10.95%"`

Positive rate = Longs pay Shorts. Negative rate = Shorts pay Longs.

### 14.3 Countdown Timer

```
countdown = nextFundingTime - Date.now()
         = 1700028800000 - 1700025200000 = 3,600,000ms = 1 hour

Display: "01:00:00"   (update every second)
```

### 14.4 Funding History

```
GET /v2/history/funding?account_id=a1b2c3d4-...&limit=20
Headers: Authorization: Bearer <JWT>

Response example:
[
  {
    "id": 1, "symbol": "BTC-USD", "position_size": "0.5", "position_side": "Long",
    "funding_rate": "0.0001", "amount": "-2.175", "timestamp": 1700000000000
  }
]
```

`amount = -2.175` means you paid $2.175 in this funding period.

Calculation: `amount = positionNotional * fundingRate * direction`
```
= $21,750 * 0.0001 * (-1 for Long paying positive rate) = -$2.175
```

### 14.5 Accumulated Funding (per position)

`accumulatedFundingFees` is a running total from the API:
- Positive = net received funding
- Negative = net paid funding
- **Not recalculated client-side** — preserved during WS position updates

**Display**: `"-$12.50"` in red in the Funding column.

---

## 15. Fee Tiers

### 15.1 Fetch Fee Tiers (Public)

```
GET /v2/fee-tiers

Response:
[
  { "Tier": 0, "MinVolume": 0,       "TakerRate": 0.0005, "MakerRate": 0.0002 },
  { "Tier": 1, "MinVolume": 100000,  "TakerRate": 0.0004, "MakerRate": 0.00015 },
  { "Tier": 2, "MinVolume": 500000,  "TakerRate": 0.00035, "MakerRate": 0.0001 }
]
```

User's current tier comes from `/v2/portfolio` response (`fee_tier` field).

### 15.2 Fee Calculation Example

```
Tier 1 user, 10% discount, placing a market order for 0.5 BTC at $43,000:

orderValue = 0.5 * $43,000 = $21,500
takerRate = 0.0004 (Tier 1)
discountedRate = 0.0004 * (1 - 0.10) = 0.00036
fee = $21,500 * 0.00036 = $7.74
```

### 15.3 Display Format

```
Rate display: 0.0004 * 100 = "0.040%"
With discount: "0.040% -> 0.036% (10% off)"
```

Default rates (when no tier data available): taker 0.05%, maker 0.02%.

---

## 16. Deposit & Withdrawal

### 16.1 Deposit Flow

**Step 1: Get Quote**
```
POST /v2/deposit/quote
Headers: Authorization: Bearer <JWT>
Body: { "blockchain": "ethereum", "asset_symbol": "USDC", "asset_amount": "1000000000" }

Response:
{
  "request_id": "d1e2f3a4-...",
  "quote": {
    "asset_symbol": "USDC",
    "asset_amount": "1000000000",
    "usd_value": "1000.00",
    "exchange_rate": "1.0",
    "expiration_at": 1700001800000
  },
  "deposit_address": "0xVaultContract...",
  "confirmations_required": 12
}
```

**Step 2**: Submit the on-chain transaction (chain-specific):
- **EVM**: call smart contract `depositETH()` or `depositERC20()`
- **Solana**: call Anchor program `deposit()` instruction
- **Cardano**: build TX via `POST /api/perpetuals/deposit`, sign with wallet

**Step 3: Confirm**
```
POST /v2/deposit
Body: { "request_id": "d1e2f3a4-...", "tx_hash": "0xabc123..." }
Response: { "request_id": "...", "status": "pending" }
```

**Step 4: Poll Status (optional)**
```
GET /v2/transaction/status?request_id=d1e2f3a4-...&type=deposit
Response: { "status": "completed" }
```

### 16.2 Withdrawal Flow

**Step 1: Get Quote**
```
POST /v2/withdraw/quote
Headers: Authorization: Bearer <JWT>
Body: { "usd_value": "500.00", "blockchain": "cardano", "recipient_address": "addr1...", "asset": "ADA" }

Response: { "withdraw_id": "w1x2y3z4-...", "message_to_sign": "Confirm withdrawal of $500..." }
```

**Step 2**: Sign the message with your wallet (chain-specific).

**Step 3: Execute**
```
POST /v2/withdraw
Body: { "withdraw_id": "w1x2y3z4-...", "wallet_signature": "845846a2..." }
Response: { "request_id": "...", "status": "pending" }
```

**Cardano Extra Step**: Before executing, must build and submit a 2 ADA batcher fee transaction:
```
GET /v2/validator/leader?chain=cardano -> { "address": "addr1..." }
POST /api/perpetuals/withdraw-batcher -> { "txData": "84a400..." }
Sign and submit batcher TX, then proceed to POST /v2/withdraw
```

---

## 17. History Endpoints

All history endpoints use **cursor-based pagination**. Set `fromId` or `fromOrderID` to the last item's `id` to fetch the next page. Stop when `count < limit`.

### 17.1 Order History

```
GET /v2/history/order?account_id={id}&limit=20&symbol=BTC-USD&fromOrderID=12344
Headers: Authorization: Bearer <JWT>

Response:
{
  "orders": [
    {
      "id": 12345,
      "client_order_id": "strat-uuid-primary",
      "symbol": "BTC-USD",
      "side": "buy",
      "status": "filled",
      "type": "limit",
      "size": "0.5",
      "filled": "0.5",
      "price": "43000.00",
      "stop_price": "0",
      "fee": "3.87",
      "reduce_only": false,
      "post_only": false,
      "close_reason": null,
      "auto_close_type": "",
      "working_type": "none",
      "time_in_force": "GTC",
      "create_timestamp": 1700000000000,
      "event_timestamp": 1700000001000
    }
  ],
  "count": 20
}
```

Statuses: `pending`, `open`, `filled`, `canceled`, `rejected`, `expired`, `untriggered`

### 17.2 Trade/Fill History

```
GET /v2/history/fill?account_id={id}&limit=20&fromId=5677
Headers: Authorization: Bearer <JWT>

Response:
{
  "fills": [
    {
      "id": 5678,
      "trade_id": 9012,
      "order_id": 12345,
      "symbol": "BTC-USD",
      "side": "buy",
      "role": "taker",
      "price": "43000.00",
      "size": "0.5",
      "realized_pnl": "0",
      "fee": "9.675",
      "auto_close_type": "",
      "timestamp": 1700000000000
    }
  ],
  "count": 20
}
```

Net PnL per trade: `netPnl = parseFloat(realized_pnl) - parseFloat(fee)`

### 17.3 Deposit/Withdrawal History

```
GET /v2/history/transaction?account_id={id}&type=deposit,withdraw&limit=20
Headers: Authorization: Bearer <JWT>

Response:
[
  {
    "id": 100,
    "type": 1,
    "amount": "1000.00",
    "blockchain": "cardano",
    "tx_hash": "abc123...",
    "status": 2,
    "timestamp": 1700000000000,
    "asset_symbol": "ADA",
    "asset_amount": 2500.00
  }
]
```

Type values: 1=Deposit, 2=Withdraw. Status values: 1=Pending, 2=Completed, 3=Failed, 4=Cancelled.

---

## 18. Vault Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `GET /v2/vaults?status=active` | GET | No | List vaults |
| `GET /v2/vault/{id}` | GET | No | Vault details |
| `GET /v2/vault/{id}/portfolio` | GET | No | Vault portfolio |
| `GET /v2/vault/{id}/history` | GET | No | Vault tx history |
| `GET /v2/vault/{id}/depositors` | GET | No | List depositors |
| `POST /v2/vault/create` | POST | Yes | Create vault |
| `POST /v2/vault/deposit` | POST | Yes | Deposit to vault |
| `POST /v2/vault/withdraw` | POST | Yes | Withdraw from vault |
| `POST /v2/vault/{id}/pause` | POST | Yes | Pause vault (leader) |
| `POST /v2/vault/{id}/resume` | POST | Yes | Resume vault (leader) |
| `POST /v2/vault/{id}/withdrawals/{wid}/cancel` | POST | Yes | Cancel withdrawal |
| `GET /v2/vault/positions` | GET | Yes | All user vault positions |
| `GET /v2/vault/position?vault_id={id}` | GET | Yes | User's vault position |

---

## 19. Referral Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `GET /v2/referral` | GET | Get referral code and stats |
| `POST /v2/referral` | POST | Create referral code |
| `POST /v2/referral/accept?code={code}` | POST | Accept referral code |
| `GET /v2/referral/history` | GET | Referral history |
| `GET /v2/referral/reward` | GET | Reward history |
| `POST /v2/referral/withdraw` | POST | Claim rewards |

---

## Appendix A: Trigger Condition Display

For stop/TP orders, show which price triggers them and the direction:

| Order Type + Side | Display |
|---|---|
| Stop Buy | `"Mark Price >= $42,500"` |
| Stop Sell | `"Mark Price <= $44,000"` |
| Take Profit Buy | `"Mark Price <= $42,500"` |
| Take Profit Sell | `"Mark Price >= $44,000"` |

Replace "Mark Price" with "Last Price" if `working_type` is `"contract_price"`.

## Appendix B: Statistics Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /v2/markPrice?symbol=BTC-USD` | Mark price snapshot |
| `GET /v2/depth?symbol=BTC-USD&limit=100` | Order book |
| `GET /v2/klines?symbol=BTC-USD&interval=1h&limit=500` | Historical candles |
| `GET /v2/trades?symbol=BTC-USD&limit=50` | Recent public trades |
| `GET /v2/ticker/24hr?symbol=BTC-USD` | 24hr stats |
| `GET /v2/ticker/bookTicker?symbol=BTC-USD` | Best bid/ask |
| `GET /v2/openInterest` | Open interest |
| `GET /v1/stats/coin/history/open-interest?symbol=BTC-USD` | OI history |
| `GET /v1/stats/coin/history/funding?symbol=BTC-USD` | Funding history chart |
| `GET /v1/stats/coin/history/basis?symbol=BTC-USD` | Basis (mark-index) |
| `GET /v1/stats/coin/history/spread?symbol=BTC-USD` | Bid-ask spread |
| `GET /v1/stats/coin/history/long-short-ratio?symbol=BTC-USD` | Long/short ratio |
| `GET /v1/stats/coin/liquidation-map?symbol=BTC-USD` | Liquidation heatmap |
| `GET /v1/leaderboard?type=total_pnl&limit=100` | Leaderboard |

---

*Generated from Strike Finance App v2 codebase*
