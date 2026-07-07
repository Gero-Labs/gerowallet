import { describe, it, expect } from 'vitest';
import { loadOrCreateDeviceIdentity, type IdentityStorage } from './deviceIdentityStore';
import { deviceIdFromPubKey, isDeviceIdConsistent } from './deviceIdentity';

function memStorage(seed: Record<string, unknown> = {}): IdentityStorage {
  const store: Record<string, unknown> = { ...seed };
  return {
    get: async (k) => store[k],
    set: async (k, v) => { store[k] = v; },
  };
}

describe('loadOrCreateDeviceIdentity', () => {
  it('creates a self-consistent identity on first use and persists it', async () => {
    const storage = memStorage();
    const id = await loadOrCreateDeviceIdentity(storage);
    expect(id.deviceId).toBe(deviceIdFromPubKey(id.pubKeyHex));
    expect(id.privKeyHex).toMatch(/^[0-9a-f]+$/);
    // persisted
    const again = await storage.get('crossDeviceIdentity');
    expect(again).toEqual(id);
  });

  it('returns the SAME identity across calls (stable across logins)', async () => {
    const storage = memStorage();
    const a = await loadOrCreateDeviceIdentity(storage);
    const b = await loadOrCreateDeviceIdentity(storage);
    expect(b).toEqual(a);
  });

  it('regenerates when the stored value is corrupt or tampered (id/key mismatch)', async () => {
    const storage = memStorage({
      crossDeviceIdentity: { deviceId: 'not-derived-from-key', privKeyHex: 'aa', pubKeyHex: 'beef' },
    });
    const id = await loadOrCreateDeviceIdentity(storage);
    expect(id.deviceId).toBe(deviceIdFromPubKey(id.pubKeyHex)); // fresh, consistent
    expect(id.deviceId).not.toBe('not-derived-from-key');
  });
});

describe('isDeviceIdConsistent (fail-closed pairing guard)', () => {
  it('true when the id derives from the key', () => {
    const pub = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
    expect(isDeviceIdConsistent(deviceIdFromPubKey(pub), pub)).toBe(true);
  });
  it('false when the id does not match the key (relay-injected key attempt)', () => {
    expect(isDeviceIdConsistent('deadbeefdeadbeefdeadbeefdeadbeef', 'beef')).toBe(false);
  });
  it('false on malformed input', () => {
    expect(isDeviceIdConsistent('x', 'zz')).toBe(false);
  });
});
