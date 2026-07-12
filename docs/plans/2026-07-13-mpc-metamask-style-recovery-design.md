# MPC "Sign in with Google" — MetaMask-style Recovery (self-hosted)

**Status:** Design approved (brainstorming). Next: implementation plan (writing-plans).
**Date:** 2026-07-13
**Worktrees:** extension `gerowallet-google-mpc` (branch `feat/google-mpc-wallet`), backend `gero-backend-google-mpc`.
**Supersedes:** the earlier "rotate recovery file" design — the downloadable `.gmpc` file is replaced by a password-protected recovery share stored on the backend. The crash-safe staged re-split from that design is retained as the *reset/rotate* path (see §3, §4).

---

## Goal

Give the Google MPC wallet MetaMask-style recovery: **recover on any new device with only the Google account + a memorized recovery password — no file to keep** — plus a **revealable seed phrase (SRP)** as an escape hatch. Stay **self-hosted and non-custodial**.

## Background & problem

The wallet is a self-hosted Shamir **2-of-3** split of the BIP39 entropy:
- **device share** — local, encrypted under passkey-PRF or a device password (extension IndexedDB `mpcDeviceShare`).
- **login share** — `gero-backend`, released after Google idToken verification.
- **recovery share** — today a user-held, downloaded, password-encrypted `.gmpc` file.

Two problems with the file model (confirmed by a 2026-07-12 code audit):
1. **Lost/forgotten file → unrecoverable** once the device share is also gone (reinstall / new machine / cleared browser data). One surviving share (login) is below threshold.
2. **No seed-phrase escape hatch** — MPC wallets never expose a mnemonic, so there is no portability/last-resort path (the "mnemonic = ultimate escape" intent was never implemented).

MetaMask "Social Login" (= MetaMask Embedded Wallets, formerly Web3Auth) solves both by making the third factor a **memorized password** (nothing to lose) and by generating a **revealable SRP**.

## Decisions (decision log)

- **D1 — Match MetaMask's UX.** Password becomes the recovery factor; drop the downloadable file; add a revealable SRP.
- **D2 — Stay self-hosted; do NOT adopt Web3Auth/Torus nodes.** Web3Auth's node network would remove the custody caveat (D3) via share distribution and is exactly MetaMask's stack, but it is a **paid SaaS** (per-MAW pricing) and puts a **third-party vendor in the trust + availability path** — which this project explicitly rejected at kickoff ("Managed MPC (vendor in trust model)"). Self-sovereignty and zero per-user cost win.
- **D3 — Accepted custody premise (unavoidable consequence of D1 + D2).** Fileless cross-device recovery on a *single* backend is only possible if the backend serves the second share. So the recovery share moves to the backend as a **password-encrypted blob**, and the backend then holds **2 of 3 shares** (login + encrypted-recovery). A backend breach **plus** a crack of a weak recovery password = reconstruct. This reverses the earlier "no two reconstructable shares server-side" rule. Mitigated (not erased) by: Argon2id, a **second server-side at-rest wrap** (KMS key), enforced recovery-password strength, separate storage/access paths, and rate-limiting. The **device share never touches the backend**, so a breach *without the password* still cannot reconstruct — the recovery password is the load-bearing secret. This mirrors MetaMask's own "lose the password → unrecoverable" cliff.
- **D4 — Avoid hand-rolled GF(256) crypto.** Recomputing the original recovery share from entropy + one share is mathematically possible (2-of-3 ⇒ degree-1 line) but needs custom field arithmetic matching the `shamir-secret-sharing` library — rejected as risk. Consequence: "change recovery password" cannot cheaply re-wrap the old share, so it does a **full re-split** (§3).
- **D5 — Change recovery password never asks the old one (MetaMask parity).** MetaMask lets a logged-in user set a new password without the old one. Given D4, we honor this by making "change" a **re-split** from the unlocked session (device+login → entropy → fresh split → store under the new password). One consequence, treated as a feature: a password change **rotates all three shares**, so it also voids a previously-leaked recovery blob — there is no separate compromise-rotation action.

## Non-goals (v1)

- Web3Auth/Torus or any multi-party node network (revisit only if custody premise D3 becomes unacceptable).
- Multi-chain MPC (entropy is chain-agnostic; deferred as before).
- Optimistic-locking against concurrent same-account rotation (documented limitation).
- Keeping the downloadable `.gmpc` file (removed; the staged re-split logic is repurposed, not the file).

---

## §1 — Recovery model

Same Shamir **2-of-3**; only the third factor changes.

| Share | Before (file) | Now (MetaMask-style) |
|---|---|---|
| **Device** | local, passkey-PRF / password | unchanged — daily unlock = device + login, no recovery password |
| **Login** | backend, Google-gated | unchanged |
| **Recovery** | downloaded `.gmpc` file | **backend blob, encrypted `Argon2id(recoveryPassword)`, then AES-GCM at rest** — no file |

- **Onboarding:** user sets a **recovery password** (already captured in `StepGoogleSecure`). Client wraps the recovery share with `encryptRecoveryShare()` (Argon2id + XChaCha20) and **uploads the ciphertext** (+ the non-secret xpub anchor). No file download.
- **Recover on a new device:** Google sign-in → backend returns login share + encrypted recovery blob + xpub anchor → user types recovery password → decrypt → login + recovery = 2 → reconstruct → establish local device share. Fileless.
- **Reveal SRP (new escape hatch):** an unlocked wallet reveals its seed (`entropy → entropyToMnemonic`) behind a device-secret re-auth, shown once → exportable to any BIP39 wallet.
- **Set / change recovery password (MetaMask parity):** one action, from an **unlocked wallet** (existing device — device+login reconstruct entropy). It **never asks for the old password** (we can't retrieve the old share without it, D4); instead it performs a crash-safe **re-split** (§3) and stores the fresh recovery blob under the new password. Because the underlying share changes, a password change also **voids any previously-leaked recovery blob** — i.e. it doubles as compromise-rotation; there is no separate "rotate" action. A user on a *new* device who has *also* forgotten the recovery password has only the login share (1 of 3) → genuinely unrecoverable, identical to MetaMask's "lose the password → unrecoverable" cliff.

**Recovery-password strength (concrete floor):** minimum **12 characters** + a visible strength meter; the weakest tier is rejected before any store. This is the load-bearing secret (D3), so the floor is enforced client-side on set and change.

**Device-secret re-auth in the side panel:** WebAuthn cannot run in a Chrome side panel, so reveal-SRP / change / reset re-auth reuses the existing popup-delegation pattern (`index.html?mode=mpcPrf#/passkey-auth`, origin-restricted `postMessage`) for passkey wallets; password wallets prompt inline.

---

## §2 — Backend recovery-share store (`gero-backend-google-mpc`)

Mirror the login-share stack; **separate table** (separate access path is part of the D3 mitigation). Backend uses Hibernate `ddl-auto: update` → the entity auto-creates its table; **no migration file** (same as `mpc_login_shares`).

**Entity `MpcRecoveryShareEntity`** → table `mpc_recovery_shares`, composite key `(subject, chain, network)`, columns `encryptedShare: text`, `publicKey: text` (non-secret xpub anchor), `createdAt`. Same `Persistable` shape as login, but **replace-allowed** (no insert-only 409 guard — set and change-password both store a new blob).

**Double-wrapped at rest** (key custody hardener):
```
stored = LoginShareCipher.encrypt(              // server AES-GCM, KMS at-rest key
           client Argon2id(recoveryPassword) → XChaCha20 blob   // already encrypted client-side
         )
```
Breach now needs **DB + server at-rest key + a crack of the recovery password**.

**`MpcRecoveryShareService`** (new, single-responsibility):
- `store(idToken, chain, network, encRecovery, publicKey)` — verify idToken → `sub` → upsert (find→set→save, else insert) → server-encrypt at rest.
- `fetch(idToken, chain, network)` — verify idToken → server-decrypt → return `{ encryptedRecovery, publicKey }`. 404 if none.

**Controller** under `/api/mpc`:
- `POST /recovery/store` `{idToken, chain, network, encryptedRecovery, publicKey}` → `200 {stored:true}` / 401 / 503.
- `POST /recovery/fetch` `{idToken, chain, network}` → `200 {encryptedRecovery, publicKey}` / 401 / 404 / 503.
- `POST /rotate` `{idToken, chain, network, loginShare}` → `200 {rotated:true}` / 401 / `404 not enrolled` / 503 (used by the reset/re-split path; replaces the login share via `MpcLoginShareService.rotate`, leaving `enroll`'s insert-only 409 intact — detailed in §3).

**Notes:**
- `MpcRateLimitFilter` must match `/recovery/*` (bounds *online* fetch attempts; offline cracking is bounded by Argon2id params + enforced password strength).
- **Upsert = overwrite risk:** a valid Google idToken can overwrite the blob. That is a Google-account compromise (already game-over) and only **DoS**s recovery (overwrites 1 of 3, not the key). Client re-uploads only after reconstruct+validate. Accepted, documented.
- Login-share endpoints (`enroll` / `login-share`) untouched — `enroll` keeps its insert-only 409.

---

## §3 — Client (`gerowallet-google-mpc`)

**A. `api.ts` (`mpc` block):**
- `storeRecovery(idToken, chain, network, encryptedRecovery, publicKey) → { stored }`
- `fetchRecovery(idToken, chain, network) → { encryptedRecovery, publicKey }`

**B. Background flows** (`mpcWalletHandlers.ts` + `background.ts` wiring):
- **Onboarding store:** after `createMpcGoogleWalletFlow` yields the recovery share → `encryptRecoveryShare(share, recoveryPassword)` → `storeRecovery(+xpub)`. **Non-fatal** on failure → wallet works (device+login); surface "recovery not set → finish in Settings."
- **Recover (new device)** — rework `recoverMpcGoogleWalletFlow`: `fetchRecovery` → `decryptRecoveryShare(blob, password)` → `getLoginShare` → `reconstructAndValidateEntropy(recovery, login, xpubFromBackend)` → recreate wallet + establish local device share. Replaces the file-picker path. `404` → "no recovery on file."
- **`REVEAL_MPC_SRP`** (new): unlocked session **+ device-secret re-auth** → reconstruct entropy → `entropyToMnemonic` → return once. Never persisted, never logged.
- **`SET_RECOVERY_PASSWORD`** (change / reset, from an unlocked wallet; **never asks the old password**, MetaMask parity): full **crash-safe re-split** — staged `mpcDeviceShareNext` + backend `rotate` (see §4) — then stores the fresh recovery blob under the new password. Single handler covers both "change" and "forgot but still logged in"; also serves compromise-rotation.

**C. Onboarding UI:**
- `StepGoogleSecure` — keep capturing the recovery password; add a **strength meter + minimum** (now the load-bearing secret).
- `StepGoogleBackup` — replace "download file" with "Recovery = your Google account + this password. Nothing to download." + the upload (with retry).
- `StepGoogleRestore` — replace the file-picker with a **recovery-password field**.

**D. Settings (`SecurityTab`, MPC rows):**
- **"Change recovery password"** (one dialog: enter a new password + confirm; **no old-password field** — runs `SET_RECOVERY_PASSWORD` re-split; covers both change and forgot-while-logged-in).
- **"Reveal secret recovery phrase"** — behind device-secret re-auth, shown once, with an "anyone with this controls your wallet" warning.
- Optional red-dot nudge if onboarding upload failed (recovery not set).

**E. Reuse:** `encryptRecoveryShare` / `decryptRecoveryShare`, `createMpcShareSet`, `reconstructAndValidateEntropy`, `entropyToMnemonic`, and the staged re-split (reset path).

**Backend rotate endpoint (needed by the reset path):** `POST /api/mpc/rotate` `{idToken, chain, network, loginShare}` — `MpcLoginShareService.rotate(...)` loads the row (`isNew=false` after `@PostLoad`) → `setEncryptedShare(cipher.encrypt(newLoginShare))` → `save()` (UPDATE). `200 {rotated:true}` / 401 / `404 not enrolled` / 503. Leaves `enroll`'s insert-only guard untouched. `MpcRateLimitFilter` must match `/rotate` too.

**Accepted caveats (documented):**
- Fileless recovery trusts the backend for the xpub anchor (no user-held factor exists on a fresh device). A malicious backend could serve a matching phantom triple → the recovered *address* would differ; mitigated by address-recognition and by this being the same trust boundary as the login-share fetch. True fix = share distribution (out of scope, D2).
- "Forgot recovery password" is a full re-split, not a cheap re-wrap (D4).

---

## §4 — Atomicity, failure handling, security invariants

**Per-flow atomicity:**

| Flow | Failure behavior |
|---|---|
| Onboarding store | Wallet (device+login) is the atomic core (exists). Recovery store is a **non-fatal** follow-up → "recovery not set → Settings." No brick; recovery blob is independent of daily unlock. |
| Recover (new device) | Read-only fetches + client reconstruct. Any failure (wrong pw → decrypt fail, 404, xpub-mismatch → reject) writes **no state**; retry. Local wallet + device share written only after reconstruct+validate. |
| Set / change recovery password (re-split) | Crash-safe staged re-split, order: **1** stage `deviceShareNext` (old kept) → **2** backend `rotate` login → **3** promote device → **4** store recovery' blob (new pw) → **5** clear `mpcLoginShareCache`. Recovery store is **last** (only written once S' is live). **Resume-on-unlock:** device+login mismatch → try `deviceShareNext`+login → promote. Backend-rotate fail → drop `next`, stay on old split. Never bricks. Never asks the old password. |

**Crash-safety field:** new nullable wallet field `mpcDeviceShareNext`. On every MPC unlock: device+login reconstructs → drop any stale `next`; device+login fails but `next`+login succeeds → promote `next`, continue unlocked.

**Security-invariant checklist** (all flows):
- Never log / persist / return: entropy, root key, any plaintext share, recovery password, SRP, idToken, prfOutput. (SRP returned to UI **once** for reveal — shown, not stored/logged.)
- Backend never sees a plaintext share or the recovery password. Login share = opaque encoded share, AES-GCM at rest. Recovery = client-`Argon2id` blob **then** AES-GCM at rest.
- Device share never leaves the device; `device` and `deviceShareNext` are both device-role (same x-index) → cannot combine → no at-rest reconstruction.
- Reveal-SRP, change, and reset require **device-secret re-auth** even in an unlocked session.
- `reconstructAndValidateEntropy` xpub check on every reconstruct; create asserts unchanged xpub.
- Recovery password is load-bearing → **enforce strength** client-side + high Argon2id params.
- Clear stale `mpcLoginShareCache` after any rotation.
- Rate-limit `/recovery/*` and `/rotate`.
- Recovery upsert overwrite = DoS-only (1 of 3), documented.

**Error UX:** wrong recovery password → "Incorrect recovery password"; 404 → "No recovery set for this account"; 503 → "Recovery temporarily unavailable"; store network fail → retryable, wallet unaffected; reveal re-auth cancel → abort, nothing shown.

---

## §5 — Testing

**Backend (JUnit, mirror `MpcLoginShareServiceTest` / `MpcControllerTest` / `MpcEndpointIntegrationTest`):**
- `MpcRecoveryShareServiceTest`: store inserts; store **replaces** (upsert); fetch returns blob+xpub; fetch → 404 when none; bad idToken → 401; not configured → 503; **double at-rest wrap round-trips** (client-blob in == out).
- Controller: `/recovery/store` + `/recovery/fetch` status mappings (200/401/404/503).
- Integration: store→fetch round-trip on test DB; `MpcRateLimitFilter` covers `/recovery/*` and `/rotate`.
- `rotate`: replaces login share; 404 when not enrolled; `enroll` still 409 on duplicate.

**Client unit (vitest, extend existing MPC specs):**
- `mpc.api.spec`: `storeRecovery` / `fetchRecovery` post exact bodies, parse responses.
- `mpcWalletHandlers.spec`: onboarding store (encrypts + `storeRecovery(+xpub)`; non-fatal on failure); recover-new-device (fetch→decrypt→login→validate→recreate; wrong pw → no state; 404; xpub-mismatch → reject); `REVEAL_MPC_SRP` (entropy→mnemonic; requires re-auth; never persists); `SET_RECOVERY_PASSWORD` (never asks old pw; re-split → all three shares new; old recovery blob dead; crash-resume promotes; recovery stored last; backend-rotate fail → rollback to old split).
- Recovery-password **strength validator** unit; `recoveryShare.spec` already covers encrypt/decrypt + wrong-pw reject.

**Property / adversarial (security):**
- Any 2 of {device, login, recovery} → same entropy → same xpub (extend `mpcShares.spec` for the fresh split S').
- Wrong recovery password never yields a passing share (decrypt throws; xpub-validate catches).
- No-leak assertions: bg responses omit entropy/share/password/SRP; nothing logged.
- `deviceShareNext` + `device` (same x-index) cannot combine.
- Weak recovery password rejected before store.

**E2E / manual (live Google OAuth = human gate, as today):**
- Onboard (set pw, no file) → new profile → recover via Google + pw → **address matches**.
- Change pw → new works, old fails.
- **Reveal SRP → import into a standard BIP39 wallet → same address** (proves the escape hatch).
- Reset (forgot pw) → old blob dead, new works, device+login unaffected.
- Crash-injection on reset (kill SW between rotate and promote) → resume-on-unlock recovers.

**Regression:** existing MPC vitest + backend MPC tests stay green; file-model specs (`StepGoogleBackup` download, file restore) migrated/removed — noted in the plan.

---

## File map (for the implementation plan)

**Backend (`gero-backend-google-mpc`):**
- Create: `repositories/mpc/entity/MpcRecoveryShareEntity.java`, `repositories/mpc/MpcRecoveryShareRepository.java`, `service/mpc/MpcRecoveryShareService.java`, `controller/mpc/model/RecoveryStoreRequest.java` + `RecoveryFetchRequest.java` + `RecoveryFetchResponse.java`.
- Modify: `controller/mpc/MpcController.java` (add `/recovery/store`, `/recovery/fetch`, `/rotate`), `service/mpc/MpcLoginShareService.java` (add `rotate`), `security/filter/MpcRateLimitFilter.java` (match new paths).
- Tests: `MpcRecoveryShareServiceTest`, controller + integration additions.

**Extension (`gerowallet-google-mpc`):**
- Modify: `src/api/api.ts` (`storeRecovery`/`fetchRecovery`), `src/chrome/mpcWalletHandlers.ts` (onboarding-store, recover rework, reveal-SRP, change-password, reset), `src/chrome/background.ts` (wire new message handlers + resume-on-unlock), `src/models/types.ts` (`mpcDeviceShareNext`), `src/db/gero-db.ts` (persist `mpcDeviceShareNext`), onboarding steps `StepGoogleSecure.vue` / `StepGoogleBackup.vue` / `StepGoogleRestore.vue`, `src/modules/dashboard/components/SecurityTab.vue` (+ change-password and reveal-SRP dialogs), i18n `us.ts` + `de.ts`.
- Reuse: `src/shared/utils/mpc/*` (`recoveryShare`, `mpcShares`, `mpcKeys`, `mpcWalletService`).
- Tests: extend `mpc.api.spec`, `mpcWalletHandlers.spec`, `mpcShares.spec`, add strength-validator spec.

## Global constraints

- Never commit `src/stores/featureFlagsStore.ts` (local `isGoogleWalletEnabled` flip; ships dark).
- Never log idToken / prfOutput / shares / recovery password / SRP.
- Non-custodial invariant holds up to D3: device share never on backend; backend holds ≤ {login, encrypted-recovery}; the recovery password is the load-bearing secret.
- Testnet-first, feature-flagged; third-party security audit before any mainnet enablement (D3 explicitly in scope for that audit).
- i18n: every new `us.ts` key gets a `de.ts` counterpart; reuse existing keys where present.
