# Market API — Backend Requirements

> Updated 2025-03-08 after frontend fixes. Frontend now handles DexHunter fallbacks and reads all fields from the API response.

## Backend Repo

https://github.com/Gero-Labs/cardano-market-data

**Stack**: Java 21, Spring Boot 3.5, PostgreSQL, Flyway, yaci-store 2.0 (Cardano node indexer)

---

## What Already Works

| Feature | Backend implementation | Status |
|---|---|---|
| Per-token aggregation | `MarketDataService.aggregateByAsset()` — picks price from highest-TVL pool, sums volume/TVL | Implemented |
| Price changes (1h/24h/7d) | `enrichWithPriceChanges()` — computed from candle close prices via batch SQL | Implemented |
| Token metadata | `TokenMetadataService` — name, ticker, decimals, logo, fingerprint from Cardano Token Registry | Implemented (separate endpoint) |
| OHLCV candles | `CandleService` — 15m, 1h, 1D, 1W resolutions | Implemented |
| P&L (FIFO) | `WalletService.getPnl()` — FIFO cost basis from Blockfrost tx history (200 tx limit) | Implemented (slow) |
| Real order book | `DexService` — MuesliSwap + GeniusYield limit orders | Implemented |
| Simulated order book | `DexService` — constant product AMM curve simulation | Implemented |
| Cross-DEX prices | `/api/v1/market/prices/{assetId}/all` | Implemented |
| WebSocket prices | STOMP+SockJS `/ws/market` with 10s broadcasts | Implemented |

---

## What the Frontend Already Handles

These items were previously listed as backend requirements but the frontend now resolves them with DexHunter store fallbacks:

| Field | Frontend fallback | Notes |
|---|---|---|
| `name` | `dexHunterStore.dexHunterTokens[assetId].name` | Falls back to `assetNameAscii` if neither available |
| `ticker` | `dexHunterStore.dexHunterTokens[assetId].ticker` | Falls back to `assetNameAscii` |
| `logo` / image | `dexHunterStore.dexHunterTokens[assetId].img` | Empty string if unavailable |
| `fingerprint` | `dexHunterStore.dexHunterTokens[assetId].fingerprint` | Needed for Xerberus risk lookup |
| `verified` | `dexHunterStore.dexHunterTokens[assetId].verified` | Defaults to `false` |
| `marketCap` | `dexHunterStore.dexHunterTokens[assetId].mcap` | Defaults to `0` |
| `holders` | `dexHunterStore.dexHunterTokens[assetId].holders` | Defaults to `0` |
| `priceChange1h/24h/7d` | Defaults to `0` if backend returns `null` | No client-side calculation |
| `isNew` | Defaults to `false` if backend returns `null` | |
| `liquidity` | Defaults to `0` if backend returns `null` | |

**The frontend works without any backend changes.** The items below improve data quality and eliminate the DexHunter dependency.

---

## Backend Action Items

### 1. Verify aggregation returns 1 row per token (Critical)

Check that `GET /api/v1/market/prices` returns exactly **one entry per assetId** with `dex: null`.

**Quick test**:
```bash
curl https://market.gerowallet.io/api/v1/market/prices | jq 'group_by(.assetId) | map(select(length > 1)) | length'
```

If this returns > 0, `aggregateByAsset()` has a bug. The frontend will show duplicate rows.

### 2. Verify `priceChange` fields are serialized (Critical)

Check that `enrichWithPriceChanges()` results actually appear in the JSON response. The frontend reads `priceChange1h`, `priceChange24h`, `priceChange7d` — if they're transient or missing from the DTO, the frontend falls back to `0` and change% columns will all show 0%.

**Quick test**:
```bash
curl https://market.gerowallet.io/api/v1/market/prices | jq '.[0] | {priceChange1h, priceChange24h, priceChange7d}'
```

If any are `null` for all tokens, the enrichment step isn't serializing them.

### 3. Join `token_metadata` into `/prices` response (High — eliminates DexHunter dependency)

The backend has `TokenMetadataService` with name, ticker, logo, fingerprint, decimals. These are available at `/api/v1/market/tokens/{assetId}/metadata` but **not included** in the aggregated `/prices` response.

Adding these fields to `/prices` would:
- Eliminate the frontend's DexHunter store dependency for market data
- Reduce client-side data sources from 3 (backend + DexHunter + Xerberus) to 2
- Provide consistent naming/images

**Implementation**: In `MarketDataService`, after `aggregateByAsset()` and `enrichWithPriceChanges()`:
```java
enrichWithMetadata(aggregated); // join name, ticker, logo, fingerprint, decimals
```

Expected fields in response:
```json
{
  "assetId": "...",
  "name": "Snek",
  "ticker": "SNEK",
  "logo": "https://...",
  "fingerprint": "asset1...",
  "decimals": 0,
  "verified": null
}
```

### 4. Add computed fields (Medium)

These fields currently come from DexHunter fallback. Adding them to the backend makes the data self-contained:

| Field | How to add | Priority |
|---|---|---|
| `verified` | Boolean column in `token_metadata` (manual curation or token registry) | High |
| `isNew` | `firstSeen > now() - 7 days` from `token_price` timestamps | Medium |
| `liquidity` | Sum of ADA reserves across all pools for the token (from `liquidity_pool` table) | Medium |
| `marketCap` | `circulatingSupply * priceUsd` — needs supply data (Blockfrost or token registry) | Medium |
| `holders` | Count of unique addresses holding the token — expensive, consider caching | Low |

### 5. Cache P&L results (Medium)

`WalletService.getPnl()` fetches up to 200 transactions from Blockfrost **on every request** and computes FIFO cost basis in real-time. This causes timeouts (frontend uses 60s timeout as a band-aid).

Options:
- **Caffeine cache** with 5-minute TTL per stake address (easiest)
- **Pre-compute**: Background job that updates P&L on new transactions
- **Paginate**: Return partial results for wallets with heavy history

---

## Existing Endpoints — No Changes Needed

| Endpoint | Used by | Status |
|---|---|---|
| `GET /api/v1/market/ada` | MarketStatBar, ADA price display | OK |
| `GET /api/v1/market/prices/{assetId}` | Single token lookup | OK |
| `GET /api/v1/market/prices/{assetId}/all` | CrossDexPrices component | OK |
| `GET /api/v1/prices/historical/candles` | TechnicalAnalysisChart | OK |
| `GET /api/v1/market/history/{assetId}` | Price history views | OK |
| `GET /api/v1/dex/pools/token/{policyId}/{assetName}` | DepthChart | OK |
| `GET /api/v1/dex/orderbook/{poolId}` | DepthChart (real orders) | OK |
| `GET /api/v1/dex/orderbook/{poolId}/simulated` | DepthChart (AMM simulation) | OK |
| `GET /api/v1/wallet/{stakeAddress}/pnl` | P&L tracking | OK (needs caching) |
| `GET /api/v1/wallet/{stakeAddress}/history` | Portfolio chart | OK |
| `GET /api/v1/wallet/{stakeAddress}/holdings` | Holdings view | OK |

---

## Summary

| Priority | What | Effort | Impact |
|---|---|---|---|
| **Critical** | Verify `/prices` returns 1 row per token | Quick check | Fixes duplicate rows in table |
| **Critical** | Verify `priceChange1h/24h/7d` in JSON response | Quick check | Fixes 0% change columns |
| **High** | Join `token_metadata` into `/prices` response | Small | Eliminates DexHunter dependency |
| **Medium** | Add `verified`, `isNew`, `liquidity` fields | Medium | Better data quality |
| **Medium** | Cache P&L results (Caffeine 5min TTL) | Small | Fixes timeout issues |
| **Low** | Add `marketCap`, `holders` fields | Medium | Nice-to-have (DexHunter covers it) |
