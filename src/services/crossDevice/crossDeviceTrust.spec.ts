import { describe, it, expect } from 'vitest';
import {
  defaultRemoteSigningSettings,
  isDeviceTrusted,
  requiresRemoteForSend,
  hasTrustedDevice,
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
      deviceId: 'aa11', pubKey: 'beef', label: 'iPhone', platform: 'ios', trustedAt: 4242,
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
