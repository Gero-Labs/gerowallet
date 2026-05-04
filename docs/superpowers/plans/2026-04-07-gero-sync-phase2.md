# gero-sync Phase 2: Security, Rollback, Metrics, APEX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the gero-sync service with JWT authentication, implement frontend rollback handling, add operational metrics, configure APEX chain support, and add integration tests.

**Architecture:** JWT validation happens during the WebSocket handshake via a Spring `HandshakeInterceptor` that reads the token from the query parameter. Rollback handling in the frontend deletes invalidated transactions from IndexedDB and resets the sync checkpoint. Prometheus metrics track session counts and sync throughput. APEX chains are added as additional YACI Store configurations.

**Tech Stack:** Spring Boot 3.5.4, Java 21, JJWT 0.13.0, Micrometer Prometheus, Vue.js 2.7 + TypeScript, Dexie (IndexedDB)

**Repositories:**
- `gero-sync`: `/Users/dudiedri/IdeaProjects/A.D. Labs/gero-sync/`
- `gerowallet`: `/Users/dudiedri/IdeaProjects/A.D. Labs/gerowallet/`

---

## File Structure

### gero-sync (modifications + new files)

```
src/main/java/io/gerowallet/sync/
  config/
    SecurityConfig.java              — NEW: Spring Security filter chain
    WebSocketConfig.java             — MODIFY: add HandshakeInterceptor
  security/
    JwtService.java                  — NEW: JWT parsing and validation
    JwtHandshakeInterceptor.java     — NEW: validates token on WS upgrade
  websocket/
    WalletSyncHandler.java           — MODIFY: add metrics counters
  listener/
    BlockTransactionListener.java    — MODIFY: add metrics counters
  metrics/
    SyncMetrics.java                 — NEW: Micrometer metric definitions
  pom.xml                            — MODIFY: add spring-boot-starter-security
  src/main/resources/application.yml — MODIFY: add APEX chain configs
```

### gerowallet (frontend modifications)

```
src/services/
  sync.service.ts                    — MODIFY: add handleRollback()
  walletManager.service.ts           — MODIFY: update onRollback handler
  websocket.service.ts               — MODIFY: pass JWT token in URL
src/api/api.ts                       — MODIFY: add getSyncToken() method
```

---

## Task 13: JWT Authentication on WebSocket Handshake

**Files:**
- Modify: `gero-sync/pom.xml`
- Create: `gero-sync/src/main/java/io/gerowallet/sync/security/JwtService.java`
- Create: `gero-sync/src/main/java/io/gerowallet/sync/security/JwtHandshakeInterceptor.java`
- Create: `gero-sync/src/main/java/io/gerowallet/sync/config/SecurityConfig.java`
- Modify: `gero-sync/src/main/java/io/gerowallet/sync/config/WebSocketConfig.java`
- Test: `gero-sync/src/test/java/io/gerowallet/sync/security/JwtServiceTest.java`

- [ ] **Step 1: Add spring-boot-starter-security to pom.xml**

Add after the existing `spring-boot-starter-actuator` dependency:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
```

- [ ] **Step 2: Write JwtService test**

```java
// gero-sync/src/test/java/io/gerowallet/sync/security/JwtServiceTest.java
package io.gerowallet.sync.security;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

import static org.junit.jupiter.api.Assertions.*;

class JwtServiceTest {

    private JwtService jwtService;
    private static final String SECRET = "VL0OJqRr4YjZ+lb0vqeVs10jiKuzH5f2v3cUtTGjqlI5nVUWmvouWSXPwizIt1fJNfrHWNorDx1lZMu7MpNiwg==";

    @BeforeEach
    void setUp() {
        jwtService = new JwtService(SECRET);
    }

    @Test
    void validateToken_validToken_returnsTrue() {
        String token = createToken(System.currentTimeMillis() + 3600000);
        assertTrue(jwtService.validateToken(token));
    }

    @Test
    void validateToken_expiredToken_returnsFalse() {
        String token = createToken(System.currentTimeMillis() - 1000);
        assertFalse(jwtService.validateToken(token));
    }

    @Test
    void validateToken_invalidSignature_returnsFalse() {
        JwtService otherService = new JwtService("wrongsecretwrongsecretwrongsecretwrongsecretwrongsecretwrongsecret1234");
        String token = createToken(System.currentTimeMillis() + 3600000);
        assertFalse(otherService.validateToken(token));
    }

    @Test
    void validateToken_malformedToken_returnsFalse() {
        assertFalse(jwtService.validateToken("not.a.token"));
    }

    @Test
    void validateToken_nullToken_returnsFalse() {
        assertFalse(jwtService.validateToken(null));
    }

    @Test
    void getSubject_returnsSubjectFromToken() {
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        String token = Jwts.builder()
                .subject("user123")
                .expiration(new Date(System.currentTimeMillis() + 3600000))
                .signWith(key)
                .compact();
        assertEquals("user123", jwtService.getSubject(token));
    }

    private String createToken(long expirationMillis) {
        SecretKey key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
        return Jwts.builder()
                .subject("test-user")
                .expiration(new Date(expirationMillis))
                .signWith(key)
                .compact();
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /Users/dudiedri/IdeaProjects/A.D.\ Labs/gero-sync
JAVA_HOME=/Users/dudiedri/Library/Java/JavaVirtualMachines/corretto-21.0.10/Contents/Home mvn test -Dtest=JwtServiceTest
```
Expected: FAIL — `JwtService` class does not exist

- [ ] **Step 4: Create JwtService**

```java
// gero-sync/src/main/java/io/gerowallet/sync/security/JwtService.java
package io.gerowallet.sync.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;

@Slf4j
@Service
public class JwtService {

    private final SecretKey key;

    public JwtService(@Value("${jwt.secret}") String secret) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    public boolean validateToken(String token) {
        if (token == null || token.isBlank()) {
            return false;
        }
        try {
            Jwts.parser().verifyWith(key).build().parseSignedClaims(token);
            return true;
        } catch (Exception e) {
            log.debug("JWT validation failed: {}", e.getMessage());
            return false;
        }
    }

    public String getSubject(String token) {
        Claims claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
        return claims.getSubject();
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
JAVA_HOME=/Users/dudiedri/Library/Java/JavaVirtualMachines/corretto-21.0.10/Contents/Home mvn test -Dtest=JwtServiceTest
```
Expected: All 6 tests PASS

- [ ] **Step 6: Create JwtHandshakeInterceptor**

```java
// gero-sync/src/main/java/io/gerowallet/sync/security/JwtHandshakeInterceptor.java
package io.gerowallet.sync.security;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class JwtHandshakeInterceptor implements HandshakeInterceptor {

    private final JwtService jwtService;

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                   WebSocketHandler wsHandler, Map<String, Object> attributes) {
        String token = extractToken(request);

        if (token == null || !jwtService.validateToken(token)) {
            log.warn("WebSocket handshake rejected: invalid or missing JWT from {}",
                    request.getRemoteAddress());
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }

        String subject = jwtService.getSubject(token);
        attributes.put("userId", subject);
        log.debug("WebSocket handshake accepted for user: {}", subject);
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                               WebSocketHandler wsHandler, Exception exception) {
        // no-op
    }

    private String extractToken(ServerHttpRequest request) {
        // Try query parameter: ?token=xxx
        var params = UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams();
        String token = params.getFirst("token");
        if (token != null) {
            return token;
        }

        // Try Authorization header: Bearer xxx
        var authHeader = request.getHeaders().getFirst("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            return authHeader.substring(7);
        }

        return null;
    }
}
```

- [ ] **Step 7: Create SecurityConfig**

```java
// gero-sync/src/main/java/io/gerowallet/sync/config/SecurityConfig.java
package io.gerowallet.sync.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/ws/**").permitAll()
                .requestMatchers("/actuator/**").permitAll()
                .anyRequest().authenticated()
            );
        return http.build();
    }
}
```

- [ ] **Step 8: Update WebSocketConfig to add interceptor**

Replace the current `WebSocketConfig.java` content:

```java
// gero-sync/src/main/java/io/gerowallet/sync/config/WebSocketConfig.java
package io.gerowallet.sync.config;

import io.gerowallet.sync.security.JwtHandshakeInterceptor;
import io.gerowallet.sync.websocket.WalletSyncHandler;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
@RequiredArgsConstructor
public class WebSocketConfig implements WebSocketConfigurer {

    private final WalletSyncHandler walletSyncHandler;
    private final JwtHandshakeInterceptor jwtHandshakeInterceptor;

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(walletSyncHandler, "/ws/sync")
                .addInterceptors(jwtHandshakeInterceptor)
                .setAllowedOrigins("*");
    }
}
```

- [ ] **Step 9: Verify compilation and tests**

```bash
JAVA_HOME=/Users/dudiedri/Library/Java/JavaVirtualMachines/corretto-21.0.10/Contents/Home mvn test
```
Expected: All tests pass (6 registry + 6 JWT = 12 total)

- [ ] **Step 10: Commit**

```bash
git add . && git commit -m "feat: add JWT authentication on WebSocket handshake"
```

---

## Task 14: Frontend Rollback Handling

**Files:**
- Modify: `gerowallet/src/services/sync.service.ts`
- Modify: `gerowallet/src/services/walletManager.service.ts`

- [ ] **Step 1: Add handleRollback() to sync.service.ts**

Add this method to the `SyncService` class (after the existing `setSync()` method around line 258):

```typescript
/**
 * Handle a chain rollback by deleting transactions above the rollback point
 * and resetting the sync checkpoint.
 */
async handleRollback(rollbackToSlot: number): Promise<void> {
  debugLog(`Handling rollback to slot ${rollbackToSlot}`);

  const db = await this.walletBg.getDb();

  // Get current sync info to find which block height corresponds to the slot
  const syncInfo = await this.walletBg.getLastSyncInfo();

  // Delete transactions that are above the rollback point
  // Since we store block_height on transactions, we need to find transactions
  // from blocks after the rollback slot. We use the slot as a conservative
  // cutoff — any transaction with a slot > rollbackToSlot is invalidated.
  const txTable = db.table('transactions');
  const allTxs = await txTable.toArray();
  const invalidTxIds = allTxs
    .filter((tx: any) => tx.absolute_slot && tx.absolute_slot > rollbackToSlot)
    .map((tx: any) => tx.id);

  if (invalidTxIds.length > 0) {
    await txTable.bulkDelete(invalidTxIds);
    debugLog(`Deleted ${invalidTxIds.length} invalidated transactions`);
  }

  // Reset sync checkpoint to before the rollback point
  if (syncInfo && syncInfo.slot > rollbackToSlot) {
    await db.table('sync').put({
      id: 1,
      height: 0,
      hash: '',
      slot: rollbackToSlot,
      time: syncInfo.time,
      epoch: syncInfo.epoch,
      epoch_slot: 0,
    });
    debugLog(`Reset sync checkpoint to slot ${rollbackToSlot}`);
  }

  // Trigger a REST sync to re-fetch correct data from the new fork
  try {
    await this.syncViaRest();
    debugLog('Post-rollback REST sync completed');
  } catch (e) {
    debugLog('Post-rollback REST sync failed, will retry on next connection:', e);
  }
}
```

- [ ] **Step 2: Update onRollback handler in walletManager.service.ts**

Find the current stub (around line 316-318):
```typescript
onRollback: async (data: any) => {
  debugLog('Rollback received:', data);
},
```

Replace with:
```typescript
onRollback: async (data: any) => {
  debugLog('Rollback received:', data);
  if (data.rollbackToSlot !== undefined) {
    await walletBg.syncService.handleRollback(data.rollbackToSlot);
  }
},
```

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/dudiedri/IdeaProjects/A.D.\ Labs/gerowallet
npm run typecheck
```
Expected: No new type errors from these changes

- [ ] **Step 4: Commit**

```bash
git add src/services/sync.service.ts src/services/walletManager.service.ts
git commit -m "feat: implement rollback handling — delete invalidated txs and re-sync"
```

---

## Task 15: Prometheus Metrics for gero-sync

**Files:**
- Create: `gero-sync/src/main/java/io/gerowallet/sync/metrics/SyncMetrics.java`
- Modify: `gero-sync/src/main/java/io/gerowallet/sync/websocket/WalletSyncHandler.java`
- Modify: `gero-sync/src/main/java/io/gerowallet/sync/listener/BlockTransactionListener.java`
- Modify: `gero-sync/src/main/java/io/gerowallet/sync/service/CatchUpService.java`

- [ ] **Step 1: Create SyncMetrics**

```java
// gero-sync/src/main/java/io/gerowallet/sync/metrics/SyncMetrics.java
package io.gerowallet.sync.metrics;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.Gauge;
import io.micrometer.core.instrument.MeterRegistry;
import io.gerowallet.sync.registry.StakeAddressRegistry;
import org.springframework.stereotype.Component;

@Component
public class SyncMetrics {

    private final Counter syncMessagesSent;
    private final Counter catchUpQueries;
    private final Counter syncCheckRequests;
    private final Counter rollbacksDetected;
    private final Counter blocksProcessed;

    public SyncMetrics(MeterRegistry registry, StakeAddressRegistry stakeAddressRegistry) {
        // Gauge: current connected session count (auto-updates)
        Gauge.builder("gero_sync_sessions_connected", stakeAddressRegistry, StakeAddressRegistry::getSessionCount)
                .description("Number of connected WebSocket sessions")
                .register(registry);

        this.syncMessagesSent = Counter.builder("gero_sync_messages_sent")
                .description("Total SYNC messages pushed to clients")
                .register(registry);

        this.catchUpQueries = Counter.builder("gero_sync_catchup_queries")
                .description("Total catch-up queries executed on reconnect")
                .register(registry);

        this.syncCheckRequests = Counter.builder("gero_sync_check_requests")
                .description("Total SYNC_CHECK requests from clients")
                .register(registry);

        this.rollbacksDetected = Counter.builder("gero_sync_rollbacks")
                .description("Total chain rollbacks detected")
                .register(registry);

        this.blocksProcessed = Counter.builder("gero_sync_blocks_processed")
                .description("Total blocks processed for address matching")
                .register(registry);
    }

    public void incrementSyncMessagesSent(int count) { syncMessagesSent.increment(count); }
    public void incrementCatchUpQueries() { catchUpQueries.increment(); }
    public void incrementSyncCheckRequests() { syncCheckRequests.increment(); }
    public void incrementRollbacksDetected() { rollbacksDetected.increment(); }
    public void incrementBlocksProcessed() { blocksProcessed.increment(); }
}
```

- [ ] **Step 2: Add metrics to BlockTransactionListener**

In `BlockTransactionListener.java`, add `SyncMetrics` as a dependency and instrument:

- Add field: `private final SyncMetrics syncMetrics;` (add to constructor via `@RequiredArgsConstructor`)
- After the `isSyncMode()` check, before registry check, add: `syncMetrics.incrementBlocksProcessed();`
- After pushing to sessions, add: `syncMetrics.incrementSyncMessagesSent(sessions.size());`

- [ ] **Step 3: Add metrics to CatchUpService**

In `CatchUpService.java`, add `SyncMetrics`:

- Add field: `private final SyncMetrics syncMetrics;`
- In `catchUp()`, after sending payload: `syncMetrics.incrementCatchUpQueries();`
- In `syncCheck()`, at method start: `syncMetrics.incrementSyncCheckRequests();`

- [ ] **Step 4: Add metrics to RollbackListener**

In `RollbackListener.java`, add `SyncMetrics`:

- Add field: `private final SyncMetrics syncMetrics;`
- At start of `onRollback()`: `syncMetrics.incrementRollbacksDetected();`

- [ ] **Step 5: Verify compilation and tests**

```bash
cd /Users/dudiedri/IdeaProjects/A.D.\ Labs/gero-sync
JAVA_HOME=/Users/dudiedri/Library/Java/JavaVirtualMachines/corretto-21.0.10/Contents/Home mvn test
```
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add . && git commit -m "feat: add Prometheus metrics for sessions, sync, catch-up, rollbacks"
```

---

## Task 16: APEX Chain Configuration

**Files:**
- Modify: `gero-sync/src/main/resources/application.yml`

- [ ] **Step 1: Add APEX chain sync profiles to application.yml**

YACI Store supports multiple chain sync connections via Spring profiles. Add APEX chain configurations as commented-out blocks that can be enabled via environment variables:

Add after the existing `store.cardano` section:

```yaml
# APEX Chain Support (uncomment and configure when APEX nodes are available)
# Each APEX chain requires its own database schema to avoid table conflicts.
#
# To enable APEX_PRIME mainnet:
#   Set APEX_PRIME_NODE_HOST, APEX_PRIME_NODE_PORT, APEX_PRIME_PROTOCOL_MAGIC
#   Set APEX_PRIME_POSTGRES_URL pointing to a separate schema
#
# To enable APEX_VECTOR testnet:
#   Set APEX_VECTOR_NODE_HOST, APEX_VECTOR_NODE_PORT, APEX_VECTOR_PROTOCOL_MAGIC
#   Set APEX_VECTOR_POSTGRES_URL pointing to a separate schema
#
# NOTE: APEX chains are Cardano-compatible (same mini-protocols).
# The same YACI Store starters work — just point to the APEX node.
# Each chain needs its own YACI Store instance (separate Spring profile or separate pod).
# For multi-chain support in a single pod, run multiple gero-sync deployments
# with different CARDANO_NODE_HOST/PORT/PROTOCOL_MAGIC env vars.
```

- [ ] **Step 2: Create APEX-specific K8s deployment template**

Create `k8s/prod/deployment-apex-prime.yml`:

```yaml
# k8s/prod/deployment-apex-prime.yml
# APEX Prime mainnet — uses same gero-sync image, different node config
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gero-sync-apex-prime
  namespace: default
spec:
  replicas: 1
  selector:
    matchLabels:
      app: gero-sync-apex-prime
  template:
    metadata:
      labels:
        app: gero-sync-apex-prime
    spec:
      containers:
        - name: gero-sync
          image: edridudi/gero:gero-sync-prod
          imagePullPolicy: Always
          ports:
            - containerPort: 8082
              protocol: TCP
          resources:
            requests:
              cpu: 500m
              memory: 1Gi
            limits:
              cpu: 2000m
              memory: 2Gi
          livenessProbe:
            httpGet:
              path: /actuator/health
              port: 8082
            initialDelaySeconds: 180
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /actuator/health
              port: 8082
            initialDelaySeconds: 120
            periodSeconds: 5
          env:
            - name: POSTGRES_URL
              valueFrom:
                secretKeyRef:
                  name: gero-sync-apex-prime-secrets
                  key: POSTGRES_URL
            - name: POSTGRES_USERNAME
              valueFrom:
                secretKeyRef:
                  name: gero-sync-apex-prime-secrets
                  key: POSTGRES_USERNAME
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: gero-sync-apex-prime-secrets
                  key: POSTGRES_PASSWORD
            - name: JWT_SECRET
              valueFrom:
                secretKeyRef:
                  name: gero-sync-secrets
                  key: JWT_SECRET
            - name: CARDANO_NODE_HOST
              value: "${APEX_PRIME_NODE_HOST}"
            - name: CARDANO_NODE_PORT
              value: "${APEX_PRIME_NODE_PORT}"
            - name: CARDANO_PROTOCOL_MAGIC
              value: "${APEX_PRIME_PROTOCOL_MAGIC}"
            - name: JAVA_OPTS
              value: "-Xms512m -Xmx1536m"
      restartPolicy: Always
```

- [ ] **Step 3: Commit**

```bash
cd /Users/dudiedri/IdeaProjects/A.D.\ Labs/gero-sync
git add . && git commit -m "feat: add APEX chain configuration and K8s deployment template"
```

---

## Task 17: Frontend JWT Token for WebSocket

**Files:**
- Modify: `gerowallet/src/services/websocket.service.ts`

- [ ] **Step 1: Update WebSocket service to include JWT in connection URL**

In `websocket.service.ts`, modify the `connect()` method signature to accept a token, and pass it as a query parameter:

Change the `connect` method to accept a `token` parameter:

```typescript
connect(
  chain: string,
  network: string,
  stakeAddress: string,
  lastSyncedBlock: number,
  token: string,
  handlers: WsHandlers
): void {
  this.close();
  this.chain = chain;
  this.network = network;
  this.stakeAddress = stakeAddress;
  this.lastSyncedBlock = lastSyncedBlock;
  this.token = token;
  this.handlers = handlers;
  this.intentionallyClosed = false;
  this.reconnectAttempt = 0;
  this.openConnection();
}
```

Add `private token: string | null = null;` to the class properties.

In `openConnection()`, change the URL construction:

```typescript
const url = `${this.WS_BASE_URL}/ws/sync?token=${encodeURIComponent(this.token || '')}`;
```

- [ ] **Step 2: Update walletManager to pass token**

In `walletManager.service.ts`, update the `webSocketService.connect()` call to include the wallet's auth token:

```typescript
webSocketService.connect(chain, network, address, lastSyncedBlock, walletBg.token || '', {
  onSync: async (data: any) => {
    // ... existing handler
  },
  onRollback: async (data: any) => {
    // ... existing handler
  },
});
```

Note: `walletBg.token` is the JWT access token obtained during login. If this property doesn't exist or uses a different name, check `walletBg` for the auth token field.

- [ ] **Step 3: Verify typecheck**

```bash
cd /Users/dudiedri/IdeaProjects/A.D.\ Labs/gerowallet
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/services/websocket.service.ts src/services/walletManager.service.ts
git commit -m "feat: pass JWT token in WebSocket connection URL for auth"
```

---

## Task 18: WebSocket Integration Test

**Files:**
- Create: `gero-sync/src/test/java/io/gerowallet/sync/websocket/WalletSyncHandlerIntegrationTest.java`

- [ ] **Step 1: Write integration test**

```java
// gero-sync/src/test/java/io/gerowallet/sync/websocket/WalletSyncHandlerIntegrationTest.java
package io.gerowallet.sync.websocket;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.ActiveProfiles;

import javax.crypto.SecretKey;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import jakarta.websocket.*;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ActiveProfiles("test")
class WalletSyncHandlerIntegrationTest {

    @LocalServerPort
    private int port;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private Session wsSession;

    private static final String JWT_SECRET = "VL0OJqRr4YjZ+lb0vqeVs10jiKuzH5f2v3cUtTGjqlI5nVUWmvouWSXPwizIt1fJNfrHWNorDx1lZMu7MpNiwg==";

    @AfterEach
    void tearDown() throws Exception {
        if (wsSession != null && wsSession.isOpen()) {
            wsSession.close();
        }
    }

    @Test
    void subscribe_andSyncCheck_returnsSyncCheckOk() throws Exception {
        String token = createJwt();
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> receivedMessage = new AtomicReference<>();

        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        wsSession = container.connectToServer(
                new Endpoint() {
                    @Override
                    public void onOpen(Session session, EndpointConfig config) {
                        session.addMessageHandler(String.class, message -> {
                            receivedMessage.set(message);
                            latch.countDown();
                        });
                    }
                },
                ClientEndpointConfig.Builder.create().build(),
                URI.create("ws://localhost:" + port + "/ws/sync?token=" + token)
        );

        // Send SUBSCRIBE
        wsSession.getBasicRemote().sendText(objectMapper.writeValueAsString(
                java.util.Map.of(
                        "type", "SUBSCRIBE",
                        "chain", "CARDANO",
                        "network", "MAINNET",
                        "stakeAddress", "stake1_test_address",
                        "lastSyncedBlock", 999999999
                )
        ));

        // Send SYNC_CHECK — should get SYNC_CHECK_OK since no data exists for this address
        wsSession.getBasicRemote().sendText(objectMapper.writeValueAsString(
                java.util.Map.of(
                        "type", "SYNC_CHECK",
                        "stakeAddress", "stake1_test_address",
                        "lastSyncedBlock", 999999999
                )
        ));

        assertTrue(latch.await(10, TimeUnit.SECONDS), "Should receive response within 10 seconds");

        JsonNode response = objectMapper.readTree(receivedMessage.get());
        assertEquals("SYNC_CHECK_OK", response.get("type").asText());
    }

    @Test
    void connect_withoutToken_rejected() throws Exception {
        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        assertThrows(Exception.class, () ->
                container.connectToServer(
                        new Endpoint() {
                            @Override
                            public void onOpen(Session session, EndpointConfig config) {}
                        },
                        ClientEndpointConfig.Builder.create().build(),
                        URI.create("ws://localhost:" + port + "/ws/sync")
                )
        );
    }

    private String createJwt() {
        SecretKey key = Keys.hmacShaKeyFor(JWT_SECRET.getBytes(StandardCharsets.UTF_8));
        return Jwts.builder()
                .subject("test-user")
                .expiration(new Date(System.currentTimeMillis() + 3600000))
                .signWith(key)
                .compact();
    }
}
```

- [ ] **Step 2: Create test application profile**

Create `src/test/resources/application-test.yml`:

```yaml
spring:
  datasource:
    url: jdbc:h2:mem:testdb;DB_CLOSE_DELAY=-1
    username: sa
    password:
  jpa:
    hibernate:
      ddl-auto: create-drop
  flyway:
    enabled: false

store:
  sync-auto-start: false
  cardano:
    host: localhost
    port: 3001
    protocol-magic: 1

jwt:
  secret: VL0OJqRr4YjZ+lb0vqeVs10jiKuzH5f2v3cUtTGjqlI5nVUWmvouWSXPwizIt1fJNfrHWNorDx1lZMu7MpNiwg==

apiPrefix: /internal/v1

logging:
  level:
    root: WARN
    io.gerowallet.sync: DEBUG
```

- [ ] **Step 3: Add Jakarta WebSocket client dependency for test**

Add to pom.xml in the test dependencies section:

```xml
<dependency>
    <groupId>org.glassfish.tyrus.bundles</groupId>
    <artifactId>tyrus-standalone-client</artifactId>
    <version>2.1.5</version>
    <scope>test</scope>
</dependency>
```

- [ ] **Step 4: Run integration test**

```bash
JAVA_HOME=/Users/dudiedri/Library/Java/JavaVirtualMachines/corretto-21.0.10/Contents/Home mvn test -Dtest=WalletSyncHandlerIntegrationTest
```

Note: This test may need adjustments based on YACI Store's startup behavior in test mode. If the test fails because YACI Store tries to connect to a Cardano node, ensure `store.sync-auto-start=false` in the test profile prevents that.

- [ ] **Step 5: Commit**

```bash
git add . && git commit -m "test: add WebSocket integration test with JWT auth validation"
```

---

## Post-Implementation Notes

### Deployment Order

1. Deploy `gero-sync` to dev (preprod) first
2. Update frontend env var `VITE_SYNC_WS_URL` to point to dev gero-sync
3. Test end-to-end: login → WebSocket connects → transactions appear via push
4. Deploy to prod with mainnet node config
5. Remove Ably API key from gero-backend env vars
6. Monitor Prometheus metrics: `gero_sync_sessions_connected`, `gero_sync_messages_sent`

### APEX Deployment

APEX chains run as separate gero-sync pods (same Docker image, different env vars):
- `CARDANO_NODE_HOST` → APEX node host
- `CARDANO_PROTOCOL_MAGIC` → APEX protocol magic
- `POSTGRES_URL` → separate database schema

The frontend connects to the appropriate gero-sync endpoint based on the wallet's chain/network.
