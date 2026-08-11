// Cross-device signing bridge — trusted-device pinning + signing policy (pure).
//
// The relay registers devices trust-on-first-use keyed only by the PUBLIC stake
// address, so any party that knows it can join a wallet's device group. This
// module is the user-controlled authorization layer on top: which sibling
// devices this wallet actually trusts to approve/answer signing, and whether a
// Send is allowed to sign locally or must be approved on a trusted device.
//
// Pure: no chrome, no WebSocket, no Date.now. Reducers return new state; the
// predicates are what the signing service injects to gate inbound relay traffic.
// `now` (unix seconds) is passed in by callers for the same testability reason
// as the rest of the bridge.

import { sha256 } from '@noble/hashes/sha2.js';

export type SigningPolicy = 'ask' | 'require_remote';

/**
 * Fail-closed flip (coordinated with iOS `CrossDeviceRegisterProofVerifier.requireProofToPair`).
 *
 * false = verify-if-present (current rollout state): a device that presents a
 * wallet-control proof MUST verify it to pair; a device with NO proof falls back
 * to SAS-only pairing. true = require a valid proof to pair (a MISSING proof is
 * also rejected).
 *
 * true = fail-closed pairing: a device MUST present a valid wallet-control proof to
 * pair (a missing proof is rejected, not just an invalid one). This is the shipped
 * end state — the authenticated-register security boundary. Safe without a coordinated
 * release because the feature is single-user (only the developer has access, zero
 * in-the-wild pairings) and both clients emit + verify valid proofs, so there is no
 * peer to brick pairing against. Gates trustCrossDevice (new pairings) only; existing
 * pins are unaffected. One-line reversible to false if a peer build stops emitting a
 * proof. iOS mirror: `CrossDeviceRegisterProofVerifier.requireProofToPair`. See
 * the internal authenticated-device-register contract (Rollout step 4).
 */
export const REQUIRE_PROOF_TO_PAIR = true;

/** A device the user has explicitly paired. Pinned by (deviceId, pubKey). */
export interface TrustedDevice {
  deviceId: string;
  pubKey: string; // hex Ed25519 public key, pinned at trust time
  label: string;
  platform: string;
  trustedAt: number; // unix seconds
  /**
   * True if the pairing verified a wallet-control proof (this device proved it
   * holds the wallet stake key); false = SAS-only pairing (no proof was present).
   * Drives the "wallet-verified" vs "SAS only" badge. Optional for back-compat
   * with pins made before this field existed (treated as SAS-only / unknown).
   */
  verified?: boolean;
  /**
   * True if the pinned device holds a wallet spending key (can actually approve a
   * Send). Captured from the live DeviceInfo at pair time. Persisted so the Send
   * gate + offline-target selection can identify a signer WITHOUT the device being
   * online (the live DEVICES snapshot drops a locked phone). Optional for back-compat
   * with pins made before this field existed (undefined => treat as capable, since a
   * device was pinned precisely to enable remote signing).
   */
  hasSigningKey?: boolean;
  /**
   * XDP (R6): serve Cross-Device Proving to THIS device. Opt-in per device, so
   * pairing a phone for signing never silently enlists this machine as its
   * prover. Absent = off — an existing pin does not start serving on upgrade.
   */
  serveProofs?: boolean;
}

export interface RemoteSigningSettings {
  /** Per-wallet opt-in. When false the bridge does not participate for this wallet. */
  enabled: boolean;
  policy: SigningPolicy;
  /** Pinned devices, keyed by deviceId. */
  trustedDevices: Record<string, TrustedDevice>;
  /**
   * XDP (R6) master switch. Off by default: proving for a phone means running
   * the user's proof server on their behalf, which is a resource decision as
   * much as a trust one, so it is never implied by pairing.
   */
  serveProofs: boolean;
}

export function defaultRemoteSigningSettings(): RemoteSigningSettings {
  return { enabled: false, policy: 'ask', trustedDevices: {}, serveProofs: false };
}

/**
 * A device is trusted iff it is pinned AND the pubKey presented now matches the
 * pinned pubKey. Fail closed on any mismatch: a device claiming a pinned
 * deviceId with a different key is NOT trusted. (deviceId already derives from
 * pubKey, so this is defense-in-depth, and the guard the signing service relies
 * on to drop untrusted senders.)
 */
export function isDeviceTrusted(
  settings: RemoteSigningSettings,
  deviceId: string,
  pubKey: string,
): boolean {
  const pinned = settings.trustedDevices[deviceId];
  return !!pinned && pinned.pubKey === pubKey;
}

/** Enabled AND set to require remote approval for a Send. */
export function requiresRemoteForSend(settings: RemoteSigningSettings): boolean {
  return settings.enabled && settings.policy === 'require_remote';
}

/** Whether at least one device is pinned (used to warn before enabling require_remote). */
export function hasTrustedDevice(settings: RemoteSigningSettings): boolean {
  return Object.keys(settings.trustedDevices).length > 0;
}

/**
 * Pinned devices that can actually approve a Send (hold a wallet spending key).
 * PERSISTENT: unlike the live DEVICES snapshot, this survives the signer being
 * offline — which is exactly the case the APNs wake exists for. A legacy pin with
 * no captured `hasSigningKey` (undefined) counts as capable: it was pinned to
 * enable remote signing in the first place.
 */
export function pairedSigners(settings: RemoteSigningSettings): TrustedDevice[] {
  return Object.values(settings.trustedDevices).filter((d) => d.hasSigningKey !== false);
}

/**
 * Whether a signing-capable device is paired (regardless of live presence). This
 * is the Send gate: it must NOT key on live presence, or the "sign on another
 * device" button hides whenever the phone is locked — the very moment the wake is
 * meant to cover. The flow stays fail-closed at approval time (an offline device
 * cannot return a verified SIGN_RESPONSE).
 */
export function hasPairedSigner(settings: RemoteSigningSettings): boolean {
  return pairedSigners(settings).length > 0;
}

/**
 * The single pinned signer's deviceId, else null (0 or >1 both broadcast; a device
 * picker is a later refinement). Used as the SIGN_REQUEST `to` so the relay routes
 * to exactly that device and APNs-wakes it when offline. Resolving from the pinned
 * list (not the live snapshot) is what lets us target a locked phone at all; it also
 * avoids the stale-duplicate-session inflation that made live targeting return null.
 */
export function soleSignerDeviceId(settings: RemoteSigningSettings): string | null {
  const signers = pairedSigners(settings);
  return signers.length === 1 ? signers[0].deviceId : null;
}

// ---- reducers (pure) -------------------------------------------------------

export function setEnabled(
  settings: RemoteSigningSettings,
  enabled: boolean,
): RemoteSigningSettings {
  return { ...settings, enabled };
}

export function setPolicy(
  settings: RemoteSigningSettings,
  policy: SigningPolicy,
): RemoteSigningSettings {
  return { ...settings, policy };
}

/** Pin (or re-pin) a device, capturing the pubKey observed now. */
export function trustDevice(
  settings: RemoteSigningSettings,
  device: {
    deviceId: string;
    pubKey: string;
    label: string;
    platform: string;
    verified?: boolean;
    hasSigningKey?: boolean;
  },
  now: number,
): RemoteSigningSettings {
  const entry: TrustedDevice = {
    deviceId: device.deviceId,
    pubKey: device.pubKey,
    label: device.label,
    platform: device.platform,
    trustedAt: now,
    verified: !!device.verified,
    hasSigningKey: device.hasSigningKey,
  };
  return {
    ...settings,
    trustedDevices: { ...settings.trustedDevices, [device.deviceId]: entry },
  };
}

/** XDP master switch. */
export function setServeProofs(
  settings: RemoteSigningSettings,
  serveProofs: boolean,
): RemoteSigningSettings {
  return { ...settings, serveProofs };
}

/** XDP per-device switch. No-op for a device that is not pinned. */
export function setDeviceServeProofs(
  settings: RemoteSigningSettings,
  deviceId: string,
  serveProofs: boolean,
): RemoteSigningSettings {
  const pinned = settings.trustedDevices[deviceId];
  if (!pinned) return settings;
  return {
    ...settings,
    trustedDevices: { ...settings.trustedDevices, [deviceId]: { ...pinned, serveProofs } },
  };
}

/**
 * The XDP serving gate (proveService gate 2): serve proofs to this device iff
 * remote signing is on for the wallet, the master switch is on, the device is
 * PINNED, and it is individually enabled. Every clause must hold — this is the
 * only thing standing between "a paired phone" and "this machine runs proofs
 * for it", and proving is otherwise silent with no approval UI.
 *
 * Note this deliberately does NOT re-check the pubKey: the caller
 * (proveService) has already verified the frame signature against the pinned
 * key via isDeviceTrusted before this runs. Kept separate so each gate says one
 * thing.
 */
export function isServingProofsTo(
  settings: RemoteSigningSettings,
  deviceId: string,
): boolean {
  return settings.enabled
    && settings.serveProofs
    && settings.trustedDevices[deviceId]?.serveProofs === true;
}

/** Whether any pinned device is enabled for proving (drives the settings summary). */
export function hasProofServingDevice(settings: RemoteSigningSettings): boolean {
  return Object.values(settings.trustedDevices).some((d) => d.serveProofs === true);
}

/** Remove a pinned device. Idempotent. */
export function untrustDevice(
  settings: RemoteSigningSettings,
  deviceId: string,
): RemoteSigningSettings {
  if (!settings.trustedDevices[deviceId]) return settings;
  const next = { ...settings.trustedDevices };
  delete next[deviceId];
  return { ...settings, trustedDevices: next };
}

// ---- pairing fingerprint ---------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * A short, human-comparable fingerprint of a device public key (SAS-style). The
 * same pubKey yields the same code on every device, so a user pairing two
 * devices can eyeball-match the code shown on each screen before trusting.
 * Format: three groups of 4 uppercase hex, e.g. "3F2A-9C71-08BD" (6 bytes of
 * sha256(pubKey) — 48 bits, ample for a visual match against accidental
 * collision; it is a UX aid, not the security boundary, which is the pinned key).
 */
export function pairingFingerprint(pubKeyHex: string): string {
  const digest = sha256(hexToBytes(pubKeyHex));
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += digest[i].toString(16).padStart(2, '0');
  }
  const up = out.toUpperCase();
  return `${up.slice(0, 4)}-${up.slice(4, 8)}-${up.slice(8, 12)}`;
}
