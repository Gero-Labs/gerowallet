# Authenticated DEVICE_REGISTER — wire contract (v1)

**Date:** 2026-07-03
**Status:** design ratified by an adversarial review; relay passthrough shipped (gero-sync #14). Client crypto (extension + iOS) pending.
**Purpose:** close the trust-on-first-use gap. Today any party that knows a wallet's PUBLIC stake address can register a device on the relay under that wallet and appear in siblings' pairing lists. This binds each device's relay-auth key to the wallet by a CIP-8 signature that **sibling devices verify** (the relay stays untrusted).

> A first, naive version of this design was **forgeable** and was rejected in review. Read the **Verifier** section in full: the `blake2b224(COSE_Key.x) == address key-hash` step is mandatory and is the entire security of the scheme. Without it the proof is a self-signed nothing that anyone who knows the public stake address can mint.

## Wire field (additive, camelCase, no subject-version bump)
Add one optional field to `DeviceInfo` (rides onto `DEVICE_REGISTER` and each entry of the `DEVICES` snapshot):
```
proof?: {
  coseSign1:    string  // hex CBOR of COSE_Sign1  (the `signature` from signDataCip8)
  coseKey:      string  // hex CBOR of COSE_Key     (the `key` from signDataCip8)
  stakeAddress: string  // bech32 reward address (convenience; MUST equal the address inside coseSign1)
}
```
- Object, not colon-join (three named/typed fields for symmetric Swift/Java/TS decode).
- **Relay treats `proof` as opaque passthrough** — never parses, canonicalizes, hashes, or verifies it. (gero-sync #14 carries it as a `JsonNode` so the object shape is byte-stable.) No verifier ever hashes the JSON envelope; all trust is field-by-field on the decoded COSE.

## What is signed (the CIP-8 payload)
Domain-separated, pipe-joined UTF-8 string, same discipline as `envelope.ts buildSubject` (NO JSON canonicalization — Swift/JS JSON diverge):
```
subject = 'gero-xdev/v1|DEVICE_REGISTER|' + deviceId + '|' + relayAuthPubKeyHex + '|' + stakeAddress
```
- `deviceId` = the DEVICE_REGISTER deviceId (= `deviceIdFromPubKey(relayAuthPubKeyHex)`, sha256(pubkeyBytes)[0:16] hex).
- `relayAuthPubKeyHex` = the per-install Ed25519 **relay-auth** pubkey (`DeviceInfo.pubKey`), lowercase hex — **NOT** the wallet key.
- `stakeAddress` = this wallet's bech32 **reward** address.
- `payloadHex = utf8ToHex(subject)`. This is the COSE payload.
- Signed with the wallet's **STAKE (reward-account) key**, so the COSE protected header address IS the reward address (verify needs no base→stake derivation). **iOS MUST sign over the reward address, never a baseAddress fallback.**

Binding rationale: the subject binds relay-pubkey ↔ wallet ↔ deviceId, so a captured proof cannot be re-pointed to a different pubkey/device/wallet. It is **not** freshness-nonced in v1 (see Residuals).

## Producer
Extension: compute once at bootstrap/login in `walletManager` (the only site holding both `walletBg` and the relay identity), reusing `walletBg.signData(stakeAddress, payloadHex, ...)` — `signWith = reward addr` auto-selects the stake key and the HexBlob→Buffer fix applies for free. Re-send the same bytes on every reconnect (a durable pubkey↔wallet fact; do not re-sign per connect). PRF wallets: resolve `privateKeyBytes` at bootstrap as Strike onboarding does. Pass the finished proof object into the bootstrap → `publishDeviceRegister`.

iOS: build the COSE_Sign1 identically (see the iOS handoff), signing the same subject with the reward key.

## Verifier (identical on extension + iOS; relay never verifies) — FAIL-CLOSED
Given a peer `DeviceInfo` with `proof`, and the verifier's OWN wallet reward address `S`:
1. Decode `coseSign1 = COSE_Sign1.from_bytes(hex→bytes(proof.coseSign1))`, `coseKey = COSE_Key.from_bytes(hex→bytes(proof.coseKey))`.
2. **Generic over the COSE_Sign1 layout (decided 2026-07-03, iOS cross-check).** Extract the signer address from the protected header's `"address"` text label — the standard CIP-30 `signData` structure that every Cardano wallet emits (Lace, iOS/CardanoKit, and our own `walletBg.signData` via the Cardano SDK). `COSE_Key.x` must be exactly 32 bytes. `key_id` is OPTIONAL: standard CIP-30 does NOT put it in the protected header, so do NOT require it; if present it must equal the `"address"` bytes. Do not require a specific header field set — the signature (step 5) is verified over the message's OWN reconstructed `Sig_structure`, so any canonical `signData` interoperates. (An earlier draft required `key_id` and pinned a non-standard vector from a raw COSE helper; iOS proved the real producers emit the standard layout, so the verifier is generic and the vector is the standard iOS/Lace `coseSign1`.)
3. Decode the `"address"` bytes → `Cardano.Address` → reward/stake bech32 (reject a base-addr header for standard Cardano wallets). Require it **equals `S`** AND equals `proof.stakeAddress` (cross-check the convenience field, no trust).
4. **KEY-TO-ADDRESS BINDING (MANDATORY — the whole security):** compute `blake2b224(COSE_Key.x raw bytes)` and require it **equals the 28-byte stake key-hash** inside the header reward address (`RewardAddress.fromAddress(...).paymentCredential().hash`). Only this proves the signature made with `x` was made by the holder of the wallet's stake key. Without it, `x` and the header address are both attacker-supplied and unrelated.
5. Ed25519-verify: reconstruct `Sig_structure` via `coseSign1.signed_data().to_bytes()` (never hand-roll) and verify `coseSign1.signature()` against `COSE_Key.x`.
6. Re-derive `subject = 'gero-xdev/v1|DEVICE_REGISTER|' + device.deviceId + '|' + device.pubKey + '|' + S` and require `coseSign1.payload() == utf8ToHex(subject)` (binds the proof to THIS device's pubkey + id + the verifier's own wallet).
7. Require `isDeviceIdConsistent(device.deviceId, device.pubKey)` (existing check).

Pin/pair ONLY if 1–7 all pass. Any parse failure, framing violation, address mismatch, **key-hash mismatch**, signature failure, or subject mismatch ⇒ proof INVALID ⇒ device **unpairable** (the SAS confirm is a second human factor on top, not the primary boundary).

## Byte-parity gotchas (interop 401s if wrong)
- **HexBlob→bytes:** the address in the COSE header must be the DECODED bytes (`Buffer.from(Address.fromBech32(x).toBytes(),'hex')` on ext / real bytes on iOS), never the HexBlob string — the exact Strike COSE bug.
- Subject is pipe-joined UTF-8, lowercase hex throughout, NO JSON.
- **Pin a COSE conformance vector BEFORE coding crypto on either side:** fixed `(stakeAddress, relayPubKeyHex, deviceId)` → exact `subject` → exact `coseSign1` hex + `coseKey` hex, mirrored in `conformance.spec.ts` (extend it beyond the current deviceId/fingerprint vector) and the iOS suite. If the COSE hex does not reproduce identically in Swift and TS, interop silently 401s.

## Wallet-type coverage (branch in BOTH producer and verifier)
- **Normal (password) + PRF (passkey):** supported (background `signData` derives the key in-software).
- **Hardware (Ledger/Trezor/Keystone):** the background CANNOT sign for these (HW signing is a frontend, user-interaction flow). **v1 excludes hardware wallets** from authenticated cross-device: the device is shown "unverified" and is unpairable (graceful degrade). A later one-time frontend HW-enrollment flow (DappSignData-style, cache the proof) can add them.
- **Enterprise / Google / BTC (no reward address):** the stake-address binding is undefined; skip the proof (unpairable) in v1, or bind to the base payment credential later.

## Rollout (required, fail-closed, dark feature — no legacy installs)
1. Relay passthrough + eviction — **shipped** (gero-sync #14).
2. Extension PRODUCE + iOS PRODUCE — start emitting `proof` (harmless while verifiers still accept absent proof).
3. Pin the COSE conformance vector; spike-confirm the emurgo protected-header read-back.
4. Extension VERIFY + iOS VERIFY — flip pairing **fail-closed** (missing/invalid proof ⇒ unpairable) in the SAME release on both clients.

Because the feature is unreleased dark (`isCrossDeviceSigningEnabled` default false, no in-the-wild TOFU pairings), the proof is **REQUIRED** from day one at the pairing boundary; the wire field stays optional (additive) but verification is mandatory.

## Residuals (accepted for v1)
- **Same-wallet replay:** no server nonce, so a captured valid proof replays for the SAME wallet across sessions/relays. It CANNOT be forged for a different wallet (the gap being closed). It is also **useless to an attacker** who lacks the relay-auth private key for the pinned pubkey (they can't sign SIGN_REQUEST/RESPONSE as that device). Follow-up: append `|<serverNonce>` with a gero-sync CHALLENGE frame.
- **Relay strip (downgrade):** a malicious relay dropping `proof` yields an unpairable device (denial of pairing), not a silent downgrade — because verification is fail-closed and required.
- **Relay-auth privkey at rest** is not yet encrypted (`deviceIdentityStore.ts`): a stolen relay-auth key + a captured wallet proof lets an attacker impersonate a trusted device. The wallet-key proof is the anchor; encrypting the relay-auth key is a separate hardening.
- **Registry pruning:** the proof gates PAIRING, not registry membership; a proof-less entry can still appear in DEVICES until it disconnects (eviction fix in #14 handles disconnect ghosts).
