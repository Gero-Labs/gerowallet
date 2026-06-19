# Nexus Device-Authenticated Market Data — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let gerowallet's device-authenticated clients reach the nexus market-data proxy (REST + WS), and switch the extension to call nexus instead of `market.gerowallet.io` directly.

**Architecture:** Nexus market routes are generalized from `ApiKeyPrincipal` to the common `AuthenticatedPrincipal` interface; an enabled `DevicePrincipal` bypasses tier gating. The WS handshake learns to parse a device JWT. An `Origin` allowlist check and per-deviceId/per-IP rate limits (reusing the existing `TokenBucket`) add abuse friction. The extension's `market-api.ts` and `useMarketData.ts` repoint to `VITE_NEXUS_URL` and attach the device JWT.

**Tech Stack:** nexus — Java 21, Spring Boot, Spring Security, JUnit 5 + Mockito + AssertJ, Maven. gerowallet — Vue 2.7 + TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-nexus-device-market-auth-design.md`

**Refinements adopted during planning** (cleaner than the spec sketch; behaviour unchanged):
- `WsSessionTracker` is converted fully to `String` keys — its only two callers (`MarketDataWsHandshakeInterceptor`, `MarketDataWsRelayHandler`) are both updated here, so no deprecated `UUID` overloads are kept.
- `WsQuotaService` is left untouched; `MarketDataWsRelayHandler` branches on caller type and skips the quota call for devices.
- `MarketDataProxyFacade.forward(...)` drops its unused `apiKeyId` parameter.
- No per-device rate limit on `/api/auth/device` (per-IP only) — a per-id bucket cannot constrain an attacker who mints a fresh deviceId per call.

**Repos & paths:**
- nexus — `/Users/dudiedri/IdeaProjects/A.D. Labs/nexus`
- gerowallet — `/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet`

**Branches:** gerowallet work is on `feature/nexus-device-market-auth` (already created). Before Task 1, create `feature/device-market-auth` in the nexus repo:

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && git checkout -b feature/device-market-auth
```

**Test commands:**
- nexus single class — `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=ClassName test`
- gerowallet — `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet" && npm run test -- run <file>` (Vitest), plus `npm run typecheck`

---

## File Structure

**Phase 1 — nexus** (`src/main/java/io/gerowallet/`)

| File | Responsibility | Action |
|---|---|---|
| `config/MarketDataProperties.java` | adds nested `Device` config (origins, rate limits, WS cap) | Modify |
| `service/marketdata/WsSessionTracker.java` | active-session counter, re-keyed `UUID`→`String` | Modify |
| `security/SecurityExpressions.java` | `canRead/StreamMarketData` gain a device branch | Modify |
| `security/DeviceOriginValidator.java` | `chrome-extension://` origin allowlist check | Create |
| `service/marketdata/DeviceRateLimitBuckets.java` | String-keyed `TokenBucket` cache | Create |
| `security/filter/DeviceRateLimitFilter.java` | per-IP / per-device rate limiting filter | Create |
| `facade/MarketDataProxyFacade.java` | REST proxy — string caller id, caller type, origin check | Modify |
| `controller/marketdata/MarketDataProxyController.java` | accepts `AuthenticatedPrincipal`, branches | Modify |
| `ws/marketdata/MarketDataWsHandshakeInterceptor.java` | adds device-JWT auth path | Modify |
| `ws/marketdata/UpstreamStompSession.java` | session holder — `callerId`/`callerType` | Modify |
| `ws/marketdata/MarketDataWsRelayHandler.java` | reads caller attrs, skips device quota | Modify |
| `config/SecurityConfig.java` | registers `DeviceRateLimitFilter` | Modify |
| `resources/application.yml` | `market-data.device.*` config + defaults | Modify |

**Phase 2 — gerowallet** (`src/`)

| File | Responsibility | Action |
|---|---|---|
| `.env`, `.env.beta`, `.env.development`, `.env.production`, `.env.example` | drop `VITE_MARKET_API_URL` | Modify |
| `api/market-api.ts` | REST base → nexus, device-JWT interceptors | Modify |
| `modules/market/composables/useMarketData.ts` | REST + WS base → nexus, WS token | Modify |

---

# Phase 1 — Nexus

## Task 1: `MarketDataProperties` — device config block

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/config/MarketDataProperties.java`
- Test: `nexus/src/test/java/io/gerowallet/config/MarketDataPropertiesTest.java`

- [ ] **Step 1: Write the failing test**

Add to `MarketDataPropertiesTest.java`:

```java
@Test
void device_hasSensibleDefaults() {
    MarketDataProperties props = new MarketDataProperties();
    MarketDataProperties.Device d = props.getDevice();
    assertThat(d).isNotNull();
    assertThat(d.getAllowedOrigins()).isEmpty();
    assertThat(d.getWsConcurrentCap()).isEqualTo(5);
    assertThat(d.getRestRateLimit().getRps()).isEqualTo(10);
    assertThat(d.getRestRateLimit().getBurst()).isEqualTo(20);
    assertThat(d.getRestIpRateLimit().getRps()).isEqualTo(50);
    assertThat(d.getAuthIpRateLimit().getRps()).isEqualTo(2);
    assertThat(d.getWsRateLimit().getRps()).isEqualTo(1);
    assertThat(d.getWsIpRateLimit().getRps()).isEqualTo(10);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=MarketDataPropertiesTest test`
Expected: compile failure — `getDevice()` does not exist.

- [ ] **Step 3: Add the `Device` config to `MarketDataProperties`**

Add the import near the top:

```java
import lombok.AllArgsConstructor;
import lombok.NoArgsConstructor;
```

Add a field after the `networks` field:

```java
    private Device device = new Device();
```

Add these nested classes after the existing `Instance` class:

```java
    @Data
    public static class Device {
        /** chrome-extension:// origins permitted for device-authenticated market requests. */
        private List<String> allowedOrigins = List.of();
        /** Per-device token bucket for market REST routes. */
        private RateLimit restRateLimit = new RateLimit(10, 20);
        /** Per-IP token bucket for market REST routes. */
        private RateLimit restIpRateLimit = new RateLimit(50, 100);
        /** Per-IP token bucket for /api/auth/device(/refresh). */
        private RateLimit authIpRateLimit = new RateLimit(2, 10);
        /** Per-device token bucket for WS handshakes. */
        private RateLimit wsRateLimit = new RateLimit(1, 5);
        /** Per-IP token bucket for WS handshakes. */
        private RateLimit wsIpRateLimit = new RateLimit(10, 20);
        /** Max concurrent WS connections per device. -1 = unlimited. */
        private int wsConcurrentCap = 5;
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class RateLimit {
        private int rps;
        private int burst;
    }
```

Add a getter (Lombok `@Data` on the class already generates `getDevice()`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=MarketDataPropertiesTest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/config/MarketDataProperties.java src/test/java/io/gerowallet/config/MarketDataPropertiesTest.java
git commit -m "feat(market-data): add device config block to MarketDataProperties"
```

---

## Task 2: `WsSessionTracker` — re-key to `String`

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/service/marketdata/WsSessionTracker.java`
- Test: `nexus/src/test/java/io/gerowallet/service/marketdata/WsSessionTrackerTest.java`

- [ ] **Step 1: Rewrite the test for string keys**

Replace the whole body of `WsSessionTrackerTest.java`:

```java
package io.gerowallet.service.marketdata;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class WsSessionTrackerTest {
    private final WsSessionTracker tracker = new WsSessionTracker();

    @Test
    void increments_and_decrements_correctly() {
        String id = "caller-1";
        assertThat(tracker.active(id)).isEqualTo(0);
        assertThat(tracker.increment(id)).isEqualTo(1);
        assertThat(tracker.increment(id)).isEqualTo(2);
        assertThat(tracker.decrement(id)).isEqualTo(1);
        assertThat(tracker.decrement(id)).isEqualTo(0);
        assertThat(tracker.increment(id)).isEqualTo(1);
    }

    @Test
    void different_callers_isolated() {
        tracker.increment("caller-a");
        assertThat(tracker.active("caller-a")).isEqualTo(1);
        assertThat(tracker.active("caller-b")).isEqualTo(0);
    }

    @Test
    void decrement_on_zero_stays_zero() {
        assertThat(tracker.decrement("caller-x")).isEqualTo(0);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=WsSessionTrackerTest test`
Expected: compile failure — `active(String)` does not exist (current signature is `active(UUID)`).

- [ ] **Step 3: Re-key `WsSessionTracker` to `String`**

Replace the whole body of `WsSessionTracker.java`:

```java
package io.gerowallet.service.marketdata;

import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * In-memory per-caller active WebSocket session counter. The caller key is a
 * user UUID string (API-key auth) or a device id (device auth).
 * Correctness is only guaranteed with a single nexus replica.
 */
@Component
public class WsSessionTracker {

    private final ConcurrentHashMap<String, AtomicInteger> counters = new ConcurrentHashMap<>();

    public int active(String callerId) {
        AtomicInteger c = counters.get(callerId);
        return c == null ? 0 : c.get();
    }

    public int increment(String callerId) {
        return counters.computeIfAbsent(callerId, k -> new AtomicInteger()).incrementAndGet();
    }

    public int decrement(String callerId) {
        int[] result = {0};
        counters.compute(callerId, (k, c) -> {
            if (c == null) return null;
            int v = c.updateAndGet(n -> Math.max(0, n - 1));
            result[0] = v;
            return v == 0 ? null : c;
        });
        return result[0];
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=WsSessionTrackerTest test`
Expected: PASS. (The two callers — handshake interceptor, relay handler — will not compile yet; they are fixed in Tasks 9 and 10. Do not run a full build until then.)

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/service/marketdata/WsSessionTracker.java src/test/java/io/gerowallet/service/marketdata/WsSessionTrackerTest.java
git commit -m "refactor(market-data): re-key WsSessionTracker from UUID to String"
```

---

## Task 3: `SecurityExpressions` — device branch

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/security/SecurityExpressions.java`
- Test: `nexus/src/test/java/io/gerowallet/security/SecurityExpressionsMarketDataTest.java`

- [ ] **Step 1: Write the failing tests**

Add to `SecurityExpressionsMarketDataTest.java`. Add imports:

```java
import io.gerowallet.entity.Device;
import io.gerowallet.security.DevicePrincipal;
import java.util.Set;
```

Add a helper and tests:

```java
    private void authenticateAsDevice(boolean enabled, boolean blocked) {
        Device device = Device.builder()
                .deviceId("device-abc")
                .enabled(enabled)
                .blocked(blocked)
                .tokenVersion(0)
                .scopes(Set.of())
                .build();
        DevicePrincipal principal = new DevicePrincipal(device);
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
    }

    @Test
    void canReadMarketData_returnsTrue_forEnabledDevice() {
        authenticateAsDevice(true, false);
        assertThat(expressions.canReadMarketData()).isTrue();
    }

    @Test
    void canStreamMarketData_returnsTrue_forEnabledDevice() {
        authenticateAsDevice(true, false);
        assertThat(expressions.canStreamMarketData()).isTrue();
    }

    @Test
    void canReadMarketData_returnsFalse_forDisabledDevice() {
        authenticateAsDevice(false, false);
        assertThat(expressions.canReadMarketData()).isFalse();
    }

    @Test
    void canReadMarketData_returnsFalse_forBlockedDevice() {
        authenticateAsDevice(true, true);
        assertThat(expressions.canReadMarketData()).isFalse();
    }
```

> If the `Device` builder field names differ from `deviceId/enabled/blocked/tokenVersion/scopes`, open `nexus/src/main/java/io/gerowallet/entity/Device.java` and use the actual names — the `DevicePrincipal` getters (`getDeviceId()`, `isEnabled()`, `isBlocked()`, `getTokenVersion()`, `getScopes()`) confirm those properties exist.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=SecurityExpressionsMarketDataTest test`
Expected: FAIL — `canReadMarketData()` returns false for an enabled device (currently device principals yield no tier).

- [ ] **Step 3: Add the device branch**

In `SecurityExpressions.java`, replace `canReadMarketData()` and `canStreamMarketData()`:

```java
    public boolean canReadMarketData() {
        // Device-authenticated (first-party wallet) clients bypass tier gating —
        // tiers meter third-party API customers, not the wallet itself.
        if (isEnabledDevice()) {
            return true;
        }
        return currentUserTier()
            .map(String::toLowerCase)
            .map(marketDataProperties.allowedTiersNormalized()::contains)
            .orElse(false);
    }

    public boolean canStreamMarketData() {
        if (isEnabledDevice()) {
            return true;
        }
        return currentUserTier()
            .map(String::toLowerCase)
            .map(marketDataProperties.wsAllowedTiersNormalized()::contains)
            .orElse(false);
    }

    /** True when the current principal is a device that is enabled and not blocked. */
    private boolean isEnabledDevice() {
        return getCurrentDevice()
            .filter(d -> d.isEnabled() && d.isAccountNonLocked())
            .isPresent();
    }
```

`getCurrentDevice()` already exists in this class — no new helper needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=SecurityExpressionsMarketDataTest test`
Expected: PASS (existing API-key tests in the same class still pass).

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/security/SecurityExpressions.java src/test/java/io/gerowallet/security/SecurityExpressionsMarketDataTest.java
git commit -m "feat(market-data): enabled devices bypass market-data tier gating"
```

---

## Task 4: `DeviceOriginValidator` — origin allowlist

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/security/DeviceOriginValidator.java`
- Test: `nexus/src/test/java/io/gerowallet/security/DeviceOriginValidatorTest.java`

- [ ] **Step 1: Write the failing test**

Create `DeviceOriginValidatorTest.java`:

```java
package io.gerowallet.security;

import io.gerowallet.config.MarketDataProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceOriginValidatorTest {

    private DeviceOriginValidator validator;

    @BeforeEach
    void setUp() {
        MarketDataProperties props = new MarketDataProperties();
        props.getDevice().setAllowedOrigins(List.of("chrome-extension://abc123"));
        validator = new DeviceOriginValidator(props);
    }

    @Test
    void allowsListedExtensionOrigin() {
        assertThat(validator.isAllowed("chrome-extension://abc123")).isTrue();
    }

    @Test
    void rejectsUnlistedExtensionOrigin() {
        assertThat(validator.isAllowed("chrome-extension://evil999")).isFalse();
    }

    @Test
    void allowsAbsentOrigin() {
        assertThat(validator.isAllowed(null)).isTrue();
        assertThat(validator.isAllowed("")).isTrue();
    }

    @Test
    void allowsNonExtensionOrigin() {
        // native apps / non-browser clients do not send a chrome-extension origin
        assertThat(validator.isAllowed("https://example.com")).isTrue();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=DeviceOriginValidatorTest test`
Expected: compile failure — `DeviceOriginValidator` does not exist.

- [ ] **Step 3: Create `DeviceOriginValidator`**

```java
package io.gerowallet.security;

import io.gerowallet.config.MarketDataProperties;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * Allowlist check for the {@code Origin} header on device-authenticated
 * market requests.
 *
 * <p>Defense-in-depth only — NOT a security boundary. A non-browser client
 * (curl, scripts) sets or omits {@code Origin} freely, so this blocks lazy
 * browser-console misuse and accidents, nothing more. See the design spec's
 * "Security posture" section.
 */
@Component
@RequiredArgsConstructor
public class DeviceOriginValidator {

    private static final String EXTENSION_SCHEME = "chrome-extension://";

    private final MarketDataProperties props;

    /**
     * @return true if the request may proceed. Absent or non-extension origins
     *         pass (native apps); a {@code chrome-extension://} origin must be
     *         in the configured allowlist.
     */
    public boolean isAllowed(String origin) {
        if (origin == null || origin.isBlank()) {
            return true;
        }
        if (!origin.startsWith(EXTENSION_SCHEME)) {
            return true;
        }
        return props.getDevice().getAllowedOrigins().contains(origin);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=DeviceOriginValidatorTest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/security/DeviceOriginValidator.java src/test/java/io/gerowallet/security/DeviceOriginValidatorTest.java
git commit -m "feat(market-data): add DeviceOriginValidator origin allowlist"
```

---

## Task 5: `DeviceRateLimitBuckets` — string-keyed token-bucket cache

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/service/marketdata/DeviceRateLimitBuckets.java`
- Test: `nexus/src/test/java/io/gerowallet/service/marketdata/DeviceRateLimitBucketsTest.java`

- [ ] **Step 1: Write the failing test**

Create `DeviceRateLimitBucketsTest.java`:

```java
package io.gerowallet.service.marketdata;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeviceRateLimitBucketsTest {

    private final DeviceRateLimitBuckets buckets = new DeviceRateLimitBuckets();

    @Test
    void allowsUpToBurst_thenRejects() {
        // burst = 3, rps = 1: the first 3 calls pass, the 4th is rejected
        for (int i = 0; i < 3; i++) {
            assertThat(buckets.tryConsume("k1", 1, 3)).isTrue();
        }
        assertThat(buckets.tryConsume("k1", 1, 3)).isFalse();
    }

    @Test
    void keysAreIsolated() {
        for (int i = 0; i < 3; i++) {
            buckets.tryConsume("k-a", 1, 3);
        }
        assertThat(buckets.tryConsume("k-a", 1, 3)).isFalse();
        assertThat(buckets.tryConsume("k-b", 1, 3)).isTrue();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=DeviceRateLimitBucketsTest test`
Expected: compile failure — `DeviceRateLimitBuckets` does not exist.

- [ ] **Step 3: Create `DeviceRateLimitBuckets`**

```java
package io.gerowallet.service.marketdata;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import io.gerowallet.billing.enforcement.TokenBucket;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Per-key {@link TokenBucket} cache for device-auth rate limiting. Keys are
 * scope-prefixed strings, e.g. {@code "mkt:ip:1.2.3.4"} or {@code "mkt:dev:<id>"}.
 * The rps/burst captured on first access for a key are fixed for that bucket's
 * lifetime (1h idle TTL), which is fine — limits only change on a redeploy.
 *
 * <p>Single-instance only — multi-replica enforcement needs Bucket4j + Redis.
 */
@Component
public class DeviceRateLimitBuckets {

    private final Cache<String, TokenBucket> cache = Caffeine.newBuilder()
            .expireAfterAccess(Duration.ofHours(1))
            .maximumSize(200_000)
            .build();

    /** @return true if a token was available (request allowed), false if rate-limited. */
    public boolean tryConsume(String key, int rps, int burst) {
        return cache.get(key, k -> new TokenBucket(rps, burst)).tryConsume();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=DeviceRateLimitBucketsTest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/service/marketdata/DeviceRateLimitBuckets.java src/test/java/io/gerowallet/service/marketdata/DeviceRateLimitBucketsTest.java
git commit -m "feat(market-data): add DeviceRateLimitBuckets token-bucket cache"
```

---

## Task 6: `DeviceRateLimitFilter` — per-IP / per-device limiting

This filter limits `/api/auth/device(/refresh)?` by IP, and device-authenticated
market REST routes by device + IP. It runs after `JwtAuthenticationFilter`, so
the `SecurityContext` already holds a `DevicePrincipal` for market routes.

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/security/filter/DeviceRateLimitFilter.java`
- Test: `nexus/src/test/java/io/gerowallet/security/filter/DeviceRateLimitFilterTest.java`

- [ ] **Step 1: Write the failing test**

Create `DeviceRateLimitFilterTest.java`:

```java
package io.gerowallet.security.filter;

import io.gerowallet.config.MarketDataProperties;
import io.gerowallet.entity.Device;
import io.gerowallet.security.DevicePrincipal;
import io.gerowallet.service.marketdata.DeviceRateLimitBuckets;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class DeviceRateLimitFilterTest {

    private DeviceRateLimitFilter filter;

    @BeforeEach
    void setUp() {
        MarketDataProperties props = new MarketDataProperties();
        // tighten auth-IP limit to burst=1 so the 2nd call trips it
        props.getDevice().setAuthIpRateLimit(new MarketDataProperties.RateLimit(1, 1));
        filter = new DeviceRateLimitFilter(new DeviceRateLimitBuckets(), props);
    }

    @AfterEach
    void clear() { SecurityContextHolder.clearContext(); }

    private void authenticateDevice() {
        Device device = Device.builder().deviceId("dev-1").enabled(true).blocked(false)
                .tokenVersion(0).scopes(Set.of()).build();
        DevicePrincipal p = new DevicePrincipal(device);
        SecurityContextHolder.getContext().setAuthentication(
            new UsernamePasswordAuthenticationToken(p, null, p.getAuthorities()));
    }

    @Test
    void authEndpoint_secondCallFromSameIp_is429() throws Exception {
        FilterChain chain = mock(FilterChain.class);

        MockHttpServletRequest r1 = new MockHttpServletRequest("POST", "/api/auth/device");
        r1.setRemoteAddr("9.9.9.9");
        filter.doFilter(r1, new MockHttpServletResponse(), chain);

        MockHttpServletRequest r2 = new MockHttpServletRequest("POST", "/api/auth/device");
        r2.setRemoteAddr("9.9.9.9");
        MockHttpServletResponse resp2 = new MockHttpServletResponse();
        filter.doFilter(r2, resp2, chain);

        assertThat(resp2.getStatus()).isEqualTo(429);
        verify(chain, times(1)).doFilter(any(), any()); // only the first call passed through
    }

    @Test
    void nonRateLimitedPath_passesThrough() throws Exception {
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/unrelated");
        req.setRemoteAddr("1.1.1.1");
        filter.doFilter(req, new MockHttpServletResponse(), chain);
        verify(chain).doFilter(any(), any());
    }

    @Test
    void marketRoute_withoutDevicePrincipal_passesThrough() throws Exception {
        // API-key requests are limited by PlanEnforcementFilter, not here
        FilterChain chain = mock(FilterChain.class);
        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/market/prices");
        req.setRemoteAddr("2.2.2.2");
        filter.doFilter(req, new MockHttpServletResponse(), chain);
        verify(chain).doFilter(any(), any());
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=DeviceRateLimitFilterTest test`
Expected: compile failure — `DeviceRateLimitFilter` does not exist.

- [ ] **Step 3: Create `DeviceRateLimitFilter`**

```java
package io.gerowallet.security.filter;

import io.gerowallet.config.MarketDataProperties;
import io.gerowallet.config.MarketDataProperties.RateLimit;
import io.gerowallet.security.DevicePrincipal;
import io.gerowallet.service.marketdata.DeviceRateLimitBuckets;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * Rate limits the device-auth surface:
 *   - POST /api/auth/device(/refresh) — per-IP (token-minting abuse cap).
 *   - device-authenticated /api/v1/{market,prices,dex,nft,wallet}/** — per-device + per-IP.
 * API-key market requests are limited elsewhere (PlanEnforcementFilter) and pass
 * through untouched.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DeviceRateLimitFilter extends OncePerRequestFilter {

    private static final String[] MARKET_PREFIXES = {
        "/api/v1/market/", "/api/v1/prices/", "/api/v1/dex/",
        "/api/v1/nft/", "/api/v1/wallet/", "/api/v1/blueprints/"
    };

    private final DeviceRateLimitBuckets buckets;
    private final MarketDataProperties props;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String uri = request.getRequestURI();
        String ip = request.getRemoteAddr();
        MarketDataProperties.Device cfg = props.getDevice();

        if (isAuthEndpoint(uri)) {
            RateLimit l = cfg.getAuthIpRateLimit();
            if (!buckets.tryConsume("auth:ip:" + ip, l.getRps(), l.getBurst())) {
                reject(response);
                return;
            }
        } else if (isMarketRoute(uri)) {
            String deviceId = currentDeviceId();
            if (deviceId != null) {
                RateLimit ipL = cfg.getRestIpRateLimit();
                RateLimit devL = cfg.getRestRateLimit();
                if (!buckets.tryConsume("mkt:ip:" + ip, ipL.getRps(), ipL.getBurst())
                        || !buckets.tryConsume("mkt:dev:" + deviceId, devL.getRps(), devL.getBurst())) {
                    reject(response);
                    return;
                }
            }
        }
        chain.doFilter(request, response);
    }

    private boolean isAuthEndpoint(String uri) {
        return "/api/auth/device".equals(uri) || "/api/auth/device/refresh".equals(uri);
    }

    private boolean isMarketRoute(String uri) {
        for (String p : MARKET_PREFIXES) {
            if (uri.startsWith(p)) return true;
        }
        return false;
    }

    /** @return the device id if the current principal is a DevicePrincipal, else null. */
    private String currentDeviceId() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof DevicePrincipal dp) {
            return dp.getId();
        }
        return null;
    }

    private void reject(HttpServletResponse response) throws IOException {
        response.setStatus(429);
        response.setContentType("application/json");
        response.getOutputStream().write(
            "{\"error\":\"rate_limited\",\"status\":429}".getBytes(StandardCharsets.UTF_8));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=DeviceRateLimitFilterTest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/security/filter/DeviceRateLimitFilter.java src/test/java/io/gerowallet/security/filter/DeviceRateLimitFilterTest.java
git commit -m "feat(market-data): add DeviceRateLimitFilter (per-IP/per-device)"
```

---

## Task 7: Register `DeviceRateLimitFilter` in `SecurityConfig`

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/config/SecurityConfig.java`

No unit test — this is filter-chain wiring, exercised by the Task 12 integration test.

- [ ] **Step 1: Add the filter field**

After `private final PlanEnforcementFilter planEnforcementFilter;` add:

```java
    private final io.gerowallet.security.filter.DeviceRateLimitFilter deviceRateLimitFilter;
```

- [ ] **Step 2: Register it after `PlanEnforcementFilter`**

Change the filter-chain block — replace:

```java
                .addFilterAfter(planEnforcementFilter, JwtAuthenticationFilter.class);
```

with:

```java
                .addFilterAfter(planEnforcementFilter, JwtAuthenticationFilter.class)
                .addFilterAfter(deviceRateLimitFilter, PlanEnforcementFilter.class);
```

- [ ] **Step 3: Add a disabled `FilterRegistrationBean`**

Spring Boot auto-registers any `Filter` bean into the servlet chain; the existing
filters each have a registration bean with `setEnabled(false)` to prevent
double-registration. Add the same for the new filter, after the
`planEnforcementFilterRegistration` bean:

```java
    @Bean
    public FilterRegistrationBean<io.gerowallet.security.filter.DeviceRateLimitFilter> deviceRateLimitFilterRegistration(
            io.gerowallet.security.filter.DeviceRateLimitFilter filter) {
        FilterRegistrationBean<io.gerowallet.security.filter.DeviceRateLimitFilter> registration =
            new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
```

- [ ] **Step 4: Verify it compiles**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o compile`
Expected: BUILD SUCCESS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/config/SecurityConfig.java
git commit -m "feat(market-data): register DeviceRateLimitFilter in security chain"
```

---

## Task 8: `MarketDataProxyFacade` — string caller id, caller type, origin check

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/facade/MarketDataProxyFacade.java`
- Test: `nexus/src/test/java/io/gerowallet/facade/MarketDataProxyFacadeTest.java`

- [ ] **Step 1: Read the existing facade test and update call sites**

Open `MarketDataProxyFacadeTest.java`. Every call to `facade.forward(...)` currently
passes `(request, UUID, String apiKeyId, Network)`. The new signature is
`forward(HttpServletRequest, String callerId, AuthType callerType, Network keyNetwork)`.
Update each existing call: replace the `UUID` user id with a string (e.g.
`UUID.randomUUID().toString()`), drop the `apiKeyId` argument, and insert
`AuthType.API_KEY` as the second argument. Add `import io.gerowallet.model.enums.AuthType;`.

Then add two new test methods (the facade is constructed in the test's setup —
match how it builds the facade, adding a real `DeviceOriginValidator`):

```java
    @Test
    void deviceCaller_disallowedOrigin_returns403() {
        MarketDataProperties p = new MarketDataProperties();
        p.getDevice().setAllowedOrigins(java.util.List.of("chrome-extension://good"));
        MarketDataProxyFacade f = new MarketDataProxyFacade(
            webClient, p, metrics, new io.gerowallet.security.DeviceOriginValidator(p));

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/market/prices");
        req.addHeader("Origin", "chrome-extension://evil");

        ResponseEntity<byte[]> resp = f.forward(req, "device-1", AuthType.DEVICE, null);

        assertThat(resp.getStatusCode().value()).isEqualTo(403);
    }

    @Test
    void deviceCaller_noOrigin_isAllowedThrough() {
        MarketDataProperties p = new MarketDataProperties();
        MarketDataProxyFacade f = new MarketDataProxyFacade(
            webClient, p, metrics, new io.gerowallet.security.DeviceOriginValidator(p));

        MockHttpServletRequest req = new MockHttpServletRequest("GET", "/api/v1/market/prices");
        // no Origin header — must not be rejected by the origin check
        ResponseEntity<byte[]> resp = f.forward(req, "device-1", AuthType.DEVICE, null);

        // upstream is unreachable in a unit test → 502/503/504, NOT 403
        assertThat(resp.getStatusCode().value()).isNotEqualTo(403);
    }
```

> If the test's `@BeforeEach` builds the facade with a different field set, mirror
> that — the only required change is passing a `DeviceOriginValidator` as the new
> 4th constructor argument.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=MarketDataProxyFacadeTest test`
Expected: compile failure — `forward(...)` signature mismatch / 4-arg constructor missing.

- [ ] **Step 3: Update the facade**

In `MarketDataProxyFacade.java`:

Add the import:

```java
import io.gerowallet.model.enums.AuthType;
import io.gerowallet.security.DeviceOriginValidator;
```

Add the field and constructor parameter — replace the constructor:

```java
    private final WebClient webClient;
    private final MarketDataProperties props;
    private final MarketDataMetrics metrics;
    private final DeviceOriginValidator originValidator;

    public MarketDataProxyFacade(@Qualifier("marketDataWebClient") WebClient webClient,
                                  MarketDataProperties props,
                                  MarketDataMetrics metrics,
                                  DeviceOriginValidator originValidator) {
        this.webClient = webClient;
        this.props = props;
        this.metrics = metrics;
        this.originValidator = originValidator;
    }
```

Replace the `forward(...)` method signature and its first lines — replace:

```java
    public ResponseEntity<byte[]> forward(HttpServletRequest request, UUID userId,
                                          String apiKeyId, Network keyNetwork) {
        String requestId0 = UUID.randomUUID().toString();
        String network = extractNetwork(request.getQueryString());
        Optional<String> upstreamBase = props.resolveBaseUrl(network);
        if (upstreamBase.isEmpty()) {
            log.warn("Unknown market-data network requested requestId={} network={}",
                requestId0, network);
            return unknownNetwork(requestId0);
        }
        // Blueprint access is scoped to a network-matching API key: a key
        // issued for CARDANO_PREVIEW may only read ?network=preview, a
        // CARDANO_MAINNET key only mainnet. Other market-data paths are not gated.
        if (request.getRequestURI().startsWith("/api/v1/blueprints")) {
            Optional<Network> required = props.resolveRequiredNetwork(network);
            if (required.isPresent() && required.get() != keyNetwork) {
                log.warn("Market-data network scope mismatch requestId={} keyNetwork={} requested={}",
                    requestId0, keyNetwork, network);
                return networkScopeForbidden(requestId0);
            }
        }
```

with:

```java
    public ResponseEntity<byte[]> forward(HttpServletRequest request, String callerId,
                                          AuthType callerType, Network keyNetwork) {
        String requestId0 = UUID.randomUUID().toString();

        // Device-authenticated requests: origin allowlist check (defense-in-depth).
        if (callerType == AuthType.DEVICE && !originValidator.isAllowed(request.getHeader("Origin"))) {
            log.warn("Market-data origin rejected requestId={} origin={}",
                requestId0, request.getHeader("Origin"));
            return originForbidden(requestId0);
        }

        String network = extractNetwork(request.getQueryString());
        Optional<String> upstreamBase = props.resolveBaseUrl(network);
        if (upstreamBase.isEmpty()) {
            log.warn("Unknown market-data network requested requestId={} network={}",
                requestId0, network);
            return unknownNetwork(requestId0);
        }
        // Blueprint access is scoped to a network-matching API key: a key
        // issued for CARDANO_PREVIEW may only read ?network=preview, a
        // CARDANO_MAINNET key only mainnet. Device callers carry no network
        // scope and are not gated here. Other market-data paths are not gated.
        if (callerType == AuthType.API_KEY && request.getRequestURI().startsWith("/api/v1/blueprints")) {
            Optional<Network> required = props.resolveRequiredNetwork(network);
            if (required.isPresent() && required.get() != keyNetwork) {
                log.warn("Market-data network scope mismatch requestId={} keyNetwork={} requested={}",
                    requestId0, keyNetwork, network);
                return networkScopeForbidden(requestId0);
            }
        }
```

In the same method, replace the user-id header line — change:

```java
                .header("X-Nexus-User-Id", userId.toString())
```

to:

```java
                .header("X-Nexus-User-Id", callerId)
                .header("X-Nexus-Caller-Type", callerType.name())
```

Add the `originForbidden` helper next to `networkScopeForbidden`:

```java
    private ResponseEntity<byte[]> originForbidden(String requestId) {
        String body = String.format(
            "{\"error\":\"origin_not_allowed\",\"status\":403,\"requestId\":\"%s\"}",
            requestId);
        HttpHeaders h = new HttpHeaders();
        h.set(HttpHeaders.CONTENT_TYPE, "application/json");
        return ResponseEntity.status(HttpStatus.FORBIDDEN).headers(h)
            .body(body.getBytes(StandardCharsets.UTF_8));
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=MarketDataProxyFacadeTest test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/facade/MarketDataProxyFacade.java src/test/java/io/gerowallet/facade/MarketDataProxyFacadeTest.java
git commit -m "feat(market-data): facade accepts caller type + device origin check"
```

---

## Task 9: `MarketDataProxyController` — accept `AuthenticatedPrincipal`

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/controller/marketdata/MarketDataProxyController.java`

Verified by the Task 12 integration test.

- [ ] **Step 1: Rewrite the controller**

Replace the whole body of `MarketDataProxyController.java`:

```java
package io.gerowallet.controller.marketdata;

import io.gerowallet.facade.MarketDataProxyFacade;
import io.gerowallet.model.enums.AuthType;
import io.gerowallet.security.ApiKeyPrincipal;
import io.gerowallet.security.AuthenticatedPrincipal;
import io.gerowallet.security.DevicePrincipal;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequiredArgsConstructor
@Tag(name = "Market Data (proxied)", description = "Proxied endpoints from cardano-market-data")
@PreAuthorize("@securityExpressions.canReadMarketData()")
public class MarketDataProxyController {

    private final MarketDataProxyFacade facade;

    @RequestMapping(path = {
            "/api/v1/market/**",
            "/api/v1/prices/**",
            "/api/v1/dex/**",
            "/api/v1/nft/**",
            "/api/v1/wallet/**",
            "/api/v1/blueprints/**"
    }, method = {
            RequestMethod.GET, RequestMethod.POST, RequestMethod.PUT,
            RequestMethod.DELETE, RequestMethod.PATCH, RequestMethod.HEAD
    })
    public ResponseEntity<byte[]> proxy(HttpServletRequest request,
                                        @AuthenticationPrincipal AuthenticatedPrincipal principal) {
        if (principal instanceof ApiKeyPrincipal apiKey) {
            return facade.forward(
                request,
                apiKey.getUser().getId().toString(),
                AuthType.API_KEY,
                apiKey.getApiKey().getNetwork());
        }
        if (principal instanceof DevicePrincipal device) {
            return facade.forward(request, device.getId(), AuthType.DEVICE, null);
        }
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o compile`
Expected: BUILD SUCCESS.

- [ ] **Step 3: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/controller/marketdata/MarketDataProxyController.java
git commit -m "feat(market-data): REST proxy accepts device or API-key principal"
```

---

## Task 10: `UpstreamStompSession` — caller id / caller type

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/ws/marketdata/UpstreamStompSession.java`

Compiled together with Task 11.

- [ ] **Step 1: Rewrite `UpstreamStompSession`**

```java
package io.gerowallet.ws.marketdata;

import io.gerowallet.model.enums.AuthType;
import lombok.Getter;
import lombok.RequiredArgsConstructor;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.web.socket.WebSocketSession;

@Getter
@RequiredArgsConstructor
public class UpstreamStompSession {
    private final WebSocketSession clientSession;
    private final StompSession upstreamSession;
    /** User UUID string (API-key auth) or device id (device auth). */
    private final String callerId;
    private final AuthType callerType;
    private final long monthlyMessagesCap;

    public boolean wsUnlimited() { return monthlyMessagesCap < 0; }
}
```

- [ ] **Step 2: Commit (compilation verified in Task 11)**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/ws/marketdata/UpstreamStompSession.java
git commit -m "refactor(market-data): UpstreamStompSession uses callerId/callerType"
```

---

## Task 11: `MarketDataWsRelayHandler` — caller-aware relay

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/ws/marketdata/MarketDataWsRelayHandler.java`

Verified by `MarketDataWsRelayIntegrationTest` after Task 12 (full-build step).

- [ ] **Step 1: Update imports**

Add:

```java
import io.gerowallet.model.enums.AuthType;
```

The `java.util.UUID` import stays (used to parse the API-key caller id for quota).

- [ ] **Step 2: Rewrite `afterConnectionEstablished`**

Replace the method — replace:

```java
    @Override
    public void afterConnectionEstablished(WebSocketSession client) throws Exception {
        Map<String, Object> attrs = client.getAttributes();
        UUID userId = (UUID) attrs.get(MarketDataWsHandshakeInterceptor.ATTR_USER_ID);
        UUID apiKeyId = (UUID) attrs.get(MarketDataWsHandshakeInterceptor.ATTR_API_KEY_ID);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) attrs.get(MarketDataWsHandshakeInterceptor.ATTR_PLAN_CAPS);
        long monthlyCap = ((Number) caps.get("monthlyMessages")).longValue();

        // Increment session tracker BEFORE upstream connect to narrow the TOCTOU window
        // between the handshake interceptor's cap check and this increment. Must decrement
        // in every error path below.
        sessionTracker.increment(userId);
        metrics.wsConnectionOpened();
        metrics.wsSessionOpenedGauge();
```

with:

```java
    @Override
    public void afterConnectionEstablished(WebSocketSession client) throws Exception {
        Map<String, Object> attrs = client.getAttributes();
        String callerId = (String) attrs.get(MarketDataWsHandshakeInterceptor.ATTR_CALLER_ID);
        AuthType callerType = (AuthType) attrs.get(MarketDataWsHandshakeInterceptor.ATTR_CALLER_TYPE);
        @SuppressWarnings("unchecked")
        Map<String, Object> caps = (Map<String, Object>) attrs.get(MarketDataWsHandshakeInterceptor.ATTR_PLAN_CAPS);
        long monthlyCap = ((Number) caps.get("monthlyMessages")).longValue();

        // Increment session tracker BEFORE upstream connect to narrow the TOCTOU window
        // between the handshake interceptor's cap check and this increment. Must decrement
        // in every error path below.
        sessionTracker.increment(callerId);
        metrics.wsConnectionOpened();
        metrics.wsSessionOpenedGauge();
```

In the same method, replace every remaining `userId` reference:
- `log.warn("Upstream STOMP connect failed userId={} err={}", userId, e.toString());` → `log.warn("Upstream STOMP connect failed callerId={} err={}", callerId, e.toString());`
- `sessionTracker.decrement(userId);` (in the connect-fail catch) → `sessionTracker.decrement(callerId);`
- the quota block — replace:

```java
        boolean quotaOk;
        try {
            quotaOk = quotaService.tryRecordMessage(userId);
        } catch (Exception e) {
            log.warn("Quota check failed userId={} err={}", userId, e.toString());
            sessionTracker.decrement(userId);
            metrics.wsSessionClosedGauge();
            upstream.disconnect();
            client.close(new CloseStatus(1011, "quota_check_failed"));
            return;
        }
        if (!quotaOk) {
            client.sendMessage(new TextMessage("{\"error\":\"quota_exceeded\"}"));
            client.close(new CloseStatus(1008, "quota_exceeded"));
            upstream.disconnect();
            sessionTracker.decrement(userId);
            metrics.wsSessionClosedGauge();
            return;
        }

        sessions.put(client.getId(), new UpstreamStompSession(client, upstream, userId, apiKeyId, monthlyCap));
        log.info("WS session opened userId={} apiKeyId={}", userId, apiKeyId);
    }
```

with:

```java
        boolean quotaOk;
        try {
            quotaOk = recordMessage(callerType, callerId);
        } catch (Exception e) {
            log.warn("Quota check failed callerId={} err={}", callerId, e.toString());
            sessionTracker.decrement(callerId);
            metrics.wsSessionClosedGauge();
            upstream.disconnect();
            client.close(new CloseStatus(1011, "quota_check_failed"));
            return;
        }
        if (!quotaOk) {
            client.sendMessage(new TextMessage("{\"error\":\"quota_exceeded\"}"));
            client.close(new CloseStatus(1008, "quota_exceeded"));
            upstream.disconnect();
            sessionTracker.decrement(callerId);
            metrics.wsSessionClosedGauge();
            return;
        }

        sessions.put(client.getId(), new UpstreamStompSession(client, upstream, callerId, callerType, monthlyCap));
        log.info("WS session opened callerId={} callerType={}", callerId, callerType);
    }

    /**
     * Devices have no monthly WS message quota (first-party, bypass tiering);
     * API-key callers go through the user-quota counter as before.
     */
    private boolean recordMessage(AuthType callerType, String callerId) {
        if (callerType == AuthType.DEVICE) {
            return true;
        }
        return quotaService.tryRecordMessage(UUID.fromString(callerId));
    }
```

- [ ] **Step 3: Update `relayDownstream`**

Replace:

```java
    private void relayDownstream(UpstreamStompSession holder, StompHeaders headers, byte[] payload) {
        try {
            if (!quotaService.tryRecordMessage(holder.getUserId())) {
                holder.getClientSession().sendMessage(new TextMessage("{\"error\":\"quota_exceeded\"}"));
                holder.getClientSession().close(new CloseStatus(1008, "quota_exceeded"));
                return;
            }
```

with:

```java
    private void relayDownstream(UpstreamStompSession holder, StompHeaders headers, byte[] payload) {
        try {
            if (!recordMessage(holder.getCallerType(), holder.getCallerId())) {
                holder.getClientSession().sendMessage(new TextMessage("{\"error\":\"quota_exceeded\"}"));
                holder.getClientSession().close(new CloseStatus(1008, "quota_exceeded"));
                return;
            }
```

In the same method's catch block, replace `holder.getUserId()` with `holder.getCallerId()`:

```java
        } catch (Exception e) {
            log.warn("Failed to relay downstream frame callerId={} err={}", holder.getCallerId(), e.toString());
        }
```

- [ ] **Step 4: Update `afterConnectionClosed`**

Replace:

```java
            sessionTracker.decrement(holder.getUserId());
            metrics.wsSessionClosedGauge();
            log.info("WS session closed userId={} status={}", holder.getUserId(), closeStatus.getCode());
```

with:

```java
            sessionTracker.decrement(holder.getCallerId());
            metrics.wsSessionClosedGauge();
            log.info("WS session closed callerId={} status={}", holder.getCallerId(), closeStatus.getCode());
```

- [ ] **Step 5: Verify it compiles**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o compile`
Expected: the relay handler compiles; `MarketDataWsHandshakeInterceptor` still fails (fixed in Task 12). If only the interceptor errors remain, proceed.

- [ ] **Step 6: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/ws/marketdata/MarketDataWsRelayHandler.java
git commit -m "feat(market-data): WS relay is caller-aware, skips device quota"
```

---

## Task 12: `MarketDataWsHandshakeInterceptor` — device-JWT auth path

**Files:**
- Modify: `nexus/src/main/java/io/gerowallet/ws/marketdata/MarketDataWsHandshakeInterceptor.java`
- Test: `nexus/src/test/java/io/gerowallet/ws/marketdata/MarketDataWsHandshakeInterceptorTest.java`

- [ ] **Step 1: Update the existing test for the new constructor + attribute names**

In `MarketDataWsHandshakeInterceptorTest.java`:

The interceptor constructor gains four dependencies. Add mocks:

```java
    @Mock private io.gerowallet.security.jwt.JwtTokenProvider jwtTokenProvider;
    @Mock private io.gerowallet.security.DeviceDetailsService deviceDetailsService;
```

In `setUp()`, replace the interceptor construction:

```java
        interceptor = new MarketDataWsHandshakeInterceptor(
            apiKeyLookupService, sessionTracker, metrics, props,
            jwtTokenProvider, deviceDetailsService,
            new io.gerowallet.security.DeviceOriginValidator(props),
            new io.gerowallet.service.marketdata.DeviceRateLimitBuckets());
```

The existing API-key tests reference `ATTR_USER_ID` / `ATTR_API_KEY_ID`. Replace
those with `ATTR_CALLER_ID` / `ATTR_CALLER_TYPE`. Specifically, in
`validKey_allowedTier_underCap_accepts` replace the three `assertThat(attrs)...`
lines and the value assertion with:

```java
        assertThat(attrs).containsKey(MarketDataWsHandshakeInterceptor.ATTR_CALLER_ID);
        assertThat(attrs).containsKey(MarketDataWsHandshakeInterceptor.ATTR_CALLER_TYPE);
        assertThat(attrs).containsKey(MarketDataWsHandshakeInterceptor.ATTR_PLAN_CAPS);
        assertThat(attrs.get(MarketDataWsHandshakeInterceptor.ATTR_CALLER_ID))
            .isEqualTo(user.getId().toString());
        assertThat(attrs.get(MarketDataWsHandshakeInterceptor.ATTR_CALLER_TYPE))
            .isEqualTo(io.gerowallet.model.enums.AuthType.API_KEY);
```

In `validKey_capMinusOne_unlimited_accepts` replace the `ATTR_USER_ID` assertion
with `assertThat(attrs).containsKey(MarketDataWsHandshakeInterceptor.ATTR_CALLER_ID);`.

The mock `apiKeyLookupService.findByKeyHash(...)` is stubbed with `RAW_KEY`
(`"test-api-key-12345"` — no dots), so it stays on the API-key path. Good.

Now add the device-path tests:

```java
    @Test
    void deviceJwt_enabledDevice_accepts() throws Exception {
        String jwt = "header.payload.signature"; // contains dots → JWT path
        io.jsonwebtoken.Claims claims = org.mockito.Mockito.mock(io.jsonwebtoken.Claims.class);
        io.gerowallet.entity.Device device = io.gerowallet.entity.Device.builder()
            .deviceId("dev-77").enabled(true).blocked(false).tokenVersion(3)
            .scopes(java.util.Set.of()).build();
        io.gerowallet.security.DevicePrincipal dp = new io.gerowallet.security.DevicePrincipal(device);

        when(jwtTokenProvider.validateAndGetClaims(jwt)).thenReturn(Optional.of(claims));
        when(jwtTokenProvider.getAuthTypeFromClaims(claims))
            .thenReturn(io.gerowallet.model.enums.AuthType.DEVICE);
        when(jwtTokenProvider.getSubjectIdFromClaims(claims)).thenReturn("dev-77");
        when(jwtTokenProvider.validateTokenVersionFromClaims(claims, 3)).thenReturn(true);
        when(deviceDetailsService.loadDeviceByDeviceId("dev-77")).thenReturn(dp);
        when(sessionTracker.active("dev-77")).thenReturn(0);

        Map<String, Object> attrs = new HashMap<>();
        boolean result = invoke(requestWithQueryParam(jwt), attrs);

        assertThat(result).isTrue();
        assertThat(attrs.get(MarketDataWsHandshakeInterceptor.ATTR_CALLER_ID)).isEqualTo("dev-77");
        assertThat(attrs.get(MarketDataWsHandshakeInterceptor.ATTR_CALLER_TYPE))
            .isEqualTo(io.gerowallet.model.enums.AuthType.DEVICE);
        verify(metrics, never()).wsConnectionRejected(anyString());
    }

    @Test
    void deviceJwt_invalidToken_rejects401() throws Exception {
        String jwt = "bad.jwt.token";
        when(jwtTokenProvider.validateAndGetClaims(jwt)).thenReturn(Optional.empty());

        boolean result = invoke(requestWithQueryParam(jwt), new HashMap<>());

        assertThat(result).isFalse();
        verify(metrics).wsConnectionRejected("auth");
    }

    @Test
    void deviceJwt_blockedDevice_rejects401() throws Exception {
        String jwt = "header.payload.signature";
        io.jsonwebtoken.Claims claims = org.mockito.Mockito.mock(io.jsonwebtoken.Claims.class);
        io.gerowallet.entity.Device device = io.gerowallet.entity.Device.builder()
            .deviceId("dev-bad").enabled(true).blocked(true).tokenVersion(0)
            .scopes(java.util.Set.of()).build();

        when(jwtTokenProvider.validateAndGetClaims(jwt)).thenReturn(Optional.of(claims));
        when(jwtTokenProvider.getAuthTypeFromClaims(claims))
            .thenReturn(io.gerowallet.model.enums.AuthType.DEVICE);
        when(jwtTokenProvider.getSubjectIdFromClaims(claims)).thenReturn("dev-bad");
        when(jwtTokenProvider.validateTokenVersionFromClaims(claims, 0)).thenReturn(true);
        when(deviceDetailsService.loadDeviceByDeviceId("dev-bad"))
            .thenReturn(new io.gerowallet.security.DevicePrincipal(device));

        boolean result = invoke(requestWithQueryParam(jwt), new HashMap<>());

        assertThat(result).isFalse();
        verify(metrics).wsConnectionRejected("auth");
    }

    @Test
    void deviceJwt_disallowedOrigin_rejects403() throws Exception {
        props.getDevice().setAllowedOrigins(java.util.List.of("chrome-extension://good"));
        String jwt = "header.payload.signature";
        io.jsonwebtoken.Claims claims = org.mockito.Mockito.mock(io.jsonwebtoken.Claims.class);
        io.gerowallet.entity.Device device = io.gerowallet.entity.Device.builder()
            .deviceId("dev-9").enabled(true).blocked(false).tokenVersion(0)
            .scopes(java.util.Set.of()).build();

        when(jwtTokenProvider.validateAndGetClaims(jwt)).thenReturn(Optional.of(claims));
        when(jwtTokenProvider.getAuthTypeFromClaims(claims))
            .thenReturn(io.gerowallet.model.enums.AuthType.DEVICE);
        when(jwtTokenProvider.getSubjectIdFromClaims(claims)).thenReturn("dev-9");
        when(jwtTokenProvider.validateTokenVersionFromClaims(claims, 0)).thenReturn(true);
        when(deviceDetailsService.loadDeviceByDeviceId("dev-9"))
            .thenReturn(new io.gerowallet.security.DevicePrincipal(device));

        MockHttpServletRequest req = requestWithQueryParam(jwt);
        req.addHeader("Origin", "chrome-extension://evil");
        boolean result = invoke(req, new HashMap<>());

        assertThat(result).isFalse();
        verify(metrics).wsConnectionRejected("origin");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=MarketDataWsHandshakeInterceptorTest test`
Expected: compile failure — new constructor args / `ATTR_CALLER_ID` missing.

- [ ] **Step 3: Rewrite `MarketDataWsHandshakeInterceptor`**

Replace the whole file:

```java
package io.gerowallet.ws.marketdata;

import io.gerowallet.billing.pricing.WsPackageCatalog;
import io.gerowallet.config.MarketDataProperties;
import io.gerowallet.config.MarketDataProperties.RateLimit;
import io.gerowallet.entity.ApiKey;
import io.gerowallet.entity.Plan;
import io.gerowallet.entity.User;
import io.gerowallet.model.enums.AuthType;
import io.gerowallet.model.enums.Network;
import io.gerowallet.security.DeviceOriginValidator;
import io.gerowallet.security.DevicePrincipal;
import io.gerowallet.security.DeviceDetailsService;
import io.gerowallet.security.jwt.JwtTokenProvider;
import io.gerowallet.service.apikey.ApiKeyLookupService;
import io.gerowallet.service.marketdata.DeviceRateLimitBuckets;
import io.gerowallet.service.marketdata.MarketDataMetrics;
import io.gerowallet.service.marketdata.WsSessionTracker;
import io.gerowallet.utils.security.HashUtils;
import io.jsonwebtoken.Claims;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

import java.net.URI;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;

@Slf4j
@Component
@RequiredArgsConstructor
public class MarketDataWsHandshakeInterceptor implements HandshakeInterceptor {

    public static final String ATTR_CALLER_ID         = "mdCallerId";
    public static final String ATTR_CALLER_TYPE       = "mdCallerType";
    public static final String ATTR_PLAN_CAPS         = "mdPlanCaps";
    public static final String ATTR_UPSTREAM_BASE_URL = "mdUpstreamBaseUrl";

    private final ApiKeyLookupService apiKeyLookupService;
    private final WsSessionTracker sessionTracker;
    private final MarketDataMetrics metrics;
    private final MarketDataProperties props;
    private final JwtTokenProvider jwtTokenProvider;
    private final DeviceDetailsService deviceDetailsService;
    private final DeviceOriginValidator originValidator;
    private final DeviceRateLimitBuckets rateLimitBuckets;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        String rawToken = extractToken(request);
        if (rawToken == null) {
            deny(response, HttpStatus.UNAUTHORIZED, "auth");
            return false;
        }
        // A device/user JWT is a dotted three-part token; nexus API keys
        // (nexus_<hex>) never contain a dot. Route on that.
        if (rawToken.contains(".")) {
            return deviceHandshake(rawToken, request, response, attributes);
        }
        return apiKeyHandshake(rawToken, request, response, attributes);
    }

    // ── device-JWT path ──────────────────────────────────────────────────────

    private boolean deviceHandshake(String jwt, ServerHttpRequest request,
                                    ServerHttpResponse response, Map<String, Object> attributes) {
        Optional<DevicePrincipal> maybe = resolveDevice(jwt);
        if (maybe.isEmpty()) {
            deny(response, HttpStatus.UNAUTHORIZED, "auth");
            return false;
        }
        DevicePrincipal device = maybe.get();
        if (!device.isEnabled() || !device.isAccountNonLocked()) {
            deny(response, HttpStatus.UNAUTHORIZED, "auth");
            return false;
        }
        // Origin allowlist — defense-in-depth, not a security boundary.
        if (!originValidator.isAllowed(firstHeader(request, "Origin"))) {
            deny(response, HttpStatus.FORBIDDEN, "origin");
            return false;
        }
        // Rate limit — per-IP and per-device.
        String ip = clientIp(request);
        RateLimit ipL = props.getDevice().getWsIpRateLimit();
        RateLimit devL = props.getDevice().getWsRateLimit();
        if (!rateLimitBuckets.tryConsume("ws:ip:" + ip, ipL.getRps(), ipL.getBurst())
                || !rateLimitBuckets.tryConsume("ws:dev:" + device.getId(), devL.getRps(), devL.getBurst())) {
            response.getHeaders().add("Retry-After", "5");
            deny(response, HttpStatus.TOO_MANY_REQUESTS, "rate_limited");
            return false;
        }
        // Concurrent-connection cap.
        int cap = props.getDevice().getWsConcurrentCap();
        if (cap != -1 && sessionTracker.active(device.getId()) >= cap) {
            response.getHeaders().add("Retry-After", "30");
            deny(response, HttpStatus.TOO_MANY_REQUESTS, "concurrency_cap");
            return false;
        }
        // Resolve upstream. Devices carry no network scope — any network is allowed.
        String network = extractNetwork(request.getURI().getRawQuery());
        Optional<String> upstreamBaseUrl = props.resolveBaseUrl(network);
        if (upstreamBaseUrl.isEmpty()) {
            deny(response, HttpStatus.BAD_REQUEST, "network");
            return false;
        }
        attributes.put(ATTR_UPSTREAM_BASE_URL, upstreamBaseUrl.get());
        attributes.put(ATTR_CALLER_ID, device.getId());
        attributes.put(ATTR_CALLER_TYPE, AuthType.DEVICE);
        // Devices have no monthly WS message quota.
        attributes.put(ATTR_PLAN_CAPS, Map.of(
            "maxConcurrent", cap,
            "monthlyMessages", -1L));
        return true;
    }

    private Optional<DevicePrincipal> resolveDevice(String jwt) {
        Optional<Claims> claims = jwtTokenProvider.validateAndGetClaims(jwt);
        if (claims.isEmpty()) {
            return Optional.empty();
        }
        if (jwtTokenProvider.getAuthTypeFromClaims(claims.get()) != AuthType.DEVICE) {
            return Optional.empty();
        }
        String deviceId = jwtTokenProvider.getSubjectIdFromClaims(claims.get());
        if (deviceId == null || deviceId.isBlank()) {
            return Optional.empty();
        }
        DevicePrincipal device;
        try {
            device = deviceDetailsService.loadDeviceByDeviceId(deviceId);
        } catch (Exception e) {
            log.info("WS device lookup failed deviceId={} err={}", deviceId, e.toString());
            return Optional.empty();
        }
        if (!jwtTokenProvider.validateTokenVersionFromClaims(claims.get(), device.getTokenVersion())) {
            return Optional.empty();
        }
        return Optional.of(device);
    }

    // ── API-key path (existing behaviour) ────────────────────────────────────

    private boolean apiKeyHandshake(String rawKey, ServerHttpRequest request,
                                    ServerHttpResponse response, Map<String, Object> attributes) {
        Optional<ApiKey> maybe = apiKeyLookupService.findByKeyHash(HashUtils.sha256Hex(rawKey));
        if (maybe.isEmpty()) {
            deny(response, HttpStatus.UNAUTHORIZED, "auth");
            return false;
        }
        ApiKey key = maybe.get();
        if (!key.isEnabled() || (key.getExpiresAt() != null && key.getExpiresAt().isBefore(Instant.now()))) {
            deny(response, HttpStatus.UNAUTHORIZED, "auth");
            return false;
        }
        User user = key.getUser();
        if (user == null || !Boolean.TRUE.equals(user.getEnabled()) || !Boolean.TRUE.equals(user.getAccountNonLocked())) {
            deny(response, HttpStatus.UNAUTHORIZED, "auth");
            return false;
        }
        Plan plan = user.getSubscription() != null ? user.getSubscription().getPlan() : null;
        if (plan == null) {
            deny(response, HttpStatus.FORBIDDEN, "plan_disabled");
            return false;
        }

        String perKeyWs = key.getWsPackage();
        int cap;
        long monthlyMessages;
        if (perKeyWs != null) {
            if (plan.isWsDisabled()) {
                deny(response, HttpStatus.FORBIDDEN, "plan_disabled");
                return false;
            }
            if ("none".equals(perKeyWs)) {
                deny(response, HttpStatus.FORBIDDEN, "plan_disabled");
                return false;
            }
            WsPackageCatalog.WsPackage pkg;
            try {
                pkg = WsPackageCatalog.require(perKeyWs);
            } catch (IllegalArgumentException ex) {
                deny(response, HttpStatus.FORBIDDEN, "plan_disabled");
                return false;
            }
            cap = pkg.concurrent();
            monthlyMessages = pkg.monthlyMessages();
        } else {
            if (!props.wsAllowedTiersNormalized().contains(plan.getTier().toLowerCase())) {
                deny(response, HttpStatus.FORBIDDEN, "tier");
                return false;
            }
            if (plan.isWsDisabled()) {
                deny(response, HttpStatus.FORBIDDEN, "plan_disabled");
                return false;
            }
            cap = plan.getMaxConcurrentWsConnections();
            monthlyMessages = plan.getMonthlyWsMessages();
        }

        String callerId = user.getId().toString();
        if (cap != -1 && sessionTracker.active(callerId) >= cap) {
            response.getHeaders().add("Retry-After", "30");
            deny(response, HttpStatus.TOO_MANY_REQUESTS, "concurrency_cap");
            return false;
        }

        String network = extractNetwork(request.getURI().getRawQuery());
        Optional<String> upstreamBaseUrl = props.resolveBaseUrl(network);
        if (upstreamBaseUrl.isEmpty()) {
            deny(response, HttpStatus.BAD_REQUEST, "network");
            return false;
        }
        Optional<Network> requiredNetwork = props.resolveRequiredNetwork(network);
        if (requiredNetwork.isPresent() && requiredNetwork.get() != key.getNetwork()) {
            deny(response, HttpStatus.FORBIDDEN, "network_scope");
            return false;
        }
        attributes.put(ATTR_UPSTREAM_BASE_URL, upstreamBaseUrl.get());
        attributes.put(ATTR_CALLER_ID, callerId);
        attributes.put(ATTR_CALLER_TYPE, AuthType.API_KEY);
        attributes.put(ATTR_PLAN_CAPS, Map.of(
            "maxConcurrent", cap,
            "monthlyMessages", monthlyMessages));
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) { }

    // ── helpers ──────────────────────────────────────────────────────────────

    private String extractToken(ServerHttpRequest request) {
        URI uri = request.getURI();
        String q = uri.getRawQuery();
        if (q != null) {
            for (String kv : q.split("&")) {
                int eq = kv.indexOf('=');
                if (eq > 0 && "access_token".equals(kv.substring(0, eq))) return kv.substring(eq + 1);
            }
        }
        String auth = request.getHeaders().getFirst("Authorization");
        if (auth != null && auth.startsWith("Bearer ")) return auth.substring(7);
        return null;
    }

    private String firstHeader(ServerHttpRequest request, String name) {
        return request.getHeaders().getFirst(name);
    }

    private String clientIp(ServerHttpRequest request) {
        return request.getRemoteAddress() != null
            ? request.getRemoteAddress().getAddress().getHostAddress()
            : "unknown";
    }

    private String extractNetwork(String rawQuery) {
        if (rawQuery == null) return null;
        for (String kv : rawQuery.split("&")) {
            int eq = kv.indexOf('=');
            if (eq > 0 && "network".equals(kv.substring(0, eq))) {
                return kv.substring(eq + 1);
            }
        }
        return null;
    }

    private void deny(ServerHttpResponse response, HttpStatus status, String reason) {
        response.setStatusCode(status);
        metrics.wsConnectionRejected(reason);
        log.info("WS handshake rejected reason={} status={}", reason, status.value());
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -Dtest=MarketDataWsHandshakeInterceptorTest test`
Expected: PASS.

- [ ] **Step 5: Run the full nexus build + market/security test packages**

Run:
```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o test \
  -Dtest='io.gerowallet.ws.marketdata.*,io.gerowallet.controller.marketdata.*,io.gerowallet.facade.*,io.gerowallet.security.*,io.gerowallet.service.marketdata.*,io.gerowallet.config.MarketDataPropertiesTest'
```
Expected: PASS. If `MarketDataProxyControllerIntegrationTest` or
`MarketDataWsRelayIntegrationTest` fail on the renamed attributes / new
constructor args, update them: device-or-API-key principal on the controller
test, `ATTR_CALLER_ID`/`ATTR_CALLER_TYPE` on the relay test. Add one device-path
case to `MarketDataProxyControllerIntegrationTest` — a request authenticated with
a device JWT to `GET /api/v1/market/prices` returns a non-401/403 status —
following that file's existing MockMvc setup.

- [ ] **Step 6: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/java/io/gerowallet/ws/marketdata/MarketDataWsHandshakeInterceptor.java \
        src/test/java/io/gerowallet/ws/marketdata/MarketDataWsHandshakeInterceptorTest.java \
        src/test/java/io/gerowallet/ws/marketdata/MarketDataWsRelayIntegrationTest.java \
        src/test/java/io/gerowallet/controller/marketdata/MarketDataProxyControllerIntegrationTest.java
git commit -m "feat(market-data): WS handshake accepts device JWT + origin/rate limits"
```

---

## Task 13: `application.yml` — device config

**Files:**
- Modify: `nexus/src/main/resources/application.yml`

- [ ] **Step 1: Add the `device` block under `market-data`**

In `application.yml`, inside the `market-data:` section, after the `ws:` block,
add:

```yaml
  device:
    # chrome-extension origins permitted for device-authenticated market
    # requests. Defense-in-depth only — see the design spec security note.
    allowed-origins: ${MARKET_DATA_DEVICE_ALLOWED_ORIGINS:chrome-extension://bgpipimickeadkjlklgciifhnalhdjhe}
    ws-concurrent-cap: ${MARKET_DATA_DEVICE_WS_CONCURRENT_CAP:5}
    rest-rate-limit:
      rps: ${MARKET_DATA_DEVICE_REST_RPS:10}
      burst: ${MARKET_DATA_DEVICE_REST_BURST:20}
    rest-ip-rate-limit:
      rps: ${MARKET_DATA_DEVICE_REST_IP_RPS:50}
      burst: ${MARKET_DATA_DEVICE_REST_IP_BURST:100}
    auth-ip-rate-limit:
      rps: ${MARKET_DATA_DEVICE_AUTH_IP_RPS:2}
      burst: ${MARKET_DATA_DEVICE_AUTH_IP_BURST:10}
    ws-rate-limit:
      rps: ${MARKET_DATA_DEVICE_WS_RPS:1}
      burst: ${MARKET_DATA_DEVICE_WS_BURST:5}
    ws-ip-rate-limit:
      rps: ${MARKET_DATA_DEVICE_WS_IP_RPS:10}
      burst: ${MARKET_DATA_DEVICE_WS_IP_BURST:20}
```

> `allowed-origins` binds a comma-separated env value to `List<String>` via Spring
> relaxed binding. To allowlist more than one origin set
> `MARKET_DATA_DEVICE_ALLOWED_ORIGINS` to a comma-separated list.

- [ ] **Step 2: Verify the app context loads**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o test -Dtest=MarketDataPropertiesTest`
Expected: PASS (config binds without error).

- [ ] **Step 3: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add src/main/resources/application.yml
git commit -m "feat(market-data): add market-data.device config with defaults"
```

---

## Task 14: Full nexus build

**Files:** none — verification gate.

- [ ] **Step 1: Run the full test suite**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o test`
Expected: BUILD SUCCESS. Fix any compile/test fallout from the renamed
`WsSessionTracker` keys or `MarketDataWsHandshakeInterceptor` attributes before
proceeding. Do not continue to Phase 2 until this passes.

- [ ] **Step 2: Commit any fixes**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
git add -A && git commit -m "test(market-data): fix fallout from device-auth changes"
```

(Skip the commit if `git status` is clean.)

---

# Phase 2 — gerowallet

Phase 2 assumes Phase 1 is deployed to the nexus environment that
`VITE_NEXUS_URL` points at (staging for dev verification).

## Task 15: Remove `VITE_MARKET_API_URL`

**Files:**
- Modify: `gerowallet/.env`, `.env.beta`, `.env.development`, `.env.production`, `.env.example`

- [ ] **Step 1: Delete the variable from every env file**

In each of the five files, delete the line assigning `VITE_MARKET_API_URL`
(in `.env.example` it is around line 74; in `.env.development` / `.env.production`
around line 18-19). Leave `VITE_NEXUS_URL` untouched. If a `# MARKET DATA SERVICE`
comment header is left with no keys under it, delete that comment too.

- [ ] **Step 2: Verify nothing else references it**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet" && grep -rn "VITE_MARKET_API_URL" src .env*`
Expected: only matches remain in `src/api/market-api.ts` and
`src/modules/market/composables/useMarketData.ts` — both rewritten in Tasks 16-17.

- [ ] **Step 3: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet"
git add .env .env.beta .env.development .env.production .env.example
git commit -m "chore(market): drop VITE_MARKET_API_URL — market data via nexus only"
```

---

## Task 16: `market-api.ts` — nexus base + device auth

**Files:**
- Modify: `gerowallet/src/api/market-api.ts`
- Test: `gerowallet/src/api/market-api.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/api/market-api.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/nexusDevice.service', () => ({
  getNexusAccessToken: vi.fn().mockResolvedValue('device-jwt-token'),
  reauthenticateNexus: vi.fn().mockResolvedValue('fresh-jwt-token'),
}));

describe('market-api axios instance', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_NEXUS_URL', 'https://nexus.example.test');
    vi.resetModules();
  });

  it('uses VITE_NEXUS_URL as baseURL', async () => {
    const mod = await import('./market-api');
    expect(mod.marketAxiosInstance.defaults.baseURL).toBe('https://nexus.example.test');
  });

  it('request interceptor attaches the device bearer token', async () => {
    const mod = await import('./market-api');
    const handlers = (mod.marketAxiosInstance.interceptors.request as any).handlers;
    const cfg = await handlers[0].fulfilled({ headers: {} });
    expect(cfg.headers.Authorization).toBe('Bearer device-jwt-token');
  });
});
```

> `market-api.ts` currently `export default`s an object of API methods and keeps
> the axios instance module-private. Export the instance as a named export
> `marketAxiosInstance` so it is testable (Step 3).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet" && npm run test -- run src/api/market-api.spec.ts`
Expected: FAIL — `marketAxiosInstance` is not exported / baseURL is the old market host.

- [ ] **Step 3: Update `market-api.ts`**

Replace the axios-instance creation at the top of the file:

```ts
import axios from 'axios';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_MARKET_API_URL'] || 'https://market.gerowallet.io',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});
```

with:

```ts
import axios from 'axios';
import type { AxiosRequestConfig, AxiosError } from 'axios';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';

const axiosInstance = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Market data is proxied by nexus, which authenticates device-id JWTs.
// Attach the device access token to every request.
axiosInstance.interceptors.request.use(async (config) => {
  const token = await getNexusAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, drop the cached token, re-authenticate the device, and retry once.
axiosInstance.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as AxiosRequestConfig & { _retried?: boolean };
    if (error.response?.status === 401 && config && !config._retried) {
      config._retried = true;
      const token = await reauthenticateNexus();
      if (config.headers) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return axiosInstance.request(config);
    }
    return Promise.reject(error);
  }
);

export { axiosInstance as marketAxiosInstance };
```

Leave the rest of the file (the `export default { ... }` API methods) unchanged —
they already call `axiosInstance`.

- [ ] **Step 4: Run test + typecheck**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet" && npm run test -- run src/api/market-api.spec.ts && npm run typecheck`
Expected: test PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet"
git add src/api/market-api.ts src/api/market-api.spec.ts
git commit -m "feat(market): route market REST through nexus with device auth"
```

---

## Task 17: `useMarketData.ts` — nexus base + WS token

**Files:**
- Modify: `gerowallet/src/modules/market/composables/useMarketData.ts`

The WS connection in this file is set up imperatively inside a `connect()`
function (around line 374-480). gerowallet has no harness for testing live
SockJS, so this task is verified by `npm run typecheck` + a manual smoke test.

- [ ] **Step 1: Repoint the REST + WS base URL**

Replace:

```ts
const MARKET_API_BASE = import.meta.env['VITE_MARKET_API_URL'] || 'https://market.gerowallet.io';
```

with:

```ts
const MARKET_API_BASE = import.meta.env['VITE_NEXUS_URL'];
```

- [ ] **Step 2: Attach the device token to the SockJS URL**

Find the WS connect block (the `const url = \`${MARKET_API_BASE}/ws/market\`;`
line, ~450). SockJS cannot set request headers, so the device JWT goes in the
`access_token` query parameter — which the nexus handshake interceptor reads.

Add the import at the top of the file (alongside the other imports):

```ts
import { getNexusAccessToken } from '@/services/nexusDevice.service';
```

Replace:

```ts
  const url = `${MARKET_API_BASE}/ws/market`;
  debugLog(`📡 Market WS: connecting via SockJS to ${url}`);
  const socket = new SockJS(url) as unknown as WebSocket;
```

with:

```ts
  const token = await getNexusAccessToken();
  const url = `${MARKET_API_BASE}/ws/market?access_token=${encodeURIComponent(token)}`;
  debugLog('📡 Market WS: connecting via SockJS to nexus /ws/market');
  const socket = new SockJS(url) as unknown as WebSocket;
```

> The enclosing `connect` function must be `async` for the `await` to compile.
> If it is not already `async`, add the keyword to its declaration. The reconnect
> timer that calls `connect` does not need to await it — a fire-and-forget call is
> fine.

- [ ] **Step 3: Refresh the token on reconnect**

The socket `onclose` handler schedules a reconnect (the
`📡 Market WS: closed, reconnecting in 5s` log, ~479). Because `connect()` now
calls `getNexusAccessToken()` at the top, each reconnect already fetches a fresh
(or cache-valid) token — and `getNexusAccessToken()` refreshes on near-expiry.
No extra change is needed; confirm the reconnect path calls `connect()` (not a
cached socket factory). If the reconnect timer caches anything token-derived,
change it to re-invoke `connect()`.

- [ ] **Step 4: Typecheck + lint**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet" && npm run typecheck && npm run lint`
Expected: clean (fix any ESLint issues in this file per the project rule).

- [ ] **Step 5: Manual smoke test**

Run `npm run dev`, open the extension's Market tab, and confirm in DevTools:
- REST: requests go to `https://nexus.gerowallet.io/api/v1/market/...` with an
  `Authorization: Bearer` header and return 200.
- WS: `https://nexus.gerowallet.io/ws/market?access_token=...` connects; live
  price updates arrive on `/topic/market/prices`.
- No request goes to `market.gerowallet.io`.

- [ ] **Step 6: Commit**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet"
git add src/modules/market/composables/useMarketData.ts
git commit -m "feat(market): stream market WS through nexus with device token"
```

---

## Task 18: Final verification

**Files:** none — verification gate.

- [ ] **Step 1: gerowallet checks**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet" && npm run typecheck && npm run lint && npm run test -- run`
Expected: all clean/pass.

- [ ] **Step 2: nexus build**

Run: `cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus" && mvn -q -o test`
Expected: BUILD SUCCESS.

- [ ] **Step 3: Confirm the spec's testing checklist**

Re-read the spec §Testing and confirm each item maps to a passing test:
device tier bypass (Task 3), WS device JWT accept + API key still works
(Task 12), `WsSessionTracker` string keys (Task 2), rate-limit 429 (Task 6),
origin allowlist 403 (Tasks 4, 8, 12), market REST via nexus + re-auth (Task 16).

---

## Self-review notes

- **Spec coverage:** every spec §5 item maps to a task — REST path (8, 9),
  `SecurityExpressions` (3), WS path (10, 11, 12), origin check (4, 8, 12), rate
  limiting (1, 5, 6, 7, 13), gerowallet (15, 16, 17). §Testing → Task 18 Step 3.
- **`Device` entity builder field names** are assumed (`deviceId`, `enabled`,
  `blocked`, `tokenVersion`, `scopes`) from the `DevicePrincipal` getters; Task 3
  Step 1 instructs verifying against `entity/Device.java` if a builder call fails.
- **Integration tests** (`MarketDataProxyControllerIntegrationTest`,
  `MarketDataWsRelayIntegrationTest`) are updated in Task 12 Step 5 by following
  their existing setup — the executor must read those files, as their full
  current content was not inlined here.
