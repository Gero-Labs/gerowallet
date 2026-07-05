import { describe, it, expect } from 'vitest';
import { sanitizeTrusted } from './crossDeviceSettings';

// sanitizeTrusted runs on EVERY load of a wallet's remote-signing settings. It must
// round-trip the whole TrustedDevice, not just the pin — dropping `verified` silently
// downgraded a QR-verified device to "SAS only" after a reload, and dropping
// `hasSigningKey` could hide a paired-but-offline signer from the Send gate / to-target.

const full = {
  'ios-1': {
    deviceId: 'ios-1',
    pubKey: 'bb'.repeat(32),
    label: "Adam's iPhone",
    platform: 'ios',
    trustedAt: 1_700_000_000,
    verified: true,
    hasSigningKey: true,
  },
};

describe('sanitizeTrusted preserves the full TrustedDevice across a reload', () => {
  it('keeps verified + hasSigningKey (regression: they were being stripped)', () => {
    const out = sanitizeTrusted(full);
    expect(out['ios-1']).toEqual(full['ios-1']);
    expect(out['ios-1'].verified).toBe(true);
    expect(out['ios-1'].hasSigningKey).toBe(true);
  });

  it('preserves verified:false / hasSigningKey:false verbatim (not coerced away)', () => {
    const out = sanitizeTrusted({ 'x': { deviceId: 'x', pubKey: 'aa', verified: false, hasSigningKey: false } });
    expect(out['x'].verified).toBe(false);
    expect(out['x'].hasSigningKey).toBe(false);
  });

  it('omits the optional flags for a legacy pin that never had them', () => {
    const out = sanitizeTrusted({ 'legacy': { deviceId: 'legacy', pubKey: 'aa', label: 'old', platform: 'ios', trustedAt: 1 } });
    expect('verified' in out['legacy']).toBe(false);
    expect('hasSigningKey' in out['legacy']).toBe(false);
  });

  it('drops entries missing the load-bearing pin fields, and non-object input', () => {
    expect(sanitizeTrusted({ 'bad': { deviceId: 'bad' } })).toEqual({}); // no pubKey
    expect(sanitizeTrusted(null)).toEqual({});
    expect(sanitizeTrusted('nope')).toEqual({});
  });

  it('ignores a non-boolean verified/hasSigningKey rather than storing garbage', () => {
    const out = sanitizeTrusted({ 'x': { deviceId: 'x', pubKey: 'aa', verified: 'yes', hasSigningKey: 1 } });
    expect('verified' in out['x']).toBe(false);
    expect('hasSigningKey' in out['x']).toBe(false);
  });
});
