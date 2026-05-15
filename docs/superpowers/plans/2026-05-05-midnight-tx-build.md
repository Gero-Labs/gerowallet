# Midnight transaction building — architecture & phasing

**Status:** Plan, awaiting alignment.
**Date:** 2026-05-05
**Scope:** Native unshielded + shielded send, proof-server modes, DUST registration in-Gero.

---

## 1. Goals & non-negotiable constraints

**Goals**

1. User can send unshielded NIGHT from Gero (no portal redirect).
2. User can send shielded NIGHT from Gero with proof generation.
3. User can register for DUST from Gero with their Cardano wallet (replaces the "Open Redemption Portal" redirect).
4. Two proof-server modes supported: user-local (default for shielded), Gero-cloud (opt-in privacy-degraded).
5. Build pipeline mirrors Cardano (Nexus builds, browser signs, Nexus relays).

**Non-negotiable constraints (from research)**

- **Witness data must never leave the user machine for *default* shielded sends.** Lace + Midnight docs are explicit: a remote proof server consumes private secrets. Routing all users through Gero Cloud by default would defeat the privacy guarantee. Cloud is opt-in only with a clear consent flow.
- **No hardware wallet support.** Midnight requires the cleartext key at proof-gen time; Ledger/Trezor cannot expose private keys. Password + PRF only (matches Lace's choice, already documented in our gap analysis).
- **The build pipeline must be Nexus-shaped** to mirror Cardano (`nexus-tx-api.ts` pattern). The user explicitly asked for this.

---

## 2. Architecture

### 2.1 Three-tier split (mirrors Cardano)

```
┌────────────────┐   build       ┌─────────────┐   prove?   ┌────────────────┐
│  Browser       │──────────────▶│   Nexus     │            │ Proof server   │
│  (options page)│  POST /build  │  (runs SDK) │            │  Local Docker  │
│                │◀──────────────│             │            │  OR GCP-cloud  │
│                │  unproven tx  │             │            └────────────────┘
│                │                                                ▲
│                │   prove (shielded only) ──────────────────────│
│                │                                                │
│                │   sign (signSegment cb) — local in BG         │
│                │                                                │
│                │   submit       ┌─────────────┐                │
│                │──────────────▶│  Nexus      │   relay        │
│                │  POST /submit │             │───▶  Midnight   │
│                │               │             │      RPC node   │
│                │◀──────────────│             │                  │
│                │  txHash       └─────────────┘                  │
└────────────────┘
```

Rationale:

- **Build at Nexus**: Nexus already has the SDK runtime, indexer access, and per-network configuration. Wallet ships only the address-derivation portion of the SDK (`wallet-sdk-hd` + `wallet-sdk-address-format`), avoiding the heavy `ledger-v8` WASM in the browser bundle.
- **Sign in browser/BG**: The `signSegment` callback (`(data: Uint8Array) => Signature`) is a clean key boundary. We pass a callback that runs in BG, decrypts the user's NightExternal/Zswap secret key on demand, and returns BIP-340 signatures. The SDK never sees the raw key.
- **Submit through Nexus**: Mirrors `submitTx` in Cardano. Lets Nexus enforce policy, observe success/failure, and retry on transient RPC errors.

### 2.2 Proof server modes

```
┌─────────────────────────────────────────────────────────────────┐
│ Settings → Midnight → Proof server                              │
│                                                                  │
│ ◉ Local Docker (recommended for shielded)                        │
│     URL: http://localhost:6300                                   │
│     [Test connection] ✓ Healthy                                  │
│                                                                  │
│ ○ Gero Cloud (privacy-degraded)                                  │
│     ⚠ Sends witness data to Gero servers. Read consent.          │
│                                                                  │
│ ○ In-browser WASM (experimental, slow)                           │
│     [Disabled — pending bundle decision]                         │
└─────────────────────────────────────────────────────────────────┘
```

| Mode | Default? | Privacy | UX cost | When to pick |
|---|---|---|---|---|
| Local Docker | yes | strongest | one-time `docker run` | shielded sends |
| Gero Cloud | opt-in | degraded | none | unshielded only / users who explicitly accept |
| WASM | future | strongest | minutes per proof | sealed for now |

Critically: **unshielded send needs no proof server**, so this UI is only relevant once shielded ships. Phase 1 ignores it entirely.

### 2.3 Signing model

We pass `signSegment: (data: Uint8Array) => Signature` to `signUnprovenTransaction(...)`. Implementation:

```
SDK on Nexus  ─────►  unprovenTx bytes  ─────►  Browser
                                                     │
                                                     ▼
                                         For each segment in tx:
                                           POST to BG: SIGN_MIDNIGHT_SEGMENT
                                             { walletId, role, segmentBytes }
                                                     │
                                                     ▼
                                         BG: decrypt mnemonic (pwd / PRF)
                                              derive role-key from HD
                                              sign segment (BIP-340)
                                              wipe key
                                              return signature
                                                     │
                                                     ▼
                                         Browser collects signatures,
                                         re-bundles into UnprovenTransaction,
                                         POSTs to Nexus /submit
```

This isolates key material to BG and re-uses the existing PRF/password decryption pattern (`webauthn-prf.ts`, `crypto.ts`).

---

## 3. Phasing

### Phase 1 — Unshielded send (~1.5 weeks)

**Wallet-side (this repo):**

| File | Action | Notes |
|---|---|---|
| `src/api/midnight-api.ts` | Add `buildUnshieldedTx()`, `submitTransaction()` already exists, document expected shapes | ~80 LOC |
| `src/models/MessageTypes.ts` | Add `SIGN_MIDNIGHT_SEGMENT`, `SIGN_AND_SUBMIT_MIDNIGHT_TX` | trivial |
| `src/chrome/walletBg.ts` | Add `signMidnightSegments(segments[], password?, prfSecret?)`: decrypt mnemonic → derive role keys → sign each segment → return | ~120 LOC, mirrors `signBitcoinTransaction` |
| `src/chrome/background.ts` | Wire the two new MessageType handlers | ~80 LOC |
| `src/services/midnight-tx.service.ts` | NEW — orchestrates build → sign → submit. Browser-side composable | ~150 LOC |
| `src/modules/dashboard/dialogs/SendDialog.vue` | Replace Midnight "coming soon" branch with real send form (unshielded amount, recipient, fee preview, sign button) | ~250 LOC |
| `src/shared/composables/useMidnightTransactionSigning.ts` | NEW — composable mirroring `useTransactionSigning.ts` for Midnight signing flow | ~200 LOC |
| Tests + i18n | n/a | strings + de mirror |

**Nexus-side (separate repo, out of scope for this Gero PR):**

| Endpoint | Method | Body | Returns |
|---|---|---|---|
| `/api/v1/midnight/{network}/tx/build-unshielded` | POST | `{ from, recipients[], ttl }` | `{ unprovenTxHex, txHash, segmentsToSign[] }` where each segment is `{ index, role, dataHex }` |
| `/api/v1/midnight/{network}/tx/submit` | POST | `{ signedTxHex }` | `{ txHash, status: 'Submitted' \| 'InBlock' \| 'Finalized' }` |

**Acceptance criteria for Phase 1:**

- User can pick a recipient + amount, click Send, sign with PassKey/password, see the tx confirmed.
- BG never holds the mnemonic longer than the duration of `signMidnightSegments`.
- Failure modes (wrong amount, insufficient balance, network rejection) surface as readable errors.
- Mainnet + Preview both work (network-aware Nexus endpoints).

### Phase 2 — Proof server settings (~3 days)

**Wallet-side:**

| File | Action |
|---|---|
| `src/stores/walletStore.ts` | Add `midnightProofServerMode: 'local' \| 'cloud'` + `midnightProofServerUrl: string` to per-wallet config |
| `src/modules/dashboard/dialogs/SettingsDialog.vue` | New "Midnight Proof Server" section — radio buttons + URL field + connection-check button |
| `src/api/midnight-api.ts` | Add `checkProofServerHealth(url)` — GET `{url}/health` with 5s timeout |
| Consent dialog | New component for the cloud-mode opt-in. One-time confirmation, persisted as `acknowledgedCloudProofServer: true` |

### Phase 3 — Shielded send (~2 weeks)

**Wallet-side:**

| File | Action |
|---|---|
| `package.json` | Add `@midnight-ntwrk/wallet-sdk-shielded@^3.0.0`, `@midnight-ntwrk/wallet-sdk-prover-client@^1.0.0` |
| `src/services/midnight-tx.service.ts` | Add `buildShieldedTx`, `proveShieldedTx`, branches per `proofServerMode` (local fetch vs Nexus proxy) |
| `src/modules/dashboard/dialogs/SendDialog.vue` | Add shielded/unshielded toggle at top of Midnight send form. Show proving progress overlay (already wired into `midnightStore.provingOperations`) |
| Routing | If `proofServerMode === 'cloud'`, the prover client points at Nexus's `/api/v1/midnight/{network}/proof-server/prove` proxy endpoint (no direct user→GCP path) |

**Nexus-side:**

| Endpoint | Action |
|---|---|
| `/api/v1/midnight/{network}/tx/build-shielded` | New — same shape as unshielded, builds via `wallet-sdk-shielded.transferTransaction` |
| `/api/v1/midnight/{network}/proof-server/prove` | New proxy endpoint to GCP proof server pod. Only invoked when wallet is in cloud mode. |

### Phase 4 — DUST registration native (~3 days)

Replaces "Open Redemption Portal" with native sign+submit using Gero's Cardano CIP-30. The wallet already has [`MidnightApi.buildDustRegistrationTx()`](../../src/api/midnight-api.ts) returning Cardano CBOR.

| File | Action |
|---|---|
| `src/modules/dashboard/dialogs/DustRegistrationDialog.vue` | Add "Sign in Gero" primary action when user has a Cardano mainnet wallet derived from same mnemonic. Falls back to "Open Portal" if not. |
| `src/services/midnight-tx.service.ts` | Add `registerForDust({ cardanoWalletId, dustAddress })` — calls `buildDustRegistrationTx`, dispatches signing through existing `useTransactionSigning` (Cardano path), submits via existing Cardano submit. |

---

## 4. Open questions for alignment

Before we go beyond Phase 1 scaffolding, please confirm:

1. **Architecture confirmed**: Nexus builds + relays submit; browser signs via `signSegment` callback; mnemonic decryption stays in BG. Yes/no?
2. **Nexus endpoint capacity**: Phase 1 needs Nexus to expose `/build-unshielded` + `/submit`. Is that scoped on the Nexus team, or do we need a "build locally in browser" fallback?
3. **Proof server policy**: Local-Docker default for shielded; Gero Cloud opt-in with consent dialog. Confirm the consent text wording approach (we'll draft it before Phase 2).
4. **Hardware wallet stance**: Document as "not supported on Midnight" in UI; route users to keep cleartext / PRF wallets. OK?
5. **DUST native flow**: Do we require a same-mnemonic Cardano sibling, or do we let users connect any Cardano wallet via CIP-30 inside the Midnight wallet view?

---

## 5. Files this plan will create or change (Phase 1 only)

**New:**
- `src/services/midnight-tx.service.ts`
- `src/shared/composables/useMidnightTransactionSigning.ts`

**Modified:**
- `src/api/midnight-api.ts`
- `src/models/MessageTypes.ts`
- `src/chrome/walletBg.ts`
- `src/chrome/background.ts`
- `src/modules/dashboard/dialogs/SendDialog.vue`
- `src/plugins/i18n/us.ts` + `src/plugins/i18n/de.ts`

Total estimate Phase 1: ~900 LOC wallet-side, plus the two Nexus endpoints.

---

## 6. References

- Cardano pipeline pattern: `src/api/nexus-tx-api.ts`, `src/shared/composables/useTransactionSigning.ts`, `src/chrome/walletBg.ts:1616-1665`
- SDK contracts: `node_modules/@midnight-ntwrk/wallet-sdk-unshielded-wallet/dist/UnshieldedWallet.d.ts`, `node_modules/@midnight-ntwrk/wallet-sdk-prover-client/dist/effect/ProverClient.d.ts`
- Proof-server constraint: [docs.midnight.network — Lace setup](https://docs.midnight.network/develop/how-to/lace-wallet); [Aleen99 deep dive](https://dev.to/aleen99/proof-server-and-indexer-how-midnight-processes-transactions-2026-04-15-2626)
- Existing scaffolding: `src/chains/midnight/midnightKeyManager.ts`, `src/services/midnight-sync.service.ts`, `src/stores/midnightStore.ts`, `src/api/midnight-api.ts`
- Memory entries: [`project_midnight_dust_two_paths.md`](C:/Users/adame/.claude/projects/d--GeroRepos-gitRepos-gerowallet/memory/project_midnight_dust_two_paths.md), [`project_nexus_is_gero_backend.md`](C:/Users/adame/.claude/projects/d--GeroRepos-gitRepos-gerowallet/memory/project_nexus_is_gero_backend.md)
