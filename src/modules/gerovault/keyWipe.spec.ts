// Deriving a vault key from a root key overwrites every private key on the way, and the last one
// once it has been used, even when its use throws.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { withDerivedKey } from './keyWipe';

const H = 0x80000000;
const PATH = [H + 1854, H + 1815, H, 0, 4];
let rootBytes: Uint8Array;

beforeAll(async () => {
  await ready();
  rootBytes = Uint8Array.from(Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 9), '').bytes());
});

/** Every key `derive` hands back while `work` runs. */
function capture(work: () => unknown): Bip32PrivateKey[] {
  const real = Bip32PrivateKey.prototype.derive;
  const made: Bip32PrivateKey[] = [];
  const spy = vi.spyOn(Bip32PrivateKey.prototype, 'derive').mockImplementation(function (this: Bip32PrivateKey, path: number[]) {
    const key = real.call(this, path);
    made.push(key);
    return key;
  });
  try {
    work();
  } catch {
    // The caller checks what was wiped.
  } finally {
    spy.mockRestore();
  }
  return made;
}

describe('withDerivedKey', () => {
  it('gives the same key as a one-step derivation, then leaves every derived key zero', () => {
    const expected = Bip32PrivateKey.fromBytes(Uint8Array.from(rootBytes)).derive(PATH).toPublic().hex();
    let got = '';
    const root = Bip32PrivateKey.fromBytes(Uint8Array.from(rootBytes));
    const made = capture(() => { got = withDerivedKey(root, PATH, key => key.toPublic().hex()); });
    expect(got).toBe(expected);
    expect(made).toHaveLength(PATH.length);
    for (const key of made) expect(key.bytes().every(byte => byte === 0)).toBe(true);
    // The root stays the caller's.
    expect(root.bytes()).toEqual(rootBytes);
  });

  it('wipes the last key when its use throws', () => {
    const root = Bip32PrivateKey.fromBytes(Uint8Array.from(rootBytes));
    const made = capture(() => withDerivedKey(root, PATH, () => { throw new Error('refused'); }));
    expect(made).toHaveLength(PATH.length);
    for (const key of made) expect(key.bytes().every(byte => byte === 0)).toBe(true);
  });
});
