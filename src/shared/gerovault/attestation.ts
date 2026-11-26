/**
 * Attestations by a participant's vault payment key (spec 5.3; the flows are GV-22 #1690), and
 * the strict Ed25519 check every signature of this library goes through.
 *
 * An owner attests each of their device bindings, and an external cosigner attests the vault's
 * verification digest (`verificationNumber.ts`). Either way the attestation is
 * `{ method, proof }` over one 32-byte digest, and it is stored in exactly one canonical form:
 *
 * - method 0, CIP-8 (device bindings only): `proof` is the CBOR array
 *   `[ bstr COSE_Sign1, bstr COSE_Key ]`. Stored, the COSE_Sign1 is
 *   `[ protected header bytes as signed, {}, payload, signature ]` and the COSE_Key is exactly
 *   `{ 1: 1, 3: -8, -1: 6, -2: key }`. It verifies when the key hashes to the participant's
 *   credential, the payload is exactly the digest, and the signature verifies over the
 *   Sig_structure (RFC 8152 section 4.4).
 * - method 1, an expired transaction: `proof` is a complete signed transaction that can never be
 *   submitted. Its body is exactly
 *     { 0: [[32 zero bytes, 0]], 1: [], 2: 0, 3: 1, 7: auxiliary data hash, 14: [credential] }
 *   (an input that cannot exist, no outputs, no fee, a time to live of slot 1, the credential as
 *   the one required signer), its witness set is exactly one vkey witness by the vault payment
 *   key, and its auxiliary data is exactly `{ 18541: { 0: binding digest } }`, or
 *   `{ 18541: { 1: verification digest } }` for an external cosigner. Label 1854 is never used,
 *   because CIP-0146 wallets scan it for vault registrations. Stored, the whole transaction is
 *   canonical CBOR (definite lengths, no set tags).
 *
 * `ingestAttestation` takes what a wallet returns (a COSE_Key with a `kid` or no `alg` or in
 * another order, an unprotected `{ hashed: false }`, a tagged COSE_Sign1, a witness set with set
 * tags or indefinite lengths), checks it, and gives the canonical form. `verifyAttestation` takes
 * the canonical form only, which is what manifests store.
 *
 * Every Ed25519 check here is strict (RFC 8032): a key or an `R` that is not a canonical encoding
 * or is of small order, or an `S` that is not below the group order, is refused before the
 * signature is checked. The verifiers never throw.
 *
 * PROVISIONAL: the proof layouts, label 18541 and the expired transaction body are fixed with the
 * hardware results (GV-06 #1674) and the other clients' vectors (GV-07 #1675).
 */
import { Ed25519PublicKey, Ed25519PublicKeyHex, Ed25519Signature, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { blake2b } from '@noble/hashes/blake2.js';
import { decode as lenientDecode } from 'cborg';
import { CborBoolean, CborError, CborItemOf, CborValueOf, bytesToHex, hexToBytes, readCbor } from './cbor';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';

/** Metadata label of the expired transaction's auxiliary data. Not 1854. */
export const ATTESTATION_LABEL = 18541;
export const ATTESTATION_METHOD = Object.freeze({ CIP8: 0, EXPIRED_TX: 1 } as const);
export const MAX_ATTESTATION_BYTES = 2048;

export interface OwnerAttestation {
  /** `ATTESTATION_METHOD.CIP8` or `ATTESTATION_METHOD.EXPIRED_TX`. */
  readonly method: number;
  /** The method's proof bytes, lowercase hex. */
  readonly proof: string;
}

/** What an attestation is over: a binding digest, or a vault's verification digest. */
export interface AttestedDigest {
  readonly kind: 'binding' | 'verification';
  /** 32 bytes, lowercase hex. */
  readonly digest: string;
}

const DIGEST_KEY = { binding: 0, verification: 1 } as const;

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
  | 'WITNESS_SHAPE';

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

/** An Ed25519 point encoding: canonical, and not a small-order point (the identity among them). */
export function isUsableEd25519Key(hex: string): boolean {
  if (typeof hex !== 'string' || !DIGEST.test(hex)) return false;
  const y = hexToBytes(hex);
  y[31] &= 0x7f;
  return !atLeastP(y) && !ED25519_SMALL_ORDER.includes(bytesToHex(y));
}

function scalarBelowOrder(s: Uint8Array): boolean {
  let n = 0n;
  for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(s[i]);
  return n < GROUP_ORDER;
}

/**
 * Strict Ed25519 verification of `signature` over `message` by `publicKey` (raw bytes): the key and
 * `R` must be canonical points of large order and `S` below the group order. False on any error.
 */
export async function verifyEd25519(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    if (publicKey?.length !== 32 || signature?.length !== 64 || !(message instanceof Uint8Array)) return false;
    if (!isUsableEd25519Key(bytesToHex(publicKey)) || !isUsableEd25519Key(bytesToHex(signature.subarray(0, 32)))) return false;
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

/** Lenient decoding of what a wallet returned: indefinite lengths, set tags and a COSE_Sign1 tag allowed. */
function lenient(bytes: Uint8Array): unknown {
  const tags: ((inner: unknown) => unknown)[] = [];
  tags[18] = inner => inner;
  tags[258] = inner => inner;
  try {
    return lenientDecode(bytes, { useMaps: true, allowIndefinite: true, allowUndefined: false, rejectDuplicateMapKeys: true, tags });
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

/** The signed protected header: alg EdDSA, and optionally a kid and the CIP-30 address. */
function protectedHeader(protectedBytes: Uint8Array): { readonly signedId?: Uint8Array } {
  const headers = entries(parse(protectedBytes).value, 'UNSUPPORTED_HEADER');
  for (const label of headers.keys()) if (label !== 1 && label !== 4 && label !== 'address') refuse('UNSUPPORTED_HEADER');
  if (!isInt(headers.get(1), -8n)) refuse('UNSUPPORTED_HEADER');
  for (const label of [4, 'address']) if (headers.has(label) && headers.get(label).type !== 'bytes') refuse('UNSUPPORTED_HEADER');
  const kid = headers.has(4) ? bytesOf(headers.get(4)) : undefined;
  const address = headers.has('address') ? bytesOf(headers.get('address')) : undefined;
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

async function verifyCip8(proof: Uint8Array, credential: string, digest: Uint8Array): Promise<void> {
  const root = parse(proof);
  if (root.value.type !== 'array' || root.value.value.length !== 2) refuse('MALFORMED_PROOF');
  const [sign1Bytes, keyBytes] = (root.value as { value: readonly Item[] }).value.map(i => bytesOf(i.value));
  const sign1 = parse(sign1Bytes).value;
  if (sign1.type !== 'array' || sign1.value.length !== 4) return refuse('MALFORMED_PROOF');
  const [protectedItem, , payloadItem, signatureItem] = sign1.value;
  const protectedBytes = bytesOf(protectedItem.value);
  const payload = bytesOf(payloadItem.value);
  const signature = bytesOf(signatureItem.value, 64);
  const key = entries(parse(keyBytes).value, 'UNSUPPORTED_KEY');
  const x = key.get(-2)?.type === 'bytes' ? bytesOf(key.get(-2), 32) : refuse('UNSUPPORTED_KEY');
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

function auxiliaryData(subject: AttestedDigest): ReadonlyMap<number, CborWritable> {
  return new Map([[ATTESTATION_LABEL, new Map([[DIGEST_KEY[subject.kind], hexToBytes(subject.digest)]])]]);
}

function bodyOf(credential: string, auxiliaryDataHash: Uint8Array): ReadonlyMap<number, CborWritable> {
  return new Map<number, CborWritable>([
    [0, [[ZERO_TX_ID, 0]]],
    [1, []],
    [2, 0],
    [3, 1],
    [7, auxiliaryDataHash],
    [14, [hexToBytes(credential)]],
  ]);
}

function assertSubject(credential: string, subject: AttestedDigest): void {
  if (typeof credential !== 'string' || !KEY_HASH.test(credential)) throw new TypeError('A credential is 28 bytes of lowercase hex');
  if (!subject || !(subject.kind in DIGEST_KEY) || typeof subject.digest !== 'string' || !DIGEST.test(subject.digest)) {
    throw new TypeError('An attested digest is a kind and 32 bytes of lowercase hex');
  }
}

/** The auxiliary data of the expired transaction for `subject`, CBOR hex. */
export function expiredTxAuxiliaryData(subject: AttestedDigest): string {
  assertSubject('00'.repeat(28), subject);
  return bytesToHex(encodeCanonicalCbor(auxiliaryData(subject)));
}

/** The body of the expired transaction a participant signs, CBOR hex. */
export function expiredTxBody(credential: string, subject: AttestedDigest): string {
  assertSubject(credential, subject);
  const aux = encodeCanonicalCbor(auxiliaryData(subject));
  return bytesToHex(encodeCanonicalCbor(bodyOf(credential, blake2b256(aux))));
}

/** The hash the vault payment key signs: the expired transaction's id, hex. */
export function expiredTxBodyHash(credential: string, subject: AttestedDigest): string {
  return bytesToHex(blake2b256(hexToBytes(expiredTxBody(credential, subject))));
}

/** The complete expired transaction, the method 1 proof, from the key and its signature. */
export function assembleExpiredTx(credential: string, subject: AttestedDigest, vkey: string, signature: string): string {
  assertSubject(credential, subject);
  const key = hexToBytes(vkey);
  const sig = hexToBytes(signature);
  if (key?.length !== 32 || sig?.length !== 64) throw new TypeError('A vkey witness is a 32-byte key and a 64-byte signature');
  const aux = auxiliaryData(subject);
  return bytesToHex(encodeCanonicalCbor([
    bodyOf(credential, blake2b256(encodeCanonicalCbor(aux))),
    new Map([[0, [[key, sig]]]]),
    true,
    aux,
  ]));
}

async function verifyExpiredTx(proof: Uint8Array, credential: string, subject: AttestedDigest): Promise<void> {
  const root = parse(proof);
  if (root.value.type !== 'array' || root.value.value.length !== 4) return refuse('MALFORMED_PROOF');
  const [bodyItem, witnessItem, validItem, auxItem] = root.value.value;
  if (validItem.value.type !== 'bool' || validItem.value.value !== true) refuse('MALFORMED_PROOF');

  const body = entries(bodyItem.value, 'BODY_SHAPE');
  const ttl = body.get(3);
  if (!ttl || (ttl.type === 'int' && ttl.value > 1n)) refuse('SUBMITTABLE');
  if (!isInt(ttl, 1n)) refuse('BODY_SHAPE');
  if ([...body.keys()].map(String).sort().join() !== ['0', '1', '14', '2', '3', '7'].join()) refuse('BODY_SHAPE');
  const inputs = body.get(0);
  const input = inputs.type === 'array' && inputs.value.length === 1 ? inputs.value[0].value : undefined;
  if (input?.type !== 'array' || input.value.length !== 2 || !sameBytes(bytesOf(input.value[0].value, 32), ZERO_TX_ID) || !isInt(input.value[1].value, 0n)) {
    refuse('BODY_SHAPE');
  }
  const outputs = body.get(1);
  if (outputs.type !== 'array' || outputs.value.length !== 0 || !isInt(body.get(2), 0n)) refuse('BODY_SHAPE');
  const signers = body.get(14);
  if (signers.type !== 'array' || signers.value.length !== 1 || bytesToHex(bytesOf(signers.value[0].value, 28)) !== credential) {
    refuse('WRONG_SIGNER');
  }
  const auxBytes = proof.subarray(auxItem.start, auxItem.end);
  if (!sameBytes(blake2b256(auxBytes), bytesOf(body.get(7), 32))) refuse('AUX_HASH_MISMATCH');
  if (!sameBytes(auxBytes, encodeCanonicalCbor(auxiliaryData(subject)))) refuse('WRONG_PAYLOAD');

  const witnesses = entries(witnessItem.value, 'WITNESS_SHAPE');
  const vkeys = witnesses.get(0);
  const witness = witnesses.size === 1 && vkeys?.type === 'array' && vkeys.value.length === 1 ? vkeys.value[0].value : undefined;
  if (witness?.type !== 'array' || witness.value.length !== 2) return refuse('WITNESS_SHAPE');
  const vkey = bytesOf(witness.value[0].value, 32);
  const signature = bytesOf(witness.value[1].value, 64);
  if (keyHashOf(vkey) !== credential) refuse('WRONG_KEY');
  const txId = blake2b256(proof.subarray(bodyItem.start, bodyItem.end));
  if (!(await verifyEd25519(vkey, signature, txId))) refuse('BAD_SIGNATURE');
  if (bytesToHex(proof) !== assembleExpiredTx(credential, subject, bytesToHex(vkey), bytesToHex(signature))) refuse('NOT_CANONICAL');
}

// ---------------------------------------------------------------------------------------------

function proofBytes(attestation: OwnerAttestation): Uint8Array {
  const hex = attestation?.proof;
  if (typeof hex !== 'string' || !HEX.test(hex) || hex.length > MAX_ATTESTATION_BYTES * 2) return refuse('MALFORMED_PROOF');
  return hexToBytes(hex);
}

/**
 * The canonical stored form of an attestation a wallet returned, after the layout checks (a CIP-8
 * `kid` must repeat the signed address) but before any signature check: `ingestAttestation` does
 * both. Never throws.
 */
export function canonicalAttestation(attestation: OwnerAttestation):
  | { readonly ok: true; readonly attestation: OwnerAttestation }
  | { readonly ok: false; readonly code: AttestationRefusalCode } {
  try {
    const proof = proofBytes(attestation);
    let canonical: Uint8Array;
    if (attestation.method === ATTESTATION_METHOD.CIP8) canonical = canonicalCip8(proof);
    else if (attestation.method === ATTESTATION_METHOD.EXPIRED_TX) canonical = encodeCanonicalCbor(writable(lenient(proof)));
    else return { ok: false, code: 'UNKNOWN_METHOD' };
    if (canonical.length > MAX_ATTESTATION_BYTES) return { ok: false, code: 'MALFORMED_PROOF' };
    return { ok: true, attestation: Object.freeze({ method: attestation.method, proof: bytesToHex(canonical) }) };
  } catch (e) {
    return { ok: false, code: e instanceof Refusal ? e.code : 'MALFORMED_PROOF' };
  }
}

/**
 * Verifies a stored attestation by the vault payment key whose hash is `credential` over
 * `subject`. Only the canonical stored form verifies. CIP-8 is accepted for binding digests only.
 * Never throws.
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
      if (subject.kind !== 'binding') return { ok: false, code: 'METHOD_NOT_ALLOWED' };
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
 * Ingest: takes an attestation as a wallet returned it, brings it to the canonical stored form
 * and verifies that. The result is what a manifest or a record stores. Never throws.
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

/** Whether an attestation is in the canonical stored form (layout only, no signature check). */
export function isCanonicalAttestation(attestation: OwnerAttestation): boolean {
  const canonical = canonicalAttestation(attestation);
  return canonical.ok === true && canonical.attestation.proof === attestation.proof && canonical.attestation.method === attestation.method;
}
