# QR pairing — desktop implementation plan + security contract

**Date:** 2026-07-04
**Status:** designed + adversarially verified (10-agent workflow; **0 security breaks** across 4 lenses). iOS UX + iOS contract: `docs/handoff/2026-07-04-ios-qr-pairing-ux.md`.

## Summary
Desktop shows a QR in Remote Signing settings → phone scans it → **both devices paired in one scan**, no SAS fingerprint compare. Reuses everything already shipped (relay-auth keys, the wallet-control proof + `verifyDeviceRegisterProof`, the pinning reducers, the `qr-code-styling` renderer, the to-targeted relay path). Additive + flag-gated; the SAS path stays untouched as fallback.

## Security contract (the boundary — get it exactly right)

### QR payload (desktop mints + renders)
```
{ v:"gero-xdev-pair/v1", deviceId, pubKey, stake:<bech32 reward addr>,
  proof:{coseSign1,coseKey,stakeAddress}, nonce:<16B CSPRNG hex>, exp:<unix s> }
```
`deviceId`/`pubKey` from `crossDeviceIdentity`; `proof` = the already-cached `crossDeviceProof`; `nonce`/`exp` minted per render. The out-of-band load-bearing bits are **pubKey + nonce** — the phone reads the exact key off the glass, so a relay can't substitute it. ~1.0–1.5 KB with the proof embedded → render at **EC level 'M'** (not ReceiveDialog's 'Q'), ~240–260px, trim the center logo. **Validate the encode against a real `signData` proof before locking**; fall back to `base64url(deflate(payload))` or carrying the proof via the DEVICES snapshot if it overruns (security identical — the pubKey+nonce are what the scan secures).

### `PAIR_CONFIRM` frame (phone → desktop, over the relay)
Signed subject (byte-for-byte with Swift, **canonical — matches the iOS handoff + the `envelope.ts` golden vector**): `gero-xdev/v1|PAIR_CONFIRM|<from>|<pubKey>|<to>|<nonce>|<stakeAddress>` — signed by the phone relay-auth key. Carries the phone's own `proof`. **`to` is bound in the subject** (cross-desktop replay protection; deviation from `SIGN_*` — document it, don't copy back). Field order is pinned by `src/services/crossDevice/envelope.spec.ts` (`buildSubject PAIR_CONFIRM` vector); iOS must reproduce it exactly.

### Nonce (single-use, MV3-durable)
16-byte CSPRNG, `exp = now + 180s` (> the ~42s MV3 worker recycle). Persist `{nonce → {exp, used}}` in **`chrome.storage.local`** (in-memory would drop mid-pair on a worker recycle). On a valid `PAIR_CONFIRM`, **atomic compare-and-set `used:false→true` before pinning**. Prune expired on each mint.

### Verify + pin on `PAIR_CONFIRM` (`walletManager.handlePairConfirm`, fail-closed)
1. Guard: feature+enabled, Cardano, `stakeAddress` present.
2. **Nonce:** `pairingNonceStore.consume(frame.nonce)` — present && `!used` && `exp>now` && `boundStake==ownStake`; mark used. Else reject.
3. **Proof:** `verifyDeviceRegisterProof(frame.proof, {deviceId:frame.from, pubKey:frame.pubKey}, this.walletBg.stakeAddress)` — **unchanged verifier**. This one call enforces same-wallet (proof.stake==ownStake, signer addr==ownStake, subject re-derived with **ownStake**), binds `frame.pubKey` ↔ wallet key-hash, and binds `frame.from`. **Pass `ownStake`, never `frame.proof.stakeAddress`** (that would make the wallet-binding a tautology — the one implementation slip the review says would break it).
4. **Pin:** `trustAddDevice({deviceId:frame.from, pubKey:frame.pubKey, label, platform, verified:true})` + persist. `verified:true` lights the green badge. **Skip `isDeviceIdConsistent`** (iOS deviceId is a UUID; the proof already authenticates the triple).
5. Set `lastPairedDevice` for the UI poll.

### 🔒 The QR path must hard-require the proof
`REQUIRE_PROOF_TO_PAIR` gates the *SAS* path (`trustCrossDevice`). The QR path uses a **new frame-pin entry point** and is fully unattended on the desktop, so it must require a valid proof **unconditionally** — never read the flag. Add a conformance test: a null/mismatched-payload proof is rejected even with the flag `false`.

## Adversarial verification (all 4 lenses held, 0 breaks)
- **Photographed-QR replay** — holds. The QR is a public wallet-signed artifact; pairing needs *both* a relay-auth private key *and* a wallet-signed proof. A photographer has neither; a captured `PAIR_CONFIRM` only re-pins the legit phone; single-use + TTL kills replay.
- **Relay-forged `PAIR_CONFIRM`** — holds. Acceptance needs two proofs-of-possession binding the *same* pubKey; the relay holds neither key. Security is anchored in the embedded wallet proof, not the (relay-forgeable) frame signature — so pin **only after `verifyDeviceRegisterProof` passes**.
- **Wrong-wallet / MITM** — holds. Proof verified against each device's **own** stake on both sides; a relay-MITM can't mint a proof binding its key to the desktop's stake key-hash.
- **UX-safety fail-closed** (the closest call, medium) — holds. A false "Paired" is possible if the desktop wasn't registered (its `PAIR_CONFIRM` is dropped), but it's **not** a bypass: the desktop rejects the phone's `SIGN_RESPONSE` (never pinned) so the send fails closed. Fix = don't celebrate optimistically; use `PAIR_ACK`.

## Files to touch (extension)
- `protocol.ts` — `PAIR_CONFIRM` type + `PairConfirm` interface + guard + parse case.
- `envelope.ts` — `PAIR_CONFIRM` `buildSubject` branch + `signPairConfirm`/`verifyPairConfirmSig` (leave `SIGN_*` intact).
- `crossDeviceSigning.service.ts` — `PAIR_CONFIRM` branch in `handleInbound` verifying against **`frame.pubKey`** (not `resolvePubKey` — the phone isn't in the snapshot yet), **ungated by `isRequesterTrusted`**; new `onPairConfirm` dep.
- `crossDeviceBootstrap.ts` — thread `onPairConfirm` through opts.
- **NEW** `pairingNonceStore.ts` — mint/consume/prune single-use TTL nonces in `chrome.storage.local`.
- `walletManager.service.ts` — `buildPairingQrPayload()`, `handlePairConfirm(frame)`, `getPairingStatus()` + `lastPairedDevice`; wire `onPairConfirm` at both bootstrap sites.
- `websocket.service.ts` — add `'PAIR_CONFIRM'` to `CROSS_DEVICE_MESSAGE_TYPES` (**critical** or the frame is dropped as "unknown type").
- `MessageTypes.ts` — `GET_PAIRING_QR`, `GET_PAIRING_STATUS`.
- `background.ts` — handlers (clone `PRODUCE_DEVICE_REGISTER_PROOF`).
- `remoteSigningStore.ts` — `getPairingQr()` + `getPairingStatus()` wrappers.
- `RemoteSigningDialog.vue` — "Pair a phone" button (above the detected-devices header) + a QR sub-dialog modeled on the SAS confirm sub-dialog, reusing `QRCodeStyling` (as `ReceiveDialog.vue`), with a 1s `GET_PAIRING_STATUS` poll driving waiting→paired→expired + a success morph. Keep the SAS sub-dialog untouched.
- `i18n/us.ts` + `de.ts` — `crossDevice.pair.*` keys (both files).
- Tests: envelope subject golden vector (shared with iOS), protocol guard/parse, `pairingNonceStore` lifecycle, `handlePairConfirm` accept/reject matrix, service sig-verify + ungated-by-trust.

## Relay (gero-sync — ONE line)
`WalletSyncHandler.java`: `case "SIGN_REQUEST", "SIGN_RESPONSE", "PAIR_CONFIRM" -> relayToSiblings(...)`. Reuses to-targeting + verbatim forward whole. No DTO/store change; offline-wake already excludes non-`SIGN_REQUEST`, so `PAIR_CONFIRM` stays wake-free. Merge to `development` (deploys) — backward-compatible (unknown types still dropped).

## Desktop UX (the settings side)
A "Pair a phone" primary button (cyan `#00DFF3`, `mdi-qrcode-scan`) at the top of the devices section, gated on `isCrossDeviceSigningEnabled && hasProof && !isHardwareWallet && wsConnected` (no proof yet → route through the existing enable-time auth → `produceProof` first). The QR sub-dialog: QR on a white tile, a faint expiry countdown, and a live `pairState` (`waiting → paired → expired`):
- **waiting** — soft cyan pulsing ring + shimmer scan-line over the QR, "Waiting for your phone…".
- **paired** — the QR tile morphs (scale+opacity) into a large cyan `mdi-shield-check` seal with a glow burst, "Paired with {label}", and the newly pinned phone appears in the list below with the **green wallet-verified badge**. Auto-dismiss ~2s or "Done"; "Pair another" re-mints.
- **expired** — "Code expired" + "Show new code".

Poll `GET_PAIRING_STATUS` every ~1s while open (lighter sibling of the 3s device-list poll); on `paired`, stop, animate, `refreshDevices()`. Clear `lastPairedDevice` on read/close so a reopen never re-fires a stale success.

## Build sequence (each step shippable, behind the dark `isCrossDeviceSigningEnabled` gate)
- **Step 0 — protocol + relay parity (ships fully dark, no emitter):** `PAIR_CONFIRM` in `protocol.ts` + `envelope.ts` subject + `websocket.service` allowlist + the gero-sync one-liner. Golden subject vector (shared with iOS) + sign/verify round-trip + tamper reject. Merge relay to `development`.
- **Step 1 — nonce store + QR payload:** `pairingNonceStore` + `buildPairingQrPayload` + `GET_PAIRING_QR` + store wrapper. Tests: nonce uniqueness/consume-once/expiry/prune; payload shape.
- **Step 2 — inbound verify + auto-pin (security core, review gate):** the `PAIR_CONFIRM` service branch + `handlePairConfirm` + `GET_PAIRING_STATUS`. Table tests: valid→pinned `verified:true`; tampered sig→dropped at service; invalid/absent proof→not pinned; wrong-wallet→not pinned; unknown/expired/reused nonce→not pinned; never gated by `isRequesterTrusted`. **Delegate a security review here.**
- **Step 3 — desktop UI:** the "Pair a phone" affordance + QR sub-dialog + poll + success morph + i18n. **Validate real QR capacity with an actual `signData` proof before merge.**
- **Step 4 — interop flip:** with the iOS scanner + `PairConfirm` sender merged (and iOS's COSE-verify + pinned store in place), flip the flag for the dev user, do a real scan, confirm the phone lands with the green badge.
- **Step 5 (optional polish):** an unsigned `PAIR_SCANNED` hint for the desktop "scanned…" intermediate state + a `PAIR_ACK` so the phone shows its own confirmed success.

## Edge cases
Multiple phones (each nonce consumed independently; re-scan re-pins idempotently). Desktop-not-registered race (gate the button on `isConnected()`; desktop registers on socket open). No-proof wallet (hide the button; consistent with SAS under `REQUIRE_PROOF_TO_PAIR`). Broadcast leak (phone must set `to`; binding `to` in the subject means a rewritten `to` drops the frame). Cross-repo subject parity (pin the golden vector; the subject-version discipline).
