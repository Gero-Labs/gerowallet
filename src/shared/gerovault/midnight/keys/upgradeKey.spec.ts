// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { schnorr } from '@noble/curves/secp256k1.js';
import { isUpgradePublicKey, signUpgrade, upgradeKeyPairFromChildKey, upgradePublicKey, verifyUpgrade } from './upgradeKey';
import { fromHex, toHex } from './bytes';

/** The freeze's preprod upgrade child key 1 (from the public test phrase). */
const K = fromHex('c8d47be33ce3d1240349fb1ab4d2947665ff641323462cbf9490644102e7d166') as Uint8Array;
const XONLY = 'ed01213c563074e6a4fdc29571a3aa0f6a3e538fa4517b3ca542da9479a08d8a';
const data = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff);

describe('upgradeKey: the key pair', () => {
  it('is the child key itself, with the ledger\'s x-only verifying key', () => {
    const pair = upgradeKeyPairFromChildKey(K);
    expect(pair.publicKey).toBe(XONLY);
    expect(ledger.signatureVerifyingKey({ tag: 'schnorr', value: toHex(K) })).toEqual({ tag: 'schnorr', value: XONLY });
    expect(toHex(pair.secretKey)).toBe(toHex(K));
    expect(pair.secretKey).not.toBe(K);
  });

  it('refuses a child key of the wrong size or outside secp256k1', () => {
    expect(() => upgradeKeyPairFromChildKey(new Uint8Array(31))).toThrow(expect.objectContaining({ code: 'INVALID_CHILD_KEY' }));
    expect(() => upgradeKeyPairFromChildKey(new Uint8Array(32))).toThrow(expect.objectContaining({ code: 'INVALID_CHILD_KEY' }));
  });
});

describe('upgradeKey: signatures interoperate with the ledger', () => {
  for (const n of [0, 5, 32, 200]) {
    it(`over ${n} bytes: the ledger verifies ours, and we verify the ledger's`, () => {
      const msg = data(n);
      const ours = signUpgrade(K, msg, new Uint8Array(32).fill(9));
      expect(ledger.verifySignature({ tag: 'schnorr', value: XONLY }, msg, { tag: 'schnorr', value: ours })).toBe(true);
      const theirs = ledger.signData({ tag: 'schnorr', value: toHex(K) }, msg);
      expect(verifyUpgrade(XONLY, msg, theirs.value)).toBe(true);
      expect(verifyUpgrade(XONLY, data(n + 1), theirs.value)).toBe(false);
    });
  }

  it('signs SHA-256 of the data, never the data itself', () => {
    const msg = data(32);
    const raw = toHex(schnorr.sign(msg, K, new Uint8Array(32)));
    expect(verifyUpgrade(XONLY, msg, raw)).toBe(false);
    expect(ledger.verifySignature({ tag: 'schnorr', value: XONLY }, msg, { tag: 'schnorr', value: raw })).toBe(false);
  });

  it('refuses another key, a changed signature, and malformed input', () => {
    const msg = data(40);
    const sig = signUpgrade(K, msg);
    const other = upgradeKeyPairFromChildKey(new Uint8Array(32).fill(3)).publicKey;
    expect(verifyUpgrade(other, msg, sig)).toBe(false);
    expect(verifyUpgrade(XONLY, msg, `${sig.slice(0, 126)}${sig.slice(126) === '00' ? '01' : '00'}`)).toBe(false);
    expect(verifyUpgrade(XONLY, msg, sig.toUpperCase())).toBe(false);
    expect(verifyUpgrade(XONLY, msg, sig.slice(2))).toBe(false);
    expect(verifyUpgrade(XONLY, 'x' as unknown as Uint8Array, sig)).toBe(false);
    expect(() => signUpgrade(K, msg, new Uint8Array(31))).toThrow(expect.objectContaining({ code: 'INVALID_RANDOMNESS' }));
  });
});

describe('upgradeKey: x-only keys', () => {
  it('accepts a key that lifts and refuses one that does not', () => {
    expect(isUpgradePublicKey(XONLY)).toBe(true);
    expect(upgradePublicKey(XONLY)).toBe(XONLY);
    // x = 5: 5^3 + 7 = 132 is not a square mod p, so no point has this x.
    const noPoint = '05'.padStart(64, '0');
    expect(isUpgradePublicKey(noPoint)).toBe(false);
    expect(isUpgradePublicKey('ff'.repeat(32))).toBe(false);
    expect(isUpgradePublicKey('00'.repeat(32))).toBe(false);
    expect(isUpgradePublicKey(XONLY.toUpperCase())).toBe(false);
    expect(isUpgradePublicKey(`02${XONLY}`)).toBe(false);
    expect(() => upgradePublicKey(noPoint)).toThrow(expect.objectContaining({ code: 'INVALID_UPGRADE_KEY' }));
  });
});
