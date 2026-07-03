# iOS task: port the remote-signing trust layer (P0, security-blocking)

**Date:** 2026-07-03
**For:** the iOS agent (gero-ios, Xcode, on-device)
**Priority:** P0. This is a confirmed HIGH-severity gap from the 3-surface security review. **Do not let `isCrossDeviceSigningEnabled` reach an App Store / TestFlight build until this ships.**

## The problem (confirmed against your code + a shipped test)
The desktop hardening (extension PR #742) is **desktop-only**. Today the iOS approver:
- attaches unconditionally, gated only by the server flag (`WalletSyncService.swift:51` → `attach()`; `CrossDeviceSigningService.isRelayEnabled` → `FeatureFlagService.isCrossDeviceSigningEnabled`),
- verifies an inbound `SIGN_REQUEST` **only** against the pubkey the relay's `DEVICES` snapshot lists for that `deviceId` (`CrossDeviceSigningService.swift:139-142`), with **no user-pinned key, no opt-in, no pairing**.

Because `DEVICE_REGISTER` is unsigned trust-on-first-use keyed on the **public** stake address, anyone who knows it can register their own Ed25519 key, sign a `SIGN_REQUEST` that sends the victim's funds to the attacker, and the phone will decode it, present a Face ID sheet (with an attacker-spoofable device label), and, on approval, hand back a valid witness. Your own `gero-iosTests/CrossDeviceRelayTests.swift:472-507` already demonstrates an attacker key producing a `pending` sheet labeled `Adam's MBP`. The desktop's fail-closed pin does not help, because the phone never consults a pin. **The phone currently sets the security bar and it has none.**

## What to build (mirror the extension's model exactly)
The extension source of truth is `gerowallet/src/services/crossDevice/crossDeviceTrust.ts`. Port its semantics:

1. **Per-wallet opt-in** (`RemoteSigningSettings.enabled`, default **false**). The bridge must not present anything for a wallet the user has not enabled remote signing on. Persist per wallet.

2. **Persisted trusted-device store**, pinned by `(deviceId, pubKey)`. Default posture: **pairing-required** (nothing trusted until the user pairs). Persist across launches (Keychain or an encrypted store; you already persist the device identity in Keychain).

3. **Fail-closed `isRequesterTrusted` gate in `handleSignRequest`** — drop **silently, BEFORE CBOR decode**, any request whose sender `deviceId` is not pinned, or whose live pubkey != the pinned pubkey. This must sit ahead of the existing signature/decode/screening steps. Semantics identical to the extension `isDeviceTrusted`:
   ```
   trusted(deviceId, livePubKey) == pinned[deviceId] exists AND pinned[deviceId].pubKey == livePubKey
   ```
   Verify the request signature against the **pinned** key, not the relay-supplied key, for a pinned device.

4. **id↔key binding check at pin time (fail-closed)**: refuse to pin unless `deviceIdFromPubKey(pubKey) == deviceId`. This stops a relay that lists an attacker keypair under a plausible label from being pinned.

5. **SAS pairing flow with explicit confirmation**: show the peer's pairing fingerprint, require the user to actively confirm it matches the code shown on the desktop **before** the device is pinned. Do not auto-pin from the registry list.

## Byte-exact shared algorithms (MUST match the extension or the codes/ids won't line up)
Both derived from `SHA-256` of the **raw pubkey bytes** (decode the hex pubkey to bytes first).

**Pairing fingerprint** (the human-comparable SAS code) — `crossDeviceTrust.ts:pairingFingerprint`:
```
digest = SHA256( bytesFromHex(pubKeyHex) )        // 32 bytes
first6 = digest[0..<6]                             // 6 bytes
hex    = uppercaseHex(first6)                      // 12 chars
code   = hex[0..<4] + "-" + hex[4..<8] + "-" + hex[8..<12]   // e.g. "3F2A-9C71-08BD"
```

**Device id** — `deviceIdentity.ts:deviceIdFromPubKey`:
```
digest   = SHA256( bytesFromHex(pubKeyHex) )
deviceId = lowercaseHex( digest[0..<16] )         // 32 lowercase hex chars
```
Add a conformance test with a fixed pubkey and assert both against the value the extension produces (I can hand you a pinned vector if useful).

## UI requirements
A **Remote signing** screen in Settings (Cardano software wallets), gated behind the app's existing biometric/lock:
- **Master enable** toggle (per wallet).
- **This device**: its label + its own pairing fingerprint (so the desktop user can compare).
- **Devices** list: each detected sibling with label, platform icon, pairing fingerprint, and a **Pair** / **Untrust** action. A newly-seen device shows as "untrusted — needs pairing".
- **Pairing sheet**: shows the peer fingerprint large, copy like "Compare this code with the one shown on your other device, then confirm", and a blocking **"Codes match, pair"** button + Cancel. Pin only on confirm.
- **Approval sheet changes**: show the **paired device label** and a "trusted" indicator; and (already true, keep it) render amounts you decoded from the CBOR, never the `intent` hint. If a request arrives from an unpinned sender, it must never reach this sheet (dropped at gate 3).
- Copy must state the honest boundary: this is an approval policy on a device that holds the same wallet key, not multisig.

Match the app's existing visual system (this is a settings + confirmation surface, not a marketing screen): system fonts, the app's accent color, standard grouped-list styling, SF Symbols for platform icons, respect Dynamic Type and dark mode. The pairing code should be a monospaced, large, high-contrast string that is easy to read aloud.

## Tests + gate
- Add a test asserting an **unpinned** sender's `SIGN_REQUEST` is dropped before decode (invert the existing `CrossDeviceRelayTests` attack test: with no pin, no `pending` sheet).
- Add the fingerprint/deviceId conformance vector test.
- **Ship gate:** the flag stays off for any distributed build until 1-5 above are in and tested. Coordinate with me before enabling.

## Related, cross-repo (not blocking this task, but the root cause)
The deeper fix for the TOFU join is an **authenticated `DEVICE_REGISTER`** (each device signs its relay-auth pubkey with the wallet key; siblings verify it against the stake address before offering to pair). Your explicit-pairing flow above is safe to ship before it.

### Authenticated DEVICE_REGISTER — now specced (do after the trust layer above)
Full contract: **`docs/plans/2026-07-03-authenticated-device-register-contract.md`** (read the Verifier section in full). Relay passthrough is shipped (gero-sync #14). The iOS work:

1. **Wire (additive):** add optional `proof: DeviceRegisterProof?` to `DeviceRegister` (Encodable) and the inbound `Device` (Decodable, `decodeIfPresent`). `struct DeviceRegisterProof: Codable { let coseSign1: String; let coseKey: String; let stakeAddress: String }` — camelCase, byte-identical to extension + Java.
2. **Produce (new crypto):** iOS has no CIP-8/COSE_Sign1 signer today (`cip30WitnessSet` is a tx-witness signer, not a message signer). Add a CSLKit COSE_Sign1 builder: protected header `alg=EdDSA` + the signer **reward-address** bytes under BOTH `key_id` and the custom `address` text label; `COSE_Key` with `x = wallet stake pubkey`, `kid = address bytes`. Sign the subject `gero-xdev/v1|DEVICE_REGISTER|<deviceId>|<relayPubKeyHex>|<stakeAddress>` (utf8 → payload) with the wallet's **STAKE (reward) key**. **Invariant: always the reward address, never a baseAddress fallback** — a base-addr header forces a divergent verify path.
3. **Verify (new crypto), FAIL-CLOSED:** decode COSE, gate framing (`alg==EdDSA`, `kty==OKP`, `crv==Ed25519`, `x` is 32 bytes, header `address`==`key_id`), extract the reward address, require it == the phone's own reward address and == `proof.stakeAddress`, then the **mandatory key-binding: `blake2b224(COSE_Key.x) == the 28-byte stake key-hash of the header reward address`** (this is the whole security; iOS has no address→stake-credential binding today — add one), Ed25519-verify via the reconstructed `Sig_structure`, and re-derive+match the subject. Gate the Pair button on all of it.
4. **HexBlob→bytes:** decode the address to REAL bytes before the COSE header (same class of bug as the Strike 401).
5. **Conformance vector FIRST:** before coding, pin a shared `(stakeAddress, relayPubKeyHex, deviceId) → subject → exact coseSign1 hex + coseKey hex` vector in both suites. If the COSE hex doesn't reproduce identically in Swift and TS, interop silently 401s. I'll produce the extension-side vector from the real signer and send it.
6. **Wallet types:** v1 supports Normal + PRF; **hardware wallets are excluded** (can't sign a COSE in the background — degrade to unverified/unpairable); enterprise/no-stake wallets excluded. Branch on wallet type in both producer and verifier.

Required (fail-closed) from day one since the feature is dark with no legacy pairings. Same-wallet replay stays open in v1 (a server-nonce CHALLENGE frame is the follow-up); it is not forgeable across wallets and is useless without the relay-auth privkey.
