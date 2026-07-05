import { describe, it, expect } from 'vitest';
import {
  PAIRING_QR_VERSION,
  buildPairingQrPayload,
  encodePairingQr,
  isPairingQrPayload,
  parsePairingQr,
} from './pairingQr';

const proof = { coseSign1: 'a0', coseKey: 'a1', stakeAddress: 'stake1uxyz' };
const args = {
  deviceId: 'ext-abc',
  pubKey: 'de'.repeat(32),
  stake: 'stake1uxyz',
  proof,
  nonce: 'ff'.repeat(16),
  exp: 1_700_000_180,
};

describe('buildPairingQrPayload', () => {
  it('stamps the version and carries the fields verbatim', () => {
    const p = buildPairingQrPayload(args);
    expect(p.v).toBe(PAIRING_QR_VERSION);
    expect(p).toMatchObject(args);
  });
});

describe('encode / parse round-trip', () => {
  it('round-trips through the JSON wire encoding', () => {
    const p = buildPairingQrPayload(args);
    const parsed = parsePairingQr(encodePairingQr(p));
    expect(parsed).toEqual(p);
  });
});

describe('isPairingQrPayload / parsePairingQr (fail-closed on bad input)', () => {
  it('accepts a well-formed payload', () => {
    expect(isPairingQrPayload(buildPairingQrPayload(args))).toBe(true);
  });

  it('rejects an unknown version', () => {
    expect(isPairingQrPayload({ ...buildPairingQrPayload(args), v: 'gero-xdev-pair/v2' })).toBe(false);
  });

  it('rejects a missing or malformed proof', () => {
    const { proof: _omit, ...noProof } = buildPairingQrPayload(args);
    void _omit;
    expect(isPairingQrPayload(noProof)).toBe(false);
    expect(isPairingQrPayload({ ...buildPairingQrPayload(args), proof: { coseSign1: 'a0' } })).toBe(false);
  });

  it('rejects each missing top-level field', () => {
    for (const field of ['deviceId', 'pubKey', 'stake', 'nonce', 'exp'] as const) {
      const { [field]: _omit, ...rest } = buildPairingQrPayload(args);
      void _omit;
      expect(isPairingQrPayload(rest)).toBe(false);
    }
  });

  it('rejects a non-numeric exp', () => {
    expect(isPairingQrPayload({ ...buildPairingQrPayload(args), exp: 'soon' })).toBe(false);
  });

  it('parsePairingQr returns null on malformed JSON', () => {
    expect(parsePairingQr('{not json')).toBeNull();
    expect(parsePairingQr('42')).toBeNull();
  });
});
