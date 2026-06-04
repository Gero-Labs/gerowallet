# Shielded NIGHT send via Gero-cloud proving

**Status:** Plan, ready to execute.
**Date:** 2026-06-04
**Scope:** Shielded NIGHT send (mn_shield-addr_… → mn_shield-addr_…), shield/unshield bridge (via `initSwap`), Gero-cloud-side ZK proving with an explicit privacy consent flow. User-local Docker proof server is deferred.
**Pairs with:** [2026-05-26-midnight-tx-asymmetric-split.md](2026-05-26-midnight-tx-asymmetric-split.md) (unshielded is shipped; we reuse the wire format).

---

## 1. Decisions already locked in

- **Server-side proving** for shielded txs. The wallet ships the unproven-but-signed shielded tx to Nexus; the sidecar runs the ZK prover; returns the finalized tx (or just the txHash post-submit).
- **Required first-time consent dialog** before the first shielded send. Explains that Gero servers receive witness data that can link the user's shielded notes to the spend. Includes a "Set up local Docker (coming soon)" CTA.
- **New sidecar endpoint:** `POST /tx/prove-and-submit` (shielded only). Keeps unshielded's `/tx/finalize` untouched. Separate routes mean separate logging / rate-limit / future auth policies.
- **No hardware-wallet support** for shielded — same constraint as unshielded (cleartext Zswap secret required at proof time, no HW signer integration in the SDK).

## 2. Architecture summary

```
┌──────────── Wallet (BG service worker) ─────────────┐    ┌─── Nexus ───┐
│ 1. Sync: subscribe to `shieldedTransactions(...)`   │    │             │
│    on indexer GraphQL WS. Decrypt every new note    │    │             │
│    with ZswapEncryptionSecretKey. Persist set to    │    │             │
│    IndexedDB (Lace-style snapshot). ←─── *cursor*   │    │             │
│                                                      │    │             │
│ 2. User clicks Send (shielded)                      │    │             │
│    Consent shown (first time only, persisted flag)  │    │             │
│                                                      │    │             │
│ 3. ShieldedWallet.transferTransaction(zswapSk, outs)│    │             │
│    → unproven tx (signature + pre-proof + pre-bind) │    │             │
│                                                      │    │             │
│ 4. Serialize → hex                                  │    │             │
│ 5. POST /tx/prove-and-submit ───────────────────────▶│             │
│                                                      │    │ Java relay  │
│                                                      │    │ → sidecar   │
│                                                      │    │             │
│                                  proveTransaction()  │    │  /sidecar:  │
│                                  → finalized tx     │    │  /tx/prove- │
│                                  → midnight.send-   │    │  and-submit │
│                                    MnTransaction()  │    │             │
│                                                      │    │             │
│ 6. ◀──── { txHash, status } ────────────────────────│             │
└──────────────────────────────────────────────────────┘    └─────────────┘
```

Witnesses ship as part of the unproven tx bytes. **Anyone who can read the request body can de-anonymize the spend for that tx.** This is the explicit cost of cloud-side proving and must be surfaced to the user.

## 3. Non-goals

- Local Docker proof server (Phase 2). The sidecar's proving service is shared between unshielded and shielded for v1; per-user routing comes later.
- Multi-recipient shielded sends. v1 is single-recipient; multi can follow if `transferTransaction` accepts arrays cleanly.
- Per-tx user choice of "send via Gero / send via my local Docker" — that's a Phase 2 toggle; v1 is Gero-cloud only with a one-time consent gate.
- Shielded DUST. NIGHT only; shielded DUST has weird ergonomics (DUST is gas, normally only spent as fees) and isn't a v1 need.

## 4. Wallet-side work

### 4.1 Install + bundle `@midnight-ntwrk/wallet-sdk-shielded`

The sidecar already has `2.1.0`. Wallet's `package.json` does not — add the dependency. Already-installed dependencies (`@midnight-ntwrk/ledger-v8`, `wallet-sdk-abstractions`, `wallet-sdk-runtime`, etc.) cover its transitive deps; expect no new Vite shims given the bundle parity with `wallet-sdk-unshielded-wallet`.

**Verify bundle weight** with a smoke probe like we did for dust (`midnightDustSdkProbe.ts`). Expect ~1–2 MB gzipped over current. If much larger, investigate before wiring further.

### 4.2 Shielded sync (BG)

**File:** `src/services/midnight-shielded-sync.service.ts` (new).

- Subscribe to indexer's `shieldedTransactions(sessionId: …, index: $i)` GraphQL subscription via gero-sync (NOT directly — keep the indexer connection on gero-sync's side, dispatched to wallet via the existing WS protocol).
- gero-sync side: add `MidnightShieldedTxSubscriber` mirroring `MidnightUnshieldedTxSubscriber` — same shape, different GraphQL subscription, different session-id keying. The wallet's `sessionId` is derived from the user's Zswap encryption pubkey; that's what gero-sync sends as the indexer subscription arg.
- Wallet: on each `SYNC` payload with shielded notes, attempt decryption with `ZswapEncryptionSecretKey.test(encryptedBlob)`. Successful decryptions go into the persisted shielded UTxO set; failures are silently dropped (just noise).

**State:** new `midnightStore.shieldedUtxos: ZswapShieldedUtxo[]` + `lastShieldedTxIndex: number | null`. Same incremental-update + idempotent `(commitment, …)` keying pattern we just shipped for unshielded.

**Cold sync cost:** worst-case the wallet decrypts every shielded tx on chain. Foundation preview is at ~1M blocks; if every block had shielded activity, that's millions of failed-decrypt attempts on first install. Mitigate by:
- Letting gero-sync's `shieldedTransactions` server-side stream the user's-only notes when given the right session ID (per Midnight's design — verify in the indexer schema).
- Persisting `lastShieldedTxIndex` cursor so reconnects only stream from there (same pattern as unshielded).

### 4.3 Consent dialog

**File:** `src/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue` (new).

- Shown the first time the user attempts a shielded send.
- Acknowledgement checkbox: "I understand Gero's servers will see the witness data for each shielded transaction I send, and can link my shielded notes to those sends."
- Two buttons: **"Use Gero Cloud (continue)"** and **"Set up local Docker (coming soon — opens FAQ)"**.
- On consent: set `midnightStore.shieldedProvingConsent = { version: 1, acceptedAt: <ms> }`. Persisted via `chrome.storage.local` like the rest of the store. Re-prompt if the version field ever bumps (consent invalidation).
- Send dialog gates the submit on `shieldedProvingConsent.version === 1`. Missing/older → open consent dialog instead of sending.

### 4.4 Shielded send dialog

Extend `MidnightSendDialog.vue` (already extracted in commit `978bd21a`) with a tab/toggle: **Unshielded ▾ | Shielded**.

- Unshielded path: unchanged, uses today's `sendUnshieldedNight`.
- Shielded path: validates `mn_shield-addr_…` prefix, calls a new `sendShieldedNight(...)` service method, gates on consent.

**File:** `src/services/midnight-tx.service.ts` — add `sendShieldedNight(network, baseRequest, credentials)`:

```ts
export async function sendShieldedNight(
  network: string,
  baseRequest: { fromShieldedAddress: string; outputs: Array<{address, amount, token:'NIGHT'}>; ttlMs: number },
  credentials: MidnightSendCredentials,
): Promise<SubmitMidnightTxResponse> {
  // 1) BG handler: mnemonic decrypt → Zswap keys → ShieldedWallet → transferTransaction → return signed-unproven hex
  const signedUnprovenHex = await buildAndSignShieldedInBg(baseRequest, credentials);
  // 2) Ship to sidecar via Nexus → prove + submit → txHash
  return api.proveAndSubmitMidnightTx({ signedTxHex: signedUnprovenHex });
}
```

### 4.5 BG handler

**File:** `src/chrome/walletBg.ts` (extend), `src/chains/midnight/midnightTxBuilder.ts` (extend or split into `…Unshielded.ts` + `…Shielded.ts`).

- `BUILD_AND_SIGN_MIDNIGHT_SHIELDED_TX` message type, same shape as the unshielded one but with `fromShieldedAddress` instead of `fromAddress`.
- Method `buildAndSignMidnightShieldedTransfer(outputs, ttlMs, password?, prfSecret?)`:
  - Decrypt mnemonic (same pattern as unshielded)
  - Derive `ZswapSecretKeys` via `deriveMidnightKeys` (extend that helper if needed)
  - `shieldedWallet.transferTransaction(zswapSecretKeys, outputs)` → unproven tx
  - Serialize → hex → return
  - Wipe keys in finally

The shielded SDK's `transferTransaction` returns a tx that's already signed (signature marker) — the SDK signs inside the call because Zswap-side input signatures aren't separable like the unshielded ones. So no separate `signUnprovenTransaction` step.

### 4.6 Shield / Unshield bridge (deferred to immediate follow-up)

`UnshieldedWallet.initSwap(desiredInputs, desiredOutputs, ttl)` builds a tx that atomically:
- Burns some unshielded UTxOs
- Mints corresponding shielded notes (or vice versa)

Same `proveAndSubmit` shape. The wallet builds both legs (unshielded + shielded inputs/outputs) in one tx. UI: a "Shield NIGHT" / "Unshield NIGHT" button alongside the Send tab.

**Out of v1 scope** to keep this plan tractable. Ship shielded send first, swap follows.

## 5. Server-side work

### 5.1 Sidecar — new route

**File:** `nexus/sidecar/src/routes/proveAndSubmit.ts` (new).

```ts
POST /tx/prove-and-submit
Body: { network: 'midnight-preview' | …, signedTxHex: string }
Response: { signedTxHex: string, txHash: string }
```

Internals: copy `/tx/finalize` (already minimal) — deserialize signed-unproven hex → `proveTransaction(tx)` → `submitMidnightTransaction(rpcUrl, signedBytes)` → return txHash + signedTxHex.

The endpoint is structurally identical to `/tx/finalize` today; the separate route exists for **policy**, not technical, reasons: lets us add witness-data scrubbing in logs, different rate limits, and the eventual proof-server-router (Gero Cloud vs user's Docker) without touching unshielded.

**Logging policy:** **never log the request body or any tx field** on this route. Witness data linking shielded notes to sends is the whole privacy concern. Log only: timestamp, network, txHash (post-submit), prove duration, submit duration.

### 5.2 Java relay

**File:** `nexus/src/main/java/io/gerowallet/controller/midnight/MidnightTransactionsController.java`.

- Add `POST /api/v1/midnight/{network}/tx/prove-and-submit` that proxies to the sidecar.
- Same `canWriteMidnight()` scope gate.
- New DTO: `ProveAndSubmitTxRequest { signedTxHex }` (no envelope unpacking — pass-through, same as the simplified `/tx/finalize`).
- Service: trivial pass-through to `MidnightSidecarClient.proveAndSubmit(req)`.

### 5.3 gero-sync — shielded subscription

**File:** `gero-sync/src/main/java/io/gerowallet/sync/chain/midnight/MidnightShieldedTxSubscriber.java` (new).

Mirrors `MidnightUnshieldedTxSubscriber` but subscribes to `shieldedTransactions(sessionId: $sid, index: $i)`. Address-keyed by `sessionId` (derived from the wallet's Zswap encryption pubkey, NOT a wallet address — the wallet provides it on SUBSCRIBE).

- New SUBSCRIBE field: `midnightShieldedSessionId: HexEncoded` + `midnightShieldedLastIndex: Integer` (same cursor-resume pattern we just shipped for unshielded).
- New TxData field on the dispatch payload: `midnightShieldedIndex` (for cursor advancement on the wallet side).

## 6. Open questions to resolve while building

1. **Shielded session ID derivation.** Confirm with Midnight docs whether `sessionId` is `hash(zswapEncryptionPublicKey)` or another shape. The `shieldedTransactions` subscription schema in our indexer probe (`/api/v3/graphql`) gave `sessionId: HexEncoded!`; SDK side is `ZswapLocalState` watching.
2. **Note decryption cost on cold sync.** If the indexer's `shieldedTransactions(sessionId, …)` already filters server-side to a sessionId-matching set, the wallet's decrypt cost is bounded. If it streams *everything* and the wallet decrypts every blob, the cold sync is unbounded. Verify before deciding whether gero-sync needs to do server-side filtering as well.
3. **Consent text wording.** Draft above is engineer-prose. Needs a UX pass before ship — flag for the design / content review.
4. **DUST balancing for shielded tx fees.** Confirmed unshielded txs need DUST fees; verify shielded txs do too (they should, same fee model). If yes, the BG handler also runs `dustWallet.balanceTransactions(dustSk, [shieldedUnproven], ttl)` before serializing. The `[unprovenTx]` array on `balanceTransactions` is chain-agnostic per the SDK signature.
5. **PassKey/PRF gesture handling on shielded send.** Same as unshielded — one WebAuthn ceremony, derive Zswap keys from the mnemonic. Verify no extra prompts are needed.

## 7. Execution order

1. **Spike: install + smoke-import `wallet-sdk-shielded` in the wallet BG bundle.** Confirms no new Vite shims; measure bundle weight delta. ~1 hour.
2. **Sidecar `/tx/prove-and-submit` + Java relay** (no wallet dependency). Tests with a hand-crafted shielded tx hex from the SDK's test fixtures. ~1 day.
3. **Wallet shielded sync (gero-sync side + wallet store).** Adds shieldedUtxos to the store, cursor-resume protocol field, gero-sync subscriber. ~2 days.
4. **Wallet shielded build + sign in BG** (extends `midnightTxBuilder`, new BG handler). Single-recipient first. ~1 day.
5. **Consent dialog + tab toggle in `MidnightSendDialog`.** Renders + persists consent. ~half day.
6. **End-to-end on preview.** Real shielded send between two wallets we control. ~half day.
7. **Follow-up (separate plan): `initSwap` for shield/unshield bridge.**
8. **Follow-up (separate plan): user-local Docker proof server option.**

Total: ~5–6 days for shielded send v1.

## 8. Rollback

- Wallet: shielded send is feature-flagged (`midnight.shielded.enabled` in `featureFlagsStore`). Default off. Roll forward by flipping on; roll back by flipping off.
- Sidecar / Java: `/tx/prove-and-submit` is a new route — leaving it deployed is no-op for non-shielded traffic. Removing the route is a `git revert` + rebuild + redeploy if needed.

## 9. What this leaves on the table

- **Local Docker proof server** — explicitly deferred. Documented as a Phase-2 follow-up; the consent dialog already shows a "coming soon" CTA so users know it's planned.
- **Multi-recipient shielded txs** — v1 is single-recipient.
- **Shielded transaction history UI** — minimal at v1 (just balance change); rich tx history can layer on later.
- **Hardware wallet support** — same constraint as unshielded; deferred indefinitely until Midnight SDK exposes a hw-signer path.
