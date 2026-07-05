# iOS diagnostic brief: SIGN_REQUEST reaches the phone but is silently dropped

**Date:** 2026-07-02
**For:** the iOS agent (has gero-ios + Xcode + on-device debugging)
**From:** the extension/relay side (desktop path fully verified working)

## One-line ask
The desktop's `SIGN_REQUEST` physically reaches the phone (relay confirms the fan-out), but no approval sheet appears and no response goes back. `CrossDeviceSigningService.handleSignRequest` drops it at one of its **silent** gates. Instrument those gates, reproduce on-device, and tell us exactly which gate fires and with what values.

## What is already CONFIRMED working (do not re-investigate)
- Desktop builds the tx, signs and sends `SIGN_REQUEST`. The relay logged: `Cross-device relay: SIGN_REQUEST -> 2 sibling(s) for stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5`. So the frame reached the phone.
- Pairing is live: the desktop's registry reached **2 devices** (it sees the phone), and the relay's `DEVICES` field names (`deviceId`, `label`, `platform`, `pubKey`, `hasSigningKey`, all camelCase) match the iOS `Device` decoder. `pubKey` decodes fine.
- Subject construction is byte-identical to the desktop: `gero-xdev/v1|SIGN_REQUEST|reqId|nonce|from|stakeAddress?""|expiresAt|blake2b256hex(cbor)`, joined by `|`, utf8, Ed25519. Verified against `CrossDeviceWire.signRequestSubject`.
- So this is a **runtime drop in `handleSignRequest`**, not a wire-shape or subject-format bug.

## The desktop side of the contract (for parity checks)
- Desktop generates a **fresh deviceId + Ed25519 keypair every login**. This run's desktop deviceId = `43b3bdea2e0acf1923ddf17b90679f66`. So the phone's `knownDevices` must contain **that exact id** at request time; a stale snapshot from before the desktop's current login would not.
- `SIGN_REQUEST` fields the desktop sends: `reqId`, `nonce`, `from` = the deviceId string (`43b3bdea…`), `stakeAddress` = bech32 `stake1u86ndjr6s9vpkpzdtu4fdzlznj4gnx9cet2fcekjuuudntgjprfc5`, `unsignedCbor` = hex, `intent` = string, `expiresAt` = **unix seconds** (`Math.floor(now/1000)+ceil(ttlMs/1000)`, ttl 180s), `sig` = hex Ed25519 over the subject.
- Network: **MAINNET** with **real funds** (first E2E is a small self-send).

## The silent-drop gates to instrument (gero-ios `Services/CrossDevice/CrossDeviceSigningService.swift`, on `origin/main`)
Add an `os_log`/`print` at each of these returns. Everything from the "busy" check (~line 159) onward already sends an explicit `SIGN_RESPONSE(rejected, reason:)`, so if the desktop is stuck "loading" with no response, the drop is **above** that line:

- `process()` ~112-126: log `frameType`; for `DEVICES` log `snapshot.devices.count` and the decoded `deviceId`s; for `SIGN_REQUEST` log `request.fromDeviceId`.
- ~135 self-echo: `request.fromDeviceId == identity.deviceId`.
- **~139-142 (top suspect): sender resolution + verify.** Log `knownDevices.keys`, `request.fromDeviceId`, whether `knownDevices[fromDeviceId]` exists, whether `sender.pubKey != nil`, and the `verifySignRequest(...)` Bool separately.
- ~150-152 TTL: log `now`, `request.expiresAt`, `expiresAt - now`.
- **~154 (second suspect): stakeAddress match.** Log `request.stakeAddress` and `ourStake` (`wallet.stakeAddress ?? wallet.baseAddress`) side by side. Confirm the phone's `wallet.stakeAddress` is the same bech32 `stake1…` the desktop sends, not `nil`/`addr1…`/hex.
- ~201/~206/~202 replay + cancellation guards.

## Ranked hypotheses
1. **`knownDevices` does not contain `43b3bdea…`** (fresh-per-login deviceId + a stale or not-yet-updated snapshot on the phone) → drop at 139. Check: does the phone actually receive and apply a `DEVICES` update when the desktop registers, or is its registry stale from an earlier connect?
2. **`stakeAddress` mismatch at 154** — desktop sends bech32 `stake1u86n…`; if the phone's `wallet.stakeAddress` is nil (falls back to `baseAddress`) or a different representation, `target != ourStake` drops it.
3. **`verifySignRequest` returns false** despite matching subject (a crypto/hex-case gap in `CIP30Crypto.blake2b256`/`hexString`/`verify` on the real message).
4. TTL / clock skew (least likely; both use unix seconds).

## Reproduction constraint (important)
The phone must be on **MAINNET** to pair with the mainnet desktop (Debug build = preprod and will not share a stake key). Run a **Release/mainnet build attached to Xcode** (custom scheme with Run using Release), or temporarily point the Debug build at mainnet, so you get live logs while still pairing. Steps: desktop reloaded + logged in, phone app foregrounded on the same mainnet wallet, then desktop Send -> "Sign on another device".

## What to report back
The exact gate that fired and its logged values (especially: is `43b3bdea…` in `knownDevices`? does `verifySignRequest` return true/false? do `request.stakeAddress` and `ourStake` match?). That tells us whether the fix is iOS-side or desktop-side, and we will coordinate it. If it is gate 139 due to a stale snapshot, also note whether a fresh `DEVICES` arrives when the desktop re-registers.
