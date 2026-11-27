// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  JUBJUB_NONCE_TAG,
  JUBJUB_SK_TAG,
  hedgedNonce,
  jubjubKeyPair,
  jubjubKeyPairFromChildKey,
  jubjubSecretFromChildKey,
  jubjubSign,
  jubjubVerify,
  scalarFromWideHash,
} from './schnorr';
import { jubjubMulGenerator } from './jubjub';
import { concatBytes, le2ip, le32, utf8Bytes } from './bytes';
import { FIELD_MODULUS, FieldElement, JUBJUB_SCALAR_MODULUS, JubjubSecretKey } from './types';

const RJ = JUBJUB_SCALAR_MODULUS;
const k = (b: number) => new Uint8Array(32).fill(b);
const rand = (b: number) => new Uint8Array(32).fill(b);
const sk = jubjubSecretFromChildKey(k(7));
const pair = jubjubKeyPair(sk);
const digest = 0x1445ac0c53c87abbbddd7b00be0808de55f6e4a36e1946e7ee6be844ee494652n as FieldElement;
const code = (c: string) => expect.objectContaining({ code: c });

describe('schnorr: hash to scalar', () => {
  it('is the wide reduction of BLAKE2b-512 over the tag and the child key', () => {
    const wide = blake2b(concatBytes(utf8Bytes(JUBJUB_SK_TAG), k(7)), { dkLen: 64 });
    expect(sk).toBe(le2ip(wide) % RJ);
    expect(jubjubKeyPairFromChildKey(k(7))).toEqual(pair);
    expect(pair.publicKey).toEqual(jubjubMulGenerator(sk));
  });

  it('refuses a wide hash that reduces to 0', () => {
    expect(() => scalarFromWideHash(new Uint8Array(64))).toThrow(code('ZERO_SCALAR'));
    const rj = new Uint8Array(64);
    rj.set(le32(RJ));
    expect(() => scalarFromWideHash(rj)).toThrow(code('ZERO_SCALAR'));
    const twoRj = new Uint8Array(64);
    twoRj.set(le32(2n * RJ));
    expect(() => scalarFromWideHash(twoRj)).toThrow(code('ZERO_SCALAR'));
    rj[0] += 1;
    expect(scalarFromWideHash(rj)).toBe(1n);
  });

  it('refuses inputs of the wrong size', () => {
    expect(() => scalarFromWideHash(new Uint8Array(32))).toThrow(code('INVALID_SCALAR'));
    expect(() => jubjubSecretFromChildKey(new Uint8Array(31))).toThrow(code('INVALID_CHILD_KEY'));
    expect(() => jubjubKeyPair(0n as JubjubSecretKey)).toThrow(code('INVALID_SCALAR'));
    expect(() => jubjubKeyPair(RJ as JubjubSecretKey)).toThrow(code('INVALID_SCALAR'));
  });
});

describe('schnorr: the hedged nonce', () => {
  it('hashes the tag, LE32(sk), LE32(digest) and rand32', () => {
    const wide = blake2b(concatBytes(utf8Bytes(JUBJUB_NONCE_TAG), le32(sk), le32(digest), rand(1)), { dkLen: 64 });
    expect(hedgedNonce(sk, digest, rand(1))).toBe(le2ip(wide) % RJ);
  });

  it('gives the same signature for the same randomness and another for new randomness', () => {
    const a = jubjubSign(sk, digest, rand(1));
    expect(jubjubSign(sk, digest, rand(1))).toEqual(a);
    expect(jubjubSign(sk, digest, rand(2)).announcement).not.toEqual(a.announcement);
    expect(jubjubSign(sk, (digest + 1n) as FieldElement, rand(1)).announcement).not.toEqual(a.announcement);
  });

  it('draws fresh randomness by default', () => {
    const a = jubjubSign(sk, digest);
    const b = jubjubSign(sk, digest);
    expect(a.announcement).not.toEqual(b.announcement);
    expect(jubjubVerify(pair.publicKey, digest, a)).toBe(true);
    expect(jubjubVerify(pair.publicKey, digest, b)).toBe(true);
  });

  it('refuses bad inputs', () => {
    expect(() => hedgedNonce(sk, digest, new Uint8Array(31))).toThrow(code('INVALID_RANDOMNESS'));
    expect(() => jubjubSign(sk, FIELD_MODULUS as FieldElement, rand(1))).toThrow(code('INVALID_FIELD_ELEMENT'));
    expect(() => jubjubSign(0n as JubjubSecretKey, digest, rand(1))).toThrow(code('INVALID_SCALAR'));
  });
});

describe('schnorr: verification', () => {
  const sig = jubjubSign(sk, digest, rand(3));

  it('accepts the signer\'s signature over the digest, at the edges of the field too', () => {
    expect(jubjubVerify(pair.publicKey, digest, sig)).toBe(true);
    for (const d of [0n, 1n, FIELD_MODULUS - 1n] as FieldElement[]) expect(jubjubVerify(pair.publicKey, d, jubjubSign(sk, d, rand(4)))).toBe(true);
  });

  it('refuses another digest, another key, or a changed signature', () => {
    expect(jubjubVerify(pair.publicKey, digest + 1n, sig)).toBe(false);
    expect(jubjubVerify(jubjubKeyPairFromChildKey(k(8)).publicKey, digest, sig)).toBe(false);
    expect(jubjubVerify(pair.publicKey, digest, { ...sig, response: (sig.response + 1n) % RJ })).toBe(false);
    expect(jubjubVerify(pair.publicKey, digest, { ...sig, announcement: jubjubMulGenerator(5n) })).toBe(false);
  });

  it('refuses a response from r_J up, which would otherwise verify', () => {
    expect(jubjubVerify(pair.publicKey, digest, { ...sig, response: sig.response + RJ })).toBe(false);
  });

  it('refuses a digest that is not a field element, a key that fails validation, and garbage', () => {
    expect(jubjubVerify(pair.publicKey, digest + FIELD_MODULUS, sig)).toBe(false);
    expect(jubjubVerify({ x: 0n, y: 1n }, digest, sig)).toBe(false);
    expect(jubjubVerify(pair.publicKey, digest, { ...sig, announcement: { x: 1n, y: 1n } })).toBe(false);
    expect(jubjubVerify(pair.publicKey, digest, undefined as never)).toBe(false);
    expect(jubjubVerify(pair.publicKey, digest, { announcement: sig.announcement, response: 5 as unknown as bigint })).toBe(false);
  });
});
