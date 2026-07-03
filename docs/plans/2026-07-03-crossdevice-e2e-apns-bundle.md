# Cross-device signing: to-targeting + APNs + E2E — scoping & design

**Date:** 2026-07-03
**Status:** designed + adversarially verified (11-agent workflow: 3 maps, 2 crypto designs, 5 lenses). **Verdict: SHIP to-targeting + APNs, DEFER E2E.** to-targeting is shipped (see Status); APNs is scoped + handed off; E2E design is captured for later.

## Verdict (per piece, honest)

The payload matters: `SignRequest.unsignedCbor` and `SignResponse.witnessSetCbor` are **both public-bound** (they go on-chain; `protocol.ts:68` says so). That reframes everything.

- **to-targeting → SHIP (done).** Cheap, additive, the `to` field sits outside the signed subject, relay routes to one device with broadcast fallback. Independent value (stop broadcasting every tx to every device) + the addressing primitive APNs and E2E both require.
- **APNs → SHIP (scoped, handed off).** The real product unlock: today a backgrounded/locked iPhone drops its socket and the relay evicts it, so a `SIGN_REQUEST` is silently dropped — cross-device signing **does not work when the phone is asleep**, which is most of the time. APNs makes it work. Mostly backend plumbing, no exotic crypto. Two gaps to close (below).
- **E2E → DEFER.** Both payloads public-bound, so E2E adds **zero integrity** (the desktop body-hash recheck already prevents tampering) and hides no key material. Its entire value is three narrow confidentiality gains: closing the relay's seconds-long **front-running window**, reducing **device/activity metadata correlation** (partial — routing envelope still leaks), and keeping **rejected transactions** secret (they never hit chain). That is a lot of coordinated crypto across relay + 2 clients for a single-user feature. Keep the design (Family B, below) on the shelf; revisit if a future flow carries **private pre-submission data** (e.g. shielded Midnight construction), which flips gains (1)/(3) from marginal to real.

## Status (what shipped in this bundle)

- **Approver replay + expiry fix** — `crossDeviceSigning.service.ts` (gerowallet #754). The adversarial pass found the approver path had **no replay dedup and no expiry check** (both were requester-side only), so a relay could re-deliver a captured `SIGN_REQUEST` and re-surface the approval sheet, or deliver an expired one. Fixed with an approver-side `seen` set (`reqId:nonce`) + `expiresAt` check. This is a prerequisite for APNs (which makes replay a reliable primitive).
- **to-targeting** — optional `to` deviceId on `SIGN_REQUEST`/`SIGN_RESPONSE`, out of the signed subject. Relay routes by `to` with broadcast fallback (gero-sync #15). Requester sets `to = the sole ONLINE trusted signer` (else broadcast, never worse than today pre-APNs); approver echoes `to = req.from`. Extension #754.

## to-targeting spec (shipped)

- Wire: `to?: string` on both sign frames (`protocol.ts`), validated as optional. NOT in `envelope.ts buildSubject` — delivery hint only; a relay rewriting it can misdeliver/drop, never forge.
- Relay (`WalletSyncHandler.relayToSiblings`): `to` blank → broadcast (unchanged); `to` set → deliver only to the sibling whose `registeredDeviceId == to`.
- Requester default target (`walletManager.getDefaultCrossDeviceTarget`): the sole online trusted signing device, else null → broadcast. A device picker for >1 signer is a later refinement.

## APNs spec (scoped — mostly backend + iOS; handoff `docs/handoff/2026-07-03-apns-background-wake.md`)

Goal: when a `to`-targeted `SIGN_REQUEST` finds the target **registered but not connected** (backgrounded/locked phone), wake it via Apple Push, it reconnects and pulls the request. Note: APNs is a **delivery/wake** unlock, not background auto-sign — the phone still needs Face ID + a human approval after it wakes.

Relay (gero-sync):
1. **Durable per-device store** keyed by `(stakeKey, deviceId)` carrying `apnsToken` + TTL, that **survives `evictDeviceIfRegistered`** (which wipes `DeviceInfo` on socket close). This is the relay's first state whose lifetime is decoupled from a live socket — needs TTL + size caps + GC.
2. `apnsToken` carried on `DEVICE_REGISTER` (parse alongside `pubKey`), **not signed** (a wrong token just fails to wake; the subsequent approval is still fully authenticated).
3. **Offline branch** in `relayToSiblings`: when `to` is set and no live sibling matches but the device is in the durable store with `platform==ios`, enqueue the frame in a `PendingSignQueue` (keyed by target deviceId, with TTL) and fire the APNs HTTP/2 push.
4. **Drain** the queue on (re)`SUBSCRIBE`/`DEVICE_REGISTER` (tail of `handleDeviceRegister`, after `setRegisteredDeviceId`).
5. Rate-limit note: `allowMessage` is 30/min/session; an APNs-driven retry storm shares that budget — exempt or separately bound relay frames.

iOS (gero-ios):
1. `aps-environment` entitlement + wire `CODE_SIGN_ENTITLEMENTS` in `project.yml` (currently unset); Push Notifications capability.
2. `UIApplicationDelegateAdaptor` on the `@main` SwiftUI app (no AppDelegate today); `didRegisterForRemoteNotificationsWithDeviceToken` → capture hex token → send on `DEVICE_REGISTER` (already sent every connect); `didReceiveRemoteNotification` → reconnect the socket → the queued request flows through the existing `process → handleSignRequest → CrossDeviceApprovalSheet` path unchanged.

Backend/ops: APNs provider (`.p8` auth key, per-environment sandbox vs prod), cert/key rotation.

### The TTL / cold-wake gap (MUST design before APNs ships)
The requester promise TTL is **60s** (`DEFAULT_TTL_MS`, `crossDeviceSigning.service.ts:69`). An APNs cold-wake + Face ID + WS reconnect routinely exceeds that, so a queued request arrives **already expired** (the approver now rejects expired requests — correctly). Options:
- **Re-request-on-wake (preferred):** the woken phone signals "ready"; the desktop re-issues a **fresh** `SIGN_REQUEST` with a new `expiresAt` rather than delivering a stale queued one. Clean, keeps the short interactive TTL, no long-lived pending state on the requester. Requires the desktop to still have the tx pending (fine for an interactive send).
- **Longer server-side queue TTL** decoupled from the requester promise: simpler but means the desktop must keep waiting minutes, and a stale request can be delivered — weaker.

Recommendation: re-request-on-wake, designed jointly (iOS already routes remote-sign requests; the handshake is a small `WAKE_READY`/re-issue exchange).

## E2E design (DEFERRED — Family B, kept build-ready)

If a future private-payload flow justifies it, build it as **Family B (dedicated X25519 keypair)**, not Family A (Ed25519→X25519 conversion). Family A is iOS-hostile: CryptoKit has no `edwardsToMontgomery` and swift-sodium does not surface the libsodium conversion, so it forces a C-shim. Family B needs zero new iOS crypto (`Curve25519.KeyAgreement` + HKDF already used in `CIP30Crypto.swift`); the only net-new is `ChaChaPoly`.

Design:
- Each device generates a **second, dedicated X25519 keypair**; announce `x25519Pub` on `DeviceInfo`/`DEVICE_REGISTER`.
- **Shared secret:** static-static X25519 ECDH → HKDF-SHA256 (salt = sorted+concat pinned deviceIds, info = `gero-xdev/e2e/v1`) → 32-byte key.
- **Seal:** ChaCha20-Poly1305 (extension `@noble/ciphers`; iOS `ChaChaPoly`) of `unsignedCbor` + `witnessSetCbor` only; everything else (reqId, to, from, expiresAt) stays cleartext (relay needs `to` to route). Fresh 24-byte nonce per body (XChaCha) prepended to the ciphertext. **AAD** = `gero-xdev/e2e/v1|reqId|from|to` (anti-splice). Encrypt-then-sign; the v2 subject binds `blake2b256(ciphertext)` (not plaintext, to avoid confirm-a-guessed-plaintext).

### The three MANDATORY adversarial fixes (or E2E is broken)
1. **Runtime key must be the PINNED x25519Pub, never the live snapshot (medium).** Binding `x25519Pub` into the COSE proof subject defends *pairing*, but the runtime encrypt path naturally reads the relay-controlled DEVICES snapshot — a relay can substitute `x25519Pub` **post-pairing** and MITM/decrypt. Fix: store `x25519Pub` on `TrustedDevice`; extend `isDeviceTrusted` to also require `pinned.x25519Pub === presented`; **seal to `settings.trustedDevices[id].x25519Pub` (the pin), not `pubKeyOf(registry)`**, and refuse to encrypt with no pinned key.
2. **Approver replay + expiry (medium).** Whole-frame replay is not an E2E problem — it was a **current gap, now fixed** (#754). Keep it; it is a prerequisite for both APNs and E2E.
3. **Downgrade ratchet — SSL-strip (HIGH).** Keying the encrypt/no-encrypt decision off the relay snapshot lets a relay **delete `x25519Pub`** from the snapshot so two E2E-capable devices silently fall back to cleartext. Fix: make the decision a function of the **pinned** record (`e2e:true` when the proof bound `x25519Pub`), a **one-way ratchet** — sender requires encryption for any peer pinned e2e-capable (ignoring the snapshot); receiver **rejects** inbound cleartext from an e2e-pinned peer. Cleartext only for peers genuinely pinned without E2E.

Also fold `blake2b(pubKey||x25519Pub)` into `pairingFingerprint` so the SAS covers the encryption key (closes the SAS-only proofless fallback path). E2E requires a **re-pair** (the X25519 key must be in the proof subject, which pre-E2E pins lack) — acceptable given single-user/zero in-the-wild pairings.

### Residual metadata leak (even with E2E)
E2E encrypts the CBOR bodies but NOT the routing envelope (`reqId`, `from`, `to`, `expiresAt`, timing). The relay still learns "device A asked device B to sign something now" and can correlate devices + cadence. Hiding that needs onion/mix routing, out of scope. to-targeting helps (no fan-out) but the relay always knows the target.

## Build order

1. **Relay to-targeting** (gero-sync #15) — land first, harmless.
2. **Extension to-targeting + approver replay fix** (gerowallet #754).
3. **iOS to-targeting** (echo `to`, mirror) — small.
4. **APNs** — design the re-request-on-wake handshake, then relay durable store + queue + provider, iOS entitlement + token, backend `.p8`. Its own track.
5. **E2E** — deferred; build only against a private-payload use case, with all three fixes above.
