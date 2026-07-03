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
 * Flipped true 2026-07-03: the feature is single-user (only the developer has
 * access, no in-the-wild pairings) and both clients emit + verify valid proofs,
 * so the coordinated-release concern (one client bricking pairing against the
 * other) does not apply. New pairings now REQUIRE a valid wallet-control proof;
 * already-trusted devices are unaffected (this gates trustCrossDevice, not
 * existing pins). Revert to false if a peer build stops emitting a proof. See
 * docs/plans/2026-07-03-authenticated-device-register-contract.md (Rollout step 4).
 */
export const REQUIRE_PROOF_TO_PAIR = true;

/** A device the user has explicitly paired. Pinned by (deviceId, pubKey). */
export interface TrustedDevice {
  deviceId: string;
  pubKey: string; // hex Ed25519 public key, pinned at trust time
  label: string;
  platform: string;
  trustedAt: number; // unix seconds
}

export interface RemoteSigningSettings {
  /** Per-wallet opt-in. When false the bridge does not participate for this wallet. */
  enabled: boolean;
  policy: SigningPolicy;
  /** Pinned devices, keyed by deviceId. */
  trustedDevices: Record<string, TrustedDevice>;
}

export function defaultRemoteSigningSettings(): RemoteSigningSettings {
  return { enabled: false, policy: 'ask', trustedDevices: {} };
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
  device: { deviceId: string; pubKey: string; label: string; platform: string },
  now: number,
): RemoteSigningSettings {
  const entry: TrustedDevice = {
    deviceId: device.deviceId,
    pubKey: device.pubKey,
    label: device.label,
    platform: device.platform,
    trustedAt: now,
  };
  return {
    ...settings,
    trustedDevices: { ...settings.trustedDevices, [device.deviceId]: entry },
  };
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
