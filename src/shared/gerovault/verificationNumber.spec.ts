import { beforeAll, describe, expect, it } from 'vitest';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { encode as cborgEncode } from 'cborg';
import { encodeVaultPublicKeys, parseVaultPublicKeys } from './keys';
import { VaultManifest, newManifest, nextManifestRevision, nextRevisionRemovingDevice } from './manifest';
import { AcceptedVault, ManifestAck, acceptRevision, checkManifestBeforeAck } from './manifestCheck';
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
import {
  TestParticipant,
  VECTOR_REVISED_AT,
  attestationBy,
  expiredTxAttestation,
  removalBy,
  signedBinding,
  signedEndorsement,
  signedExternal,
  vectorFixture,
} from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07). The
 * manifest is `vectorFixture()`; the endorsement digest is owner 2's over the external cosigner
 * of the external manifest below.
 */
const VECTOR = {
  verificationDigest: '22efd723ccd592ab2ab8f1da2300544048d478f0a8193cd8499c8a3455326e4f',
  numberDigest: '4546bb0b9b747c7cc17171fc49924f0cf685befe531e6bb3a6c33f9217974612301f653fe6655001',
  number: '06747 57105 84463 67870 60390 61623 54373 38945',
  endorsementDigest: '59b1c90a6ae7e3ab7afe531ed029374d24a20e46d9390cfb3d765896d20ae92a',
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

async function ackOf(m: VaultManifest, n: number, accepted: readonly AcceptedVault[] = []): Promise<ManifestAck> {
  const r = await checkManifestBeforeAck({ manifest: m, network: m.network, own: { kind: 'participant', roleKeys: people[n].roleKeys, index: 1 }, accepted });
  if (r.ok !== true) throw new Error(`fixture: ack refused ${r.code}`);
  return r;
}

/** The history index of `manifests` as participant `n`'s device accepts them, and its ack of the last. */
async function acceptAll(manifests: readonly VaultManifest[], n: number): Promise<{ history: AcceptedVault; ack: ManifestAck }> {
  let history: AcceptedVault | undefined;
  let ack: ManifestAck;
  for (const m of manifests) {
    ack = await ackOf(m, n, history ? [history] : []);
    history = acceptRevision(history, m, ack);
  }
  return { history, ack };
}

async function boundOwners(v: VaultScripts, n: readonly number[]) {
  const vid = vaultId(v, 'preprod');
  return Promise.all(n.map(async i => ({ vaultKeys: people[i].vaultKeys, devices: [await signedBinding({ vaultId: vid, role: 'owner', participant: people[i], device: i + 1 })] })));
}

/** Owners 1 and 2, both bound (devices 1 and 2); the third participant external, imported by owner 1. */
async function externalManifest(): Promise<VaultManifest> {
  return newManifest({
    vault,
    network: 'preprod',
    owners: await boundOwners(vault, [0, 1]),
    external: [signedExternal({ vaultId: id, participant: people[2], importer: people[0] })],
    revisedAt: T,
  });
}

/** Participant `n`'s endorsement of the external attestation `proof`. */
const endorse = (m: VaultManifest, n: number, proof: string, credential = people[2].credential, method?: 'cip8' | 'expiredTx'): ExternalEndorsement =>
  signedEndorsement(m, people[n], credential, proof, method);

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

  it('is eight groups of five digits, and the module holds no wordlist', () => {
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
      external: [signedExternal({ vaultId: id, participant: people[2], importer: people[1], label: 'Renamed' })],
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

  it('keeps the ceremony across device revisions, opens only on the latest accepted revision, and asks again when keys differ', async () => {
    const records = [numberVerification(bound, people[1].credential, T), numberVerification(bound, people[2].credential, T)];
    const extra = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 33 });
    const v2 = nextManifestRevision(bound, {
      roles: { owners: bound.roles.owners.map(e => (e.credential === people[2].credential ? { ...e, devices: [...e.devices, extra] } : e)) },
      revisedAt: T,
    });
    expect(await fundingVerified(v2, ack, records)).toBe(false);
    const { history: h2, ack: ackV2 } = await acceptAll([bound, v2], 0);
    expect(ackV2).toMatchObject({ ok: true, attestationsVerified: true, latest: true });
    expect(await fundingVerified(v2, ackV2, records)).toBe(true);
    // A device removed by its own participant is accepted at once, and funding goes on.
    const shrunk = nextRevisionRemovingDevice(v2, { deviceId: extra.deviceId, removal: removalBy(people[2], id, extra), revisedAt: T });
    const ackShrunk = await ackOf(shrunk, 0, [h2]);
    expect(ackShrunk).toMatchObject({ ok: true, attestationsVerified: true, latest: true });
    expect(await fundingVerified(shrunk, ackShrunk, records)).toBe(true);
    // Once that is accepted, the superseded revision checked again opens nothing.
    const ackOld = await ackOf(v2, 0, [acceptRevision(h2, shrunk, ackShrunk)]);
    expect(ackOld).toMatchObject({ ok: true, redelivery: true, latest: false });
    expect(await fundingVerified(v2, ackOld, records)).toBe(false);
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
    proof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest: verificationDigest(ext) }).proof;
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

  it('reaches the importer\'s device by an endorsement attested by the receiving owner\'s payment key', async () => {
    const endorsement = endorse(ext, 1, proof);
    expect(endorsement.endorserCredential).toBe(people[1].credential);
    expect(externalEndorsementDigest(endorsement)).toBe(VECTOR.endorsementDigest);
    expect(externalEndorsementDigest(endorsement)).toBe(sdkBlake2b.hash(HexBlob(Buffer.from(EXTERNAL_ENDORSEMENT_TAG, 'utf8').toString('hex') + hexOf(cborgEncode({
      verificationDigest: b(verificationDigest(ext)),
      externalCredential: b(people[2].credential),
      externalAttestationHash: b(sdkBlake2b.hash(HexBlob(proof), 32)),
      endorserCredential: b(people[1].credential),
    }))), 32));
    expect(externalAttestationHash(proof)).toBe(sdkBlake2b.hash(HexBlob(proof), 32));
    expect(await verifyExternalEndorsement(ext, endorsement, proof)).toEqual({ ok: true });
    expect(await verifyExternalEndorsement(ext, endorse(ext, 1, proof, people[2].credential, 'expiredTx'), proof)).toEqual({ ok: true });
    const endorsed = await endorsedVerification(ext, endorsement, proof, T);
    expect(endorsed).toMatchObject({ ok: true, record: { method: 'endorsed' } });
    const record = endorsed.ok === true ? endorsed.record : undefined;
    expect(await fundingVerified(ext, ack0, [numberVerification(ext, people[1].credential, T), record])).toBe(true);
    // Withheld: the importer's device stays closed.
    expect(await fundingVerified(ext, ack0, [numberVerification(ext, people[1].credential, T)])).toBe(false);
  });

  it('keeps an endorsement valid when the endorsing owner\'s device is removed', async () => {
    const endorsed = await endorsedVerification(ext, endorse(ext, 1, proof), proof, T);
    const record = endorsed.ok === true ? endorsed.record : undefined;
    const phone = ext.roles.owners.find(e => e.credential === people[1].credential).devices[0];
    const v2 = nextRevisionRemovingDevice(ext, { deviceId: phone.deviceId, removal: removalBy(people[1], id, phone), revisedAt: T + 60 });
    expect(v2.roles.owners.find(e => e.credential === people[1].credential).devices).toEqual([]);
    const { ack: ackV2 } = await acceptAll([ext, v2], 0);
    expect(ackV2).toMatchObject({ latest: true, unattested: [people[1].credential] });
    expect(await verifyExternalEndorsement(v2, record.method === 'endorsed' ? record.endorsement : undefined, proof)).toEqual({ ok: true });
    // Its owner now has no attested device, which closes funding until they bind one again.
    expect(await fundingVerified(v2, ackV2, [numberVerification(v2, people[1].credential, T), record])).toBe(false);
    const tablet = await signedBinding({ vaultId: id, role: 'owner', participant: people[1], device: 22 });
    const v3 = nextManifestRevision(v2, { roles: { owners: v2.roles.owners.map(e => (e.credential === people[1].credential ? { ...e, devices: [tablet] } : e)) }, revisedAt: T + 120 });
    const { ack: ackV3 } = await acceptAll([ext, v2, v3], 0);
    expect(await fundingVerified(v3, ackV3, [numberVerification(v3, people[1].credential, T), record])).toBe(true);
  });

  it('refuses an endorsement by the importer, by anyone outside the owners slot, for another digest or attested by another key', async () => {
    expect(await verifyExternalEndorsement(ext, endorse(ext, 0, proof), proof)).toEqual({ ok: false, code: 'ENDORSER_IS_IMPORTER' });
    expect(await verifyExternalEndorsement(ext, endorse(ext, 3, proof), proof)).toEqual({ ok: false, code: 'NOT_AN_OWNER' });
    const crossedVault = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys, people[3].vaultKeys]) });
    const elsewhere = newManifest({
      vault: crossedVault,
      network: 'preprod',
      owners: await boundOwners(crossedVault, [0, 1]),
      external: [signedExternal({ vaultId: vaultId(crossedVault, 'preprod'), participant: people[3], importer: people[0] })],
      revisedAt: T,
    });
    expect(await verifyExternalEndorsement(ext, endorse(elsewhere, 1, proof, people[2].credential), proof)).toEqual({ ok: false, code: 'DIGEST_MISMATCH' });
    const otherProof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest: 'ab'.repeat(32) }).proof;
    expect(await verifyExternalEndorsement(ext, endorse(ext, 1, proof), otherProof)).toEqual({ ok: false, code: 'ATTESTATION_HASH_MISMATCH' });
    expect(await verifyExternalEndorsement(ext, endorse(ext, 1, otherProof), otherProof)).toEqual({ ok: false, code: 'WRONG_PAYLOAD' });
    // Named as owner 2's, attested by owner 1's key.
    const honest = endorse(ext, 1, proof);
    const byOther = { ...honest, attestation: attestationBy(people[0], { kind: 'endorsement', network: 'preprod', digest: externalEndorsementDigest(honest) }) };
    expect(await verifyExternalEndorsement(ext, byOther, proof)).toEqual({ ok: false, code: 'ENDORSEMENT_INVALID', attestation: 'WRONG_KEY' });
    // Attested by owner 2 over another body.
    const otherBody = { ...honest, attestation: attestationBy(people[1], { kind: 'endorsement', network: 'preprod', digest: 'cd'.repeat(32) }) };
    expect(await verifyExternalEndorsement(ext, otherBody, proof)).toEqual({ ok: false, code: 'ENDORSEMENT_INVALID', attestation: 'WRONG_PAYLOAD' });
    expect(await verifyExternalEndorsement(ext, { ...honest, externalCredential: people[1].credential }, proof)).toEqual({ ok: false, code: 'NOT_AN_EXTERNAL' });
    expect(await verifyExternalEndorsement(ext, undefined, proof)).toEqual({ ok: false, code: 'MALFORMED' });
    expect(await verifyExternalEndorsement(ext, { ...honest, attestation: undefined }, proof)).toEqual({ ok: false, code: 'MALFORMED' });
  });

  it('opens only on the latest accepted revision: a relabel still waiting for threshold attestations opens nothing', async () => {
    const received = await externalVerification(ext, ack1, people[2].credential, proof, T);
    const records = [numberVerification(ext, people[0].credential, T), received.ok === true ? received.record : undefined];
    const { history } = await acceptAll([ext], 1);
    const relabelled = nextManifestRevision(ext, { roles: { external: [signedExternal({ vaultId: id, participant: people[2], importer: people[0], label: 'Renamed' })] }, revisedAt: T + 60 });
    const pending = await ackOf(relabelled, 1, [history]);
    expect(pending).toMatchObject({ attestationsVerified: false, latest: false, unverified: ['EXTERNAL_CHANGE'] });
    expect(await fundingVerified(relabelled, pending, records)).toBe(false);
    expect(await fundingVerified(ext, await ackOf(ext, 1, [history]), records)).toBe(true);
  });

  it('never carries an endorsement across a change of importer: a migration changes the verification set', async () => {
    // Owners 1, 2 and 4, with the third participant external, imported by owner 1 and endorsed by owner 4.
    const before = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([0, 1, 2, 3].map(i => people[i].vaultKeys)) });
    const old = newManifest({
      vault: before,
      network: 'preprod',
      owners: await boundOwners(before, [0, 1, 3]),
      external: [signedExternal({ vaultId: vaultId(before, 'preprod'), participant: people[2], importer: people[0] })],
      revisedAt: T,
    });
    const oldProof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest: verificationDigest(old) }).proof;
    const oldEndorsement = endorse(old, 3, oldProof);
    expect(await verifyExternalEndorsement(old, oldEndorsement, oldProof)).toEqual({ ok: true });
    // Owner 1 leaves: the vault migrates to owners 2 and 4, and owner 2 imports the external again.
    const after = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([1, 2, 3].map(i => people[i].vaultKeys)) });
    const migrated = newManifest({
      vault: after,
      network: 'preprod',
      owners: await boundOwners(after, [1, 3]),
      external: [signedExternal({ vaultId: vaultId(after, 'preprod'), participant: people[2], importer: people[1] })],
      revisedAt: T,
    });
    expect(migrated.paymentScript).not.toBe(old.paymentScript);
    expect(verificationDigest(migrated)).not.toBe(verificationDigest(old));
    // Owner 4 is still an owner and still not the importer, yet the old endorsement names the old set.
    expect(await verifyExternalEndorsement(migrated, oldEndorsement, oldProof)).toEqual({ ok: false, code: 'DIGEST_MISMATCH' });
    const stale = await endorsedVerification(old, oldEndorsement, oldProof, T);
    const ackMigrated = await ackOf(migrated, 1);
    const ceremony = numberVerification(migrated, people[3].credential, T);
    expect(await fundingVerified(migrated, ackMigrated, [ceremony, stale.ok === true ? stale.record : undefined])).toBe(false);
    const status = await cosignerVerificationStatus(migrated, ackMigrated, [ceremony, stale.ok === true ? stale.record : undefined]);
    expect(status.find(c => c.credential === people[2].credential)).toMatchObject({ role: 'external', state: 'stale' });
    // A new attestation by the external and a new endorsement by owner 4 open it.
    const newProof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest: verificationDigest(migrated) }).proof;
    const fresh = await endorsedVerification(migrated, endorse(migrated, 3, newProof), newProof, T);
    expect(await fundingVerified(migrated, ackMigrated, [ceremony, fresh.ok === true ? fresh.record : undefined])).toBe(true);
  });

  it('asks a new importer for an endorsement by another owner: deposits stay closed until one exists', async () => {
    // The importer (owner 1) leaves: the remaining owners move to a new vault, where owner 2
    // imports the external again. The old endorsement names the old verification digest.
    const oldEndorsement = endorse(ext, 1, proof);
    const moved = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([people[1].vaultKeys, people[2].vaultKeys, people[3].vaultKeys]) });
    const movedId = vaultId(moved, 'preprod');
    const next = newManifest({
      vault: moved,
      network: 'preprod',
      owners: await boundOwners(moved, [1, 3]),
      external: [signedExternal({ vaultId: movedId, participant: people[2], importer: people[1] })],
      revisedAt: T,
    });
    expect(next.roles.external[0].importedBy).toBe(people[1].credential);
    const nextProof = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest: verificationDigest(next) }).proof;
    const ackNew = await ackOf(next, 1);
    const ceremony = numberVerification(next, people[3].credential, T);
    expect(await verifyExternalEndorsement(next, oldEndorsement, proof)).toEqual({ ok: false, code: 'DIGEST_MISMATCH' });
    expect(await fundingVerified(next, ackNew, [ceremony])).toBe(false);
    // The new importer's own endorsement or direct receipt does not count.
    expect(await verifyExternalEndorsement(next, endorse(next, 1, nextProof), nextProof)).toEqual({ ok: false, code: 'ENDORSER_IS_IMPORTER' });
    expect(await externalVerification(next, ackNew, people[2].credential, nextProof, T)).toEqual({ ok: false, code: 'WRONG_ROUTE' });
    // Another owner's endorsement does.
    const endorsed = await endorsedVerification(next, endorse(next, 3, nextProof), nextProof, T);
    expect(await fundingVerified(next, ackNew, [ceremony, endorsed.ok === true ? endorsed.record : undefined])).toBe(true);
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
      external: [signedExternal({ vaultId: vid, participant: people[1], importer: people[0] })],
      revisedAt: T,
    });
    const extProof = expiredTxAttestation(people[1].signer, people[1].credential, { kind: 'verification', network: 'preprod', digest: verificationDigest(m) }).proof;
    const ackOnly = await ackOf(m, 0);
    const r = await externalVerification(m, ackOnly, people[1].credential, extProof, T);
    expect(r.ok).toBe(true);
    const records = [r.ok === true ? r.record : undefined, numberVerification(m, people[2].credential, T)];
    expect(await fundingVerified(m, ackOnly, records)).toBe(true);
    expect((await cosignerVerificationStatus(m, ackOnly, records)).map(s => s.role).sort()).toEqual(['backupHolder', 'external']);
  });

  it('refuses proofs by another key, over another digest, and number records for an external', async () => {
    const digest = verificationDigest(ext);
    const forged = expiredTxAttestation(people[3].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest }).proof;
    expect(await externalVerification(ext, ack1, people[2].credential, forged, T)).toEqual({ ok: false, code: 'WRONG_KEY' });
    const otherDigest = expiredTxAttestation(people[2].signer, people[2].credential, { kind: 'verification', network: 'preprod', digest: 'ab'.repeat(32) }).proof;
    expect(await externalVerification(ext, ack1, people[2].credential, otherDigest, T)).toEqual({ ok: false, code: 'WRONG_PAYLOAD' });
    expect(await externalVerification(ext, ack1, people[1].credential, proof, T)).toEqual({ ok: false, code: 'NOT_AN_EXTERNAL' });
    expect(await externalVerification(ext, { ...ack1 }, people[2].credential, proof, T)).toEqual({ ok: false, code: 'INVALID_ACK' });
    expect(await fundingVerified(ext, ack1, [numberVerification(ext, people[0].credential, T), numberVerification(ext, people[2].credential, T)])).toBe(false);
    const received = await externalVerification(ext, ack1, people[2].credential, proof, T);
    const record = received.ok === true ? received.record : undefined;
    expect(await fundingVerified(ext, ack1, [numberVerification(ext, people[0].credential, T), { ...record, proof: forged } as CosignerVerification])).toBe(false);
  });

  it('shows its residual: an importer who swaps in a key of their own can sign for it', async () => {
    // The importer (owner 1) puts in keys it controls (participant 4) instead of the external's,
    // signs the attestation itself and hands the file to owner 2. Nothing in software can tell
    // the difference; what protects owner 2 is getting the file from the cosigner in person,
    // never through owner 1 (spec 12; the wallet's screen says so).
    const subVault = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys, people[3].vaultKeys]) });
    const subId = vaultId(subVault, 'preprod');
    const sub = newManifest({
      vault: subVault,
      network: 'preprod',
      owners: await boundOwners(subVault, [0, 1]),
      external: [signedExternal({ vaultId: subId, participant: people[3], importer: people[0] })],
      revisedAt: T,
    });
    const subProof = expiredTxAttestation(people[3].signer, people[3].credential, { kind: 'verification', network: 'preprod', digest: verificationDigest(sub) }).proof;
    const ackSub1 = await ackOf(sub, 1);
    const r = await externalVerification(sub, ackSub1, people[3].credential, subProof, T);
    expect(r.ok).toBe(true);
  });
});
