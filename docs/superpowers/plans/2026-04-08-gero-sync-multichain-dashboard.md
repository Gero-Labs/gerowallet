# gero-sync Phase 3: Multi-Chain Extensibility + Admin Dashboard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make gero-sync chain-agnostic so it supports Cardano, Bitcoin, and future chains behind a common interface. Add a real-time admin dashboard for operational visibility.

**Architecture:** Introduce a `ChainSyncProvider` interface that each chain implements. Cardano uses YACI Store events (existing). Bitcoin uses Esplora/mempool.space REST API with polling. The WebSocket protocol, registry, and handler become chain-agnostic dispatchers. The admin dashboard is a server-rendered HTML page with SSE for live metrics.

**Tech Stack:** Spring Boot 3.5.4, Java 21, YACI Store 2.0.0, Esplora REST API (Bitcoin), Thymeleaf + SSE (dashboard), Chart.js, Micrometer

**Repository:** `/Users/dudiedri/IdeaProjects/A.D. Labs/gero-sync/`

---

## File Structure

```
src/main/java/io/gerowallet/sync/
  model/
    ChainType.java                    — NEW: enum (CARDANO, BITCOIN, APEX_PRIME, APEX_VECTOR)
    ClientSession.java                — MODIFY: rename stakeAddress → monitorAddress, add chainType
    SubscribeMessage.java             — MODIFY: rename stakeAddress → address
    SyncCheckMessage.java             — MODIFY: rename stakeAddress → address
    SyncPayload.java                  — MODIFY: add chain field
  registry/
    AddressRegistry.java              — RENAME from StakeAddressRegistry, compound key: chain+address
  chain/
    ChainSyncProvider.java            — NEW: interface for chain-specific sync
    ChainSyncProviderFactory.java     — NEW: resolves provider by ChainType
    cardano/
      CardanoSyncProvider.java        — NEW: wraps existing Cardano logic
      CardanoBlockListener.java       — RENAME from BlockTransactionListener
      CardanoRollbackListener.java    — RENAME from RollbackListener
      CardanoDataService.java         — RENAME from SyncDataService
    bitcoin/
      BitcoinSyncProvider.java        — NEW: Bitcoin implementation
      BitcoinDataService.java         — NEW: Esplora REST client
      BitcoinBlockPoller.java         — NEW: polls for new blocks, matches addresses
  service/
    CatchUpService.java               — MODIFY: delegate to ChainSyncProviderFactory
    SyncDispatcher.java               — NEW: shared push logic
  dashboard/
    DashboardController.java          — NEW: serves HTML dashboard
    DashboardSseController.java       — NEW: SSE endpoint for live metrics
  config/
    BitcoinConfig.java                — NEW: Bitcoin-specific config properties
src/main/resources/
  templates/dashboard.html            — NEW: Thymeleaf admin dashboard
  static/dashboard.js                 — NEW: SSE + Chart.js for live updates
```

---

## Part A: Multi-Chain Extensibility

### Task 22: ChainType Enum and ChainSyncProvider Interface

**Files:**
- Create: `src/main/java/io/gerowallet/sync/model/ChainType.java`
- Create: `src/main/java/io/gerowallet/sync/chain/ChainSyncProvider.java`
- Create: `src/main/java/io/gerowallet/sync/chain/ChainSyncProviderFactory.java`
- Create: `src/main/java/io/gerowallet/sync/service/SyncDispatcher.java`

- [ ] **Step 1: Create ChainType enum**

```java
package io.gerowallet.sync.model;

import com.fasterxml.jackson.annotation.JsonCreator;

public enum ChainType {
    CARDANO, BITCOIN, APEX_PRIME, APEX_VECTOR;

    @JsonCreator
    public static ChainType fromString(String value) {
        if (value == null) return null;
        return ChainType.valueOf(value.toUpperCase().replace(" ", "_"));
    }
}
```

- [ ] **Step 2: Create ChainSyncProvider interface**

```java
package io.gerowallet.sync.chain;

import io.gerowallet.sync.model.ChainType;
import io.gerowallet.sync.model.SyncPayload;
import java.util.List;

public interface ChainSyncProvider {
    ChainType getChainType();
    List<String> getSupportedNetworks();
    List<SyncPayload.TxData> getTransactionsSince(String address, long sinceBlock);
    String fetchTxData(String txHash);
    SyncPayload.AccountInfo getAccountInfo(String address);
}
```

- [ ] **Step 3: Create ChainSyncProviderFactory**

Spring auto-discovers all `ChainSyncProvider` beans, indexes by `ChainType`:

```java
package io.gerowallet.sync.chain;

import io.gerowallet.sync.model.ChainType;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Slf4j
@Component
public class ChainSyncProviderFactory {
    private final Map<ChainType, ChainSyncProvider> providers;

    public ChainSyncProviderFactory(List<ChainSyncProvider> providerList) {
        this.providers = providerList.stream()
                .collect(Collectors.toMap(ChainSyncProvider::getChainType, Function.identity()));
        log.info("Registered chain sync providers: {}", providers.keySet());
    }

    public ChainSyncProvider getProvider(ChainType chainType) {
        ChainSyncProvider provider = providers.get(chainType);
        if (provider == null) throw new IllegalArgumentException("No sync provider for chain: " + chainType);
        return provider;
    }

    public boolean hasProvider(ChainType chainType) { return providers.containsKey(chainType); }
}
```

- [ ] **Step 4: Create SyncDispatcher**

```java
package io.gerowallet.sync.service;

import io.gerowallet.sync.metrics.SyncMetrics;
import io.gerowallet.sync.model.ClientSession;
import io.gerowallet.sync.model.SyncPayload;
import io.gerowallet.sync.websocket.WalletSyncHandler;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import java.util.Set;

@Slf4j
@Service
@RequiredArgsConstructor
public class SyncDispatcher {
    private final WalletSyncHandler walletSyncHandler;
    private final SyncMetrics syncMetrics;

    public void dispatch(Set<ClientSession> sessions, SyncPayload payload, long blockHeight) {
        for (ClientSession cs : sessions) {
            walletSyncHandler.sendToSession(cs.getSession(), payload);
            cs.setLastPushedBlock(blockHeight);
        }
        syncMetrics.incrementSyncMessagesSent(sessions.size());
    }
}
```

- [ ] **Step 5: Compile and commit**

```bash
JAVA_HOME=/Users/dudiedri/Library/Java/JavaVirtualMachines/corretto-21.0.10/Contents/Home mvn compile
git add . && git commit -m "feat: add ChainType, ChainSyncProvider interface, factory, and dispatcher"
```

---

### Task 23: Refactor Registry and Models for Multi-Chain

**Files:**
- Modify: `ClientSession.java` — rename stakeAddress → monitorAddress, add chainType field
- Modify: `SubscribeMessage.java` — rename stakeAddress → address
- Modify: `SyncCheckMessage.java` — rename stakeAddress → address
- Modify: `SyncPayload.java` — add chain field
- Rename: `StakeAddressRegistry` → `AddressRegistry` with compound key `chain:address`
- Update: All files referencing StakeAddressRegistry and old field names
- Update: All test files

The key change in AddressRegistry is the compound key `ChainType:monitorAddress` so Cardano and Bitcoin addresses don't collide. The `getSessionsByAddress(address)` method searches all chains, while `getSessionsByChainAndAddress(chain, address)` is chain-specific.

- [ ] **Step 1: Update all model classes** (ClientSession, SubscribeMessage, SyncCheckMessage, SyncPayload)
- [ ] **Step 2: Rename and rewrite StakeAddressRegistry → AddressRegistry**
- [ ] **Step 3: Update WalletSyncHandler, BlockTransactionListener, RollbackListener, CatchUpService, SyncMetrics**
- [ ] **Step 4: Update all tests (rename + fix field names)**
- [ ] **Step 5: Compile, run all tests, commit**

```bash
mvn test
git add . && git commit -m "refactor: rename StakeAddressRegistry to AddressRegistry, make models chain-agnostic"
```

---

### Task 24: Extract Cardano Code into CardanoSyncProvider

**Files:**
- Create: `chain/cardano/CardanoSyncProvider.java`
- Rename: `listener/BlockTransactionListener.java` → `chain/cardano/CardanoBlockListener.java`
- Rename: `listener/RollbackListener.java` → `chain/cardano/CardanoRollbackListener.java`
- Rename: `service/SyncDataService.java` → `chain/cardano/CardanoDataService.java`
- Modify: `CatchUpService.java` — delegate to ChainSyncProviderFactory

CardanoSyncProvider implements ChainSyncProvider by delegating to CardanoDataService. CatchUpService resolves the correct provider via `providerFactory.getProvider(clientSession.getChainType())`.

- [ ] **Step 1: Create CardanoSyncProvider**
- [ ] **Step 2: Move and rename Cardano-specific files, update package declarations**
- [ ] **Step 3: Rewrite CatchUpService to use ChainSyncProviderFactory**
- [ ] **Step 4: Update all imports across the project**
- [ ] **Step 5: Run tests, commit**

```bash
mvn test
git add . && git commit -m "refactor: extract Cardano code into CardanoSyncProvider, make CatchUpService chain-agnostic"
```

---

### Task 25: Bitcoin Sync Provider

**Files:**
- Create: `config/BitcoinConfig.java` — `@ConfigurationProperties(prefix = "bitcoin")` with `@ConditionalOnProperty`
- Create: `chain/bitcoin/BitcoinDataService.java` — Esplora REST client (address transactions, address info, tip height, tx hex)
- Create: `chain/bitcoin/BitcoinSyncProvider.java` — implements ChainSyncProvider
- Create: `chain/bitcoin/BitcoinBlockPoller.java` — `@Scheduled` polling for new blocks, checks registered addresses
- Modify: `application.yml` — add bitcoin config section

Bitcoin differences from Cardano:
- No YACI Store — uses Esplora/mempool.space REST API
- No CBOR — transactions returned as raw hex (or null)
- No stake address — monitors individual Bitcoin addresses
- No rewards/delegation — AccountInfo has `controlledAmount` only
- Block polling instead of event-driven (Bitcoin blocks ~10 min, poll every 30s)
- All Bitcoin beans are `@ConditionalOnProperty(name = "bitcoin.enabled", havingValue = "true")`

- [ ] **Step 1: Add Bitcoin config to application.yml**
- [ ] **Step 2: Create BitcoinConfig, BitcoinDataService, BitcoinSyncProvider**
- [ ] **Step 3: Create BitcoinBlockPoller with @Scheduled polling**
- [ ] **Step 4: Compile, test, commit**

```bash
mvn test
git add . && git commit -m "feat: add Bitcoin sync provider with Esplora polling"
```

---

## Part B: Admin Dashboard

### Task 26: Dashboard Backend (Controller + SSE)

**Files:**
- Add `spring-boot-starter-thymeleaf` to pom.xml
- Create: `dashboard/DashboardController.java` — serves Thymeleaf template
- Create: `dashboard/DashboardSseController.java` — SSE endpoint pushing metrics every 2 seconds
- Modify: `SecurityConfig.java` — permit `/dashboard/**`

The SSE controller reads from Micrometer's `MeterRegistry` to get counter values and from `AddressRegistry` for session count. Pushes a JSON event every 2 seconds.

- [ ] **Step 1: Add Thymeleaf dependency**
- [ ] **Step 2: Create DashboardController and DashboardSseController**
- [ ] **Step 3: Permit `/dashboard/**` in SecurityConfig**
- [ ] **Step 4: Compile, commit**

---

### Task 27: Dashboard Frontend (HTML + JS)

**Files:**
- Create: `src/main/resources/templates/dashboard.html` — dark theme, metric cards, time-series chart, address table
- Create: `src/main/resources/static/dashboard.js` — SSE client, Chart.js updates, address list polling

Dashboard features:
- **Metric cards**: Sessions, Addresses, SYNC Messages, Catch-Up Queries, SYNC_CHECKs, Blocks, Rollbacks
- **Time-series chart**: Sessions + Messages/2s over last 5 minutes (Chart.js)
- **Address table**: All registered chain:address pairs with status indicators
- **Auto-updating**: SSE pushes metrics every 2s, address table polls every 5s
- **Dark theme**: GitHub-inspired dark UI

NOTE: The address table uses `textContent` for address values to prevent XSS. Chain and address values from the registry are sanitized via DOM text nodes, not raw HTML insertion.

- [ ] **Step 1: Create dashboard.html with Thymeleaf**
- [ ] **Step 2: Create dashboard.js with SSE + Chart.js**
- [ ] **Step 3: Compile, test, commit**

```bash
mvn test
git add . && git commit -m "feat: add real-time admin dashboard with SSE metrics and charts"
```

---

## Post-Implementation Notes

### Frontend Changes for Bitcoin WebSocket (follow-up)

Replace `startBitcoinPeriodicSync()` with `webSocketService.connect()` for Bitcoin wallets. The `onSync` handler already stores transactions via `setSync()`.

### Multi-Address Bitcoin Monitoring (follow-up)

Current: client sends individual addresses. Future: send xpub, server derives addresses using BIP44/84/86 (needs `bitcoinj` library).

### Dashboard Authentication (follow-up)

Currently open. Add basic auth or restrict via K8s ingress for production.
