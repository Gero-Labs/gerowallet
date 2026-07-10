# Google MPC wallet — passkey unlock + Argon2id recovery

**Date:** 2026-07-09
**Status:** Design approved, pending spec review
**Branch:** `feat/google-mpc-wallet`
**Related:** `docs/superpowers/specs/2026-07-03-google-mpc-wallet-design.md` (base MPC design)

## Problem

The MPC "Sign in with Google" wallet currently asks the user for **two typed passwords** at
creation (see `StepGoogleSecure`-style step):

1. **Spending password** — encrypts the on-device Shamir share at rest
   (`mpcWalletHandlers.ts` `encryptDeviceShare(deviceShare, spendingPassword)`). Second factor
   on unlock: Google releases the login share, the password decrypts the device share, the two
   reconstruct.
2. **Recovery password** — encrypts the downloadable recovery file
   (`recoveryShare.ts`, PBKDF2-210k + XChaCha20-Poly1305).

Two typed passwords fights the product's "sign in with Google, seedless" promise. We want the
smallest possible secret surface **while staying strictly non-custodial** (the backend must never
hold enough to reconstruct the key).

## Constraints & non-negotiables

- **Stay non-custodial.** Backend keeps exactly 1 of 3 shares. Device-independent restore therefore
  requires one portable user-held secret — the recovery passphrase. This is irreducible and stays.
- **Testnet-only, flag-dark, unreleased.** No production MPC wallets exist → **no migration burden**.
- **WebAuthn only runs in a DOM context.** `navigator.credentials` is unavailable in the background
  service worker where the MPC handlers live (`src/chrome/mpcWalletHandlers.ts`). The passkey prompt
  must happen in the frontend (options/sidepanel), and the raw `prfOutput` bytes are passed to the
  background — exactly the split existing PRF wallets already use
  (`decryptMnemonicWithPrfOutput` in `src/shared/utils/webauthn-prf.ts`).
- **The reconstruct-and-validate guard is unchanged.** `reconstructAndValidateEntropy`
  (`mpcKeys.ts:34`) still runs on every unlock/recover; its real cross-share negative tests
  (committed `df84baa2`) stay.

## Auth model (after)

| Action | Before | After |
|---|---|---|
| Daily unlock | Google + spending password | **Google + passkey (WebAuthn PRF)**; fallback: Google + spending password |
| Backup file | recovery password (PBKDF2-210k) | **recovery passphrase (Argon2id)** |
| Recover on new device | passphrase + Google | same, then **re-enroll a fresh passkey** on that device |

Backend still holds only 1 of 3 → non-custodial invariant preserved.

## Decisions (from brainstorming)

- **No-passkey device (Chrome, no Touch ID / Windows Hello / security key):** passkey primary;
  fall back to a spending password. Both paths coexist. Matches existing PRF-wallet behavior.
- **Recovery secret:** keep the user-chosen passphrase; upgrade KDF PBKDF2 → Argon2id (memory-hard).

## Component design

### 1. Device-share encryption envelope (versioned, tagged)

`encryptedDeviceShare` (stored in the wallet record) becomes a self-describing envelope so the
unlock branch knows which path to use and both can coexist:

- `prf.v1:<hex>` — AES-GCM ciphertext under a key derived from the passkey PRF output.
- `pw.v1:<blob>` — existing password AEAD (the fallback path, unchanged crypto).

The wallet record additionally stores `webAuthnCredentialId` (base64) when the `prf` path is used,
mirroring how PRF wallets persist their credential.

New helpers in `webauthn-prf.ts` (or a small `mpc/deviceShareCipher.ts` that calls the existing
PRF derivation), with domain separation distinct from the mnemonic/private-key helpers:

- `encryptDeviceShareWithPrfOutput(share, prfOutput, credentialId, walletId): Promise<string>`
  → returns `prf.v1:<hex>`. HKDF `info: gero-mpc-deviceshare-encryption-v1:{walletId}`, AAD =
  credentialId (same pattern as `encryptPrivateKeyWithPrf`).
- `decryptDeviceShareWithPrfOutput(envelope, prfOutput, credentialId, walletId): Promise<string>`.

The password path keeps the current `encryptDeviceShare`/`decryptDeviceShare` under the `pw.v1`
tag. A tiny router (`decodeDeviceShareEnvelope`) dispatches on the tag.

### 2. Flows (frontend ↔ background split)

**Create (Secure step):**
1. Frontend: if `isPrfSupported()` and a platform authenticator is available →
   `registerWebAuthnCredentialWithPrf(walletId, walletName)` → `{credentialId, prfOutput}`.
   Else → collect a spending password.
2. Frontend → background create handler with either
   `{ method: 'passkey', credentialId, prfOutput }` or `{ method: 'password', spendingPassword }`.
3. Background: `prepareMpcWalletCreation` generates entropy/shares (unchanged); encrypts the device
   share via the chosen path; persists the envelope + (for passkey) `webAuthnCredentialId`.

**Unlock:**
1. Frontend: Google sign-in (unchanged) → for passkey wallets
   `evaluatePrfForWallet(credentialId, walletId)` → `prfOutput`; for password wallets prompt password.
2. Frontend → background unlock handler with the login share inputs + `{prfOutput}` or `{password}`.
3. Background: decrypt device share → `reconstructAndValidateEntropy` (unchanged) → cache root key
   bytes in `mpcSessionCache`.

**Recover (fresh device — no local passkey yet):**
1. Frontend: Google sign-in + recovery passphrase + recovery file. If passkey-capable, register a
   NEW passkey → `{credentialId, prfOutput}`.
2. Background: decrypt recovery file (Argon2id), reconstruct from recovery+login shares, validate
   xpub against the envelope's publicKey (unchanged), then **re-encrypt** the device share under the
   new `prfOutput` and persist the new `credentialId`. (Password fallback: re-encrypt under a newly
   chosen spending password.)

The handler dependency signatures change from `spendingPassword: string` to a discriminated
`unlockSecret` / `creationSecret` union so the background stays agnostic to which factor was used.

### 3. Recovery KDF → Argon2id

`recoveryShare.ts`:
- Bump blob `VERSION` handling: `encryptRecoveryShare` always writes **v2** using
  `argon2id` from `@noble/hashes/argon2` with tuned params (documented in the file, e.g.
  `t=3, m=64 MiB, p=1, dkLen=32` — final params validated against decrypt latency in the extension).
- `decryptRecoveryShare` dispatches on the version byte: v2 → Argon2id, v1 → existing PBKDF2-210k
  (kept read-only for any pre-existing dev blob). Same XChaCha20-Poly1305 AEAD, salt, nonce layout.
- Argon2 params are stored in the blob header (already carries version + a params field; extend the
  header to carry Argon2 `t`/`m`/`p` so future tuning stays decryptable).

### 4. UI / i18n

- Secure step: passkey-first. Primary action "Secure with passkey" (Touch ID/Hello). Spending-password
  fields render only when PRF is unavailable or the user picks the fallback.
- Unlock dialog / side-panel LockScreen: passkey branch prompts the authenticator; password branch
  unchanged. (The MPC unlock branch already exists — `c4eff00f`.)
- Restore step: adds the passkey re-enrollment prompt after a successful reconstruct.
- New/updated `us.ts` + `de.ts` strings (kept in sync). Reuse existing PRF/passkey copy where present.

### 5. Secret hygiene

- `prfOutput` is transient: obtained in the frontend, passed once to the background, never persisted,
  never logged (existing "never log idToken/spendingPassword/shares" rule extends to `prfOutput`).
- PRF-derived AES keys are non-extractable (`crypto.subtle` with `extractable=false`), as in the
  existing helpers.
- Recovery passphrase never leaves the frontend except as derived key material inside the blob.

## Testing

`navigator.credentials` cannot be exercised headless, so tests target the deterministic layer:

- **Device-share envelope codec:** `prf.v1` / `pw.v1` tag routing; malformed tag rejected.
- **PRF path round-trip with injected output:** feed a fixed 32-byte `prfOutput` into
  `encryptDeviceShareWithPrfOutput` → `decryptDeviceShareWithPrfOutput` → original share; wrong
  output / wrong credentialId (AAD) → reject.
- **Argon2id recovery:** encrypt→decrypt round-trip; wrong passphrase → `RecoveryDecryptError`;
  v1 (PBKDF2) blob still decrypts (back-compat); v2 header carries Argon2 params.
- **Existing MPC suites unchanged**, including the real cross-share invariant tests.
- Manual/e2e: passkey create → lock → unlock (Touch ID), and fallback password path, on a real
  device (the human-gated leg).

## Non-goals

- No backend changes; no change to the 2-of-3 topology or Google OAuth.
- Not removing the recovery secret (removing it would make the wallet custodial).
- Not implementing Google-only restore (incompatible with non-custodial — see base design).
- Safari (no PRF) transparently uses the password fallback; no Safari-specific work.

## Audit notes (carried forward)

- Cross-share binding enforced + real negative tests (`df84baa2`).
- Reconstructed key memory-only, cleared on lock/logout/switch (`mpcSessionCache`).
- Passkey loss ≠ fund loss: recovery path never depends on the passkey.
- Recover anchor xpub is self-declared from the recovery envelope (inherent to fresh-device
  recovery; wrong Google account still rejected by the xpub check).
- Pre-mainnet: third-party audit; swap backend AES-GCM `LoginShareCipher` → Cloud KMS.

---

## Addendum (2026-07-10): recovery robustness & server-independence

The 2-of-3 scheme is: **device** (local, encrypted) + **login** (backend, Google-gated)
+ **recovery** (user's encrypted `.gmpc` file). "No seed phrase" is the product
promise — the recovery file is the seedless backup. This addendum records how each
loss maps to recoverability and closes the "server loss = lockout" gap.

### Reconstruct paths (any 2 of 3 rebuild the key)

- **Online unlock** — device + login (backend). `reconstructRootKeyBytes(deviceShare, secret, loginShare, xpub)`.
- **Restore (fresh device)** — recovery + login (backend). `reconstructAndValidateEntropy(recoveryShare, loginShare, xpub)`.
- **Offline unlock (NEW, this addendum)** — **device + recovery**, NO backend, NO Google.
  `reconstructAndValidateEntropy` is share-agnostic, so the same helper takes the
  recovery share as the second share. Wired as `UNLOCK_MPC_WALLET_OFFLINE`
  (`background.ts`) + a fallback in `UnlockWalletDialog` ("Server unavailable? Unlock
  with your recovery file"). Uses the device secret (passkey PRF or spending password)
  to decrypt the local device share + the recovery passphrase to decrypt the file.

### Loss matrix

| Scenario | Shares available | Recoverable? |
|---|---|---|
| Backend restart | all persist (Postgres) | ✅ no effect |
| Backend replaced, same DB | all persist | ✅ no effect |
| **Backend DB wiped** (login share lost) | device + recovery | ✅ **offline unlock** (this addendum) on a device that has the device share |
| Lost passkey (new PC) | recovery + login | ✅ restore + enroll new passkey |
| Lost recovery file, still on device | device + login | ✅ normal unlock |
| **Fresh device, no recovery file, backend up** | login only (1 of 3) | ❌ not enough — by design (Google alone ≠ key) |
| **Fresh device + backend gone** | none reachable | ❌ unrecoverable |

### Inherent limits (non-custodial, by the user's choice)

- **Google alone can never restore** — it gates only 1 share. This is the
  non-custodial guarantee (the backend can't sign or lock you out); the cost is that
  the recovery file is mandatory for cross-device recovery.
- **Server-independence only holds on a device that has the device share** (device +
  recovery). A *fresh* device inherently needs either the backend (login share) or the
  device share; there is no 2nd share otherwise. The 24-word seed (Settings → Security,
  derivable once unlocked) remains the ultimate cross-everything escape, but exposing it
  is opt-in so the seedless UX is preserved.

### Open items

- Surface the offline path more prominently (e.g. auto-offer it when `getLoginShare`
  times out), and consider a "download an encrypted key backup" that bundles device +
  recovery for the truly paranoid.
- Multi-chain (deferred — "c"): the reconstructed BIP39 entropy is chain-agnostic; extend
  by un-gating the network + per-chain derivation from the reconstructed mnemonic. Backend
  enroll is already per chain/network.
