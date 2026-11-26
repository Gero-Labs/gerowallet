/**
 * Attestations by a participant's vault payment key (spec 5.3; the flows are GV-22 #1690).
 *
 * An owner attests each of their device bindings, and an external cosigner attests the vault's
 * verification digest (`verificationNumber.ts`). Either way the attestation is
 * `{ method, proof }` over one 32-byte digest:
 *
 * - method 0, CIP-8 (device bindings only): `proof` is the CBOR array
 *   `[ bstr COSE_Sign1, bstr COSE_Key ]`, the pair a CIP-30 `signData` returns. It verifies when the
 *   COSE_Key's Ed25519 key hashes to the participant's credential, the COSE_Sign1 payload is
 *   exactly the digest, and the signature verifies over the Sig_structure (RFC 8152 section 4.4).
 * - method 1, an expired transaction: `proof` is a complete signed transaction that can never be
 *   submitted. Its body is exactly
 *     { 0: [[32 zero bytes, 0]], 1: [], 2: 0, 3: 1, 7: auxiliary data hash, 14: [credential] }
 *   (an input that cannot exist, no outputs, no fee, a time to live of slot 1, the credential as
 *   the one required signer), its witness set is exactly one vkey witness by the vault payment
 *   key, and its auxiliary data is exactly `{ 18541: { 0: binding digest } }`, or
 *   `{ 18541: { 1: verification digest } }` for an external cosigner. Label 1854 is never used,
 *   because CIP-0146 wallets scan it for vault registrations.
 *
 * The verifiers are pure TypeScript over the bounded reader of `cbor.ts`, with Ed25519 from
 * `@cardano-sdk/crypto`. They never throw.
 *
 * PROVISIONAL: the proof layouts, label 18541 and the expired transaction body are fixed with the
 * hardware results (GV-06 #1674) and the other clients' vectors (GV-07 #1675).
 */
import { Ed25519PublicKey, Ed25519PublicKeyHex, Ed25519Signature, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { blake2b } from '@noble/hashes/blake2.js';
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

/** Ed25519 verification of `signature` over `message` by `publicKey` (raw bytes). False on any error. */
export async function verifyEd25519(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean> {
  try {
    await ready();
    return Ed25519PublicKey.fromHex(Ed25519PublicKeyHex(bytesToHex(publicKey))).verify(Ed25519Signature.fromBytes(signature), HexBlob(bytesToHex(message)));
  } catch {
    return false;
  }
}

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

// ---------------------------------------------------------------------------------------------
// Method 0: CIP-8

/** The CIP-8 proof of an attestation: `[ bstr COSE_Sign1, bstr COSE_Key ]`, hex. */
export function cip8Proof(coseSign1: string, coseKey: string): string {
  const a = hexToBytes(coseSign1);
  const b = hexToBytes(coseKey);
  if (!a?.length || !b?.length) throw new TypeError('COSE_Sign1 and COSE_Key are hex');
  return bytesToHex(encodeCanonicalCbor([a, b]));
}

/**
 * COSE_Key of an Ed25519 key, as CIP-30 returns it: kty OKP, alg EdDSA, crv Ed25519, x, and an
 * optional kid. The COSE_Key is not signed, so its kid is returned for the caller to bind.
 */
function coseKey(bytes: Uint8Array): { readonly x: Uint8Array; readonly kid?: Uint8Array } {
  const key = entries(parse(bytes).value, 'UNSUPPORTED_KEY');
  for (const label of key.keys()) if (![1, 2, 3, -1, -2].includes(label as number)) refuse('UNSUPPORTED_KEY');
  if (!isInt(key.get(1), 1n) || !isInt(key.get(-1), 6n) || (key.has(3) && !isInt(key.get(3), -8n))) refuse('UNSUPPORTED_KEY');
  if (key.has(2) && key.get(2).type !== 'bytes') refuse('UNSUPPORTED_KEY');
  const x = bytesOf(key.get(-2), 32);
  return key.has(2) ? { x, kid: bytesOf(key.get(2)) } : { x };
}

async function verifyCip8(proof: Uint8Array, credential: string, digest: Uint8Array): Promise<void> {
  const root = parse(proof);
  if (root.value.type !== 'array' || root.value.value.length !== 2) refuse('MALFORMED_PROOF');
  const [sign1Bytes, keyBytes] = (root.value as { value: readonly Item[] }).value.map(i => bytesOf(i.value));
  if (!sameBytes(encodeCanonicalCbor([sign1Bytes, keyBytes]), proof)) refuse('NOT_CANONICAL');

  const { x, kid } = coseKey(keyBytes);
  if (keyHashOf(x) !== credential) refuse('WRONG_KEY');

  const sign1 = parse(sign1Bytes).value;
  if (sign1.type !== 'array' || sign1.value.length !== 4) return refuse('MALFORMED_PROOF');
  const [protectedItem, unprotectedItem, payloadItem, signatureItem] = sign1.value;
  const protectedBytes = bytesOf(protectedItem.value);
  const headers = entries(parse(protectedBytes).value, 'UNSUPPORTED_HEADER');
  for (const label of headers.keys()) if (label !== 1 && label !== 4 && label !== 'address') refuse('UNSUPPORTED_HEADER');
  if (!isInt(headers.get(1), -8n)) refuse('UNSUPPORTED_HEADER');
  for (const label of [4, 'address']) if (headers.has(label) && headers.get(label).type !== 'bytes') refuse('UNSUPPORTED_HEADER');
  // Unsigned identifiers must repeat a signed one, so the proof has no free bytes.
  const signedId = headers.has('address') ? bytesOf(headers.get('address')) : headers.has(4) ? bytesOf(headers.get(4)) : undefined;
  if (headers.has(4) && headers.has('address') && !sameBytes(bytesOf(headers.get(4)), signedId)) refuse('UNSUPPORTED_HEADER');
  if (kid && (!signedId || !sameBytes(kid, signedId))) refuse('UNSUPPORTED_KEY');
  const unprotected = entries(unprotectedItem.value, 'UNSUPPORTED_HEADER');
  for (const [label, value] of unprotected) {
    if (label !== 'hashed' || value.type !== 'bool' || value.value !== false) refuse('UNSUPPORTED_HEADER');
  }
  const payload = bytesOf(payloadItem.value);
  if (!sameBytes(payload, digest)) refuse('WRONG_PAYLOAD');
  const signature = bytesOf(signatureItem.value, 64);
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

/**
 * Verifies an attestation by the vault payment key whose hash is `credential` over `subject`.
 * CIP-8 is accepted for binding digests only. Never throws.
 */
export async function verifyAttestation(attestation: OwnerAttestation, credential: string, subject: AttestedDigest): Promise<AttestationCheck> {
  try {
    try {
      assertSubject(credential, subject);
    } catch {
      return { ok: false, code: 'INVALID_INPUT' };
    }
    const proofHex = attestation?.proof;
    if (typeof proofHex !== 'string' || !HEX.test(proofHex) || proofHex.length > MAX_ATTESTATION_BYTES * 2) {
      return { ok: false, code: 'MALFORMED_PROOF' };
    }
    const proof = hexToBytes(proofHex);
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
