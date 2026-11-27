/**
 * Compact's `transientHash`, in plain TypeScript: Midnight's Poseidon sponge over BLS12-381's
 * scalar field, as the ledger computes it off chain (midnight-zk `PoseidonChip::hash`).
 *
 * - Permutation: width 3, 8 full rounds (4 before and 4 after 60 partial ones), S-box `x^5`; a
 *   partial round raises only the last state element. Before the first round the first round's
 *   constants are added; each round is S-box, then `state = MDS * state + constants of the next
 *   round` (zero after the last). That is the standard Poseidon permutation written with shifted
 *   round constants, as midnight-zk writes it.
 * - Sponge for a fixed-length input of `n` elements: the state starts as `[0, 0, n]`; each chunk
 *   of two inputs (the last one may be a single input) is added into the first two elements and
 *   permuted; the result is the first element.
 *
 * `transientHash<T>(value)` hashes the field representation of `value`: a `Field` is one element;
 * `Bytes<32>` is two, the last byte first and then the first 31 bytes as a little-endian number
 * (`bytes32Fields`); a struct or vector is its members in order.
 */
import { MDS, ROUND_CONSTANTS } from './poseidonConstants';
import { MidnightKeyError } from './errors';
import { FIELD_MODULUS, FieldElement } from './types';
import { fromHex, le2ip, le32, toHex } from './bytes';

const P = FIELD_MODULUS;
const FULL_ROUNDS = 8;
const PARTIAL_ROUNDS = 60;
const ROUNDS = FULL_ROUNDS + PARTIAL_ROUNDS;

const big = (h: string): bigint => BigInt(`0x${h}`);
const RC: readonly (readonly bigint[])[] = ROUND_CONSTANTS.map(r => r.map(big));
const M: readonly (readonly bigint[])[] = MDS.map(r => r.map(big));
if (RC.length !== ROUNDS || M.length !== 3) throw new Error('Poseidon constants have the wrong shape');

const pow5 = (x: bigint): bigint => {
  const x2 = (x * x) % P;
  return (((x2 * x2) % P) * x) % P;
};

function permute(state: bigint[]): void {
  for (let i = 0; i < 3; i++) state[i] = (state[i] + RC[0][i]) % P;
  for (let round = 0; round < ROUNDS; round++) {
    if (round < FULL_ROUNDS / 2 || round >= FULL_ROUNDS / 2 + PARTIAL_ROUNDS) {
      for (let i = 0; i < 3; i++) state[i] = pow5(state[i]);
    } else {
      state[2] = pow5(state[2]);
    }
    const next = round === ROUNDS - 1 ? [0n, 0n, 0n] : RC[round + 1];
    const [a, b, c] = state;
    for (let i = 0; i < 3; i++) state[i] = (next[i] + M[i][0] * a + M[i][1] * b + M[i][2] * c) % P;
  }
}

export function isFieldElement(x: unknown): x is FieldElement {
  return typeof x === 'bigint' && x >= 0n && x < P;
}

/** `x` as a `FieldElement`. Throws `MidnightKeyError('INVALID_FIELD_ELEMENT')` when `x` is not below the modulus. */
export function fieldElement(x: bigint): FieldElement {
  if (!isFieldElement(x)) throw new MidnightKeyError('INVALID_FIELD_ELEMENT', 'A field element is an integer from 0 below the BLS12-381 scalar modulus');
  return x;
}

/** `transientHash` of a sequence of field elements. Throws for an element that is not one. */
export function transientHash(elements: readonly bigint[]): FieldElement {
  const state = [0n, 0n, BigInt(elements.length)];
  for (let i = 0; i < elements.length; i += 2) {
    state[0] = (state[0] + fieldElement(elements[i])) % P;
    if (i + 1 < elements.length) state[1] = (state[1] + fieldElement(elements[i + 1])) % P;
    permute(state);
  }
  return state[0] as FieldElement;
}

/** The two field elements of a `Bytes<32>` value: its last byte, then its first 31 bytes as a little-endian number. */
export function bytes32Fields(bytes: Uint8Array): readonly [FieldElement, FieldElement] {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw new MidnightKeyError('INVALID_FIELD_ELEMENT', 'A Bytes<32> word is 32 bytes');
  return [BigInt(bytes[31]) as FieldElement, le2ip(bytes.subarray(0, 31)) as FieldElement];
}

/** `transientHash<Vector<n, Bytes<32>>>` of 32-byte words, the hash every vault statement uses. */
export function transientHashWords(words: readonly Uint8Array[]): FieldElement {
  return transientHash(words.flatMap(w => bytes32Fields(w)));
}

/** A field element as 32 bytes little-endian, lowercase hex: the form request and approval files use. */
export function fieldElementToHex(x: FieldElement): string {
  return toHex(le32(fieldElement(x)));
}

/** The field element 32 little-endian bytes of lowercase hex name; `undefined` when not hex of 32 bytes or not below the modulus. */
export function fieldElementFromHex(hex: unknown): FieldElement | undefined {
  const bytes = fromHex(hex, 32);
  if (!bytes) return undefined;
  const x = le2ip(bytes);
  return isFieldElement(x) ? x : undefined;
}
