// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import { MDS, ROUND_CONSTANTS } from './poseidonConstants';
import { bytes32Fields, fieldElement, fieldElementFromHex, fieldElementToHex, transientHash, transientHashWords } from './poseidon';
import { le2ip } from './bytes';
import { FIELD_MODULUS, FieldElement } from './types';

/** Deterministic pseudo-random bytes for the cross-checks (not for keys). */
function stream(seed: number): (n: number) => Uint8Array {
  let state = createHash('sha256').update(`poseidon-spec|${seed}`).digest();
  let buf = Buffer.alloc(0);
  return n => {
    while (buf.length < n) {
      state = createHash('sha256').update(state).digest();
      buf = Buffer.concat([buf, state]);
    }
    const out = Uint8Array.from(buf.subarray(0, n));
    buf = buf.subarray(n);
    return out;
  };
}

const FIELD = { tag: 'atom', value: { tag: 'field' } } as const;
const BYTES32 = { tag: 'atom', value: { tag: 'bytes', length: 32 } } as const;

/** A Bytes<n> value atom as the runtime writes it: trailing zero bytes dropped. */
function bytesAtom(b: Uint8Array): Uint8Array {
  let end = b.length;
  while (end > 0 && b[end - 1] === 0) end--;
  return b.slice(0, end);
}

const ledgerFieldHash = (xs: readonly bigint[]): bigint =>
  ledger.valueToBigInt(ledger.transientHash(xs.map(() => FIELD), xs.flatMap(x => ledger.bigIntToValue(x))));

describe('poseidon: constants', () => {
  it('has 68 rounds of 3 constants and a 3 x 3 MDS, every entry a field element', () => {
    expect(ROUND_CONSTANTS).toHaveLength(68);
    expect(MDS).toHaveLength(3);
    for (const row of [...ROUND_CONSTANTS, ...MDS]) {
      expect(row).toHaveLength(3);
      for (const h of row) expect(BigInt(`0x${h}`) < FIELD_MODULUS).toBe(true);
    }
  });

  it('is pinned: the table hashes to a fixed value', () => {
    const text = [...ROUND_CONSTANTS, ...MDS].map(r => r.join(',')).join('\n');
    expect(createHash('sha256').update(text).digest('hex')).toBe('50eb5991daf87b1c9f7767cba1f6bb0547c4c4b4cb1bd4400b566d3c1b2e55bf');
  });
});

describe('poseidon: transientHash equals the ledger\'s', () => {
  it('for field vectors of every length from 0 to 12', () => {
    const rnd = stream(1);
    for (let n = 0; n <= 12; n++) {
      for (let trial = 0; trial < 4; trial++) {
        const xs = Array.from({ length: n }, () => le2ip(rnd(32)) % FIELD_MODULUS);
        expect(transientHash(xs)).toBe(ledgerFieldHash(xs));
      }
    }
  });

  it('at the edges of the field', () => {
    for (const xs of [[0n], [FIELD_MODULUS - 1n], [0n, 0n, 0n], [FIELD_MODULUS - 1n, 1n, FIELD_MODULUS - 2n, 0n, 5n]]) {
      expect(transientHash(xs)).toBe(ledgerFieldHash(xs));
    }
  });

  it('for vectors of Bytes<32> words, including words with trailing zeros', () => {
    const rnd = stream(2);
    for (let n = 1; n <= 8; n++) {
      const words = Array.from({ length: n }, (_, i) => {
        const w = rnd(32);
        if (i % 3 === 1) w.fill(0, 31 - i);
        if (i % 4 === 2) w.fill(0);
        return w;
      });
      const expected = ledger.valueToBigInt(ledger.transientHash(words.map(() => BYTES32), words.map(bytesAtom)));
      expect(transientHashWords(words)).toBe(expected);
    }
  });

  it('for a struct mixing Bytes<32> and Field members', () => {
    const rnd = stream(3);
    const a = rnd(32);
    const x = le2ip(rnd(32)) % FIELD_MODULUS;
    const b = rnd(32);
    const expected = ledger.valueToBigInt(ledger.transientHash([BYTES32, FIELD, BYTES32], [bytesAtom(a), ...ledger.bigIntToValue(x), bytesAtom(b)]));
    expect(transientHash([...bytes32Fields(a), x, ...bytes32Fields(b)])).toBe(expected);
  });
});

describe('poseidon: inputs', () => {
  it('refuses a value that is not a field element', () => {
    for (const bad of [FIELD_MODULUS, -1n]) expect(() => transientHash([bad])).toThrow(expect.objectContaining({ code: 'INVALID_FIELD_ELEMENT' }));
    expect(() => transientHash([1 as unknown as bigint])).toThrow(expect.objectContaining({ code: 'INVALID_FIELD_ELEMENT' }));
    expect(() => bytes32Fields(new Uint8Array(31))).toThrow(expect.objectContaining({ code: 'INVALID_FIELD_ELEMENT' }));
  });

  it('writes a Bytes<32> word as its last byte, then its first 31 bytes little-endian', () => {
    const w = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const [hi, lo] = bytes32Fields(w);
    expect(hi).toBe(32n);
    expect(lo).toBe(le2ip(w.subarray(0, 31)));
  });

  it('round-trips a field element through 32 little-endian bytes of hex, refusing anything not below the modulus', () => {
    const x = fieldElement(0x1445ac0c53c87abbbddd7b00be0808de55f6e4a36e1946e7ee6be844ee494652n);
    const hex = fieldElementToHex(x);
    expect(hex.slice(0, 2)).toBe('52');
    expect(fieldElementFromHex(hex)).toBe(x);
    const p = Buffer.alloc(32);
    let v = FIELD_MODULUS;
    for (let i = 0; i < 32; i++) {
      p[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    expect(fieldElementFromHex(p.toString('hex'))).toBeUndefined();
    expect(fieldElementFromHex(hex.toUpperCase())).toBeUndefined();
    expect(fieldElementFromHex(hex.slice(2))).toBeUndefined();
    expect(() => fieldElementToHex(FIELD_MODULUS as FieldElement)).toThrow(expect.objectContaining({ code: 'INVALID_FIELD_ELEMENT' }));
  });
});
