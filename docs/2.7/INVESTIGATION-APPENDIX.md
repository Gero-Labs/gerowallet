# 2.7 Audit — Investigation Appendix (raw agent findings)

_Generated 2026-06-24._

## Website market surface (source of truth)
probe four markdown listing endpoints prices latest candles rsi sparklines currency-rate market ada dex swaps orderbook holders pools nft leaderboard sync wallet

---

## Gero dashboard market surface
## Gero Wallet — Market-Data Display Inventory

### Where the market surface lives
- **Home dashboard market view**: `src/modules/portfolio/PortfolioPage.vue` (route `/`). Hosts `MarketTokenTable`, `NftCollectionTable`, `TokenDetailPanel`, `PortfolioChart`. View modes: `holdings | collectibles | market | watchlist`.
- **Token detail overlay**: `src/modules/market/components/TokenDetailPanel.vue` — chart + currency toggle + TA indicators + Buy/Sell volume + Recent Trades + Swap/Depth tabs + token-info grid + P&L table.
- **Sidepanel (Mini-Gero) market**: `src/sidepanel/pages/MarketPage.vue` (token list + bottom-sheet detail). Reuses `useMarketData` but has its OWN local formatters (not the shared `utils/formatters.ts`).
- **Data source**: all market data via `src/api/market-api.ts` → Nexus proxy → `cardano-market-data` backend. Apex-chain wallets bypass the market API and use `coinGeckoStore['apex-4']` instead.
- **Shared formatters**: `src/modules/market/utils/formatters.ts` — `formatCompact` (B/M/K, 1 dp), `formatBalance` (2 dp), `formatPriceRaw` (>=1 →2dp, >=0.01 →4dp, else 6dp), `formatPrice` (symbol+raw), `formatChange` (abs+`%`, 1 dp), `changeColor` (#47CD89/#F97066/#A3A3A3).

---

### View 1 — MarketTokenTable.vue (token list; holdings/market/watchlist)
Source: `useMarketData.ts` → `MarketToken` objects. Native token (ADA / AP3X) pinned at top. 25 rows/page.

| Metric | Header (i18n) | Unit | Number formatting | Source endpoint → field |
|---|---|---|---|---|
| Rank | `market.rank` | # | `(page-1)*25 + index + 1` | computed (row order) |
| Token icon+ticker+name | `market.token` | — | ticker bold; name 10px | `/api/market/prices` → `ticker/name/logo/verified` (DexHunter fallback) |
| Owned badge | `market.owned` | — | chip | `walletStore.tokens` (local) |
| Price (USD) | `market.price` | USD | `formatPrice` ($, adaptive); tooltip `toFixed(8)` | `prices` → `priceUsd` |
| Price sub (native) | — | ADA/AP3X | `<1?4dp:2dp` + native symbol | `prices` → `priceAda` |
| 1h change | `market.change1h` | % | `formatChange` (1 dp) + trend icon, colored | `prices` → `priceChange1h` |
| 24h change | `market.change24h` | % | `formatChange` (1 dp) + icon | `prices` → `priceChange24h` |
| 7d change | `market.change7d` | % | `formatChange` (1 dp) + icon | `prices` → `priceChange7d` |
| Volume 24h | `market.volume24h` | USD | `$`+`formatCompact`; tooltip `toLocaleString` 0 dp | `prices` → `volume24h` |
| Market cap | `market.marketCap` | USD | `$`+`formatCompact`; tooltip full | `prices` → `marketCap` (DexHunter `mcap` fallback) |
| TVL | `market.tvl` | fiat (converted) | currencySym+`formatCompact(convertFiat)`; `—` if null | `prices` → `tvl` |
| Holders | `market.holders` | count | `formatCompact`; `—` if null | `prices` → `holders` (DexHunter fallback) |
| Risk rating | `market.risk` | letter grade | Xerberus badge image; weight-sorted AAA→D | `xerberusStore.risks[fingerprint]` (NOT market API) |
| Allocation | `common.allocation` | % | progress bar `value/total*100`, 1 dp | computed from holdings `value` |
| Balance (holdings) | `market.balance` | token qty | `formatBalance`; masked when hideBalances | `walletStore` holdings |
| Value (holdings) | `market.value` | USD | `$`+`formatBalance`; masked | computed (balance×price) |
| Avg cost (holdings) | `market.avgCost` | native | `<1?4dp:2dp` + native sym | `/api/wallet/{stake}/pnl` → `tokens[].avgCostBasisAda` |
| Total P&L (holdings) | `market.totalPnl` | native | `+/-`+`toFixed(2)`+native; tooltip splits realized/unrealized 4dp | pnl → `realizedPnlAda + unrealizedPnlAda` |
| Watchlist star | — | — | toggle | localStorage |

Apex wallets: fixed columns `rank,name,price,change24h,volume24h,mcap,balance,value,watchlist` from CoinGecko.

---

### View 2 — TokenDetailPanel.vue (overlay)
Currency toggle: NATIVE / USD / EUR (ADA token only shows USD/EUR). EUR via `usdToEurRate`; NATIVE via `priceStore.adaUsd`.

| Metric | Where | Unit | Formatting | Source |
|---|---|---|---|---|
| Display price | header | sel. currency | `formatPrice` | `token.price`/`priceAda` |
| 24h change chip | header | % | `+/-`+`toFixed(2)`% | `priceChange24h` |
| Secondary price | header sub | other currency | `formatPriceRaw` | price/priceAda |
| Candlestick chart | left | OHLC sel. currency | lightweight-charts, precision 6 | `/api/prices/historical/candles` (ADA: `/api/prices/ada/candles`); fallback `/api/market/history/{id}` |
| TA indicators | left | VOL/SMA20/EMA20/RSI14/MACD12-26-9/BB20-2 | computed client-side (`useTechnicalAnalysis.ts`) | derived from candle closes |
| Stale-data warning | left | days | "last updated N days ago" if >7d | last candle time |
| Market cap | info grid | sel. currency | sym+`formatCompact(convertUsd)` | `token.mcap` |
| Volume 24h | info grid | sel. currency | sym+`formatCompact` | `token.volume24h` |
| TVL | info grid | sel. currency | sym+`formatCompact` or N/A | `token.tvl` |
| Holders | info grid | count | `toLocaleString` | `token.holders` |
| Risk | info grid | grade | TokenRiskBadge | `token.riskRating` |
| Verified | info grid | ✓/No | — | `token.verified` |
| Policy lock + ID | policy row | — | lock icon + copyable id | `unit[0:56]`; `policyLocked` hardcoded false |
| P&L: avg cost | pnl table | sel. currency | `convertAda`+sym (`<1?6dp:2dp`) | pnl `avgCostBasisAda` |
| P&L: unrealized | pnl table | sel. currency | `+/-`sym`toFixed(2)` | pnl `unrealizedPnlAda` |
| P&L: realized | pnl table | sel. currency | `+/-`sym`toFixed(2)` | pnl `realizedPnlAda` |
| P&L: total | pnl table | sel. currency | `+/-`sym`toFixed(2)` | realized+unrealized |

---

### View 3 — DepthChart.vue (detail "Depth" tab)
| Metric | Unit | Formatting | Source |
|---|---|---|---|
| Cumulative bid/ask depth area | ADA | lovelace/1e6; `formatCompact`+native sym | `/api/dex/orderbook/{poolId}` or `/simulated` (AMM/Orders toggle); pool from `/api/dex/pools/token/{policy}/{name}` → top by `tvlAda` |

### View 4 — OrderBookTable.vue (detail "Depth" tab)
| Metric | Header | Unit | Formatting | Source |
|---|---|---|---|---|
| Pool name | — | — | `formatDexName` | `orderbook.dex` |
| Pool current price | — | native | `formatOBPrice` (>=1k 0dp, >=1 4dp, else 6dp) | `currentPrice` |
| Pool TVL | — | native | `formatCompact` | `tvlAda` |
| Ask/Bid price | `market.price` | native | `formatOBPrice` | `asks/bids[].price` |
| Ask/Bid size | `market.size` | native | `formatSize` (M/K/2dp), lovelace/1e6 | `[].size` |
| Cumulative total | `market.total` | native | `formatSize` | computed |
| Spread + spread% | `market.spread` | native + % | `formatOBPrice` + `toFixed(2)%` | computed asks[0]-bids[0] |
| Depth bars | — | — | width % of max cumulative | computed |

Auto-refresh 30 s.

### View 5 — RecentTrades.vue (detail left col)
| Metric | Header | Unit | Formatting | Source |
|---|---|---|---|---|
| Time | `market.time` | relative | `timeAgo.format` | `/api/dex/swaps/token/{policy}/{name}` → `blockTime` |
| Type | `market.type` | BUY/SELL | inverted from ADA perspective; colored | `type` |
| Price | `market.price` | native | `formatTradePrice` (>=1 4dp, >=0.01 6dp, else 8dp) | `priceAda` |
| Volume | Vol | native | local `formatCompact` (M/K/1dp) | `volumeAda` |
| Own-trade marker | — | — | account icon | matches `walletStore.transactions` ids |

Poll new trades every 15 s.

### View 6 — BuySellVolume.vue (detail left col)
| Metric | Unit | Formatting | Source |
|---|---|---|---|
| Buy % / Sell % bar | % | `toFixed(0)%` | computed from up-to-100 swaps |
| Buy volume + count | native | local `formatCompact` + `(n)` | sum `volumeAda` where type=SELL |
| Sell volume + count | native | local `formatCompact` + `(n)` | sum `volumeAda` where type=BUY |

Source: `/api/dex/swaps/token/{policy}/{name}?limit=100`. Auto-refresh 30 s.

### View 7 — NftCollectionTable.vue (collectibles)
| Metric | Header | Unit | Formatting | Source |
|---|---|---|---|---|
| Rank | # | — | index+1 | order |
| Collection (img+name+policyId) | `portfolio.collection` | — | truncated id + copy | `walletStore.collections` + bulk stats |
| Held | `portfolio.held` | count | raw | wallet qty |
| Floor price + floor value | `portfolio.floorPrice` | ADA | `formatAda` (lovelace/1e6) + ₳; sub = floor×qty | `/api/nft/collections` or `/api/nft/collection/{policy}` → `floorPriceLovelace` |
| Last sale + vs-floor | `portfolio.lastSale` | ADA | `formatAda` + ₳; "+N% vs floor" colored | `lastSalePriceLovelace` |
| Volume | `portfolio.volume` | ADA | `formatCompact`(lovelace/1e6) + ₳ | `totalVolumeLovelace` |
| Sales | `portfolio.sales` | count | `toLocaleString` | `saleCount` |

### View 8 — PortfolioChart.vue (header; portfolio P&L summary)
| Metric | Unit | Formatting | Source |
|---|---|---|---|
| Portfolio value (ADA/USD/EUR) | currency | — | local computed + `getWalletHistory` snapshots |
| Total unrealized P&L | ADA (₳) | `+/-formatPnl`, colored | `/api/wallet/{stake}/pnl` → `totalUnrealizedPnlAda` |
| Total realized P&L | ADA (₳) | `+/-formatPnl`, colored | pnl → `totalRealizedPnlAda` |
| Chart series | currency | — | `/api/wallet/{stake}/history` → `totalValueAda/Usd/Eur` (via `portfolio-cache.ts`) |

### View 9 — Sidepanel MarketPage.vue (Mini-Gero)
Uses LOCAL formatters (divergent from dashboard). Token list: ticker/name, volume24h ("vol"), price (`$` local, `<0.001`→`<$0.001`), 24h change (`toFixed(2)%`). Bottom-sheet detail: market cap, volume24h, tvl, **liquidity**, holders, price-in-ADA (`₳` 8/4dp), 1h/24h/7d change, your balance. Note: liquidity is shown here but NOT in the dashboard table.

---

### market-api.ts — methods → endpoints → response fields (and usage)

| Method | Endpoint | Key response fields | Used by |
|---|---|---|---|
| `getAllPrices()` | GET `/api/market/prices` | TokenPriceResponse[] (assetId,dex,assetNameAscii,priceAda/Usd/Eur,priceChange1h/24h/7d,tvl,volume24h,organicVolume24h,marketCap,liquidity,holders,name,ticker,logo,fingerprint,decimals,verified,isNew,updatedAt) | `useMarketData` (table) |
| `getTokenPrice(id)` | GET `/api/market/prices/{id}` | TokenPriceResponse | **UNUSED** |
| `getTokenPricesAcrossDexes(id)` | GET `/api/market/prices/{id}/all` | TokenPriceResponse[] | `CrossDexPrices.vue` only (component itself unused) |
| `getTopByVolume(limit)` | GET `/api/market/prices/top-volume` | TokenPriceResponse[] | **UNUSED** |
| `getTopByTvl(limit)` | GET `/api/market/prices/top-tvl` | TokenPriceResponse[] | **UNUSED** |
| `getAdaPrice()` | GET `/api/market/ada` | priceUsd,priceEur,priceChange24h,marketCap,volume24h | `useMarketData` (native token + adaData) |
| `getPriceHistory(id,from,to)` | GET `/api/market/history/{id}` | PriceHistoryResponse[] | `useMarketData` candle fallback |
| `getPriceAtTime(id,time)` | GET `/api/market/history/{id}/at` | PriceHistoryResponse | **UNUSED** |
| `getAllTokenIds()` | GET `/api/market/tokens` | string[] | **UNUSED** |
| `getCandles(id,res,from,to,cur)` | GET `/api/prices/historical/candles` (ADA→`/api/prices/ada/candles`) | time,open,high,low,close,volume,currency | TokenDetailPanel chart |
| `getLatestPrices(symbols)` | GET `/api/prices/latest` | date, assets[] (asset,name,priceAda,priceUsd,updatedAt) | **UNUSED** |
| `getWalletPnl(stake)` | GET `/api/wallet/{stake}/pnl` (60s) | totalPnlAda,totalRealized/UnrealizedPnlAda,tokens[](unit,displayName,currentQuantity,avgCostBasisAda,currentPriceAda,realized/unrealizedPnlAda,unknownCostQuantity,costBasisComplete),truncated,total/processedTransactions | `useWalletPnl` (table avg-cost/PnL + PortfolioChart summary) |
| `getWalletHistory(stake,res,adaOnly)` | GET `/api/wallet/{stake}/history` | WalletSnapshot[] (timestamp,totalValueAda/Usd/Eur,adaBalance,tokenValueAda,nftValueAda) | `portfolio-cache.ts` → PortfolioChart |
| `getWalletHoldings(stake)` | GET `/api/wallet/{stake}/holdings` | any | **UNUSED** |
| `getPoolsByToken(policy,name)` | GET `/api/dex/pools/token/{policy}/{name}` | LiquidityPool[] (poolId,dex,tokenA/B…,price,tvlAda,feePercent) | DepthChart, OrderBookTable |
| `getOrderBook(poolId,levels)` | GET `/api/dex/orderbook/{poolId}` | OrderBook (currentPrice,tvlAda,bids/asks[](price,size,depthPercent)) | DepthChart, OrderBookTable (Orders) |
| `getSimulatedOrderBook(poolId,levels)` | GET `/api/dex/orderbook/{poolId}/simulated` | OrderBook | DepthChart, OrderBookTable (AMM, default) |
| `getTopPoolsByTvl(limit)` | GET `/api/dex/pools/top-tvl` | LiquidityPool[] | **UNUSED** |
| `getNftCollections(sort,limit)` | GET `/api/nft/collections` | NftCollectionStats[] (policyId,floorPriceLovelace,lastSalePriceLovelace,totalVolumeLovelace,saleCount,name,imageUrl,description) | `useNftMarketData` (bulk) |
| `getNftCollectionStats(policy)` | GET `/api/nft/collection/{policy}` | NftCollectionStats | `useNftMarketData` (per-collection gap fill) |
| `getNftCollectionSales(policy,limit)` | GET `/api/nft/collection/{policy}/sales` | NftSale[] (priceLovelace,seller/buyer,marketplace,txHash,blockTime) | **UNUSED** |
| `getNftFloorPrice(policy)` | GET `/api/nft/collection/{policy}/floor` | floorPriceLovelace | **UNUSED** |
| `getNftAssetPrice(policy,name)` | GET `/api/nft/asset/{policy}/{name}/price` | priceLovelace | **UNUSED** |
| `getTokenSwaps(policy,name,limit)` | GET `/api/dex/swaps/token/{policy}/{name}` | SwapHistory[] (txHash,type,priceAda,volumeAda,dex,blockTime) | RecentTrades, BuySellVolume |

---

### Fetched-but-not-displayed fields
- `TokenPriceResponse.organicVolume24h` and `.dex` are mapped into `MarketToken` but never rendered in the dashboard table or detail panel.
- `TokenPriceResponse.liquidity` is fetched and used only as a sort/fallback (CrossDexPrices, unused) and shown ONLY in the sidepanel bottom sheet — not in the dashboard.
- `WalletSnapshot.adaBalance/tokenValueAda/nftValueAda` are returned by `getWalletHistory` but only `totalValue*` is charted.
- `WalletPnlSummary.truncated/total/processedTransactions` and token `unknownCostQuantity` are returned but not surfaced.

### Dead/unmounted components
- **`MarketStatBar.vue`** — full "Hottest / Top Gainer / Top Loser / Total Volume" widget; imported by nothing. Would display: hottest ticker+`$formatCompact(volume24h)`, top gainer/loser `+/-toFixed(1)%`, total volume `$formatCompact`.
- **`CrossDexPrices.vue`** — full per-DEX price comparison table (DEX, price native, price USD, TVL, volume24h, "best price" badge); imported by nothing.

---

## Strike — API-layer audit
## Strike Finance v2 Perpetuals — API/Data-Layer Verification

Spec sources: `docs/strike-v2/*.yaml` (OpenAPI, treated as source of truth) + `STRIKE_V2_INTEGRATOR_GUIDE.md` (prose, partly stale) + the device-auth design/plan docs.

### Auth / Device — SUSPECT
- Header scheme matches the OpenAPI `ApiWalletAuth`: `X-API-Wallet-Public-Key / -Signature / -Timestamp / -Nonce` (`strike-v2.types.ts:61`, `strike-v2.auth.ts:72`). Message format `{METHOD}:{PATH}:{TIMESTAMP}:{NONCE}:{BODY_HASH}` matches `strike-v2-trade-api.yaml:108`. Ed25519 via `@noble/ed25519` with `randomSecretKey()` (32-byte seed) + `getPublicKeyAsync` is correct.
- **Query string is not signed.** `strikeClient.interceptors.request` (`strike-v2.client.ts:80-112`) calls `extractPath(config.url, ...)` while axios 1.x serializes `params` into the URL *after* the interceptor — so the signed PATH is e.g. `/v2/positions`, never `/v2/positions?symbol=…&vault_id=…`. The OpenAPI/guide consistently show query strings on authenticated GETs. If Strike's server includes the query in the signed PATH, every authenticated GET-with-params fails auth. The spec does not define this, so it is an unverified high-risk assumption.
- Vault OpenAPI (`strike-v2-vaults.yaml:25-33`) names the timestamp header `X-Api-Wallet-Signature-Timestamp` (extra `-Signature` segment) — differs from the `X-API-Wallet-Timestamp` the client always sends. Vault YAML is a separate v1.0.0 doc on a different host (`api.strike.finance`), so likely stale, but unverified for authed vault calls.
- 401/403 handler clears keys + notifies subscribers (`strike-v2.client.ts:125-137`): good.

### Builder Connect — SUSPECT (no spec coverage)
- `/auth/builder/request-signature` + `/auth/builder/verify-signature` (`strike-v2.builder-connect.ts:89-113`) appear in **none** of the OpenAPI YAMLs nor the guide. Request/response shapes, the `wallet_signature` JSON envelope (`{signature,key}` from CIP-30 DataSignature, set in `useStrikeOnboarding.ts:328`), and `code:'gero'`/`max_fee_bps:100` defaults cannot be validated against provided specs. Code is internally consistent and uses a plain unauthenticated axios client (correct, since auth doesn't exist pre-account).

### Market Data — WORKING
- Public market client base `${STRIKE_API_BASE}/price` matches `strike-v2-market-api.yaml:41` (`https://api.strikefinance.org/price`). `depth/trades/premiumIndex/markPrice/indexPrice/ticker.*/openInterest/exchangeInfo` paths + optional `symbol` params all match the YAML.
- `getMarkets()` (`/v2/markets`) and `getKlines()` (`/v2/klines`) have **no OpenAPI coverage** (only the prose guide §3 / Appendix B). `getMarkets` also routes through the authenticated `strikeClient` (main host, no `/price`) — plausible per guide but inconsistent with the other public calls.

### Trade — SUSPECT
- Order/cancel/cancel-all/openOrders/strategy/batch/replace/leverage/marginMode/isoMargin paths + bodies match the trade YAML (`tp_order`/`sl_order` singular is correct per `strike-v2-trade-api.yaml:742-748`; the guide's `take_profit_orders[]` is stale).
- Numeric-ID type drift: `CancelOrderRequest.order_id` is `string` but spec is `integer` (`:1535` area); `CreateOrderResponse.sequence_id` is `string` but spec is `integer/int64` (`strike-v2-trade-api.yaml:277-279`); `getOrder` passes `order_id` as `string` but GET param is `integer` (`:1470-1476`).
- `CreateStrategyOrderResponse` modeled as `CreateOrderResponse & {strategy_id}` — actual spec returns `primary_client_order_id/tp_client_order_id/sl_client_order_id/account_id/symbol` (`strike-v2-trade-api.yaml:750-779`).
- TWAP module (`/v2/algo/twap`, `strike-v2.trade.ts:108-141`) has **no OpenAPI coverage** anywhere.

### User / Account / Positions / History — SUSPECT
- Query-param names match the user YAML (`vault_id`, `position_id`, `startTime`/`endTime`, `symbol`, `limit`).
- **`symbol_settings` typed as `SymbolSettings[]`** (`strike-v2.types.ts:251`) but spec defines `type: object` with `additionalProperties` = symbol-keyed map (`strike-v2-user-api.yaml:235-249`). Also the client's `SymbolSettings` has a `symbol` field and lacks `allow_pre_trade`; spec's `SymbolSetting` is the inverse.
- `AccountResponse` lacks `withdrawable_balance` (in guide §5.1; not in YAML).
- History pagination cursors `fromId` (fill) / `fromOrderID` (order) exist in the spec (`strike-v2-user-api.yaml:1587,1741`) but are absent from `HistoryParams` — pagination is not implementable.
- Deposit/withdraw/transaction-status endpoints have no OpenAPI coverage; field names match the prose guide. **Cardano withdrawal** omits the guide-mandated batcher step (`GET /v2/validator/leader` + `POST /api/perpetuals/withdraw-batcher`) before `POST /v2/withdraw` (`strike-v2.user.ts:121-124`).

### Vaults — WORKING
- Public (`/v2/vaults`, `/v2/vault/{id}[/history|/portfolio|/depositors]`) and authed (`/v2/vault/position`, `/v2/vault/positions`, `/v2/vault/history`, `/v2/vault/my-deposits/history`) paths + `vault_id`/`limit`/`offset` params match `strike-v2-vaults.yaml`. (Auth header-name caveat noted above; host in YAML differs.)

### Collateral / Tx-build (nexus) — WORKING (but doc drift)
- `nexus-tx-api.ts` and `nexus-collateral-api.ts` are well-structured: error-body enrichment, Map/Array/Object asset-shape handling, network mapping. Both rely on the backend proxy injecting the Nexus API key — **no client auth**, matching their own comments.
- This contradicts the design doc `2026-05-20-nexus-device-market-auth-design.md` (§gerowallet changes), which specifies `Authorization: Bearer <device JWT>` via `getNexusAccessToken()` + 401 re-auth in `market-api.ts`. None of that exists in the shipped code (`market-api.ts` has no interceptors; `nexusDevice.service.ts`/`getNexusAccessToken` are absent). The doc describes an approach the code did not take.

### Clean
- No TODO/FIXME/STUB/HACK/hardcoded markers in any of the 10 target files.

---

## Strike — UI/composable/math audit
## Strike Perpetuals — UI/Composable/Math Verification

### Math layer — WORKING
`src/modules/market/math/*` is correct and self-consistent.
- `calcUnrealizedPnl`, `calcNotional`, `calcCurrentMargin`, `calcMaintenanceMargin` are textbook-correct.
- `calcLiquidationPriceIsolated`/`Cross` use `LP = (EP − (collateral)/Size) / (1 − dir·MMR)` with sane non-physical-price guards (returns 0 when LONG LP≥EP / SHORT LP≤EP). Cross correctly excludes the subject position by symbol+side (hedge-mode safe), sums other-cross uPnL/MM and subtracts isolated balances from wallet.
- `getMarginTier` returns first tier with `notional <= max_notional`, falls back to most restrictive — correct.
- `calcVwapMarketFill` walks levels in execution order, computes VWAP + bps slippage vs top-of-book, flags `insufficientDepth` — correct.
- Tier normalization parses string decimals once at the boundary — matches the documented pattern.
Note: `calcWithdrawableBalance`, `calcOrderCost`, `calcTpSlPriceFromPercentage/Usd`, `getMaxLeverageForNotional`, `groupOrderBookLevels` are exported but **never consumed** (forms reimplement margin/fee inline; orderbook uses its own `aggregateByTick`). Dead surface, not a bug.

### WebSocket lifecycle — WORKING
- `useStrikeMarketWs`: ref-counted `subscriptions` Map; `subscribe()` returns an unsub that deletes the callback and only sends `unsubscribe` when the last callback for a key is gone; `resubscribeAll()` on reconnect; exponential backoff (5s→60s); ping every 30s. Array events (`!markprice@arr`) routed per-item AND to the array channel.
- `useStrikeUserWs`: Ed25519 logon, userstream subscribe, order-update batching (300ms debounce, dedupe by orderId keeping latest E), position merge by `symbol+side` with flip cleanup, auth-error close codes skip reconnect, visibility-driven reconnect, full teardown in `disconnect()`.
- `useOrderBook`: cleans up prior depth/trades/mark subs before re-subscribing on symbol change, `onBeforeUnmount` cleanup, ResizeObserver disconnected via `onCleanup`.
- `PerpsPositionsPanel`: per-symbol mark-price subs are ref-counted in a Map and pruned when a position closes; unmount clears all. Good.
- Deposit/withdraw composables use a generation counter to cancel in-flight polling on reset — correct.

### Data flow
Two surfaces share the singleton composables (`useStrikeTrading`, `useStrikeMarket`, `useStrikeOnboarding`, `useOrderBook`). Dashboard = `PerpetualsDialog` → `PerpsOrderForm/OrderBook/PositionsPanel/AccountSection`. Sidepanel = `PerpetualsPage` → `OrderForm/OrderBook/PriceTicker/SymbolSelector` (renders positions/orders/history inline). The two surfaces have **diverged**: the sidepanel `OrderBook.vue` and `OrderForm.vue` are bespoke reimplementations that don't match the (correct) dashboard versions, which is where most bugs concentrate.

### SUSPECT / BROKEN summary
- BROKEN: sidepanel `OrderBook.vue` calls non-existent `subscribeOrderBook` → runtime TypeError.
- BROKEN: `useStrikeAccount` field-name mismatch → `AccountPanel` always blank/0%.
- BROKEN: sidepanel `OrderForm` drops TP/SL and miscomputes market notional/collateral.
- BROKEN: vault deposits credit the main account (vault_id ignored).
- BROKEN: dashboard chart doesn't follow symbol selection; chart symbol hardcoded ADA/USD.
- BROKEN: sidepanel history "load more" pagination.
- DEAD: AccountPanel, PositionsTable, OrdersTable, ClosedPositionsTable, HistoryTabs, TwapOrderDialog, useStrikeVaultDeposit (stub).

---

## Strike — live read-only checks
## Strike Perpetuals Data Endpoints — Live Read-Only Check

Test date: 2026-06-24. All requests GET / WS-read only. No mutating calls made.

### Endpoint resolution (from code)
- Market base (`strikeMarketClient`, `src/api/strike-v2.client.ts:143-150`): `https://api.strikefinance.org/price` → endpoints resolve to `…/price/v2/*`
- Auth client base (`strikeClient`, line 13/71): `https://api.strikefinance.org` → `getMarkets()` resolves to `…/v2/markets` (NO `/price` prefix)
- Price WS (`useStrikeMarketWs.ts:31-33`): `wss://api.strikefinance.org/ws/price`
- User WS (`useStrikeUserWs.ts:40-42`): `wss://api.strikefinance.org/ws/user-api`
- Note: Strike perps do NOT go through the Nexus proxy. `src/api/market-api.ts` (VITE_NEXUS_URL) is for Cardano DEX/token market data, a separate system.

### REST results

| Endpoint | Method | Status | Shape match | Notes |
|---|---|---|---|---|
| `/price/v2/exchangeInfo` | GET | 200 | Yes | Matches `ExchangeInfo`. 14 symbols (ADA/BTC/ETH/HYPE/NEAR/NIGHT/NVDA/SOL/SPCX/WTI/XAG/XAU/XRP/ZEC, all `-USD`). |
| `/price/v2/depth?symbol=SOL-USD` | GET | 200 | Yes | Matches `OrderBookResponse` (`lastUpdateId,E,T,bids,asks`). |
| `/price/v2/trades?symbol=SOL-USD` | GET | 200 | Yes | Matches `TradeResponse[]`. |
| `/price/v2/premiumIndex?symbol=SOL-USD` | GET | 200 | Yes | Matches `PremiumIndexResponse`. No-symbol variant returns array (matches union). |
| `/price/v2/markPrice?symbol=SOL-USD` | GET | 200 | Yes | Matches `MarkPriceResponse` (`e,E,s,p,i,P,r,T`). |
| `/price/v2/indexPrice?symbol=SOL-USD` | GET | 200 | Yes | Matches `IndexPriceResponse` (`e,E,s,p`). |
| `/price/v2/ticker/24hr?symbol=SOL-USD` | GET | 200 | Yes | Matches `Ticker24hrResponse`. |
| `/price/v2/ticker/price?symbol=SOL-USD` | GET | 200 | Yes | Matches `TickerPriceResponse`. No-symbol returns array. |
| `/price/v2/ticker/bookTicker?symbol=SOL-USD` | GET | 200 | Yes | Matches `BookTickerResponse`. |
| `/price/v2/openInterest?symbol=SOL-USD` | GET | 200 | Yes | Matches `OpenInterestResponse`. |
| `/price/v2/klines?symbol=SOL-USD&interval=1h` | GET | 200 | Partial | Returns Binance array-of-arrays (12 cols), NOT the object `StrikeKline`. Consumer `usePerpsChart.ts:111-112` already maps the array, so runtime is fine. |
| `/v2/markets` (auth base, no `/price`) | GET | 200 | Yes | Matches `StrikeMarketsResponse` (`{markets:{SYMBOL:{...}}}`). Public, no auth needed. |
| `/price/v2/markPrice?symbol=FAKE-USD` | GET | 400 | Yes | `{code:INVALID_SYMBOL}` — expected error path. |
| `/price/v2/depth` (no symbol) | GET | 400 | Yes | `{code:MISSING_PARAMETER}` — expected error path. |

### WebSocket results

| Endpoint | Check | Result | Notes |
|---|---|---|---|
| `wss://api.strikefinance.org/ws/price` | HTTP Upgrade | 101 Switching Protocols | Live. |
| `wss://api.strikefinance.org/ws/price` | subscribe + receive | OK | Sub ack `{"id":1,"result":null}` (code ignores), then live `24hrMiniTicker` events with `e`/`s` fields — matches `routeEvent()`. |
| `wss://api.strikefinance.org/ws/user-api` | HTTP Upgrade | 101 Switching Protocols | Live. Auth/data flow not tested (requires Ed25519 session.logon; out of read-only scope). |

### Bottom line
Every READ endpoint the integration calls is alive and returns the expected shape. No 404/401/dead endpoints among the data reads. Only follow-ups are documentation/type accuracy (symbol suffix and klines type), not connectivity.

---

## Removal map — Midnight
## Midnight Removal Checklist — Gero Wallet 2.7 (branch: midnight-csp-indexer-host)

### Key finding
Midnight is **not wired into any user-facing surface** on this branch. No routes, nav, chain/network registry, stores, background handlers, onboarding, i18n, deps, or manifest CSP/host_permissions reference it. The carousel item id `midnight-drop` and `Midnight.png` are **orphans** — no code ever constructs a carousel item with that id (verified in both `PortfolioPage.vue` (the live home route) and `Dashboard.vue` (dead code)). So this is a clean-delete job, not a hide/gate job.

---

### 1. `src/modules/dashboard/components/FeatureCarousel.vue` — EDIT (do NOT delete the file; it is shared)
This component is imported by both `PortfolioPage.vue` (live `/` route) and `Dashboard.vue` (dead code). Only strip the Midnight-specific bits.

- **Line 184** — `if (item.id === 'midnight-drop') classes.push('midnight-background');`
  Dead branch (no item ever has id `midnight-drop`). **Delete the line.**
- **Lines 407-410** — `/* Midnight specific styles */` + `.midnight-background { background: linear-gradient(...); }`
  Orphan CSS class only referenced by line 184. **Delete the comment + rule.**
  - Note: the adjacent `.apex-welcome-background` (lines 412-415) is an identical gradient but is a SEPARATE, still-used class (`apex-welcome` id, line 185). Leave Apex alone.

### 2. `src/assets/Midnight.png` — SAFE TO DELETE
Not referenced anywhere in `src` (grep for `Midnight.png` / `Midnight` returns only the FeatureCarousel CSS comment). Pure orphan asset. **Delete the file.**

### 3. `src/shared/utils/resolver.ts` — EDIT (NIGHT token icon override)
- **Line 356-358** — `TOKEN_IMAGE_OVERRIDES: Record<string,string> = ... { 'NIGHT': assetsModule.nightTokenSvg }`
  This is the only object entry, so removing `'NIGHT'` leaves an empty map. `applyTokenImageOverride()` (lines 364-367) still works correctly against an empty map (returns original image), so this is safe.
  **Recommendation for 2.7:** if you want NIGHT to stop getting a custom icon, change the map to `{}`. The override mechanism is generic and may be reused for other tokens later, so keep `applyTokenImageOverride` and the (now-empty) `TOKEN_IMAGE_OVERRIDES`. If you prefer minimal churn, this entry is harmless to LEAVE (it only swaps an icon for a token named "NIGHT" if one ever appears in the user's assets).

### 4. `src/utils/assets.ts` — EDIT/optional (only if removing #3)
- **Line 90** — `import nightTokenSvg from '@/assets/svg/night-token.svg'`
- **Line 180** — `nightTokenSvg,` (re-export in the assets object)
  Only consumer is `resolver.ts:357`. If you delete the NIGHT override in #3, also remove these two lines, otherwise leave them.

### 5. `src/assets/svg/night-token.svg` — SAFE TO DELETE (only if removing #3 and #4)
Backing asset for `nightTokenSvg`. Delete only after removing the import in #4, otherwise the build breaks.

---

### Confirmed NEGATIVE (no action needed)
- `extension/manifest.json` and `scripts/manifest.ts` — **no** Midnight host_permissions / CSP / matches.
- `package.json` — **no** `@midnight-ntwrk` or midnight dependency.
- `src/plugins/i18n/us.ts` + `de.ts` — **no** Midnight i18n keys.
- Router, NavigationDrawer, stores, background handlers, onboarding/welcome — **no** Midnight code.
- `PortfolioPage.vue` (live home) and `Dashboard.vue` (dead) — **no** Midnight carousel item is ever built.

### False positives (ignore)
- `src/shared/utils/walletNameGenerator.ts:16` — the word "Knight" (substring "night"), unrelated.
- `.worktrees/**`, `.claude/skills/**` (midnight skill docs, ui-ux-pro-max csv) — not shipped code; out of scope per instructions.

---

## Removal map — Bitcoin + dependents
## Bitcoin HIDE+GATE blast radius — gerowallet

Strategy: keep all code, sever USER ACCESS at the chain registry plus a few direct-URL/dApp surfaces. The registry is the master switch; the rest are belt-and-suspenders.

### Tier 1 — The single master gate (do this first)

#### `src/utils/networks.ts`
- **Lines 236-333**: the two Bitcoin entries (`Bitcoin Mainnet`, `Bitcoin Testnet`). Remove both objects from the `networks` array (or wrap them out behind a build/feature constant). This is the ONE edit that:
  - Removes BTC from the create-wallet picker (`CreateWallet.vue` `mainnetNetworks`/`testnetNetworks` filter `networks.networks`).
  - Removes BTC from restore (`RestoreWallet.vue`) and hardware pairing (`PairHardwareWallet.vue`).
  - Removes BTC from the options `NetworkSelector.vue` (`v-for in networks.networks`).
  - Turns off thorchain/ordinals/gomining/babylon/mempool/lightning everywhere, because `resolveThorchainSupport`/`resolveOrdinalsSupport`/`resolveGoMiningSupport`/`resolveBabylonSupport`/`resolveMempoolSupport`/`resolveLightningSupport` (lines 404-439) only ever return true for the Bitcoin entries.
  - Makes `resolveNetwork('Bitcoin', …)` return undefined, so any stored BTC wallet drops out of every list that filters by `resolveNetwork`.
- **Line 6**: `import bitcoinLogo` becomes unused after removal — leave it or delete; either compiles. Keeping it is fine for HIDE+GATE (code-in-repo).
- Safe because every consumer defaults to `networks.networks[0]` (Cardano Mainnet) and nothing indexes a BTC slot (verified: RestoreWallet:456/479, PairHardwareWallet:356/376, CreateWallet:351/392, Welcome:81, NetworkSelector:53).

### Tier 2 — Direct-URL route hardening (real gap)

#### `src/modules/navigation/router.ts`
- **Lines 383-390** (`routeNetworkGuards`): currently only gates cashback/governance/staking/market/transactions/card. The BTC-only routes — `gomining` (240-247), `babylon` (248-256), `ordinals` (257-265), `thorchain` (266-274), `mempool` (275-283), `lightning` (284-292) — have NO guard, so they are reachable by typing `#/thorchain` etc. even with the nav hidden. Add guards: e.g. `gomining: (c,n)=>networks.resolveGoMiningSupport(c,n)`, `babylon: (c,n)=>networks.resolveBabylonSupport(c,n)`, `ordinals: (c,n)=>networks.resolveOrdinalsSupport(c,n)`, `thorchain: (c,n)=>networks.resolveThorchainSupport(c,n)`, `mempool: (c,n)=>networks.resolveMempoolSupport(c,n)`, `lightning: (c,n)=>networks.resolveLightningSupport(c,n)`. With Tier 1 done these all return false → redirect to `/`.
- **Lines 319-321** (`isRouteUnderMaintenance` `gomining` case): already returns `!isGoMiningEnabled()`. Keep; combined with the FF (Tier 3) gomining is double-gated.

### Tier 3 — Feature flag (defense in depth)

#### `src/stores/featureFlagsStore.ts`
- **Lines 9, 26, 66, 86-88, 125-127, 146**: `isGoMiningEnabled`. Already defaults `false` and only flips true via LaunchDarkly `isGoMiningEnabled`. To force-off regardless of remote flag, hardcode `isGoMiningEnabled(): boolean { return false; }` (line 125-127) or stop loading the flag (line 66). Not strictly required once the network entry is gone, but cheap and explicit.

### Tier 4 — dApp provider surface (extension advertises BTC to web pages)

#### `src/chrome/inject.ts`
- **Lines 113-132**: `window.gero_btc` (Tomo provider) — injected into every page. Wrap in a `const BITCOIN_DAPP_ENABLED = false` guard so it is not defined.
- **Lines 308-329**: `_registerGeroWalletStandard()` — registers BTC features via Wallet Standard. Gate the IIFE behind the same flag.
- **Lines 335-348**: `_registerBtcProvider()` (WBIP-004 `window.btc_providers`). Gate likewise.
- Note: the background `BITCOIN_METHOD.*` handlers (background.ts:2617+) already reject with "Not a Bitcoin wallet" when `currentWallet.chain !== Blockchain.BITCOIN`, so connect attempts fail safely even if you skip this — but the cleanest HIDE stops advertising at the injector.

#### `src/chrome/webpage.ts`
- **Lines 206-296**: the Unisat-compatible `window`-side BTC API surface that proxies `BITCOIN_METHOD.*`. Optional to gate; it is only reachable if a page already discovered the provider (gated in inject.ts). Leave for code-in-repo; gate only if you want zero BTC API symbols on the page.

### Tier 5 — Cosmetic / already-gated (no functional edit needed, listed for completeness)

- `src/modules/welcome/views/Welcome.vue` **lines 16-20**: Bitcoin cross-fade background `<img>` keyed on `selectedNetwork.blockchain.includes('Bitcoin')`. Never active once BTC is gone. Optional to delete.
- `src/modules/navigation/components/NavigationDrawer.vue` **lines 344-387**: gomining/babylon/ordinals/thorchain/mempool/lightning nav items — all `enabled: networks.resolve*Support(...)` → false after Tier 1. **No edit needed.** (Also the BTC-specific active-class styling lines 44, 297-299, 638-706 go inert.)
- `src/modules/navigation/components/QuickActionsBox.vue` **lines 163-167, 215**: `BitcoinSendDialog` rendered only when `isBitcoin`. Inert after Tier 1. Static import stays (code kept). **No edit needed.**
- `src/sidepanel/router.ts` / `useChainContext.ts` / `BottomNav.vue`: sidepanel is Cardano/Apex-only; no BTC routes. **No edit needed.**
- Dashboard/dialog BTC branches — `BuyDialog.vue` (61-79,186-275), `ReceiveDialog.vue` (whole BTC block), `ContentLayout.vue` (11-20,339,456-498), `BitcoinSendDialog.vue`, `BitcoinReceiveDialog.vue`, `BitcoinTransactionDetailsDialog.vue`, `BitcoinSignPsbt.vue`: all key off `loggedWallet.chain === Blockchain.BITCOIN`. Unreachable. **No edit needed.**
- Background/services BTC handlers — `background.ts` (1883-2095, 2474-2718), `walletBg.ts` (132-1172), `sync.service.ts` (34,112), `walletManager.service.ts` (197-473), `priceStore.ts` (67-176), `walletStore.ts` (63-275): all `chain === Blockchain.BITCOIN`-guarded. Dead at runtime, compile clean. **No edit needed.**
- `src/services/walletConnect/chainUtils.ts` (11-94): BTC CAIP-2/method tables; `getSupportedChains(chain,network)` only emits the logged wallet's own chain, so a Cardano wallet never offers BTC. **No edit needed.**
- `src/models/types.ts` (83 `CoinTypes.BITCOIN`, 109 `Blockchain.BITCOIN`): enum/constant — MUST stay (referenced by all the guards above). **Do NOT remove.**
- i18n `src/plugins/i18n/us.ts` + `de.ts` (`navigation.thorchain/ordinals/goMining/babylon/mempool/lightning`, `bitcoin.*`, `gomining.*`, `welcome.installBitcoinApp`): only rendered on now-unreachable surfaces. Leave in place.
- `src/utils/assets.ts` (3,387 `bitcoinBg`), `src/assets/bitcoin-logo.svg`, `bitcoinBg.png`: keep (referenced by code-in-repo).

### Breakage risks

1. **Direct-URL access to BTC modules (CONFIRMED GAP, must fix):** router.ts `routeNetworkGuards` omits gomining/babylon/ordinals/thorchain/mempool/lightning. Hiding nav alone does NOT block `#/thorchain`. Tier 2 closes this. The lazy-import chunks (router.ts:29-34) would still load on direct hit and could throw on a Cardano wallet.
2. **Stored BTC wallets vanish (expected, low):** after Tier 1, `resolveNetwork` returns undefined for chain='Bitcoin', so existing BTC wallets are filtered out of Welcome (Welcome.vue:92-96), GoogleLogin (107), and WalletsListLogin. Encrypted records remain on disk; acceptable for HIDE. If a BTC wallet is the last-logged wallet, confirm login restore path tolerates an unresolved network (it defaults to Cardano-shaped logic; the `chain==='Bitcoin'` guards remain in walletStore so it won't crash, but the wallet is simply inaccessible from the UI).
3. **dApp BTC discovery (low):** without Tier 4, `inject.ts` keeps advertising Gero as a BTC wallet to every page; connect attempts fail at the background guard ("Not a Bitcoin wallet"). Functionally safe but leaks BTC capability. Tier 4 removes the advertisement.
4. **No compile-time break from registry removal:** verified every `networks.networks[0]` default is Cardano Mainnet; no code indexes a Bitcoin position; `Blockchain.BITCOIN` constant retained so all guard expressions still type-check.

### Minimal recommended set (least risk, hides everything)
1. `src/utils/networks.ts` — remove the 2 Bitcoin entries (lines 236-333).
2. `src/modules/navigation/router.ts` — add the 6 missing route guards (lines 383-390).
3. `src/chrome/inject.ts` — gate the 3 BTC provider registrations (113-132, 308-329, 335-348).
4. `src/stores/featureFlagsStore.ts` — force `isGoMiningEnabled()` false (125-127).

Everything else is already gated by `loggedWallet.chain === Blockchain.BITCOIN` and goes dead automatically.

---

## Removal map — Pool Operator
## Pool Operator (SPO) Removal - HIDE+GATE (2.7)

A. featureFlagsStore.ts:132 - hard-pin isPoolOperatorEnabled() to false.
B. NavigationDrawer.vue:333 - set nav item enabled false (mirrors multisig 334) or delete.
C. router.ts:102-110 route gated via isRouteUnderMaintenance(323-325); router.ts:399 GAP - make poolOperator redirect unconditionally.
D. ContentLayout.vue:548-565 polls SPO nodes ungated; 132-174 KES bell deep-links to route - gate behind flag.
E. RETAINED: pool-operator module 20 files, poolOperatorStore.ts, spo-api.ts, usePool composables, background.ts handlers, MessageTypes.ts:29-30, i18n 217 keys, useFeatureNotifications.ts:47.</parameter>
</invoke>

