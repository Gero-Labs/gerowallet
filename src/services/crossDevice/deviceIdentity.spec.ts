import { describe, it, expect } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import {
  generateDeviceKeypair,
  deviceIdFromPubKey,
} from './deviceIdentity';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

describe('generateDeviceKeypair', () => {
  it('derives a 64-hex public key that matches @noble/ed25519 for the private key', () => {
    const kp = generateDeviceKeypair();
    expect(kp.privKeyHex).toMatch(/^[0-9a-f]{64}$/);
    expect(kp.pubKeyHex).toMatch(/^[0-9a-f]{64}$/);
    // Public key must be the true ed25519 public key for the private seed.
    const derived = ed25519.getPublicKey(hexToBytes(kp.privKeyHex));
    const derivedHex = Array.from(derived)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    expect(kp.pubKeyHex).toBe(derivedHex);
  });

  it('is deterministic when an injected randomBytes returns a fixed seed', () => {
    const fixed = (n: number) => new Uint8Array(n).fill(7);
    const a = generateDeviceKeypair(fixed);
    const b = generateDeviceKeypair(fixed);
    expect(a.privKeyHex).toBe(b.privKeyHex);
    expect(a.pubKeyHex).toBe(b.pubKeyHex);
  });

  it('produces different keypairs for different random seeds', () => {
    const a = generateDeviceKeypair((n) => new Uint8Array(n).fill(1));
    const b = generateDeviceKeypair((n) => new Uint8Array(n).fill(2));
    expect(a.privKeyHex).not.toBe(b.privKeyHex);
    expect(a.pubKeyHex).not.toBe(b.pubKeyHex);
  });
});

describe('deviceIdFromPubKey', () => {
  it('is deterministic for the same public key', () => {
    const id1 = deviceIdFromPubKey('aa'.repeat(32));
    const id2 = deviceIdFromPubKey('aa'.repeat(32));
    expect(id1).toBe(id2);
  });

  it('produces different ids for different public keys', () => {
    expect(deviceIdFromPubKey('aa'.repeat(32))).not.toBe(
      deviceIdFromPubKey('bb'.repeat(32)),
    );
  });

  it('returns a stable lowercase hex id', () => {
    const id = deviceIdFromPubKey('aa'.repeat(32));
    expect(id).toMatch(/^[0-9a-f]+$/);
    expect(id.length).toBeGreaterThan(0);
  });
});
