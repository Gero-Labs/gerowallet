// Cross-device signing bridge — per-device Ed25519 identity (pure).
//
// A device identity is a long-lived Ed25519 keypair. The public key is
// published (via DEVICE_REGISTER) so sibling devices can verify this device's
// signed relay messages. The deviceId is a stable, collision-resistant hash of
// the public key so the same key always yields the same id.
//
// This module is intentionally pure: no chrome, no WebSocket, no Date.now.
// Randomness is injectable for deterministic tests.

import * as ed25519 from '@noble/ed25519';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

// @noble/ed25519 v3 exposes a fast synchronous API, but it requires a sha512
// implementation to be wired in (the library ships no default to stay
// dependency-free). We supply the one from @noble/hashes (already a dep) once
// at module load so getPublicKey/sign/verify work synchronously.
if (!ed25519.hashes.sha512) {
  ed25519.hashes.sha512 = sha512;
}

export interface DeviceKeypair {
  privKeyHex: string;
  pubKeyHex: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Invalid hex string length: ${hex.length}`);
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Default CSPRNG. Overridable for deterministic tests.
function defaultRandomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // globalThis.crypto is available in the extension (browser) and in Vitest.
  globalThis.crypto.getRandomValues(out);
  return out;
}

/**
 * Generate a new Ed25519 device keypair.
 *
 * @param randomBytes injectable randomness (32-byte seed); defaults to the
 *   platform CSPRNG. Passing a deterministic function yields a deterministic
 *   keypair, which the tests rely on.
 */
export function generateDeviceKeypair(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): DeviceKeypair {
  const priv = randomBytes(32);
  const pub = ed25519.getPublicKey(priv);
  return {
    privKeyHex: bytesToHex(priv),
    pubKeyHex: bytesToHex(pub),
  };
}

// Length (in hex chars) of the derived device id. 32 hex chars = 16 bytes of
// sha256, ample collision resistance for a per-wallet device set.
const DEVICE_ID_HEX_LEN = 32;

/**
 * Derive a stable device id from a public key. Deterministic: the same public
 * key always produces the same id; different keys produce different ids.
 */
export function deviceIdFromPubKey(pubKeyHex: string): string {
  const digest = sha256(hexToBytes(pubKeyHex));
  return bytesToHex(digest).slice(0, DEVICE_ID_HEX_LEN);
}
