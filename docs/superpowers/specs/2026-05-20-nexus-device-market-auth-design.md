# Nexus Device-Authenticated Market Data Access — Design

**Date:** 2026-05-20
**Status:** Approved
**Repos:** `nexus` (Java/Spring backend), `gerowallet` (Chrome extension client)

## Context

The gerowallet extension consumes market data (token prices, charts, DEX, NFT,
wallet PnL) from `cardano-market-data` directly:

- REST: `market-api.ts` → `https://market.gerowallet.io/api/v1/{market,prices,dex,nft,wallet}/**`
- WS: `useMarketData.ts` → SockJS+STOMP to `https://market.gerowallet.io/ws/market`,
  topic `/topic/market/prices`

The product direction is: **nexus is the single proxy for market data.** The
extension must stop calling `market.gerowallet.io` and route everything through
`https://nexus.gerowallet.io`.

### The blocker

Nexus already proxies the market service at identical paths (REST
`/api/v1/{market,prices,dex,nft,wallet}/**`, WS `/ws/market`), so routing is a
host swap. But nexus market routes require **API-key auth + a paid plan tier**:

- REST `/api/v1/market/**` — `@PreAuthorize("@securityExpressions.canReadMarketData()")`;
  `canReadMarketData()` resolves tier only from an `ApiKeyPrincipal`. A
  `DevicePrincipal` → empty tier → `false` → **403**.
- WS `/ws/market` — `MarketDataWsHandshakeInterceptor` resolves the token only via
  `apiKeyLookupService.findByKeyHash(...)`. A device JWT is not an API key → **401**.

The extension authenticates to nexus with the **device-id JWT** scheme
(`nexusDevice.service.ts` → `POST /api/auth/device` → `DevicePrincipal`), already
used by `nexus-tx-api` / `nexus-collateral-api`. Market routes do not accept it.

## Goals

- Device-authenticated clients can call nexus market REST + WS.
- gerowallet routes all market data through nexus; `market.gerowallet.io` is never
  called from the extension again.
- Abuse friction: `Origin` allowlist check + rate limits.
- API-key (third-party customer) behaviour on market routes is unchanged.

## Non-goals

- Preventing market-data scraping. See **Security posture** below — this is not
  achievable for a publicly distributed client and is explicitly out of scope.
- Per-device tiers / billing.
- iOS app integration (the same nexus changes will serve it later; not built here).

## Security posture (explicit)

Device-id is **not an authentication boundary**. `POST /api/auth/device` registers
or authenticates any self-asserted UUID with no attestation; the call is visible in
the shipped extension bundle and the Network tab. Anyone can replay it with `curl`
and mint unlimited tokens. The `Origin` header check is bypassed by any non-browser
client (curl sets `Origin` freely, or omits it).

Therefore nexus market data, once reachable by device auth, is **effectively public
with friction**. Accepted deliberately:

- Market price data is low-sensitivity; the real risk is cost/load.
- `Origin` check + rate limits + monitoring are friction and visibility, not
  prevention.
- `Device.isEnabled()` / `Device.isBlocked()` already exist as a per-device kill
  switch for abuse response.
- Real attestation (Play Integrity / App Attest) is possible only for the iOS app,
  not a Chrome extension — Chrome MV3 has no remote-attestation API.

## Decisions

| # | Decision |
|---|----------|
| D1 | **Devices bypass tier gating.** `canReadMarketData()`/`canStreamMarketData()` return `true` for any enabled `DevicePrincipal`. No plan, no tier lookup. |
| D2 | **Approach: generalize to `AuthenticatedPrincipal`.** Market REST controller + WS handshake accept the common interface and branch on principal type. No parallel device endpoint; no fake-principal shim. |
| D3 | **`Origin` allowlist check** on device-authenticated market requests — defense-in-depth, not security. |
| D4 | **Rate limits** reusing the existing `TokenBucket` primitive — per-deviceId + per-IP. |
| D5 | **`VITE_MARKET_API_URL` retired.** Market base is `VITE_NEXUS_URL`, always. No override, no direct path from the extension — ever. |

## Architecture

```
gerowallet extension
  market-api.ts (REST, axios)  ──┐
  useMarketData.ts (WS, SockJS) ─┤  Bearer <device JWT> / ?access_token=<device JWT>
                                 │  Origin: chrome-extension://<id>
                                 ▼
        nexus  https://nexus.gerowallet.io
          JwtAuthenticationFilter → DevicePrincipal           (REST; already works)
          MarketDataWsHandshakeInterceptor → DevicePrincipal  (WS; NEW device path)
          SecurityExpressions.canRead/StreamMarketData        (NEW device branch → true)
          Origin allowlist check + DeviceRateLimitBuckets     (NEW)
                                 ▼
        cardano-market-data  (REST /api/v1/**, WS /ws/market) — unchanged, unauthenticated, internal
```

REST device auth already produces a `DevicePrincipal` via `JwtAuthenticationFilter`
— no filter-chain change. The WS handshake is the one place that must learn to
parse a device JWT.

## Nexus changes

All paths under `nexus/src/main/java/io/gerowallet/`.

### 5.1 REST market path

- **`controller/marketdata/MarketDataProxyController.java`**
  - `proxy(...)` param `@AuthenticationPrincipal ApiKeyPrincipal` →
    `@AuthenticationPrincipal AuthenticatedPrincipal`.
  - `instanceof` branch:
    - `ApiKeyPrincipal` → unchanged: `user.getId()`, `apiKey.getId()`, `apiKey.getNetwork()`.
    - `DevicePrincipal` → `callerId = device.getId()` (deviceId string), `network = null`.
    - else → 401.
  - `@PreAuthorize("@securityExpressions.canReadMarketData()")` annotation unchanged
    (the expression gains the device branch).
- **`facade/MarketDataProxyFacade.java`** — `forward(...)`:
  - `UUID userId` → `String callerId`; `Network keyNetwork` → nullable.
  - Blueprint network-scope check (`/api/v1/blueprints`) applies only when
    `keyNetwork != null` (i.e. API-key principals). Devices carry no network scope
    and reach all market routes.
  - Upstream headers: `X-Nexus-User-Id` = `callerId`; add
    `X-Nexus-Caller-Type: DEVICE|API_KEY`.

### 5.2 `security/SecurityExpressions.java`

- Add `getCurrentDevicePrincipal()`, mirroring `getCurrentApiKeyPrincipal()`.
- `canReadMarketData()` / `canStreamMarketData()`: if the current principal is an
  enabled `DevicePrincipal` → return `true`. Otherwise fall through to the existing
  `currentUserTier()` logic (unchanged, API-key only).

### 5.3 WS market path

- **`ws/marketdata/MarketDataWsHandshakeInterceptor.java`**
  - Inject `JwtTokenProvider` + `DeviceDetailsService`.
  - New auth resolution: a token containing `.` is treated as a JWT → validate via
    `JwtTokenProvider`; `authType == DEVICE` → load `DevicePrincipal` via
    `DeviceDetailsService`; validate `isEnabled()`, `isAccountNonLocked()`,
    tokenVersion. Otherwise → existing API-key hash lookup.
  - Token sources unchanged: `?access_token=` query param or
    `Authorization: Bearer`.
  - Device branch: no tier check, no per-key WS package, no monthly message quota.
    Concurrent-connection cap per deviceId from config (default 5).
  - `Origin` check applied here for device principals (see 5.4).
  - Handshake attributes: replace `ATTR_USER_ID` (UUID) + `ATTR_API_KEY_ID` with
    `ATTR_CALLER_ID` (String) + `ATTR_CALLER_TYPE` (`DEVICE`/`API_KEY`); keep
    `ATTR_PLAN_CAPS`, `ATTR_UPSTREAM_BASE_URL`.
- **`service/marketdata/WsSessionTracker.java`** — `ConcurrentHashMap<UUID,_>` →
  `<String,_>`; methods take `String`. Deprecated `UUID` overloads delegate via
  `toString()`.
- **`service/marketdata/WsQuotaService.java`** — `tryRecordMessage(String callerId,
  CallerType type)`: `API_KEY` → existing `userRepository.tryIncrementWsMessages`;
  `DEVICE` → return `true` (no quota). Deprecated `UUID` overload kept.
- **`ws/marketdata/MarketDataWsRelayHandler.java`** — read `ATTR_CALLER_ID` /
  `ATTR_CALLER_TYPE`; `UpstreamStompSession` stores `callerId:String` +
  `callerType`; session-tracker and quota calls use the string id.
- **`ws/marketdata/MarketDataWsConfig.java`** — no change (same interceptor, now
  device-aware).
- **`config/SecurityConfig.java`** — no change (`/ws/market/**` already `permitAll`;
  `JwtAuthenticationFilter` already routes device JWTs for REST).

### 5.4 Origin check

- New config `market-data.device.allowed-origins` — list of
  `chrome-extension://<id>` (initial: `chrome-extension://bgpipimickeadkjlklgciifhnalhdjhe`).
- Applies to device-authenticated market requests, REST and WS handshake:
  - `Origin` present and scheme `chrome-extension://` → must be in the allowlist,
    else **403**.
  - `Origin` absent or non-extension scheme (native apps) → allowed.
  - Rejections logged.
- REST: enforced in the device branch of `MarketDataProxyController` /
  `MarketDataProxyFacade`. WS: in the device branch of the handshake interceptor.
- Documented in code as defense-in-depth, not a security boundary.

### 5.5 Rate limiting

- Reuse `billing/enforcement/TokenBucket` (rps + burst, single-instance).
- New `DeviceRateLimitBuckets` — Caffeine `Cache<String, TokenBucket>`, parallel to
  `RateLimitBuckets` but String-keyed; separate buckets for per-deviceId and per-IP.
- Enforced on:
  - `POST /api/auth/device` and `/api/auth/device/refresh` — **per-IP only** —
    caps token minting.
  - Device market REST routes — per-deviceId + per-IP.
  - WS handshake (connection attempts; not per-message — relay is upstream push)
    — per-deviceId + per-IP.
- Exceed → **429**.
- Config keys + approved defaults:

  | Scope | rps / burst |
  |---|---|
  | Market REST, per-device | 10 / 20 |
  | Market REST, per-IP | 50 / 100 |
  | `/api/auth/device`, per-IP | 2 / 10 |
  | WS handshake, per-device | 1 / 5 |
  | WS handshake, per-IP | 10 / 20 |

  > No per-device limit on `/api/auth/device`: a per-deviceId bucket only
  > constrains an endpoint hit repeatedly with the *same* id. The minting
  > endpoint is precisely where an attacker uses a fresh deviceId per call, so
  > each id is seen once and the bucket never fills. Per-IP is the meaningful
  > control there. Per-device applies where the id repeats — market routes and
  > WS reconnect.

- Single-instance only, consistent with existing `TokenBucket`/`RateLimitBuckets`.
  Redis/Bucket4j upgrade noted as future work, not in scope.

## gerowallet changes

All paths under `gerowallet/src/`.

- **`.env`, `.env.beta`, `.env.development`, `.env.production`, `.env.example`** —
  remove `VITE_MARKET_API_URL`. Market base resolves to `VITE_NEXUS_URL`.
- **`api/market-api.ts`**
  - `baseURL` → `import.meta.env['VITE_NEXUS_URL']`.
  - Request interceptor: attach `Authorization: Bearer <token>` from
    `getNexusAccessToken()` (reuse `services/nexusDevice.service.ts`).
  - Response interceptor: on 401, `reauthenticateNexus()` and retry once — mirror
    `api/nexus-tx-api.ts`.
- **`modules/market/composables/useMarketData.ts`**
  - `MARKET_API_BASE` → `VITE_NEXUS_URL`.
  - WS: SockJS cannot set headers → pass the device JWT as a query param:
    `${base}/ws/market?access_token=<deviceJWT>`. Fetch the token via
    `getNexusAccessToken()` before opening the socket.
  - On socket close / handshake 401: refresh the token, then reconnect (existing
    5 s backoff).
- `Origin: chrome-extension://<id>` is set automatically by the extension's
  `fetch` and SockJS XHR transport — no client code required.

## Error handling

- REST: device disabled/blocked → 401 (`JwtAuthenticationFilter`); rate limit →
  429; origin reject → 403.
- WS: handshake failure → connection closed with the matching status (401 auth /
  403 origin / 429 rate). Client reconnects with backoff and refreshes the token on
  401.
- All nexus device branches are `instanceof`-guarded — no `getApiKey()` /
  `getUser()` call on a `DevicePrincipal`.

## Testing

- **Nexus (unit):** `canReadMarketData()` / `canStreamMarketData()` return `true`
  for an enabled device and unchanged for API keys; handshake interceptor accepts a
  device JWT and still accepts an API key; `WsSessionTracker` counts string keys;
  rate limiter returns 429 past threshold; origin allowlist returns 403 for a
  non-listed `chrome-extension://` origin and allows absent/native origins.
- **Nexus (integration):** device JWT → `GET /api/v1/market/prices` → 200; missing
  or invalid token → 401.
- **gerowallet:** `market-api` requests carry `Authorization: Bearer` and re-auth
  once on 401; `useMarketData` WS connects with `?access_token` and refreshes the
  token on reconnect.

## Rollout

1. Ship nexus changes; verify device JWT reaches market REST + WS in staging.
2. Ship gerowallet changes pointing at nexus.
3. `cardano-market-data` stays internal/unauthenticated behind nexus — no change.

## File change summary

**Nexus** — `controller/marketdata/MarketDataProxyController.java`,
`facade/MarketDataProxyFacade.java`, `security/SecurityExpressions.java`,
`ws/marketdata/MarketDataWsHandshakeInterceptor.java`,
`ws/marketdata/MarketDataWsRelayHandler.java`,
`service/marketdata/WsSessionTracker.java`,
`service/marketdata/WsQuotaService.java`, `config/MarketDataProperties.java`
(device origin + rate-limit config), new `DeviceRateLimitBuckets` +
rate-limit/origin enforcement for `/api/auth/device` and market routes,
`application.yml` (config + defaults).

**gerowallet** — `api/market-api.ts`, `modules/market/composables/useMarketData.ts`,
`.env*` (remove `VITE_MARKET_API_URL`).
