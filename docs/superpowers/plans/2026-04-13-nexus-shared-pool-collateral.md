# Nexus Shared-Pool Collateral Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the "I need 5 spare ADA to use any dApp" onboarding blocker by sharing a small fixed pool of 5 ADA UTxOs across all users. Each wallet caches a pool UTxO reference in its local DB; `getCollateral()` returns it instantly with no network call; Nexus co-signs only when a dApp actually uses the collateral.

**Architecture:** Nexus maintains a fixed pool of ~20 UTxOs at a single enterprise address controlled by its hot wallet payment key. Because collateral inputs are only referenced (not consumed) in the success path, multiple users can reference the same UTxO simultaneously. On wallet login, the client lends one from the pool and persists the reference in `wallet-db`. On subsequent dApp interactions, `getCollateral()` returns from cache — zero network calls. On `signTx`, if the transaction's `collateralInputs` include the cached Nexus UTxO, the background calls `/v1/collateral/cosign` and merges both witnesses before returning to the dApp. Periodic sync ticks validate the cached UTxO is still on-chain; if consumed (rare, Phase 2 failure elsewhere), the cache is refreshed.

**Tech Stack:** Vue 2.7, TypeScript, Vuetify 2.7, `@cardano-sdk/core` v0.46.9, Axios, Dexie 4.0.7, existing Nexus JWT auth (`nexusDevice.service.ts`).

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

| # | Decision | Resolution |
|---|----------|-----------|
| D1 | Backend | **Nexus** — existing infra, no new service |
| D2 | URL / env var | Same `VITE_NEXUS_URL` — CSP already allows `*.gerowallet.io` |
| D3 | Pool size | **~20 UTxOs × 5 ADA = 100 ADA** total hot wallet funding (not per user — shared across all users) |
| D4 | Key management | Whatever Nexus already uses for server-side secrets |
| D5 | dApp allowlist | **Open** — Nexus verifies `utxoRef` is only in `collateralInputs`, never in `inputs` |
| D6 | Rate limiting | Device JWT rate limits `/lend` to once per minute per device |
| D7 | Kill switch | Nexus config flag. Client degrades gracefully to "Set Collateral" manual flow |
| D8 | Address type | **Enterprise address** (payment key only, no staking) — simpler, not tied to any user's stake |
| D9 | UTxO sharing | Many users can reference the same pool UTxO simultaneously (collateral is only consumed on Phase 2 failure, which is extremely rare) |

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

| Flow | Nexus call? | Performance |
|------|-------------|-------------|
| Wallet login (no cache) | `POST /lend` | Once per wallet lifetime |
| Wallet login (cached) | `GET /status?ref=...` | Lightweight validation |
| Regular sync tick (every ~60s) | `GET /status?ref=...` | Background only |
| dApp `getCollateral()` | **None** — served from cache | Instant |
| dApp `signTx` with Nexus collateral | `POST /cosign` | Unavoidable (Nexus holds key) |

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

| Scenario | Behavior |
|----------|----------|
| Nexus down on login, no cache | Fall back to existing "no collateral" state; manual "Set Collateral" still works |
| Nexus down on login, cache exists | Use cache optimistically; will work if UTxO still valid on-chain |
| Cached UTxO consumed mid-session (rare) | `cosign` returns 404 → client clears cache, fetches fresh UTxO. Current dApp tx fails (UTxO baked into already-signed tx); user retries with fresh UTxO |
| Pool exhausted | `/lend` returns 503 → client treats as no Nexus collateral |
| Cosign returns 400 (UTxO in inputs, not just collateralInputs) | dApp tx rejected before signing — this is an adversarial dApp. Return error to UI. |

---

## File Structure

### Nexus Backend (API Contract — backend team implements)

| Endpoint | Method | Request | Response | Notes |
|----------|--------|---------|----------|-------|
| `/v1/collateral/lend` | POST | `{}` (auth identifies device) | `{ utxoRef, utxoCbor, address }` | Idempotent per device within a time window |
| `/v1/collateral/status` | GET | `?utxoRef=txHash%23N` | `{ valid: boolean, reason?: 'consumed'\|'unknown' }` | Cheap — check chain or cache |
| `/v1/collateral/cosign` | POST | `{ txCbor, utxoRef }` | `{ witness }` | Verifies `utxoRef` in `collateralInputs` only |

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

1. **Spec coverage:**
   - [x] Shared pool at enterprise address (no franken) (Nexus API contract)
   - [x] DB persistence via `wallet-db` config table (Task 3)
   - [x] Fetch on login, validate via `/status` (Task 4)
   - [x] Periodic re-validation on sync tick (Task 5)
   - [x] `getCollateral()` fallback (Task 6)
   - [x] Co-sign + witness merge in `SIGN_TX` (Task 7)
   - [x] UI state for Nexus-provided collateral (Task 9)
   - [x] i18n keys in EN + DE (Task 8)
   - [x] Graceful degradation when Nexus is down (Tasks 3, 4, 7)
   - [x] Non-blocking login (Task 4 uses `setTimeout(0)`)

2. **Files explicitly NOT touched:**
   - `src/chrome/walletBg.ts` — franken filter unchanged
   - `src/shared/utils/builder.ts` — `excludeCollateral` path unchanged
   - `src/popup/modules/views/SignTx.vue`, `src/sidepanel/components/DAppOverlay.vue` — co-signing is transparent
   - `src/db/wallet-db.ts` schema — reuse existing `config` table
   - `.env.*`, `scripts/manifest.ts` — unchanged

3. **Commits are atomic:**
   - 9 commits (API client → store state → service → login init → sync validation → getCollateral fallback → SIGN_TX co-sign → i18n → UI)
   - Each independently revertable

---

## Nexus Backend API Spec (contract for backend team)

### `POST /v1/collateral/lend`

**Auth:** Device JWT

**Request:** `{}` (empty body — device identity comes from JWT)

**Response 200:**
```json
{
  "utxoRef": "abc123...#0",
  "utxoCbor": "82825820abc...",
  "address": "addr1v87c4cxx..."
}
```

**Response 503:** Pool exhausted / kill switch.

**Behavior:**
- Pick any valid (unconsumed) UTxO from the pool
- Many devices may be assigned the same UTxO — this is intentional (concurrent sharing is safe)
- Rate limit: one call per device per minute

### `GET /v1/collateral/status?utxoRef=<ref>`

**Auth:** Device JWT

**Request:** query param `utxoRef=abc123...%230`

**Response 200:**
```json
{ "valid": true }
```
or
```json
{ "valid": false, "reason": "consumed" }
```

**Behavior:** Fast check against chain index. Answers: "does this UTxO still exist on-chain?"

### `POST /v1/collateral/cosign`

**Auth:** Device JWT

**Request:**
```json
{
  "txCbor": "84a400...",
  "utxoRef": "abc123...#0"
}
```

**Response 200:**
```json
{ "witness": "a100818258..." }
```

**Response 400:** UTxO ref appears in `inputs` (not just `collateralInputs`) — adversarial tx, refuse to sign.

**Response 404:** UTxO has been consumed. Client invalidates its cache.

**Behavior:**
1. Parse `txCbor`
2. Verify `utxoRef` ∈ `tx.body.collateralInputs` AND `utxoRef` ∉ `tx.body.inputs`
3. Compute `blake2b-256(tx.body.toCbor())` → tx body hash
4. Ed25519 sign with the hot wallet payment signing key
5. Build a `TransactionWitnessSet` with the single VKeyWitness and return its CBOR
