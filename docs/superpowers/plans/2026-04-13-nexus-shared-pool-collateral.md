# Nexus Shared-Pool Collateral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

---

## ✅ STATUS — updated 2026-07-16: CODE SHIPPED, feature gated OFF in prod

**All code is implemented and merged to `development` across all three repos.** What remains is operational rollout (fund pool, provision secret, flip kill switch), not coding. The task-by-task body below is retained as historical record but the **client and Nexus architecture shipped in a simpler, revised form** — read this banner first; where it conflicts with the body, this banner wins. See the rollout runbook: `docs/superpowers/plans/2026-07-16-collateral-rollout-runbook.md`.

### What shipped where

| Repo                   | State                                                         | Notes                                                                                          |
|------------------------|---------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| `gerowallet` (client)  | Merged to `development`                                       | `4fac8df2` cosign + `d1f8779c` route via gero-backend proxy + `aee78e62` drop `/v1`            |
| `gero-backend` (proxy) | Merged to `development` (auto-deploys prod)                   | `NexusController` forwards `/api/collateral/{lend,status,cosign}` with server-side `X-Api-Key` |
| `nexus` (backend)      | Merged to `development` (`#177`), prod k8s wired (`55090018`) | Single GKE cluster; push to `development`/`main` auto-deploys `nexus.gerowallet.io`            |

### Architecture divergences from the body below (the body is superseded on these points)

1. **No client-side cache/service/store/UI.** `nexusCollateralService.ts`, `walletStore.nexusCollateral`, the CollateralTab "Gero-provided" state, and the i18n keys were **not built** (Tasks 2 partial, 3, 5, 8, 9). Instead `getCollateral()` in `serialization.ts` is now **async** and lends on-demand: Pass 1 uses the user's own pure-ADA UTxOs, Pass 2 calls `nexusCollateralApi.lend()` and builds the CBOR locally (`buildNexusUtxoCbor`). Simpler, no persistence, no periodic `/status` polling.
2. **No Nexus DB pool table.** The Flyway `V19` migration, `CollateralPoolUtxo` entity, repository, `CollateralPoolInitService`, and `CollateralPoolMonitor` (Tasks A3–A6) were **not built**. `CollateralService.eligibleUtxos()` reads pool state **directly on-chain** each call (UTxOs at the hot-wallet address with exactly `amountLovelace` and no assets), backed by the address facade's existing 10-min cache.
3. **Auth is the gero-backend proxy, not a client device-JWT.** The client sends no auth header. `gero-backend`'s `NexusController` injects `X-Api-Key` (`NexusApiKeyResolver.keyFor(null)` → default key). Nexus's `CollateralController` still guards with `@PreAuthorize("@securityExpressions.canWriteCardano()")` — satisfied by the proxy key, identical to the already-live `/api/tx/build`.
4. **Signing key is a 24-word mnemonic, not raw skey hex.** `CollateralSigningService` derives a `cardano-client-lib` `Account` from `COLLATERAL_HOT_WALLET_MNEMONIC` and **refuses to sign** unless the derived enterprise address equals `COLLATERAL_HOT_WALLET_ADDRESS` (config-mismatch fail-safe). It filters the signed witness set down to only the hot-wallet vkey witness.
5. **Endpoint base is `/api/collateral`, not `/v1/collateral`.**

### What blocks go-live (prod `nexus/k8s/prod/deployment.yml`)

```
COLLATERAL_KILL_SWITCH = "true"      # feature OFF
COLLATERAL_NETWORK     = "PREPROD"   # not mainnet
collateral-hot-wallet-* = placeholder secret (addr_test1..., "your-24-word-mnemonic")
```
Plus: the hot-wallet enterprise address must be **funded** with ~20 × 5 ADA pure-ADA UTxOs or `/lend` returns `503 Collateral pool empty`.

> ⚠️ **Go-live config trap** (confirm in runbook): `CollateralSigningService.init()` selects the network with `"MAINNET".equalsIgnoreCase(network) ? mainnet : preprod`. Set `COLLATERAL_NETWORK` to exactly **`MAINNET`** for mainnet — `CARDANO_MAINNET`/kebab forms make the signer derive a **preprod** address, which mismatches the configured address and **silently self-disables** the signer (→ 503). `CollateralService.resolveNetwork()` is more lenient than `init()`, so the two can disagree.

---

**Goal:** Eliminate the "I need 5 spare ADA to use any dApp" onboarding blocker by sharing a small fixed pool of 5 ADA UTxOs across all users. Each wallet caches a pool UTxO reference in its local DB; `getCollateral()` returns it instantly with no network call; Nexus co-signs only when a dApp actually uses the collateral.

**Architecture:** Nexus maintains a fixed pool of ~20 UTxOs at a single enterprise address controlled by its hot wallet payment key. Because collateral inputs are only referenced (not consumed) in the success path, multiple users can reference the same UTxO simultaneously. On wallet login, the client lends one from the pool and persists the reference in `wallet-db`. On subsequent dApp interactions, `getCollateral()` returns from cache — zero network calls. On `signTx`, if the transaction's `collateralInputs` include the cached Nexus UTxO, the background calls `/v1/collateral/cosign` and merges both witnesses before returning to the dApp. Periodic sync ticks validate the cached UTxO is still on-chain; if consumed (rare, Phase 2 failure elsewhere), the cache is refreshed.

**Repos touched:** `gerowallet` (Chrome extension client) + `nexus` (backend, `../nexus`).

**Tech Stack:**
- Client: Vue 2.7, TypeScript, Vuetify 2.7, `@cardano-sdk/core` v0.46.9, Axios, Dexie 4.0.7, existing Nexus JWT auth (`nexusDevice.service.ts`).
- Backend: Java 21, Spring Boot 3.5.4, `cardano-client-lib` 0.7.1 (for signing + CBOR parsing), PostgreSQL + Flyway, existing device-JWT auth via `@PreAuthorize("@securityExpressions.canWriteCardano()")`.

**Design evolution (why this plan exists):** An earlier draft proposed a standalone Node.js `gero-collateral` service — abandoned in favor of folding the feature into Nexus (existing infra, existing auth, no new deployment). A second draft used franken addresses (Nexus payment key + user stake key) for auto-discovery via sync — abandoned because it requires 5 ADA per user (non-scalable) versus a shared pool where UTxO sharing is safe (collateral inputs are referenced but not consumed in the success path).

---

## Why Nexus (not gero-sync, not standalone)

A sister service `gero-sync` exists (Java/Spring, `wss://sync.gerowallet.io/ws/sync`) but is **deliberately** a read-only push-based chain sync. It has no signing libraries, no key management, no DB, no transaction building — it queries Nexus for authoritative Cardano data. Adding `/lend`, `/cosign`, `/status` to gero-sync would break its single-responsibility design and horizontal scalability.

Nexus already has:
- Authoritative UTxO index (by address and stake address)
- `POST /v1/tx/build` — coin selection and fee calculation
- Device JWT auth shared with `nexus-tx-api.ts` (no new auth layer needed)
- Backend-to-backend Nexus API key (private) — available for internal hot-wallet signing if the collateral service lives as a Nexus module
- Transaction CBOR fetching (`POST /v1/transactions/cbor`)

Collateral is a **write-path, signing-coordinator** feature. Nexus is the only existing Gero backend equipped for it. No new deployment, no new env var, no new CSP entry.

### gero-sync's role in this feature

**None (v1).** The pool UTxO lives at a Nexus-controlled enterprise address — not at any user's stake address. gero-sync subscribes to user stake addresses and pushes transactions affecting them. The Nexus pool UTxOs are outside that subscription. This means:
- gero-sync will **not** notify clients when a pool UTxO is consumed
- Client-side polling via `/v1/collateral/status` is the only validation mechanism in v1

**Potential Phase 2:** Add a new gero-sync channel or broadcast for pool state changes, so Nexus can push "UTxO X consumed" to all connected wallets holding X in cache. Out of scope for v1 — 10-min TTL polling is sufficient given how rare Phase 2 failures are.

---

## Decisions (Resolved)

| #  | Decision       | Resolution                                                                                                                           |
|----|----------------|--------------------------------------------------------------------------------------------------------------------------------------|
| D1 | Backend        | **Nexus** — existing infra, no new service                                                                                           |
| D2 | URL / env var  | Same `VITE_NEXUS_URL` — CSP already allows `*.gerowallet.io`                                                                         |
| D3 | Pool size      | **~20 UTxOs × 5 ADA = 100 ADA** total hot wallet funding (not per user — shared across all users)                                    |
| D4 | Key management | Whatever Nexus already uses for server-side secrets                                                                                  |
| D5 | dApp allowlist | **Open** — Nexus verifies `utxoRef` is only in `collateralInputs`, never in `inputs`                                                 |
| D6 | Rate limiting  | Device JWT rate limits `/lend` to once per minute per device                                                                         |
| D7 | Kill switch    | Nexus config flag. Client degrades gracefully to "Set Collateral" manual flow                                                        |
| D8 | Address type   | **Enterprise address** (payment key only, no staking) — simpler, not tied to any user's stake                                        |
| D9 | UTxO sharing   | Many users can reference the same pool UTxO simultaneously (collateral is only consumed on Phase 2 failure, which is extremely rare) |

---

## Out of Scope (v1)

- Hardware wallet co-signing (Ledger/Trezor/Keystone users still need their own collateral)
- Multi-collateral-input transactions (single 5 ADA UTxO per tx)
- Automatic pool replenishment from treasury (manual top-up in v1)
- Preprod/Preview multi-network (mainnet only in v1; Preprod for testing)
- Real-time pool UTxO consumption notifications (poll-based validation in v1)

---

## Key Context for the Engineer

### Why shared pool works

A collateral input is **referenced** in a transaction but **not consumed** in the success path. It's only consumed if Phase 2 (Plutus) validation fails — which is extremely rare (Eternl saw 5 consumptions in 4 months across their entire user base with 19 UTxOs).

This means multiple users can safely reference the same UTxO at the same time. If User A's tx fails Phase 2 and consumes pool-UTxO-7, only User B's *pending* tx (if it also references pool-UTxO-7) will fail on submission. The loss is limited to that one UTxO.

### Client architecture summary

| Flow                                | Nexus call?                  | Performance                   |
|-------------------------------------|------------------------------|-------------------------------|
| Wallet login (no cache)             | `POST /lend`                 | Once per wallet lifetime      |
| Wallet login (cached)               | `GET /status?ref=...`        | Lightweight validation        |
| Regular sync tick (every ~60s)      | `GET /status?ref=...`        | Background only               |
| dApp `getCollateral()`              | **None** — served from cache | Instant                       |
| dApp `signTx` with Nexus collateral | `POST /cosign`               | Unavoidable (Nexus holds key) |

### Persistence

The cached Nexus collateral UTxO is stored in the per-wallet Dexie DB (`wallet-db`), `config` table, under key `nexusCollateral`. The config table is already key-value (`key, value`) — no schema migration required.

Shape of the cached value:
```typescript
{
  utxoRef: string;        // "txHash#index"
  utxoCbor: string;       // Pre-serialized TransactionUnspentOutput CBOR
  address: string;        // Nexus enterprise address (bech32)
  lentAt: number;         // Timestamp of /lend
  validatedAt: number;    // Timestamp of last /status check
}
```

The same value is mirrored in-memory in `walletStore.nexusCollateral` for O(1) access from the background script.

### Why `getCollateral()` in `serialization.ts` needs a fallback

Current code at `serialization.ts:424-475` filters `storedUtxos` for pure-ADA UTxOs and returns their CBOR. The Nexus UTxO is NOT in `storedUtxos` (it's at Nexus's enterprise address, not the user's addresses — the existing franken filter in `walletBg.ts` would remove it even if it were). So we append the cached Nexus UTxO CBOR to the result when the user has no suitable own collateral.

### Failure modes

| Scenario                                                       | Behavior                                                                                                                                                |
|----------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|
| Nexus down on login, no cache                                  | Fall back to existing "no collateral" state; manual "Set Collateral" still works                                                                        |
| Nexus down on login, cache exists                              | Use cache optimistically; will work if UTxO still valid on-chain                                                                                        |
| Cached UTxO consumed mid-session (rare)                        | `cosign` returns 404 → client clears cache, fetches fresh UTxO. Current dApp tx fails (UTxO baked into already-signed tx); user retries with fresh UTxO |
| Pool exhausted                                                 | `/lend` returns 503 → client treats as no Nexus collateral                                                                                              |
| Cosign returns 400 (UTxO in inputs, not just collateralInputs) | dApp tx rejected before signing — this is an adversarial dApp. Return error to UI.                                                                      |

---

## File Structure

### Nexus Backend (`../nexus`)

| File                                                                            | Action     | Responsibility                                          |
|---------------------------------------------------------------------------------|------------|---------------------------------------------------------|
| `src/main/java/io/gerowallet/config/properties/CollateralProperties.java`       | **Create** | Hot wallet + pool config binding                        |
| `src/main/java/io/gerowallet/entity/CollateralPoolUtxo.java`                    | **Create** | JPA entity for pool UTxOs                               |
| `src/main/java/io/gerowallet/repository/CollateralPoolUtxoRepository.java`      | **Create** | Spring Data JPA repo                                    |
| `src/main/java/io/gerowallet/service/collateral/CollateralSigningService.java`  | **Create** | Ed25519 + blake2b signing with hot wallet key           |
| `src/main/java/io/gerowallet/service/collateral/CollateralPoolInitService.java` | **Create** | Startup reconcile of DB ↔ chain                         |
| `src/main/java/io/gerowallet/service/collateral/CollateralPoolMonitor.java`     | **Create** | @Scheduled 5-min reconcile tick                         |
| `src/main/java/io/gerowallet/service/collateral/CollateralService.java`         | **Create** | lend / status / cosign business logic + security checks |
| `src/main/java/io/gerowallet/facade/CollateralFacade.java`                      | **Create** | Thin facade (codebase convention)                       |
| `src/main/java/io/gerowallet/model/collateral/*.java`                           | **Create** | Request/response DTOs                                   |
| `src/main/java/io/gerowallet/controller/collateral/CollateralController.java`   | **Create** | REST endpoints                                          |
| `src/main/resources/db/migration/V19__create_collateral_pool.sql`               | **Create** | Flyway migration                                        |
| `src/main/resources/application.yml`                                            | **Modify** | Bind `app.collateral.*` properties                      |
| `.env`                                                                          | **Modify** | Hot wallet secrets                                      |
| `src/main/java/io/gerowallet/NexusApplication.java`                             | **Modify** | `@EnableAsync` + `@EnableScheduling`                    |
| `src/test/java/io/gerowallet/service/collateral/CollateralServiceTest.java`     | **Create** | Unit tests                                              |

### Client (Chrome Extension — this plan)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/api/nexus-collateral-api.ts` | **Create** | Axios client for `/lend`, `/status`, `/cosign` with JWT auth |
| `src/services/nexusCollateralService.ts` | **Create** | Business logic: read/write DB cache, lend, validate, refresh |
| `src/stores/walletStore.ts` | **Modify** | Add `nexusCollateral` to state + setter + logout/switch reset |
| `src/chrome/background.ts` | **Modify** | Init on login, periodic validation, SIGN_TX co-sign + witness merge |
| `src/chrome/serialization.ts` | **Modify** | `getCollateral()` fallback to Nexus UTxO when user has no suitable own collateral |
| `src/modules/dashboard/components/CollateralTab.vue` | **Modify** | Show "Collateral provided by Gero" state with Nexus UTxO details |
| `src/plugins/i18n/us.ts` | **Modify** | Add Nexus collateral status keys |
| `src/plugins/i18n/de.ts` | **Modify** | Add German translations |

**Files NOT touched:**
- `src/chrome/walletBg.ts` — franken filter is unchanged (Nexus UTxO lives at enterprise address, not in user's sync results)
- `src/stores/walletStore.ts` auto-detect — user-owned collateral naturally wins (existing logic unchanged)
- `src/shared/utils/builder.ts` — `excludeCollateral: true` already protects user's own collateral; the Nexus UTxO is never in user's UTxO set so never in the selection pool
- `src/popup/modules/views/SignTx.vue`, `src/sidepanel/components/DAppOverlay.vue` — co-signing happens in background, transparent to UI
- `.env.*`, `scripts/manifest.ts` — no new env vars or CSP changes
- `src/db/wallet-db.ts` schema — use existing `config` key-value table

---

## Tasks

All Phase A tasks run in the `nexus` repo at `/Users/dudiedri/IdeaProjects/A.D. Labs/nexus`. All Phase B tasks run in the `gerowallet` repo. Phase B can be written without Phase A deployed (client degrades gracefully) but must not be merged to production ahead of Phase A.

### Prerequisite (manual, one-time): Generate and fund the hot wallet

Before any Phase A task:

1. Generate an Ed25519 key pair for the collateral hot wallet (keep offline; store the signing key in a password manager)
2. Derive the enterprise address (payment credential only, no staking)
3. Fund the address with ~100 ADA, split into 20 UTxOs of 5 ADA each
4. Record: `HOT_WALLET_SKEY_HEX` (32 bytes), `HOT_WALLET_ADDRESS` (bech32)

Commands for a Linux workstation:
```bash
# Using cardano-cli (requires Cardano node binaries)
cardano-cli address key-gen \
  --verification-key-file collateral.vkey \
  --signing-key-file collateral.skey
cardano-cli address build \
  --payment-verification-key-file collateral.vkey \
  --mainnet \
  --out-file collateral.addr
cat collateral.addr   # copy the addr1v... value
```

Then fund the address and split into 20 UTxOs via any Cardano wallet or a one-off tx.

---

## Phase A: Nexus backend (`../nexus`)

### Task A1: Configuration for hot wallet + pool parameters

**Files:**
- Modify: `nexus/.env`
- Modify: `nexus/src/main/resources/application.yml`
- Create: `nexus/src/main/java/io/gerowallet/config/properties/CollateralProperties.java`

- [ ] **Step 1: Add env vars to `.env`**

Append to `nexus/.env`:

```env
# Collateral pool hot wallet (keep secret!)
COLLATERAL_HOT_WALLET_SKEY_HEX=<32 bytes hex — the Ed25519 signing key>
COLLATERAL_HOT_WALLET_ADDRESS=addr1v...
COLLATERAL_AMOUNT_LOVELACE=5000000
COLLATERAL_POOL_SIZE=20
COLLATERAL_KILL_SWITCH=false
COLLATERAL_NETWORK=MAINNET
```

- [ ] **Step 2: Bind to `application.yml`**

Add at the end of `nexus/src/main/resources/application.yml`:

```yaml
app:
  collateral:
    hot-wallet-skey-hex: ${COLLATERAL_HOT_WALLET_SKEY_HEX:}
    hot-wallet-address: ${COLLATERAL_HOT_WALLET_ADDRESS:}
    amount-lovelace: ${COLLATERAL_AMOUNT_LOVELACE:5000000}
    pool-size: ${COLLATERAL_POOL_SIZE:20}
    kill-switch: ${COLLATERAL_KILL_SWITCH:false}
    network: ${COLLATERAL_NETWORK:MAINNET}
```

- [ ] **Step 3: Create `CollateralProperties.java`**

Create `nexus/src/main/java/io/gerowallet/config/properties/CollateralProperties.java`:

```java
package io.gerowallet.config.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

@Component
@ConfigurationProperties(prefix = "app.collateral")
public class CollateralProperties {
    private String hotWalletSkeyHex;
    private String hotWalletAddress;
    private long amountLovelace = 5_000_000L;
    private int poolSize = 20;
    private boolean killSwitch = false;
    private String network = "MAINNET";

    // Getters and setters
    public String getHotWalletSkeyHex() { return hotWalletSkeyHex; }
    public void setHotWalletSkeyHex(String hotWalletSkeyHex) { this.hotWalletSkeyHex = hotWalletSkeyHex; }
    public String getHotWalletAddress() { return hotWalletAddress; }
    public void setHotWalletAddress(String hotWalletAddress) { this.hotWalletAddress = hotWalletAddress; }
    public long getAmountLovelace() { return amountLovelace; }
    public void setAmountLovelace(long amountLovelace) { this.amountLovelace = amountLovelace; }
    public int getPoolSize() { return poolSize; }
    public void setPoolSize(int poolSize) { this.poolSize = poolSize; }
    public boolean isKillSwitch() { return killSwitch; }
    public void setKillSwitch(boolean killSwitch) { this.killSwitch = killSwitch; }
    public String getNetwork() { return network; }
    public void setNetwork(String network) { this.network = network; }
}
```

- [ ] **Step 4: Verify it compiles**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn compile -q
```

- [ ] **Step 5: Commit**

```bash
git add src/main/java/io/gerowallet/config/properties/CollateralProperties.java \
        src/main/resources/application.yml .env
git commit -m "feat(collateral): add hot wallet pool configuration"
```

---

### Task A2: Hot wallet signing service (Ed25519 + blake2b)

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/service/collateral/CollateralSigningService.java`

- [ ] **Step 1: Create the signing service**

Create `nexus/src/main/java/io/gerowallet/service/collateral/CollateralSigningService.java`:

```java
package io.gerowallet.service.collateral;

import com.bloxbean.cardano.client.crypto.Blake2bUtil;
import com.bloxbean.cardano.client.crypto.SecretKey;
import com.bloxbean.cardano.client.crypto.VerificationKey;
import com.bloxbean.cardano.client.transaction.spec.Transaction;
import com.bloxbean.cardano.client.transaction.spec.TransactionWitnessSet;
import com.bloxbean.cardano.client.transaction.spec.VkeyWitness;
import com.bloxbean.cardano.client.util.HexUtil;
import io.gerowallet.config.properties.CollateralProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;

/**
 * Signs transaction bodies with the collateral hot wallet's Ed25519 key.
 * The signing key is loaded from configuration at startup and held in memory.
 *
 * Exposes:
 *   - buildWitnessFor(Transaction): builds a TransactionWitnessSet with one
 *     VKeyWitness signing the tx body hash. Returns CBOR hex.
 *   - getAddress(): the hot wallet's enterprise address (bech32).
 */
@Service
public class CollateralSigningService {

    private static final Logger log = LoggerFactory.getLogger(CollateralSigningService.class);

    private final CollateralProperties properties;
    private SecretKey signingKey;
    private VerificationKey verificationKey;

    public CollateralSigningService(CollateralProperties properties) {
        this.properties = properties;
    }

    @PostConstruct
    void init() {
        if (properties.getHotWalletSkeyHex() == null || properties.getHotWalletSkeyHex().isBlank()) {
            log.warn("Collateral hot wallet skey not configured — /v1/collateral/* endpoints will return 503");
            return;
        }
        byte[] skeyBytes = HexUtil.decodeHexString(properties.getHotWalletSkeyHex());
        this.signingKey = new SecretKey(skeyBytes);
        this.verificationKey = VerificationKey.create(signingKey);
        log.info("Collateral hot wallet loaded. vkey={}...", HexUtil.encodeHexString(verificationKey.getBytes()).substring(0, 16));
    }

    public boolean isReady() {
        return signingKey != null && !properties.isKillSwitch();
    }

    /**
     * Build a TransactionWitnessSet containing a single VKeyWitness over the
     * blake2b-256 hash of the transaction body. Returns CBOR hex.
     */
    public String buildWitnessForTx(Transaction tx) throws Exception {
        if (!isReady()) {
            throw new IllegalStateException("Collateral signing service not ready");
        }

        byte[] txBodyBytes = tx.getBody().serialize();
        byte[] txBodyHash = Blake2bUtil.blake2bHash256(txBodyBytes);

        // cardano-client-lib Ed25519 signing
        byte[] signature = signingKey.sign(txBodyHash);

        VkeyWitness vkeyWitness = new VkeyWitness(
            verificationKey.getBytes(),
            signature
        );

        TransactionWitnessSet witnessSet = new TransactionWitnessSet();
        witnessSet.getVkeyWitnesses().add(vkeyWitness);

        return HexUtil.encodeHexString(witnessSet.serialize());
    }

    public String getHotWalletAddress() {
        return properties.getHotWalletAddress();
    }

    public long getCollateralAmountLovelace() {
        return properties.getAmountLovelace();
    }
}
```

**Note:** `SecretKey.sign()` and `VerificationKey.create()` are cardano-client-lib 0.7.1 APIs. If exact method names differ (e.g., if the library uses `com.bloxbean.cardano.client.crypto.api.SigningProvider` or `Ed25519SigningProvider`), adapt accordingly. Search:

```bash
grep -rn "class SigningProvider\|interface SigningProvider\|class Ed25519" \
  ~/.m2/repository/com/bloxbean/cardano/cardano-client-lib/0.7.1/ | head -20
```

- [ ] **Step 2: Verify compile**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn compile -q
```

- [ ] **Step 3: Commit**

```bash
git add src/main/java/io/gerowallet/service/collateral/CollateralSigningService.java
git commit -m "feat(collateral): hot wallet Ed25519 signing service"
```

---

### Task A3: Flyway migration for pool state

**Files:**
- Create: `nexus/src/main/resources/db/migration/V19__create_collateral_pool.sql`

- [ ] **Step 1: Verify V18 is the latest migration**

```bash
ls -la "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus/src/main/resources/db/migration/" | tail -5
```

If the latest version number is different from V18, use the next available number (e.g., if V20 exists use V21).

- [ ] **Step 2: Create the migration**

Create `nexus/src/main/resources/db/migration/V19__create_collateral_pool.sql`:

```sql
CREATE TABLE collateral_pool_utxos (
    id              BIGSERIAL PRIMARY KEY,
    tx_hash         VARCHAR(64) NOT NULL,
    output_index    INTEGER NOT NULL,
    address         TEXT NOT NULL,
    lovelace        BIGINT NOT NULL,
    utxo_cbor_hex   TEXT NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    lent_count      BIGINT NOT NULL DEFAULT 0,
    last_lent_at    TIMESTAMP WITH TIME ZONE,
    consumed_at     TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    CONSTRAINT uk_collateral_utxo UNIQUE (tx_hash, output_index),
    CONSTRAINT ck_collateral_status CHECK (status IN ('AVAILABLE', 'CONSUMED', 'RECLAIMED'))
);

CREATE INDEX idx_collateral_status ON collateral_pool_utxos(status);
CREATE INDEX idx_collateral_last_lent_at ON collateral_pool_utxos(last_lent_at);

COMMENT ON TABLE collateral_pool_utxos IS 'Shared pool of 5 ADA UTxOs at the hot wallet enterprise address. Each UTxO can be referenced as collateral by many wallets concurrently. Consumed only on Phase 2 validation failure.';
COMMENT ON COLUMN collateral_pool_utxos.utxo_cbor_hex IS 'Pre-serialized TransactionUnspentOutput CBOR for immediate return to CIP-30 clients.';
COMMENT ON COLUMN collateral_pool_utxos.lent_count IS 'Telemetry: how many times this UTxO has been returned by /lend.';
```

- [ ] **Step 3: Run the migration locally to verify**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn spring-boot:run -Dspring-boot.run.arguments="--spring.profiles.active=dev" -q &
sleep 15
# Verify with psql or the Nexus admin UI
```

Expected: migration V19 runs without errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/resources/db/migration/V19__create_collateral_pool.sql
git commit -m "feat(collateral): add collateral_pool_utxos table"
```

---

### Task A4: Entity + Repository

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/entity/CollateralPoolUtxo.java`
- Create: `nexus/src/main/java/io/gerowallet/repository/CollateralPoolUtxoRepository.java`

- [ ] **Step 1: Create the entity**

Create `nexus/src/main/java/io/gerowallet/entity/CollateralPoolUtxo.java`:

```java
package io.gerowallet.entity;

import jakarta.persistence.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "collateral_pool_utxos",
        uniqueConstraints = @UniqueConstraint(columnNames = {"tx_hash", "output_index"}))
public class CollateralPoolUtxo {

    public enum Status { AVAILABLE, CONSUMED, RECLAIMED }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "tx_hash", nullable = false, length = 64)
    private String txHash;

    @Column(name = "output_index", nullable = false)
    private Integer outputIndex;

    @Column(nullable = false, columnDefinition = "text")
    private String address;

    @Column(nullable = false)
    private Long lovelace;

    @Column(name = "utxo_cbor_hex", nullable = false, columnDefinition = "text")
    private String utxoCborHex;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Status status = Status.AVAILABLE;

    @Column(name = "lent_count", nullable = false)
    private Long lentCount = 0L;

    @Column(name = "last_lent_at")
    private OffsetDateTime lastLentAt;

    @Column(name = "consumed_at")
    private OffsetDateTime consumedAt;

    @CreationTimestamp
    @Column(name = "created_at", updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    // Getters and setters (standard JavaBean pattern)
    public Long getId() { return id; }
    public String getTxHash() { return txHash; }
    public void setTxHash(String txHash) { this.txHash = txHash; }
    public Integer getOutputIndex() { return outputIndex; }
    public void setOutputIndex(Integer outputIndex) { this.outputIndex = outputIndex; }
    public String getAddress() { return address; }
    public void setAddress(String address) { this.address = address; }
    public Long getLovelace() { return lovelace; }
    public void setLovelace(Long lovelace) { this.lovelace = lovelace; }
    public String getUtxoCborHex() { return utxoCborHex; }
    public void setUtxoCborHex(String utxoCborHex) { this.utxoCborHex = utxoCborHex; }
    public Status getStatus() { return status; }
    public void setStatus(Status status) { this.status = status; }
    public Long getLentCount() { return lentCount; }
    public void setLentCount(Long lentCount) { this.lentCount = lentCount; }
    public OffsetDateTime getLastLentAt() { return lastLentAt; }
    public void setLastLentAt(OffsetDateTime lastLentAt) { this.lastLentAt = lastLentAt; }
    public OffsetDateTime getConsumedAt() { return consumedAt; }
    public void setConsumedAt(OffsetDateTime consumedAt) { this.consumedAt = consumedAt; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    /** Convenience: return the "{txHash}#{index}" reference. */
    public String getUtxoRef() {
        return txHash + "#" + outputIndex;
    }
}
```

- [ ] **Step 2: Create the repository**

Create `nexus/src/main/java/io/gerowallet/repository/CollateralPoolUtxoRepository.java`:

```java
package io.gerowallet.repository;

import io.gerowallet.entity.CollateralPoolUtxo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface CollateralPoolUtxoRepository extends JpaRepository<CollateralPoolUtxo, Long> {

    Optional<CollateralPoolUtxo> findByTxHashAndOutputIndex(String txHash, Integer outputIndex);

    List<CollateralPoolUtxo> findAllByStatus(CollateralPoolUtxo.Status status);

    long countByStatus(CollateralPoolUtxo.Status status);

    /** Round-robin: pick an AVAILABLE UTxO with the lowest recent lent activity. */
    @Query("""
        SELECT u FROM CollateralPoolUtxo u
        WHERE u.status = 'AVAILABLE'
        ORDER BY COALESCE(u.lastLentAt, u.createdAt) ASC
    """)
    List<CollateralPoolUtxo> findAvailableOrderedByOldestLend();

    @Modifying
    @Query("""
        UPDATE CollateralPoolUtxo u
        SET u.lentCount = u.lentCount + 1, u.lastLentAt = :now
        WHERE u.id = :id
    """)
    void recordLend(@Param("id") Long id, @Param("now") OffsetDateTime now);

    @Modifying
    @Query("""
        UPDATE CollateralPoolUtxo u
        SET u.status = 'CONSUMED', u.consumedAt = :now
        WHERE u.id = :id
    """)
    void markConsumed(@Param("id") Long id, @Param("now") OffsetDateTime now);
}
```

- [ ] **Step 3: Compile check**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn compile -q
```

- [ ] **Step 4: Commit**

```bash
git add src/main/java/io/gerowallet/entity/CollateralPoolUtxo.java \
        src/main/java/io/gerowallet/repository/CollateralPoolUtxoRepository.java
git commit -m "feat(collateral): JPA entity and repository for pool UTxOs"
```

---

### Task A5: Pool initialization service (startup reconcile)

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/service/collateral/CollateralPoolInitService.java`

- [ ] **Step 1: Create the init service**

On application startup, query the hot wallet address on-chain and reconcile with the DB. New UTxOs → insert AVAILABLE. Missing UTxOs → mark CONSUMED.

Create `nexus/src/main/java/io/gerowallet/service/collateral/CollateralPoolInitService.java`:

```java
package io.gerowallet.service.collateral;

import com.bloxbean.cardano.client.transaction.spec.TransactionInput;
import com.bloxbean.cardano.client.transaction.spec.TransactionOutput;
import com.bloxbean.cardano.client.transaction.spec.TransactionUnspentOutput;
import com.bloxbean.cardano.client.transaction.spec.Value;
import com.bloxbean.cardano.client.util.HexUtil;
import io.gerowallet.config.properties.CollateralProperties;
import io.gerowallet.entity.CollateralPoolUtxo;
import io.gerowallet.facade.CardanoAddressFacade;
import io.gerowallet.model.common.Utxo;
import io.gerowallet.repository.CollateralPoolUtxoRepository;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigInteger;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@Service
public class CollateralPoolInitService {

    private static final Logger log = LoggerFactory.getLogger(CollateralPoolInitService.class);

    private final CollateralProperties properties;
    private final CollateralPoolUtxoRepository repository;
    private final CardanoAddressFacade addressFacade;

    public CollateralPoolInitService(
            CollateralProperties properties,
            CollateralPoolUtxoRepository repository,
            CardanoAddressFacade addressFacade) {
        this.properties = properties;
        this.repository = repository;
        this.addressFacade = addressFacade;
    }

    @PostConstruct
    @Async
    public void reconcileOnStartup() {
        try {
            reconcile();
        } catch (Exception e) {
            log.error("Collateral pool reconciliation failed at startup", e);
        }
    }

    @Transactional
    public void reconcile() {
        String address = properties.getHotWalletAddress();
        if (address == null || address.isBlank()) {
            log.warn("Collateral hot wallet address not configured — skipping pool reconcile");
            return;
        }

        String network = properties.getNetwork();
        // Exact facade method name may vary; adapt to actual signature.
        List<Utxo> chainUtxos = addressFacade.getUtxosByAddress(address, 0, 200, network);

        Set<String> onChainRefs = new HashSet<>();
        for (Utxo u : chainUtxos) {
            // Only track pure-ADA UTxOs matching the expected collateral amount
            if (u.getAmount() == null || u.getAmount().isEmpty()) continue;
            boolean pureAda = u.getAmount().size() == 1 && "lovelace".equals(u.getAmount().get(0).getUnit());
            if (!pureAda) continue;
            long lovelace = new BigInteger(u.getAmount().get(0).getQuantity()).longValueExact();
            if (lovelace != properties.getAmountLovelace()) continue;

            onChainRefs.add(u.getTxHash() + "#" + u.getOutputIndex());

            var existing = repository.findByTxHashAndOutputIndex(u.getTxHash(), u.getOutputIndex());
            if (existing.isEmpty()) {
                CollateralPoolUtxo row = new CollateralPoolUtxo();
                row.setTxHash(u.getTxHash());
                row.setOutputIndex(u.getOutputIndex());
                row.setAddress(address);
                row.setLovelace(lovelace);
                row.setUtxoCborHex(buildUtxoCborHex(u, address, lovelace));
                row.setStatus(CollateralPoolUtxo.Status.AVAILABLE);
                repository.save(row);
                log.info("Collateral pool: discovered new UTxO {}", row.getUtxoRef());
            }
        }

        // Mark CONSUMED any UTxOs that are AVAILABLE in DB but no longer on-chain
        for (CollateralPoolUtxo row : repository.findAllByStatus(CollateralPoolUtxo.Status.AVAILABLE)) {
            String ref = row.getUtxoRef();
            if (!onChainRefs.contains(ref)) {
                repository.markConsumed(row.getId(), OffsetDateTime.now());
                log.warn("Collateral pool: UTxO {} no longer on-chain, marked CONSUMED", ref);
            }
        }

        long available = repository.countByStatus(CollateralPoolUtxo.Status.AVAILABLE);
        log.info("Collateral pool reconciled. Available UTxOs: {}", available);
    }

    /** Build the TransactionUnspentOutput CBOR hex for CIP-30 return. */
    private String buildUtxoCborHex(Utxo u, String address, long lovelace) throws Exception {
        TransactionInput input = new TransactionInput(u.getTxHash(), u.getOutputIndex());
        TransactionOutput output = new TransactionOutput(address, Value.builder().coin(BigInteger.valueOf(lovelace)).build());
        TransactionUnspentOutput tuo = new TransactionUnspentOutput(input, output);
        return HexUtil.encodeHexString(tuo.serialize());
    }
}
```

**Note:** `CardanoAddressFacade.getUtxosByAddress` signature and `Utxo` shape must match the existing codebase. Verify by:

```bash
grep -rn "getUtxosByAddress" "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus/src/main/java" | head -5
```

If signature differs (e.g., takes `network` as enum, pagination differs), adapt the call site above.

- [ ] **Step 2: Enable async on the Nexus application**

Check if `@EnableAsync` is present on `NexusApplication.java`. If not, add it:

```java
@SpringBootApplication
@EnableAsync
@EnableScheduling
public class NexusApplication {
    public static void main(String[] args) { ... }
}
```

- [ ] **Step 3: Compile + integration run**

```bash
mvn compile -q
mvn spring-boot:run -Dspring-boot.run.arguments="--spring.profiles.active=dev" -q &
sleep 30
# Check logs for "Collateral pool reconciled. Available UTxOs: N"
```

- [ ] **Step 4: Commit**

```bash
git add src/main/java/io/gerowallet/service/collateral/CollateralPoolInitService.java \
        src/main/java/io/gerowallet/NexusApplication.java
git commit -m "feat(collateral): startup pool reconciliation against chain state"
```

---

### Task A6: Scheduled pool monitor

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/service/collateral/CollateralPoolMonitor.java`

Periodically re-runs reconciliation to detect consumed UTxOs.

- [ ] **Step 1: Create the monitor**

Create `nexus/src/main/java/io/gerowallet/service/collateral/CollateralPoolMonitor.java`:

```java
package io.gerowallet.service.collateral;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class CollateralPoolMonitor {

    private static final Logger log = LoggerFactory.getLogger(CollateralPoolMonitor.class);

    private final CollateralPoolInitService initService;

    public CollateralPoolMonitor(CollateralPoolInitService initService) {
        this.initService = initService;
    }

    /** Every 5 minutes, reconcile the pool against chain state. */
    @Scheduled(fixedDelay = 5 * 60 * 1000L, initialDelay = 60 * 1000L)
    public void tick() {
        try {
            initService.reconcile();
        } catch (Exception e) {
            log.error("Collateral pool monitor tick failed", e);
        }
    }
}
```

- [ ] **Step 2: Verify `@EnableScheduling` is on the application** (added in A5 Step 2)

- [ ] **Step 3: Commit**

```bash
git add src/main/java/io/gerowallet/service/collateral/CollateralPoolMonitor.java
git commit -m "feat(collateral): scheduled pool monitor every 5 minutes"
```

---

### Task A7: Collateral facade + service (lend / status / cosign logic)

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/service/collateral/CollateralService.java`
- Create: `nexus/src/main/java/io/gerowallet/facade/CollateralFacade.java`
- Create: `nexus/src/main/java/io/gerowallet/model/collateral/LendResponse.java`
- Create: `nexus/src/main/java/io/gerowallet/model/collateral/StatusResponse.java`
- Create: `nexus/src/main/java/io/gerowallet/model/collateral/CosignRequest.java`
- Create: `nexus/src/main/java/io/gerowallet/model/collateral/CosignResponse.java`

- [ ] **Step 1: Create DTOs**

Create `nexus/src/main/java/io/gerowallet/model/collateral/LendResponse.java`:

```java
package io.gerowallet.model.collateral;

public record LendResponse(String utxoRef, String utxoCbor, String address) {}
```

Create `StatusResponse.java`:

```java
package io.gerowallet.model.collateral;

public record StatusResponse(boolean valid, String reason) {
    public static StatusResponse valid() { return new StatusResponse(true, null); }
    public static StatusResponse invalid(String reason) { return new StatusResponse(false, reason); }
}
```

Create `CosignRequest.java`:

```java
package io.gerowallet.model.collateral;

import jakarta.validation.constraints.NotBlank;

public record CosignRequest(
        @NotBlank String txCbor,
        @NotBlank String utxoRef
) {}
```

Create `CosignResponse.java`:

```java
package io.gerowallet.model.collateral;

public record CosignResponse(String witness) {}
```

- [ ] **Step 2: Create the service**

Create `nexus/src/main/java/io/gerowallet/service/collateral/CollateralService.java`:

```java
package io.gerowallet.service.collateral;

import com.bloxbean.cardano.client.transaction.spec.Transaction;
import com.bloxbean.cardano.client.transaction.spec.TransactionInput;
import com.bloxbean.cardano.client.util.HexUtil;
import io.gerowallet.entity.CollateralPoolUtxo;
import io.gerowallet.exception.BadRequestException;
import io.gerowallet.exception.NotFoundException;
import io.gerowallet.model.collateral.CosignResponse;
import io.gerowallet.model.collateral.LendResponse;
import io.gerowallet.model.collateral.StatusResponse;
import io.gerowallet.repository.CollateralPoolUtxoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

@Service
public class CollateralService {

    private static final Logger log = LoggerFactory.getLogger(CollateralService.class);

    private final CollateralPoolUtxoRepository repository;
    private final CollateralSigningService signingService;

    public CollateralService(
            CollateralPoolUtxoRepository repository,
            CollateralSigningService signingService) {
        this.repository = repository;
        this.signingService = signingService;
    }

    @Transactional
    public LendResponse lend() {
        if (!signingService.isReady()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Collateral service not ready");
        }
        List<CollateralPoolUtxo> candidates = repository.findAvailableOrderedByOldestLend();
        if (candidates.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Collateral pool exhausted");
        }
        CollateralPoolUtxo chosen = candidates.get(0);
        repository.recordLend(chosen.getId(), OffsetDateTime.now());
        return new LendResponse(chosen.getUtxoRef(), chosen.getUtxoCborHex(), chosen.getAddress());
    }

    @Transactional(readOnly = true)
    public StatusResponse status(String utxoRef) {
        var parsed = parseRef(utxoRef);
        Optional<CollateralPoolUtxo> row = repository.findByTxHashAndOutputIndex(parsed.txHash(), parsed.index());
        if (row.isEmpty()) return StatusResponse.invalid("unknown");
        if (row.get().getStatus() == CollateralPoolUtxo.Status.CONSUMED) return StatusResponse.invalid("consumed");
        return StatusResponse.valid();
    }

    @Transactional
    public CosignResponse cosign(String txCborHex, String utxoRef) {
        if (!signingService.isReady()) {
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Collateral service not ready");
        }

        var parsed = parseRef(utxoRef);

        // Verify the UTxO is in our pool
        CollateralPoolUtxo row = repository.findByTxHashAndOutputIndex(parsed.txHash(), parsed.index())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "UTxO not recognized"));
        if (row.getStatus() != CollateralPoolUtxo.Status.AVAILABLE) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "UTxO not available");
        }

        // Parse the tx
        Transaction tx;
        try {
            tx = Transaction.deserialize(HexUtil.decodeHexString(txCborHex));
        } catch (Exception e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid tx CBOR");
        }

        // Security: verify utxoRef is ONLY in collateralInputs, NOT in regular inputs
        boolean inCollateral = containsRef(tx.getBody().getCollateral(), parsed.txHash(), parsed.index());
        boolean inInputs = containsRef(tx.getBody().getInputs(), parsed.txHash(), parsed.index());
        if (!inCollateral) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UTxO not in collateralInputs");
        }
        if (inInputs) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "UTxO is in regular inputs (adversarial)");
        }

        // Sign
        String witnessCbor;
        try {
            witnessCbor = signingService.buildWitnessForTx(tx);
        } catch (Exception e) {
            log.error("Cosign signing failed", e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Signing failed");
        }

        return new CosignResponse(witnessCbor);
    }

    private static boolean containsRef(List<TransactionInput> list, String txHash, int index) {
        if (list == null) return false;
        for (TransactionInput in : list) {
            if (txHash.equalsIgnoreCase(in.getTransactionId()) && in.getIndex() == index) {
                return true;
            }
        }
        return false;
    }

    private static ParsedRef parseRef(String utxoRef) {
        int hashIdx = utxoRef.indexOf('#');
        if (hashIdx <= 0 || hashIdx == utxoRef.length() - 1) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid utxoRef");
        }
        try {
            return new ParsedRef(
                    utxoRef.substring(0, hashIdx),
                    Integer.parseInt(utxoRef.substring(hashIdx + 1))
            );
        } catch (NumberFormatException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid utxoRef index");
        }
    }

    private record ParsedRef(String txHash, int index) {}
}
```

- [ ] **Step 3: Create a simple facade (thin wrapper for consistency with codebase)**

Create `nexus/src/main/java/io/gerowallet/facade/CollateralFacade.java`:

```java
package io.gerowallet.facade;

import io.gerowallet.model.collateral.CosignResponse;
import io.gerowallet.model.collateral.LendResponse;
import io.gerowallet.model.collateral.StatusResponse;
import io.gerowallet.service.collateral.CollateralService;
import org.springframework.stereotype.Component;

@Component
public class CollateralFacade {

    private final CollateralService service;

    public CollateralFacade(CollateralService service) {
        this.service = service;
    }

    public LendResponse lend() {
        return service.lend();
    }

    public StatusResponse status(String utxoRef) {
        return service.status(utxoRef);
    }

    public CosignResponse cosign(String txCbor, String utxoRef) {
        return service.cosign(txCbor, utxoRef);
    }
}
```

- [ ] **Step 4: Compile**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn compile -q
```

- [ ] **Step 5: Commit**

```bash
git add src/main/java/io/gerowallet/service/collateral/CollateralService.java \
        src/main/java/io/gerowallet/facade/CollateralFacade.java \
        src/main/java/io/gerowallet/model/collateral/
git commit -m "feat(collateral): lend/status/cosign business logic with security checks"
```

---

### Task A8: REST controller

**Files:**
- Create: `nexus/src/main/java/io/gerowallet/controller/collateral/CollateralController.java`

- [ ] **Step 1: Create the controller**

Create `nexus/src/main/java/io/gerowallet/controller/collateral/CollateralController.java`:

```java
package io.gerowallet.controller.collateral;

import io.gerowallet.facade.CollateralFacade;
import io.gerowallet.model.collateral.CosignRequest;
import io.gerowallet.model.collateral.CosignResponse;
import io.gerowallet.model.collateral.LendResponse;
import io.gerowallet.model.collateral.StatusResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/collateral")
@PreAuthorize("@securityExpressions.canWriteCardano()")
@Validated
@Tag(name = "Collateral", description = "Shared-pool collateral for dApp interactions")
public class CollateralController {

    private final CollateralFacade facade;

    public CollateralController(CollateralFacade facade) {
        this.facade = facade;
    }

    @PostMapping("/lend")
    @Operation(summary = "Lend a shared-pool UTxO", description = "Returns a 5 ADA UTxO reference for use as collateral. May be returned to many devices concurrently.")
    public ResponseEntity<LendResponse> lend() {
        return ResponseEntity.ok(facade.lend());
    }

    @GetMapping("/status")
    @Operation(summary = "Check if a pool UTxO is still valid")
    public ResponseEntity<StatusResponse> status(@RequestParam("utxoRef") @NotBlank String utxoRef) {
        return ResponseEntity.ok(facade.status(utxoRef));
    }

    @PostMapping("/cosign")
    @Operation(summary = "Cosign a dApp tx that uses a pool UTxO as collateral")
    public ResponseEntity<CosignResponse> cosign(@Valid @RequestBody CosignRequest request) {
        return ResponseEntity.ok(facade.cosign(request.txCbor(), request.utxoRef()));
    }
}
```

- [ ] **Step 2: Run and smoke-test**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn spring-boot:run -Dspring-boot.run.arguments="--spring.profiles.active=dev" -q &
sleep 30

# Get a device JWT (use existing /api/auth/device flow or copy one from logs)
TOKEN="<device-jwt>"

# /lend
curl -s -X POST http://localhost:8080/v1/collateral/lend \
  -H "Authorization: Bearer $TOKEN" | jq
# Expected: { "utxoRef": "...#0", "utxoCbor": "...", "address": "addr1v..." }

# /status
curl -s "http://localhost:8080/v1/collateral/status?utxoRef=$UTXO_REF" \
  -H "Authorization: Bearer $TOKEN" | jq
# Expected: { "valid": true }
```

- [ ] **Step 3: Commit**

```bash
git add src/main/java/io/gerowallet/controller/collateral/CollateralController.java
git commit -m "feat(collateral): REST endpoints /v1/collateral/{lend,status,cosign}"
```

---

### Task A9: Unit tests for CollateralService

**Files:**
- Create: `nexus/src/test/java/io/gerowallet/service/collateral/CollateralServiceTest.java`

- [ ] **Step 1: Create service tests**

Create `nexus/src/test/java/io/gerowallet/service/collateral/CollateralServiceTest.java`:

```java
package io.gerowallet.service.collateral;

import io.gerowallet.entity.CollateralPoolUtxo;
import io.gerowallet.model.collateral.LendResponse;
import io.gerowallet.model.collateral.StatusResponse;
import io.gerowallet.repository.CollateralPoolUtxoRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.web.server.ResponseStatusException;

import java.util.Collections;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CollateralServiceTest {

    @Mock CollateralPoolUtxoRepository repository;
    @Mock CollateralSigningService signingService;
    @InjectMocks CollateralService service;

    @BeforeEach
    void setUp() {
        when(signingService.isReady()).thenReturn(true);
    }

    @Test
    void lend_returnsOldestAvailableUtxo() {
        CollateralPoolUtxo row = new CollateralPoolUtxo();
        row.setTxHash("abc".repeat(21) + "d"); // 64 chars
        row.setOutputIndex(0);
        row.setAddress("addr1v...");
        row.setLovelace(5_000_000L);
        row.setUtxoCborHex("82825820abc...");
        row.setStatus(CollateralPoolUtxo.Status.AVAILABLE);
        when(repository.findAvailableOrderedByOldestLend()).thenReturn(List.of(row));

        LendResponse result = service.lend();

        assertThat(result.utxoRef()).endsWith("#0");
        assertThat(result.utxoCbor()).isEqualTo("82825820abc...");
    }

    @Test
    void lend_whenPoolEmpty_throws503() {
        when(repository.findAvailableOrderedByOldestLend()).thenReturn(Collections.emptyList());
        assertThatThrownBy(() -> service.lend())
                .isInstanceOf(ResponseStatusException.class);
    }

    @Test
    void status_whenUnknown_returnsInvalid() {
        when(repository.findByTxHashAndOutputIndex("abc".repeat(21) + "d", 0)).thenReturn(Optional.empty());
        StatusResponse result = service.status(("abc".repeat(21) + "d") + "#0");
        assertThat(result.valid()).isFalse();
        assertThat(result.reason()).isEqualTo("unknown");
    }

    @Test
    void status_whenConsumed_returnsInvalid() {
        CollateralPoolUtxo row = new CollateralPoolUtxo();
        row.setStatus(CollateralPoolUtxo.Status.CONSUMED);
        row.setTxHash("abc".repeat(21) + "d");
        row.setOutputIndex(0);
        when(repository.findByTxHashAndOutputIndex(row.getTxHash(), 0)).thenReturn(Optional.of(row));
        StatusResponse result = service.status(row.getTxHash() + "#0");
        assertThat(result.valid()).isFalse();
        assertThat(result.reason()).isEqualTo("consumed");
    }

    @Test
    void status_whenAvailable_returnsValid() {
        CollateralPoolUtxo row = new CollateralPoolUtxo();
        row.setStatus(CollateralPoolUtxo.Status.AVAILABLE);
        row.setTxHash("abc".repeat(21) + "d");
        row.setOutputIndex(0);
        when(repository.findByTxHashAndOutputIndex(row.getTxHash(), 0)).thenReturn(Optional.of(row));
        StatusResponse result = service.status(row.getTxHash() + "#0");
        assertThat(result.valid()).isTrue();
    }

    @Test
    void cosign_whenUtxoInInputsNotCollateral_throws400() {
        // Build a minimal tx CBOR placing the pool UTxO in `inputs`, not `collateral`.
        // Use cardano-client-lib Transaction builder for this test, or use a known-good fixture.
        // TODO: populate with a real fixture during implementation; this test skeleton shows intent.
    }
}
```

**Note:** The `cosign_whenUtxoInInputsNotCollateral` test requires a real Cardano tx CBOR fixture. Leave it marked with a TODO to be filled in during implementation — include known-good CBOR samples from Preprod txs.

- [ ] **Step 2: Run tests**

```bash
cd "/Users/dudiedri/IdeaProjects/A.D. Labs/nexus"
mvn test -Dtest=CollateralServiceTest -q
```

- [ ] **Step 3: Commit**

```bash
git add src/test/java/io/gerowallet/service/collateral/CollateralServiceTest.java
git commit -m "test(collateral): unit tests for CollateralService lend/status flows"
```

---

## Phase B: Client (`gerowallet`)

### Task 1: Create `nexus-collateral-api.ts` HTTP client

**Files:**
- Create: `src/api/nexus-collateral-api.ts`

- [ ] **Step 1: Create the API client**

Create `src/api/nexus-collateral-api.ts`:

```typescript
/**
 * Nexus shared-pool collateral API client.
 *
 * Endpoints let the wallet lend a 5 ADA UTxO reference from Nexus's shared pool
 * (persisted in wallet-db, reused across dApp interactions), validate it's still
 * on-chain, and request a co-signature when a dApp tx includes it as collateral.
 *
 * Auth: device JWT from nexusDevice.service (same as nexus-tx-api).
 */

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';
import { debugLog } from '@/utils/debug';

export interface LendResponse {
  /** UTxO reference string: "txHash#index" */
  utxoRef: string;
  /** Pre-serialized TransactionUnspentOutput CBOR hex, ready to return to CIP-30 getCollateral */
  utxoCbor: string;
  /** Nexus enterprise address (bech32) where the pool UTxO lives */
  address: string;
}

export interface StatusResponse {
  /** true if the UTxO still exists on-chain */
  valid: boolean;
  /** Why it's invalid (undefined when valid) */
  reason?: 'consumed' | 'unknown';
}

export interface CosignResponse {
  /** TransactionWitnessSet CBOR hex containing the hot wallet's VKeyWitness */
  witness: string;
}

const client = axios.create({
  baseURL: import.meta.env['VITE_NEXUS_URL'],
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use(async (config) => {
  const token = await getNexusAccessToken();
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const config = error.config as AxiosRequestConfig & { _retried?: boolean };
    if (error.response?.status === 401 && config && !config._retried) {
      config._retried = true;
      try {
        const token = await reauthenticateNexus();
        if (config.headers) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return client.request(config);
      } catch (refreshErr) {
        debugLog('[nexus-collateral-api] Reauth failed after 401:', refreshErr);
        throw error;
      }
    }
    throw error;
  }
);

export const nexusCollateralApi = {
  /** Lend a 5 ADA UTxO reference from the shared pool. Idempotent per device. */
  async lend(): Promise<LendResponse> {
    const { data } = await client.post<LendResponse>('/v1/collateral/lend', {});
    return data;
  },

  /** Check if a cached UTxO reference is still valid on-chain. */
  async status(utxoRef: string): Promise<StatusResponse> {
    const { data } = await client.get<StatusResponse>('/v1/collateral/status', {
      params: { utxoRef },
    });
    return data;
  },

  /** Request co-signature for a tx whose collateralInputs includes the lent UTxO. */
  async cosign(txCbor: string, utxoRef: string): Promise<CosignResponse> {
    const { data } = await client.post<CosignResponse>('/v1/collateral/cosign', {
      txCbor,
      utxoRef,
    });
    return data;
  },
};
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "nexus-collateral-api" | head -5`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/api/nexus-collateral-api.ts
git commit -m "feat(api): add Nexus shared-pool collateral HTTP client"
```

---

### Task 2: Add `nexusCollateral` state to walletStore

**Files:**
- Modify: `src/stores/walletStore.ts`

- [ ] **Step 1: Add the type to the WalletStore interface**

In `src/stores/walletStore.ts`, find the `WalletStore` interface (around line 48). Add a new field after `collateral: Cardano.Utxo | null;`:

```typescript
export interface NexusCollateralCache {
  utxoRef: string;
  utxoCbor: string;
  address: string;
  lentAt: number;
  validatedAt: number;
}

export interface WalletStore {
  loggedWallet: any;
  isLocked: boolean;
  isSyncing: boolean;
  account: Account;
  transactions: any[];
  utxos: Cardano.Utxo[] | IUnifiedUtxo[];
  collateral: Cardano.Utxo | null;
  nexusCollateral: NexusCollateralCache | null;
  keys: Keys;
  tokens: {};
  collections: {};
  config: any;
  fiatRates: {};
  fiatRatesIntervalId: any;
  rewards?: any[];
  contacts?: Record<string, Contact>;
  connectedDapps?: any[];
  bitcoinBalance?: IBalance;
}
```

- [ ] **Step 2: Initialize in the observable**

Find the initial state (around line 70) and add after `collateral: null`:

```typescript
  collateral: null,
  nexusCollateral: null,
```

- [ ] **Step 3: Add setter**

Find `setCollateral` (around line 261) and add after it:

```typescript
  setNexusCollateral(nexusCollateral: NexusCollateralCache | null) {
    walletStore.nexusCollateral = nexusCollateral;
    broadcastFromBackground({ nexusCollateral });
  },
```

- [ ] **Step 4: Reset on logout**

Find `logout()` method. Locate the reset section where `collateral: null` is set. Add `nexusCollateral: null` alongside it. Do the same reset in `clearForWalletSwitch()`.

Search for both with: `grep -n "collateral: null" "src/stores/walletStore.ts"` (should find 2 occurrences in logout + switch methods).

- [ ] **Step 5: Broadcast the type in the background serializer**

Find `broadcastFromBackground` in the same file. The JSON replacer handles BigInt/Map/Set — no change needed since `NexusCollateralCache` is plain JSON.

- [ ] **Step 6: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "walletStore" | head -10`

Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/stores/walletStore.ts
git commit -m "feat(store): add nexusCollateral cache to walletStore"
```

---

### Task 3: Create `nexusCollateralService.ts` for DB persistence + orchestration

**Files:**
- Create: `src/services/nexusCollateralService.ts`

This service owns the DB cache, orchestrates `/lend` and `/status` calls, and keeps the `walletStore` in sync with DB.

- [ ] **Step 1: Create the service file**

Create `src/services/nexusCollateralService.ts`:

```typescript
/**
 * Nexus shared-pool collateral service.
 *
 * Responsibilities:
 *   - Persist the lent UTxO reference in wallet-db's config table
 *   - Mirror it in walletStore.nexusCollateral for synchronous access from
 *     background handlers (getCollateral, signTx co-sign detection)
 *   - Call Nexus /lend on first use, /status periodically to validate
 *   - Refresh the cache if the UTxO gets consumed (rare — Phase 2 failure)
 *
 * Lifecycle:
 *   - initOnLogin(): load from DB → validate via /status → refresh if stale
 *   - validate(): called on sync tick (every ~60s)
 *   - invalidate(): clear cache when cosign fails (UTxO consumed)
 */

import { getDb } from '@/db/wallet-db';
import { walletStore, WalletStore as WalletStoreType, NexusCollateralCache } from '@/stores/walletStore';
import WalletStore from '@/stores/walletStore';
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
import { debugLog } from '@/utils/debug';

const DB_KEY = 'nexusCollateral';
/** Max age of a /status validation before we re-check. 10 min in practice. */
const VALIDATION_TTL_MS = 10 * 60 * 1000;

/** Load the cached entry from wallet-db (returns null if not present). */
async function readFromDb(walletId: number): Promise<NexusCollateralCache | null> {
  const db = await getDb(walletId);
  if (!db) return null;
  const row = await db.table('config').where({ key: DB_KEY }).first();
  return row?.value ?? null;
}

/** Persist the cached entry to wallet-db. */
async function writeToDb(walletId: number, value: NexusCollateralCache | null): Promise<void> {
  const db = await getDb(walletId);
  if (!db) return;
  if (value === null) {
    await db.table('config').where({ key: DB_KEY }).delete();
  } else {
    await db.table('config').put({ key: DB_KEY, value });
  }
}

/** Request a fresh UTxO from the pool and persist it. */
async function lendAndPersist(walletId: number): Promise<NexusCollateralCache | null> {
  try {
    const { utxoRef, utxoCbor, address } = await nexusCollateralApi.lend();
    const now = Date.now();
    const entry: NexusCollateralCache = {
      utxoRef,
      utxoCbor,
      address,
      lentAt: now,
      validatedAt: now,
    };
    await writeToDb(walletId, entry);
    WalletStore.setNexusCollateral(entry);
    debugLog('🏦 Nexus collateral lent:', utxoRef);
    return entry;
  } catch (error) {
    debugLog('⚠️ Nexus /lend failed (non-fatal):', error);
    return null;
  }
}

/**
 * Called on wallet login / unlock. Loads cache from DB, validates via /status,
 * refreshes via /lend if missing or invalid. Non-blocking — swallows errors.
 */
export async function initOnLogin(walletId: number): Promise<void> {
  const cached = await readFromDb(walletId);
  if (!cached) {
    // No cache — fetch fresh
    await lendAndPersist(walletId);
    return;
  }

  // Cache exists — mirror to store immediately for fast getCollateral access
  WalletStore.setNexusCollateral(cached);

  // Validate asynchronously (non-blocking)
  try {
    const { valid } = await nexusCollateralApi.status(cached.utxoRef);
    if (!valid) {
      debugLog('🔄 Cached Nexus collateral invalid, refreshing:', cached.utxoRef);
      await writeToDb(walletId, null);
      WalletStore.setNexusCollateral(null);
      await lendAndPersist(walletId);
    } else {
      // Update validatedAt timestamp
      const updated: NexusCollateralCache = { ...cached, validatedAt: Date.now() };
      await writeToDb(walletId, updated);
      WalletStore.setNexusCollateral(updated);
    }
  } catch (error) {
    // Nexus unreachable — keep the cached entry optimistically
    debugLog('⚠️ Nexus /status failed (keeping cache optimistically):', error);
  }
}

/**
 * Called on sync tick. Re-validates the cached UTxO if the last check is
 * older than VALIDATION_TTL_MS. No-op if cache is fresh.
 */
export async function validateIfStale(walletId: number): Promise<void> {
  const cached = walletStore.nexusCollateral;
  if (!cached) return;
  if (Date.now() - cached.validatedAt < VALIDATION_TTL_MS) return;

  try {
    const { valid } = await nexusCollateralApi.status(cached.utxoRef);
    if (!valid) {
      debugLog('🔄 Nexus collateral consumed on-chain, refreshing:', cached.utxoRef);
      await writeToDb(walletId, null);
      WalletStore.setNexusCollateral(null);
      await lendAndPersist(walletId);
    } else {
      const updated: NexusCollateralCache = { ...cached, validatedAt: Date.now() };
      await writeToDb(walletId, updated);
      WalletStore.setNexusCollateral(updated);
    }
  } catch (error) {
    debugLog('⚠️ Nexus /status tick failed:', error);
  }
}

/**
 * Called when /cosign returns 404 (UTxO consumed between fetch and sign).
 * Clears cache and fetches a fresh one for the next attempt.
 */
export async function invalidateAndRefresh(walletId: number): Promise<void> {
  await writeToDb(walletId, null);
  WalletStore.setNexusCollateral(null);
  await lendAndPersist(walletId);
}
```

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "nexusCollateralService" | head -10`

- [ ] **Step 3: Commit**

```bash
git add src/services/nexusCollateralService.ts
git commit -m "feat(services): add nexusCollateralService for DB-persisted pool cache"
```

---

### Task 4: Hook service into wallet login flow

**Files:**
- Modify: `src/chrome/background.ts`

- [ ] **Step 1: Find where wallet login completes**

Find where `walletManager.getWallet()` is available post-login and where non-blocking post-login tasks run. Search:

```
grep -n "startSync\|walletManager.login\|walletManager.restore\|setLoggedWallet" "src/chrome/background.ts" | head -20
```

Locate the block that runs AFTER login succeeds where Ably connection, initial sync, etc. are kicked off non-blockingly.

- [ ] **Step 2: Import the service**

Near the top of `src/chrome/background.ts`, add:

```typescript
import * as nexusCollateralService from '@/services/nexusCollateralService';
```

- [ ] **Step 3: Call `initOnLogin` after login succeeds**

In the post-login block, add (non-blocking):

```typescript
// Nexus pooled collateral — non-blocking, failures are silent
setTimeout(() => {
  const wallet = walletManager.getWallet();
  if (wallet && wallet.chain === 'Cardano') {
    nexusCollateralService.initOnLogin(wallet.id).catch(() => {
      // initOnLogin already swallows errors; this is defensive
    });
  }
}, 0);
```

Place this alongside (not before) other non-blocking post-login tasks. It must NOT be awaited — login latency is a hard constraint (<200ms per CLAUDE.md).

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "background.ts" | head -10`

- [ ] **Step 5: Manual verification**

1. `npm run dev:background && npm run dev`
2. Reload extension, unlock wallet
3. Open background service worker console (chrome://extensions → "service worker")
4. Expected logs:
   - If first time: `🏦 Nexus collateral lent: <utxoRef>`
   - If cached and valid: no new log (silent validation)
   - If cached and invalid: `🔄 Cached Nexus collateral invalid, refreshing: ...` followed by a new `🏦 Nexus collateral lent: ...`
   - If Nexus unreachable: `⚠️ Nexus /lend failed (non-fatal): ...`
5. Inspect `walletStore.nexusCollateral` — should match the logged value
6. Open DevTools → Application → IndexedDB → `wallet-<id>` → `config` table. Look for row with `key: 'nexusCollateral'`. Verify value matches.

- [ ] **Step 6: Commit**

```bash
git add src/chrome/background.ts
git commit -m "feat(collateral): init Nexus shared-pool cache on wallet login"
```

---

### Task 5: Periodic validation on sync tick

**Files:**
- Modify: `src/chrome/background.ts` OR `src/services/walletManager.service.ts` (wherever the sync tick lives)

- [ ] **Step 1: Find the sync tick handler**

The wallet has two polling sources per CLAUDE.md: Ably `onTip` (fast when unlocked) and a 2-min throttle when locked. The validation only needs to run when unlocked.

Search:

```
grep -n "onTip\|syncTip\|walletManager.*sync" "src/chrome/background.ts" "src/services/walletManager.service.ts" | head -20
```

Find the handler that fires on each tip.

- [ ] **Step 2: Add validation call**

In the tip handler, after existing sync logic:

```typescript
// Validate Nexus collateral cache if stale (TTL-based, cheap no-op if fresh)
const wallet = walletManager.getWallet();
if (wallet && wallet.chain === 'Cardano' && !walletStore.isLocked) {
  nexusCollateralService.validateIfStale(wallet.id).catch(() => {
    // Service swallows errors internally; defensive catch
  });
}
```

Do NOT await — must not delay the sync tick.

- [ ] **Step 3: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep -E "background.ts|walletManager" | head -10`

- [ ] **Step 4: Manual verification**

1. Unlock wallet, wait for initial `🏦 Nexus collateral lent:` log
2. Wait 10+ minutes with the wallet open
3. On next tip after the TTL, you should see no log (silent re-validation)
4. If the UTxO were consumed: `🔄 Nexus collateral consumed on-chain, refreshing:` → new lend log

- [ ] **Step 5: Commit**

```bash
git add src/chrome/background.ts src/services/walletManager.service.ts
git commit -m "feat(collateral): validate Nexus cache on sync tick when stale"
```

---

### Task 6: `getCollateral()` fallback in serialization

**Files:**
- Modify: `src/chrome/serialization.ts:424-475`

- [ ] **Step 1: Read the current `getCollateral`**

The current implementation returns CBOR strings from user-owned pure-ADA UTxOs. When no suitable user UTxO exists, it throws `APIError.Refused`. We modify it to append the Nexus cached UTxO CBOR *before* throwing.

- [ ] **Step 2: Import walletStore**

Check if `walletStore` is already imported in `serialization.ts`. If not, add:

```typescript
import { walletStore } from '@/stores/walletStore';
```

- [ ] **Step 3: Modify `getCollateral` to use the Nexus fallback**

Replace the function body (lines 424-475) with:

```typescript
export function getCollateral(
  { amount = new Serialization.Value(MAX_COLLATERAL_AMOUNT).toCbor() }: { amount?: string } = {},
  storedUtxos: Cardano.Utxo[]
): string[] {
  if (!storedUtxos || !Array.isArray(storedUtxos)) {
    const error = APIError.InvalidRequest;
    error.info = 'No UTXOs available in wallet.';
    throw error;
  }

  // Filter for pure ADA UTXOs (no assets) suitable for collateral
  let filteredUtxos = storedUtxos.filter(utxo => {
    const txOut = utxo[1];
    return !txOut.value.assets || txOut.value.assets.size === 0;
  });

  let filterAmount = MAX_COLLATERAL_AMOUNT;
  if (amount) {
    try {
      filterAmount = getFilterAmount(amount);
    } catch (e) {
      const error = APIError.InternalError;
      error.info = (e as Error)?.message || 'Unknown error';
      throw error;
    }
  }

  const selected: Cardano.Utxo[] = [];
  let totalCoins = 0n;
  for (const utxo of filteredUtxos) {
    const coins = utxo[1].value.coins;
    totalCoins += BigInt(coins);
    selected.push(utxo);
    if (totalCoins >= filterAmount) break;
  }

  // If user's own UTxOs are sufficient → return them
  if (totalCoins >= filterAmount) {
    return selected.map((utxo) =>
      Serialization.TransactionUnspentOutput.fromCore(utxo).toCbor()
    );
  }

  // Fallback: use the cached Nexus shared-pool UTxO if available
  const nexusCached = walletStore.nexusCollateral;
  if (nexusCached && nexusCached.utxoCbor) {
    // Nexus UTxO is 5 ADA (MAX_COLLATERAL_AMOUNT). By itself it covers the
    // maximum valid collateral request; appended to any partial user selection
    // it will also cover up to that cap.
    return [nexusCached.utxoCbor];
  }

  // No collateral anywhere
  if (selected.length === 0) {
    const error = APIError.InvalidRequest;
    error.info = 'No pure ADA UTXOs available for collateral.';
    throw error;
  }
  const error = APIError.Refused;
  error.info = 'not enough coins in configured collateral UTxOs';
  throw error;
}
```

Key changes:
- Accumulate user UTxOs first; if they cover the amount, return them
- If not, fall back to the cached Nexus UTxO (single CBOR string)
- Preserves old error semantics when both fail

- [ ] **Step 4: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "serialization.ts" | head -10`

- [ ] **Step 5: Manual verification**

1. Use a wallet with NO 5 ADA pure-ADA UTxOs (e.g., only small ADA dust + tokens)
2. After login, confirm `walletStore.nexusCollateral` is populated
3. In DevTools console on the options page:
   ```javascript
   // Simulate a dApp getCollateral call via the messaging layer
   // (This exact invocation may need the correct METHOD constant from config.)
   ```
4. Easier verification: connect to a Preprod dApp (e.g. MuesliSwap) that requires collateral. It should receive the Nexus UTxO CBOR.

- [ ] **Step 6: Commit**

```bash
git add src/chrome/serialization.ts
git commit -m "feat(cip30): fall back to Nexus shared-pool UTxO when user has no own collateral"
```

---

### Task 7: Co-sign in `SIGN_TX` handler with witness merging

**Files:**
- Modify: `src/chrome/background.ts:1571-1626`

This is the critical task — detecting the Nexus UTxO in a signed tx's `collateralInputs` and merging the Nexus witness with the user's witness before returning to the dApp.

- [ ] **Step 1: Add helper functions near other background helpers**

Add these near the other `walletManager` helpers in `background.ts`:

```typescript
/**
 * Return the Nexus-provided collateral UTxO ref if the transaction's
 * collateralInputs include it, otherwise null.
 */
function findNexusCollateralInTx(transaction: any): string | null {
  const cached = walletStore.nexusCollateral;
  if (!cached) return null;

  const collaterals = transaction?.body?.collaterals;
  if (!collaterals || collaterals.length === 0) return null;

  for (const c of collaterals) {
    const ref = `${c.txId}#${c.index}`;
    if (ref === cached.utxoRef) return ref;
  }
  return null;
}

/**
 * Merge a Nexus cosign witness CBOR into the user's witness CBOR.
 * Uses the same Map-based VKey merge pattern as SIGN_TX_WITH_POOL_KEYS.
 */
async function mergeNexusWitness(
  userWitnessCbor: string,
  nexusWitnessCbor: string
): Promise<string> {
  const { Serialization, Cardano } = await import('@cardano-sdk/core');
  const { HexBlob } = await import('@cardano-sdk/util');

  const userWs = Serialization.TransactionWitnessSet.fromCbor(HexBlob(userWitnessCbor));
  const userCore = userWs.toCore();

  const nexusWs = Serialization.TransactionWitnessSet.fromCbor(HexBlob(nexusWitnessCbor));
  const nexusCore = nexusWs.toCore();

  const mergedSignatures = new Map([
    ...(userCore.signatures?.entries() || []),
    ...(nexusCore.signatures?.entries() || []),
  ]);

  const mergedCore: Cardano.Witness = {
    signatures: mergedSignatures,
    ...(userCore.bootstrap && { bootstrap: userCore.bootstrap }),
    ...(userCore.scripts && { scripts: userCore.scripts }),
    ...(userCore.redeemers && { redeemers: userCore.redeemers }),
    ...(userCore.datums && { datums: userCore.datums }),
  };

  return Serialization.TransactionWitnessSet.fromCore(mergedCore).toCbor();
}
```

- [ ] **Step 2: Modify the `SIGN_TX` handler**

Replace the existing handler (lines 1571-1626) with:

```typescript
app.addToOptions(MessageTypes.SIGN_TX, async (request, sendResponse) => {
  try {
    const walletBg = walletManager.getWallet();
    if (!walletBg) {
      sendResponse({
        id: request.id,
        data: { error: 'Wallet instance not available' },
        target: TARGET,
        sender: SENDER.extension,
      });
      return;
    }

    let transaction;
    if (request.data.txCbor) {
      transaction = deserializeCardanoJsSdkTx(request.data.txCbor);
    } else if (request.data.tx) {
      transaction = request.data.tx;
    } else {
      throw new Error('No transaction data provided (neither tx nor txCbor)');
    }

    const privateKeyBytes = request.data.privateKeyBytes
      ? new Uint8Array(request.data.privateKeyBytes)
      : undefined;

    let witnessResult = await walletBg.signTx(
      transaction,
      request.data.password,
      request.data.accountIndex || 0,
      request.data.utxos,
      request.data.addresses,
      privateKeyBytes,
    );

    // Nexus shared-pool co-sign: if the tx's collateralInputs include the
    // cached Nexus UTxO, request the hot wallet's witness and merge it in.
    const nexusUtxoRef = findNexusCollateralInTx(transaction);
    if (nexusUtxoRef) {
      try {
        const txCbor = request.data.txCbor;
        if (!txCbor) {
          throw new Error('txCbor required for Nexus cosign');
        }
        const { witness: nexusWitnessCbor } = await nexusCollateralApi.cosign(txCbor, nexusUtxoRef);

        const userWitnessCbor = typeof witnessResult === 'string'
          ? witnessResult
          : (witnessResult as any)?.witnesses || witnessResult;

        const merged = await mergeNexusWitness(userWitnessCbor as string, nexusWitnessCbor);
        witnessResult = merged as any;
        debugLog('🔗 Merged Nexus collateral co-sign for', nexusUtxoRef);
      } catch (cosignError: any) {
        const status = cosignError?.response?.status;
        if (status === 404) {
          // UTxO consumed between lend and sign — invalidate cache for next time
          debugLog('⚠️ Nexus cosign 404 (UTxO consumed), invalidating cache');
          nexusCollateralService.invalidateAndRefresh(walletBg.id).catch(() => {});
        } else {
          debugLog('⚠️ Nexus cosign failed:', cosignError);
        }
        // Fall through: return user's witness as-is. The dApp's tx will fail
        // on submission (missing collateral witness), but the user isn't blocked.
      }
    }

    sendResponse({
      id: request.id,
      data: witnessResult,
      target: TARGET,
      sender: SENDER.extension,
    });
  } catch (error) {
    console.error('Error signing transaction:', error);
    sendResponse({
      id: request.id,
      data: { error: getErrorMessage(error) },
      target: TARGET,
      sender: SENDER.extension,
    });
  }
});
```

- [ ] **Step 3: Add the `nexusCollateralApi` import at the top of background.ts**

```typescript
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
```

- [ ] **Step 4: Add `walletStore` import if not already present**

Verify `walletStore` is imported near the top. Most background handlers already reference it.

- [ ] **Step 5: TypeScript check**

Run: `npx tsc --noEmit 2>&1 | grep "background.ts" | head -10`

Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/chrome/background.ts
git commit -m "feat(signing): co-sign Nexus shared-pool collateral in SIGN_TX handler"
```

---

### Task 8: Add i18n keys for Nexus collateral status

**Files:**
- Modify: `src/plugins/i18n/us.ts`
- Modify: `src/plugins/i18n/de.ts`

- [ ] **Step 1: Add English keys after the existing collateral block in `us.ts`**

Find `'settings.collateralUtxoRef': 'UTxO',` (current line ~1729) and add after it:

```typescript
  'settings.collateralGeroProvided': 'Collateral provided by Gero',
  'settings.collateralGeroProvidedDesc': 'Gero has provided a shared collateral UTxO for your wallet. It will be used automatically when a dApp requires collateral, and Gero will co-sign it.',
```

- [ ] **Step 2: Add German translations in `de.ts`**

Find the same anchor in `de.ts` and add:

```typescript
  'settings.collateralGeroProvided': 'Sicherheitsleistung von Gero bereitgestellt',
  'settings.collateralGeroProvidedDesc': 'Gero hat eine gemeinsam genutzte Sicherheitsleistung für Ihre Wallet bereitgestellt. Sie wird automatisch verwendet, wenn eine dApp Sicherheit benötigt, und von Gero mitunterzeichnet.',
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/i18n/us.ts src/plugins/i18n/de.ts
git commit -m "feat(i18n): add Nexus shared-pool collateral status keys"
```

---

### Task 9: CollateralTab UI with Nexus status state

**Files:**
- Modify: `src/modules/dashboard/components/CollateralTab.vue`

The current tab shows two states: green (own collateral) and yellow (none). We add a third: blue when the user has no own collateral but Nexus has provided one from the pool.

- [ ] **Step 1: Read the current script setup and import `nexusCollateral`**

Find the `toRefs(walletStore)` destructure (around line 95). Replace it with:

```typescript
const { loggedWallet, utxos, collateral, keys, nexusCollateral } = toRefs(walletStore);
```

- [ ] **Step 2: Update the template**

Replace the `<v-card-text>` block (lines 19-71 — both the green and yellow `v-alert` blocks) with:

```vue
      <v-card-text class="text-left px-0">
        <!-- Status: user-owned collateral (green) -->
        <v-alert
          v-if="collateral"
          dense
          outlined
          color="success"
          icon="mdi-check-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralAutoDetected') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralAutoDetectedDesc') }}</div>
          <v-row no-gutters class="mt-3" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralAmount') }}:</v-col>
            <v-col cols="auto" class="font-weight-medium">
              {{ filters.toCurrency(collateral[1].value.coins.toString(), false, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network), '', false, 6) }}
            </v-col>
          </v-row>
          <v-row no-gutters class="mt-1" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralUtxoRef') }}:</v-col>
            <v-col cols="auto" class="caption">
              {{ filters.truncate(`${collateral[0].txId}#${collateral[0].index}`) }}
            </v-col>
            <v-col cols="auto" class="ml-1">
              <CopyButton x-small :value="`${collateral[0].txId}#${collateral[0].index}`" />
            </v-col>
          </v-row>
        </v-alert>

        <!-- Status: Gero-provided (Nexus shared pool) collateral (blue/info) -->
        <v-alert
          v-else-if="nexusCollateral"
          dense
          outlined
          color="info"
          icon="mdi-shield-check-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralGeroProvided') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralGeroProvidedDesc') }}</div>
          <v-row no-gutters class="mt-3" align="center">
            <v-col cols="auto" class="caption mr-2">{{ $t('settings.collateralUtxoRef') }}:</v-col>
            <v-col cols="auto" class="caption">
              {{ filters.truncate(nexusCollateral.utxoRef) }}
            </v-col>
            <v-col cols="auto" class="ml-1">
              <CopyButton x-small :value="nexusCollateral.utxoRef" />
            </v-col>
          </v-row>
        </v-alert>

        <!-- Status: no collateral anywhere — manual setup -->
        <v-alert
          v-else
          dense
          outlined
          color="warning"
          icon="mdi-alert-circle-outline"
          class="mb-4"
        >
          <div class="font-weight-bold">{{ $t('settings.collateralNotFound') }}</div>
          <div class="caption mt-1">{{ $t('settings.collateralNotFoundDesc') }}</div>
          <div class="mt-3">
            <v-btn
              small
              class="geroButton"
              style="color: black!important;"
              :loading="isCreating"
              @click="setCollateral"
            >
              {{ $t('settings.setCollateral') }}
            </v-btn>
          </div>
        </v-alert>
      </v-card-text>
```

- [ ] **Step 3: TypeScript + lint check**

Run:

```
npx tsc --noEmit 2>&1 | grep "CollateralTab" | head -10
npx eslint "src/modules/dashboard/components/CollateralTab.vue" 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Manual verification**

1. **User-owned path:** Wallet with a 5+ ADA pure-ADA UTxO → green alert (unchanged)
2. **Nexus fallback path:** Wallet with no pure-ADA UTxO but Nexus provided one → blue alert with Nexus UTxO ref
3. **No collateral path:** Wallet with no own collateral AND Nexus unavailable → yellow alert with "Set Collateral" button (unchanged)

- [ ] **Step 5: Commit**

```bash
git add src/modules/dashboard/components/CollateralTab.vue
git commit -m "feat(settings): show Nexus shared-pool collateral status in CollateralTab"
```

---

### Task 10: End-to-end smoke test

**Files:** none (verification only)

- [ ] **Step 1: Fresh wallet path**

1. Create a new Preprod wallet, fund with a single small amount that leaves NO 5 ADA pure-ADA UTxO (e.g. fund with 3 ADA, or with tokens only)
2. Unlock wallet
3. Background console: expect `🏦 Nexus collateral lent: <ref>`
4. Open Settings → Collateral: expect **blue "Collateral provided by Gero"** alert
5. Connect to a Preprod dApp (e.g. Preprod MuesliSwap). Swap or action requiring collateral.
6. Expect: dApp sees the Nexus UTxO, builds tx with it in `collateralInputs`
7. Sign: background console logs `🔗 Merged Nexus collateral co-sign for <ref>`
8. dApp submits: tx succeeds

- [ ] **Step 2: User-owned priority path**

1. Send 5 ADA to the wallet (creating a pure-ADA UTxO)
2. Wait for sync; `walletStore.collateral` should become populated
3. Open Settings → Collateral: expect **green "Collateral ready"** (not blue)
4. Trigger dApp flow: `getCollateral()` should return the user's own UTxO, not the Nexus one
5. Sign: NO `🔗 Merged` log (no cosign needed)

- [ ] **Step 3: UTxO-consumed recovery path**

Requires coordination with Nexus operator to consume a specific pool UTxO.

1. Note `walletStore.nexusCollateral.utxoRef`
2. Manually consume it on Preprod (via Nexus admin or faucet)
3. Wait up to 10 min for the next `validateIfStale` tick
4. Expect: `🔄 Nexus collateral consumed on-chain, refreshing: ...` → `🏦 Nexus collateral lent: <newRef>`
5. `walletStore.nexusCollateral.utxoRef` updated to new ref

- [ ] **Step 4: Nexus-down degradation**

1. Block `nexus-dev.gerowallet.io` in /etc/hosts (or DevTools network blocker)
2. Reload extension, unlock
3. If wallet had no cache → background logs `⚠️ Nexus /lend failed (non-fatal): ...`
4. If wallet had cache → logs `⚠️ Nexus /status failed (keeping cache optimistically): ...`
5. Wallet functions normally. CollateralTab: yellow warning if no own + no cached Nexus collateral; blue if cached Nexus collateral exists (optimistic)

- [ ] **Step 5: No commit**

Verification only.

---

## Self-Review Checklist

1. **Phase A (Nexus backend) coverage:**
   - [x] Hot wallet config + properties (A1)
   - [x] Ed25519 signing + blake2b service (A2)
   - [x] Flyway migration for pool table (A3)
   - [x] Entity + repository (A4)
   - [x] Startup pool reconcile (A5)
   - [x] Scheduled monitor for consumed UTxOs (A6)
   - [x] Business logic with security checks (A7)
   - [x] REST controller + device JWT auth (A8)
   - [x] Unit tests (A9)

2. **Phase B (client) coverage:**
   - [x] Shared pool at enterprise address (no franken)
   - [x] DB persistence via `wallet-db` config table (Task 3)
   - [x] Fetch on login, validate via `/status` (Task 4)
   - [x] Periodic re-validation on sync tick (Task 5)
   - [x] `getCollateral()` fallback (Task 6)
   - [x] Co-sign + witness merge in `SIGN_TX` (Task 7)
   - [x] UI state for Nexus-provided collateral (Task 9)
   - [x] i18n keys in EN + DE (Task 8)
   - [x] Graceful degradation when Nexus is down (Tasks 3, 4, 7)
   - [x] Non-blocking login (Task 4 uses `setTimeout(0)`)

3. **Files explicitly NOT touched:**
   - `gerowallet/src/chrome/walletBg.ts` — franken filter unchanged
   - `gerowallet/src/shared/utils/builder.ts` — `excludeCollateral` path unchanged
   - `gerowallet/src/popup/modules/views/SignTx.vue`, `src/sidepanel/components/DAppOverlay.vue` — co-signing is transparent
   - `gerowallet/src/db/wallet-db.ts` schema — reuse existing `config` table
   - `gerowallet/.env.*`, `scripts/manifest.ts` — unchanged
   - `nexus` other endpoints — only new `/v1/collateral/*` added

4. **Commits are atomic:**
   - Phase A: 9 commits (config → signing → migration → entity+repo → init → monitor → service → controller → tests)
   - Phase B: 9 commits (API client → store state → service → login init → sync validation → getCollateral fallback → SIGN_TX co-sign → i18n → UI)
   - Each independently revertable
   - Phase A must be deployed before Phase B is shipped to production; Phase B can be developed and tested locally against a dev Nexus running Phase A

---

## Nexus Backend API Spec

The full API is implemented in Phase A Tasks A7–A8. Endpoint summary for cross-reference:

| Endpoint | Auth | Response success | Response errors |
|----------|------|------------------|-----------------|
| `POST /v1/collateral/lend` | Device JWT | `{ utxoRef, utxoCbor, address }` | 503 pool exhausted / not ready |
| `GET /v1/collateral/status?utxoRef=...` | Device JWT | `{ valid, reason? }` | — |
| `POST /v1/collateral/cosign` | Device JWT | `{ witness }` | 400 adversarial (UTxO in inputs) / 404 unknown or consumed / 503 not ready |
