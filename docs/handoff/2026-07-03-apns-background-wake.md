# iOS + backend handoff — APNs background wake for cross-device signing

**Date:** 2026-07-03
**From:** extension/relay side (gerowallet + gero-sync)
**To:** iOS cross-device agent + backend/ops
**Depends on:** to-targeting (gero-sync #15 + gerowallet #754) landing first. Full design: `docs/plans/2026-07-03-crossdevice-e2e-apns-bundle.md`.

## The problem this solves
Today a backgrounded/locked iPhone drops its WebSocket and the relay evicts it, so a `SIGN_REQUEST` targeted at it is silently dropped. Cross-device signing only works while the phone app is foregrounded, which is rarely. APNs wakes the app so the request is delivered. **APNs is a delivery/wake unlock, not background auto-sign** — the phone still needs Face ID + a human approval after it wakes.

## What just shipped (so you can build on it)
- Relay routes `SIGN_*` by an optional `to` deviceId, broadcast fallback (gero-sync #15).
- Extension sets `to = the sole online trusted signer` and echoes it on responses (#754).
- **Approver replay + expiry guard** (#754): the approver now drops replays (`reqId:nonce`) and expired requests. This is a prerequisite — APNs makes replay a reliable primitive, so it had to land first.

## iOS asks
1. **Entitlement + capability:** add `aps-environment` to `gero_ios.entitlements` and wire `CODE_SIGN_ENTITLEMENTS` in `project.yml` (currently unset); add the Push Notifications capability.
2. **Token capture:** the app is pure SwiftUI `@main` with no AppDelegate — add a `UIApplicationDelegateAdaptor`. In `didRegisterForRemoteNotificationsWithDeviceToken`, capture the hex token and send it on `DEVICE_REGISTER` as a new optional `apnsToken` field (you already send `DEVICE_REGISTER` every connect via `syncDidConnect`). `apnsToken` is NOT signed — it is routing metadata; a wrong token just fails to wake, and the approval that follows is still fully authenticated.
3. **Wake handling:** in `didReceiveRemoteNotification`, reconnect the socket (`GeroSyncClient.openConnection`/`scheduleReconnect`). The queued/re-issued request then flows through your existing `process → handleSignRequest → CrossDeviceApprovalSheet` path unchanged.

## Relay asks (gero-sync — I can take these once the handshake is agreed)
1. **Durable per-device store** keyed by `(stakeKey, deviceId)` holding `apnsToken` + TTL, that **survives `evictDeviceIfRegistered`** (which wipes `DeviceInfo` on socket close). First relay state decoupled from a live socket → needs TTL + size caps + GC.
2. **Offline branch** in `relayToSiblings`: `to` set + no live sibling + device in the durable store with `platform==ios` → enqueue in a TTL'd `PendingSignQueue` (keyed by target deviceId) + fire the APNs HTTP/2 push. Drain on the next `SUBSCRIBE`/`DEVICE_REGISTER`.
3. Rate-limit: `allowMessage` is 30/min/session; keep an APNs retry storm from starving it.

## Backend/ops
APNs provider: `.p8` auth key, per-environment (sandbox vs prod `aps-environment`), key rotation.

## The one design decision to make together first: the TTL / cold-wake handshake
The requester promise TTL is **60s** (`DEFAULT_TTL_MS`). An APNs cold-wake + Face ID + reconnect will routinely exceed 60s, so a queued request arrives **already expired** (the approver now correctly rejects expired requests). Do NOT just lengthen the TTL blindly — a multi-minute interactive wait is bad UX and a stale request could still be delivered.

**Preferred: re-request-on-wake.** When the phone wakes and reconnects, it sends a small `WAKE_READY { reqId }` (or the relay signals the requester that the target is now live); the **desktop re-issues a fresh `SIGN_REQUEST`** with a new `expiresAt` instead of the relay delivering the stale queued one. This keeps the short interactive TTL, avoids long-lived pending state, and means the approver only ever sees fresh requests. It needs the desktop to still have the tx pending (true for an interactive send).

Let me know if you want to design the `WAKE_READY` exchange jointly — it is a small frame on both sides, and it is the thing that makes APNs actually feel instant rather than "expired on arrival."

## Not in this track
**E2E payload encryption is DEFERRED** (see the plan doc). Both payloads are public-bound, so it adds no integrity and only narrow confidentiality; not worth the coordinated crypto now. If revived it must be Family B (dedicated X25519, which CryptoKit supports as-is) with the three fixes recorded in the plan. Nothing for iOS to do on E2E now.
