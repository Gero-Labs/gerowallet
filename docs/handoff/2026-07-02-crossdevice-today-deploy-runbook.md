# Cross-Device Signing: Same-Day Test Plan + Single Deploy-Agent Prompt (2026-07-02)

Grounded across gero-sync, gero-sync-deploy, gerowallet, and gero-ios. Additive + flag-gated everywhere. No em/en dashes.

# PART A — "Tested Today" Plan: Critical Path to a Working Cross-Device Signed Transaction in One Sitting

## The honest verdict on the real phone

A real phone as approver is **NOT achievable today by a headless agent**. Three independent, each-fatal blockers (all verified in findings):

1. **iOS install is Mac-gated.** The approver code lives only on branch `claude/affectionate-leakey-c15cb7`, which is **not on origin or locally** after a fresh fetch. Getting any new Swift onto a physical iPhone requires Xcode 16 → cable/TestFlight, which only runs on macOS. No headless Windows path exists (no Fastlane, no `xcodebuild` script; only Xcode Cloud → TestFlight).
2. **The phone's sync URL is hardcoded.** `gero-ios/Resources/Config.swift:46` pins `wss://sync.gerowallet.io/ws/sync` as a constant. It cannot be pointed at a dev relay without a code edit + rebuild (another Mac step).
3. **The relay does not exist yet.** `gero-sync` on `development` has zero DEVICE_REGISTER / SIGN_REQUEST / crossDevice code.

**Adam's manual step (cannot be delegated), for the real-phone milestone LATER:** on a Mac — recover/push branch `claude/affectionate-leakey-c15cb7` (or cherry-pick the approver commits), edit `Config.swift` wsURL if a non-prod relay is wanted, `xcodegen generate`, set signing team `JGK42C65U9`, `Cmd+R` to the device or Archive → TestFlight. Requires Apple Developer account + registered device.

## The fully-testable-today outcome (FALLBACK A — recommended, do this)

**Two-window BroadcastChannel harness inside the extension.** This exercises the *entire ratified wire protocol, envelope signing, byte-parity subjects, state machine, and registry* against itself in two browser windows — the exact code the phone will later talk to. No phone, no Mac, no gero-sync required for this path. This is the highest-fidelity thing achievable in one sitting.

Because the transport is cleanly injected (`crossDeviceSigning.service.ts` depends only on a `Transport { send, onMessage }` interface, and `wsTransport.ts` is a ~30-line adapter), a `broadcastChannelTransport.ts` drops in as a swap. What must be built to make it a real end-to-end test:
- A **local DEVICES exchange**: each window broadcasts its own `DEVICE_REGISTER` on the channel; each window builds a local `DevicesSnapshot` from what it hears and feeds it through the existing `applyDevicesSnapshot` (`deviceRegistry.ts`). This reuses the real registry reducer so `resolvePubKey` returns non-null and the real ed25519 verify path runs.
- A **minimal Vue approver view**: calls `signing.onSignRequest(handler)`, decodes `unsignedCbor`, shows amount/recipient, calls `respond({decision, witnessSetCbor})`. (This is exactly the iOS approver's job, so it also de-risks the iOS UI contract.)
- A **dev requester trigger**: wire the new "Sign on another device" Send button (from the extension integration) to `requestSignature(...)` with a real unsigned preprod tx.

## The parallel real-relay track (buildable + deployable today, keeps the prod path warm)

In parallel with Fallback A, the deploy-agent builds and ships the **gero-sync relay** and the **extension Send integration**, all flag-gated and additive. This does NOT produce a real-phone test today (phone still Mac-blocked), but it lands every non-Mac piece so that the day a Mac is available, only the iOS build remains. A prod-endpoint deploy is safe because the relay is purely additive (new inbound message types only; existing SYNC/onTip hot path untouched) and both clients stay dark behind `isCrossDeviceSigningEnabled` until flipped.

## Sequencing: parallel vs serial

| Track | Serial/Parallel | Owner |
|---|---|---|
| **T1. gero-sync relay** (build → merge to main → deploy) | Runs in parallel with T2/T3 | deploy-agent |
| **T2. Extension Send integration** (flag-gated) on `feat/copilot-agent` | Parallel with T1 | deploy-agent |
| **T3. Fallback A harness** (BroadcastChannel transport + approver view + dev trigger) on `feat/copilot-agent` | Parallel with T1; **depends on T2's button + message plumbing** so do T2 first, then T3 | deploy-agent |
| **T4. Flag flips** for the local harness test | Serial, after T2+T3 land | deploy-agent |
| **T5. Two-window local test** | Serial, after T4 | deploy-agent verifies; Adam eyeballs |
| **T6. iOS build to phone** | Serial, LAST, only when a Mac is present | **Adam (manual, Mac-only)** |

T1 and T2/T3 have no shared files, so they parallelize cleanly. T3 reuses T2's button and `REQUEST_CROSS_DEVICE_SIGNATURE` message, so within the extension track do T2 before T3.

## Step-by-step critical path

### Step 1 — gero-sync relay (deploy-agent, repo `gero-sync`)
- **Pre-flight blockers to clear first (verified):** (a) **start Docker Desktop** — `docker info` currently fails (`npipe:////./pipe/dockerDesktopLinuxEngine`); nothing builds until it's up. (b) `git fetch && git checkout development && git pull --ff-only` — local `development` is **30 commits behind origin, 4 ahead, dirty** with unrelated Midnight resume-cursor edits (`WalletSyncHandler.java`, `ClientSession.java`, `SubscribeMessage.java`, `SyncPayload.java`, `MidnightUnshieldedTxSubscriber.java`) — **stash those, do NOT ship them.**
- Build additively per the file-level recipe: new `DeviceInfo.java` (camelCase DTO, **no `@JsonNaming`**), new `DeviceRegistry.java` (`@Component`, in-memory `ConcurrentHashMap<stakeKey, Map<deviceId, DeviceInfo>>`), and edit `WalletSyncHandler.java` only — inject `DeviceRegistry`, add `DEVICE_REGISTER` / `SIGN_REQUEST` / `SIGN_RESPONSE` arms to the switch (`:96-100`), add `handleDeviceRegister`, `broadcastDevices`, `relayToSiblings`; call `broadcastDevices` at end of `handleSubscribe`. Relay `SIGN_REQUEST`/`SIGN_RESPONSE` as the raw `JsonNode` verbatim (byte-parity).
- **Done-check (build):** `~/scoop/apps/maven/current/bin/mvn -B clean package -DskipTests` produces `target/gero-sync.jar`.

### Step 2 — merge to main, deploy from main (deploy-agent, repo `gero-sync`, cluster GKE `gero` / namespace `gero`)
- **Deploy rule:** merge relay feature branch → `development`, deploy from `development`. Never from the feature branch.
- **Registry (LIVE / authoritative):** `registry.gerowallet.io/gero/gero-sync` (in-cluster Harbor; docker already authed). Tag scheme `gero-sync-dev-v<VERSION>`. Live pod today is `gero-sync-dev-v0.1.34`; pom is `0.1.34` — bump to `0.1.35`. Ignore the stale committed `k8s/dev/deployment.yml` (GCR v0.1.30) and `k8s/prod` (dead DockerHub).
- **STOP/confirm gate:** `sync.gerowallet.io` = namespace `gero` = the ONE live relay = the phone's prod endpoint. There is no separate dev cluster. So this "dev" deploy IS the prod endpoint. It is safe because additive + dark-behind-flag, but the agent must **STOP and confirm with Adam before `kubectl set image`**, and never `set image` before `docker push` succeeds (missing tag → ImagePullBackOff).
- Commands: `docker build --platform=linux/amd64 -t $IMAGE .` → `docker push $IMAGE` → (confirm) → `kubectl -n gero set image deployment/gero-sync gero-sync=$IMAGE` → `kubectl -n gero rollout status deployment/gero-sync`.
- **Done-check:** `curl -s -o /dev/null -w '%{http_code}' https://sync.gerowallet.io/actuator/health` returns `200`; pod running new tag. Rollback: `kubectl -n gero rollout undo deployment/gero-sync`.
- Names to hardcode: namespace `gero`, deployment `gero-sync`, container `gero-sync`, port `8082`, WS path `/ws/sync`, health `/actuator/health`.

### Step 3 — extension Send integration (deploy-agent, repo `gerowallet`, branch `feat/copilot-agent`, flag-gated)
- `walletManager.service.ts`: add `getCrossDeviceSigning()` returning `this.crossDevice?.signing ?? null`.
- `MessageTypes.ts`: add `REQUEST_CROSS_DEVICE_SIGNATURE`.
- `background.ts`: add `app.addToOptions(REQUEST_CROSS_DEVICE_SIGNATURE, ...)` that calls `walletManager.getCrossDeviceSigning().requestSignature({ unsignedCbor, intent, stakeAddress, ttlMs })` and returns the `SignDecision`. Optional belt-and-suspenders body-hash assert in the existing SUBMIT_TX handler (`:2130-2151`).
- `SendSheet.vue` (sidepanel) + `SendDialog.vue`/`useTransactionSigning.ts` (dashboard): flag-gated `canSignOnAnotherDevice` computed (`featureFlagsStore.isCrossDeviceSigningEnabled()`), a button in the confirm step, and a `signOnAnotherDevice()` method that serializes the ORIGINAL unsigned tx (`serializeCardanoJsSdkTx`), calls the new message, and on `approved` routes `witnessSetCbor` into the **existing** submit path (`submitSignedTx()` / `submitTx()`). No new witness-application code — `background.ts:2130-2151` already merges an external VKey witness set without touching body bytes.
- i18n: add `crossDevice.signOnAnotherDevice`, `crossDevice.requestExpired`, `crossDevice.requestRejected` to **both** `us.ts` and `de.ts`.
- **For the first live run, pass `ttlMs: 180000`** (default is 60s, too tight for manual approval).
- **Done-check:** `npm run build` succeeds; button renders only when flag on; nothing changes when flag off.

### Step 4 — Fallback A harness (deploy-agent, repo `gerowallet`, branch `feat/copilot-agent`, dev-gated)
- `broadcastChannelTransport.ts` implementing `Transport { send, onMessage }` over `new BroadcastChannel('gero-xdev')`.
- Local DEVICES exchange: each window broadcasts its `DEVICE_REGISTER`, builds a local `DevicesSnapshot`, feeds it through `applyDevicesSnapshot` so `resolvePubKey` is non-null.
- Minimal Vue approver view: `onSignRequest` → decode `unsignedCbor` → show amount/recipient → `respond({decision, witnessSetCbor})`.
- Dev requester trigger: the T3 "Sign on another device" button (or a devtools entry) calling `requestSignature(...)`.
- **Done-check:** `npm run build` succeeds.

### Step 5 — flag flips (deploy-agent)
- **Which flag:** `isCrossDeviceSigningEnabled` (`featureFlagsStore.ts:184`), served by the self-hosted flag service (gero-sync feature flags). Flip it **on** for the test account only. For the local Fallback A harness, the transport is swapped to BroadcastChannel so no relay dependency; the flag still gates the UI button + bootstrap.
- **Done-check:** button appears in Send confirm step; harness windows exchange DEVICES.

### Step 6 — two-window local test (deploy-agent verifies, Adam eyeballs)
- Open two extension windows on the same preprod wallet; window A initiates a Send and clicks "Sign on another device"; window B (approver view) approves; A applies the witness via SUBMIT_TX and submits to preprod.
- **Done-check (the real milestone for today):** a preprod tx hash returns from submit, produced by a witness signed in the *other* window through the ratified protocol. Body hash unchanged (structural + optional assert).

### Step 7 — real phone (Adam, manual, Mac-only, LATER)
See "Adam's manual step" above. Not today, not by the agent.

## Safety summary
Every agent change is additive and flag-gated. gero-sync relay only adds new inbound message types; the SYNC/onTip hot path is untouched. Extension changes are dark behind `isCrossDeviceSigningEnabled`. A prod deploy of gero-sync is therefore safe (dark until the flag flips), but because `sync.gerowallet.io` is the single live relay, the agent must STOP and confirm before the `kubectl set image`.

---

# PART B — Single Deploy-Agent Prompt (paste-ready)

```
You are a single deploy-agent with access to ALL local repos on this machine. Execute the
buildable + deployable subset of the cross-device signing milestone IN ONE SITTING. Everything
you build must be ADDITIVE and FLAG-GATED so a production deploy stays dark until flags flip.
Do NOT attempt any iOS/Xcode work — that is Adam's manual Mac-only step, out of your scope.

AUTHORITATIVE CONTRACT (read first, obey its wire field names and invariants):
  d:/GeroRepos/gitRepos/gerowallet/docs/plans/2026-06-29-cross-device-signing-contract.md

DEPLOY RULE (non-negotiable): NEVER deploy from a feature branch. Merge the feature branch into
the repo's main branch FIRST, then deploy from that main branch. Deploys are MANUAL docker
build/push + kubectl set image (CI is broken on GitHub billing). Maven is at:
  ~/scoop/apps/maven/current/bin/mvn

=====================================================================================
TASK 1 - gero-sync relay: build additively, merge to main, deploy.  (repo: d:/GeroRepos/gitRepos/gero-sync)
=====================================================================================
PRE-FLIGHT (do these first; both are verified blockers):
  1. Confirm Docker is up: `docker info` must return a server version. If it fails with
     npipe dockerDesktopLinuxEngine, STOP and tell Adam to start Docker Desktop.
  2. `git fetch origin` then `git checkout development` then `git pull --ff-only origin development`.
     Local development is ~30 commits BEHIND origin and DIRTY with UNRELATED Midnight resume-cursor
     edits (WalletSyncHandler.java, ClientSession.java, SubscribeMessage.java, SyncPayload.java,
     MidnightUnshieldedTxSubscriber.java). `git stash` those before pulling. DO NOT ship them.

BUILD (all additive; existing SYNC/onTip hot path untouched). On a NEW feature branch off development:
  - NEW  src/main/java/io/gerowallet/sync/crossdevice/DeviceInfo.java
      Lombok @Data @Builder DTO: { deviceId, label, platform, pubKey, hasSigningKey } + volatile long lastSeen.
      CRITICAL: do NOT annotate @JsonNaming(SnakeCaseStrategy). Wire fields are camelCase
      (deviceId, pubKey, hasSigningKey). The global ObjectMapper defaults to camelCase; snake_case
      is opt-in per class (see SyncPayload.java:13). A bare DTO serializes to the contract correctly.
  - NEW  src/main/java/io/gerowallet/sync/crossdevice/DeviceRegistry.java
      @Component, in-memory ConcurrentHashMap<stakeKey, Map<deviceId, DeviceInfo>>; mirrors AddressRegistry.
      stakeKey = network.toLowerCase() + ":" + monitorAddress. Methods: upsert(stakeKey, DeviceInfo),
      Collection<DeviceInfo> snapshot(stakeKey).
  - EDIT src/main/java/io/gerowallet/sync/websocket/WalletSyncHandler.java  (ONLY existing file changed)
      * Inject DeviceRegistry via constructor (near :42-54).
      * Add switch arms at :96-100:
            case "DEVICE_REGISTER" -> handleDeviceRegister(session, node);
            case "SIGN_REQUEST", "SIGN_RESPONSE" -> relayToSiblings(session, node);
      * handleDeviceRegister: recover ClientSession via registry.getBySessionId(session.getId())
        (same pattern as handleSyncCheck :121); build DeviceInfo from node.path("...").asText();
        deviceRegistry.upsert(stakeKey, d); sendToSession(session, DEVICE_REGISTER_ACK); then broadcastDevices(cs).
      * broadcastDevices(origin): build Map.of("type","DEVICES","devices", snapshot(stakeKey)); iterate
        registry.getSessionsByNetworkAndAddress(origin.getNetworkId(), origin.getMonitorAddress())
        (AddressRegistry:110) and sendToSession(sib.getSession(), snapshot) to each.
      * relayToSiblings(session, frame): recover ClientSession; iterate the same sibling set; SKIP the
        sender's own session.getId(); sendToSession(sib.getSession(), frame) with the RAW JsonNode
        verbatim (byte-parity; server must not inspect payload beyond routing, contract 5.3).
      * Call broadcastDevices(clientSession) at the end of handleSubscribe (:117) so a new device gets
        the current DEVICES snapshot on connect.
      DO NOT touch AddressRegistry, SyncDispatcher, CatchUpService, SubscribeMessage, ClientSession,
      chain-sync code, or WebSocketConfig. sendToSession is already public (:169), handles gzip + open-check.

BUILD DONE-CHECK: ~/scoop/apps/maven/current/bin/mvn -B clean package -DskipTests  → produces target/gero-sync.jar

DEPLOY (merge to main first, then deploy from main):
  - git checkout development; git merge --no-ff <relay-feature-branch>.
  - Bump pom.xml <version> 0.1.34 -> 0.1.35 (image tag must match).
  - Registry is in-cluster HARBOR (docker already authed). Ignore stale k8s/dev (GCR v0.1.30) and
    dead k8s/prod (DockerHub). Live pod today = registry.gerowallet.io/gero/gero-sync:gero-sync-dev-v0.1.34.
        VERSION=$(~/scoop/apps/maven/current/bin/mvn -q help:evaluate -Dexpression=project.version -DforceStdout)
        IMAGE=registry.gerowallet.io/gero/gero-sync:gero-sync-dev-v${VERSION}
        docker build --platform=linux/amd64 -t "$IMAGE" .
        docker push "$IMAGE"        # MUST succeed before the next step
  - *** STOP / CONFIRM GATE (PROD) ***  sync.gerowallet.io resolves to the ONE live relay:
    GKE cluster gero, namespace `gero`, deployment `gero-sync`, container `gero-sync`, port 8082.
    There is NO separate dev cluster. This "dev" endpoint IS the phone's production endpoint.
    The change is safe (additive + dark behind flag), but you MUST STOP and get Adam's explicit
    confirmation BEFORE running `kubectl set image`. Never set image before docker push succeeds
    (missing Harbor tag -> ImagePullBackOff).
  - After confirmation:
        kubectl -n gero set image deployment/gero-sync gero-sync="$IMAGE"
        kubectl -n gero rollout status deployment/gero-sync --timeout=8m
  DEPLOY DONE-CHECK:
        kubectl -n gero get pods -l app=gero-sync            # new tag, Running
        curl -s -o /dev/null -w '%{http_code}\n' https://sync.gerowallet.io/actuator/health   # expect 200
  ROLLBACK if wedged: kubectl -n gero rollout undo deployment/gero-sync

=====================================================================================
TASK 2 - extension "Sign on another device" Send integration.  (repo: d:/GeroRepos/gitRepos/gerowallet, branch: feat/copilot-agent)
=====================================================================================
All flag-gated behind featureFlagsStore.isCrossDeviceSigningEnabled() (featureFlagsStore.ts:184). Additive only.
  - src/services/walletManager.service.ts: add getCrossDeviceSigning() { return this.crossDevice?.signing ?? null; } near :876.
  - src/models/MessageTypes.ts: add REQUEST_CROSS_DEVICE_SIGNATURE = 'REQUEST_CROSS_DEVICE_SIGNATURE'.
  - src/chrome/background.ts: add app.addToOptions(MessageTypes.REQUEST_CROSS_DEVICE_SIGNATURE, async handler)
    modeled on the SIGN_TX handler (:1678). It calls walletManager.getCrossDeviceSigning().requestSignature(
    { unsignedCbor, intent, stakeAddress, ttlMs }) and sendResponse the SignDecision
    ({ decision: 'approved'|'rejected', witnessSetCbor?, reason? }); return true. On error, respond
    { decision: 'rejected', reason: <msg> }.  Optional: in the existing SUBMIT_TX handler (:2130-2151),
    add a belt-and-suspenders assert that Serialization.Transaction.fromCbor(txCbor).body().hash() is
    unchanged before vs after applying the witness, and throw on mismatch.  DO NOT add new witness-apply
    code: SUBMIT_TX already merges an external VKey witness set into the same decoded tx without touching
    body bytes (:2130-2151).
  - src/sidepanel/components/flows/SendSheet.vue: add flag-gated computed canSignOnAnotherDevice (near :630),
    a button in the STEP 4 confirm block (near :398), and signOnAnotherDevice() that:
        txCbor.value = serializeCardanoJsSdkTx(tx.value)   // the ORIGINAL unsigned tx
        sends REQUEST_CROSS_DEVICE_SIGNATURE via Messaging.sendToBackgroundFromOptions with
          data { unsignedCbor: txCbor.value, intent: `Send ${adaAmount} ADA`,
                 stakeAddress: loggedWallet.value.stakeAddress, ttlMs: 180000 }
        on decision==='approved' && witnessSetCbor: set txWitnesses.value = witnessSetCbor and call the
        EXISTING submitSignedTx() (:1224). On 'expired'/'rejected' show the i18n error.
  - src/modules/dashboard/dialogs/SendDialog.vue + src/shared/composables/useTransactionSigning.ts:
    add signOnAnotherDevice() to the composable reusing existing txCbor/txWitnesses/submitTx (:130,:158,:347);
    export it; wire a flag-gated button at the confirm CTA (SendDialog.vue:202).
  - i18n: add crossDevice.signOnAnotherDevice, crossDevice.requestExpired, crossDevice.requestRejected to
    BOTH src/plugins/i18n/us.ts AND src/plugins/i18n/de.ts (project rule: keep both in sync; search for an
    existing equivalent key before creating a new one).
  Use ttlMs 180000 for the first live run (default 60s is too tight for manual approval).

=====================================================================================
TASK 3 - Fallback A local harness (fully testable TODAY, no phone/Mac/relay).  (repo gerowallet, branch feat/copilot-agent)
=====================================================================================
Do this AFTER Task 2 (it reuses the button + REQUEST_CROSS_DEVICE_SIGNATURE message). Dev-gated.
  - NEW src/services/crossDevice/broadcastChannelTransport.ts implementing the SAME
    Transport { send, onMessage } interface as wsTransport.ts (crossDeviceSigning.service.ts:19-22),
    backed by new BroadcastChannel('gero-xdev'). Drops in as a swap for createWsTransport().
  - Local DEVICES exchange: on the channel, each window broadcasts its own DEVICE_REGISTER; each window
    builds a local DevicesSnapshot from what it hears and feeds it through the EXISTING applyDevicesSnapshot
    (deviceRegistry.ts) so resolvePubKey returns non-null and the real ed25519 verify path runs.
  - NEW minimal Vue approver view: calls signing.onSignRequest(handler), decodes unsignedCbor, shows
    amount/recipient, calls respond({ decision, witnessSetCbor }). (This mirrors the iOS approver's job.)
  - Dev requester trigger: reuse the Task-2 "Sign on another device" button (or a devtools entry) to call
    requestSignature(...) with a real unsigned preprod tx.

=====================================================================================
TASK 4 - flags + verify.
=====================================================================================
  - Flag: isCrossDeviceSigningEnabled (featureFlagsStore.ts:184), served by the self-hosted flag service.
    Enable it for the test account only. It gates the Send button + cross-device bootstrap.
  - Extension build done-check: cd d:/GeroRepos/gitRepos/gerowallet && npm run build  (must succeed).
    typecheck is chronically red project-wide; judge by DELTA, gate on `npm run build`.
  - Local two-window verify (Fallback A): open two extension windows on the same preprod wallet;
    window A starts a Send and clicks "Sign on another device"; window B (approver view) approves;
    A applies the witness via SUBMIT_TX and submits to preprod. SUCCESS = a preprod tx hash returned,
    signed by the OTHER window through the ratified protocol, body hash unchanged.

=====================================================================================
REPORT (end of sitting) - output crisply:
=====================================================================================
  1. gero-sync: branch merged to development? image tag pushed to Harbor? kubectl set image done (Y/N,
     and whether Adam confirmed the PROD gate)? actuator/health 200? Include the exact IMAGE tag.
  2. Extension: files changed, `npm run build` result, flag state.
  3. Fallback A: two-window test result + preprod tx hash if achieved.
  4. WHAT ADAM MUST STILL DO BY HAND (Mac-only, cannot be delegated): build the iOS approver onto the
     phone from branch claude/affectionate-leakey-c15cb7 (recover/push it first; it is NOT on origin),
     optionally edit gero-ios/Resources/Config.swift:46 wsURL if a non-prod relay is wanted, xcodegen
     generate, signing team JGK42C65U9, Cmd+R to device or Archive -> TestFlight. This is the ONLY
     remaining step for a REAL-phone end-to-end test.

CONSTRAINTS RECAP: additive + flag-gated everywhere; deploy from main not feature branch; docker push
before kubectl set image; STOP for Adam before any PROD image change; no iOS/Xcode work.
```