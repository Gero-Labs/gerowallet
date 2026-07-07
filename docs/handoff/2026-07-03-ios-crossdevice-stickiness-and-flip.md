# iOS handoff — cross-device presence stickiness + fail-closed flip coordination

**Date:** 2026-07-03
**From:** extension side (gerowallet)
**To:** iOS cross-device agent (gero-ios feature branch)
**Status:** extension changes shipped on PR #750; iOS asks below are for your branch.

This is a coordination note, not a spec change. Two topics: (1) making device
**presence** stable enough that pairing is not a lucky-timing game, and (2)
sequencing the **fail-closed flip** now that both clients produce and verify the
wallet-control proof.

---

## 1. What the extension just changed (context)

Live mainnet testing surfaced that both devices register fine on the relay
(`Cross-device: registered device ... (ios|extension) hasSigningKey=true`) but
are almost never connected at the same instant, so the pairing list looked empty.
Root causes were extension-side and are now fixed on PR #750:

- **Inbound routing bug** — the socket handler for `DEVICES`/`SIGN_*` was frozen
  to `undefined` when remote signing was enabled after login. Fixed (live closure).
- **UI raced the async registry** — the settings dialog fetched devices once on
  open. Now polls every 3s while open.
- **MV3 worker recycling** — the extension's service worker was dying every
  ~30-42s (30s idle limit), which evicted + re-registered its device constantly.
  Fixed by shortening the keep-alive `SYNC_CHECK` to 25s: a WebSocket send/receive
  resets the worker's idle timer, so the socket (and the registration) now persists.
- **Policy + UX** — "Require a trusted device" now keys off **persistent** pairing,
  not live presence, so it no longer greys out when a peer drops. Paired-but-offline
  devices render as **Offline** (dimmed) instead of vanishing.

Net effect: the extension now stays registered continuously while it is running,
and it tolerates a peer being briefly offline.

---

## 2. iOS asks (presence stickiness)

iOS is a native app, so it does **not** have the MV3 30s-idle problem — while the
app is foregrounded the `URLSessionWebSocketTask` stays open and the device stays
registered. The 120s keep-alive in `GeroSyncClient.startKeepalive()` is fine for
that; you do **not** need to match the extension's 25s. The iOS-specific problem is
**backgrounding**: iOS suspends the app shortly after it backgrounds, the socket
dies, and the relay evicts the device (owner-aware eviction on disconnect). That is
expected and the extension now displays it correctly (the phone shows as Offline).

Please confirm / implement:

1. **Re-register on every (re)connect.** After each socket open + SUBSCRIBE, send
   `DEVICE_REGISTER` (with the cached wallet-control `proof`) — same idempotent
   pattern as the extension's `onSocketOpen -> register()`. The relay upserts by
   deviceId, so repeat registers are free. This guarantees the phone reappears in
   siblings' `DEVICES` snapshot immediately after any reconnect.

2. **Re-register on foreground.** On `scenePhase == .active` /
   `didBecomeActive`, if the socket reconnected, ensure a fresh `DEVICE_REGISTER`
   goes out (covered by #1 if you register on every connect). The goal: when the
   user opens the phone to approve, it is present within a second or two.

3. **Proof on the register.** Confirm the `proof` object rides every
   `DEVICE_REGISTER` (produce-once-under-auth, cache, re-send — same model as the
   extension's `deviceProofStore`). The relay carries it verbatim; siblings verify
   it. This is required for the fail-closed flip below.

4. **No aggressive keep-alive needed.** Keep 120s. Do not add a 25s ping on iOS;
   it would just burn battery. Presence while foregrounded is already stable.

### The real background story (strategic, not this sprint)

Today, if the phone is **locked/backgrounded** when the desktop sends a
`SIGN_REQUEST`, the phone is not connected, so nothing happens until the user opens
the app. The durable fix is **APNs**: when a `SIGN_REQUEST` targets a device that is
not currently connected, the relay (or gero-backend) sends a push notification to
wake the app, which reconnects, receives the queued `SIGN_REQUEST`, and prompts the
user to approve. That requires: APNs entitlement + token registration, a
relay/backend push path, and request queueing for offline targets. This is the
answer to "does the phone get a push when locked?" — currently **no**; this is the
work to make it **yes**. Flag if you want to scope it; it pairs naturally with the
relay `to`-targeting item on the roadmap.

---

## 3. Fail-closed flip coordination

Both sides now have the full authenticated-register machinery:

| Capability | Extension | iOS |
|---|---|---|
| Verify a peer's proof at pairing | ✅ #749 (verify-if-present) | ✅ #33 (trust layer) |
| Produce its own proof | ✅ #750 (`proof=yes` confirmed live) | ✅ (emitting per your last update) |

Per the ratified contract (`docs/plans/2026-07-03-authenticated-device-register-contract.md`,
Rollout step 4), the flip is: **pairing rejects a missing/invalid proof, fail-closed,
in the SAME release on both clients.** Right now both verify *if a proof is present*
but still allow SAS-only pairing when it is absent (backward-compatible during
rollout). Because the feature is dark (`isCrossDeviceSigningEnabled` default false,
no in-the-wild TOFU pairings), we can flip without a migration.

Proposed sequence:

1. **Confirm interop** — one more cross-pair test: extension pairs iOS and iOS pairs
   extension, both with `proof` present, both verifying green. (The COSE conformance
   vector already matched byte-for-byte; this is just an end-to-end pairing check.)
2. **Both clients flip verify to fail-closed** — reject pairing when `proof` is
   absent or invalid. Ship in a coordinated pair of builds. Nothing on the relay
   changes for this step (the relay never verifies; it is a client-side gate).
3. **Optional, later — relay CHALLENGE (v2)** — a server nonce to close the
   same-wallet register-replay residual. This is a separate gero-sync + both-clients
   change and is **not** required for the flip. Design is being written; it will
   sign the nonce with the **relay-auth** key (available at reconnect, no wallet
   auth), so it will not break the produce-once-cached wallet-proof model on either
   side.

**Ask:** confirm iOS is ready for step 2 (fail-closed verify) and whether you want
the flip in the next iOS build or after the APNs/background work. The extension can
flip its verify in a one-line change whenever you are ready; we just want them to
land together so neither client bricks pairing against the other.

---

## Quick reference

- Contract: `docs/plans/2026-07-03-authenticated-device-register-contract.md`
- Prior iOS handoff (trust layer): `docs/handoff/2026-07-03-ios-remote-signing-trust-layer.md`
- Relay register/evict logs: `kubectl logs -n gero <gero-sync-pod> | grep "Cross-device:"`
- Extension PR (producer + stickiness): #750 (stacked on #749)
