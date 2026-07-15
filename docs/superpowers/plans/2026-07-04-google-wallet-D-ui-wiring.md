# Plan D — Onboarding UI + Create/Sign/Recover Wiring (Design + Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development / executing-plans. D2 (Vue UI) is built with visual review + a running app; D1 (wiring) is unit-testable and can be built first.

**Goal:** Make the MPC Google wallet usable end-to-end: a "Google wallet" onboarding path, the create/sign/recover call-sites wired to Plan C's service layer, and the recovery-share backup UX.

**Status:** Design decided (below). Build gated on 3 prerequisites (see "Prerequisites to build + verify").

## Decided UX (from brainstorming 2026-07-04)
- **Recovery-share backup = Option A: encrypted download + mnemonic escape.** User sets a recovery password → recovery share saved as an encrypted file via `encryptRecoveryShare(recoveryShare, recoveryPassword)` → filename `gero-recovery-<walletId>.gmpc`. New device = upload file + recovery password + Google. The 24-word mnemonic remains exportable in Settings as the ultimate server-independent escape.
- **Sign cadence = reconstruct-at-unlock.** Google login (release login share) + reconstruct + validate happen when the wallet is UNLOCKED; the validated root-key bytes are cached in the unlocked background session (cleared on lock), so individual signs don't re-prompt Google. One Google tap per session, not per transaction.
- **Wallet identity:** `userId` = Google `sub` (from the verified id_token payload), `type = WalletType.Google`, `encryptionMethod = 'mpc'`.

## Architecture
Reuse Plan C's service surface (all already built + reviewed):
`prepareMpcWalletCreation()`, `encryptDeviceShare/decryptDeviceShare`, `reconstructRootKeyBytes()`, `createMpcGoogleWallet()`, `api.mpc.enroll/getLoginShare`, `encryptRecoveryShare/decryptRecoveryShare`. D adds only: message handlers (background), a session key cache, and Vue screens. The signing path passes the reconstructed bytes to the existing `WalletBg.signTx(..., privateKeyBytes)` — no `signTx` change.

## Global Constraints (OX sensitive-data + repo rules)
- **Reuse Plan C's safe crypto** — never re-roll share/recovery encryption; import the existing functions.
- **Never log** shares, entropy, mnemonic, idToken, or passwords (values). Mask/omit in every handler.
- **No hardcoded secrets** — OAuth `client_id` from `manifest.oauth2`, backend URL from `VITE_BACKEND_URL`.
- Catch-handler discipline: don't leak raw error/token detail into responses or logs.
- i18n: all user-facing copy via `$t()` (`us.ts` + `de.ts`).
- Vuetify: `attach` on selects; `@click="fn()"` when fn has default params.
- Background changes require `npm run dev:background` rebuild.

---

## Prerequisites to build + verify (needs the user)
1. **Visual review** of the Vue screens (D2) — UI can't be verified by unit tests.
2. **Config**: `MPC_GOOGLE_CLIENT_ID` (the extension's existing `manifest.oauth2` client_id) + `MPC_SHARE_ENCRYPTION_KEY` (backend base64 32-byte secret) set in gero-backend; `VITE_BACKEND_URL` pointing at a running backend.
3. **A running backend** — locally (`mvn spring-boot:run` on the `feat/google-mpc-wallet` branch) or deployed testnet — to exercise real Google OAuth → enroll → getLoginShare → sign.

For build-against-stub (option chosen), D1 unit tests mock `api.mpc`; a local backend is used for the manual e2e pass.

---

## D1 — Background/service wiring (unit-testable; can build first)

### Task 1: Message types + MPC session key cache
**Files:** `src/models/MessageTypes.ts` (add `CREATE_MPC_GOOGLE_WALLET`, `UNLOCK_MPC_WALLET`, `RECOVER_MPC_GOOGLE_WALLET`); new `src/chrome/mpcSessionCache.ts` (in-memory `Map<walletId, Uint8Array>` for validated root-key bytes, cleared on lock/logout); tests for the cache (set/get/clear, cleared-on-lock).
**Interfaces:** `mpcSessionCache.set(id, bytes)`, `.get(id)`, `.clear(id)`, `.clearAll()`. No persistence — memory only.

### Task 2: Create handler `CREATE_MPC_GOOGLE_WALLET`
**Files:** `src/chrome/background.ts` (new handler) + test.
**Flow:** input `{ name, icon, theme, chain, network, idToken, spendingPassword }` →
`prepareMpcWalletCreation()` → `encryptDeviceShare(shareSet.deviceShare, spendingPassword)` → `api.mpc.enroll(idToken, chain, network, shareSet.loginShare)` → `createMpcGoogleWallet({... userId: subFromIdToken, publicKey: expectedXpub, encryptedDeviceShare })` → return `{ walletId, recoveryShare }` to the caller (the UI encrypts + downloads it). `sub` extracted from the verified id_token payload (decode payload only — the backend already verified the signature on enroll). Never log the shares/token/password. On enroll 409, surface "already enrolled" cleanly.
**Test:** mock `api.mpc`, `prepareMpcWalletCreation`, `createMpcGoogleWallet`; assert the enroll body, the persisted record fields, and that `recoveryShare` is returned but never logged/persisted server-side by the client.

### Task 3: Unlock/sign-prep handler `UNLOCK_MPC_WALLET`
**Files:** `background.ts` + test.
**Flow:** input `{ walletId, idToken, spendingPassword }` → load wallet (`mpcDeviceShare`, `publicKey`, chain, network) → `api.mpc.getLoginShare(idToken, chain, network)` → `reconstructRootKeyBytes(mpcDeviceShare, spendingPassword, loginShare, publicKey)` (validates against `publicKey`) → `mpcSessionCache.set(walletId, bytes)`. Signing then reads the cache and passes bytes to `signTx(..., privateKeyBytes)`. On validation failure (`MpcValidationError`) → surface "recovery data mismatch", do not cache.
**Test:** mock api + `reconstructRootKeyBytes`; assert cache populated on success, not populated on validation error.

### Task 4: Wire signing to the session cache
**Files:** the sign path that currently calls `signTx` for wallets (find where `privateKeyBytes`/PRF path is chosen) + test.
**Flow:** if `wallet.encryptionMethod === 'mpc'`, use `mpcSessionCache.get(walletId)` as `privateKeyBytes` for `signTx`; if absent, prompt re-unlock (Google). Verify the byte encoding matches what `signTx`/`Bip32PrivateKey.fromBytes` expects (Plan C review Minor #2 — confirm e2e that `rootKey.bytes()` is the accepted form).

### Task 5: Recover handler `RECOVER_MPC_GOOGLE_WALLET`
**Files:** `background.ts` + test.
**Flow:** input `{ recoveryBlob, recoveryPassword, idToken, chain, network, newSpendingPassword }` → `decryptRecoveryShare(recoveryBlob, recoveryPassword)` → `api.mpc.getLoginShare(idToken, chain, network)` → `reconstructAndValidateEntropy(recoveryShare, loginShare, expectedXpub?)` — note: on a fresh device there is no stored `publicKey` yet, so derive xpub from the reconstructed entropy and use it as the wallet's `publicKey`; then re-split is NOT needed — instead re-`encryptDeviceShare` a NEW device share from the SAME entropy? (Design note: reconstruct entropy → `createMpcShareSet` would change shares; simpler: keep the same entropy, derive a device share by re-splitting is wrong since login share must stay valid. **Decision: on recover, reconstruct entropy, then persist a wallet whose device "share" is the encrypted RECOVERY share** — i.e., the two user-side shares remain {recovery, login}; skip generating a new device share, OR re-enroll a brand-new 3-share set and re-enroll the login share via `/enroll` (requires the backend to allow re-enroll after delete). v1 simplest: store the encrypted recovery share AS the local device factor on the new device. Confirm this with the user — it affects the backend enroll/replace semantics.) Persist via `createMpcGoogleWallet`.
> **OPEN (needs decision at build):** new-device re-enrollment semantics — reuse recovery share as the device factor (no backend change) vs. re-split + backend replace-enroll (needs a delete/replace endpoint). Recommend the former for v1.

---

## D2 — Vue UI (build with visual review)

### Task 6: "Google wallet" method card + step branch
`StepStart.vue` — add a 4th method card ("Google wallet", subtitle "Sign in with Google, no seed phrase"). `WalletOnboarding.vue` — add a `google` method → steps: `network → google-signin → google-secure (spending + recovery password) → google-backup (download recovery file) → google-confirm`. Gate the card on a feature flag (`isGoogleWalletEnabled`, off by default until audited) + testnet-only.

### Task 7: Google create flow screens
- `StepGoogleSignIn.vue` — button → `Messaging.sendToBackgroundFromOptions(SIGN_WITH_GOOGLE)` → shows signed-in email.
- `StepGoogleSecure.vue` — spending password + recovery password inputs (validation, confirm).
- Create trigger → `CREATE_MPC_GOOGLE_WALLET` → receives `{ walletId, recoveryShare }`.
- `StepGoogleBackup.vue` — `encryptRecoveryShare(recoveryShare, recoveryPassword)` → download `gero-recovery-<id>.gmpc`; require an "I saved it" checkbox before finishing. Show mnemonic-in-Settings note.

### Task 8: Unlock-with-Google + recovery screens
- Unlock: when an `mpc` wallet is opened and the session cache is empty → "Sign in with Google to unlock" → `UNLOCK_MPC_WALLET`.
- Restore path: "Restore Google wallet" → Google sign-in + upload `.gmpc` file + recovery password + new spending password → `RECOVER_MPC_GOOGLE_WALLET`.

### Task 9: i18n + feature flag + retire orphaned zkSmartWallet UI
Add all copy to `us.ts` + `de.ts`. Add `isGoogleWalletEnabled` flag (default off, testnet). Remove/replace the orphaned `GoogleLogIn.vue` "Soon" entry if it conflicts.

---

## Verification
- D1: unit tests green (`npx vitest run` on the new specs), `npm run build` green.
- D2 + e2e (with the user, backend running): create a Google wallet on testnet → confirm enroll stored (backend), recovery file downloads → lock → unlock with Google (reconstruct+validate) → sign a testnet tx successfully → simulate new device (fresh profile): restore via recovery file + Google → sign. Confirm no secrets in logs.
- **Audit before mainnet enablement** (flag stays testnet-only until then).

## Self-Review
- Reuses Plan C's reviewed crypto/service surface; adds only wiring + UI + a memory-only session cache.
- Recovery UX decided (Option A). Two OPEN items flagged for build-time decision: new-device re-enrollment semantics (Task 5), and the `signTx` byte-encoding confirmation (Task 4, Plan C Minor #2).
- Security: no secret logging, no hardcoded secrets, reuse safe utils, feature-flagged + testnet-only + audit-gated.
