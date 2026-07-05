import { describe, it, expect } from 'vitest';
import {
  defaultRemoteSigningSettings,
  isDeviceTrusted,
  requiresRemoteForSend,
  hasTrustedDevice,
  hasPairedSigner,
  pairedSigners,
  soleSignerDeviceId,
  setEnabled,
  setPolicy,
  trustDevice,
  untrustDevice,
  pairingFingerprint,
  type RemoteSigningSettings,
} from './crossDeviceTrust';

const DEV = { deviceId: 'aa11', pubKey: 'beef', label: 'iPhone', platform: 'ios' };

function withDevice(): RemoteSigningSettings {
  return trustDevice(defaultRemoteSigningSettings(), DEV, 1000);
}

describe('crossDeviceTrust defaults', () => {
  it('defaults to disabled, ask, no trusted devices', () => {
    const s = defaultRemoteSigningSettings();
    expect(s.enabled).toBe(false);
    expect(s.policy).toBe('ask');
    expect(s.trustedDevices).toEqual({});
    expect(hasTrustedDevice(s)).toBe(false);
  });
});

describe('isDeviceTrusted (fail-closed pinning)', () => {
  it('untrusted when not pinned', () => {
    expect(isDeviceTrusted(defaultRemoteSigningSettings(), 'aa11', 'beef')).toBe(false);
  });

  it('trusted when pinned and pubKey matches', () => {
    expect(isDeviceTrusted(withDevice(), 'aa11', 'beef')).toBe(true);
  });

  it('NOT trusted when pinned deviceId presents a different pubKey (fail closed)', () => {
    expect(isDeviceTrusted(withDevice(), 'aa11', 'dead')).toBe(false);
  });

  it('untrusted for an unknown deviceId even if some device is pinned', () => {
    expect(isDeviceTrusted(withDevice(), 'bb22', 'beef')).toBe(false);
  });
});

describe('policy', () => {
  it('requiresRemoteForSend only when enabled AND require_remote', () => {
    let s = defaultRemoteSigningSettings();
    expect(requiresRemoteForSend(s)).toBe(false);
    s = setPolicy(s, 'require_remote');
    expect(requiresRemoteForSend(s)).toBe(false); // still disabled
    s = setEnabled(s, true);
    expect(requiresRemoteForSend(s)).toBe(true);
    s = setPolicy(s, 'ask');
    expect(requiresRemoteForSend(s)).toBe(false);
  });
});

describe('reducers are pure and correct', () => {
  it('trustDevice pins with the observed pubKey + timestamp, does not mutate input', () => {
    const base = defaultRemoteSigningSettings();
    const next = trustDevice(base, DEV, 4242);
    expect(base.trustedDevices).toEqual({}); // unchanged
    expect(next.trustedDevices['aa11']).toEqual({
      deviceId: 'aa11', pubKey: 'beef', label: 'iPhone', platform: 'ios', trustedAt: 4242, verified: false,
    });
    expect(hasTrustedDevice(next)).toBe(true);
  });

  it('re-trusting the same deviceId re-pins the new pubKey', () => {
    const s = trustDevice(withDevice(), { ...DEV, pubKey: 'f00d' }, 2000);
    expect(s.trustedDevices['aa11'].pubKey).toBe('f00d');
    expect(isDeviceTrusted(s, 'aa11', 'f00d')).toBe(true);
    expect(isDeviceTrusted(s, 'aa11', 'beef')).toBe(false);
  });

  it('untrustDevice removes and is idempotent, does not mutate input', () => {
    const trusted = withDevice();
    const removed = untrustDevice(trusted, 'aa11');
    expect(trusted.trustedDevices['aa11']).toBeDefined(); // unchanged
    expect(removed.trustedDevices['aa11']).toBeUndefined();
    expect(untrustDevice(removed, 'aa11')).toBe(removed); // idempotent, same ref
  });
});

describe('trustDevice captures signing-capability', () => {
  it('persists hasSigningKey when supplied', () => {
    const s = trustDevice(defaultRemoteSigningSettings(), { ...DEV, hasSigningKey: true }, 1000);
    expect(s.trustedDevices['aa11'].hasSigningKey).toBe(true);
  });

  it('leaves hasSigningKey undefined for a legacy-style pin (no flag supplied)', () => {
    const s = trustDevice(defaultRemoteSigningSettings(), DEV, 1000);
    expect(s.trustedDevices['aa11'].hasSigningKey).toBeUndefined();
  });
});

describe('persistent signer selection (offline-capable, for the wake path)', () => {
  const signer = { deviceId: 'aa11', pubKey: 'beef', label: 'iPhone', platform: 'ios', hasSigningKey: true };
  const signer2 = { deviceId: 'bb22', pubKey: 'f00d', label: 'iPad', platform: 'ios', hasSigningKey: true };
  const nonSigner = { deviceId: 'cc33', pubKey: 'cafe', label: 'Watchtower', platform: 'extension', hasSigningKey: false };

  it('hasPairedSigner is false with no devices', () => {
    expect(hasPairedSigner(defaultRemoteSigningSettings())).toBe(false);
  });

  it('hasPairedSigner is true for a pinned signing-capable device (even if offline)', () => {
    const s = trustDevice(defaultRemoteSigningSettings(), signer, 1000);
    expect(hasPairedSigner(s)).toBe(true);
  });

  it('treats a legacy pin (hasSigningKey undefined) as capable', () => {
    const s = trustDevice(defaultRemoteSigningSettings(), DEV, 1000); // no hasSigningKey
    expect(hasPairedSigner(s)).toBe(true);
    expect(pairedSigners(s)).toHaveLength(1);
  });

  it('excludes a device explicitly flagged hasSigningKey:false', () => {
    const s = trustDevice(defaultRemoteSigningSettings(), nonSigner, 1000);
    expect(hasPairedSigner(s)).toBe(false);
    expect(soleSignerDeviceId(s)).toBeNull();
  });

  it('soleSignerDeviceId returns the single pinned signer, online or not', () => {
    const s = trustDevice(defaultRemoteSigningSettings(), signer, 1000);
    expect(soleSignerDeviceId(s)).toBe('aa11');
  });

  it('soleSignerDeviceId is null with >1 signer (broadcast; picker is later)', () => {
    let s = trustDevice(defaultRemoteSigningSettings(), signer, 1000);
    s = trustDevice(s, signer2, 1001);
    expect(soleSignerDeviceId(s)).toBeNull();
    expect(hasPairedSigner(s)).toBe(true);
  });

  it('a lone signer alongside a non-signer still resolves to the signer', () => {
    let s = trustDevice(defaultRemoteSigningSettings(), signer, 1000);
    s = trustDevice(s, nonSigner, 1001);
    expect(soleSignerDeviceId(s)).toBe('aa11');
  });
});

describe('pairingFingerprint', () => {
  it('is deterministic and formatted as three 4-hex groups', () => {
    const fp = pairingFingerprint('beef');
    expect(fp).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(pairingFingerprint('beef')).toBe(fp);
  });

  it('differs for different public keys', () => {
    expect(pairingFingerprint('beef')).not.toBe(pairingFingerprint('dead'));
  });
});
