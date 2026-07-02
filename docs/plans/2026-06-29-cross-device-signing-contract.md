# Cross-Device Signing Bridge - Relay Protocol Contract (v1, AUTHORITATIVE)

**Status:** Reconciled with the iOS approver (handback 2026-07-02). Extension conformance shipped on `feat/copilot-agent` (flag `isCrossDeviceSigningEnabled`, default false). This document supersedes the earlier Phase-0 draft: the signing canonicalization changed from sorted-key JSON to explicit pipe-joined subjects (see section 3).
**Audience:** gero-sync (server), the iOS approver, and any future Android client. This is the single source of truth all three implement against.
**Extension source of truth (must stay identical to this doc):** `src/services/crossDevice/protocol.ts` (types + validators), `envelope.ts` (canonical subjects + auth), `deviceRegistry.ts`, `signRequestMachine.ts`, `crossDeviceSigning.service.ts`.
**No em/en dashes (standing team preference).**

## 0. One-paragraph model

On Cardano (eUTxO) every spend needs a witness signature: no session keys, no account abstraction, no spending delegation. A desktop copilot PROPOSES an unsigned transaction, gero-sync RELAYS it to the user's phone, the phone INDEPENDENTLY decodes and displays the real transaction, the user biometric-signs LOCALLY, and the witness comes back. Private keys never leave the signing device; gero-sync relays only the unsigned transaction and the signature.

## 1. Encodings (all clients)

- **Hex:** lowercase throughout (keys, signatures, CBOR, hashes).
- **Signatures:** Ed25519. The device relay key is a message-auth key, distinct from any wallet spending key.
- **Hash:** blake2b-256 (32-byte output), lowercase hex (64 chars).
- **Time:** `expiresAt` is unix SECONDS (integer), rendered as its decimal string in signing subjects.
- **Version:** carried in the signing-subject prefix `gero-xdev/v1`. Signed messages do NOT carry a numeric `v` field; unsigned frames carry none.

## 2. Message shapes (JSON on the wire)

Optional fields are marked `?`. Unknown extra fields MUST be ignored, not rejected.

```jsonc
// Outbound from a device on every (re)connect. UNSIGNED (trust-on-first-use).
// Wallet is inferred server-side from the socket SUBSCRIBE.
DEVICE_REGISTER = {
  "type": "DEVICE_REGISTER",
  "deviceId": "string",   // = deviceIdFromPubKey(pubKey), see section 5
  "label": "string",      // human label, e.g. "iPhone", "Adam's Chrome"
  "platform": "extension" | "ios" | "android",
  "pubKey": "hex",        // Ed25519 public key; verifies this device's signed msgs
  "hasSigningKey": bool   // true if this device holds a wallet spending key
}

// Inbound: the server's snapshot of every device registered under this wallet.
// REPLACES the client's registry each time. This is what lets a client resolve a
// sender's pubKey to verify signatures. Push on registry change (join/leave).
DEVICES = {
  "type": "DEVICES",
  "devices": [ { deviceId, label, platform, pubKey, hasSigningKey }, ... ]
}

// Inbound optional ack of a DEVICE_REGISTER. Advisory; clients may ignore.
DEVICE_REGISTER_ACK = { "type": "DEVICE_REGISTER_ACK", "deviceId"?: "string" }

// Requester -> sibling signing device(s). SIGNED (subject in section 3).
SIGN_REQUEST = {
  "type": "SIGN_REQUEST",
  "reqId": "string",        // unique per request
  "nonce": "string",        // anti-replay; request is single-use per (reqId, nonce)
  "from": "string",         // requesting deviceId
  "stakeAddress"?: "string",// routing scope; empty-slot in the subject when absent
  "unsignedCbor": "hex",    // the proposed tx (NOT secret; goes on-chain anyway)
  "intent"?: "string",      // notification hint ONLY; approver MUST NOT trust or render it
  "expiresAt": number,      // unix SECONDS; invalid at/after this
  "sig": "hex"              // Ed25519 over the SIGN_REQUEST subject (section 3)
}

// Approver -> requester. SIGNED.
SIGN_RESPONSE = {
  "type": "SIGN_RESPONSE",
  "reqId": "string",        // correlates to the request
  "nonce": "string",        // the response's OWN nonce (independent of the request)
  "deviceId": "string",     // the approving device
  "decision": "approved" | "rejected",
  "witnessSetCbor"?: "hex", // present iff approved
  "reason"?: "string",      // optional, UNAUTHENTICATED advisory (NOT in the subject)
  "sig": "hex"              // Ed25519 over the SIGN_RESPONSE subject (section 3)
}
```

Note there is NO `toDeviceId` in `SIGN_REQUEST`: the server fans out to all sibling signing devices on the stake address; whichever the user acts on responds. One-at-a-time and busy-rejection are approver-local policies (iOS does this), not wire fields.

## 3. Canonical signing subjects (THE cross-client invariant)

The signature is over a pipe-joined UTF-8 string, NOT JSON. This is deliberate: cross-language JSON canonicalization diverges (number formatting, string escaping, whitespace), so JSON-signed messages will not verify across Swift and JS. The subject is explicit, ordered, and hashes the large CBOR.

```
SIGN_REQUEST subject:
  gero-xdev/v1|SIGN_REQUEST|<reqId>|<nonce>|<from>|<stakeAddress or empty>|<expiresAt>|<blake2b256hex(rawUnsignedCborBytes)>

SIGN_RESPONSE subject:
  gero-xdev/v1|SIGN_RESPONSE|<reqId>|<nonce>|<deviceId>|<decision>|<blake2b256hex(rawWitnessBytes) when approved, empty when rejected>
```

Rules:
- `<stakeAddress or empty>` = the stakeAddress, or the empty string when absent.
- `<expiresAt>` = the integer seconds as a decimal string (e.g. `1000`).
- The hash is over the RAW CBOR BYTES, i.e. `blake2b256(hexToBytes(unsignedCbor))`, not over the hex string.
- The response witness-hash slot is EMPTY (nothing between the last two pipes) when `decision === "rejected"`.
- `reason` and `intent` are NOT in any subject (advisory only; treat as untrusted).
- `sig = ed25519_sign(devicePrivKey, utf8Bytes(subject))`; verify against the sender's registered `pubKey`.

### Conformance vectors (reproduce these byte-for-byte)

```
blake2b256hex(0x84a4) = 95206ecbc3a90dd4117931c4a7802e99ec301fb896734b0b721d40177602fc50
blake2b256hex(0xa100) = a04d341ee1aea805c0a3d888b0d7135f99f067c0ed74e64de80aefefedc6ff26

SIGN_REQUEST { reqId:"req-1", nonce:"n1", from:"dev1", stakeAddress:"stake1xyz", expiresAt:1000, unsignedCbor:"84a4" }
  subject = gero-xdev/v1|SIGN_REQUEST|req-1|n1|dev1|stake1xyz|1000|95206ecbc3a90dd4117931c4a7802e99ec301fb896734b0b721d40177602fc50

same with stakeAddress absent:
  subject = gero-xdev/v1|SIGN_REQUEST|req-1|n1|dev1||1000|95206ecbc3a90dd4117931c4a7802e99ec301fb896734b0b721d40177602fc50

SIGN_RESPONSE approved { reqId:"req-1", nonce:"n2", deviceId:"dev2", witnessSetCbor:"a100" }
  subject = gero-xdev/v1|SIGN_RESPONSE|req-1|n2|dev2|approved|a04d341ee1aea805c0a3d888b0d7135f99f067c0ed74e64de80aefefedc6ff26

SIGN_RESPONSE rejected { reqId:"req-1", nonce:"n2", deviceId:"dev2" }
  subject = gero-xdev/v1|SIGN_RESPONSE|req-1|n2|dev2|rejected|
```

The extension pins these exact strings in `src/services/crossDevice/envelope.spec.ts`. Any client that produces a different subject for the same input has a bug that will silently break verification.

## 4. deviceId derivation

`deviceId = firstNHex(sha256(hexToBytes(pubKey)), 32)` i.e. hex of the first 16 bytes of the SHA-256 of the raw public-key bytes (32 hex chars). Extension: `deviceIdFromPubKey` in `deviceIdentity.ts`. Both clients must derive it identically so `from`/`deviceId` match the registry key.

## 5. gero-sync (server) responsibilities

1. **Device registry:** persist per wallet `{ stakeAddress, deviceId, label, platform, pubKey, hasSigningKey, lastSeen }`, written on `DEVICE_REGISTER`. Authenticate registration against the wallet (see open Q below) so a rogue device cannot register.
2. **Registry fan-out:** push a `DEVICES` snapshot to all of a wallet's connected devices on any registry change, and once on connect. This is what makes signature verification possible (clients resolve pubKeys from it).
3. **Relay fan-out:** relay `SIGN_REQUEST` / `SIGN_RESPONSE` to the OTHER devices on the same stake address. Do not inspect or trust payload contents beyond routing; you never need keys.
4. **Offline push:** on a `SIGN_REQUEST` targeting an offline device, trigger a native push (APNs/FCM) to wake it.
5. **Pruning:** age out stale registry entries (a reinstalled device registers a fresh deviceId; the old one should expire). See open Q on label-dedupe.

## 6. Security invariants (all clients)

1. **Independent ground truth:** the approver decodes `unsignedCbor` itself and shows wallet-computed amounts/recipients. `intent` is never rendered as the thing being signed.
2. **Authenticated origin:** process a `SIGN_REQUEST`/`SIGN_RESPONSE` only if `sig` verifies against the sender's registered `pubKey` (from `DEVICES`). Drop unverified messages silently.
3. **No key material on the wire:** only `unsignedCbor` and `witnessSetCbor` cross the relay.
4. **Replay + ttl:** `(reqId, nonce)` is single-use; an expired request (`now >= expiresAt`) cannot be approved. Keep replay entries a while past expiry to catch late duplicates.
5. **Tx-body integrity on return:** the requester applies the witness to the ORIGINAL `unsignedCbor` it sent and re-verifies the tx body before submitting.
6. **Outflow honesty:** the approver computes "you pay" only from inputs it resolved in its own UTxO set; foreign/unresolved inputs are surfaced as a caution, never folded in (prevents an attacker deflating the amount with foreign inputs).

## 7. Open questions (server + registration)

- **Wallet-control proof at DEVICE_REGISTER:** define the challenge (e.g. sign a server nonce with the wallet key) so registration is authenticated, not pure TOFU. Both clients are ready to add it.
- **Registry pruning / label dedupe:** confirm the server prunes stale entries or lets clients dedupe by label when a device reinstalls with a new key.
- **Cancel frame:** not in v1. If we want requester-initiated cancellation, add a `SIGN_CANCEL { type, reqId, from, sig }` in v2 (subject `gero-xdev/v1|SIGN_CANCEL|<reqId>|<from>`); iOS and the extension will add handling when defined.
