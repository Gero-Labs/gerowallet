import { describe, it, expect } from 'vitest';
import { deviceIdFromPubKey } from './deviceIdentity';
import { pairingFingerprint } from './crossDeviceTrust';

// Cross-client byte-parity vector shared with the iOS approver (gero-ios PR #33).
// Both are SHA-256 over the RAW pubkey bytes. If either value changes, pairing
// codes / device ids stop lining up across clients — pin them on BOTH sides.
const PUBKEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('cross-device conformance vector (must match iOS gero-ios PR #33)', () => {
  it('deviceIdFromPubKey = lowercaseHex(SHA256(bytes)[0..16])', () => {
    expect(deviceIdFromPubKey(PUBKEY)).toBe('4884fdaafea47c29fea7159d0daddd9c');
  });

  it('pairingFingerprint = upperHex(SHA256(bytes)[0..6]) grouped 4-4-4', () => {
    expect(pairingFingerprint(PUBKEY)).toBe('4884-FDAA-FEA4');
  });
});
