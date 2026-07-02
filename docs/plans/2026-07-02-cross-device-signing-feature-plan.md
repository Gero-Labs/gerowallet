# Cross-Device Signing: Full Feature Development Plan (to real-phone E2E)

**Goal:** ship the desktop-extension-proposes / phone-approves-and-signs flow to a working end-to-end test on a physical iPhone, then harden it. Corrects the earlier "phone not achievable" note: with a macOS + Xcode + iOS repo access, the iOS build is an agent task, so real-phone E2E is in scope.

**No em/en dashes (standing preference).**

## 0. Model + wire contract (do not re-derive)

Desktop copilot PROPOSES an unsigned tx, gero-sync RELAYS it to the phone, the phone INDEPENDENTLY decodes + displays the real tx and biometric-signs LOCALLY, the witness returns, the desktop applies it and submits. Keys never leave a device. Authoritative wire contract (both clients already byte-parity-proven against it):
`docs/plans/2026-06-29-cross-device-signing-contract.md`.

Current state (verified): wire protocol ratified, extension client + iOS approver both implemented and DARK behind flag `isCrossDeviceSigningEnabled`. Missing: the gero-sync relay (server), the extension "sign on another device" Send path, the iOS build onto the phone, and the flag flip.

## 1. Execution model: two agents + you

- **Windows deploy-agent** (all local repos on this machine): gero-sync relay + extension Send integration + deploy. Details already captured in `docs/handoff/2026-07-02-crossdevice-today-deploy-runbook.md` (Part B is a paste-ready prompt).
- **Mac agent** (on your macOS, in the gero-ios checkout): the iOS track (Phase 3).
- **You:** start Docker Desktop (currently down), confirm the one prod-relay deploy at its STOP gate, plug in the phone / approve the TestFlight build, and be the human in the E2E test.

The tracks parallelize: Phase 1 (gero-sync) and Phase 3 (iOS) share nothing and can run at the same time; Phase 2 (extension) is independent too. Phase 4/5 (flags + E2E) are the serial join.

## 2. Phase 1 - gero-sync relay (Windows deploy-agent, repo gero-sync)

Java service (Spring, WebSocket). Build ADDITIVELY; the SYNC/onTip hot path stays untouched.

Pre-flight: start Docker Desktop; `git fetch && git checkout development && git pull --ff-only`. Local `development` is behind origin and dirty with UNRELATED Midnight resume-cursor edits (`WalletSyncHandler.java`, `ClientSession.java`, `SubscribeMessage.java`, `SyncPayload.java`, `MidnightUnshieldedTxSubscriber.java`) - stash them, do NOT ship.

Build on a new feature branch off `development`:
- NEW `DeviceInfo.java`: camelCase DTO `{ deviceId, label, platform, pubKey, hasSigningKey }` + `lastSeen`. No `@JsonNaming` (wire is camelCase).
- NEW `DeviceRegistry.java`: `@Component`, in-memory `ConcurrentHashMap<stakeKey, Map<deviceId, DeviceInfo>>` (mirrors `AddressRegistry`); `stakeKey = network.toLowerCase() + ":" + monitorAddress`.
- EDIT `WalletSyncHandler.java` ONLY: inject `DeviceRegistry`; add switch arms `DEVICE_REGISTER -> handleDeviceRegister`, `SIGN_REQUEST/SIGN_RESPONSE -> relayToSiblings`; `handleDeviceRegister` upserts + acks + `broadcastDevices`; `broadcastDevices` sends `{type:"DEVICES",devices:[...]}` to all sibling sessions on the stake address; `relayToSiblings` forwards the raw JsonNode verbatim to siblings except the sender; call `broadcastDevices` at the end of `handleSubscribe`.
- Defer offline push (APNs) to Phase 6; foreground-connected is fine for the first E2E.

Done-check: `~/scoop/apps/maven/current/bin/mvn -B clean package -DskipTests` builds `target/gero-sync.jar`.

Deploy (merge to `development` first, deploy from it):
- Bump `pom.xml` 0.1.34 -> 0.1.35. Registry: `registry.gerowallet.io/gero/gero-sync:gero-sync-dev-v0.1.35` (Harbor, docker authed). Ignore stale `k8s/dev` and dead `k8s/prod`.
- `docker build --platform=linux/amd64` -> `docker push` -> STOP for your confirm -> `kubectl -n gero set image deployment/gero-sync gero-sync=$IMAGE` -> `rollout status`.
- STOP GATE: `sync.gerowallet.io` is the single live relay = the phone's endpoint (no separate dev cluster). Safe because additive + dark, but confirm before `set image`; never set image before push succeeds.
- Done-check: `curl https://sync.gerowallet.io/actuator/health` = 200; new pod tag Running. Rollback: `kubectl -n gero rollout undo deployment/gero-sync`.

## 3. Phase 2 - extension Send integration (Windows deploy-agent, repo gerowallet, branch feat/copilot-agent)

Wire the tested `requestSignature` into the ADA Send flow. All flag-gated behind `featureFlagsStore.isCrossDeviceSigningEnabled()`, additive.
- `walletManager.service.ts`: `getCrossDeviceSigning() { return this.crossDevice?.signing ?? null }`.
- `MessageTypes.ts`: `REQUEST_CROSS_DEVICE_SIGNATURE`.
- `background.ts`: handler modeled on `SIGN_TX` that calls `requestSignature({unsignedCbor, intent, stakeAddress, ttlMs})` and returns the `SignDecision`.
- `SendSheet.vue` (+ `SendDialog.vue` / `useTransactionSigning.ts`): a flag-gated "Sign on another device" button at the confirm step; on tap, build the ORIGINAL unsigned tx CBOR, send the message, and on `approved` set the witness and call the EXISTING submit path. `ttlMs = 180000` for manual approval.
- Integrity: in the existing `SUBMIT_TX` path, assert the decoded tx body hash is unchanged before vs after merging the external witness set (it already merges VKey witnesses without touching body bytes); throw on mismatch.
- i18n: add `crossDevice.signOnAnotherDevice`, `crossDevice.requestExpired`, `crossDevice.requestRejected` to BOTH us.ts and de.ts.
- Done-check: `npm run build` succeeds (typecheck is chronically red; judge by delta).

## 4. Phase 3 - iOS approver to device (Mac agent, repo gero-ios)

The approver (CrossDeviceSigningService, CrossDeviceApprovalSheet, CrossDeviceIdentity Keychain key, GeroSyncClient relay frames, replay guard, independent CSL decode) is built on branch `claude/affectionate-leakey-c15cb7` with 71 tests green, but that branch is NOT on origin and NOT on this Windows checkout. Mac-agent tasks:
1. Recover the branch: locate `claude/affectionate-leakey-c15cb7` in the Mac's gero-ios checkout (or reflog / the agent session that made commits bbeb603, 924ef18, 8028bca, 0a834cd, e221b1b). Push it to origin so it is not lost. Verify `swift test` / the 71-test suite is green.
2. Verify the approver is actually PRESENTED on an inbound SIGN_REQUEST: `GeroSyncClient` `relayFrames` stream -> `CrossDeviceSigningService` -> present `CrossDeviceApprovalSheet` over the current UI. If the sheet is built but not yet hooked into app navigation, wire it (this is the most likely gap; confirm against the code).
3. Confirm `DEVICE_REGISTER` is sent on socket connect and the device reads the flag `isCrossDeviceSigningEnabled` (aligned per commit 8028bca).
4. Relay endpoint: `Config.swift:46` hardcodes `wss://sync.gerowallet.io/ws/sync`. For a prod-relay test no change is needed (Phase 1 deploys there). If you want a non-prod relay, add a build-config toggle; otherwise leave it.
5. Build to the device: `xcodegen generate`, signing team `JGK42C65U9`, `Cmd+R` to the plugged-in iPhone (or Archive -> TestFlight). Needs the device registered on the Apple Developer account.

Done-check: the app launches on the phone, connects the sync socket, sends DEVICE_REGISTER, and (with the flag on) is ready to receive SIGN_REQUEST.

## 5. Phase 4 - flags + join (you + deploy-agent)

- Define `isCrossDeviceSigningEnabled` in the self-hosted gero-sync flag service, default false, and ENABLE it for your test account/context only. Both clients gate on it; nothing else sees the feature.
- Also define `isCopilotEnabled` while there (default false) so the flag set is complete, but leave it off (separate feature).
- Confirm both clients: the extension (dev build or a flagged build) and the phone are logged into the SAME wallet (same stake address) so gero-sync groups them, and both show up in each other's DEVICES snapshot.

## 6. Phase 5 - end-to-end test (you)

On the desktop extension: start Send, e.g. 2 ADA to an address on preprod (use a preprod/test wallet for the first run), tap "Sign on another device." The phone gets the SIGN_REQUEST, shows the wallet-decoded amount + recipient, Face ID. The extension applies the returned witness, re-checks the body hash, and submits. SUCCESS = a preprod tx hash, signed on the phone, body unchanged.

If it stalls, the likely culprits in order: flag not on for both; not the same stake address; gero-sync `broadcastDevices` not firing (so `resolvePubKey` is null and verify drops); ttl too short; the approver sheet not presented. Each has a clear log point.

## 7. Phase 6 - hardening (after the first green E2E)

- Offline push: APNs trigger in gero-sync on a SIGN_REQUEST for a disconnected device + the iOS push entitlement, so the phone wakes when the app is closed.
- Registration auth: replace TOFU with a wallet-key challenge at DEVICE_REGISTER (server defines the nonce; both clients sign it). Contract section 7.
- Persisted device identity on the extension (currently regenerated per session) so deviceId is stable.
- Distributed relay: the in-memory registry is single-pod; for multi-pod gero-sync, move fan-out to a shared channel (Redis pub/sub or the existing bus).
- Mainnet gating: keep the first runs on preprod; only allow mainnet sends once the integrity re-check + guardrail are exercised.

## 8. Safety model (why a prod deploy is OK before the flag flips)

Everything is additive and dark. gero-sync only adds new inbound message types; existing sync is untouched. Both clients stay invisible behind `isCrossDeviceSigningEnabled`. So the relay can ship to the single prod endpoint safely; the feature appears only when you flip the flag for your test account. The one guarded action is the gero-sync `kubectl set image`, which STOPs for your confirmation.

## 9. Sequencing summary

Parallel: Phase 1 (gero-sync), Phase 2 (extension), Phase 3 (iOS). Serial join: Phase 4 (flags) after 1+2+3 land, then Phase 5 (E2E), then Phase 6 (hardening). Pre-req before Phase 1 build: start Docker Desktop.
