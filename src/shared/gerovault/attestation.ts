/**
 * Attestations by a participant's vault payment key (spec 5.3; the flows are GV-22 #1690), and
 * the strict Ed25519 check every signature of this library goes through.
 *
 * A participant attests each of their device bindings and each removal of one, an owner attests
 * each external cosigner they import and each external attestation they endorse, and an external
 * cosigner attests the vault's verification digest (`verificationNumber.ts`). Every attestation is
 * `{ method, proof }` over one 32-byte digest, and it is stored in exactly one form:
 *
 * - method 0, CIP-8 (anything but an external cosigner's verification): `proof` is the CBOR array
 *   `[ bstr COSE_Sign1, bstr COSE_Key ]`. Stored, the COSE_Sign1 is
 *   `[ protected header bytes as signed, {}, payload, signature ]` and the COSE_Key is exactly
 *   `{ 1: 1, 3: -8, -1: 6, -2: key }`. It verifies when the key hashes to the participant's
 *   credential, the payload is exactly the digest, and the signature verifies over the
 *   Sig_structure (RFC 8152 section 4.4).
 * - method 1, an expired transaction: `proof` is a full signed transaction that no node would ever
 *   accept. Its body means exactly
 *     { 0: [[32 zero bytes, 0]], 1: [], 2: 0, 3: 1, 7: auxiliary data hash, 14: [credential],
 *       15: network id }
 *   (an input that cannot exist, no outputs, no fee, a time to live of slot 1, the credential as
 *   the one required signer, and the vault's network: 1 on mainnet, 0 otherwise, so that a
 *   hardware wallet can show the network of a transaction with no outputs), its witness set is exactly one vkey witness by the vault payment
 *   key, and its auxiliary data is exactly `{ 18541: { k: digest } }`, where `k` names what is
 *   attested: 0 a binding, 1 a verification digest, 2 a device removal, 3 an external import,
 *   4 an endorsement, 5 a cosigner invitation and 6 its acceptance (`invite/PROTOCOL.md`).
 *   Label 1854 is never used, because CIP-0146 wallets scan it for vault
 *   registrations. The body stays byte for byte as signed, so a wallet that tags the input set
 *   and the signer set with 258, or orders the keys its own way, still verifies; its meaning is
 *   checked, not its spelling, and it holds no float or simple value. The wrapper, the witness set
 *   and the auxiliary data are stored as canonical CBOR (definite lengths, no set tags).
 *
 * The parts a signer could inflate are bounded, at ingest and when a stored proof is read: the
 * protected header (`MAX_PROTECTED_HEADER_BYTES`), the address or `kid` signed in it
 * (`MAX_SIGNED_ADDRESS_BYTES`), and the expired transaction's body (`MAX_SIGNED_BODY_BYTES`).
 *
 * `ingestAttestation` takes what a wallet returns (a COSE_Key with or without a `kid`, which must
 * equal the signed address when present, with or without `alg`, in any order; an unprotected
 * `{ hashed: false }`; a tagged COSE_Sign1; a witness set with set tags or indefinite lengths),
 * checks it, and gives the stored form, which never has a `kid`. `verifyAttestation` takes the
 * stored form only, which is what manifests and records keep.
 *
 * Every Ed25519 check here is strict (RFC 8032): a key or an `R` that is not a canonical encoding,
 * is of small order or has a torsion component (mixed order), or an `S` that is not below the
 * group order, is refused before the signature is checked, so verifiers with and without the
 * cofactor agree on every signature. The verifiers never throw.
 *
 * PROVISIONAL: the proof layouts, label 18541, the metadatum keys and the expired transaction
 * body are fixed with the hardware results (GV-06 #1674) and the other clients' vectors (GV-07
 * #1675).
 */
import { Ed25519PublicKey, Ed25519PublicKeyHex, Ed25519Signature, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { ed25519 } from '@noble/curves/ed25519.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { decode as lenientDecode } from 'cborg';
import { CborBoolean, CborError, CborItemOf, CborValueOf, bytesToHex, hexToBytes, readCbor } from './cbor';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { VaultNetwork } from './types';

/** Metadata label of the expired transaction's auxiliary data. Not 1854. */
export const ATTESTATION_LABEL = 18541;
export const ATTESTATION_METHOD = Object.freeze({ CIP8: 0, EXPIRED_TX: 1 } as const);
export const MAX_ATTESTATION_BYTES = 2048;
/**
 * Bounds on the parts of a proof a signer chooses, so that no stored proof is much larger than an
 * honest one: the CIP-8 protected header, the address (or `kid`) signed in it (a Cardano base
 * address is 57 bytes), and the expired transaction's body. The header bound leaves room for a
 * wallet that signs a base address twice, as `kid` and as `address` (130 bytes).
 */
export const MAX_PROTECTED_HEADER_BYTES = 160;
export const MAX_SIGNED_ADDRESS_BYTES = 57;
export const MAX_SIGNED_BODY_BYTES = 512;

export interface OwnerAttestation {
  /** `ATTESTATION_METHOD.CIP8` or `ATTESTATION_METHOD.EXPIRED_TX`. */
  readonly method: number;
  /** The method's proof bytes, lowercase hex. */
  readonly proof: string;
}

/**
 * What an attestation is over: a binding digest, a vault's verification digest (an external
 * cosigner's own attestation), a device removal, an external import, an endorsement digest, or a
 * cosigner invitation and its acceptance (`invite/PROTOCOL.md`).
 */
export interface AttestedDigest {
  readonly kind: 'binding' | 'verification' | 'removal' | 'import' | 'endorsement' | 'invite' | 'inviteAccept';
  /** 32 bytes, lowercase hex. */
  readonly digest: string;
  /** The vault's network, which an expired transaction names (`network_id`); CIP-8 does not use it. */
  readonly network: VaultNetwork;
}

/** The metadatum key of each kind in the expired transaction. */
const DIGEST_KEY = { binding: 0, verification: 1, removal: 2, import: 3, endorsement: 4, invite: 5, inviteAccept: 6 } as const;

export type AttestationRefusalCode =
  | 'INVALID_INPUT'
  | 'UNKNOWN_METHOD'
  | 'METHOD_NOT_ALLOWED'
  | 'MALFORMED_PROOF'
  | 'NOT_CANONICAL'
  | 'UNSUPPORTED_KEY'
  | 'UNSUPPORTED_HEADER'
  | 'WRONG_KEY'
  | 'WRONG_PAYLOAD'
  | 'BAD_SIGNATURE'
  | 'SUBMITTABLE'
  | 'BODY_SHAPE'
  | 'WRONG_SIGNER'
  | 'AUX_HASH_MISMATCH'
  | 'WITNESS_SHAPE'
  | 'WRONG_NETWORK';

export type AttestationCheck = { readonly ok: true } | { readonly ok: false; readonly code: AttestationRefusalCode };

type Item = CborItemOf<CborBoolean>;
type Value = CborValueOf<CborBoolean>;

const LIMITS = { maxDepth: 8, maxItems: 256, booleans: true } as const;
const HEX = /^(?:[0-9a-f]{2})+$/;
const KEY_HASH = /^[0-9a-f]{56}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ZERO_TX_ID = new Uint8Array(32);

class Refusal extends Error {
  constructor(readonly code: AttestationRefusalCode) {
    super(code);
  }
}

const refuse = (code: AttestationRefusalCode): never => {
  throw new Refusal(code);
};

function parse(bytes: Uint8Array): Item {
  try {
    return readCbor(bytes, LIMITS);
  } catch (e) {
    if (e instanceof CborError) refuse('MALFORMED_PROOF');
    throw e;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const blake2b256 = (bytes: Uint8Array) => blake2b(bytes, { dkLen: 32 });
const keyHashOf = (key: Uint8Array) => bytesToHex(blake2b(key, { dkLen: 28 }));

// ---------------------------------------------------------------------------------------------
// Strict Ed25519 (RFC 8032)

// The curve's 8-torsion points by their y coordinate (the sign bit is ignored); the specs check
// them against an independent implementation.
const ED25519_SMALL_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
];
/** The order of the Ed25519 base point. */
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

/** Whether 255 bits, little-endian, are at least p = 2^255 - 19 (a non-canonical field element). */
export function atLeastP(bytes: Uint8Array): boolean {
  if ((bytes[31] & 0x7f) !== 0x7f) return false;
  for (let i = 30; i >= 1; i--) if (bytes[i] !== 0xff) return false;
  return bytes[0] >= 0xed;
}

/** A canonical point encoding of the prime-order subgroup, other than the identity. */
function primeOrderPoint(hex: string): boolean {
  const y = hexToBytes(hex);
  y[31] &= 0x7f;
  if (atLeastP(y) || ED25519_SMALL_ORDER.includes(bytesToHex(y))) return false;
  try {
    return ed25519.Point.fromHex(hex).isTorsionFree();
  } catch {
    return false;
  }
}

// Keys come back on every check of a manifest; the subgroup check costs a scalar multiplication.
const usableKeys = new Map<string, boolean>();
const USABLE_KEYS_CACHED = 4096;

/**
 * An Ed25519 public key: a canonical point encoding, not of small order (the identity among them)
 * and without a torsion component, so it lies in the prime-order subgroup.
 */
export function isUsableEd25519Key(hex: string): boolean {
  if (typeof hex !== 'string' || !DIGEST.test(hex)) return false;
  const known = usableKeys.get(hex);
  if (known !== undefined) return known;
  const usable = primeOrderPoint(hex);
  if (usableKeys.size >= USABLE_KEYS_CACHED) usableKeys.clear();
  usableKeys.set(hex, usable);
  return usable;
}

function scalarBelowOrder(s: Uint8Array): boolean {
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(s[i]);
  return n < GROUP_ORDER;
}

/**
 * Strict Ed25519 verification of `signature` over `message` by `publicKey` (raw bytes): the key and
 * `R` must be canonical points of the prime-order subgroup (`isUsableEd25519Key`) and `S` below
 * the group order. False on any error.
 */
export async function verifyEd25519(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    if (publicKey?.length !== 32 || signature?.length !== 64 || !(message instanceof Uint8Array)) return false;
    if (!isUsableEd25519Key(bytesToHex(publicKey)) || !primeOrderPoint(bytesToHex(signature.subarray(0, 32)))) return false;
    if (!scalarBelowOrder(signature.subarray(32))) return false;
    await ready();
    return Ed25519PublicKey.fromHex(Ed25519PublicKeyHex(bytesToHex(publicKey))).verify(Ed25519Signature.fromBytes(signature), HexBlob(bytesToHex(message)));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading parsed CBOR

function bytesOf(v: Value, length?: number): Uint8Array {
  if (v?.type !== 'bytes' || (length !== undefined && v.value.length !== length)) return refuse('MALFORMED_PROOF');
  return v.value;
}

/** A map's entries by integer or text key. */
function entries(v: Value, onBadKey: AttestationRefusalCode): Map<number | string, Value> {
  if (v?.type !== 'map') return refuse('MALFORMED_PROOF');
  const out = new Map<number | string, Value>();
  for (const [k, value] of v.value) {
    if (k.value.type === 'text') out.set(k.value.value, value.value);
    else if (k.value.type === 'int' && k.value.value >= -1000n && k.value.value <= 1000000n) out.set(Number(k.value.value), value.value);
    else refuse(onBadKey);
  }
  return out;
}

function isInt(v: Value, n: bigint): boolean {
  return v?.type === 'int' && v.value === n;
}

/** A value read by `cborg` at ingest, as the canonical writer writes it. */
function writable(v: unknown, depth = 0): CborWritable {
  if (depth > LIMITS.maxDepth) return refuse('MALFORMED_PROOF');
  if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'string' || typeof v === 'boolean' || v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return v.map(x => writable(x, depth + 1));
  if (v instanceof Map) {
    const out = new Map<number | bigint | string, CborWritable>();
    for (const [k, x] of v) {
      if (typeof k !== 'number' && typeof k !== 'bigint' && typeof k !== 'string') refuse('MALFORMED_PROOF');
      out.set(k as number | bigint | string, writable(x, depth + 1));
    }
    return out;
  }
  return refuse('MALFORMED_PROOF');
}

const DECODE_OPTIONS = { useMaps: true, allowIndefinite: true, allowUndefined: false, rejectDuplicateMapKeys: true } as const;

/** Lenient decoding of what a wallet returned: indefinite lengths, set tags and a COSE_Sign1 tag allowed. */
function lenient(bytes: Uint8Array): unknown {
  const tags: ((inner: unknown) => unknown)[] = [];
  tags[18] = inner => inner;
  tags[258] = inner => inner;
  try {
    return lenientDecode(bytes, { ...DECODE_OPTIONS, tags });
  } catch {
    return refuse('MALFORMED_PROOF');
  }
}

// ---------------------------------------------------------------------------------------------
// Method 0: CIP-8

/** The CIP-8 proof of an attestation as given: `[ bstr COSE_Sign1, bstr COSE_Key ]`, hex. */
export function cip8Proof(coseSign1: string, coseKey: string): string {
  const a = hexToBytes(coseSign1);
  const b = hexToBytes(coseKey);
  if (!a?.length || !b?.length) throw new TypeError('COSE_Sign1 and COSE_Key are hex');
  return bytesToHex(encodeCanonicalCbor([a, b]));
}

const canonicalCoseKey = (x: Uint8Array) => encodeCanonicalCbor(new Map<number, CborWritable>([[1, 1], [3, -8], [-1, 6], [-2, x]]));
const canonicalSign1 = (protectedBytes: Uint8Array, payload: Uint8Array, signature: Uint8Array) =>
  encodeCanonicalCbor([protectedBytes, new Map<number, CborWritable>(), payload, signature]);

/** The signed protected header: alg EdDSA, and optionally a kid and the CIP-30 address, each bounded. */
function protectedHeader(protectedBytes: Uint8Array): { readonly signedId?: Uint8Array } {
  if (protectedBytes.length > MAX_PROTECTED_HEADER_BYTES) refuse('UNSUPPORTED_HEADER');
  const headers = entries(parse(protectedBytes).value, 'UNSUPPORTED_HEADER');
  for (const label of headers.keys()) if (label !== 1 && label !== 4 && label !== 'address') refuse('UNSUPPORTED_HEADER');
  if (!isInt(headers.get(1), -8n)) refuse('UNSUPPORTED_HEADER');
  for (const label of [4, 'address']) if (headers.has(label) && headers.get(label).type !== 'bytes') refuse('UNSUPPORTED_HEADER');
  const kid = headers.has(4) ? bytesOf(headers.get(4)) : undefined;
  const address = headers.has('address') ? bytesOf(headers.get('address')) : undefined;
  if ((kid?.length ?? 0) > MAX_SIGNED_ADDRESS_BYTES || (address?.length ?? 0) > MAX_SIGNED_ADDRESS_BYTES) refuse('UNSUPPORTED_HEADER');
  if (kid && address && !sameBytes(kid, address)) refuse('UNSUPPORTED_HEADER');
  return { signedId: address ?? kid };
}

/** The canonical stored form of a CIP-8 proof a wallet returned, without checking the signature. */
function canonicalCip8(proof: Uint8Array): Uint8Array {
  const root = lenient(proof);
  if (!Array.isArray(root) || root.length !== 2 || !(root[0] instanceof Uint8Array) || !(root[1] instanceof Uint8Array)) refuse('MALFORMED_PROOF');
  const [sign1Bytes, keyBytes] = root as Uint8Array[];
  const sign1 = lenient(sign1Bytes);
  if (!Array.isArray(sign1) || sign1.length !== 4) return refuse('MALFORMED_PROOF');
  const [protectedBytes, unprotected, payload, signature] = sign1;
  if (!(protectedBytes instanceof Uint8Array) || !(payload instanceof Uint8Array) || !(signature instanceof Uint8Array) || signature.length !== 64) {
    refuse('MALFORMED_PROOF');
  }
  if (!(unprotected instanceof Map)) return refuse('MALFORMED_PROOF');
  for (const [label, value] of unprotected) if (label !== 'hashed' || value !== false) refuse('UNSUPPORTED_HEADER');
  const { signedId } = protectedHeader(protectedBytes as Uint8Array);
  const key = lenient(keyBytes);
  if (!(key instanceof Map)) return refuse('UNSUPPORTED_KEY');
  for (const label of key.keys()) if (![1, 2, 3, -1, -2].includes(label as number)) refuse('UNSUPPORTED_KEY');
  if (key.get(1) !== 1 || key.get(-1) !== 6 || (key.has(3) && key.get(3) !== -8)) refuse('UNSUPPORTED_KEY');
  const x = key.get(-2);
  if (!(x instanceof Uint8Array) || x.length !== 32) return refuse('UNSUPPORTED_KEY');
  // The COSE_Key is not signed: a kid must repeat the signed address, then it is dropped.
  if (key.has(2)) {
    const kid = key.get(2);
    if (!(kid instanceof Uint8Array) || !signedId || !sameBytes(kid, signedId)) refuse('UNSUPPORTED_KEY');
  }
  return encodeCanonicalCbor([canonicalSign1(protectedBytes as Uint8Array, payload as Uint8Array, signature as Uint8Array), canonicalCoseKey(x)]);
}

/** The COSE_Key's raw key of a stored CIP-8 proof. */
function cip8Key(proof: Uint8Array): { readonly sign1Bytes: Uint8Array; readonly keyBytes: Uint8Array; readonly x: Uint8Array } {
  const root = parse(proof);
  if (root.value.type !== 'array' || root.value.value.length !== 2) refuse('MALFORMED_PROOF');
  const [sign1Bytes, keyBytes] = (root.value as { value: readonly Item[] }).value.map(i => bytesOf(i.value));
  const key = entries(parse(keyBytes).value, 'UNSUPPORTED_KEY');
  const x = key.get(-2)?.type === 'bytes' ? bytesOf(key.get(-2), 32) : refuse('UNSUPPORTED_KEY');
  return { sign1Bytes, keyBytes, x };
}

async function verifyCip8(proof: Uint8Array, credential: string, digest: Uint8Array): Promise<void> {
  const { sign1Bytes, keyBytes, x } = cip8Key(proof);
  const sign1 = parse(sign1Bytes).value;
  if (sign1.type !== 'array' || sign1.value.length !== 4) return refuse('MALFORMED_PROOF');
  const [protectedItem, , payloadItem, signatureItem] = sign1.value;
  const protectedBytes = bytesOf(protectedItem.value);
  const payload = bytesOf(payloadItem.value);
  const signature = bytesOf(signatureItem.value, 64);
  // The one stored form: anything a wallet may vary is fixed by `ingestAttestation`.
  if (!sameBytes(keyBytes, canonicalCoseKey(x)) || !sameBytes(sign1Bytes, canonicalSign1(protectedBytes, payload, signature))
    || !sameBytes(proof, encodeCanonicalCbor([sign1Bytes, keyBytes]))) {
    refuse('NOT_CANONICAL');
  }
  if (keyHashOf(x) !== credential) refuse('WRONG_KEY');
  protectedHeader(protectedBytes);
  if (!sameBytes(payload, digest)) refuse('WRONG_PAYLOAD');
  const sigStructure = encodeCanonicalCbor(['Signature1', protectedBytes, new Uint8Array(0), payload]);
  if (!(await verifyEd25519(x, signature, sigStructure))) refuse('BAD_SIGNATURE');
}

// ---------------------------------------------------------------------------------------------
// Method 1: an expired transaction

/** How deep the item scanner below follows nested arrays, maps and tags. */
const SCAN_DEPTH = 16;

/** The head of the CBOR item at `at`: major type, argument (-1 for an indefinite length) and where its content starts. */
function head(bytes: Uint8Array, at: number): { readonly major: number; readonly n: number; readonly next: number } {
  if (at >= bytes.length) return refuse('MALFORMED_PROOF');
  const major = bytes[at] >> 5;
  const info = bytes[at] & 0x1f;
  if (info < 24) return { major, n: info, next: at + 1 };
  if (info === 31) return { major, n: -1, next: at + 1 };
  if (info > 27) return refuse('MALFORMED_PROOF');
  const size = 1 << (info - 24);
  if (at + 1 + size > bytes.length) refuse('MALFORMED_PROOF');
  let n = 0;
  for (let i = 1; i <= size; i++) n = n * 256 + bytes[at + i];
  return { major, n, next: at + 1 + size };
}

/**
 * Where the CBOR item at `at` ends, however it is written (indefinite lengths and tags included).
 * With `noSimple`, a float or simple value anywhere in it (major type 7) is refused.
 */
function itemEnd(bytes: Uint8Array, at: number, depth = 0, noSimple = false): number {
  if (depth > SCAN_DEPTH) return refuse('MALFORMED_PROOF');
  const { major, n, next } = head(bytes, at);
  if (n < 0 && (major < 2 || major > 5)) return refuse('MALFORMED_PROOF');
  if (major === 7 && noSimple) return refuse('BODY_SHAPE');
  if (major === 0 || major === 1 || major === 7) return next;
  if (major === 6) return itemEnd(bytes, next, depth + 1, noSimple);
  let p = next;
  if (major === 2 || major === 3) {
    if (n >= 0) return n <= bytes.length - p ? p + n : refuse('MALFORMED_PROOF');
    while (bytes[p] !== 0xff) {
      const chunk = head(bytes, p);
      if (chunk.major !== major || chunk.n < 0) refuse('MALFORMED_PROOF');
      p = itemEnd(bytes, p, depth + 1, noSimple);
    }
    return p + 1;
  }
  const per = major === 5 ? 2 : 1;
  if (n >= 0) {
    if (n * per > bytes.length - p) refuse('MALFORMED_PROOF');
    for (let i = 0; i < n * per; i++) p = itemEnd(bytes, p, depth + 1, noSimple);
    return p;
  }
  let count = 0;
  for (; bytes[p] !== 0xff; count++) p = itemEnd(bytes, p, depth + 1, noSimple);
  return count % per === 0 ? p + 1 : refuse('MALFORMED_PROOF');
}

/** The four parts of a transaction, as written: body, witness set, validity flag, auxiliary data. */
function transactionParts(proof: Uint8Array): readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array] {
  const { major, n, next } = head(proof, 0);
  if (major !== 4 || (n !== 4 && n !== -1)) return refuse('MALFORMED_PROOF');
  const parts: Uint8Array[] = [];
  let p = next;
  for (let i = 0; i < 4; i++) {
    if (n < 0 && proof[p] === 0xff) refuse('MALFORMED_PROOF');
    const end = itemEnd(proof, p);
    parts.push(proof.subarray(p, end));
    p = end;
  }
  if (n < 0) p = proof[p] === 0xff ? p + 1 : refuse('MALFORMED_PROOF');
  if (p !== proof.length) refuse('MALFORMED_PROOF');
  return parts as unknown as readonly [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

/** A set written with tag 258 in a signed body: allowed for the inputs and the required signers only. */
class TaggedSet {
  constructor(readonly items: unknown) {}
}

/**
 * A signed body as the wallet wrote it, decoded: any lengths, integer widths and key order, and tag
 * 258 only. It holds integers, byte strings, arrays and maps: a float or simple value anywhere is
 * refused, since a decoder would read `1.0` as the integer 1. At most `MAX_SIGNED_BODY_BYTES`.
 */
function signedBody(bytes: Uint8Array): Map<unknown, unknown> {
  if (bytes.length > MAX_SIGNED_BODY_BYTES) refuse('BODY_SHAPE');
  if (itemEnd(bytes, 0, 0, true) !== bytes.length) refuse('MALFORMED_PROOF');
  const tags: ((inner: unknown) => unknown)[] = [];
  tags[258] = inner => new TaggedSet(inner);
  let body: unknown;
  try {
    body = lenientDecode(bytes, { ...DECODE_OPTIONS, tags });
  } catch {
    return refuse('MALFORMED_PROOF');
  }
  return body instanceof Map ? body : refuse('MALFORMED_PROOF');
}

const BODY_KEYS = [0, 1, 2, 3, 7, 14, 15];
const isNumber = (v: unknown, n: number) => (typeof v === 'number' && v === n) || (typeof v === 'bigint' && v === BigInt(n));
const setItems = (v: unknown): unknown => (v instanceof TaggedSet ? v.items : v);

/** The body must mean exactly the unsubmittable transaction for `credential` on `network` with this auxiliary data. */
function checkSignedBody(body: Map<unknown, unknown>, credential: string, auxBytes: Uint8Array, network: VaultNetwork): void {
  const ttl = body.get(3);
  if (ttl === undefined || ((typeof ttl === 'number' || typeof ttl === 'bigint') && BigInt(ttl) > 1n)) refuse('SUBMITTABLE');
  if (!isNumber(ttl, 1)) refuse('BODY_SHAPE');
  if (body.size !== BODY_KEYS.length || ![...body.keys()].every(k => typeof k === 'number' && BODY_KEYS.includes(k))) refuse('BODY_SHAPE');
  const inputs = setItems(body.get(0));
  const input = Array.isArray(inputs) && inputs.length === 1 ? inputs[0] : undefined;
  if (!Array.isArray(input) || input.length !== 2 || !(input[0] instanceof Uint8Array) || !sameBytes(input[0], ZERO_TX_ID) || !isNumber(input[1], 0)) {
    refuse('BODY_SHAPE');
  }
  const outputs = body.get(1);
  if (!Array.isArray(outputs) || outputs.length !== 0 || !isNumber(body.get(2), 0)) refuse('BODY_SHAPE');
  const signers = setItems(body.get(14));
  if (!Array.isArray(signers) || signers.length !== 1 || !(signers[0] instanceof Uint8Array) || bytesToHex(signers[0]) !== credential) {
    refuse('WRONG_SIGNER');
  }
  if (!isNumber(body.get(15), networkIdOf(network))) refuse('WRONG_NETWORK');
  const auxHash = body.get(7);
  if (!(auxHash instanceof Uint8Array) || auxHash.length !== 32) refuse('BODY_SHAPE');
  if (!sameBytes(blake2b256(auxBytes), auxHash as Uint8Array)) refuse('AUX_HASH_MISMATCH');
}

function auxiliaryData(subject: AttestedDigest): ReadonlyMap<number, CborWritable> {
  return new Map([[ATTESTATION_LABEL, new Map([[DIGEST_KEY[subject.kind], hexToBytes(subject.digest)]])]]);
}

/** The transaction body's `network_id`: 1 for mainnet, 0 for the test networks. */
const networkIdOf = (network: VaultNetwork): number => (network === 'mainnet' ? 1 : 0);
const NETWORKS: readonly VaultNetwork[] = ['mainnet', 'preprod', 'preview'];

function bodyOf(credential: string, auxiliaryDataHash: Uint8Array, network: VaultNetwork): ReadonlyMap<number, CborWritable> {
  return new Map<number, CborWritable>([
    [0, [[ZERO_TX_ID, 0]]],
    [1, []],
    [2, 0],
    [3, 1],
    [7, auxiliaryDataHash],
    [14, [hexToBytes(credential)]],
    [15, networkIdOf(network)],
  ]);
}

function assertSubject(credential: string, subject: AttestedDigest): void {
  if (typeof credential !== 'string' || !KEY_HASH.test(credential)) throw new TypeError('A credential is 28 bytes of lowercase hex');
  if (!subject || !Object.prototype.hasOwnProperty.call(DIGEST_KEY, subject.kind) || typeof subject.digest !== 'string' || !DIGEST.test(subject.digest)
    || !NETWORKS.includes(subject.network)) {
    throw new TypeError('An attested digest is a kind, 32 bytes of lowercase hex and a vault network');
  }
}

/** The auxiliary data of the expired transaction for `subject`, CBOR hex. */
export function expiredTxAuxiliaryData(subject: AttestedDigest): string {
  assertSubject('00'.repeat(28), subject);
  return bytesToHex(encodeCanonicalCbor(auxiliaryData(subject)));
}

/** The body of the expired transaction a participant signs, canonical CBOR hex. */
export function expiredTxBody(credential: string, subject: AttestedDigest): string {
  assertSubject(credential, subject);
  const aux = encodeCanonicalCbor(auxiliaryData(subject));
  return bytesToHex(encodeCanonicalCbor(bodyOf(credential, blake2b256(aux), subject.network)));
}

/** The hash the vault payment key signs: the expired transaction's id, hex. */
export function expiredTxBodyHash(credential: string, subject: AttestedDigest): string {
  return bytesToHex(blake2b256(hexToBytes(expiredTxBody(credential, subject))));
}

/** The stored transaction: the body as signed, then the canonical witness set, flag and auxiliary data. */
function storedTx(body: Uint8Array, vkey: Uint8Array, signature: Uint8Array, subject: AttestedDigest): Uint8Array {
  return concat(
    Uint8Array.of(0x84),
    body,
    encodeCanonicalCbor(new Map([[0, [[vkey, signature]]]])),
    Uint8Array.of(0xf5),
    encodeCanonicalCbor(auxiliaryData(subject)),
  );
}

/**
 * The complete expired transaction, the method 1 proof, from the key and its signature. `body`
 * is the body the wallet signed, when it wrote it otherwise than `expiredTxBody` (set tags,
 * another key order); it is checked when the proof is verified.
 */
export function assembleExpiredTx(credential: string, subject: AttestedDigest, vkey: string, signature: string, body?: string): string {
  assertSubject(credential, subject);
  const key = hexToBytes(vkey);
  const sig = hexToBytes(signature);
  if (key?.length !== 32 || sig?.length !== 64) throw new TypeError('A vkey witness is a 32-byte key and a 64-byte signature');
  const signed = body === undefined ? hexToBytes(expiredTxBody(credential, subject)) : hexToBytes(body);
  if (!signed?.length) throw new TypeError('A signed body is CBOR hex');
  return bytesToHex(storedTx(signed, key, sig, subject));
}

/** The witness set's one vkey witness. */
function vkeyWitness(witnessBytes: Uint8Array): { readonly vkey: Uint8Array; readonly signature: Uint8Array } {
  const witnesses = entries(parse(witnessBytes).value, 'WITNESS_SHAPE');
  const vkeys = witnesses.get(0);
  const witness = witnesses.size === 1 && vkeys?.type === 'array' && vkeys.value.length === 1 ? vkeys.value[0].value : undefined;
  if (witness?.type !== 'array' || witness.value.length !== 2) return refuse('WITNESS_SHAPE');
  return { vkey: bytesOf(witness.value[0].value, 32), signature: bytesOf(witness.value[1].value, 64) };
}

async function verifyExpiredTx(proof: Uint8Array, credential: string, subject: AttestedDigest): Promise<void> {
  const [bodyBytes, witnessBytes, validBytes, auxBytes] = transactionParts(proof);
  if (validBytes.length !== 1 || validBytes[0] !== 0xf5) refuse('MALFORMED_PROOF');
  checkSignedBody(signedBody(bodyBytes), credential, auxBytes, subject.network);
  if (!sameBytes(auxBytes, encodeCanonicalCbor(auxiliaryData(subject)))) refuse('WRONG_PAYLOAD');
  const { vkey, signature } = vkeyWitness(witnessBytes);
  if (keyHashOf(vkey) !== credential) refuse('WRONG_KEY');
  if (!(await verifyEd25519(vkey, signature, blake2b256(bodyBytes)))) refuse('BAD_SIGNATURE');
  if (!sameBytes(proof, storedTx(bodyBytes, vkey, signature, subject))) refuse('NOT_CANONICAL');
}

/** The stored form of an expired transaction a wallet returned: its body as signed, the rest canonical. */
function canonicalExpiredTx(proof: Uint8Array): Uint8Array {
  const [body, witness, valid, aux] = transactionParts(proof);
  signedBody(body);
  const canonical = (bytes: Uint8Array) => encodeCanonicalCbor(writable(lenient(bytes)));
  return concat(Uint8Array.of(0x84), body, canonical(witness), canonical(valid), canonical(aux));
}

// ---------------------------------------------------------------------------------------------

function proofBytes(attestation: OwnerAttestation): Uint8Array {
  const hex = attestation?.proof;
  if (typeof hex !== 'string' || !HEX.test(hex) || hex.length > MAX_ATTESTATION_BYTES * 2) return refuse('MALFORMED_PROOF');
  return hexToBytes(hex);
}

/**
 * The canonical stored form of an attestation a wallet returned, after the layout checks (a CIP-8
 * `kid` has to equal the address that was signed) but before any signature check: `ingestAttestation` does
 * both. Never throws.
 */
export function canonicalAttestation(attestation: OwnerAttestation):
  | { readonly ok: true; readonly attestation: OwnerAttestation }
  | { readonly ok: false; readonly code: AttestationRefusalCode } {
  try {
    const proof = proofBytes(attestation);
    let canonical: Uint8Array;
    if (attestation.method === ATTESTATION_METHOD.CIP8) canonical = canonicalCip8(proof);
    else if (attestation.method === ATTESTATION_METHOD.EXPIRED_TX) canonical = canonicalExpiredTx(proof);
    else return { ok: false, code: 'UNKNOWN_METHOD' };
    if (canonical.length > MAX_ATTESTATION_BYTES) return { ok: false, code: 'MALFORMED_PROOF' };
    return { ok: true, attestation: Object.freeze({ method: attestation.method, proof: bytesToHex(canonical) }) };
  } catch (e) {
    return { ok: false, code: e instanceof Refusal ? e.code : 'MALFORMED_PROOF' };
  }
}

/**
 * Verifies a stored attestation by the vault payment key whose hash is `credential` over
 * `subject`. Only the stored form verifies. CIP-8 is not accepted for an external cosigner's
 * verification digest. Never throws.
 */
export async function verifyAttestation(attestation: OwnerAttestation, credential: string, subject: AttestedDigest): Promise<AttestationCheck> {
  try {
    try {
      assertSubject(credential, subject);
    } catch {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    const proof = proofBytes(attestation);
    if (attestation.method === ATTESTATION_METHOD.CIP8) {
      if (subject.kind === 'verification') return { ok: false, code: 'METHOD_NOT_ALLOWED' };
      await verifyCip8(proof, credential, hexToBytes(subject.digest));
    } else if (attestation.method === ATTESTATION_METHOD.EXPIRED_TX) {
      await verifyExpiredTx(proof, credential, subject);
    } else {
      return { ok: false, code: 'UNKNOWN_METHOD' };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e instanceof Refusal ? e.code : 'MALFORMED_PROOF' };
  }
}

/**
 * Ingest: takes an attestation as a wallet returned it, brings it to the stored form and verifies
 * that. The result is what a manifest or a record stores. Never throws.
 */
export async function ingestAttestation(
  attestation: OwnerAttestation,
  credential: string,
  subject: AttestedDigest,
): Promise<{ readonly ok: true; readonly attestation: OwnerAttestation } | { readonly ok: false; readonly code: AttestationRefusalCode }> {
  const canonical = canonicalAttestation(attestation);
  if (canonical.ok === false) return canonical;
  const check = await verifyAttestation(canonical.attestation, credential, subject);
  return check.ok === true ? canonical : check;
}

/** Whether an attestation is in the stored form (layout only, no signature check). */
export function isCanonicalAttestation(attestation: OwnerAttestation): boolean {
  const canonical = canonicalAttestation(attestation);
  return canonical.ok === true && canonical.attestation.proof === attestation.proof && canonical.attestation.method === attestation.method;
}

/**
 * The credential (blake2b-224 key hash) of the key that made a stored attestation: the COSE_Key of
 * a CIP-8 proof, the witness key of an expired transaction. Nothing is verified here; `undefined`
 * when the proof is not in the stored form. Never throws.
 */
export function attestationSigner(attestation: OwnerAttestation): string | undefined {
  try {
    if (!isCanonicalAttestation(attestation)) return undefined;
    const proof = proofBytes(attestation);
    if (attestation.method === ATTESTATION_METHOD.CIP8) return keyHashOf(cip8Key(proof).x);
    return keyHashOf(vkeyWitness(transactionParts(proof)[1]).vkey);
  } catch {
    return undefined;
  }
}
