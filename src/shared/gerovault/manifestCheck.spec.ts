import { beforeAll, describe, expect, it } from 'vitest';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
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
import { ManifestAckInput, OwnParticipant, checkManifestBeforeAck } from './manifestCheck';
import { decodeRegistration, dedupeRegistrations, encodeRegistration } from './registration';
import { buildVaultFromParticipants, instantiateVaultScripts } from './scripts';
import { VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import { verificationDigest } from './verificationNumber';
import { TestParticipant, VECTOR_REVISED_AT, cip8Attestation, signedBinding, testDevice, testParticipants, vectorFixture } from './__fixtures__/manifest';

const T = VECTOR_REVISED_AT;

let people: TestParticipant[];
let vault: VaultScripts;
let backupVault: VaultScripts;
let id: string;
let base: VaultManifest;

const owner = (i: number, index = 1, extra: Partial<Extract<OwnParticipant, { kind: 'participant' }>> = {}): OwnParticipant =>
  ({ kind: 'participant', roleKeys: people[i].roleKeys, index, ...extra });
const ownersOf = (list: readonly (TestParticipant | VaultPublicKeys)[]) => list.map(p => ({ vaultKeys: 'vaultKeys' in p ? p.vaultKeys : p }));
const mix = (a: VaultPublicKeys, s: VaultPublicKeys) =>
  parseVaultPublicKeys({ payment: encodeVaultPublicKeys(a).payment, stake: encodeVaultPublicKeys(s).stake });

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

beforeAll(async () => {
  ({ people, vault, id, manifest: base } = await vectorFixture());
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
    owners: ownersOf(people.slice(0, 2)),
    backups: ownersOf(people.slice(2, 3)),
  });
});

describe('checks before acknowledging a manifest', () => {
  it('accept an honest manifest on every participant\'s device, every signature verified', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await check(base, owner(i))).toEqual({
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
      });
    }
  });

  it('check the device\'s own entry against the keys it derives at its own index', async () => {
    expect(await check(base, owner(3))).toEqual({ ok: false, code: 'OWN_ENTRY_MISSING', credential: people[3].credential });
    expect(await check(base, owner(0, 2))).toMatchObject({ ok: false, code: 'OWN_ENTRY_MISSING' });
    expect(await check(base, owner(0, 1, { role: 'backupHolder' }))).toEqual({ ok: false, code: 'OWN_ROLE_MISMATCH', credential: people[0].credential });
    expect(await check(base, owner(0, -1))).toEqual({ ok: false, code: 'INVALID_INPUT' });
    // Stake keys crossed between two owners with no device yet: the scripts cannot tell, each
    // owner's own check does.
    const crossed = newManifest({ vault, network: 'preprod', owners: ownersOf([people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)]), revisedAt: T });
    expect(await check(crossed, owner(1))).toEqual({ ok: false, code: 'OWN_KEYS_MISMATCH', credential: people[1].credential });
    expect(await check(crossed, owner(2))).toEqual({ ok: false, code: 'OWN_KEYS_MISMATCH', credential: people[2].credential });
  });

  it('check the device\'s own binding when it expects one', async () => {
    const device = await testDevice(1);
    expect(await check(base, owner(0, 1, { device }))).toMatchObject({ ok: true });
    // The relay swaps the device's key agreement key for its own, even with valid signatures.
    const relayKey = (await testDevice(7)).x25519Pub;
    const body = deviceBinding({ vaultId: id, role: 'owner', vaultKeys: people[0].vaultKeys, ed25519Pub: device.ed25519Pub, x25519Pub: relayKey, label: 'Laptop' });
    const swapped: OwnerDeviceBinding = {
      ...body,
      deviceSig: device.key.sign(HexBlob(bindingDeviceDigest(body))).hex(),
      attestation: cip8Attestation(people[0].signer, people[0].credential, bindingDigest(body)),
    };
    const m = withOwner(base, 0, () => ({ devices: [swapped] }));
    expect(await check(m, owner(0, 1, { device }))).toEqual({ ok: false, code: 'OWN_DEVICE_MISMATCH', credential: people[0].credential });
  });

  it('let a viewer check its own binding', async () => {
    expect(await check(base, { kind: 'viewer', device: await testDevice(9) })).toMatchObject({ ok: true, ownRole: 'viewer' });
    const viewer = await check(base, { kind: 'viewer', device: await testDevice(9) });
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
});

describe('signatures', () => {
  it('refuse a device signature that does not verify', async () => {
    const laptop = base.roles.owners.find(e => e.credential === people[0].credential).devices[0];
    const m = withOwner(base, 0, () => ({ devices: [{ ...laptop, deviceSig: 'ab'.repeat(64) }] }));
    expect(await check(m, owner(1))).toEqual({ ok: false, code: 'DEVICE_SIGNATURE_INVALID', credential: people[0].credential });
    const viewer = base.roles.viewers[0].devices[0];
    const v = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [{ devices: [{ ...viewer, deviceSig: 'ab'.repeat(64) }] }] } });
    expect(await check(v, owner(1))).toEqual({ ok: false, code: 'DEVICE_SIGNATURE_INVALID' });
  });

  it('refuse an attestation by another key, a rogue binding in the checking device\'s own entry included', async () => {
    const device = await testDevice(66);
    const body = deviceBinding({ vaultId: id, role: 'owner', vaultKeys: people[0].vaultKeys, ed25519Pub: device.ed25519Pub, x25519Pub: device.x25519Pub, label: 'Rogue' });
    const rogue: OwnerDeviceBinding = {
      ...body,
      deviceSig: device.key.sign(HexBlob(bindingDeviceDigest(body))).hex(),
      attestation: cip8Attestation(people[3].signer, people[3].credential, bindingDigest(body)),
    };
    const m = withOwner(base, 0, e => ({ devices: [...e.devices, rogue] }));
    expect(await check(m, owner(0))).toEqual({ ok: false, code: 'ATTESTATION_INVALID', credential: people[0].credential, attestation: 'WRONG_KEY' });
    expect(await check(m, owner(1))).toMatchObject({ ok: false, code: 'ATTESTATION_INVALID' });
  });

  it('pin each owner\'s stake key to their binding: a crossed stake key fails the owner\'s attestation', async () => {
    // A relay crosses owner 0's and owner 1's stake keys in their entries and bindings, and even
    // re-signs the bindings with the devices (as a compromised device could). The attestations by
    // the owners' vault payment keys still cover the honest keys.
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
    const result = await check(m, owner(2));
    expect(result).toMatchObject({ ok: false, code: 'ATTESTATION_INVALID' });
  });
});

describe('the revision chain', () => {
  it('accepts the same manifest again, and returns its hash', async () => {
    expect(await check(base, owner(0), { accepted: [base] })).toMatchObject({ ok: true, redelivery: true, manifestHash: manifestHash(base) });
  });

  it('refuses a different first manifest for an accepted vault, with an alert', async () => {
    const other = normalizeManifest({ ...base, roles: { ...base.roles, viewers: [] } });
    expect(await check(other, owner(0), { accepted: [base] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
  });

  it('never makes a second vault from a duplicate registration of an accepted vault\'s scripts', async () => {
    const regs = [encodeRegistration(vault, { name: 'Treasury' }), encodeRegistration(vault, { name: 'Published again by someone else' })]
      .map(e => decodeRegistration({ metadata: { cbor: e.offChain.metadata }, nativeScripts: { cbor: e.offChain.native_scripts } }))
      .map(d => (d.ok === true ? d.registration : undefined));
    expect(dedupeRegistrations(regs)).toEqual([regs[0]]);
    const fromSecond = newManifest({ vault: { payment: regs[1].payment, stake: regs[1].stake }, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: T });
    expect(fromSecond.vaultId).toBe(id);
    expect(await check(fromSecond, owner(1), { accepted: [base] })).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED', alert: true });
  });

  it('accepts the next revision, and says when a change it makes is not authorised by a verified signature', async () => {
    const ledger = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 3, label: 'Ledger', method: 'expiredTx' });
    const added = nextManifestRevision(base, { roles: { owners: withOwner(base, 2, () => ({ devices: [ledger] })).roles.owners }, revisedAt: T + 60 });
    expect(await check(added, owner(2), { accepted: [base] })).toMatchObject({ ok: true, attestationsVerified: true, unverified: [] });
    const noViewer = nextManifestRevision(base, { roles: { viewers: [] }, revisedAt: T + 60 });
    expect(await check(noViewer, owner(0), { accepted: [base] })).toMatchObject({ ok: true, attestationsVerified: false, unverified: ['VIEWER_CHANGE'] });
    const removed = nextManifestRevision(base, { roles: { owners: withOwner(base, 0, () => ({ devices: [] })).roles.owners }, revisedAt: T + 60 });
    expect(await check(removed, owner(0), { accepted: [base] })).toMatchObject({ ok: true, attestationsVerified: false, unverified: ['DEVICE_REMOVED'] });
    const withExternal = newManifest({
      vault,
      network: 'preprod',
      owners: ownersOf(people.slice(0, 2)),
      external: [{ vaultKeys: people[2].vaultKeys, label: 'Other wallet', importedBy: people[0].credential, role: 'owner' }],
      revisedAt: T,
    });
    const relabelled = nextManifestRevision(withExternal, { roles: { external: [{ ...withExternal.roles.external[0], label: 'Mallory' }] }, revisedAt: T });
    expect(await check(relabelled, owner(0), { accepted: [withExternal] })).toMatchObject({ ok: true, attestationsVerified: false, unverified: ['EXTERNAL_CHANGE'] });
  });

  it('refuses forks, gaps, stale revisions and broken links', async () => {
    const a = nextManifestRevision(base, { roles: { viewers: [] }, revisedAt: T + 60 });
    const b = nextManifestRevision(base, { roles: {}, revisedAt: T + 61 });
    expect(await check(b, owner(0), { accepted: [a] })).toEqual({ ok: false, code: 'MANIFEST_FORK', alert: true });
    expect(await check(base, owner(0), { accepted: [a] })).toEqual({ ok: false, code: 'STALE_REVISION' });
    const c = nextManifestRevision(a, { roles: {}, revisedAt: T + 120 });
    expect(await check(c, owner(0), { accepted: [base] })).toEqual({ ok: false, code: 'REVISION_GAP' });
    expect(await check(c, owner(0), { accepted: [b] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'PREV_HASH_MISMATCH', alert: true });
    const backwards = normalizeManifest({ ...a, revisedAt: T - 1 });
    expect(await check(backwards, owner(0), { accepted: [base] })).toEqual({ ok: false, code: 'REVISION_INVALID', revision: 'TIME_BACKWARDS' });
    // A revision of a vault this device never accepted: no join path here.
    const v7 = normalizeManifest({ ...base, version: 7, prevManifestHash: 'ab'.repeat(32) });
    expect(await check(v7, owner(0))).toEqual({ ok: false, code: 'UNKNOWN_VAULT' });
    expect(await check(v7, owner(0), { accepted: [base] })).toEqual({ ok: false, code: 'REVISION_GAP' });
  });

  it('refuses a second vault id for a script of an accepted vault, and flags a non-canonical key order', async () => {
    const hashes = people.slice(0, 3).map(p => ({ payment: p.credential, stake: Ed25519KeyHashHex(sdkBlake2b.hash(HexBlob(p.vaultKeys.stake), 28)) }));
    const permuted = instantiateVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners: hashes }, {
      payment: { owners: hashes.map(h => h.payment).sort(), backups: [] },
      stake: { owners: hashes.map(h => h.stake).sort().reverse(), backups: [] },
    });
    const m = newManifest({ vault: permuted, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: T, allowNonCanonicalKeyOrder: true });
    expect(m.vaultId).not.toBe(id);
    expect(await check(m, owner(0), { accepted: [base] })).toEqual({ ok: false, code: 'SCRIPT_OF_ANOTHER_VAULT' });
    expect(await check(m, owner(0))).toMatchObject({ ok: true, canonicalKeyOrder: false });
    // The same scripts on another network are another vault.
    const preview = newManifest({ vault, network: 'preview', owners: ownersOf(people.slice(0, 3)), revisedAt: T });
    expect(await checkManifestBeforeAck({ manifest: preview, network: 'preview', own: owner(0), accepted: [base] })).toMatchObject({ ok: true });
  });

  it('checks the backup branch', async () => {
    const m = newManifest({ vault: backupVault, network: 'preprod', owners: ownersOf(people.slice(0, 2)), backupHolders: ownersOf(people.slice(2, 3)), revisedAt: T });
    expect(await check(m, owner(0))).toMatchObject({ ok: true, ownRole: 'owner', template: { kind: 'backup', backupThreshold: 1 } });
    expect(await check(m, owner(2))).toMatchObject({ ok: true, ownRole: 'backupHolder' });
    expect(await check(m, owner(2, 1, { role: 'owner' }))).toMatchObject({ ok: false, code: 'OWN_ROLE_MISMATCH' });
  });

  it('never throws on bad input', async () => {
    expect(await check({ ...base, schema: 0 } as unknown as VaultManifest, owner(0))).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await checkManifestBeforeAck(undefined)).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await check(base, owner(0), { network: 'preview' })).toEqual({ ok: false, code: 'NETWORK_MISMATCH' });
    expect(await check(base, undefined)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(base, { kind: 'other' } as unknown as OwnParticipant)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(base, owner(0), { accepted: [{ ...base, schema: 0 } as unknown as VaultManifest] })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
});
