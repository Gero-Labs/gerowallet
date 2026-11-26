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
  canonicalAttestation,
  cip8Proof,
  expiredTxAuxiliaryData,
  expiredTxBody,
  expiredTxBodyHash,
  ingestAttestation,
  isCanonicalAttestation,
  verifyAttestation,
  verifyEd25519,
} from './attestation';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { readCbor } from './cbor';
import { TestParticipant, cip8Attestation, expiredTxAttestation, testParticipants, walletCip8Attestation } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors (GV-07): the expired transaction body and auxiliary data for test
 * participant 0 (the published cardano-addresses key at vault index 1) over the binding digest
 * `ab` x 32, and the hashes of both complete stored proofs by that key.
 */
const VECTORS = {
  auxiliaryData: 'a119486da1005820abababababababababababababababababababababababababababababababab',
  body: 'a600818258200000000000000000000000000000000000000000000000000000000000000000000180020003010758204c492b248804e86d28819091a2394b6d435e71db70c24b6bf4d28ade935fcf260e81581c1196fe3062e96b78dd959058f5adad44dd663519200f2495d17ef10d',
  expiredTxProofHash: '62c26f4c4ce0c0945bfb0e7ece0ea96de809c7e68d64f35b12472f816412ef33',
  cip8ProofHash: 'dec4ff211e9350228c0b7f8adbaab061cd408e668edd8f58fd262223726a0f6b',
};

const DIGEST = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const binding: AttestedDigest = { kind: 'binding', digest: DIGEST };
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytesOf = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;
const IDENTITY = `01${'00'.repeat(31)}`;
const keyHash = (hex: string) => sdkBlake2b.hash(HexBlob(hex), 28);

let people: TestParticipant[];

beforeAll(async () => {
  people = await testParticipants();
});

const verify = (a: OwnerAttestation, who: TestParticipant, subject: AttestedDigest = binding) => verifyAttestation(a, who.credential, subject);
const codeOf = async (a: OwnerAttestation, who: TestParticipant | string, subject: AttestedDigest = binding) => {
  const r = await verifyAttestation(a, typeof who === 'string' ? who : who.credential, subject);
  return r.ok === true ? 'ok' : r.code;
};
const ingested = async (a: OwnerAttestation, who: TestParticipant, subject: AttestedDigest = binding) => {
  const r = await ingestAttestation(a, who.credential, subject);
  return r.ok === true ? r.attestation : r.code;
};

/** The proof's CBOR, decoded with an independent decoder (maps with integer keys as `Map`). */
const decoded = (proof: string) => cborgDecode(bytesOf(proof), { useMaps: true }) as unknown[];
const reencode = (value: unknown) => hexOf(encodeCanonicalCbor(value as CborWritable));
/** The two byte strings of a CIP-8 proof. */
const parts = (proof: string) => cborgDecode(bytesOf(proof)) as Uint8Array[];

describe('CIP-8 attestations', () => {
  it('verify in their stored form over the digest', async () => {
    expect(await verify(cip8Attestation(people[0].signer, people[0].credential, DIGEST), people[0])).toEqual({ ok: true });
    expect(await verify(cip8Attestation(people[1].signer, people[1].credential, DIGEST), people[1])).toEqual({ ok: true });
  });

  it('are stored as [ [protected, {}, payload, signature], { 1: 1, 3: -8, -1: 6, -2: key } ]', () => {
    const [sign1, key] = parts(cip8Attestation(people[0].signer, people[0].credential, DIGEST).proof);
    const coseKey = cborgDecode(key, { useMaps: true }) as Map<number, unknown>;
    expect([...coseKey.keys()]).toEqual([1, 3, -1, -2]);
    expect([coseKey.get(1), coseKey.get(3), coseKey.get(-1)]).toEqual([1, -8, 6]);
    expect(hexOf(coseKey.get(-2) as Uint8Array)).toBe(people[0].signer.toPublic().hex());
    const s = cborgDecode(sign1, { useMaps: true }) as unknown[];
    expect(s[1]).toEqual(new Map());
    expect(hexOf(s[2] as Uint8Array)).toBe(DIGEST);
  });

  it('take the wallet\'s own signData output at ingest, and only the stored form afterwards', async () => {
    const wallet = walletCip8Attestation(people[0].signer, people[0].credential, DIGEST);
    expect(await codeOf(wallet, people[0])).toBe('NOT_CANONICAL');
    expect(isCanonicalAttestation(wallet)).toBe(false);
    const stored = cip8Attestation(people[0].signer, people[0].credential, DIGEST);
    expect(await ingested(wallet, people[0])).toEqual(stored);
    expect(isCanonicalAttestation(stored)).toBe(true);
    expect(await ingested(stored, people[0])).toEqual(stored);
  });

  it('rebuild the Sig_structure exactly as the COSE library signs it', () => {
    const [sign1] = parts(walletCip8Attestation(people[0].signer, people[0].credential, DIGEST).proof);
    const [protectedBytes, , payload] = cborgDecode(sign1, { useMaps: true }) as Uint8Array[];
    const ours = encodeCanonicalCbor(['Signature1', protectedBytes, new Uint8Array(0), payload]);
    expect(hexOf(ours)).toBe(hexOf(COSESign1.from_bytes(sign1).signed_data().to_bytes()));
  });

  describe('the review\'s four rewrites of a valid proof: refused stored, normalised at ingest', () => {
    const rewrite = (fn: (sign1: unknown[], key: Map<number, unknown>) => [unknown, Map<number, unknown>], encodeKey = reencode) => {
      const [sign1, key] = parts(walletCip8Attestation(people[0].signer, people[0].credential, DIGEST).proof);
      const [s, k] = fn(cborgDecode(sign1, { useMaps: true }) as unknown[], cborgDecode(key, { useMaps: true }) as Map<number, unknown>);
      return { method: 0, proof: cip8Proof(reencode(s), encodeKey(k)) };
    };
    const cases: [string, () => OwnerAttestation][] = [
      ['a reordered COSE_Key', () => rewrite((s, k) => [s, k], k => hexOf(cborgEncode(new Map([...(k as Map<number, unknown>).entries()].reverse()), { mapSorter: () => 0 })))],
      ['a COSE_Key without kid', () => rewrite((s, k) => {
        k.delete(2);
        return [s, k];
      })],
      ['a COSE_Key without alg', () => rewrite((s, k) => {
        k.delete(3);
        return [s, k];
      })],
      ['the other unprotected header', () => rewrite((s, k) => {
        const unprotected = s[1] as Map<string, unknown>;
        return [[s[0], unprotected.size > 0 ? new Map() : new Map([['hashed', false]]), s[2], s[3]], k];
      })],
    ];
    it.each(cases)('%s', async (_what, make) => {
      const variant = make();
      const stored = cip8Attestation(people[0].signer, people[0].credential, DIGEST);
      expect(variant.proof).not.toBe(stored.proof);
      expect(await codeOf(variant, people[0])).toBe('NOT_CANONICAL');
      expect(await ingested(variant, people[0])).toEqual(stored);
    });

    it('a tagged COSE_Sign1 is normalised too', async () => {
      const [sign1, key] = parts(walletCip8Attestation(people[0].signer, people[0].credential, DIGEST).proof);
      const tagged = { method: 0, proof: cip8Proof(hexOf(new Uint8Array([0xd2, ...sign1])), hexOf(key)) };
      expect(await codeOf(tagged, people[0])).toBe('MALFORMED_PROOF');
      expect(await ingested(tagged, people[0])).toEqual(cip8Attestation(people[0].signer, people[0].credential, DIGEST));
    });
  });

  it('refuse a key that does not hash to the credential', async () => {
    expect(await codeOf(cip8Attestation(people[1].signer, people[1].credential, DIGEST), people[0])).toBe('WRONG_KEY');
  });

  it('refuse a signature by another key under the participant\'s COSE_Key', async () => {
    const [sign1ByOther] = parts(cip8Attestation(people[1].signer, people[0].credential, DIGEST).proof);
    const [, keyOfOwner] = parts(cip8Attestation(people[0].signer, people[0].credential, DIGEST).proof);
    expect(await codeOf({ method: 0, proof: cip8Proof(hexOf(sign1ByOther), hexOf(keyOfOwner)) }, people[0])).toBe('BAD_SIGNATURE');
  });

  it('refuse another payload, and anything but a binding digest', async () => {
    expect(await codeOf(cip8Attestation(people[0].signer, people[0].credential, OTHER), people[0])).toBe('WRONG_PAYLOAD');
    const a = cip8Attestation(people[0].signer, people[0].credential, DIGEST);
    expect(await codeOf(a, people[0], { kind: 'verification', digest: DIGEST })).toBe('METHOD_NOT_ALLOWED');
  });

  it('refuse at ingest a kid that does not repeat the signed address, and unsupported headers and keys', async () => {
    const [sign1, key] = parts(walletCip8Attestation(people[0].signer, people[0].credential, DIGEST).proof);
    const coseKey = cborgDecode(key, { useMaps: true }) as Map<number, unknown>;
    const ingestCode = (s: Uint8Array, k: Map<number, unknown>) => {
      const r = canonicalAttestation({ method: 0, proof: cip8Proof(hexOf(s), reencode(k)) });
      return r.ok === true ? 'ok' : r.code;
    };
    expect(ingestCode(sign1, new Map(coseKey).set(2, new Uint8Array(29)))).toBe('UNSUPPORTED_KEY');
    expect(ingestCode(sign1, new Map(coseKey).set(5, new Uint8Array(1)))).toBe('UNSUPPORTED_KEY');
    expect(ingestCode(sign1, new Map(coseKey).set(-1, 1))).toBe('UNSUPPORTED_KEY');
    const s = cborgDecode(sign1, { useMaps: true }) as unknown[];
    expect(ingestCode(bytesOf(reencode([s[0], new Map([['hashed', true]]), s[2], s[3]])), coseKey)).toBe('UNSUPPORTED_HEADER');
    expect(ingestCode(bytesOf(reencode([s[0], new Map([['other', false]]), s[2], s[3]])), coseKey)).toBe('UNSUPPORTED_HEADER');
    expect(ingestCode(bytesOf(hexOf(cborgEncode([s[0], s[1], null, s[3]]))), coseKey)).toBe('MALFORMED_PROOF');
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
    expect(await codeOf(expiredTxAttestation(people[2].signer, people[2].credential, verification), people[2])).toBe('WRONG_PAYLOAD');
  });

  it('refuse a re-encoded witness set when stored, and normalise it at ingest', async () => {
    const stored = expiredTxAttestation(people[0].signer, people[0].credential, binding);
    const proof = bytesOf(stored.proof);
    const root = readCbor(proof, { maxDepth: 8, maxItems: 256, booleans: true });
    const witnesses = root.value.type === 'array' ? root.value.value[1] : undefined;
    const inner = proof.subarray(witnesses.start + 2, witnesses.end); // after a1 00: the vkey witness list
    const splice = (replacement: number[]) => hexOf(Uint8Array.from([...proof.subarray(0, witnesses.start), ...replacement, ...proof.subarray(witnesses.end)]));
    const variants = {
      // The vkey witnesses as a Conway set (tag 258).
      setTag: splice([0xa1, 0x00, 0xd9, 0x01, 0x02, ...inner]),
      // An indefinite-length list of witnesses.
      indefinite: splice([0xa1, 0x00, 0x9f, ...inner.subarray(1), 0xff]),
      // A map head with a non-minimal length.
      nonMinimal: splice([0xb8, 0x01, 0x00, ...inner]),
    };
    for (const proofHex of Object.values(variants)) {
      const variant = { method: 1, proof: proofHex };
      expect(await codeOf(variant, people[0])).not.toBe('ok');
      expect(isCanonicalAttestation(variant)).toBe(false);
      expect(await ingested(variant, people[0])).toEqual(stored);
    }
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

describe('strict Ed25519 (RFC 8032)', () => {
  const message = bytesOf('00112233');
  const withS = (signature: Uint8Array, s: bigint) => {
    const out = Uint8Array.from(signature);
    for (let i = 0; i < 32; i++) out[32 + i] = Number((s >> BigInt(8 * i)) & 0xffn);
    return out;
  };
  const sOf = (signature: Uint8Array) => {
    let n = 0n;
    for (let i = 31; i >= 0; i--) n = (n << 8n) | BigInt(signature[32 + i]);
    return n;
  };

  it('accepts a valid signature and refuses one whose S is not below the group order', async () => {
    const key = bytesOf(people[0].signer.toPublic().hex());
    const signature = bytesOf(people[0].signer.sign(HexBlob('00112233')).hex());
    expect(await verifyEd25519(key, signature, message)).toBe(true);
    const nonCanonical = withS(signature, sOf(signature) + GROUP_ORDER);
    expect(sOf(nonCanonical) < 2n ** 256n).toBe(true);
    expect(await verifyEd25519(key, nonCanonical, message)).toBe(false);
  });

  it('refuses a small-order key and a small-order R, which verify anything in a lax implementation', async () => {
    // R = identity, S = 0: [S]B = R + [k]A holds for the identity key A whatever the message.
    const trivial = bytesOf(IDENTITY + '00'.repeat(32));
    expect(await verifyEd25519(bytesOf(IDENTITY), trivial, message)).toBe(false);
    const key = bytesOf(people[0].signer.toPublic().hex());
    expect(await verifyEd25519(key, trivial, message)).toBe(false);
  });

  it('refuses an attestation by a small-order key whose hash is the credential', async () => {
    const credential = keyHash(IDENTITY);
    const protectedBytes = encodeCanonicalCbor(new Map([[1, -8]]));
    const sign1 = encodeCanonicalCbor([protectedBytes, new Map(), bytesOf(DIGEST), bytesOf(IDENTITY + '00'.repeat(32))]);
    const key = encodeCanonicalCbor(new Map<number, CborWritable>([[1, 1], [3, -8], [-1, 6], [-2, bytesOf(IDENTITY)]]));
    const cip8 = { method: 0, proof: cip8Proof(hexOf(sign1), hexOf(key)) };
    expect(isCanonicalAttestation(cip8)).toBe(true);
    expect(await codeOf(cip8, credential)).toBe('BAD_SIGNATURE');
    const tx = { method: 1, proof: assembleExpiredTx(credential, binding, IDENTITY, IDENTITY + '00'.repeat(32)) };
    expect(await codeOf(tx, credential)).toBe('BAD_SIGNATURE');
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
    expect(canonicalAttestation({ method: 3, proof: a.proof })).toEqual({ ok: false, code: 'UNKNOWN_METHOD' });
  });

  it('never throws on mutated proofs, stored or at ingest', async () => {
    const proofs = [expiredTxAttestation(people[0].signer, people[0].credential, binding), cip8Attestation(people[0].signer, people[0].credential, DIGEST)];
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let round = 0; round < 300; round++) {
      const { method, proof } = proofs[round % 2];
      const bytes = bytesOf(proof);
      for (let k = 0; k <= round % 3; k++) bytes[rand() % bytes.length] = rand() & 0xff;
      const r = await verifyAttestation({ method, proof: hexOf(bytes) }, people[0].credential, binding);
      if (r.ok === true) expect(hexOf(bytes)).toBe(proof);
      const i = await ingestAttestation({ method, proof: hexOf(bytes) }, people[0].credential, binding);
      if (i.ok === true) expect(i.attestation.proof).toBe(proof);
    }
  });
});
