import { describe, it, expect } from 'vitest';
import { emptyRegistry, applyDevicesSnapshot, pubKeyOf, checkProverEcho } from './deviceRegistry';
import type { DeviceInfo, DevicesSnapshot } from './protocol';

const snap = (over: Partial<DevicesSnapshot> = {}): DevicesSnapshot => ({
  type: 'DEVICES',
  devices: [
    { deviceId: 'dev1', label: 'Chrome', platform: 'extension', pubKey: 'aa'.repeat(32), hasSigningKey: false },
    { deviceId: 'dev2', label: 'iPhone', platform: 'ios', pubKey: 'bb'.repeat(32), hasSigningKey: true },
  ],
  ...over,
});

describe('deviceRegistry', () => {
  it('resolves a device pubkey after applying a snapshot', () => {
    const reg = applyDevicesSnapshot(emptyRegistry(), snap());
    expect(pubKeyOf(reg, 'dev2')).toBe('bb'.repeat(32));
  });

  it('returns null for an unknown device (unverifiable => dropped by the service)', () => {
    expect(pubKeyOf(emptyRegistry(), 'ghost')).toBeNull();
    const reg = applyDevicesSnapshot(emptyRegistry(), snap());
    expect(pubKeyOf(reg, 'ghost')).toBeNull();
  });

  it('a later snapshot fully replaces the registry (server sends the full list)', () => {
    const first = applyDevicesSnapshot(emptyRegistry(), snap());
    const second = applyDevicesSnapshot(first, {
      type: 'DEVICES',
      devices: [{ deviceId: 'dev3', label: 'Pixel', platform: 'android', pubKey: 'cc'.repeat(32), hasSigningKey: true }],
    });
    expect(pubKeyOf(second, 'dev1')).toBeNull(); // removed
    expect(pubKeyOf(second, 'dev3')).toBe('cc'.repeat(32));
  });

  it('tolerates a duplicate deviceId in a snapshot (last wins, no throw) - parity with iOS', () => {
    // iOS Dictionary(uniqueKeysWithValues:) would trap on a dup; the extension
    // is last-wins by construction. Both clients must agree: never crash.
    const reg = applyDevicesSnapshot(emptyRegistry(), {
      type: 'DEVICES',
      devices: [
        { deviceId: 'dev1', label: 'old', platform: 'extension', pubKey: 'aa'.repeat(32), hasSigningKey: false },
        { deviceId: 'dev1', label: 'new', platform: 'ios', pubKey: 'dd'.repeat(32), hasSigningKey: true },
      ],
    });
    expect(pubKeyOf(reg, 'dev1')).toBe('dd'.repeat(32)); // last wins
  });
});

// gero-sync Q1b, answered empirically from a running client rather than by
// waiting on the relay team. The relay echoes this device back in every DEVICES
// snapshot, so advertising hasProver and inspecting our own entry is a free
// round-trip test of whether unknown DeviceInfo fields survive the fan-out.
describe('checkProverEcho (Q1b detector)', () => {
  const ADVERTISED = { hasProver: true, proverLedgerVersion: '8.1.0' };
  const self = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
    deviceId: 'self-dev', label: 'Gero Extension', platform: 'extension',
    pubKey: 'ee'.repeat(32), hasSigningKey: true, ...over,
  });
  const withSelf = (d: DeviceInfo) =>
    applyDevicesSnapshot(emptyRegistry(), { type: 'DEVICES', devices: [d] });

  it('is not_advertised when this device does not offer to prove', () => {
    expect(checkProverEcho(withSelf(self()), 'self-dev', undefined)).toBe('not_advertised');
    expect(checkProverEcho(withSelf(self()), 'self-dev', { hasProver: false, proverLedgerVersion: '8.1.0' }))
      .toBe('not_advertised');
  });

  it('is self_absent before our own registration lands in a snapshot', () => {
    expect(checkProverEcho(emptyRegistry(), 'self-dev', ADVERTISED)).toBe('self_absent');
  });

  it('confirms when the relay preserves both fields', () => {
    const reg = withSelf(self({ hasProver: true, proverLedgerVersion: '8.1.0' }));
    expect(checkProverEcho(reg, 'self-dev', ADVERTISED)).toBe('confirmed');
  });

  // The failure this whole function exists to make visible: no error is raised
  // anywhere, the desktop serves fine, the phone just never asks.
  it('detects a relay that strips unknown fields', () => {
    expect(checkProverEcho(withSelf(self()), 'self-dev', ADVERTISED)).toBe('stripped');
  });

  it('detects a relay that preserves the flag but drops the version', () => {
    const reg = withSelf(self({ hasProver: true }));
    expect(checkProverEcho(reg, 'self-dev', ADVERTISED)).toBe('stripped');
  });

  it('detects a relay that rewrites the version', () => {
    const reg = withSelf(self({ hasProver: true, proverLedgerVersion: '9.0.0' }));
    expect(checkProverEcho(reg, 'self-dev', ADVERTISED)).toBe('stripped');
  });
});
