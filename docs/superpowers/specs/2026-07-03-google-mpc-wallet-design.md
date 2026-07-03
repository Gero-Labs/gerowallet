# Google Wallet (self-hosted MPC) — Design Spec

**Date:** 2026-07-03
**Status:** Approved (direction + defaults, 2026-07-03) — ready for implementation plan
**Author:** brainstorming session (Claude + dudiedri)

> Decision markers used below:
> - **DECISION** — settled in discussion.
> - **ASSUMED** — chosen by default because the user was away; **confirm before implementation**.
> - **OPEN** — needs a product/security answer before the relevant phase.

---

## 1. Goal

Let a user create/restore a wallet with: **pick blockchain + network → pick "Google wallet" → Sign in with Google → done.** No seed phrase to manage day-to-day, wallet is recoverable, and **no single party we operate can sign for the user or lock them out**.

## 2. Why not the alternatives (settled)

- **zkLogin on Cardano L1 / Midnight proof server** — not buildable: Compact/Cardano cannot verify a Google RS256 (RSA-2048) or ES256 (P-256) JWT in-circuit (no RSA modexp, no P-256; only Jubjub + secp256k1). Verified against the Compact compiler source.
- **Passkey PRF + Google passkey sync** — a `chrome-extension://` origin cannot own a synced/discoverable passkey (Chrome 122+ requires an https rpId in `host_permissions`); and it's a biometric UX, not "Sign in with Google."
- **Existing zkFold Google wallet** (already in repo, abandoned) — true on-chain ZK, but depends on zkFold's **hosted** backend + prover (external, not self-hosted), is **Cardano-only** (smart-contract script), and is incomplete/disabled. Fails the self-host and multi-chain requirements.
- **Managed MPC provider (Web3Auth/Privy/Turnkey)** — fastest, but vendor sits in the trust/liveness model. User wants self-host.
- **Enclave key-server** — only *semi*-custodial (whole key sealed in our infra; non-custody rests on a "trust the box" seal).

**DECISION:** Self-hosted MPC via Shamir Secret Sharing (Model A), 2-of-3, server holds exactly one share.

## 3. Custody model (the core invariant)

Master secret = **BIP39 entropy** (gives standard recovery + parity with normal wallets). It is split with **Shamir Secret Sharing into 3 shares, threshold 2**:

| Share | Held by | Role |
|---|---|---|
| **Device share** | extension local storage (encrypted) | day-to-day signing factor on the enrolled device |
| **Login share** | gero-backend, released only after Google JWT verification | the "Sign in with Google" factor |
| **Recovery share** | the user (saved during onboarding) | new-device onboarding + server-outage recovery |

**Invariant (non-custody):** the backend holds **only the login share = 1 of 3**. Backend alone, or backend + Google colluding, still has only 1 share → cannot reach threshold → **cannot sign**. The two user-held shares (device + recovery) alone = 2 → reconstruct **without the server**.

**Escape hatch (mandatory):** the BIP39 mnemonic is exportable in settings and reconstructs the full key with **zero shares and zero server** — the ultimate backstop.

### Failure matrix
| Event | Shares available to user | Access? |
|---|---|---|
| Server gone forever | device + recovery = 2 | ✅ (server never load-bearing) |
| Lost device | recovery + login = 2 | ✅ |
| Lost recovery | device + login = 2 | ✅ |
| Server gone AND lost device | recovery = 1 | ❌ → mnemonic |
| Everything lost | — | ❌ → mnemonic |

## 4. UX flows

### 4.1 Create (enrolled device)
1. Onboarding stepper: select blockchain + network (existing `NetworkSelector`), pick **"Google wallet"** method card.
2. **Sign in with Google** (existing `auth.ts` `launchWebAuthFlow`, `manifest.oauth2`) → `id_token` (JWT).
3. Client generates BIP39 entropy → SSS-split into 3 shares.
4. Client stores **device share** locally (encrypted); sends **login share** to gero-backend (authenticated by the `id_token`, keyed by Google `sub`); presents **recovery share** to the user to save.
5. Client shows mnemonic backup (skippable but nudged).
6. Reconstruct entropy locally → derive keys (existing `resolvePrivateKey` seam) → persist wallet record `type: WalletType.Google`, `userId: email`, normal address/pubkey → log in.

### 4.2 Daily sign (enrolled device) — the "that's it" path
Device share is already local. **Sign in with Google** releases the login share → device + login = 2 → reconstruct entropy in memory → normal `WalletBg.signTx` (vkey witness). One tap.

### 4.3 New device / recovery
No device share present. User signs in with Google (login share) **and provides the recovery share** → 2 → reconstruct → re-derive → re-enroll a fresh device share on the new device. (Or restore from mnemonic directly.)

> **OPEN (product):** "Sign in with Google, that's it" is fully true **on the enrolled device**. A **new device requires the recovery backup + Google**. Making a brand-new device work with *Google alone* would require the server to hold a device-recoverable share → that makes server+Google sufficient to sign → drifts toward custodial. Recommendation: keep the honest non-custodial behavior (new device = recovery event). Confirm.

## 5. Architecture / components

### 5.1 Client (extension)
- **New method card** in `StepStart.vue` + step branch in `WalletOnboarding.vue`.
- **New create-confirm step** mirroring `StepCreateConfirm.vue`'s PRF branch, swapping WebAuthn for: Google OAuth → SSS split → share distribution → reconstruct → `GeroStore.createNewWallet(... type Google ...)`.
- **MPC module** (`src/shared/utils/mpc/` — new): `splitSecret`, `combineShares`, share serialization, recovery-share encoding. Uses an audited Shamir lib (**OPEN:** pick lib, verify current version).
- **Reuse:** `auth.ts` (Google OAuth), `resolvePrivateKey`/`derivePublicKeyFromMnemonic` (derivation), standard `signTx` path, `Api` axios pattern.
- **Rename + retain (DECISION):** do NOT delete the zkFold code — the company relationship is ending but the implementation is useful reference. **Rename all `zkFold`-branded identifiers off the zkFold brand** to a neutral internal name (proposed: `googleWallet` / `mpcWallet`; exact token decided in the plan). Applies to `zkFoldApi.ts`, `src/services/zkFold/*`, `zkfold-db.ts`, `zkFoldStore`, `VITE_ZKFOLD_*` envs, `zkFoldSupport` network flag, and the Google branches in `walletManager.service.ts:191`, `walletBg.ts:142`, `background.ts:1356-1572`. The zkFold hosted-backend/prover call paths are decoupled (no longer invoked) but kept as reference until the MPC path is proven, then pruned.

### 5.2 Backend (gero-backend, separate repo)
New `/api/mpc/*` service:
- `POST /api/mpc/enroll` — body: `id_token`, encrypted login-share. Verify JWT (Google JWKS, `aud` = our client_id, `exp`, `nonce`), extract `sub`, store the login share **envelope-encrypted under Cloud KMS**, keyed by `sub`. One share per wallet/sub.
- `POST /api/mpc/login-share` — body: `id_token`. Verify JWT, return the login share for `sub`. **Rate-limited**, bound to `sub` + `aud`, audit-logged.
- **Never** stores device or recovery shares. Holds exactly one share.
- **OPEN:** multiple wallets per Google account? (v1 **ASSUMED:** one Google wallet per `sub` per network.)

### 5.3 Key protection (backend)
- **Cloud KMS envelope encryption** for the stored login shares (one master wrapping key, not per-user). No dedicated HSM in v1.
- Rate-limit + anomaly-log share release. Bind release to verified `sub`/`aud`; reject replayed/expired tokens (`nonce`, `exp`, `iat` skew).

## 6. Data model

- Reuse `WalletType.Google` (`src/models/types.ts:10`) and `userId` (email/sub) on the wallet record.
- Add fields (names tentative): `mpcDeviceShare` (encrypted), `mpcEnrolled: boolean`, `mpcVersion: number`. **OPEN:** exact schema + Dexie version bump.
- **DECISION:** Google MPC wallets get a **normal** Cardano address (derived locally), **not** a script address. Standard staking/signing apply (unlike the old zkFold enterprise-address special-casing).

## 7. Scope

- **v1 (ASSUMED):** Cardano (mainnet + testnet), enrolled-device one-tap + recovery-share flow + mnemonic escape. Behind a feature flag, **testnet-first**.
- **Chain-agnostic by construction** (splits entropy, reconstructs a seed) — other Gero chains (Bitcoin, Apex) are cheap follow-ups but **out of v1**.
- **Later:** device share protected by existing PRF passkey; FROST/TSS upgrade if "key never whole even momentarily" becomes required; more chains.

## 8. Security requirements (non-negotiable)

1. **Third-party security audit before any mainnet enablement.** Custody bugs = irreversible fund loss. Ship testnet-only until audited.
2. **Backend holds ≤ 1 share, ever.** Enforced + tested.
3. **Mnemonic export always available** as server-independent recovery.
4. **JWT verification hardened**: Google JWKS signature, `aud`, `exp`/`iat` skew, `nonce` binding, replay protection.
5. **Reconstructed entropy lives only transiently in memory** during sign; zeroize after use where the platform allows.
6. **Feature-flagged rollout** (`isGoogleWalletEnabled` / rework `zkFoldSupport`), off by default.
7. **No secrets logged** (`debugLog` discipline; never log shares, entropy, tokens).

## 9. Testing

- Unit: SSS split/combine round-trips; any-2-of-3 reconstructs; any-1 reveals nothing; entropy → address determinism.
- Integration: create → sign → new-device recovery → server-outage recovery (device+recovery) → mnemonic restore.
- Backend: JWT verify (valid/expired/wrong-aud/replayed/tampered), rate-limit, KMS envelope round-trip, "backend never returns >1 share" invariant.
- Negative: server-down still signs on enrolled device; server + Google alone cannot sign (property test).

## 10. Rollout / ops

- Implement in a **git worktree** (repo has background agents committing to the current branch — isolate this multi-commit work). Dedicated feature branch.
- Infra: `/api/mpc/*` on existing GKE + Cloud KMS envelope key. Est. ~$50–300/mo. Real cost is build + audit + ~0.3–0.5 FTE ongoing.

## 11. Resolved decisions (2026-07-03)
1. **Direction = Model A** (self-hosted MPC, Shamir 2-of-3). ✅
2. **New-device UX = "recovery backup + Google"** (honest non-custodial). Google-alone-on-fresh-device rejected (drifts custodial). ✅ (§4.3)
3. **zkFold code = rename + retain as reference**, decouple from zkFold brand; do not delete. ✅ (§5.1)
4. **Shamir library** — pick an audited lib during writing-plans; verify current version at that time (no stale-version assumptions). ⏳ plan.
5. **One Google wallet per `sub` per network** in v1. ✅ (§5.2)
6. **Wallet-record schema** — proposed fields (`mpcDeviceShare`, `mpcEnrolled`, `mpcVersion`) + Dexie version bump, finalized in the plan. ⏳ plan.
7. **v1 = Cardano-only** (mainnet + testnet), chain-agnostic by construction. ✅ (§7)
8. **Recovery-share format = downloadable encrypted backup** (encrypted under a user-chosen recovery password, user-held only — never on our backend). Mnemonic export remains the ultimate manual escape. May consolidate the two in the plan (YAGNI review). ✅ (§3)

> Detail items (4, 6) are intentionally deferred to the implementation plan; everything blocking the plan's shape is resolved.
