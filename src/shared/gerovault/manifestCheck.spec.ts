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
  deviceTombstone,
  manifestHash,
  newManifest,
  nextManifestRevision,
  nextRevisionRemovingDevice,
  normalizeManifest,
} from './manifest';
import { AcceptedVault, MAX_ACCEPTED_REVISIONS, ManifestAck, ManifestAckInput, OwnParticipant, acceptRevision, checkManifestBeforeAck } from './manifestCheck';
import { decodeRegistration, dedupeRegistrations, encodeRegistration } from './registration';
import { buildVaultFromParticipants, instantiateVaultScripts } from './scripts';
import { VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import { verificationDigest } from './verificationNumber';
import {
  TestParticipant,
  VECTOR_REVISED_AT,
  cip8Attestation,
  removalBy,
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
/**
 * The history index of `manifests`, each checked on `own`'s device (owner 2 by default) and
 * accepted in turn, as a device builds it.
 */
async function historyOf(manifests: readonly VaultManifest[], own: OwnParticipant = owner(1)): Promise<AcceptedVault> {
  let vault: AcceptedVault | undefined;
  for (const m of manifests) {
    const ack = await check(m, own, { accepted: vault ? [vault] : [] });
    if (ack.ok !== true) throw new Error(`fixture: revision ${m.version} refused ${ack.code} ${ack.revision ?? ''}`);
    vault = acceptRevision(vault, m, ack);
  }
  return vault;
}

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
        latest: true,
        attestationsVerified: true,
        unverified: [],
        unattested: [people[2].credential],
        externals: [],
        lapsedViewers: [],
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

  it('refuse an external entry whose import attestation does not verify', async () => {
    const m = newManifest({
      vault,
      network: 'preprod',
      owners: [{ vaultKeys: people[0].vaultKeys, devices: [laptop] }, ...ownersOf(people.slice(1, 2))],
      external: [signedExternal({ vaultId: id, participant: people[2], importer: people[0] })],
      revisedAt: T,
    });
    expect(await check(m, owner(1))).toMatchObject({ ok: true, externals: [people[2].credential], unattested: [people[1].credential] });
    // The relay relabels the external entry: the importer's attestation no longer covers it.
    const relabelled = normalizeManifest({ ...m, roles: { ...m.roles, external: [{ ...m.roles.external[0], label: 'Mallory' }] } });
    expect(await check(relabelled, owner(1))).toEqual({ ok: false, code: 'IMPORT_SIGNATURE_INVALID', credential: people[2].credential, attestation: 'WRONG_PAYLOAD' });
    // An import attested for another vault.
    const elsewhere = signedExternal({ vaultId: 'ab'.repeat(32), participant: people[2], importer: people[0] });
    const moved = normalizeManifest({ ...m, roles: { ...m.roles, external: [{ ...m.roles.external[0], importSig: elsewhere.importSig }] } });
    expect(await check(moved, owner(1))).toEqual({ ok: false, code: 'IMPORT_SIGNATURE_INVALID', credential: people[2].credential, attestation: 'WRONG_PAYLOAD' });
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

describe('the revision chain and the history index', () => {
  it('accepts the same manifest again as a redelivery, and says whether it is the latest accepted revision', async () => {
    const h1 = await historyOf([base]);
    expect(await check(base, owner(0), { accepted: [h1] })).toMatchObject({ ok: true, redelivery: true, latest: true, attestationsVerified: true });
    const v2 = nextManifestRevision(base, { roles: {}, revisedAt: T + 60 });
    const h2 = await historyOf([base, v2]);
    expect(h2.revisions.map(r => r.version)).toEqual([1, 2]);
    expect(h2.latest).toEqual(v2);
    // A superseded revision checked again is not the latest: the funding gate will not take it.
    expect(await check(base, owner(0), { accepted: [h2] })).toMatchObject({ ok: true, redelivery: true, latest: false });
    expect(await check(v2, owner(0), { accepted: [h2] })).toMatchObject({ ok: true, redelivery: true, latest: true });
    expect(acceptRevision(h2, v2, await check(v2, owner(0), { accepted: [h2] }) as ManifestAck)).toBe(h2);
  });

  it('does not accept a revision whose changes still need threshold attestations', async () => {
    const h1 = await historyOf([base]);
    const noViewer = nextManifestRevision(base, { roles: { viewers: [] }, revisedAt: T + 60 });
    const ack = await check(noViewer, owner(0), { accepted: [h1] });
    expect(ack).toMatchObject({ ok: true, redelivery: false, latest: false, attestationsVerified: false, unverified: ['VIEWER_REMOVED'] });
    expect(() => acceptRevision(h1, noViewer, ack as ManifestAck)).toThrow(expect.objectContaining({ message: expect.stringContaining('NOT_ACCEPTED') }));
    // An acknowledgement of another manifest, or a copy, is refused too.
    const v2 = nextManifestRevision(base, { roles: {}, revisedAt: T + 60 });
    const ackV2 = await check(v2, owner(0), { accepted: [h1] }) as ManifestAck;
    expect(() => acceptRevision(h1, noViewer, ackV2)).toThrow(expect.objectContaining({ message: expect.stringContaining('INVALID_ACK') }));
    expect(() => acceptRevision(h1, v2, { ...ackV2 })).toThrow(expect.objectContaining({ message: expect.stringContaining('INVALID_ACK') }));
    expect(() => acceptRevision(undefined, v2, ackV2)).toThrow(expect.objectContaining({ message: expect.stringContaining('VERSION_NOT_NEXT') }));
  });

  it('raises the fork alert on a different manifest at any accepted version, version 1 included', async () => {
    const other = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [] } });
    const h1 = await historyOf([base]);
    expect(await check(other, owner(0), { accepted: [h1] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
    const v2a = nextManifestRevision(base, { roles: {}, revisedAt: T + 60 });
    const v2b = nextManifestRevision(base, { roles: {}, revisedAt: T + 61 });
    const h2 = await historyOf([base, v2a]);
    // A late conflicting version 1, after later revisions were accepted.
    expect(await check(other, owner(0), { accepted: [h2] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
    // A sibling of an accepted version 2.
    expect(await check(v2b, owner(0), { accepted: [h2] })).toEqual({ ok: false, code: 'MANIFEST_FORK', alert: true });
    // A history that is itself forked.
    const forked = { ...h2, revisions: [...h2.revisions, { version: 2, manifestHash: manifestHash(v2b) }] };
    expect(await check(base, owner(0), { accepted: [forked] })).toEqual({ ok: false, code: 'MANIFEST_FORK', alert: true });
  });

  it('never makes a second vault from a duplicate registration of an accepted vault\'s scripts', async () => {
    const regs = [encodeRegistration(vault, { name: 'Treasury' }), encodeRegistration(vault, { name: 'Published again by someone else' })]
      .map(e => decodeRegistration({ metadata: { cbor: e.offChain.metadata }, nativeScripts: { cbor: e.offChain.native_scripts } }))
      .map(d => (d.ok === true ? d.registration : undefined));
    expect(dedupeRegistrations(regs)).toEqual([regs[0]]);
    const fromSecond = newManifest({ vault: { payment: regs[1].payment, stake: regs[1].stake }, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: T });
    expect(fromSecond.vaultId).toBe(id);
    expect(await check(fromSecond, owner(1), { accepted: [await historyOf([base])] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
  });

  it('accepts the next revision when each change is authorised now', async () => {
    const h1 = await historyOf([base]);
    const ledger = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 3, label: 'Ledger', method: 'expiredTx' });
    const added = nextManifestRevision(base, { roles: { owners: withOwner(base, 2, () => ({ devices: [ledger] })).roles.owners }, revisedAt: T + 60 });
    expect(await check(added, owner(2), { accepted: [h1] })).toMatchObject({ ok: true, attestationsVerified: true, latest: true, unverified: [], unattested: [] });
    // A viewer admitted by one owner device is authorised now.
    const viewer = await signedBinding({ vaultId: id, role: 'viewer', device: 8, admitter: 2 });
    const moreViewers = nextManifestRevision(base, { roles: { viewers: [...base.roles.viewers, { devices: [viewer] }] }, revisedAt: T + 60 });
    expect(await check(moreViewers, owner(0), { accepted: [h1] })).toMatchObject({ ok: true, attestationsVerified: true });
    // An authorisation of an unchanged body swapped by the relay.
    const reattested = { ...laptop, attestation: cip8Attestation(people[0].signer, people[0].credential, bindingDigest(laptop)) };
    expect(reattested.attestation).toEqual(laptop.attestation);
    const otherMethod = await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 1, label: 'Laptop', method: 'expiredTx' });
    const swapped = normalizeManifest({ ...base, version: 2, prevManifestHash: manifestHash(base), roles: { ...base.roles, owners: withOwner(base, 0, () => ({ devices: [otherMethod] })).roles.owners } });
    expect(await check(swapped, owner(1), { accepted: [h1] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'AUTHORISATION_CHANGED' });
  });

  it('refuses gaps, stale revisions, broken links and revisions of unknown vaults', async () => {
    const a = nextManifestRevision(base, { roles: {}, revisedAt: T + 60 });
    const b = nextManifestRevision(base, { roles: {}, revisedAt: T + 61 });
    const c = nextManifestRevision(a, { roles: {}, revisedAt: T + 120 });
    const h1 = await historyOf([base]);
    expect(await check(c, owner(0), { accepted: [h1] })).toEqual({ ok: false, code: 'REVISION_GAP' });
    const hb = await historyOf([base, b]);
    expect(await check(c, owner(0), { accepted: [hb] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'PREV_HASH_MISMATCH', alert: true });
    const ha = await historyOf([base, a]);
    const v1Only = { ...ha, revisions: ha.revisions.filter(r => r.version === 2) };
    expect(await check(base, owner(0), { accepted: [v1Only] })).toEqual({ ok: false, code: 'STALE_REVISION' });
    const backwards = normalizeManifest({ ...a, revisedAt: T - 1 });
    expect(await check(backwards, owner(0), { accepted: [h1] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'TIME_BACKWARDS' });
    const v7 = normalizeManifest({ ...base, version: 7, prevManifestHash: 'ab'.repeat(32) });
    expect(await check(v7, owner(0))).toEqual({ ok: false, code: 'UNKNOWN_VAULT' });
    expect(await check(v7, owner(0), { accepted: [h1] })).toEqual({ ok: false, code: 'REVISION_GAP' });
  });

  it('refuses a rolled-back key rotation, whether the history or only the high-water marks show it', async () => {
    const rotatedKey = (await testDevice(41)).x25519Pub;
    const b2 = await rebound(1, rotatedKey, 2);
    const v2 = nextManifestRevision(base, { roles: { owners: withOwner(base, 0, () => ({ devices: [b2] })).roles.owners }, revisedAt: T + 60 });
    const h2 = await historyOf([base, v2]);
    expect(h2.bindingVersions[laptop.deviceId]).toBe(2);
    // The old binding (old key agreement key, old signatures) put back.
    const v3 = nextManifestRevision(v2, { roles: { owners: withOwner(v2, 0, () => ({ devices: [laptop] })).roles.owners }, revisedAt: T + 120 });
    expect(await check(v3, owner(1), { accepted: [h2] })).toEqual({ ok: false, code: 'BINDING_REPLAY', credential: people[0].credential });
    // A changed binding at the same version is a replay too.
    const sameVersion = await rebound(1, (await testDevice(42)).x25519Pub, 2);
    const v3b = nextManifestRevision(v2, { roles: { owners: withOwner(v2, 0, () => ({ devices: [sameVersion] })).roles.owners }, revisedAt: T + 120 });
    expect(await check(v3b, owner(1), { accepted: [h2] })).toMatchObject({ ok: false, code: 'BINDING_REPLAY' });
    // A device bound at version 3 once, then rotated back to 2 in a later index: the marks still say 3.
    const marked = { ...h2, bindingVersions: { ...h2.bindingVersions, [laptop.deviceId]: 3 } };
    const b3 = await rebound(1, (await testDevice(43)).x25519Pub, 3);
    const v3c = nextManifestRevision(v2, { roles: { owners: withOwner(v2, 0, () => ({ devices: [b3] })).roles.owners }, revisedAt: T + 120 });
    expect(await check(v3c, owner(1), { accepted: [marked] })).toMatchObject({ ok: false, code: 'BINDING_REPLAY' });
    // A higher version goes through, and the result carries the new mark.
    expect(await check(v3c, owner(1), { accepted: [h2] })).toMatchObject({ ok: true, bindingVersions: expect.objectContaining({ [laptop.deviceId]: 3 }) });
  });

  it('refuses a second vault id for a script of an accepted vault, and flags a non-canonical key order', async () => {
    const hashes = people.slice(0, 3).map(p => ({ payment: p.credential, stake: Ed25519KeyHashHex(sdkBlake2b.hash(HexBlob(p.vaultKeys.stake), 28)) }));
    const permuted = instantiateVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners: hashes }, {
      payment: { owners: hashes.map(h => h.payment).sort(), backups: [] },
      stake: { owners: hashes.map(h => h.stake).sort().reverse(), backups: [] },
    });
    const m = newManifest({ vault: permuted, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: T, allowNonCanonicalKeyOrder: true });
    expect(m.vaultId).not.toBe(id);
    const h1 = await historyOf([base]);
    expect(await check(m, owner(0), { accepted: [h1] })).toEqual({ ok: false, code: 'SCRIPT_OF_ANOTHER_VAULT' });
    expect(await check(m, owner(0))).toMatchObject({ ok: true, canonicalKeyOrder: false });
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3)), revisedAt: T });
    expect(await checkManifestBeforeAck({ manifest: preview, network: 'preview', own: owner(0), accepted: [h1] })).toMatchObject({ ok: true });
  });

  it('never throws on bad input, a damaged history index included', async () => {
    expect(await check({ ...base, schema: 0 } as unknown as VaultManifest, owner(0))).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await checkManifestBeforeAck(undefined)).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await check(base, owner(0), { network: 'preview' })).toEqual({ ok: false, code: 'NETWORK_MISMATCH' });
    expect(await check(base, undefined)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(base, { kind: 'other' } as unknown as OwnParticipant)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    const h1 = await historyOf([base]);
    for (const damaged of [
      { ...h1, latest: { ...base, schema: 0 } },
      { ...h1, revisions: [] },
      { ...h1, revisions: [{ version: 1, manifestHash: 'AB'.repeat(32) }] },
      { ...h1, revisions: [{ version: 1, manifestHash: 'ab'.repeat(32) }] },
      { ...h1, bindingVersions: { [laptop.deviceId]: 0 } },
      { ...h1, network: 'sanchonet' },
      { ...h1, paymentScript: 'zz' },
      null,
    ]) {
      expect(await check(base, owner(0), { accepted: [damaged as unknown as AcceptedVault] })).toEqual({ ok: false, code: 'INVALID_INPUT' });
    }
    expect(await check(base, owner(0), { accepted: [h1, h1] })).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(base, owner(0), { accepted: 'none' as unknown as AcceptedVault[] })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
});

describe('the history check costs the same whatever the history\'s length', () => {
  it('checks the next revision against a full history of 16,384 revisions without normalising it', async () => {
    const long = normalizeManifest({ ...base, version: MAX_ACCEPTED_REVISIONS, prevManifestHash: 'ab'.repeat(32) });
    const revisions = Array.from({ length: MAX_ACCEPTED_REVISIONS }, (_, i) => ({
      version: i + 1,
      manifestHash: i + 1 === MAX_ACCEPTED_REVISIONS ? manifestHash(long) : sdkBlake2b.hash(HexBlob((i + 1).toString(16).padStart(8, '0')), 32),
    }));
    const index: AcceptedVault = { network: 'preprod', vaultId: id, paymentScript: base.paymentScript, stakeScript: base.stakeScript, revisions, bindingVersions: {}, latest: long };
    const incoming = nextManifestRevision(long, { roles: {}, revisedAt: T + 60 });
    const short = { ...index, revisions: revisions.slice(-1) };
    const time = async (accepted: AcceptedVault) => {
      const t0 = performance.now();
      const r = await check(incoming, owner(1), { accepted: [accepted] });
      return { r, ms: performance.now() - t0 };
    };
    await time(short);
    const small = await time(short);
    const large = await time(index);
    expect(large.r).toMatchObject({ ok: true, latest: true });
    expect(small.r).toMatchObject({ ok: true, latest: true });
    // A Map of 16,384 hashes, not 16,384 normalisations (each takes milliseconds).
    expect(large.ms).toBeLessThan(small.ms + 250);
    // Accepting it keeps revision 1 and the latest revisions, within the bound.
    const after = acceptRevision(index, incoming, large.r as ManifestAck);
    expect(after.revisions).toHaveLength(MAX_ACCEPTED_REVISIONS);
    expect(after.revisions[0].version).toBe(1);
    expect(after.revisions[1].version).toBe(3);
    expect(after.revisions[after.revisions.length - 1]).toEqual({ version: MAX_ACCEPTED_REVISIONS + 1, manifestHash: manifestHash(incoming) });
  });
});

describe('device removal on the acknowledging device', () => {
  let removed: VaultManifest;
  beforeAll(() => {
    removed = nextRevisionRemovingDevice(base, { deviceId: laptop.deviceId, removal: removalBy(people[0], id, laptop), revisedAt: T + 60 });
  });

  it('accepts a removal attested by the device\'s own participant now, without threshold attestations', async () => {
    const viewer = base.roles.viewers[0].devices[0];
    const ack = await check(removed, owner(1), { accepted: [await historyOf([base])] });
    expect(ack).toMatchObject({
      ok: true, attestationsVerified: true, unverified: [], latest: true, lapsedViewers: [viewer.deviceId],
      bindingVersions: expect.objectContaining({ [laptop.deviceId]: 1 }),
    });
    expect(ack.ok === true && ack.manifestHash).toBe(manifestHash(removed));
    // The removed device's own owner still acknowledges, without a device.
    expect(await check(removed, owner(0), { accepted: [await historyOf([base])] })).toMatchObject({ ok: true, ownRole: 'owner' });
    // The viewer still checks its own binding, and learns its admission lapsed.
    expect(await check(removed, { kind: 'viewer', device: await testDevice(9) }, { accepted: [await historyOf([base])] }))
      .toMatchObject({ ok: true, ownRole: 'viewer', lapsedViewers: [viewer.deviceId] });
  });

  it('refuses a removal attested by anyone but the device\'s participant', async () => {
    const byOther = deviceTombstone(laptop, removalBy(people[1], id, laptop));
    const forged = normalizeManifest({
      ...removed,
      roles: { ...removed.roles, owners: removed.roles.owners.map(e => (e.credential === people[0].credential ? { ...e, removedDevices: [byOther] } : e)) },
    });
    expect(await check(forged, owner(1), { accepted: [await historyOf([base])] }))
      .toEqual({ ok: false, code: 'REMOVAL_INVALID', credential: people[0].credential, attestation: 'WRONG_KEY' });
  });

  it('refuses a replayed removal against a re-added binding', async () => {
    const back = await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 1, label: 'Laptop', bindingVersion: 2 });
    const readded = nextManifestRevision(removed, { roles: { owners: withOwner(removed, 0, () => ({ devices: [back] })).roles.owners }, revisedAt: T + 120 });
    const history = await historyOf([base, removed, readded]);
    expect(history.bindingVersions[laptop.deviceId]).toBe(2);
    const old = removed.roles.owners.find(e => e.credential === people[0].credential).removedDevices[0];
    const dropBack = (removedDevices: readonly object[]) => normalizeManifest({
      ...readded,
      version: 4,
      prevManifestHash: manifestHash(readded),
      revisedAt: T + 180,
      roles: { ...readded.roles, owners: withOwner(readded, 0, () => ({ devices: [], removedDevices })).roles.owners },
    } as VaultManifest);
    // The old removal (of binding version 1) put on a tombstone of version 2: its attestation does not cover it.
    const replayed = dropBack([old, { ...old, bindingVersion: 2 }]);
    expect(await check(replayed, owner(1), { accepted: [history] }))
      .toEqual({ ok: false, code: 'REMOVAL_INVALID', credential: people[0].credential, attestation: 'WRONG_PAYLOAD' });
    // The old tombstone alone removes nothing.
    expect(await check(dropBack([old]), owner(1), { accepted: [history] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'REMOVAL_UNATTESTED' });
    // A new removal of version 2 by the owner is accepted.
    const again = nextRevisionRemovingDevice(readded, { deviceId: laptop.deviceId, removal: removalBy(people[0], id, back, 'expiredTx'), revisedAt: T + 180 });
    expect(await check(again, owner(1), { accepted: [history] })).toMatchObject({ ok: true, attestationsVerified: true });
  });

  it('keeps an import valid when every device of the importer is removed', async () => {
    const m = newManifest({
      vault,
      network: 'preprod',
      owners: [{ vaultKeys: people[0].vaultKeys, devices: [laptop] }, ...ownersOf(people.slice(1, 2))],
      external: [signedExternal({ vaultId: id, participant: people[2], importer: people[0] })],
      revisedAt: T,
    });
    const gone = nextRevisionRemovingDevice(m, { deviceId: laptop.deviceId, removal: removalBy(people[0], id, laptop), revisedAt: T + 60 });
    expect(gone.roles.owners.every(e => e.devices.length === 0)).toBe(true);
    expect(gone.roles.external[0].importedBy).toBe(people[0].credential);
    expect(await check(gone, owner(1), { accepted: [await historyOf([m])] })).toMatchObject({ ok: true, attestationsVerified: true, externals: [people[2].credential] });
  });
});
