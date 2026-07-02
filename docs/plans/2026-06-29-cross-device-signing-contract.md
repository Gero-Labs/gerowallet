# Cross-Device Signing Bridge - Relay Protocol Contract

**Status:** Phase 0 shipped dark in the extension (branch `feat/copilot-agent`, flag `isCrossDeviceSigningEnabled`, default false).
**Audience:** the gero-sync (server) and mobile app teams. This is the artifact you implement against.
**Companion plan:** `docs/plans/2026-06-29-cross-device-signing-bridge.md` (rationale, scope, task list).
**Extension source of truth:** `src/services/crossDevice/protocol.ts` (types + validators), `envelope.ts` (auth), `signRequestMachine.ts` (state), `crossDeviceSigning.service.ts` (orchestration).

## 0. One-paragraph model

On Cardano (eUTxO) every spend needs a witness signature: no session keys, no account abstraction, no spending delegation. Agent autonomy is therefore achieved by making per-tx consent frictionless. A desktop copilot PROPOSES an unsigned transaction, gero-sync RELAYS it to the user's phone, the phone INDEPENDENTLY decodes and displays the real transaction, the user biometric-signs LOCALLY, and the witness comes back. Private keys never leave the signing device; gero-sync relays only the unsigned transaction and the signature.

## 1. Protocol version

`CROSS_DEVICE_PROTOCOL_VERSION = 1`. Every message carries `v`. Reject messages whose `v` does not match your supported version.

## 2. Message schemas (verbatim from `src/services/crossDevice/protocol.ts`)

```ts
export const CROSS_DEVICE_PROTOCOL_VERSION = 1;

export type CrossDeviceMessageType =
  | 'DEVICE_REGISTER'   // device -> server: announce this device + its pubkey
  | 'SIGN_REQUEST'      // requester -> sibling device(s): please sign this unsigned tx
  | 'SIGN_RESPONSE';    // approver -> requester: approved (+witness) or rejected

export type DevicePlatform = 'extension' | 'ios' | 'android';

export interface DeviceRegister {
  v: number;                       // === CROSS_DEVICE_PROTOCOL_VERSION
  type: 'DEVICE_REGISTER';
  deviceId: string;                // derived from pubKey: first 32 hex chars of sha256(pubKey bytes)
  label: string;                   // human label ("Adam's Chrome", "iPhone")
  platform: DevicePlatform;
  pubKey: string;                  // hex Ed25519 public key (for verifying this device's messages)
  hasSigningKey: boolean;          // true if this device holds a wallet spending key
  createdAt: number;               // ms; caller-supplied
}

export interface SignRequest {
  v: number;
  type: 'SIGN_REQUEST';
  reqId: string;                   // unique per request (caller-supplied)
  fromDeviceId: string;
  toDeviceId: string | 'any';      // 'any' = any sibling device that hasSigningKey
  stakeAddress: string;            // routing scope (server fans out on this)
  unsignedCbor: string;            // hex CBOR of the proposed tx (NOT secret; goes on-chain anyway)
  intent: string;                  // human hint for the notification ONLY; approver must NOT trust it
  nonce: string;                   // anti-replay
  createdAt: number;
  ttlMs: number;                   // request expiry window
  sig: string;                     // hex Ed25519 sig over canonical bytes of all fields except `sig`
}

export interface SignResponse {
  v: number;
  type: 'SIGN_RESPONSE';
  reqId: string;
  fromDeviceId: string;            // the approving device
  decision: 'approved' | 'rejected';
  witnessSetCbor?: string;         // hex CBOR witness set when approved; absent when rejected
  reason?: string;                 // optional rejection reason (i18n key or short code)
  nonce: string;
  createdAt: number;
  sig: string;
}

export type CrossDeviceMessage = DeviceRegister | SignRequest | SignResponse;
```

## 3. Canonical signing bytes (MUST match exactly on all platforms)

The `sig` field is an Ed25519 signature over the canonical bytes of the message with `sig` removed. Canonical bytes are produced (in the extension, `envelope.ts::canonicalBytes`) by:

1. Take the message object.
2. Drop the `sig` key.
3. Sort the remaining keys lexicographically (ascending).
4. `JSON.stringify` the re-keyed object (no extra whitespace).
5. UTF-8 encode the resulting string.

Sign with `ed25519.signAsync(canonicalBytes, privKey)`; verify with `ed25519.verifyAsync(sig, canonicalBytes, pubKey)`. The mobile app MUST reproduce steps 1-5 byte-for-byte or signatures will not verify cross-platform. Any field whose value is `undefined` is omitted by `JSON.stringify`, so an approved response and a rejected response canonicalize differently (rejected has no `witnessSetCbor`).

`deviceId` derivation: `deviceId = hex(sha256(hexToBytes(pubKey))).slice(0, 32)`.

## 4. Security invariants (MUST hold)

1. **Independent ground truth on the approver.** The approving device MUST decode `unsignedCbor` itself and display the real amounts/recipients (reuse a `SignTx`-style decode path). `intent` is a notification hint only and must never be shown as the thing being signed.
2. **Authenticated origin.** A `SIGN_REQUEST`/`SIGN_RESPONSE` is processed only if `sig` verifies against the sender's REGISTERED device `pubKey`. Unverified messages are dropped silently.
3. **No key material on the wire.** Only `unsignedCbor` and `witnessSetCbor` cross the relay. Never a private key, seed, or mnemonic. There is no field for it.
4. **Replay safety.** `(reqId, nonce)` must be single-use; a duplicate is ignored. `ttlMs` is enforced: an expired request cannot transition to approved.
5. **Tx-body integrity on return.** When the requester receives `witnessSetCbor`, it MUST apply the witness to the ORIGINAL `unsignedCbor` it sent and re-verify the tx body hash is unchanged before submitting (defense against a malicious relay swapping the tx). The extension state machine preserves the original request so this check is possible.
6. **Non-custody preserved.** gero-sync only relays; it is not a signer and never holds keys.

## 5. Asks

### gero-sync (server)
- Persist a per-wallet **device registry**: `{ stakeAddress, deviceId, label, platform, pubKey, hasSigningKey, createdAt, lastSeen }`, written on `DEVICE_REGISTER`.
- **Fan-out routing:** when a `SIGN_REQUEST`/`SIGN_RESPONSE` arrives on a stake-address connection, relay it to the OTHER devices registered under that stake address (respect `toDeviceId` when not `'any'`). The server does not inspect or trust payload contents beyond routing; it must not need keys.
- **Push trigger:** on a `SIGN_REQUEST` targeting a device that is offline, trigger a native push (APNs/FCM) so the phone wakes.
- Open questions to confirm:
  - Q1: does gero-sync currently fan a published message to sibling devices on a stake address, or is that net-new?
  - Q2: is there an existing per-device key we can reuse for `pubKey`, or is Phase-0 keygen the source? (The extension currently generates a fresh Ed25519 keypair per session; a persisted device store is a follow-up.)

### mobile app (separate repo)
- Handle `SIGN_REQUEST`: verify `sig` against the registry `pubKey`, **independently decode `unsignedCbor` and display real amounts/recipients** (invariant 1), biometric-sign locally, return `SIGN_RESPONSE` with the witness. Handle native push wake.
- Symmetric `DEVICE_REGISTER` on login.
- Reproduce the canonical signing bytes (section 3) exactly.

### extension follow-ups (later)
- Persisted per-device identity store (currently keygen is per session).
- Approver UI reusing `SignTx.vue` decode/display when the extension is the signer.
- Requester integration: the copilot Agent Allowance escalation path calls `requestSignature(...)` for out-of-policy/top-up actions; apply-witness-to-original + integrity re-check (invariant 5) + submit.
- Confidentiality: Phase 0 authenticates but relays plaintext `unsignedCbor`/`witnessSetCbor`. Fast-follow adds `xchacha20poly1305` (from `@noble/ciphers`, already a dep) under a per-pair shared secret; key agreement needs an x25519 secret (add `@noble/curves` or derive from Ed25519 keys) - decide at that time.
```
