# iOS handoff — QR pairing: Apple-feel UX + security contract

**Date:** 2026-07-04
**From:** extension/relay side
**To:** iOS cross-device agent
**Status:** designed + adversarially verified (0 security breaks across 4 lenses). Desktop plan: `docs/plans/2026-07-04-qr-pairing-desktop-plan.md`.

## What we're building
Replace the manual pairing (open Remote Signing settings on *both* devices, compare a `XXXX-XXXX-XXXX` fingerprint, tap confirm on each) with: **the desktop shows a QR, the phone scans it, both devices are paired in ~2 seconds.** No hex to eyeball, no second confirm. The camera *is* the confirmation.

It's not just nicer, it's **stronger**: scanning is an out-of-band channel, so the phone pins the desktop's exact on-screen key and a malicious relay can't substitute it. The fail-closed proof verify becomes an invisible "Verifying" beat instead of a manual chore.

## North star (the feel)
> One scan, both devices paired in about two seconds, with the calm certainty of dropping AirPods next to your iPhone: point the camera, feel the code lock, watch a checkmark bloom.

It braids three Apple pairing flows: **AirPods Connect** (the soft bloom + settling checkmark), **Apple Watch pairing** (center-in-viewfinder → brief staged setup), and **AirDrop's** instant moment of recognition — all in Gero's existing dark Liquid Glass so it reads as a native Settings feature.

## The flow, tap → paired
1. **Settings → Connections → "Paired Devices"** (new row under Connected Apps, `laptopcomputer.and.iphone` glyph, gated on `isCrossDeviceSigningEnabled`). Push into `PairedDevicesView`.
2. **Hub** — glass rows of pinned peers (platform symbol + label + green `checkmark.seal.fill` "Paired" + relative date); pinned **"Pair a Device"** button. Empty state: hero `laptopcomputer.and.iphone` in a 96pt glass circle with a slow shine, "No Paired Devices" / "Pair your computer to approve its transactions from your iPhone."
3. **Tap "Pair a Device"** (`.light` haptic). Guard: if the wallet can't produce a proof (no stake key), show "This Wallet Can't Be Paired" — don't open the camera. Else present the scanner (`.fullScreenCover`).
4. **Scanner** — live camera over black, a 250×250 rounded viewfinder with cyan corner brackets *breathing* (`easeInOut(1.6).repeatForever`), a faint tilt-shine via `MotionManager`. Hint: "Point at the pairing code on your computer" / "On your computer: Settings, Remote Signing, Show code."
5. **THE LOCK** (moment of recognition) — on a valid pairing payload: freeze the preview, the four brackets **spring inward** to hug the code (`spring(response:0.35, damping:0.72)`), stroke animates white→cyan, a cyan glow blooms, **`Haptics.impact(.rigid, 0.9)`** fires the crisp snap, a cyan scanline sweeps down, "Code found" ghosts in ~0.3s.
6. **Verifying** — the locked square morphs into a centered glass card: `desktopcomputer` symbol in a glass circle ringed by an indeterminate cyan arc, "Verifying" with a shimmer, "Making sure it's really your wallet." Real work runs here (~0.6–1.2s): COSE proof verify fail-closed, pin the desktop, sign + send `PAIR_CONFIRM`.
7. **Paired** — the ring closes, a checkmark springs in (cyan→`systemGreen`), **`Haptics.success()`** at the apex, a cyan radial glow blooms (the AirPods "Connected" beat), cross-fade to the paired seal: "Paired" / "You can now approve transactions from your {DeviceName}." Optional staged "This iPhone" / "{DeviceName}" ticks resolve when the desktop's `PAIR_ACK` lands (degrade silently after ~4s). Auto-dismiss ~1.6s to the hub, where the new row springs in with a one-time cyan highlight.

**Total finger-time: ~2–3s, dominated by aiming the camera.**

## Every state (and recovery)
| State | Look | Recovery |
|---|---|---|
| scanning | breathing cyan viewfinder | endless until valid code / X |
| **not-a-pairing-QR** (address/URL) | amber frame pulse + "That's not a pairing code" + `.warning` haptic | **re-arms, never dismisses** (fix QRScannerView's dismiss-on-first-QR) |
| locked | brackets converged, cyan glow, rigid haptic | → verifying |
| verifying | glass card, indeterminate ring, shimmer | back-swipe aborts |
| **paired** | green checkmark bloom + seal, success haptic | auto-dismiss |
| expired | `clock.badge.exclamationmark`, "Code Expired" / "Show a fresh pairing code…" | "Scan Again" |
| **different wallet** (SECURITY stop) | `systemRed`, `xmark.seal.fill`, "Different Wallet" / "This computer is signed into a different Gero wallet…" | "OK" — nothing pinned |
| **couldn't verify** (proof fails) | `systemRed`, `exclamationmark.shield`, shake + `.warning`, "Couldn't Verify" / "…pairing was cancelled." | "Try Again" |
| camera denied | reuse `QRScannerView.permissionDeniedView` | "Open Settings" |
| can't reach computer (post-verify) | `systemOrange`, antenna-slash, "Can't Reach Your Computer" | "Try Again" / "Done" (accepts one-way pin) |
| already paired | brief seal, "Already paired with {DeviceName}", `.success` | warm no-op |

## Micro-interactions (the tactile beats)
- **Breathing viewfinder:** brackets loop scale 1.0→1.02, opacity 0.6→0.9, `easeInOut(1.6).repeatForever`.
- **QR-lock (hero):** freeze still → brackets `spring(0.35/0.72)` to the code rect → stroke white→cyan (0.2s) + `shadow(cyan.opacity(0.6), 16)` → **`.rigid` haptic** as they seat → 2pt cyan scanline sweep (0.4s). Gate the existing vibrate to *valid* locks only.
- **Verifying:** matched-geometry morph to a glass circle; `Circle().trim(0,0.22).stroke(cyan)` rotating `linear(0.9).repeatForever`; "Verifying" shimmer mask 1.1s loop.
- **Success:** ring completes → checkmark `spring(0.4/0.6)` cyan→green → **`.success` haptic** at apex → radial cyan bloom `easeOut(0.5)` → cross-fade to seal. `PAIR_ACK` tick = `.selection`.
- **Errors:** card shake 3× at 0.06s + `.warning`; ring/symbol snaps red/orange.

## Copy rules (verbatim strings in the spec)
Confident, minimal, **zero jargon** — the words "QR", "relay", "pubkey", "nonce", "proof", "SAS", "device ID" **never** appear on screen. "Verify" softens to "Making sure it's really your wallet." Buttons are verbs. No em dashes. (Full string table in the workflow output; mirror it exactly.)

## Visual (SwiftUI)
Reuse `Theme.swift`: `glassCard(cornerRadius: AppRadius.xl)`, `adaptiveGlassCircle(tint: AppColors.primary.opacity(0.18))`, `adaptiveGlassButtonStyle` / `PrimaryButtonStyle`; iOS 26 → real Liquid Glass, pre-26 → `.ultraThinMaterial` (degrades cleanly). `AppBackground()` behind cards, live camera over black. Colors map 1:1 to `CrossDeviceApprovalSheet`: **cyan `#00C7F3`** (scan/lock/verify), **green `#30D158`** (success/seal), **red `#FF453A`** (security stops), **orange `#FF9F0A`** (recoverable nudges). Dark-first only (the app is committed dark). Build `PairingScannerView` **on top of the existing `QRCameraPreview` UIKit bridge** — add only a phase state machine + a validation guard that re-arms on a non-pairing decode.

---

## Security contract (what iOS must implement, fail-closed)

### The `PAIR_CONFIRM` frame (phone → desktop, over the relay)
```
{ type:"PAIR_CONFIRM", from:<phone deviceId>, pubKey:<phone relay-auth Ed25519 hex>,
  to:<desktop deviceId from QR>, nonce:<echoed desktop nonce hex>,
  proof:{coseSign1,coseKey,stakeAddress}, label, platform:"ios", hasSigningKey:true,
  sig:<Ed25519 hex over the canonical subject> }
```
**Canonical signed subject (byte-for-byte identical to `envelope.ts`, pin a shared conformance vector):**
```
gero-xdev/v1|PAIR_CONFIRM|<from>|<pubKey>|<to>|<nonce>|<stakeAddress>
```
Signed with the phone's **relay-auth private key** (the same key that signs `SIGN_RESPONSE` — no new keypair). **Deliberate deviation from `SIGN_*`:** `to` is *inside* the signed subject here (binds the intended desktop so a captured confirm can't be replayed to another desktop). The top-level `to` is also present (unsigned) so the relay routes on it — same value. **Do not copy this into `SIGN_*`.**

### On scan (fail-closed — reject + re-present on ANY failure)
1. Parse; require `v=="gero-xdev-pair/v1"` + all fields. A non-pairing QR (address) → the amber re-arm, never a pin.
2. `exp > now`.
3. **Wallet scope:** `qr.stake == this phone's active wallet reward address` — reject a different wallet.
4. **Verify the wallet-control proof** (net-new on iOS): parse `COSE_Sign1`+`COSE_Key`; `x` is 32-byte Ed25519; signer reward addr `== ownStake`; `blake2b224(x) == stake key-hash` of that address; Ed25519 over the reconstructed `Sig_structure`; payload `== gero-xdev/v1|DEVICE_REGISTER|<qr.deviceId>|<qr.pubKey>|<ownStake>`. **Any failure → reject, no pin.**
5. **Only then pin** the desktop `(deviceId, pubKey, verified:true)` into a **persistent** trusted-peer store.
6. Sign + send `PAIR_CONFIRM` (top-level `to = qr.deviceId`) with the phone's own proof.

### 🚨 Two hard prerequisites before enabling the QR flag on iOS
The adversarial review flagged these as the only way iOS pairing becomes *weaker* than SAS:
1. **COSE verify + blake2b224 are net-new.** The shipped iOS branch only *produces* COSE (CardanoKitCrypto), CSLKit exposes no COSE parse/verify, and only blake2b256 is wrapped. Until fail-closed COSE_Sign1 verify + blake2b224 exist, the phone **cannot** verify the desktop's proof — pinning on scan without it is weaker than SAS. **Do not ship the flag before this lands.**
2. **No persistent pinned-peer store today** (only in-memory `knownDevices`, replaced per DEVICES snapshot). QR pairing **requires** a Keychain/UserDefaults pinned store that `SIGN_REQUEST` screening actually consults — else the pin evaporates on the next snapshot and a relay-substituted key gets re-accepted.

Structurally gate the flag behind the *presence* of both, so it's impossible to ship pin-on-scan-without-proof.

### Other must-honor invariants
- **Success only after real verify** — never render "Paired" optimistically. Show it after the proof verifies + the local pin commits (and ideally after `PAIR_ACK`); show "confirming on your other device…" until then, bounded ~4s, then degrade silently (the phone is already paired + usable).
- **Bind to pubKey, not deviceId** — the desktop's `deviceId` is `sha256(pubKey)[0:16]`; the phone's is a UUID. All trust binds to `pubKey` + proof; skip any `deviceId==sha256(pubKey)` check on the frame path.
- Add `'PAIR_CONFIRM'` to iOS `relayFrameTypes`; set top-level `to` always (a blank `to` broadcasts the phone's proof to all siblings).
- Order: SUBSCRIBE → DEVICE_REGISTER → PAIR_CONFIRM, so the phone is a live sibling for later `SIGN_REQUEST` to-targeting.

## Why a photographed QR is safe (for your peace of mind)
The QR is a **public, wallet-signed artifact** — leaking it grants a non-owner nothing. To get the desktop to pin them, an attacker needs *both* the relay-auth private key (to sign `PAIR_CONFIRM`) *and* a wallet-signed proof for their key (needs the wallet stake key). They have neither. A replay of a real confirm just re-pins the legit phone. Single-use + 120s TTL nonce closes the rest.
