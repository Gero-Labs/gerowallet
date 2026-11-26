import { beforeAll, describe, expect, it } from 'vitest';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { isManifestAck } from './ackBrand';
import { encodeVaultPublicKeys, parseVaultPublicKeys } from './keys';
import {
  OwnerDeviceBinding,
  VaultManifest,
  bindingDeviceDigest,
  bindingDigest,
  deviceBinding,
  manifestHash,
  newManifest,
  nextManifestRevision,
  normalizeManifest,
} from './manifest';
import { AcceptedManifest, ManifestAckInput, OwnParticipant, UnverifiedChange, checkManifestBeforeAck } from './manifestCheck';
import { decodeRegistration, dedupeRegistrations, encodeRegistration } from './registration';
import { buildVaultFromParticipants, instantiateVaultScripts } from './scripts';
import { VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import { verificationDigest } from './verificationNumber';
import {
  TestParticipant,
  VECTOR_REVISED_AT,
  cip8Attestation,
  signedBinding,
  signedExternal,
  testDevice,
  testParticipants,
  vectorFixture,
} from './__fixtures__/manifest';

const T = VECTOR_REVISED_AT;

let people: TestParticipant[];
let vault: VaultScripts;
let backupVault: VaultScripts;
let id: string;
let base: VaultManifest;
let laptop: OwnerDeviceBinding;

const owner = (i: number, index = 1, extra: Partial<Extract<OwnParticipant, { kind: 'participant' }>> = {}): OwnParticipant =>
  ({ kind: 'participant', roleKeys: people[i].roleKeys, index, ...extra });
const ownersOf = (list: readonly (TestParticipant | VaultPublicKeys)[]) => list.map(p => ({ vaultKeys: 'vaultKeys' in p ? p.vaultKeys : p }));
const mix = (a: VaultPublicKeys, s: VaultPublicKeys) =>
  parseVaultPublicKeys({ payment: encodeVaultPublicKeys(a).payment, stake: encodeVaultPublicKeys(s).stake });
/** An accepted revision as a device stores it. */
const acc = (manifest: VaultManifest, attestationsVerified = true, unverified: UnverifiedChange[] = []): AcceptedManifest => ({ manifest, attestationsVerified, unverified });

/** The fixture's viewer, admitted by test device 2 (owner 2's) instead of device 1. */
const readmitted = async () => [{ devices: [await signedBinding({ vaultId: id, role: 'viewer', device: 9, label: 'Accountant', admitter: 2 })] }];

function check(manifest: VaultManifest, own: OwnParticipant, rest: Partial<ManifestAckInput> = {}) {
  return checkManifestBeforeAck({ manifest, network: 'preprod', own, ...rest });
}

/** The fixture's entry of participant `n`, replaced. */
function withOwner(m: VaultManifest, n: number, change: (e: VaultManifest['roles']['owners'][number]) => object): VaultManifest {
  return normalizeManifest({
    ...m,
    roles: { ...m.roles, owners: m.roles.owners.map(e => (e.credential === people[n].credential ? { ...e, ...change(e) } : e)) },
  } as VaultManifest);
}

/** The owners list with participant `n`'s devices replaced, not yet checked. */
const ownersWith = (m: VaultManifest, n: number, devices: readonly OwnerDeviceBinding[]) =>
  m.roles.owners.map(e => (e.credential === people[n].credential ? { ...e, devices } : e));

/** A binding of test device `n` for owner 0, signed and attested, with the X25519 key and version given. */
async function rebound(n: number, x25519Pub: string, bindingVersion: number): Promise<OwnerDeviceBinding> {
  const device = await testDevice(n);
  const body = deviceBinding({ vaultId: id, role: 'owner', vaultKeys: people[0].vaultKeys, ed25519Pub: device.ed25519Pub, x25519Pub, label: 'Laptop', bindingVersion });
  return {
    ...body,
    deviceSig: device.key.sign(HexBlob(bindingDeviceDigest(body))).hex(),
    attestation: cip8Attestation(people[0].signer, people[0].credential, bindingDigest(body)),
  };
}

beforeAll(async () => {
  ({ people, vault, id, manifest: base } = await vectorFixture());
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
    owners: ownersOf(people.slice(0, 2)),
    backups: ownersOf(people.slice(2, 3)),
  });
  laptop = base.roles.owners.find(e => e.credential === people[0].credential).devices[0];
});

describe('checks before acknowledging a manifest', () => {
  it('accept an honest manifest on every participant\'s device, every signature verified', async () => {
    for (let i = 0; i < 3; i++) {
      const ack = await check(base, owner(i));
      expect(ack).toEqual({
        ok: true,
        vaultId: id,
        manifestHash: manifestHash(base),
        verificationDigest: verificationDigest(base),
        template: { kind: 'standard', threshold: 2 },
        ownRole: 'owner',
        ownCredential: people[i].credential,
        redelivery: false,
        canonicalKeyOrder: true,
        attestationsVerified: true,
        unverified: [],
        unattested: [people[2].credential],
        externals: [],
        bindingVersions: Object.fromEntries([...base.roles.owners, ...base.roles.viewers].flatMap(e => e.devices).map(d => [d.deviceId, 1])),
      });
      expect(isManifestAck(ack)).toBe(true);
      expect(isManifestAck({ ...ack })).toBe(false);
    }
  });

  it('check the device\'s own entry against the keys it derives at its own index', async () => {
    expect(await check(base, owner(3))).toEqual({ ok: false, code: 'OWN_ENTRY_MISSING', credential: people[3].credential });
    expect(await check(base, owner(0, 2))).toMatchObject({ ok: false, code: 'OWN_ENTRY_MISSING' });
    expect(await check(base, owner(0, 1, { role: 'backupHolder' }))).toEqual({ ok: false, code: 'OWN_ROLE_MISMATCH', credential: people[0].credential });
    expect(await check(base, owner(0, -1))).toEqual({ ok: false, code: 'INVALID_INPUT' });
    // Stake keys crossed between two owners with no device yet: the scripts cannot tell, each
    // owner's own check does, and neither can fund until bound (`unattested`).
    const crossed = newManifest({ vault, network: 'preprod', owners: ownersOf([people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)]), revisedAt: T });
    expect(await check(crossed, owner(1))).toEqual({ ok: false, code: 'OWN_KEYS_MISMATCH', credential: people[1].credential });
    expect(await check(crossed, owner(2))).toEqual({ ok: false, code: 'OWN_KEYS_MISMATCH', credential: people[2].credential });
    expect(await check(crossed, owner(0))).toMatchObject({ ok: true, unattested: expect.arrayContaining([people[1].credential, people[2].credential]) });
  });

  it('check the device\'s own binding when it expects one', async () => {
    const device = await testDevice(1);
    expect(await check(base, owner(0, 1, { device }))).toMatchObject({ ok: true });
    // The relay swaps the device's key agreement key for its own, even with valid signatures.
    const swapped = await rebound(1, (await testDevice(7)).x25519Pub, 1);
    const m = withOwner(base, 0, () => ({ devices: [swapped] }));
    expect(await check(m, owner(0, 1, { device }))).toEqual({ ok: false, code: 'OWN_DEVICE_MISMATCH', credential: people[0].credential });
  });

  it('let a viewer check its own binding', async () => {
    const viewer = await check(base, { kind: 'viewer', device: await testDevice(9) });
    expect(viewer).toMatchObject({ ok: true, ownRole: 'viewer' });
    expect(viewer.ok === true && 'ownCredential' in viewer).toBe(false);
    expect(await check(base, { kind: 'viewer', device: await testDevice(8) })).toEqual({ ok: false, code: 'OWN_DEVICE_MISMATCH' });
  });

  it('give one vault id whatever indexes the participants used, and carry none', async () => {
    const indexes = [21, 1, 3, 1];
    const mixed = await testParticipants(indexes);
    const fromRoleKeys = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: mixed.slice(0, 3).map(p => ({ roleKeys: p.roleKeys, index: p.index })),
    });
    const fromVaultKeys = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: ownersOf(mixed.slice(0, 3)) });
    expect(vaultId(fromVaultKeys, 'preprod')).toBe(vaultId(fromRoleKeys, 'preprod'));
    const mixedId = vaultId(fromRoleKeys, 'preprod');
    const manifest = newManifest({
      vault: fromRoleKeys,
      network: 'preprod',
      owners: [
        { vaultKeys: mixed[0].vaultKeys, devices: [await signedBinding({ vaultId: mixedId, role: 'owner', participant: mixed[0], device: 1 })] },
        ...ownersOf(mixed.slice(1, 3)),
      ],
      revisedAt: T,
    });
    for (let i = 0; i < 3; i++) expect(await check(manifest, { kind: 'participant', roleKeys: mixed[i].roleKeys, index: indexes[i] })).toMatchObject({ ok: true, vaultId: mixedId });
    expect(await check(manifest, { kind: 'participant', roleKeys: mixed[0].roleKeys, index: 1 })).toMatchObject({ ok: false, code: 'OWN_ENTRY_MISSING' });
  });

  it('checks the backup branch', async () => {
    const m = newManifest({ vault: backupVault, network: 'preprod', owners: ownersOf(people.slice(0, 2)), backupHolders: ownersOf(people.slice(2, 3)), revisedAt: T });
    expect(await check(m, owner(0))).toMatchObject({ ok: true, ownRole: 'owner', template: { kind: 'backup', backupThreshold: 1 } });
    expect(await check(m, owner(2))).toMatchObject({ ok: true, ownRole: 'backupHolder' });
    expect(await check(m, owner(2, 1, { role: 'owner' }))).toMatchObject({ ok: false, code: 'OWN_ROLE_MISMATCH' });
  });
});

describe('signatures', () => {
  it('refuse a device signature that does not verify', async () => {
    const m = withOwner(base, 0, () => ({ devices: [{ ...laptop, deviceSig: 'ab'.repeat(64) }] }));
    expect(await check(m, owner(1))).toEqual({ ok: false, code: 'DEVICE_SIGNATURE_INVALID', credential: people[0].credential });
    const viewer = base.roles.viewers[0].devices[0];
    const v = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [{ devices: [{ ...viewer, deviceSig: 'ab'.repeat(64) }] }] } });
    expect(await check(v, owner(1))).toEqual({ ok: false, code: 'DEVICE_SIGNATURE_INVALID' });
  });

  it('refuse an attestation by another key or over another digest, a rogue binding in the checking device\'s own entry included', async () => {
    const byOther = await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 66, label: 'Rogue' });
    const forged = { ...byOther, attestation: cip8Attestation(people[3].signer, people[3].credential, bindingDigest(byOther)) };
    const m = withOwner(base, 0, e => ({ devices: [...e.devices, forged] }));
    expect(await check(m, owner(0))).toEqual({ ok: false, code: 'ATTESTATION_INVALID', credential: people[0].credential, attestation: 'WRONG_KEY' });
    const otherDigest = { ...byOther, attestation: cip8Attestation(people[0].signer, people[0].credential, 'cd'.repeat(32)) };
    const m2 = withOwner(base, 0, e => ({ devices: [...e.devices, otherDigest] }));
    expect(await check(m2, owner(0, 1, { device: await testDevice(1) }))).toEqual({ ok: false, code: 'ATTESTATION_INVALID', credential: people[0].credential, attestation: 'WRONG_PAYLOAD' });
  });

  it('refuse a viewer nobody admitted, or one admitted by a device that did not sign', async () => {
    // A viewer device that signed its own binding but was admitted by no owner (the relay's own device).
    const intruder = await signedBinding({ vaultId: id, role: 'viewer', device: 77, label: 'Accountant', admitter: 77 });
    expect(() => normalizeManifest({ ...base, roles: { ...base.roles, viewers: [...base.roles.viewers, { devices: [intruder] }] } }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('ADMISSION_INVALID') }));
    // Named as admitted by owner 0's device, but signed by another key.
    const claimed = { ...intruder, admittedBy: { ...intruder.admittedBy, deviceId: laptop.deviceId } };
    const m = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [...base.roles.viewers, { devices: [claimed] }] } });
    expect(await check(m, owner(0))).toEqual({ ok: false, code: 'ADMISSION_INVALID' });
    // Admitted by owner 0's device: accepted.
    const admitted = await signedBinding({ vaultId: id, role: 'viewer', device: 77, label: 'Accountant', admitter: 1 });
    const ok = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [...base.roles.viewers, { devices: [admitted] }] } });
    expect(await check(ok, owner(0))).toMatchObject({ ok: true });
  });

  it('refuse an external entry whose import signature does not verify', async () => {
    const m = newManifest({
      vault,
      network: 'preprod',
      owners: [{ vaultKeys: people[0].vaultKeys, devices: [laptop] }, ...ownersOf(people.slice(1, 2))],
      external: [await signedExternal({ vaultId: id, participant: people[2], importer: 1 })],
      revisedAt: T,
    });
    expect(await check(m, owner(1))).toMatchObject({ ok: true, externals: [people[2].credential], unattested: [people[1].credential] });
    // The relay relabels the external entry: the importer's signature no longer covers it.
    const relabelled = normalizeManifest({ ...m, roles: { ...m.roles, external: [{ ...m.roles.external[0], label: 'Mallory' }] } });
    expect(await check(relabelled, owner(1))).toEqual({ ok: false, code: 'IMPORT_SIGNATURE_INVALID', credential: people[2].credential });
    // Signed by another device than the one named.
    const byOther = await signedExternal({ vaultId: id, participant: people[2], importer: 2 });
    const misnamed = normalizeManifest({ ...m, roles: { ...m.roles, external: [{ ...byOther, importerDeviceId: laptop.deviceId }] } });
    expect(await check(misnamed, owner(1))).toEqual({ ok: false, code: 'IMPORT_SIGNATURE_INVALID', credential: people[2].credential });
  });

  it('pin each owner\'s stake key to their binding: a crossed stake key fails the owner\'s attestation', async () => {
    const crossedKeys = [mix(people[0].vaultKeys, people[1].vaultKeys), mix(people[1].vaultKeys, people[0].vaultKeys)];
    const replaced = new Map<string, object>();
    for (const n of [0, 1]) {
      const old = base.roles.owners.find(e => e.credential === people[n].credential).devices[0];
      const device = await testDevice(n + 1);
      const body = deviceBinding({ vaultId: id, role: 'owner', vaultKeys: crossedKeys[n], ed25519Pub: old.ed25519Pub, x25519Pub: old.x25519Pub, label: old.label });
      const binding = { ...body, deviceSig: device.key.sign(HexBlob(bindingDeviceDigest(body))).hex(), attestation: old.attestation };
      replaced.set(people[n].credential, { vaultKeys: crossedKeys[n], devices: [binding] });
    }
    const m = normalizeManifest({
      ...base,
      roles: { ...base.roles, owners: base.roles.owners.map(e => ({ ...e, ...replaced.get(e.credential) })) },
    } as VaultManifest);
    expect(await check(m, owner(2))).toMatchObject({ ok: false, code: 'ATTESTATION_INVALID' });
  });
});

describe('the revision chain and the full history', () => {
  it('accepts the same manifest again with the status stored for it', async () => {
    expect(await check(base, owner(0), { accepted: [acc(base)] })).toMatchObject({ ok: true, redelivery: true, manifestHash: manifestHash(base), attestationsVerified: true });
    const noViewer = nextManifestRevision(base, { roles: { viewers: [] }, revisedAt: T + 60 });
    const first = await check(noViewer, owner(0), { accepted: [acc(base)] });
    expect(first).toMatchObject({ ok: true, redelivery: false, attestationsVerified: false, unverified: ['VIEWER_REMOVED'] });
    // Stored with its status, a redelivery inherits it.
    const again = await check(noViewer, owner(0), { accepted: [acc(base), acc(noViewer, false, ['VIEWER_REMOVED'])] });
    expect(again).toMatchObject({ ok: true, redelivery: true, attestationsVerified: false, unverified: ['VIEWER_REMOVED'] });
  });

  it('raises the fork alert on a different manifest at any accepted version, version 1 included', async () => {
    const other = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [] } });
    expect(await check(other, owner(0), { accepted: [acc(base)] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
    const v2a = nextManifestRevision(base, { roles: {}, revisedAt: T + 60 });
    const v2b = nextManifestRevision(base, { roles: {}, revisedAt: T + 61 });
    // A late conflicting version 1, after later revisions were accepted.
    expect(await check(other, owner(0), { accepted: [acc(base), acc(v2a)] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
    // A sibling of an accepted version 2, whatever order the history comes in.
    expect(await check(v2b, owner(0), { accepted: [acc(base), acc(v2a)] })).toEqual({ ok: false, code: 'MANIFEST_FORK', alert: true });
    expect(await check(v2b, owner(0), { accepted: [acc(v2a), acc(base)] })).toEqual({ ok: false, code: 'MANIFEST_FORK', alert: true });
    // A history that is itself forked.
    expect(await check(base, owner(0), { accepted: [acc(v2a), acc(v2b)] })).toEqual({ ok: false, code: 'MANIFEST_FORK', alert: true });
  });

  it('never makes a second vault from a duplicate registration of an accepted vault\'s scripts', async () => {
    const regs = [encodeRegistration(vault, { name: 'Treasury' }), encodeRegistration(vault, { name: 'Published again by someone else' })]
      .map(e => decodeRegistration({ metadata: { cbor: e.offChain.metadata }, nativeScripts: { cbor: e.offChain.native_scripts } }))
      .map(d => (d.ok === true ? d.registration : undefined));
    expect(dedupeRegistrations(regs)).toEqual([regs[0]]);
    const fromSecond = newManifest({ vault: { payment: regs[1].payment, stake: regs[1].stake }, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: T });
    expect(fromSecond.vaultId).toBe(id);
    expect(await check(fromSecond, owner(1), { accepted: [acc(base)] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
  });

  it('accepts the next revision, and says when a change it makes still needs threshold attestations', async () => {
    const ledger = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 3, label: 'Ledger', method: 'expiredTx' });
    const added = nextManifestRevision(base, { roles: { owners: withOwner(base, 2, () => ({ devices: [ledger] })).roles.owners }, revisedAt: T + 60 });
    expect(await check(added, owner(2), { accepted: [acc(base)] })).toMatchObject({ ok: true, attestationsVerified: true, unverified: [], unattested: [] });
    // A viewer admitted by one owner device is authorised now.
    const viewer = await signedBinding({ vaultId: id, role: 'viewer', device: 8, admitter: 2 });
    const moreViewers = nextManifestRevision(base, { roles: { viewers: [...base.roles.viewers, { devices: [viewer] }] }, revisedAt: T + 60 });
    expect(await check(moreViewers, owner(0), { accepted: [acc(base)] })).toMatchObject({ ok: true, attestationsVerified: true });
    // Removing device 1, which admitted the viewer, needs the viewer admitted again by another owner device.
    expect(() => nextManifestRevision(base, { roles: { owners: ownersWith(base, 0, []) }, revisedAt: T + 60 }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('ADMISSION_INVALID') }));
    const removed = nextManifestRevision(base, { roles: { owners: ownersWith(base, 0, []), viewers: await readmitted() }, revisedAt: T + 60 });
    expect(await check(removed, owner(1), { accepted: [acc(base)] })).toMatchObject({ ok: true, attestationsVerified: false, unverified: ['DEVICE_REMOVED'] });
  });

  it('refuses gaps, stale revisions, broken links and revisions of unknown vaults', async () => {
    const a = nextManifestRevision(base, { roles: {}, revisedAt: T + 60 });
    const b = nextManifestRevision(base, { roles: {}, revisedAt: T + 61 });
    const c = nextManifestRevision(a, { roles: {}, revisedAt: T + 120 });
    expect(await check(c, owner(0), { accepted: [acc(base)] })).toEqual({ ok: false, code: 'REVISION_GAP' });
    expect(await check(c, owner(0), { accepted: [acc(b)] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'PREV_HASH_MISMATCH', alert: true });
    expect(await check(base, owner(0), { accepted: [acc(a)] })).toEqual({ ok: false, code: 'STALE_REVISION' });
    const backwards = normalizeManifest({ ...a, revisedAt: T - 1 });
    expect(await check(backwards, owner(0), { accepted: [acc(base)] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'TIME_BACKWARDS' });
    const v7 = normalizeManifest({ ...base, version: 7, prevManifestHash: 'ab'.repeat(32) });
    expect(await check(v7, owner(0))).toEqual({ ok: false, code: 'UNKNOWN_VAULT' });
    expect(await check(v7, owner(0), { accepted: [acc(base)] })).toEqual({ ok: false, code: 'REVISION_GAP' });
  });

  it('refuses a rolled-back key rotation and a removed device re-added with an old binding', async () => {
    const rotatedKey = (await testDevice(41)).x25519Pub;
    const b2 = await rebound(1, rotatedKey, 2);
    const v2 = nextManifestRevision(base, { roles: { owners: withOwner(base, 0, () => ({ devices: [b2] })).roles.owners }, revisedAt: T + 60 });
    expect(await check(v2, owner(1), { accepted: [acc(base)] })).toMatchObject({ ok: true, attestationsVerified: true });
    // The old binding (old key agreement key, old signatures) put back.
    const v3 = nextManifestRevision(v2, { roles: { owners: withOwner(v2, 0, () => ({ devices: [laptop] })).roles.owners }, revisedAt: T + 120 });
    expect(await check(v3, owner(1), { accepted: [acc(base), acc(v2)] })).toEqual({ ok: false, code: 'BINDING_REPLAY', credential: people[0].credential });
    // Without the history, the stored high-water mark still catches it.
    expect(await check(v3, owner(1), { accepted: [acc(v2)], bindingVersions: { [laptop.deviceId]: 2 } })).toMatchObject({ ok: false, code: 'BINDING_REPLAY' });
    // A changed binding at the same version is a replay too.
    const sameVersion = await rebound(1, (await testDevice(42)).x25519Pub, 2);
    const v3b = nextManifestRevision(v2, { roles: { owners: withOwner(v2, 0, () => ({ devices: [sameVersion] })).roles.owners }, revisedAt: T + 120 });
    expect(await check(v3b, owner(1), { accepted: [acc(base), acc(v2)] })).toMatchObject({ ok: false, code: 'BINDING_REPLAY' });
    // A higher version goes through, and the result carries the new mark.
    const b3 = await rebound(1, (await testDevice(43)).x25519Pub, 3);
    const v3c = nextManifestRevision(v2, { roles: { owners: withOwner(v2, 0, () => ({ devices: [b3] })).roles.owners }, revisedAt: T + 120 });
    expect(await check(v3c, owner(1), { accepted: [acc(base), acc(v2)] })).toMatchObject({ ok: true, bindingVersions: expect.objectContaining({ [laptop.deviceId]: 3 }) });

    // A removed device re-added with its old binding.
    const removed = nextManifestRevision(base, { roles: { owners: ownersWith(base, 0, []), viewers: await readmitted() }, revisedAt: T + 60 });
    const readded = nextManifestRevision(removed, { roles: { owners: ownersWith(removed, 0, [laptop]) }, revisedAt: T + 120 });
    expect(await check(readded, owner(1), { accepted: [acc(base), acc(removed, false, ['DEVICE_REMOVED'])] })).toMatchObject({ ok: false, code: 'BINDING_REPLAY' });
    expect(await check(readded, owner(1), { accepted: [acc(removed, false, ['DEVICE_REMOVED'])], bindingVersions: { [laptop.deviceId]: 1 } })).toMatchObject({ ok: false, code: 'BINDING_REPLAY' });
    const fresh = await rebound(1, laptop.x25519Pub, 2);
    const readdedFresh = nextManifestRevision(removed, { roles: { owners: ownersWith(removed, 0, [fresh]) }, revisedAt: T + 120 });
    expect(await check(readdedFresh, owner(1), { accepted: [acc(base), acc(removed, false, ['DEVICE_REMOVED'])] })).toMatchObject({ ok: true });
  });

  it('refuses a second vault id for a script of an accepted vault, and flags a non-canonical key order', async () => {
    const hashes = people.slice(0, 3).map(p => ({ payment: p.credential, stake: Ed25519KeyHashHex(sdkBlake2b.hash(HexBlob(p.vaultKeys.stake), 28)) }));
    const permuted = instantiateVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners: hashes }, {
      payment: { owners: hashes.map(h => h.payment).sort(), backups: [] },
      stake: { owners: hashes.map(h => h.stake).sort().reverse(), backups: [] },
    });
    const m = newManifest({ vault: permuted, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: T, allowNonCanonicalKeyOrder: true });
    expect(m.vaultId).not.toBe(id);
    expect(await check(m, owner(0), { accepted: [acc(base)] })).toEqual({ ok: false, code: 'SCRIPT_OF_ANOTHER_VAULT' });
    expect(await check(m, owner(0))).toMatchObject({ ok: true, canonicalKeyOrder: false });
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3)), revisedAt: T });
    expect(await checkManifestBeforeAck({ manifest: preview, network: 'preview', own: owner(0), accepted: [acc(base)] })).toMatchObject({ ok: true });
  });

  it('never throws on bad input', async () => {
    expect(await check({ ...base, schema: 0 } as unknown as VaultManifest, owner(0))).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await checkManifestBeforeAck(undefined)).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await check(base, owner(0), { network: 'preview' })).toEqual({ ok: false, code: 'NETWORK_MISMATCH' });
    expect(await check(base, undefined)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(base, { kind: 'other' } as unknown as OwnParticipant)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(base, owner(0), { accepted: [acc({ ...base, schema: 0 } as unknown as VaultManifest)] })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
});
