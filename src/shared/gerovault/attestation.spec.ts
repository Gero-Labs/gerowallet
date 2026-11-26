import { beforeAll, describe, expect, it } from 'vitest';
import { Serialization } from '@cardano-sdk/core';
import { blake2b as sdkBlake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { COSESign1 } from '@emurgo/cardano-message-signing-browser';
import { decode as cborgDecode, encode as cborgEncode } from 'cborg';
import {
  ATTESTATION_LABEL,
  AttestedDigest,
  OwnerAttestation,
  assembleExpiredTx,
  cip8Proof,
  expiredTxAuxiliaryData,
  expiredTxBody,
  expiredTxBodyHash,
  verifyAttestation,
} from './attestation';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { TestParticipant, cip8Attestation, expiredTxAttestation, testParticipants } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors (GV-07): the expired transaction body and auxiliary data for test
 * participant 0 (the published cardano-addresses key at vault index 1) over the binding digest
 * `ab` x 32, and the hashes of both complete proofs by that key.
 */
const VECTORS = {
  auxiliaryData: 'a119486da1005820abababababababababababababababababababababababababababababababab',
  body: 'a600818258200000000000000000000000000000000000000000000000000000000000000000000180020003010758204c492b248804e86d28819091a2394b6d435e71db70c24b6bf4d28ade935fcf260e81581c1196fe3062e96b78dd959058f5adad44dd663519200f2495d17ef10d',
  expiredTxProofHash: '62c26f4c4ce0c0945bfb0e7ece0ea96de809c7e68d64f35b12472f816412ef33',
  cip8ProofHash: 'a542b09b2b0904da574c063c3767b9c383e102ecf85eb3da255ba7e1704188c6',
};

const DIGEST = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const binding: AttestedDigest = { kind: 'binding', digest: DIGEST };
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytesOf = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));

let people: TestParticipant[];

beforeAll(async () => {
  people = await testParticipants();
});

const verify = (a: OwnerAttestation, who: TestParticipant, subject: AttestedDigest = binding) => verifyAttestation(a, who.credential, subject);
const codeOf = async (a: OwnerAttestation, who: TestParticipant, subject: AttestedDigest = binding) => {
  const r = await verify(a, who, subject);
  return r.ok === true ? 'ok' : r.code;
};

/** The proof's CBOR, decoded with an independent decoder (maps with integer keys as `Map`). */
const decoded = (proof: string) => cborgDecode(bytesOf(proof), { useMaps: true }) as unknown[];
const reencode = (value: unknown) => hexOf(encodeCanonicalCbor(value as CborWritable));

describe('CIP-8 attestations', () => {
  it('verify the wallet\'s own signData output over the digest', async () => {
    expect(await verify(cip8Attestation(people[0].signer, people[0].credential, DIGEST), people[0])).toEqual({ ok: true });
    expect(await verify(cip8Attestation(people[1].signer, people[1].credential, DIGEST), people[1])).toEqual({ ok: true });
  });

  it('rebuild the Sig_structure exactly as the COSE library signs it', () => {
    const proof = cip8Attestation(people[0].signer, people[0].credential, DIGEST).proof;
    const [sign1] = cborgDecode(bytesOf(proof)) as Uint8Array[];
    const [protectedBytes, , payload] = cborgDecode(sign1, { useMaps: true }) as Uint8Array[];
    const ours = encodeCanonicalCbor(['Signature1', protectedBytes, new Uint8Array(0), payload]);
    expect(hexOf(ours)).toBe(hexOf(COSESign1.from_bytes(sign1).signed_data().to_bytes()));
  });

  it('refuse a key that does not hash to the credential', async () => {
    expect(await codeOf(cip8Attestation(people[1].signer, people[1].credential, DIGEST), people[0])).toBe('WRONG_KEY');
  });

  it('refuse a signature by another key under the participant\'s COSE_Key', async () => {
    const [sign1ByOther] = cborgDecode(bytesOf(cip8Attestation(people[1].signer, people[0].credential, DIGEST).proof)) as Uint8Array[];
    const [, keyOfOwner] = cborgDecode(bytesOf(cip8Attestation(people[0].signer, people[0].credential, DIGEST).proof)) as Uint8Array[];
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(sign1ByOther), hexOf(keyOfOwner)) }, people[0])).toBe('BAD_SIGNATURE');
  });

  it('refuse another payload', async () => {
    expect(await codeOf(cip8Attestation(people[0].signer, people[0].credential, OTHER), people[0])).toBe('WRONG_PAYLOAD');
  });

  it('are for binding digests only', async () => {
    const a = cip8Attestation(people[0].signer, people[0].credential, DIGEST);
    expect(await codeOf(a, people[0], { kind: 'verification', digest: DIGEST })).toBe('METHOD_NOT_ALLOWED');
  });

  it('refuse headers, keys and layouts outside the CIP-30 form', async () => {
    const a = cip8Attestation(people[0].signer, people[0].credential, DIGEST);
    const [sign1, key] = cborgDecode(bytesOf(a.proof)) as Uint8Array[];
    const coseKey = cborgDecode(key, { useMaps: true }) as Map<number, unknown>;
    const withExtraKeyLabel = new Map(coseKey).set(5, new Uint8Array(1));
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(sign1), reencode(withExtraKeyLabel)) }, people[0])).toBe('UNSUPPORTED_KEY');
    // The COSE_Key is not signed: its kid must repeat the signed address, or the proof would have
    // bytes anyone can change.
    const otherKid = new Map(coseKey).set(2, new Uint8Array(29));
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(sign1), reencode(otherKid)) }, people[0])).toBe('UNSUPPORTED_KEY');
    const noKid = new Map(coseKey);
    noKid.delete(2);
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(sign1), reencode(noKid)) }, people[0])).toBe('ok');
    const parts = cborgDecode(sign1, { useMaps: true }) as unknown[];
    const hashed = [parts[0], new Map([['hashed', true]]), parts[2], parts[3]];
    expect(await codeOf({ method: 0, proof: cip8Proof(reencode(hashed), hexOf(key)) }, people[0])).toBe('UNSUPPORTED_HEADER');
    const detached = [parts[0], parts[1], null, parts[3]];
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(cborgEncode(detached)), hexOf(key)) }, people[0])).toBe('MALFORMED_PROOF');
    expect(await codeOf({ method: 0, proof: hexOf(cborgEncode([sign1, key, new Uint8Array(0)])) }, people[0])).toBe('MALFORMED_PROOF');
    expect(await codeOf({ method: 0, proof: hexOf(cborgEncode([sign1])) }, people[0])).toBe('MALFORMED_PROOF');
    // The tagged COSE_Sign1 form (tag 18) is refused: one form only.
    const tagged = new Uint8Array([0xd2, ...sign1]);
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(tagged), hexOf(key)) }, people[0])).toBe('MALFORMED_PROOF');
  });
});

describe('expired-transaction attestations', () => {
  it('are a well-formed Cardano transaction that can never be submitted (checked with cardano-sdk)', () => {
    const subject: AttestedDigest = { kind: 'binding', digest: DIGEST };
    const proof = expiredTxAttestation(people[0].signer, people[0].credential, subject).proof;
    const tx = Serialization.Transaction.fromCbor(HexBlob(proof));
    expect(tx.getId()).toBe(expiredTxBodyHash(people[0].credential, subject));
    const core = tx.toCore();
    expect(core.body.inputs).toEqual([{ txId: '00'.repeat(32), index: 0 }]);
    expect(core.body.outputs).toEqual([]);
    expect(core.body.fee).toBe(0n);
    expect(core.body.validityInterval.invalidHereafter).toBe(1);
    expect(core.body.validityInterval.invalidBefore).toBeUndefined();
    expect(core.body.requiredExtraSignatures).toEqual([people[0].credential]);
    expect(core.body.auxiliaryDataHash).toBe(sdkBlake2b.hash(HexBlob(expiredTxAuxiliaryData(subject)), 32));
    expect(core.auxiliaryData.blob.get(BigInt(ATTESTATION_LABEL))).toEqual(new Map([[0n, bytesOf(DIGEST)]]));
    expect([...core.witness.signatures.keys()]).toEqual([people[0].signer.toPublic().hex()]);
    expect(tx.isValid()).toBe(true);
  });

  it('verify over a binding digest and over a verification digest', async () => {
    const verification: AttestedDigest = { kind: 'verification', digest: DIGEST };
    expect(await codeOf(expiredTxAttestation(people[0].signer, people[0].credential, binding), people[0])).toBe('ok');
    expect(await codeOf(expiredTxAttestation(people[2].signer, people[2].credential, verification), people[2], verification)).toBe('ok');
    // The two kinds are not interchangeable.
    expect(await codeOf(expiredTxAttestation(people[2].signer, people[2].credential, verification), people[2])).toBe('WRONG_PAYLOAD');
  });

  const tamper = (fn: (tx: unknown[], body: Map<number, unknown>) => void, resign = false) => {
    const tx = decoded(expiredTxAttestation(people[0].signer, people[0].credential, binding).proof);
    fn(tx, tx[0] as Map<number, unknown>);
    if (resign) {
      const bodyHex = hexOf(cborgEncode(tx[0], { mapSorter: () => 0 }));
      const sig = people[0].signer.sign(HexBlob(sdkBlake2b.hash(HexBlob(bodyHex), 32))).hex();
      tx[1] = new Map([[0, [[bytesOf(people[0].signer.toPublic().hex()), bytesOf(sig)]]]]);
      return { method: 1, proof: hexOf(cborgEncode(tx, { mapSorter: () => 0 })) };
    }
    return { method: 1, proof: reencode(tx) };
  };

  it.each([
    ['SUBMITTABLE', 'a time to live in the future', (_tx: unknown[], body: Map<number, unknown>) => { body.set(3, 200_000_000); }],
    ['SUBMITTABLE', 'no time to live', (_tx: unknown[], body: Map<number, unknown>) => { body.delete(3); }],
    ['BODY_SHAPE', 'a time to live of slot 0', (_tx: unknown[], body: Map<number, unknown>) => { body.set(3, 0); }],
    ['AUX_HASH_MISMATCH', 'an auxiliary data hash that does not match', (_tx: unknown[], body: Map<number, unknown>) => { body.set(7, new Uint8Array(32)); }],
    ['WRONG_PAYLOAD', 'another digest, its hash updated', (tx: unknown[], body: Map<number, unknown>) => {
      tx[3] = new Map([[ATTESTATION_LABEL, new Map([[0, bytesOf(OTHER)]])]]);
      body.set(7, bytesOf(sdkBlake2b.hash(HexBlob(reencode(tx[3])), 32)));
    }],
    ['WRONG_PAYLOAD', 'label 1854', (tx: unknown[], body: Map<number, unknown>) => {
      tx[3] = new Map([[1854, new Map([[0, bytesOf(DIGEST)]])]]);
      body.set(7, bytesOf(sdkBlake2b.hash(HexBlob(reencode(tx[3])), 32)));
    }],
    ['BODY_SHAPE', 'an output', (_tx: unknown[], body: Map<number, unknown>) => { body.set(1, [[new Uint8Array(29), 1000000]]); }],
    ['BODY_SHAPE', 'a fee', (_tx: unknown[], body: Map<number, unknown>) => { body.set(2, 170000); }],
    ['BODY_SHAPE', 'a real input', (_tx: unknown[], body: Map<number, unknown>) => { body.set(0, [[new Uint8Array(32).fill(1), 0]]); }],
    ['BODY_SHAPE', 'a validity start', (_tx: unknown[], body: Map<number, unknown>) => { body.set(8, 0); }],
    ['WRONG_SIGNER', 'another required signer', (_tx: unknown[], body: Map<number, unknown>) => { body.set(14, [new Uint8Array(28)]); }],
    ['WITNESS_SHAPE', 'two witnesses', (tx: unknown[]) => {
      const w = tx[1] as Map<number, unknown[][]>;
      w.set(0, [...w.get(0), w.get(0)[0]]);
    }],
    ['WITNESS_SHAPE', 'a native script witness', (tx: unknown[]) => { (tx[1] as Map<number, unknown>).set(1, []); }],
    ['BAD_SIGNATURE', 'a signature that does not verify', (tx: unknown[]) => {
      const sig = ((tx[1] as Map<number, Uint8Array[][]>).get(0)[0][1]);
      sig[0] ^= 1;
    }],
    ['MALFORMED_PROOF', 'is_valid false', (tx: unknown[]) => { tx[2] = false; }],
    ['MALFORMED_PROOF', 'no auxiliary data', (tx: unknown[]) => { tx.splice(3, 1); }],
  ] as [string, string, (tx: unknown[], body: Map<number, unknown>) => void][])('refuse %s: %s', async (code, _what, fn) => {
    expect(await codeOf(tamper(fn), people[0])).toBe(code);
  });

  it('refuse a witness by another key', async () => {
    const signature = people[1].signer.sign(HexBlob(expiredTxBodyHash(people[0].credential, binding))).hex();
    const proof = assembleExpiredTx(people[0].credential, binding, people[1].signer.toPublic().hex(), signature);
    expect(await codeOf({ method: 1, proof }, people[0])).toBe('WRONG_KEY');
    // Signed by the participant for themselves, then claimed for someone else.
    expect(await codeOf(expiredTxAttestation(people[1].signer, people[1].credential, binding), people[0])).toBe('WRONG_SIGNER');
  });

  it('refuse a body in another key order, even signed', async () => {
    const reordered = tamper((_tx, body) => {
      const entries = [...body.entries()].reverse();
      body.clear();
      for (const [k, v] of entries) body.set(k, v);
    }, true);
    expect(await codeOf(reordered, people[0])).toBe('NOT_CANONICAL');
  });

  it('match the provisional vectors', async () => {
    expect(expiredTxAuxiliaryData(binding)).toBe(VECTORS.auxiliaryData);
    expect(expiredTxBody(people[0].credential, binding)).toBe(VECTORS.body);
    expect(sdkBlake2b.hash(HexBlob(expiredTxAttestation(people[0].signer, people[0].credential, binding).proof), 32)).toBe(VECTORS.expiredTxProofHash);
    expect(sdkBlake2b.hash(HexBlob(cip8Attestation(people[0].signer, people[0].credential, DIGEST).proof), 32)).toBe(VECTORS.cip8ProofHash);
  });
});

describe('any attestation', () => {
  it('refuses unknown methods and bad input without throwing', async () => {
    const a = expiredTxAttestation(people[0].signer, people[0].credential, binding);
    expect(await codeOf({ method: 2, proof: a.proof }, people[0])).toBe('UNKNOWN_METHOD');
    expect(await codeOf({ method: 1, proof: a.proof.toUpperCase() }, people[0])).toBe('MALFORMED_PROOF');
    expect(await codeOf({ method: 1, proof: '00'.repeat(2049) }, people[0])).toBe('MALFORMED_PROOF');
    expect(await codeOf(undefined, people[0])).toBe('MALFORMED_PROOF');
    expect(await verifyAttestation(a, 'ab', binding)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await verifyAttestation(a, people[0].credential, { kind: 'binding', digest: 'ab' })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('never throws on mutated proofs', async () => {
    const proofs = [expiredTxAttestation(people[0].signer, people[0].credential, binding), cip8Attestation(people[0].signer, people[0].credential, DIGEST)];
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let round = 0; round < 300; round++) {
      const { method, proof } = proofs[round % 2];
      const bytes = bytesOf(proof);
      for (let k = 0; k <= round % 3; k++) bytes[rand() % bytes.length] = rand() & 0xff;
      const r = await verifyAttestation({ method, proof: hexOf(bytes) }, people[0].credential, binding);
      if (r.ok === true) expect(hexOf(bytes)).toBe(proof);
    }
  });
});
