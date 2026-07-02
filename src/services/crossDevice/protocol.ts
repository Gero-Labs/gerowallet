// Cross-device signing bridge — relay protocol types + validators (pure).
//
// These are the shared source-of-truth message schemas exchanged over the
// gero-sync relay between a requester device (e.g. the desktop copilot) and a
// signing device (e.g. the user's phone). gero-sync only relays; it never
// inspects or trusts payload contents beyond routing.
//
// Pure module: no chrome, no WebSocket, no Date.now.

export const CROSS_DEVICE_PROTOCOL_VERSION = 1;

export type CrossDeviceMessageType =
  | 'DEVICE_REGISTER' // device -> server: announce this device + its pubkey
  | 'SIGN_REQUEST' // requester -> sibling device(s): please sign this unsigned tx
  | 'SIGN_RESPONSE'; // approver -> requester: approved (+witness) or rejected

export type DevicePlatform = 'extension' | 'ios' | 'android';

export interface DeviceRegister {
  v: number; // === CROSS_DEVICE_PROTOCOL_VERSION
  type: 'DEVICE_REGISTER';
  deviceId: string; // derived from pubKey
  label: string; // human label ("Adam's Chrome", "iPhone")
  platform: DevicePlatform;
  pubKey: string; // hex Ed25519 public key (for verifying this device's messages)
  hasSigningKey: boolean; // true if this device holds a wallet spending key
  createdAt: number; // ms; caller-supplied (no Date.now in pure code)
}

export interface SignRequest {
  v: number;
  type: 'SIGN_REQUEST';
  reqId: string; // unique per request (caller-supplied)
  fromDeviceId: string;
  toDeviceId: string | 'any'; // 'any' = any sibling device that hasSigningKey
  stakeAddress: string; // routing scope (server fans out on this)
  unsignedCbor: string; // hex CBOR of the proposed tx (NOT secret; goes on-chain anyway)
  intent: string; // human hint for the notification ONLY; approver must NOT trust it
  nonce: string; // anti-replay
  createdAt: number;
  ttlMs: number; // request expiry window
  sig: string; // hex Ed25519 sig over canonical bytes of all fields except `sig`
}

export interface SignResponse {
  v: number;
  type: 'SIGN_RESPONSE';
  reqId: string;
  fromDeviceId: string; // the approving device
  decision: 'approved' | 'rejected';
  witnessSetCbor?: string; // hex CBOR witness set when approved; absent when rejected
  reason?: string; // optional rejection reason (i18n key or short code)
  nonce: string;
  createdAt: number;
  sig: string;
}

export type CrossDeviceMessage = DeviceRegister | SignRequest | SignResponse;

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

const PLATFORMS: readonly DevicePlatform[] = ['extension', 'ios', 'android'];

function hasCorrectVersion(x: Record<string, unknown>): boolean {
  return x['v'] === CROSS_DEVICE_PROTOCOL_VERSION;
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

export function isDeviceRegister(x: unknown): x is DeviceRegister {
  if (!isObject(x)) return false;
  if (x['type'] !== 'DEVICE_REGISTER' || !hasCorrectVersion(x)) return false;
  return (
    isString(x['deviceId']) &&
    isString(x['label']) &&
    isString(x['pubKey']) &&
    typeof x['hasSigningKey'] === 'boolean' &&
    isNumber(x['createdAt']) &&
    isString(x['platform']) &&
    PLATFORMS.includes(x['platform'] as DevicePlatform)
  );
}

export function isSignRequest(x: unknown): x is SignRequest {
  if (!isObject(x)) return false;
  if (x['type'] !== 'SIGN_REQUEST' || !hasCorrectVersion(x)) return false;
  return (
    isString(x['reqId']) &&
    isString(x['fromDeviceId']) &&
    isString(x['toDeviceId']) &&
    isString(x['stakeAddress']) &&
    isString(x['unsignedCbor']) &&
    isString(x['intent']) &&
    isString(x['nonce']) &&
    isNumber(x['createdAt']) &&
    isNumber(x['ttlMs']) &&
    isString(x['sig'])
  );
}

export function isSignResponse(x: unknown): x is SignResponse {
  if (!isObject(x)) return false;
  if (x['type'] !== 'SIGN_RESPONSE' || !hasCorrectVersion(x)) return false;
  const decision = x['decision'];
  const decisionOk = decision === 'approved' || decision === 'rejected';
  const witnessOk = x['witnessSetCbor'] === undefined || isString(x['witnessSetCbor']);
  const reasonOk = x['reason'] === undefined || isString(x['reason']);
  return (
    isString(x['reqId']) &&
    isString(x['fromDeviceId']) &&
    decisionOk &&
    witnessOk &&
    reasonOk &&
    isString(x['nonce']) &&
    isNumber(x['createdAt']) &&
    isString(x['sig'])
  );
}

/**
 * Parse an untrusted raw value into a typed cross-device message. Returns null
 * on wrong protocol version, missing/mistyped required fields, unknown type, or
 * a non-object. Authentication (`sig` verification) is a separate step handled
 * by the envelope + service.
 */
export function parseCrossDeviceMessage(raw: unknown): CrossDeviceMessage | null {
  if (isDeviceRegister(raw)) return raw;
  if (isSignRequest(raw)) return raw;
  if (isSignResponse(raw)) return raw;
  return null;
}
