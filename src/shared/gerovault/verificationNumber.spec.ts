import { beforeAll, describe, expect, it } from 'vitest';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { encode as cborgEncode } from 'cborg';
import { encodeVaultPublicKeys, parseVaultPublicKeys } from './keys';
import { VaultManifest, newManifest, nextManifestRevision } from './manifest';
import { ManifestAck, checkManifestBeforeAck } from './manifestCheck';
import {
  CosignerVerification,
  VERIFICATION_DIGEST_TAG,
  VERIFICATION_NUMBER_TAG,
  compareVerificationQr,
  cosignerVerificationStatus,
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
} from './verificationNumber';
import { buildVaultFromParticipants } from './scripts';
import { VaultPublicKeys, VaultScripts } from './types';
import moduleSource from './verificationNumber.ts?raw';
import { TestParticipant, VECTOR_REVISED_AT, expiredTxAttestation, signedBinding, vectorFixture } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07). The
 * manifest is `vectorFixture()`, the one the manifest spec pins.
 */
const VECTOR = {
  verificationDigest: '22efd723ccd592ab2ab8f1da2300544048d478f0a8193cd8499c8a3455326e4f',
  numberDigest: '4546bb0b9b747c7cc17171fc49924f0cf685befe531e6bb3a6c33f9217974612301f653fe6655001',
  number: '06747 57105 84463 67870 60390 61623 54373 38945',
};

const T = VECTOR_REVISED_AT + 100;
const b = (h?: string) => (h ? Uint8Array.from(Buffer.from(h, 'hex')) : new Uint8Array(0));
const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

let people: TestParticipant[];
let vault: VaultScripts;
let id: string;
let manifest: VaultManifest;
let ack: ManifestAck;

const ownersOf = (list: readonly VaultPublicKeys[]) => list.map(vaultKeys => ({ vaultKeys }));
const mix = (a: VaultPublicKeys, s: VaultPublicKeys) =>
  parseVaultPublicKeys({ payment: encodeVaultPublicKeys(a).payment, stake: encodeVaultPublicKeys(s).stake });

async function ackOf(m: VaultManifest, n: number): Promise<ManifestAck> {
  const r = await checkManifestBeforeAck({ manifest: m, network: m.network, own: { kind: 'participant', roleKeys: people[n].roleKeys, index: 1 } });
  if (r.ok !== true) throw new Error(`fixture: ack refused ${r.code}`);
  return r;
}

beforeAll(async () => {
  ({ people, vault, id, manifest } = await vectorFixture());
  ack = await ackOf(manifest, 0);
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
    // Group i is the big-endian integer of bytes 5i to 5i+5, modulo 100000, on 5 digits.
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

  it('leaves out devices, viewers, labels and revisions, and covers every key and script', async () => {
    const v2 = nextManifestRevision(manifest, { roles: { viewers: [] }, revisedAt: T });
    expect(verificationDigest(v2)).toBe(verificationDigest(manifest));
    const ledger = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 3 });
    const v3 = nextManifestRevision(v2, {
      roles: { owners: v2.roles.owners.map(e => (e.credential === people[2].credential ? { ...e, devices: [ledger] } : e)) },
      revisedAt: T,
    });
    expect(verificationNumber(v3)).toEqual(verificationNumber(manifest));
    // Stake keys crossed between two owners: the same scripts, another verification set.
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
    // A device revision keeps the same QR.
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
      good.toUpperCase(),
      `${good}|`,
      `${good}\n`,
      parts.slice(0, 4).join('|'),
      [parts[0], 'VAULT_ACK', ...parts.slice(2)].join('|'),
      [parts[0], parts[1], 'preprod', ...parts.slice(3)].join('|'),
      [...parts.slice(0, 4), parts[4].slice(2)].join('|'),
      'x'.repeat(300),
      '',
      42,
      undefined,
    ]) {
      expect(parseVerificationQr(v)).toEqual({ ok: false, code: 'MALFORMED_QR' });
      expect(compareVerificationQr(v, manifest)).toBe('MALFORMED_QR');
    }
  });
});

describe('cosigner verification and the funding gate', () => {
  it('opens funding only when every other cosigner the scripts name is verified by the number or the QR', async () => {
    expect(await fundingVerified(manifest, ack, [])).toBe(false);
    const one = numberVerification(manifest, people[1].credential, T);
    expect(await fundingVerified(manifest, ack, [one])).toBe(false);
    const qr = qrVerification(manifest, people[2].credential, verificationQrPayload(manifest), T);
    expect(qr).toMatchObject({ method: 'qr', credential: people[2].credential, verificationDigest: verificationDigest(manifest) });
    expect(await fundingVerified(manifest, ack, [one, qr])).toBe(true);
    expect(await cosignerVerificationStatus(manifest, ack, [one, qr])).toEqual([
      { credential: people[1].credential, role: 'owner', state: 'verified', method: 'number', providers: [] },
      { credential: people[2].credential, role: 'owner', state: 'verified', method: 'qr', providers: [] },
    ].sort((x, y) => (x.credential < y.credential ? -1 : 1)));
    // `self` comes from the acknowledgement: another device's acknowledgement needs its own set.
    const ack2 = await ackOf(manifest, 2);
    expect(await fundingVerified(manifest, ack2, [one, qr])).toBe(false);
    expect(await fundingVerified(manifest, ack2, [one, numberVerification(manifest, people[0].credential, T)])).toBe(true);
  });

  it('never counts a check resolved by a provider', async () => {
    const records: CosignerVerification[] = [
      providerResolution(people[1].credential, 'adaHandle', T),
      providerResolution(people[1].credential, 'knownAddress', T),
      providerResolution(people[2].credential, 'sharedVault', T),
    ];
    expect(await fundingVerified(manifest, ack, records)).toBe(false);
    const status = await cosignerVerificationStatus(manifest, ack, records);
    expect(status.map(s => s.state)).toEqual(['providerOnly', 'providerOnly']);
    expect(status.find(s => s.credential === people[1].credential).providers).toEqual(['adaHandle', 'knownAddress']);
    const verified = [...records, numberVerification(manifest, people[1].credential, T), numberVerification(manifest, people[2].credential, T)];
    expect(await fundingVerified(manifest, ack, verified)).toBe(true);
  });

  it('records a QR only from a scan that matches', async () => {
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3).map(p => p.vaultKeys)), revisedAt: T });
    expect(qrVerification(manifest, people[1].credential, verificationQrPayload(preview), T)).toBeUndefined();
    expect(qrVerification(manifest, people[1].credential, 'not a payload', T)).toBeUndefined();
  });

  it('keeps a ceremony across device revisions, and asks again when the keys differ', async () => {
    const records = [numberVerification(manifest, people[1].credential, T), numberVerification(manifest, people[2].credential, T)];
    // Owner 3 binds a device: a revision with the same verification set. It needs its own
    // acknowledgement (the gate takes the acknowledgement of this very manifest), then the
    // ceremony already done still counts.
    const ledger = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 3 });
    const v2 = nextManifestRevision(manifest, {
      roles: { owners: manifest.roles.owners.map(e => (e.credential === people[2].credential ? { ...e, devices: [ledger] } : e)) },
      revisedAt: T,
    });
    expect(await fundingVerified(v2, ack, records)).toBe(false);
    const ackV2 = await checkManifestBeforeAck({ manifest: v2, network: 'preprod', own: { kind: 'participant', roleKeys: people[0].roleKeys, index: 1 }, accepted: [manifest] });
    expect(ackV2).toMatchObject({ ok: true, attestationsVerified: true });
    expect(await fundingVerified(v2, ackV2 as ManifestAck, records)).toBe(true);
    // Records made on a manifest with crossed stake keys are stale on the honest one.
    const crossed = newManifest({ vault, network: 'preprod', owners: ownersOf([people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)]), revisedAt: T });
    const onCrossed = [numberVerification(crossed, people[1].credential, T), numberVerification(crossed, people[2].credential, T)];
    expect((await cosignerVerificationStatus(manifest, ack, onCrossed)).map(s => s.state)).toEqual(['stale', 'stale']);
    expect(await fundingVerified(manifest, ack, onCrossed)).toBe(false);
  });

  it('verifies an external cosigner only by their own attestation, received by a second owner', async () => {
    const withExternal = newManifest({
      vault,
      network: 'preprod',
      owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys]),
      external: [{ vaultKeys: people[2].vaultKeys, label: 'Other wallet', importedBy: people[0].credential, role: 'owner' }],
      revisedAt: T,
    });
    const ext = people[2];
    const digest = verificationDigest(withExternal);
    const proof = expiredTxAttestation(ext.signer, ext.credential, { kind: 'verification', digest }).proof;
    const ack1 = await ackOf(withExternal, 1);
    const p0 = numberVerification(withExternal, people[0].credential, T);
    // Received by owner 1, who did not import the keys.
    const received = await externalVerification(withExternal, ext.credential, proof, people[1].credential, T);
    expect(received).toMatchObject({ ok: true, record: { method: 'external', credential: ext.credential, receivedBy: people[1].credential } });
    const record = received.ok === true ? received.record : undefined;
    expect(await fundingVerified(withExternal, ack1, [p0, record])).toBe(true);
    // Received only by the importer, while another owner exists.
    expect(await externalVerification(withExternal, ext.credential, proof, people[0].credential, T)).toEqual({ ok: false, code: 'WRONG_ROUTE' });
    const viaImporter = { ...record, receivedBy: people[0].credential };
    const ack0 = await ackOf(withExternal, 0);
    expect((await cosignerVerificationStatus(withExternal, ack0, [numberVerification(withExternal, people[1].credential, T), viaImporter]))
      .find(s => s.credential === ext.credential)).toMatchObject({ role: 'external', state: 'importerOnly' });
    // A proof by another key, over another digest, or a number record for an external: none count.
    const forged = expiredTxAttestation(people[3].signer, ext.credential, { kind: 'verification', digest }).proof;
    expect(await externalVerification(withExternal, ext.credential, forged, people[1].credential, T)).toEqual({ ok: false, code: 'WRONG_KEY' });
    const otherDigest = expiredTxAttestation(ext.signer, ext.credential, { kind: 'verification', digest: 'ab'.repeat(32) }).proof;
    expect(await externalVerification(withExternal, ext.credential, otherDigest, people[1].credential, T)).toEqual({ ok: false, code: 'WRONG_PAYLOAD' });
    expect(await externalVerification(withExternal, people[1].credential, proof, people[0].credential, T)).toEqual({ ok: false, code: 'NOT_AN_EXTERNAL' });
    expect(await externalVerification(withExternal, ext.credential, proof, ext.credential, T)).toEqual({ ok: false, code: 'NOT_AN_OWNER' });
    expect(await fundingVerified(withExternal, ack1, [p0, numberVerification(withExternal, ext.credential, T)])).toBe(false);
    // A record whose proof was swapped after it was made is checked again.
    expect(await fundingVerified(withExternal, ack1, [p0, { ...record, proof: forged } as CosignerVerification])).toBe(false);
  });

  it('lets the importer receive the attestation when no other owner exists', async () => {
    const backupOnly = await buildVaultFromParticipants({
      template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
      owners: ownersOf([people[0].vaultKeys, people[1].vaultKeys]),
      backups: ownersOf([people[2].vaultKeys]),
    });
    const m = newManifest({
      vault: backupOnly,
      network: 'preprod',
      owners: ownersOf([people[0].vaultKeys]),
      backupHolders: ownersOf([people[2].vaultKeys]),
      external: [{ vaultKeys: people[1].vaultKeys, label: 'Other wallet', importedBy: people[0].credential, role: 'owner' }],
      revisedAt: T,
    });
    const proof = expiredTxAttestation(people[1].signer, people[1].credential, { kind: 'verification', digest: verificationDigest(m) }).proof;
    const r = await externalVerification(m, people[1].credential, proof, people[0].credential, T);
    expect(r.ok).toBe(true);
    const ack0 = await ackOf(m, 0);
    const records = [r.ok === true ? r.record : undefined, numberVerification(m, people[2].credential, T)];
    expect(await fundingVerified(m, ack0, records)).toBe(true);
    expect((await cosignerVerificationStatus(m, ack0, records)).map(s => s.role).sort()).toEqual(['backupHolder', 'external']);
  });

  it('takes no amount, refuses an acknowledgement of another manifest, and never throws', async () => {
    // The gate takes the manifest, the acknowledgement and the records: no amount.
    expect(fundingVerified.length).toBe(3);
    const records = [numberVerification(manifest, people[1].credential, T), numberVerification(manifest, people[2].credential, T)];
    const other = newManifest({ vault, network: 'preprod', owners: ownersOf(people.slice(0, 3).map(p => p.vaultKeys)), revisedAt: T });
    expect(await fundingVerified(other, ack, records)).toBe(false);
    await expect(cosignerVerificationStatus(other, ack, records)).rejects.toMatchObject({ code: 'INVALID_VERIFICATION' });
    expect(await fundingVerified(manifest, { ...ack, attestationsVerified: false }, records)).toBe(false);
    expect(await fundingVerified(manifest, { ...ack, vaultId: 'ab'.repeat(32) }, records)).toBe(false);
    expect(await fundingVerified(manifest, undefined, records)).toBe(false);
    expect(await fundingVerified(undefined, ack, records)).toBe(false);
    expect(await fundingVerified(manifest, ack, undefined)).toBe(false);
    const malformed = [
      { ...records[0], credential: records[0].credential.toUpperCase() },
      { ...records[1], verificationDigest: undefined },
      { ...records[1], method: 'handshake' },
      null,
    ] as unknown as CosignerVerification[];
    expect(await fundingVerified(manifest, ack, malformed)).toBe(false);
  });

  it('builds only well-formed records', () => {
    expect(() => numberVerification(manifest, 'ab' as Ed25519KeyHashHex, T)).toThrow(expect.objectContaining({ code: 'INVALID_KEY_HASH' }));
    expect(() => numberVerification(manifest, people[1].credential, -1)).toThrow(expect.objectContaining({ code: 'INVALID_TIME' }));
    expect(() => providerResolution(people[1].credential, 'email' as 'adaHandle', T)).toThrow(expect.objectContaining({ code: 'INVALID_VERIFICATION' }));
    expect(() => numberVerification({ ...manifest, version: 0 }, people[1].credential, T)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});
