# MPC Configurable Lock Methods — Design

**Date:** 2026-07-11
**Status:** Approved (brainstorming) → ready for implementation plan
**Scope:** Extension only (`gerowallet-google-mpc` worktree, branch `feat/google-mpc-wallet`). No backend changes.

## Goal

Give MPC "Sign in with Google" wallets a **configurable session lock method**, like Normal/PRF wallets already have — instead of the current behavior where every re-unlock forces the creation device secret (passkey/password). Specifically:

- The user can choose the lock method: **None**, **Passkey**, or **Spending Password**.
- **None ⇒ the wallet does not auto-lock and never prompts to unlock within a session.**
- Passkey/Password ⇒ the wallet auto-locks/manually-locks, and unlock re-authenticates with that device secret.

## Non-goals

- **No PIN / Pattern for MPC.** They are cryptographically weak here (a 4–6 digit PIN gating a key is offline-brute-forceable), and their "encrypt the session key under the credential" envelope cannot be re-created after the service worker dies (we hold only the credential's hash, not the plaintext), so they break across a restart. Excluded by design.
- No change to the creation flow, the recovery file, the backend, or the login-share session cache.
- No lock method that differs from the wallet's creation device secret (i.e. no "created with passkey, lock with a separate password").

## Background: how locking works today

- **Normal/PRF wallets:** `unlockMethod` config (`null`/`'password'`/`'pin'`/`'pattern'`) drives everything — auto-lock (`checkAutoLock` skips when unset), the nav-drawer manual-lock button (`hasUnlockMethod`), and the unlock gate (`verifyUnlockCredentials` returns `true` immediately when unset). The lock method is a **UI gate**; the signing key stays protected at rest (spending password / PRF) independent of the lock.
- **MPC wallets (current):** the reconstructed root key is held **in plaintext** in the background `mpcSessionCache` for the whole session (so signs don't re-prompt Google). `lock()` wipes it; re-unlock rebuilds the key from the creation device secret (passkey PRF / password) + the session-cached login share (no Google). This is a **crypto lock** (locked ⇒ no plaintext key in memory), but it is not configurable and always prompts the device secret.
- To fit MPC into the standard model, several MPC-specific hacks were added this session and must be reverted (see below).

## Security model (the important part)

The security property we keep: **a locked MPC wallet holds no usable plaintext key in memory.** This is already achieved by the existing `lock()` → `mpcSessionCache.clearAll()` wipe. Re-unlock rebuilds the key by re-running the device secret against the (PRF/password-encrypted) device share + the session-cached login share.

So the "hybrid" (encrypt the session key under the lock credential) is **already implemented for the Passkey/Password cases** — the device share is the ciphertext, the device secret is the credential. No new crypto is introduced.

Ranking (from the brainstorming): wipe-on-lock (this design, for Passkey/Password) is the strongest locked-state posture. **None** deliberately holds the key in memory during a live session — that is the user's explicit opt-out, identical in spirit to a Normal wallet set to None.

## Behavior specification

Let `deviceSecretKind = mpcUsesPasskey ? 'passkey' : 'password'` (from the wallet record: `webAuthnCredentialId && mpcPrfSaltId` ⇒ passkey).

### Lock method = None (`unlockMethod` unset)
- Does **not** auto-lock (inactivity timer ignored).
- Manual-lock button is **hidden** in the nav drawer.
- Startup stale-lock clear applies (a stray `isLocked` is cleared).
- Signing during a live session is free (key cached).
- **After SW death / fresh login:** the key is gone; the next unlock/sign needs the device secret + Google login-share (the existing reconstruction flow). None does not avoid this — it only removes the within-session lock.

### Lock method = Passkey / Spending Password (`unlockMethod` set)
- Auto-locks per the Auto-Lock timer; manual-lock button shown.
- `lock()` wipes the plaintext key (unchanged).
- Unlock prompts the device secret (passkey ceremony or spending-password field) → `UNLOCK_MPC_WALLET` rebuilds from the cached login share (no Google) → `setLocked(false)`. (existing `UnlockWalletDialog` MPC branch)
- After SW death: same, except the login share is refetched via Google (existing session-expired fallback).

## Components & changes

1. **`LockSettingsDialog.vue`**
   - Un-hide the unlock-method section for MPC (revert the `!isMpcWallet` gate from `a84d24f0`).
   - For MPC, render only two choices: **None** and one device-secret option labeled per `deviceSecretKind` ("Passkey" or "Spending Password"). Do **not** render PIN/Pattern (and don't render the password option for a passkey wallet, or vice-versa).
   - Selecting the device-secret option persists `unlockMethod` (value: `'passkey'` or `'password'` per kind) with **no setup sub-dialog** — the credential already exists from creation.
   - Selecting None clears `unlockMethod`.
   - Keep the Auto-Lock timer (already enabled for MPC).
   - Keep the passkey-protection already added for MPC (no deregister).

2. **`background.ts` `checkAutoLock`** — revert the MPC exemption (`0c05e993`): drop `&& wallet.encryptionMethod !== 'mpc'` so MPC auto-locks only when `unlockMethod` is set. Same revert for the startup stale-lock clear guard (MPC no longer force-kept-locked when unset).

3. **`NavigationDrawer.vue`** — revert `hasUnlockMethod || isMpcWallet` (`e52e6f89`) back to `hasUnlockMethod`; remove the now-unused `isMpcWallet` computed if nothing else uses it.

4. **`SecurityTab.vue`** — refine the MPC lock-row summary (do **not** fully revert `e52e6f89`, which would re-introduce the misleading "PassKey: Not configured" chunk). For MPC show `Unlock Method: {None | Passkey | Spending Password} • Auto-Lock: {timer}` and **omit the PassKey chunk** (a Normal-only concept). `unlockMethodText` must map the MPC `'passkey'` value to a "Passkey" label. Row title reverts to the standard "Lock Settings" (not "only").

5. **`UnlockWalletDialog.vue`** — no change; the device-secret unlock branch already exists and is correct.

### Note: `unlockMethod` is a lock-enabled flag for MPC

For MPC, the `unlockMethod` config value (`'passkey'`/`'password'`/unset) functions only as **"is the session lock enabled, and with what label"**. The actual unlock does **not** go through `verifyUnlockCredentials`/the standard `UNLOCK` path — it uses the `isMpcWallet` + `mpcUsesPasskey` device-secret branch in `UnlockWalletDialog` → `UNLOCK_MPC_WALLET`. So `checkAutoLock` (truthy check), the nav-drawer button (`hasUnlockMethod`), and the LockSettings/SecurityTab display are the only consumers of the value for MPC. This avoids touching the sensitive `verifyUnlockCredentials` flow.

## Data flow

- **Set method:** LockSettingsDialog writes/clears `unlockMethod` in the per-wallet config table (existing `handleUnlockMethodSelect` path; for MPC the device-secret option skips the credential-setup dialog).
- **Auto-lock:** `checkAutoLock` reads `unlockMethod`; unset ⇒ skip; set ⇒ lock after inactivity (existing).
- **Unlock:** UnlockWalletDialog reads `mpcUsesPasskey` and prompts the device secret → `UNLOCK_MPC_WALLET` (existing).

## Error handling

- Selecting a method fails to persist ⇒ surface the existing `security.autoLockUpdateFailed`-style error; no partial state (config write is a single `put`).
- None + SW death, user tries to sign ⇒ existing `resolveSignPrivateKeyBytes` "unlock with Google before signing" path drives the reconstruction prompt.

## Testing

- **Unit:** `checkAutoLock` — MPC with `unlockMethod` unset does **not** lock; MPC with it set locks after inactivity (mirror the existing Normal-wallet expectation). This is the one piece of new logic worth a unit test; `checkAutoLock` currently has none, so a small focused test around the `unlockMethod`/`encryptionMethod` gate is in scope.
- **Manual e2e (human-gated, real device):**
  - None: no auto-lock; no manual-lock button; sign works; after SW death, reconstruction prompt appears.
  - Passkey: auto-locks; unlock via passkey (no Google) within a session.
  - Password: same with the spending password.

## Rollout

Testnet-only, behind the existing (locally-flipped, uncommitted) `isGoogleWalletEnabled` flag. No new flag. Part of the pending third-party audit scope already tracked for MPC.
