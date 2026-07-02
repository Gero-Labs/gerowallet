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
  | 'SIGN_RESPONSE'; // approver -> requester: approved (+witness) or rejected

export type DevicePlatform = 'extension' | 'ios' | 'android';

export interface DeviceInfo {
  deviceId: string;
  label: string;
  platform: DevicePlatform;
  pubKey: string; // hex Ed25519 public key (verifies this device's signed messages)
  hasSigningKey: boolean; // true if this device holds a wallet spending key
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
  deviceId: string; // the approving device
  decision: 'approved' | 'rejected';
  witnessSetCbor?: string; // hex CBOR witness set when approved; absent when rejected
  reason?: string; // optional, UNAUTHENTICATED advisory rejection reason (not in the subject)
  sig: string; // hex Ed25519 sig over the canonical SIGN_RESPONSE subject
}

export type CrossDeviceMessage =
  | DeviceRegister
  | DevicesSnapshot
  | DeviceRegisterAck
  | SignRequest
  | SignResponse;

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
    isString(x['deviceId']) &&
    (decision === 'approved' || decision === 'rejected') &&
    isOptString(x['witnessSetCbor']) &&
    isOptString(x['reason']) &&
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
  return null;
}
