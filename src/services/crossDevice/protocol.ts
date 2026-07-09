// Cross-device signing bridge — relay protocol types + validators (pure).
//
// Shared source-of-truth message schemas exchanged over the gero-sync relay
// between a requester device (e.g. the desktop copilot) and a signing device
// (e.g. the user's phone). gero-sync only relays + fans out by stake address; it
// never inspects or trusts payload contents beyond routing.
//
// Wire contract is authoritative in docs/plans/2026-06-29-cross-device-signing-contract.md
// and is aligned byte-for-byte with the iOS approver. Version is carried in the
// SIGNING SUBJECT prefix (gero-xdev/v1, see envelope.ts), so signed messages do
// NOT carry a numeric `v`. Unsigned frames (DEVICE_REGISTER, DEVICES) carry none.
//
// Pure module: no chrome, no WebSocket, no Date.now.

export type CrossDeviceMessageType =
  | 'DEVICE_REGISTER' // device -> server: announce this device + its pubkey (TOFU, unsigned)
  | 'DEVICES' // server -> device: the current per-wallet device registry snapshot
  | 'DEVICE_REGISTER_ACK' // server -> device: optional ack of a DEVICE_REGISTER
  | 'SIGN_REQUEST' // requester -> sibling device(s): please sign this unsigned tx
  | 'SIGN_RESPONSE' // approver -> requester: approved (+witness) or rejected
  | 'PAIR_CONFIRM' // scanner (phone) -> scanned device (desktop): QR-pair handshake, signed
  | 'PAIR_ACK'; // scanned device (desktop) -> scanner (phone): "I pinned you too", signed (cosmetic tick)

export type DevicePlatform = 'extension' | 'ios' | 'android';

/**
 * Wallet-control proof: a CIP-8 COSE_Sign1 in which the device's WALLET stake key
 * endorses its relay-auth pubkey (see registerProof.ts). Optional on the wire
 * (absent for legacy / trust-on-first-use devices) until the coordinated
 * fail-closed flip. The relay carries it through verbatim; siblings verify it.
 */
export interface DeviceRegisterProof {
  coseSign1: string; // hex CBOR of COSE_Sign1
  coseKey: string; // hex CBOR of COSE_Key
  stakeAddress: string; // bech32 reward address the wallet key signed with
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  platform: DevicePlatform;
  pubKey: string; // hex Ed25519 public key (verifies this device's signed messages)
  hasSigningKey: boolean; // true if this device holds a wallet spending key
  proof?: DeviceRegisterProof; // optional wallet-control proof
}

/** Outbound, unsigned (trust-on-first-use); wallet inferred server-side from SUBSCRIBE. */
export interface DeviceRegister extends DeviceInfo {
  type: 'DEVICE_REGISTER';
}

/** Inbound: the server's snapshot of every device registered under this wallet. */
export interface DevicesSnapshot {
  type: 'DEVICES';
  devices: DeviceInfo[];
}

/** Inbound optional ack; advisory only. */
export interface DeviceRegisterAck {
  type: 'DEVICE_REGISTER_ACK';
  deviceId?: string;
}

export interface SignRequest {
  type: 'SIGN_REQUEST';
  reqId: string; // unique per request (caller-supplied)
  nonce: string; // anti-replay; the request is single-use per (reqId, nonce)
  from: string; // requesting deviceId
  to?: string; // OPTIONAL target deviceId. A relay ROUTING hint only, deliberately
  //             NOT in the signed subject: it affects delivery, not authenticity
  //             (siblings still verify via the pinned pubKey, so a relay that
  //             rewrites `to` can only misdeliver/drop, never forge). Absent =>
  //             relay broadcasts to all siblings (backward-compatible).
  stakeAddress?: string; // routing scope; empty-slot in the subject when absent
  unsignedCbor: string; // hex CBOR of the proposed tx (NOT secret; goes on-chain anyway)
  intent?: string; // human hint for the notification ONLY; approver MUST NOT trust or render it
  expiresAt: number; // unix SECONDS; the request is invalid past this
  sig: string; // hex Ed25519 sig over the canonical SIGN_REQUEST subject (envelope.ts)
}

export interface SignResponse {
  type: 'SIGN_RESPONSE';
  reqId: string;
  nonce: string; // the response's own nonce (independent of the request nonce)
  to?: string; // OPTIONAL target deviceId (the original requester). Relay routing
  //             hint only, NOT in the signed subject; absent => broadcast.
  deviceId: string; // the approving device
  decision: 'approved' | 'rejected';
  witnessSetCbor?: string; // hex CBOR witness set when approved; absent when rejected
  reason?: string; // optional, UNAUTHENTICATED advisory rejection reason (not in the subject)
  sig: string; // hex Ed25519 sig over the canonical SIGN_RESPONSE subject
}

/**
 * QR pairing handshake, phone -> desktop over the relay. The phone scans a QR the
 * desktop rendered (carrying the desktop's deviceId/pubKey/proof + a single-use
 * nonce), verifies the desktop's wallet-control proof out-of-band, pins it, then
 * emits this frame to make the pairing mutual. Carries the PHONE's own proof so
 * the desktop can verify + pin the phone with the same `verifyDeviceRegisterProof`
 * used at DEVICE_REGISTER.
 *
 * Signed subject (envelope.ts) — DELIBERATELY binds `to` (the scanned desktop) so a
 * captured confirm can't be replayed to a different desktop; this is why PAIR_CONFIRM
 * signs `to` while SIGN_* leave it an unsigned routing hint:
 *   gero-xdev/v1|PAIR_CONFIRM|<from>|<pubKey>|<to>|<nonce>|<stakeAddress>
 * The top-level `to` (== the signed `to`) is also the relay routing hint.
 */
export interface PairConfirm {
  type: 'PAIR_CONFIRM';
  from: string; // the phone's deviceId (sha256(pubKey)[0:16], same rule as the desktop)
  pubKey: string; // the phone's relay-auth Ed25519 pubkey (hex) — same key that signs SIGN_RESPONSE
  to: string; // the scanned desktop's deviceId (from the QR) — bound in the subject + relay hint
  nonce: string; // echoed single-use nonce minted by the desktop for this QR
  stakeAddress: string; // the phone's own wallet reward address (must equal the desktop's)
  proof: DeviceRegisterProof; // the phone's wallet-control proof (verified + pinned by the desktop)
  label?: string; // human device label (e.g. "Adam's iPhone"); advisory
  platform?: DevicePlatform; // "ios"; advisory
  hasSigningKey?: boolean; // the phone holds a wallet spending key; advisory
  sig: string; // hex Ed25519 over the canonical PAIR_CONFIRM subject (phone relay-auth key)
}

/**
 * QR pairing ack, desktop -> phone over the relay. After the desktop verifies the
 * phone's PAIR_CONFIRM and pins it, it sends this so the phone can show its own
 * confirmed "Paired" tick instead of degrading after its ~2.4s timeout. Purely
 * COSMETIC: trust was already committed on both sides at proof-verify time, so a
 * dropped/forged ack only affects the checkmark, never the pinning.
 *
 * Signed subject (envelope.ts): `gero-xdev/v1|PAIR_ACK|<from>|<to>|<nonce>`. The phone
 * verifies the sig against the desktop pubKey IT PINNED (from the QR) and reconstructs
 * the subject from what it pinned (qr.deviceId, its own id, the nonce) — not from the
 * ack's self-declared fields — so a relay can at most force an unsigned best-effort tick.
 */
export interface PairAck {
  type: 'PAIR_ACK';
  from: string; // the desktop's deviceId (== the deviceId in the QR the phone scanned)
  to: string; // the phone's deviceId (== the PAIR_CONFIRM.from the desktop received) + relay hint
  nonce: string; // echoed pairing nonce
  sig: string; // hex Ed25519 over the canonical PAIR_ACK subject (desktop relay-auth key)
}

export type CrossDeviceMessage =
  | DeviceRegister
  | DevicesSnapshot
  | DeviceRegisterAck
  | SignRequest
  | SignResponse
  | PairConfirm
  | PairAck;

// ---------------------------------------------------------------------------
// Primitive field checks
// ---------------------------------------------------------------------------

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function isString(x: unknown): x is string {
  return typeof x === 'string';
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isOptString(x: unknown): boolean {
  return x === undefined || isString(x);
}

const PLATFORMS: readonly DevicePlatform[] = ['extension', 'ios', 'android'];

function isDeviceRegisterProof(x: unknown): x is DeviceRegisterProof {
  return (
    isObject(x) &&
    isString(x['coseSign1']) &&
    isString(x['coseKey']) &&
    isString(x['stakeAddress'])
  );
}

function isDeviceInfo(x: unknown): x is DeviceInfo {
  if (!isObject(x)) return false;
  return (
    isString(x['deviceId']) &&
    isString(x['label']) &&
    isString(x['pubKey']) &&
    typeof x['hasSigningKey'] === 'boolean' &&
    isString(x['platform']) &&
    PLATFORMS.includes(x['platform'] as DevicePlatform)
  );
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isDeviceRegister(x: unknown): x is DeviceRegister {
  return isObject(x) && x['type'] === 'DEVICE_REGISTER' && isDeviceInfo(x);
}

export function isDevicesSnapshot(x: unknown): x is DevicesSnapshot {
  if (!isObject(x) || x['type'] !== 'DEVICES') return false;
  return Array.isArray(x['devices']) && x['devices'].every(isDeviceInfo);
}

export function isDeviceRegisterAck(x: unknown): x is DeviceRegisterAck {
  return isObject(x) && x['type'] === 'DEVICE_REGISTER_ACK' && isOptString(x['deviceId']);
}

export function isSignRequest(x: unknown): x is SignRequest {
  if (!isObject(x) || x['type'] !== 'SIGN_REQUEST') return false;
  return (
    isString(x['reqId']) &&
    isString(x['nonce']) &&
    isString(x['from']) &&
    isOptString(x['to']) &&
    isOptString(x['stakeAddress']) &&
    isString(x['unsignedCbor']) &&
    isOptString(x['intent']) &&
    isNumber(x['expiresAt']) &&
    isString(x['sig'])
  );
}

export function isSignResponse(x: unknown): x is SignResponse {
  if (!isObject(x) || x['type'] !== 'SIGN_RESPONSE') return false;
  const decision = x['decision'];
  return (
    isString(x['reqId']) &&
    isString(x['nonce']) &&
    isOptString(x['to']) &&
    isString(x['deviceId']) &&
    (decision === 'approved' || decision === 'rejected') &&
    isOptString(x['witnessSetCbor']) &&
    isOptString(x['reason']) &&
    isString(x['sig'])
  );
}

export function isPairConfirm(x: unknown): x is PairConfirm {
  if (!isObject(x) || x['type'] !== 'PAIR_CONFIRM') return false;
  return (
    isString(x['from']) &&
    isString(x['pubKey']) &&
    isString(x['to']) &&
    isString(x['nonce']) &&
    isString(x['stakeAddress']) &&
    isDeviceRegisterProof(x['proof']) &&
    isOptString(x['label']) &&
    isOptString(x['platform']) &&
    (x['hasSigningKey'] === undefined || typeof x['hasSigningKey'] === 'boolean') &&
    isString(x['sig'])
  );
}

export function isPairAck(x: unknown): x is PairAck {
  if (!isObject(x) || x['type'] !== 'PAIR_ACK') return false;
  return (
    isString(x['from']) &&
    isString(x['to']) &&
    isString(x['nonce']) &&
    isString(x['sig'])
  );
}

/**
 * Parse an untrusted raw value into a typed cross-device message. Returns null
 * on missing/mistyped required fields, unknown type, or a non-object.
 * Authentication (`sig` verification) is a separate step (envelope + service).
 */
export function parseCrossDeviceMessage(raw: unknown): CrossDeviceMessage | null {
  if (isDeviceRegister(raw)) return raw;
  if (isDevicesSnapshot(raw)) return raw;
  if (isDeviceRegisterAck(raw)) return raw;
  if (isSignRequest(raw)) return raw;
  if (isSignResponse(raw)) return raw;
  if (isPairConfirm(raw)) return raw;
  if (isPairAck(raw)) return raw;
  return null;
}
