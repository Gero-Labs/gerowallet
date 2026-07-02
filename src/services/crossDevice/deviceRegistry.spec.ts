import { describe, it, expect } from 'vitest';
import { emptyRegistry, applyDevicesSnapshot, pubKeyOf } from './deviceRegistry';
import type { DevicesSnapshot } from './protocol';

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
