# Strike Finance Perpetuals — Verification Verdict

_Generated 2026-06-24 from workflow wf_fd030b57-4b3 (gero-2.7-audit)._

> PARTIALLY WORKING — read-only/market surface is solid; the trading surface is not. All public market-data REST + price WebSocket flows are live and shape-correct (verified end-to-end), and the dashboard math layer is textbook-correct. But the authenticated path has not been validated against any spec (device/builder auth, query-string signing, vault auth header are all unverified high-risk assumptions), and the sidepanel trading surface is independently broken: a guaranteed runtime TypeError in the sidepanel OrderBook (subscribeOrderBook does not exist), the account panel reads camelCase fields off a snake_case AccountResponse so it renders permanently blank/0%, vault deposit is a stub that throws, and the sidepanel OrderForm drops TP/SL. Net: a user can browse markets and prices, but cannot be trusted to place/track real orders through the shipped UI, and no authenticated flow has been proven against Strike's live server. Verdict: data/read flows Working; order placement, account, deposit/withdraw, vaults Broken or Unknown.

---

## Strike Finance Perpetuals — Final Verdict

Overall: **PARTIALLY WORKING.** Public market data + price WebSocket = Working (live-verified). Dashboard math = Working. Authenticated trading, account, deposit/withdraw, and vaults = Broken or Unknown. No authenticated request has been validated against Strike's live server (read-only scope) or against the OpenAPI specs (several auth endpoints have zero spec coverage).

### Per-flow verdict

| Flow | Verdict | Evidence |
|---|---|---|
| Device / market auth (Ed25519, builder connect) | **Unknown** | Header scheme + message format match OpenAPI `ApiWalletAuth` and Ed25519 impl is correct (`strike-v2.auth.ts:72`, `strike-v2.types.ts:61`). But `/auth/builder/request-signature` + `/auth/builder/verify-signature` (`strike-v2.builder-connect.ts:89-113`) appear in **no** YAML or guide; request/response shapes unverifiable. Query string is **not** signed: authenticated GETs use relative `config.url` (`/v2/positions`) + a separate axios `params` object (`strike-v2.user.ts:56`); axios serializes params into the URL *after* the request interceptor runs, so `extractPath` (`strike-v2.client.ts:51-65,88`) never sees the query. If Strike signs the full path-with-query, every authed GET-with-params fails auth. User WS upgrades 101 but auth/data flow untested. |
| Market data REST + price WS | **Working** | All 13 read endpoints returned 200 with matching shapes on 2026-06-24 (`exchangeInfo`, `depth`, `trades`, `premiumIndex`, `markPrice`, `indexPrice`, `ticker.*`, `openInterest`, `klines`, `/v2/markets`). Error paths (400 INVALID_SYMBOL / MISSING_PARAMETER) correct. Price WS `wss://api.strikefinance.org/ws/price` upgraded 101, sub-ack + live `24hrMiniTicker` events match `routeEvent()`. WS lifecycle (ref-counted subs, backoff, ping, resubscribeAll) is sound. |
| Symbol / orderbook | **Broken (sidepanel) / Working (dashboard)** | Dashboard `useOrderBook.ts:107` correctly calls `subscribeDepth`. Sidepanel `OrderBook.vue:97,249` calls `subscribeOrderBook`, which **does not exist** — `useStrikeMarketWs.ts:247` only exports `subscribeDepth`. Guaranteed runtime TypeError; sidepanel orderbook never renders. |
| Order placement — limit | **Unknown (dashboard) / Broken (sidepanel)** | Order/cancel/replace paths + bodies match trade YAML; `tp_order`/`sl_order` singular is correct. But numeric-ID type drift (`CancelOrderRequest.order_id` string vs spec integer; `CreateOrderResponse.sequence_id` string vs int64) and unvalidated auth (above) mean placement is unproven. No live mutating test was run. Sidepanel form additionally miscomputes notional/collateral. |
| Order placement — market | **Broken (sidepanel)** | Sidepanel `OrderForm` drops TP/SL and miscomputes market notional/collateral vs the correct dashboard form. Dashboard market path inherits the same Unknown auth risk. |
| Order placement — TWAP | **Unknown** | `/v2/algo/twap` (`strike-v2.trade.ts:108-141`) has **no OpenAPI coverage** anywhere. `TwapOrderDialog` is dead/unwired. Cannot be validated. |
| Positions | **Unknown** | `getPositions` params match user YAML; PnL/liquidation math is correct (`calcLiquidationPriceIsolated/Cross`, hedge-mode-safe). `PerpsPositionsPanel` mark-price subs ref-counted correctly. But depends on the unverified auth path; `symbol_settings` typed as array vs spec's symbol-keyed object map (`strike-v2.types.ts:251` vs `strike-v2-user-api.yaml:235-249`). |
| Order history | **Broken** | History pagination cursors `fromId`/`fromOrderID` exist in spec (`strike-v2-user-api.yaml:1587,1741`) but are absent from `HistoryParams` — pagination not implementable. Sidepanel "load more" is broken. Dead history components (HistoryTabs, tables). |
| Account / collateral | **Broken** | `useStrikeAccount.ts:16-20` reads `account.value?.walletBalance/availableBalance/unrealizedPnl/marginBalance/totalMargin` (camelCase), but `AccountResponse` (`strike-v2.types.ts:238-246`) defines `wallet_balance/available_balance/unrealized_pnl/margin_balance/total_margin` (snake_case). All account computeds resolve to `null`; `marginRatio` always 0 → AccountPanel permanently blank / 0%. (Note: `BalanceResponse` *is* camelCase, so the convention is genuinely mixed.) Collateral/tx-build via nexus (`nexus-tx-api.ts`, `nexus-collateral-api.ts`) is well-structured (proxy injects key, no client auth). |
| Deposit | **Unknown** | Deposit endpoints have no OpenAPI coverage; field names match prose guide only. On-chain build/poll lifecycle uses a generation counter correctly. Direct deposit plausibly works but unproven. |
| Withdraw | **Broken (Cardano)** | `strike-v2.user.ts:121-124` omits the guide-mandated batcher step (`GET /v2/validator/leader` + `POST /api/perpetuals/withdraw-batcher`) before `POST /v2/withdraw`. Cardano withdrawal will not follow the documented flow. |
| Vaults — list / detail | **Working** | Public + authed vault paths/params match `strike-v2-vaults.yaml`. (Auth header-name caveat: vault YAML names timestamp header `X-Api-Wallet-Signature-Timestamp` vs client's `X-API-Wallet-Timestamp`; YAML is stale v1.0.0 on a different host — unverified for authed vault calls.) |
| Vaults — deposit | **Broken** | `useStrikeVaultDeposit.ts:68` is a stub that throws `'Vault deposit quote API not yet available — endpoint TBD'`. Endpoint not implemented. (The UI audit's "credits main account" is the eventual risk if wired naively; today it simply does not function.) |
| Vaults — withdraw | **Unknown** | No dedicated vault-withdraw implementation surfaced; inherits the auth-header and batcher caveats above. |

### Prioritized bug list

**Critical**
1. Sidepanel OrderBook runtime crash — `subscribeOrderBook` undefined (`src/sidepanel/components/perps/OrderBook.vue:97,249`).
2. Account panel always blank/0% — camelCase reads vs snake_case `AccountResponse` (`src/modules/market/composables/useStrikeAccount.ts:16-20`).
3. Authenticated GET query string not signed (`src/api/strike-v2.client.ts:51-65,88` + `src/api/strike-v2.user.ts:56`) — all authed GET-with-params may 401/403.

**High**
4. Sidepanel OrderForm drops TP/SL and miscomputes market notional/collateral (`src/sidepanel/components/perps/OrderForm.vue`).
5. Vault deposit is a throwing stub (`src/modules/market/composables/useStrikeVaultDeposit.ts:58-68`).
6. Cardano withdraw skips the batcher step (`src/api/strike-v2.user.ts:121-124`).
7. Builder-connect endpoints unspecified/unvalidated (`src/api/strike-v2.builder-connect.ts:89-113`).

**Medium**
8. Order history pagination not implementable — missing `fromId`/`fromOrderID` cursors (`src/api/strike-v2.types.ts` HistoryParams; sidepanel load-more).
9. `symbol_settings` typed as array vs spec object map (`src/api/strike-v2.types.ts:251`).
10. Numeric-ID type drift (order_id / sequence_id string vs integer) (`src/api/strike-v2.types.ts`).
11. TWAP unspecified (`src/api/strike-v2.trade.ts:108-141`).

**Low**
12. Vault auth header name drift (`X-API-Wallet-Timestamp` vs spec `X-Api-Wallet-Signature-Timestamp`).
13. Klines returns Binance array-of-arrays vs `StrikeKline` object (consumer already maps it; cosmetic).
14. Dead surface: AccountPanel/PositionsTable/OrdersTable/ClosedPositionsTable/HistoryTabs/TwapOrderDialog/unconsumed math exports.

### To make perps fully working, do this

1. Fix the two guaranteed-crash bugs first: rename sidepanel `subscribeOrderBook` → `subscribeDepth` (or add the missing export), and align `useStrikeAccount` reads to the snake_case `AccountResponse` fields (or normalize the type — and decide one casing convention across Account/Balance).
2. Sign the full path-with-query: build the signed PATH from the final serialized URL (use an axios `paramsSerializer` + compute the signature in an adapter/after-params hook, not the request interceptor), then live-test one authed GET-with-params against Strike.
3. Run a controlled authenticated smoke test (testnet/small size): builder connect → account fetch → place+cancel a limit order → confirm signatures and ID types accepted. This is the only way to resolve the Unknown verdicts.
4. Bring the sidepanel OrderForm to parity with the dashboard form (TP/SL, notional/collateral math) — or have the sidepanel reuse the dashboard components instead of bespoke reimplementations.
5. Implement the Cardano withdraw batcher step and the vault deposit endpoint (replace the throwing stub).
6. Add history pagination cursors; fix `symbol_settings`/numeric-ID types; confirm or remove TWAP and the dead components.

### Item index

| Sev | Title | Location | Recommendation |
|---|---|---|---|
| Critical | Sidepanel OrderBook crashes: subscribeOrderBook is undefined | src/sidepanel/components/perps/OrderBook.vue:97,249 (export: src/modules/market/composables/useStrikeMarketWs.ts:247) | Rename the sidepanel call to subscribeDepth and adapt the delta handler to the depth payload, or add a subscribeOrderBook alias export. Prefer reusing the working dashboard useOrderBook composable instead of the bespoke sidepanel one. |
| Critical | Account panel permanently blank/0%: camelCase reads vs snake_case AccountResponse | src/modules/market/composables/useStrikeAccount.ts:16-20 (type: src/api/strike-v2.types.ts:238-246) | Align the computed reads to the snake_case AccountResponse fields, or normalize AccountResponse at the API boundary. Pick one casing convention and apply it across Account and Balance types. |
| Critical | Authenticated GET query string is not signed | src/api/strike-v2.client.ts:51-65,88 + src/api/strike-v2.user.ts:56 | Compute the signature against the fully serialized URL (path + query). Use a paramsSerializer and sign in an axios adapter or post-params hook rather than the request interceptor, then live-test one authed GET-with-params against Strike to confirm. |
| High | Sidepanel OrderForm drops TP/SL and miscomputes market notional/collateral | src/sidepanel/components/perps/OrderForm.vue | Bring the sidepanel form to parity with the dashboard form (carry tp_order/sl_order, use the shared market-notional/collateral math), or have the sidepanel render the dashboard form component directly. |
| High | Vault deposit is a throwing stub | src/modules/market/composables/useStrikeVaultDeposit.ts:58-68 | Implement the vault deposit-quote endpoint and on-chain credit polling once the Strike vault deposit spec is published; ensure the deposit is attributed to quote.vault_id and not the main account. |
| High | Cardano withdraw skips the mandated batcher step | src/api/strike-v2.user.ts:121-124 | Add the leader lookup + withdraw-batcher call before POST /v2/withdraw for the Cardano chain, per the integrator guide. |
| High | Builder-connect endpoints are unspecified and unvalidated | src/api/strike-v2.builder-connect.ts:89-113 | Obtain the builder-connect spec from Strike and validate the request/response shapes; run a live onboarding test against the server to confirm the envelope and defaults are accepted. |
| Medium | Order history pagination not implementable (missing cursors) | src/api/strike-v2.types.ts (HistoryParams); sidepanel history view | Add fromId/fromOrderID to HistoryParams and thread them through the history API and the sidepanel load-more handler. |
| Medium | symbol_settings typed as array vs spec object map | src/api/strike-v2.types.ts:251 | Re-model symbol_settings as Record<string, SymbolSetting> and align field names (drop symbol, add allow_pre_trade) to match the spec. |
| Medium | Numeric-ID type drift (string vs integer) | src/api/strike-v2.types.ts (CancelOrderRequest.order_id, CreateOrderResponse.sequence_id); src/api/strike-v2.trade.ts (getOrder) | Match the spec integer types (use number, or keep string only if confirmed safe for int64 precision) and verify with a live cancel/get round-trip. |
| Medium | TWAP algo endpoint has no spec coverage | src/api/strike-v2.trade.ts:108-141 | Obtain the TWAP spec and validate, or gate/remove the TWAP feature until it is specified and wired to UI. |
| Low | Vault auth timestamp header name drift | vault auth header (client: src/api/strike-v2.auth.ts / strike-v2.types.ts:61; spec: strike-v2-vaults.yaml:25-33) | Confirm the actual header name Strike's vault host expects via a live authed vault call; only change the header if the live server rejects the current name. |
| Low | Klines returns array-of-arrays vs StrikeKline object (cosmetic) | src/api/strike-v2.types.ts (StrikeKline); consumer usePerpsChart.ts:111-112 | Update the type to the array tuple shape (or document the mapping) to prevent future consumers from mis-reading it as an object. |
| Low | Dead surface: unwired components and unconsumed math exports | src/modules/market/** (components + math) | Either wire these components/exports into the live surfaces (reducing the bespoke reimplementations) or remove them to cut divergence risk. |

