import { beforeAll, describe, expect, it } from 'vitest';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { encode as cborgEncode } from 'cborg';
import { encodeVaultPublicKeys, parseVaultPublicKeys } from './keys';
import { VaultManifest, deviceIdOf, newManifest, nextManifestRevision } from './manifest';
import { ManifestAck, checkManifestBeforeAck } from './manifestCheck';
import { buildVaultFromParticipants } from './scripts';
import {
  CosignerVerification,
  EXTERNAL_ENDORSEMENT_TAG,
  ExternalEndorsement,
  VERIFICATION_DIGEST_TAG,
  VERIFICATION_NUMBER_TAG,
  compareVerificationQr,
  cosignerVerificationStatus,
  endorsedVerification,
  externalAttestationHash,
  externalEndorsementBody,
  externalEndorsementDigest,
  externalVerification,
  fundingVerified,
  numberVerification,
  parseVerificationQr,
  providerResolution,
  qrVerification,
  verificationDigest,
  verificationNumber,
  verificationNumberDigest,
  verificationNumberGroups,
  verificationQrPayload,
  verificationSetCbor,
  verifyExternalEndorsement,
} from './verificationNumber';
import { VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import moduleSource from './verificationNumber.ts?raw';
import { TestParticipant, VECTOR_REVISED_AT, expiredTxAttestation, signedBinding, signedExternal, testDevice, vectorFixture } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07). The
 * manifest is `vectorFixture()`; the endorsement is test device 2's over the external cosigner of
 * the external manifest below.
 */
const VECTOR = {
  verificationDigest: '22efd723ccd592ab2ab8f1da2300544048d478f0a8193cd8499c8a3455326e4f',
  numberDigest: '4546bb0b9b747c7cc17171fc49924f0cf685befe531e6bb3a6c33f9217974612301f653fe6655001',
  number: '06747 57105 84463 67870 60390 61623 54373 38945',
  endorsementDigest: '9752e2c663077587177c386f0ca455bb295daf64339afaf03a7ad823ddcfaf78',
};

const T = VECTOR_REVISED_AT + 100;
const b = (h?: string) => (h ? Uint8Array.from(Buffer.from(h, 'hex')) : new Uint8Array(0));
const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

let people: TestParticipant[];
let vault: VaultScripts;
let id: string;
let manifest: VaultManifest;
/** Every owner bound: owners 1, 2 and 3 with test devices 1, 2 and 3. */
let bound: VaultManifest;
let ack: ManifestAck;

const ownersOf = (list: readonly VaultPublicKeys[]) => list.map(vaultKeys => ({ vaultKeys }));
const mix = (a: VaultPublicKeys, s: VaultPublicKeys) =>
  parseVaultPublicKeys({ payment: encodeVaultPublicKeys(a).payment, stake: encodeVaultPublicKeys(s).stake });

async function ackOf(m: VaultManifest, n: number): Promise<ManifestAck> {
  const r = await checkManifestBeforeAck({ manifest: m, network: m.network, own: { kind: 'participant', roleKeys: people[n].roleKeys, index: 1 } });
  if (r.ok !== true) throw new Error(`fixture: ack refused ${r.code}`);
  return r;
}

async function boundOwners(v: VaultScripts, n: readonly number[]) {
  const vid = vaultId(v, 'preprod');
  return Promise.all(n.map(async i => ({ vaultKeys: people[i].vaultKeys, devices: [await signedBinding({ vaultId: vid, role: 'owner', participant: people[i], device: i + 1 })] })));
}

/** Owners 1 and 2, both bound (devices 1 and 2); the third participant external, imported by device 1. */
async function externalManifest(): Promise<VaultManifest> {
  return newManifest({
    vault,
    network: 'preprod',
    owners: await boundOwners(vault, [0, 1]),
    external: [await signedExternal({ vaultId: id, participant: people[2], importer: 1 })],
    revisedAt: T,
  });
}

async function endorse(m: VaultManifest, device: number, proof: string, credential = people[2].credential, endorserDeviceId?: string): Promise<ExternalEndorsement> {
  const d = await testDevice(device);
  const body = externalEndorsementBody(m, credential, proof, endorserDeviceId ?? deviceIdOf(d.ed25519Pub));
  return { ...body, signature: d.key.sign(HexBlob(externalEndorsementDigest(body))).hex() };
}

beforeAll(async () => {
  ({ people, vault, id, manifest } = await vectorFixture());
  bound = newManifest({ vault, network: 'preprod', owners: await boundOwners(vault, [0, 1, 2]), revisedAt: T });
  ack = await ackOf(bound, 0);
});

describe('the verification number', () => {
  it('matches the provisional vectors', () => {
    expect(verificationDigest(manifest)).toBe(VECTOR.verificationDigest);
    expect(verificationNumberDigest(manifest)).toBe(VECTOR.numberDigest);
    expect(verificationNumber(manifest).join(' ')).toBe(VECTOR.number);
  });

  it('is over the verification set as spec 5.3 now defines it (checked with cborg and a second blake2b)', () => {
    const entry = (p: TestParticipant) => ({ credential: b(p.credential), vaultKeys: { payment: b(p.vaultKeys.payment), stake: b(p.vaultKeys.stake) } });
    const byCredential = (list: TestParticipant[]) => [...list].sort((x, y) => (x.credential < y.credential ? -1 : 1));
    const set = {
      network: 'cardano-preprod',
      paymentScript: b(vault.payment.cbor),
      stakeScript: b(vault.stake.cbor),
      owners: byCredential(people.slice(0, 3)).map(entry),
      backupHolders: [],
      guardians: [],
      external: [],
    };
    const cbor = hexOf(cborgEncode(set));
    expect(verificationSetCbor(manifest)).toBe(cbor);
    const tagged = (tag: string, len: number) => sdkBlake2b.hash(HexBlob(Buffer.from(tag, 'utf8').toString('hex') + cbor), len);
    expect(verificationDigest(manifest)).toBe(tagged(VERIFICATION_DIGEST_TAG, 32));
    expect(verificationNumberDigest(manifest)).toBe(tagged(VERIFICATION_NUMBER_TAG, 40));
    const d = Buffer.from(verificationNumberDigest(manifest), 'hex');
    const groups = Array.from({ length: 8 }, (_, i) => String(d.readUIntBE(5 * i, 5) % 100000).padStart(5, '0'));
    expect(verificationNumber(manifest)).toEqual(groups);
  });

  it('is 40 digits in 8 groups of 5, with no wordlist anywhere in the module', () => {
    expect(verificationNumber(manifest)).toHaveLength(8);
    for (const group of verificationNumber(manifest)) expect(group).toMatch(/^\d{5}$/);
    expect(verificationNumberGroups('00'.repeat(40))).toEqual(Array(8).fill('00000'));
    // 0xffffffffff = 1099511627775, which is 27775 modulo 100000.
    expect(verificationNumberGroups('ff'.repeat(40))).toEqual(Array(8).fill('27775'));
    expect(() => verificationNumberGroups('00')).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
    expect(() => verificationNumberGroups('FF'.repeat(40))).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
    expect(moduleSource).not.toMatch(/bip39|wordlist/i);
  });

  it('leaves out devices, viewers, labels, importers and revisions, and covers every key and script', async () => {
    const v2 = nextManifestRevision(manifest, { roles: { viewers: [] }, revisedAt: T });
    expect(verificationDigest(v2)).toBe(verificationDigest(manifest));
    expect(verificationDigest(bound)).toBe(verificationDigest(manifest));
    const ext = await externalManifest();
    const byOtherImporter = newManifest({
      vault,
      network: 'preprod',
      owners: await boundOwners(vault, [0, 1]),
      external: [await signedExternal({ vaultId: id, participant: people[2], importer: 2, label: 'Renamed' })],
      revisedAt: T,
    });
    expect(verificationDigest(byOtherImporter)).toBe(verificationDigest(ext));
    const crossed = newManifest({ vault, network: 'preprod', owners: ownersOf([people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)]), revisedAt: T });
    expect(crossed.vaultId).toBe(manifest.vaultId);
    expect(verificationDigest(crossed)).not.toBe(verificationDigest(manifest));
    expect(verificationNumber(crossed)).not.toEqual(verificationNumber(manifest));
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3).map(p => p.vaultKeys)), revisedAt: T });
    expect(verificationDigest(preview)).not.toBe(verificationDigest(manifest));
  });
});

describe('the in-person QR', () => {
  it('carries the full verification digest', () => {
    const payload = verificationQrPayload(manifest);
    expect(payload).toBe(`gero-vault/v1|VERIFY|cardano-preprod|${id}|${verificationDigest(manifest)}`);
    expect(parseVerificationQr(payload)).toEqual({ ok: true, qr: { network: 'preprod', vaultId: id, verificationDigest: verificationDigest(manifest) } });
    expect(compareVerificationQr(payload, manifest)).toBe('MATCH');
    expect(compareVerificationQr(payload, nextManifestRevision(manifest, { roles: { viewers: [] }, revisedAt: T }))).toBe('MATCH');
  });

  it('tells another vault and other keys apart, neither of which verifies', () => {
    const crossed = newManifest({ vault, network: 'preprod', owners: ownersOf([people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)]), revisedAt: T });
    expect(compareVerificationQr(verificationQrPayload(crossed), manifest)).toBe('DIFFERENT_KEYS');
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3).map(p => p.vaultKeys)), revisedAt: T });
    expect(compareVerificationQr(verificationQrPayload(preview), manifest)).toBe('OTHER_VAULT');
  });

  it('refuses a malformed payload', () => {
    const good = verificationQrPayload(manifest);
    const parts = good.split('|');
    for (const v of [
      good.toUpperCase(), `${good}|`, `${good}\n`, parts.slice(0, 4).join('|'),
      [parts[0], 'VAULT_ACK', ...parts.slice(2)].join('|'), [parts[0], parts[1], 'preprod', ...parts.slice(3)].join('|'),
      [...parts.slice(0, 4), parts[4].slice(2)].join('|'), 'x'.repeat(300), '', 42, undefined,
    ]) {
      expect(parseVerificationQr(v)).toEqual({ ok: false, code: 'MALFORMED_QR' });
      expect(compareVerificationQr(v, manifest)).toBe('MALFORMED_QR');
    }
  });
});

describe('the funding gate', () => {
  it('opens only when every other cosigner the scripts name is verified by the number or the QR', async () => {
    expect(await fundingVerified(bound, ack, [])).toBe(false);
    const one = numberVerification(bound, people[1].credential, T);
    expect(await fundingVerified(bound, ack, [one])).toBe(false);
    const qr = qrVerification(bound, people[2].credential, verificationQrPayload(bound), T);
    expect(qr).toMatchObject({ method: 'qr', credential: people[2].credential, verificationDigest: verificationDigest(bound) });
    expect(await fundingVerified(bound, ack, [one, qr])).toBe(true);
    expect(await cosignerVerificationStatus(bound, ack, [one, qr])).toEqual([
      { credential: people[1].credential, role: 'owner', state: 'verified', method: 'number', attested: true, providers: [] },
      { credential: people[2].credential, role: 'owner', state: 'verified', method: 'qr', attested: true, providers: [] },
    ].sort((x, y) => (x.credential < y.credential ? -1 : 1)));
    // `self` comes from the acknowledgement: another device's acknowledgement needs its own set.
    const ack2 = await ackOf(bound, 2);
    expect(await fundingVerified(bound, ack2, [one, qr])).toBe(false);
    expect(await fundingVerified(bound, ack2, [one, numberVerification(bound, people[0].credential, T)])).toBe(true);
  });

  it('needs every participant attested: an owner with no bound device keeps funding closed', async () => {
    // The vector manifest: owner 3 has no device yet.
    const ack0 = await ackOf(manifest, 0);
    expect(ack0.unattested).toEqual([people[2].credential]);
    const records = [numberVerification(manifest, people[1].credential, T), numberVerification(manifest, people[2].credential, T)];
    expect(await fundingVerified(manifest, ack0, records)).toBe(false);
    expect((await cosignerVerificationStatus(manifest, ack0, records)).find(s => s.credential === people[2].credential)).toMatchObject({ state: 'verified', attested: false });
    // Once owner 3 binds a device the same ceremony counts.
    expect(await fundingVerified(bound, ack, records)).toBe(true);
    // And so does this device's own participant: an unbound own entry keeps funding closed too.
    const ownUnbound = newManifest({ vault, network: 'preprod', owners: [...await boundOwners(vault, [1, 2]), { vaultKeys: people[0].vaultKeys }], revisedAt: T });
    const ackOwn = await ackOf(ownUnbound, 0);
    expect(await fundingVerified(ownUnbound, ackOwn, records)).toBe(false);
  });

  it('never counts a check resolved by a provider', async () => {
    const records: CosignerVerification[] = [
      providerResolution(people[1].credential, 'adaHandle', T),
      providerResolution(people[1].credential, 'knownAddress', T),
      providerResolution(people[2].credential, 'sharedVault', T),
    ];
    expect(await fundingVerified(bound, ack, records)).toBe(false);
    const status = await cosignerVerificationStatus(bound, ack, records);
    expect(status.map(s => s.state)).toEqual(['providerOnly', 'providerOnly']);
    expect(status.find(s => s.credential === people[1].credential).providers).toEqual(['adaHandle', 'knownAddress']);
    const verified = [...records, numberVerification(bound, people[1].credential, T), numberVerification(bound, people[2].credential, T)];
    expect(await fundingVerified(bound, ack, verified)).toBe(true);
  });

  it('records a QR only from a scan that matches', async () => {
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3).map(p => p.vaultKeys)), revisedAt: T });
    expect(qrVerification(bound, people[1].credential, verificationQrPayload(preview), T)).toBeUndefined();
    expect(qrVerification(bound, people[1].credential, 'not a payload', T)).toBeUndefined();
  });

  it('keeps the ceremony across a device revision, does not depend on revision acceptance, and asks again when keys differ', async () => {
    const records = [numberVerification(bound, people[1].credential, T), numberVerification(bound, people[2].credential, T)];
    const extra = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 33 });
    const v2 = nextManifestRevision(bound, {
      roles: { owners: bound.roles.owners.map(e => (e.credential === people[2].credential ? { ...e, devices: [...e.devices, extra] } : e)) },
      revisedAt: T,
    });
    expect(await fundingVerified(v2, ack, records)).toBe(false);
    const ackV2 = await checkManifestBeforeAck({ manifest: v2, network: 'preprod', own: { kind: 'participant', roleKeys: people[0].roleKeys, index: 1 }, accepted: [{ manifest: bound, attestationsVerified: true, unverified: [] }] });
    expect(ackV2).toMatchObject({ ok: true, attestationsVerified: true });
    expect(await fundingVerified(v2, ackV2 as ManifestAck, records)).toBe(true);
    // A revision that removes a device is not accepted until GV-22, but funding does not look at that.
    const shrunk = nextManifestRevision(v2, {
      roles: { owners: v2.roles.owners.map(e => (e.credential === people[2].credential ? { ...e, devices: e.devices.filter(d => d.deviceId !== extra.deviceId) } : e)) },
      revisedAt: T,
    });
    const ackShrunk = await checkManifestBeforeAck({ manifest: shrunk, network: 'preprod', own: { kind: 'participant', roleKeys: people[0].roleKeys, index: 1 }, accepted: [{ manifest: bound, attestationsVerified: true, unverified: [] }, { manifest: v2, attestationsVerified: true, unverified: [] }] });
    expect(ackShrunk).toMatchObject({ ok: true, attestationsVerified: false, unverified: ['DEVICE_REMOVED'] });
    expect(await fundingVerified(shrunk, ackShrunk as ManifestAck, records)).toBe(true);
    // Records made on a manifest with crossed stake keys are stale on the honest one.
    const crossed = newManifest({ vault, network: 'preprod', owners: ownersOf([people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)]), revisedAt: T });
    const onCrossed = [numberVerification(crossed, people[1].credential, T), numberVerification(crossed, people[2].credential, T)];
    expect((await cosignerVerificationStatus(bound, ack, onCrossed)).map(s => s.state)).toEqual(['stale', 'stale']);
    expect(await fundingVerified(bound, ack, onCrossed)).toBe(false);
  });

  it('takes only a branded acknowledgement of this very manifest, takes no amount, and never throws', async () => {
    expect(fundingVerified.length).toBe(3);
    const records = [numberVerification(bound, people[1].credential, T), numberVerification(bound, people[2].credential, T)];
    const other = newManifest({ vault, network: 'preprod', owners: await boundOwners(vault, [0, 1, 2]), revisedAt: T + 1 });
    expect(await fundingVerified(other, ack, records)).toBe(false);
    await expect(cosignerVerificationStatus(other, ack, records)).rejects.toMatchObject({ code: 'INVALID_VERIFICATION' });
    // A copy or a hand-made acknowledgement is not an acknowledgement.
    expect(await fundingVerified(bound, { ...ack }, records)).toBe(false);
    expect(await fundingVerified(bound, { ...ack, unattested: [] }, records)).toBe(false);
    expect(await fundingVerified(bound, undefined, records)).toBe(false);
    expect(await fundingVerified(undefined, ack, records)).toBe(false);
    expect(await fundingVerified(bound, ack, undefined)).toBe(false);
    const malformed = [
      { ...records[0], credential: records[0].credential.toUpperCase() },
      { ...records[1], verificationDigest: undefined },
      { ...records[1], method: 'handshake' },
      null,
    ] as unknown as CosignerVerification[];
    expect(await fundingVerified(bound, ack, malformed)).toBe(false);
  });

  it('builds only well-formed records', () => {
    expect(() => numberVerification(bound, 'ab' as Ed25519KeyHashHex, T)).toThrow(expect.objectContaining({ code: 'INVALID_KEY_HASH' }));
    expect(() => numberVerification(bound, people[1].credential, -1)).toThrow(expect.objectContaining({ code: 'INVALID_TIME' }));
    expect(() => providerResolution(people[1].credential, 'email' as 'adaHandle', T)).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
    expect(() => numberVerification({ ...bound, version: 0 }, people[1].credential, T)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});

describe('external cosigners: their own attestation, received directly or endorsed', () => {
  let ext: VaultManifest;
  let proof: string;
  let ack0: ManifestAck;
  let ack1: ManifestAck;

  beforeAll(async () => {
    ext = await externalManifest();
    proof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', digest: verificationDigest(ext) }).proof;
    ack0 = await ackOf(ext, 0);
    ack1 = await ackOf(ext, 1);
  });

  it('verifies on the device of an owner who did not import them', async () => {
    const received = await externalVerification(ext, ack1, people[2].credential, proof, T);
    expect(received).toMatchObject({ ok: true, record: { method: 'external', credential: people[2].credential } });
    const record = received.ok === true ? received.record : undefined;
    expect(await fundingVerified(ext, ack1, [numberVerification(ext, people[0].credential, T), record])).toBe(true);
    // The same record on the importer's device is not enough: it must have come to another owner.
    expect(await externalVerification(ext, ack0, people[2].credential, proof, T)).toEqual({ ok: false, code: 'WRONG_ROUTE' });
    const status = await cosignerVerificationStatus(ext, ack0, [numberVerification(ext, people[1].credential, T), record]);
    expect(status.find(s => s.credential === people[2].credential)).toMatchObject({ role: 'external', state: 'importerOnly' });
    expect(await fundingVerified(ext, ack0, [numberVerification(ext, people[1].credential, T), record])).toBe(false);
  });

  it('reaches the importer\'s device by an endorsement from the receiving owner\'s device', async () => {
    const endorsement = await endorse(ext, 2, proof);
    expect(externalEndorsementDigest(endorsement)).toBe(VECTOR.endorsementDigest);
    expect(externalEndorsementDigest(endorsement)).toBe(sdkBlake2b.hash(HexBlob(Buffer.from(EXTERNAL_ENDORSEMENT_TAG, 'utf8').toString('hex') + hexOf(cborgEncode({
      verificationDigest: b(verificationDigest(ext)),
      externalCredential: b(people[2].credential),
      externalAttestationHash: b(externalAttestationHash(proof)),
      endorserDeviceId: b(endorsement.endorserDeviceId),
    }))), 32));
    expect(await verifyExternalEndorsement(ext, endorsement, proof)).toEqual({ ok: true });
    const endorsed = await endorsedVerification(ext, endorsement, proof, T);
    expect(endorsed).toMatchObject({ ok: true, record: { method: 'endorsed' } });
    const record = endorsed.ok === true ? endorsed.record : undefined;
    expect(await fundingVerified(ext, ack0, [numberVerification(ext, people[1].credential, T), record])).toBe(true);
    // Withheld: the importer's device stays closed.
    expect(await fundingVerified(ext, ack0, [numberVerification(ext, people[1].credential, T)])).toBe(false);
  });

  it('refuses an endorsement by the importer, for another digest, or from an unbound device', async () => {
    expect(await verifyExternalEndorsement(ext, await endorse(ext, 1, proof), proof)).toEqual({ ok: false, code: 'ENDORSER_IS_IMPORTER' });
    const other = newManifest({ vault, network: 'preprod', owners: await boundOwners(vault, [0, 1]), external: [await signedExternal({ vaultId: id, participant: people[2], importer: 1, label: 'Renamed' })], revisedAt: T });
    const crossedVault = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys, people[3].vaultKeys]) });
    expect(verificationDigest(other)).toBe(verificationDigest(ext));
    const elsewhere = newManifest({
      vault: crossedVault,
      network: 'preprod',
      owners: await boundOwners(crossedVault, [0, 1]),
      external: [await signedExternal({ vaultId: vaultId(crossedVault, 'preprod'), participant: people[3], importer: 1 })],
      revisedAt: T,
    });
    const foreign = await endorse(elsewhere, 2, proof, people[2].credential);
    expect(await verifyExternalEndorsement(ext, foreign, proof)).toEqual({ ok: false, code: 'DIGEST_MISMATCH' });
    expect(await verifyExternalEndorsement(ext, await endorse(ext, 50, proof), proof)).toEqual({ ok: false, code: 'UNBOUND_DEVICE' });
    const otherProof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', digest: 'ab'.repeat(32) }).proof;
    expect(await verifyExternalEndorsement(ext, await endorse(ext, 2, proof), otherProof)).toEqual({ ok: false, code: 'ATTESTATION_HASH_MISMATCH' });
    expect(await verifyExternalEndorsement(ext, await endorse(ext, 2, otherProof), otherProof)).toEqual({ ok: false, code: 'WRONG_PAYLOAD' });
    const signedByOther = { ...await endorse(ext, 2, proof), signature: (await endorse(ext, 3, proof, people[2].credential, deviceIdOf((await testDevice(2)).ed25519Pub))).signature };
    expect(await verifyExternalEndorsement(ext, signedByOther, proof)).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
    expect(await verifyExternalEndorsement(ext, { ...await endorse(ext, 2, proof), externalCredential: people[1].credential }, proof)).toEqual({ ok: false, code: 'NOT_AN_EXTERNAL' });
    expect(await verifyExternalEndorsement(ext, undefined, proof)).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('takes the attestation alone when the importer is the only owner', async () => {
    const backupVault = await buildVaultFromParticipants({
      template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
      owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys]),
      backups: ownersOf([people[2].vaultKeys]),
    });
    const vid = vaultId(backupVault, 'preprod');
    const m = newManifest({
      vault: backupVault,
      network: 'preprod',
      owners: await boundOwners(backupVault, [0]),
      backupHolders: [{ vaultKeys: people[2].vaultKeys, devices: [await signedBinding({ vaultId: vid, role: 'backupHolder', participant: people[2], device: 3 })] }],
      external: [await signedExternal({ vaultId: vid, participant: people[1], importer: 1 })],
      revisedAt: T,
    });
    const extProof = expiredTxAttestation(people[1].signer, people[1].credential, { kind: 'verification', digest: verificationDigest(m) }).proof;
    const ackOnly = await ackOf(m, 0);
    const r = await externalVerification(m, ackOnly, people[1].credential, extProof, T);
    expect(r.ok).toBe(true);
    const records = [r.ok === true ? r.record : undefined, numberVerification(m, people[2].credential, T)];
    expect(await fundingVerified(m, ackOnly, records)).toBe(true);
    expect((await cosignerVerificationStatus(m, ackOnly, records)).map(s => s.role).sort()).toEqual(['backupHolder', 'external']);
  });

  it('refuses proofs by another key, over another digest, and number records for an external', async () => {
    const digest = verificationDigest(ext);
    const forged = expiredTxAttestation(people[3].signer, people[2].credential, { kind: 'verification', digest }).proof;
    expect(await externalVerification(ext, ack1, people[2].credential, forged, T)).toEqual({ ok: false, code: 'WRONG_KEY' });
    const otherDigest = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', digest: 'ab'.repeat(32) }).proof;
    expect(await externalVerification(ext, ack1, people[2].credential, otherDigest, T)).toEqual({ ok: false, code: 'WRONG_PAYLOAD' });
    expect(await externalVerification(ext, ack1, people[1].credential, proof, T)).toEqual({ ok: false, code: 'NOT_AN_EXTERNAL' });
    expect(await externalVerification(ext, { ...ack1 }, people[2].credential, proof, T)).toEqual({ ok: false, code: 'INVALID_ACK' });
    expect(await fundingVerified(ext, ack1, [numberVerification(ext, people[0].credential, T), numberVerification(ext, people[2].credential, T)])).toBe(false);
    const received = await externalVerification(ext, ack1, people[2].credential, proof, T);
    const record = received.ok === true ? received.record : undefined;
    expect(await fundingVerified(ext, ack1, [numberVerification(ext, people[0].credential, T), { ...record, proof: forged } as CosignerVerification])).toBe(false);
  });

  it('discloses its residual: an importer who substitutes a key they hold can sign for it', async () => {
    // The importer (owner 1) puts in keys it controls (participant 4) instead of the external's,
    // signs the attestation itself and hands the file to owner 2. Nothing in software can tell;
    // owner 2 must obtain the file from the external person by a channel the importer does not
    // control (spec 12; the wallet's screen says so).
    const subVault = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys, people[3].vaultKeys]) });
    const subId = vaultId(subVault, 'preprod');
    const sub = newManifest({
      vault: subVault,
      network: 'preprod',
      owners: await boundOwners(subVault, [0, 1]),
      external: [await signedExternal({ vaultId: subId, participant: people[3], importer: 1 })],
      revisedAt: T,
    });
    const subProof = expiredTxAttestation(people[3].signer, people[3].credential, { kind: 'verification', digest: verificationDigest(sub) }).proof;
    const ackSub1 = await ackOf(sub, 1);
    const r = await externalVerification(sub, ackSub1, people[3].credential, subProof, T);
    expect(r.ok).toBe(true);
  });
});
