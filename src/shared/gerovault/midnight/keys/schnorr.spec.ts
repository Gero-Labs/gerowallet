// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  JUBJUB_NONCE_TAG,
  JUBJUB_SK_TAG,
  checkJubjubSignature,
  hedgedNonce,
  jubjubChallenge,
  jubjubKeyPair,
  jubjubKeyPairFromChildKey,
  jubjubSecretFromChildKey,
  jubjubSign,
  jubjubVerify,
  scalarFromWideHash,
} from './schnorr';
import { jubjubMulGenerator } from './jubjub';
import { guardianSalt } from './guardian';
import { concatBytes, le2ip, le32, utf8Bytes } from './bytes';
import { FIELD_MODULUS, FieldElement, JUBJUB_SCALAR_MODULUS, JubjubPoint, JubjubSecretKey } from './types';
import { G, TORSION, addPoints, mulPoint, pointsEqual } from './__fixtures__/torsion';

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

  it('leaves the caller\'s child key alone (only internal copies are wiped)', () => {
    const child = k(9);
    jubjubSecretFromChildKey(child);
    guardianSalt(child);
    expect(child).toEqual(k(9));
    const r = rand(6);
    hedgedNonce(sk, digest, r);
    expect(r).toEqual(rand(6));
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

  it('refuses a response from r_J up: s + r_J is the same scalar, and a signature has one form only', () => {
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

describe('schnorr: why a signature is refused, each check pinned by its own reason', () => {
  const sig = jubjubSign(sk, digest, rand(3));
  const ok = { ok: true };
  const refused = (c: string) => ({ ok: false, code: c });

  it('accepts a good signature and calls a wrong one a mismatch', () => {
    expect(checkJubjubSignature(pair.publicKey, digest, sig)).toEqual(ok);
    expect(checkJubjubSignature(pair.publicKey, digest + 1n, sig)).toEqual(refused('MISMATCH'));
    expect(checkJubjubSignature(pair.publicKey, digest, { ...sig, response: (sig.response + 1n) % RJ })).toEqual(refused('MISMATCH'));
  });

  it('refuses a response from r_J up, and a negative one, as out of range', () => {
    for (const response of [sig.response + RJ, RJ, RJ + 1n, -1n, sig.response - RJ]) {
      expect(checkJubjubSignature(pair.publicKey, digest, { ...sig, response })).toEqual(refused('RESPONSE_OUT_OF_RANGE'));
    }
  });

  it('refuses an announcement off the curve, and the same announcement written with x or y plus the modulus', () => {
    const R = sig.announcement;
    for (const announcement of [{ x: R.x, y: R.y + 1n }, { x: 1n, y: 1n }, { x: R.x + FIELD_MODULUS, y: R.y }, { x: R.x, y: R.y + FIELD_MODULUS }, { x: -1n, y: R.y }]) {
      expect(checkJubjubSignature(pair.publicKey, digest, { ...sig, announcement })).toEqual(refused('ANNOUNCEMENT_NOT_ON_CURVE'));
    }
  });

  it('refuses a key that fails point validation', () => {
    expect(checkJubjubSignature({ x: 0n, y: 1n }, digest, sig)).toEqual(refused('INVALID_KEY'));
    expect(checkJubjubSignature(TORSION[4], digest, sig)).toEqual(refused('INVALID_KEY'));
    expect(checkJubjubSignature(undefined, digest, sig)).toEqual(refused('INVALID_KEY'));
  });

  it('refuses a digest that is not a field element, and anything that is not a signature', () => {
    for (const d of [FIELD_MODULUS, -1n, 5]) expect(checkJubjubSignature(pair.publicKey, d, sig)).toEqual(refused('DIGEST_NOT_A_FIELD_ELEMENT'));
    for (const bad of [undefined, null, 'sig', {}, { announcement: sig.announcement }, { response: sig.response }, { announcement: { x: 1, y: 2 }, response: sig.response }, { ...sig, response: 5 }]) {
      expect(checkJubjubSignature(pair.publicKey, digest, bad)).toEqual(refused('MALFORMED'));
    }
  });

  it('reads the key, the announcement and the response once each, and computes on those copies', () => {
    const reads: Record<string, number> = {};
    const once = <T>(name: string, value: T, later: T) => () => {
      reads[name] = (reads[name] ?? 0) + 1;
      return reads[name] === 1 ? value : later;
    };
    const point = (name: string, p: JubjubPoint, later: JubjubPoint) =>
      Object.defineProperties({}, { x: { get: once(`${name}.x`, p.x, later.x) }, y: { get: once(`${name}.y`, p.y, later.y) } }) as JubjubPoint;
    const shiftyKey = point('pk', pair.publicKey, { x: 0n, y: 1n });
    const shiftySig = Object.defineProperties({}, {
      announcement: { get: once('announcement', point('R', sig.announcement, { x: 0n, y: 1n }), { x: 0n, y: 1n }) },
      response: { get: once('response', sig.response, sig.response + RJ) },
    }) as typeof sig;
    expect(checkJubjubSignature(shiftyKey, digest, shiftySig)).toEqual(ok);
    expect(reads).toEqual({ 'pk.x': 1, 'pk.y': 1, announcement: 1, 'R.x': 1, 'R.y': 1, response: 1 });
  });
});

describe('schnorr: no signature verifies under a key that fails validation', () => {
  // A key a*G + t, with t of small order (the identity when a = 0 and t = O), and a forger who
  // knows a. For an announcement R = k*G + t' and the response s = k + a*c, the verification
  // equation s*G = R + c*pk holds exactly when t' + c*t = O: always for the identity (t' = O),
  // and for some of the 8 choices of t' under every other torsion component. Only the key check
  // stops these, so each case also asserts that at least one forgery satisfies the equation.
  const cases: { name: string; a: bigint; t: JubjubPoint }[] = [
    { name: 'the identity', a: 0n, t: TORSION[0] },
    ...TORSION.slice(1).map((t, i) => ({ name: `the torsion point [${i + 1}]T8`, a: 0n, t })),
    ...TORSION.slice(1).map((t, i) => ({ name: `3*G plus the torsion point [${i + 1}]T8`, a: 3n, t })),
  ];

  for (const { name, a, t } of cases) {
    it(`refuses every forgery under ${name}`, () => {
      const pk = a === 0n ? t : addPoints(mulPoint(G, a), t);
      const forgeries: { announcement: JubjubPoint; response: bigint }[] = [];
      const others: { announcement: JubjubPoint; response: bigint }[] = [];
      for (let kk = 1n; kk <= 10n; kk++) {
        for (const tp of TORSION) {
          const R = addPoints(mulPoint(G, kk), tp);
          const c = jubjubChallenge(R, pk, digest);
          const s = (kk + a * c) % RJ;
          const holds = pointsEqual(mulPoint(G, s), addPoints(R, mulPoint(pk, c)));
          (holds ? forgeries : others).push({ announcement: R, response: s });
        }
      }
      // The forgeries are real: they satisfy the equation, and only the key check refuses them.
      expect(forgeries.length).toBeGreaterThan(0);
      for (const f of forgeries) expect(jubjubVerify(pk, digest, f)).toBe(false);
      for (const f of [...forgeries, ...others]) expect(checkJubjubSignature(pk, digest, f)).toEqual({ ok: false, code: 'INVALID_KEY' });
    });
  }
});
