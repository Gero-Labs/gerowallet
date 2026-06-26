# Market-Data Parity Report — cardano-market-data vs Gero Dashboard

_Generated 2026-06-24 from workflow wf_fd030b57-4b3 (gero-2.7-audit)._

> PARITY VERDICT: NOT AT PARITY — the canonical market-data website is a materially richer trading terminal than the Gero dashboard. Gero is roughly at parity on the token-detail chart/TA and P&L surfaces (and is actually a superset on TA indicators and on the holdings/P&L columns the website lacks), but it is missing the website's entire discovery layer (market stat bar, trending strip, fear/greed, bubbles/RSI-map views, category filter), six token-table columns (30D change, sparkline, Vol 7D, TXN count, Maker count, Supply), the dashboard-wide currency denominator, and the four richest token-detail panels (Holders, Top Traders, Liquidity Providers, cross-DEX Markets). It also has formatting drift (compact dp, micro-price subscript notation, detail-panel % precision) that causes visible value differences for the same metric. Counts: (A) MISSING = 16, (B) EXTRA = 4, (C) MISMATCHED = 6, (D) ENDPOINT/SOURCE = 4. Total 30 gaps.

---

# Market-Data Parity Gap Report — Website (source of truth) vs Gero Dashboard

**Source of truth:** `cardano-market-data` (Spring backend `io.gerowallet.cardano.controller.*` + Next.js frontend `frontend/src/components/market/*`, `app/*`).
**Subject:** Gero wallet dashboard market surface (`src/modules/portfolio/PortfolioPage.vue`, `src/modules/market/*`, `src/api/market-api.ts`).

**Headline:** Gero reaches parity on the token-detail candle chart, TA overlays and wallet P&L (and exceeds the site on TA indicators + holdings columns), but the website exposes a full discovery/analytics terminal that Gero never surfaces. The same backend powers both, so most gaps are display-side, not data-side.

---

## (A) MISSING in Gero — website shows, Gero does not

### A1. Token-table columns (website `MarketTable.tsx` COLUMNS vs Gero `MarketTokenTable.vue`)
| Website column | Backend field | In Gero table? | Severity |
|---|---|---|---|
| 30D change | `prices.priceChange30d` | No (Gero maps 1h/24h/7d only) | Med |
| Sparkline "Last 7D" | `/api/prices/sparklines` (`SparklineCell`) | No (endpoint not in `market-api.ts`) | Med |
| Vol 7D | `prices.volume7d` | No | Low |
| TXN (txn count 24h) | `prices.txnCount24h` | No | Low |
| Makers (maker count 24h) | `prices.makerCount24h` | No | Low |
| Supply (total supply) | `prices.totalSupply` | No | Low |

Note: website table label "Liquidity" == `tvl` field; Gero already shows TVL, so that one matches.

### A2. Discovery / overview layer (website has, Gero has none mounted)
- **MarketStats bar** (`MarketStats.tsx`): Tokens count, Total MCap, 24h Volume, Gainers count, Losers count, New count. Gero has a dead `MarketStatBar.vue` (different shape) imported by nothing. Severity: Med.
- **TrendingStrip / MarketDiscovery tabs** (All / Trending / Gainers / Volume / snek.fun) + **CategoryDropdown** filter. Gero only has holdings/market/watchlist. Severity: Med.
- **FearGreedWidget**, **BubblesView**, **RsiMapView** (RSI heat map fed by `/api/prices/rsi`). Gero surfaces none; `/api/prices/rsi` and `/api/prices/sparklines` are not even in `market-api.ts`. Severity: Low–Med.

### A3. Token-detail panels (website `app/token/page.tsx` tabs vs Gero `TokenDetailPanel.vue`)
| Website panel | Backend endpoint | In Gero? | Severity |
|---|---|---|---|
| Holders | `/api/dex/tokens/{policy}/{name}/holders` | No (Gero shows a holders *count* only) | Med |
| Top Traders | `/api/dex/tokens/{policy}/{name}/top-traders` | No | Low |
| Liquidity Providers | `/api/dex/pools/{poolId}/lp-holders` | No | Low |
| Markets (cross-DEX price table) | `/api/market/prices/{id}/all` | No (Gero has dead `CrossDexPrices.vue`) | Med |
| FDV stat tile | `totalSupply × priceUsd` | No (Gero has no FDV) | Low |

### A4. Whole pages with no Gero equivalent
- **Live feed** (`app/live` ← `/api/dex/swaps/recent`) — global cross-token swap stream. Gero only has per-token RecentTrades. Severity: Low.
- **Leaderboard** (`app/leaderboard` ← `/api/leaderboard`) — LP-TVL wallet ranking. Severity: Low.
- **ADA page** (`app/ada` ← `/api/market/ada` + `/api/prices/ada/candles`) — dedicated ADA chart/stats. Gero shows ADA as a pinned row only. Severity: Low.
- **Currency-rate surface** (`/api/prices/currency-rate`: ADA in EUR/GBP/JPY/BTC + 24h/7d/30d historical ADA/USD). Gero only does USD/EUR. Severity: Low.

### A5. Dashboard-wide currency denominator
Website `MarketDataContext` `conv` re-denominates the **entire table** (price, vol, TVL, mcap) into the selected currency via `CurrencySelector`. Gero only toggles currency inside `TokenDetailPanel`; the table is fixed USD (+native sub). Severity: Med.

---

## (B) EXTRA in Gero — Gero shows, website does not (mostly intentional, wallet-specific)
| Gero metric | Where | Website equivalent? | Intentional? |
|---|---|---|---|
| Holdings columns: Owned badge, Allocation %, Balance, Value, Avg cost, Total P&L | `MarketTokenTable.vue` | None (site is not wallet-aware) | Yes — wallet feature, keep |
| Portfolio P&L summary + value chart | `PortfolioChart.vue` (`/api/wallet/{stake}/pnl`,`/history`) | None | Yes — keep |
| Xerberus risk badge (letter grade, off-market-API) | table + detail | Website uses its own `RiskMeter` from market API | Partial — see D2 |
| MACD 12-26-9 + VOL/SMA/EMA toggles | `TokenDetailPanel` TA | Website menu only offers SMA20/EMA20/BB20-2/RSI14 (no MACD) | Yes — Gero superset, keep |

---

## (C) MISMATCHED — present in both, differ in formatting/calc/precision
| Metric | Website rule | Gero rule | Effect | Severity |
|---|---|---|---|---|
| Compact magnitude | `compact()`: **2dp** for T/B/M, **1dp** for K (`format.ts`) | `formatCompact()`: **1dp** for B/M/K (`formatters.ts`) | Same number renders e.g. `$45.62M` (site) vs `$45.6M` (Gero) for volume/mcap/TVL | Med |
| Micro-cap price | `formatPrice()`: subscript-zero `$0.0₅6735` | `formatPriceRaw()`: plain `0.000007` (6dp), truncates significant digits | Sub-cent tokens look wrong/zeroed in Gero | Med |
| % change precision (detail) | `formatPct()`: **1dp** everywhere | Gero detail uses `toFixed(2)` (2dp) in header chip & P&L, table uses 1dp | Detail shows `+12.34%`, site shows `+12.3%`; inconsistent within Gero too | Low |
| Holders rendering | `formatInt` (`toLocaleString`) in detail; **table column** present | Detail uses `toLocaleString` (match); but Gero puts Holders in the **table** where the site does not | Gero table holders col has no website counterpart | Low |
| TVL label | Website table labels `tvl` as **"Liquidity"** | Gero labels it **"TVL"** | Same field, different header → user confusion when comparing | Low |
| Candle resolution set | Backend supports 15m/1h/1D/1W for tokens; ADA adds 1m/5m/30m/4H | Gero `getCandles` uses token resolutions; verify ADA path requests the wider set | Gero may not offer 1m/5m/4H for ADA chart | Low |

---

## (D) ENDPOINT / SOURCE differences (risk of value drift for the same displayed metric)
| Metric | Website source | Gero source | Drift risk | Severity |
|---|---|---|---|---|
| Apex-chain token prices | n/a (Cardano-only site) | Gero bypasses market API → `coinGeckoStore['apex-4']` | Apex tokens diverge entirely from the canonical pipeline | Med |
| Risk rating | market API `RiskMeter` (site renders its own asset risk) | `xerberusStore.risks[fingerprint]` (separate Xerberus call) | Two different risk engines → different grades for same token | Med |
| Market cap fallback | backend `reliableMarketCap()` suppresses placeholder-supply mcap (DJED/USE/SHEN shown as unknown) | Gero shows `marketCap` with DexHunter `mcap` fallback, no placeholder-supply guard | Gero may show nonsense mcap for placeholder-supply stablecoins | Med |
| Holders / mcap / TVL fallbacks | single backend field | Gero adds DexHunter fallbacks for ticker/name/logo/mcap/holders | Gero rows can show DexHunter-sourced values the site never would | Low |

---

## Priority recommendations to reach dashboard parity
1. **High-value, low-effort:** add the 6 missing table columns (`priceChange30d`, `volume7d`, `txnCount24h`, `makerCount24h`, `totalSupply`, sparkline) — all already returned by `/api/market/prices` except sparkline; wire `getSparklines()` into `market-api.ts` and a `SparklineCell` analog. Rename the TVL header to "Liquidity" to match the site.
2. **Align formatters** (`src/modules/market/utils/formatters.ts`): make `formatCompact` 2dp for B/M, adopt subscript-zero micro-price notation in `formatPriceRaw`, and standardize % to 1dp in `TokenDetailPanel`. This removes the most visible value drift.
3. **Token-detail panels:** mount Holders / Top Traders / Liquidity Providers / cross-DEX Markets tabs (revive the dead `CrossDexPrices.vue` for the last one; add `getTokenHolders`/`getTopTraders`/`getLpHolders` to `market-api.ts`).
4. **Discovery layer:** add a MarketStats bar + Gainers/Losers/Trending tabs to `PortfolioPage.vue` market mode.
5. **Source consistency:** decide whether risk + market-cap should come from the canonical backend (site behavior) rather than Xerberus/DexHunter fallbacks, to eliminate D2/D3 drift.

### Item index

| Sev | Title | Location | Recommendation |
|---|---|---|---|
| Med | 30D price-change column missing from Gero token table | src/modules/market/components/MarketTokenTable.vue + src/modules/market/composables/useMarketData.ts | Add priceChange30d to the MarketToken mapping in useMarketData.ts (field already returned by /api/market/prices) and add a change30d column with formatChange + trend icon in MarketTokenTable.vue. |
| Med | Inline 7D sparkline column missing | src/api/market-api.ts + MarketTokenTable.vue | Add getSparklines(window) to market-api.ts hitting /api/prices/sparklines, then render a small sparkline cell per row (reuse lightweight-charts or an svg polyline). |
| Low | Vol 7D / TXN count / Maker count / Total Supply columns missing | useMarketData.ts + MarketTokenTable.vue | Extend the MarketToken interface/mapping with volume7d, txnCount24h, makerCount24h, totalSupply and add the corresponding columns (formatCompact for volume, formatInt for counts). |
| Med | No market overview stat bar (Total MCap / Volume / Gainers / Losers / New) | src/modules/portfolio/PortfolioPage.vue (market mode); dead component src/modules/market/components/MarketStatBar.vue | Mount a stat bar in PortfolioPage market mode computing aggregates over the loaded MarketToken list (mirror MarketStats.tsx); reuse or replace the dead MarketStatBar.vue. |
| Med | No discovery tabs (Trending / Gainers / Volume) or category filter | PortfolioPage.vue view-mode switch | Add Trending/Gainers/Volume sub-filters to the market view (client-side sort/filter over existing MarketToken data — trendScore = volume24h*(1+abs(change)/100) as the site does); optionally a category dropdown if categories are returned. |
| Low | Fear & Greed, Bubbles, and RSI heat-map views absent | src/modules/market/* (no equivalents); market-api.ts missing /api/prices/rsi | If desired for parity, add getRsi(resolution) to market-api.ts and build an RSI map / bubbles visualization; lowest priority of the discovery gaps. |
| Med | Token-detail Holders list panel missing | src/modules/market/components/TokenDetailPanel.vue + market-api.ts | Add getTokenHolders(policy,name,limit) to market-api.ts and a Holders tab/panel in TokenDetailPanel.vue; handle the 503 Retry-After 'computing' response the backend documents. |
| Low | Token-detail Top Traders panel missing | TokenDetailPanel.vue + market-api.ts | Add getTopTraders(policy,name,limit) to market-api.ts and a Top Traders tab in the detail panel. |
| Low | Token-detail Liquidity Providers panel missing | TokenDetailPanel.vue + market-api.ts | Add getLpHolders(poolId,limit) to market-api.ts and an LP Providers tab; reuse the pool resolution already done for DepthChart/OrderBookTable. |
| Med | Cross-DEX Markets price table missing (dead component exists) | TokenDetailPanel.vue; dead component src/modules/market/components/CrossDexPrices.vue; market-api.ts getTokenPricesAcrossDexes (already implemented, unused) | Mount CrossDexPrices.vue as a Markets tab in TokenDetailPanel.vue wired to getTokenPricesAcrossDexes; near-zero new code since both pieces exist. |
| Low | FDV stat tile missing on token detail | TokenDetailPanel.vue info grid | Add an FDV tile computed from totalSupply x price (requires mapping totalSupply, see A1); show '-' when supply unknown. |
| Low | No global live swaps feed | src/modules/market/* (no equivalent); market-api.ts | Optional: add getRecentSwaps(limit) to market-api.ts and a global live-feed widget; also note the website table uses this feed to drive per-row buy/sell flash animations that Gero lacks. |
| Low | No LP-TVL wallet leaderboard | Gero (no equivalent) | Low priority; add only if the wallet wants a DeFi leaderboard surface. |
| Low | ADA dedicated page + extended currency rates not surfaced | PortfolioPage.vue / TokenDetailPanel.vue; market-api.ts missing /api/prices/currency-rate | Optional: add getCurrencyRate() to market-api.ts to support more fiat denominations; add an ADA detail view if desired. |
| Med | Currency denominator is table-wide on website, detail-only in Gero | PortfolioPage.vue / MarketTokenTable.vue vs website MarketDataContext conv + CurrencySelector | Lift the currency selection to the market view level and apply a conv-style converter across all numeric columns, matching the website's MarketDataContext pattern. |
| Med | Compact-number decimal places differ (M/B at 1dp vs 2dp) | src/modules/market/utils/formatters.ts (formatCompact) vs frontend/src/lib/market/format.ts (compact) | Change formatCompact to 2dp for B and M (keep 1dp for K) to match the website and eliminate visible drift on volume/mcap/TVL/floor-volume. |
| Med | Micro-cap price notation differs (subscript-zero vs plain 6dp) | src/modules/market/utils/formatters.ts (formatPriceRaw) vs format.ts (formatPrice) | Adopt the subscript-zero formatting in formatPriceRaw for prices < 0.01 (port the algorithm from format.ts) so micro-cap tokens match the website. |
| Low | Detail-panel % precision is 2dp vs website 1dp | TokenDetailPanel.vue (24h chip toFixed(2), P&L toFixed(2)) vs website formatPct (1dp) | Standardize percent display to 1dp in TokenDetailPanel (use formatChange) for internal and cross-site consistency. |
| Low | TVL column labeled 'TVL' in Gero, 'Liquidity' on website | MarketTokenTable.vue header (market.tvl) vs MarketTable.tsx column label 'Liquidity' | Rename the dashboard column header to 'Liquidity' (or add a tooltip clarifying TVL==liquidity) to match the canonical site. |
| Low | ADA candle resolutions may be narrower than backend offers | src/api/market-api.ts getCandles (ADA -> /api/prices/ada/candles) | Expose 1m/5m/30m/4H resolution options for the ADA chart path in TokenDetailPanel when the selected token is ADA. |
| Med | Apex-chain prices bypass the canonical market pipeline | Gero apex wallet path (coinGeckoStore['apex-4']) vs market-api.ts | Where the backend covers the same assets, prefer the market API; otherwise document this as an intentional chain-specific exception so it is not mistaken for drift. |
| Med | Risk grade sourced from Xerberus, not the market backend | MarketTokenTable.vue / TokenDetailPanel.vue (xerberusStore.risks) vs website RiskMeter (market API asset risk) | Decide on a single canonical risk source for parity; if Xerberus is intentional for the wallet, document it so the divergence from the website is expected. |
| Med | Market cap lacks placeholder-supply guard | useMarketData.ts mcap mapping vs backend reliableMarketCap()/hasPlaceholderSupply() | Port the placeholder-supply check (or have the backend flag it) and render '-' for those tokens in the Gero table to match the website. |
| Low | DexHunter fallbacks can introduce values the website never shows | useMarketData.ts (ticker/name/logo/mcap/holders DexHunter fallback) | Prefer backend values and treat DexHunter strictly as a metadata (logo/name) fallback, not a numeric (mcap/holders) fallback, to keep numbers aligned with the source of truth. |

