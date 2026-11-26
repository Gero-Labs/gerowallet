import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { ed25519 as nobleEd25519, x25519 as nobleX25519 } from '@noble/curves/ed25519.js';
import { decode as cborgDecode, encode as cborgEncode } from 'cborg';
import { deviceIdFromPubKey } from '../../services/crossDevice/deviceIdentity';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { encodeVaultPublicKeys, parseVaultPublicKeys } from './keys';
import {
  BINDING_DEVICE_TAG,
  BINDING_DIGEST_TAG,
  MANIFEST_HASH_TAG,
  OwnerDeviceBinding,
  VaultManifest,
  bindingDeviceDigest,
  bindingDigest,
  checkManifestRevision,
  decodeManifest,
  deviceBinding,
  deviceBindingCbor,
  deviceIdOf,
  encodeManifest,
  isManifestFork,
  isUsableEd25519Key,
  isUsableX25519Key,
  manifestHash,
  manifestTemplate,
  newManifest,
  nextManifestRevision,
  normalizeManifest,
  scriptsHaveCanonicalKeyOrder,
  verifyDeviceSignature,
} from './manifest';
import { buildVaultFromParticipants, instantiateVaultScripts, vaultScript } from './scripts';
import { ROLE, VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import { TestParticipant, VECTOR_REVISED_AT, signedBinding, testDevice, vectorFixture } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07).
 * - standard: `vectorFixture()`, revisedAt 1795651200.
 * - backup: owners the first two test participants, threshold 2; backup holder the third, with
 *   test device 3 (CIP-8); backup threshold 1 after slot 200000000; preprod; no viewer.
 * - binding: owner 1's binding of test device 1, its body's two tagged digests.
 */
const VECTORS = {
  standard: { hash: '53952fe39fddb04d6cdc2632635b8e7465c2f5bc46f98af50180140b769e6ada', bytes: '2665' },
  backup: { hash: 'c4ccb351130b9ed42d2134cf68d064cd8037f3cf26ed6aa6833c2cfe1b92910a' },
  bindingDigest: 'f09eae9d91d7b990115437ed3413ef2a6c1f65894236914ef71c4170917faef5',
  bindingDeviceDigest: '9ce4156618b7d473f1c2dd6465744d978e57e0a2e779a904d62bee031b66e750',
};

const REVISED_AT = VECTOR_REVISED_AT;
const b = (h?: string) => (h ? Uint8Array.from(Buffer.from(h, 'hex')) : new Uint8Array(0));
const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const char = (code: number) => String.fromCodePoint(code);

let people: TestParticipant[];
let vault: VaultScripts;
let backupVault: VaultScripts;
let id: string;
let base: VaultManifest;
let bare: VaultManifest;

const ownersOf = (list: readonly TestParticipant[]) => list.map(p => ({ vaultKeys: p.vaultKeys }));

beforeAll(async () => {
  ({ people, vault, id, manifest: base } = await vectorFixture());
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
    owners: ownersOf(people.slice(0, 2)),
    backups: ownersOf(people.slice(2, 3)),
  });
  bare = newManifest({ vault, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: REVISED_AT });
});

type P = Record<string, unknown>;

/** The data model of spec 5.3 as amended, built here independently of the encoder. */
function plainKeys(k?: VaultPublicKeys): P {
  return k ? { payment: b(k.payment), stake: b(k.stake) } : {};
}

function plainBinding(d: OwnerDeviceBinding): P {
  return {
    vaultId: b(d.vaultId),
    role: d.role,
    credential: b(d.credential),
    vaultKeys: plainKeys(d.vaultKeys),
    deviceId: b(d.deviceId),
    ed25519Pub: b(d.ed25519Pub),
    x25519Pub: b(d.x25519Pub),
    label: d.label,
    bindingVersion: d.bindingVersion,
    deviceSig: b(d.deviceSig),
    attestation: d.attestation ? { method: d.attestation.method, proof: b(d.attestation.proof) } : {},
  };
}

function plainOf(m: VaultManifest): P {
  const byCredential = <T extends { credential: string }>(list: readonly T[]) => [...list].sort((x, y) => (x.credential < y.credential ? -1 : 1));
  const participant = (e: VaultManifest['roles']['owners'][number]) => ({
    credential: b(e.credential),
    vaultKeys: plainKeys(e.vaultKeys),
    devices: e.devices.map(plainBinding),
  });
  return {
    protocol: 'gero-vault/v1',
    schema: 1,
    network: `cardano-${m.network}`,
    vaultId: b(m.vaultId),
    paymentScript: b(m.paymentScript),
    stakeScript: b(m.stakeScript),
    roles: {
      owners: byCredential(m.roles.owners).map(participant),
      backupHolders: byCredential(m.roles.backupHolders).map(participant),
      guardians: [],
      delegates: [],
      viewers: m.roles.viewers.map(v => ({ credential: new Uint8Array(0), vaultKeys: {}, devices: v.devices.map(plainBinding) })),
      external: byCredential(m.roles.external).map(e => ({
        credential: b(e.credential),
        vaultKeys: plainKeys(e.vaultKeys),
        label: e.label,
        importedBy: b(e.importedBy),
        role: e.role,
      })),
    },
    viewersSeeProposalContents: false,
    policiesDisplay: {},
    version: m.version,
    prevManifestHash: b(m.prevManifestHash),
    revisedAt: m.revisedAt,
  };
}

const at = (p: unknown, ...path: (string | number)[]): P => path.reduce<unknown>((o, k) => (o as P)[k as string], p) as P;
const list = (p: unknown, ...path: (string | number)[]): unknown[] => at(p, ...path) as unknown as unknown[];
const encodePlain = (p: P) => hexOf(encodeCanonicalCbor(p as unknown as CborWritable));
/** Owner `n` of the fixture (0 and 1 have a device, 2 has none), wherever sorting put it. */
const ownerOf = (p: P, n: number): P =>
  list(p, 'roles', 'owners').find(o => hexOf((o as P)['credential'] as Uint8Array) === people[n].credential) as P;

function mutated(fn: (p: P) => void, from: VaultManifest = base): string {
  const p = plainOf(from);
  fn(p);
  return encodePlain(p);
}

const refusal = (input: unknown) => {
  const r = decodeManifest(input as string);
  return r.ok === false ? r.code : 'ok';
};

const mix = (a: VaultPublicKeys, s: VaultPublicKeys) =>
  parseVaultPublicKeys({ payment: encodeVaultPublicKeys(a).payment, stake: encodeVaultPublicKeys(s).stake });

describe('manifest encoding', () => {
  it('builds a first manifest with every role slot, the scripts, and no threshold or index', () => {
    expect(base.schema).toBe(1);
    expect(base.version).toBe(1);
    expect(base.prevManifestHash).toBeUndefined();
    expect(base.vaultId).toBe(id);
    expect(base.paymentScript).toBe(vault.payment.cbor);
    expect(base.stakeScript).toBe(vault.stake.cbor);
    expect(manifestTemplate(base)).toEqual({ kind: 'standard', threshold: 2 });
    const decoded = cborgDecode(b(encodeManifest(base)), { useMaps: false }) as P;
    const names = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && !(v instanceof Uint8Array)) for (const [k, x] of Object.entries(v)) { names.add(k); walk(x); }
    };
    walk(decoded);
    for (const name of ['index', 'y', 'threshold', 'scriptHash', 'stakeScriptHash', 'createdAt', 'roleXpubs', 'xpub']) expect(names.has(name)).toBe(false);
    expect(Object.keys(at(decoded, 'roles')).sort()).toEqual(['backupHolders', 'delegates', 'external', 'guardians', 'owners', 'viewers']);
    expect(at(decoded, 'viewersSeeProposalContents')).toBe(false);
  });

  it('writes the spec 5.3 data model in canonical CBOR (checked with cborg)', () => {
    expect(encodeManifest(base)).toBe(hexOf(cborgEncode(plainOf(base))));
  });

  it('round-trips byte for byte and hashes tag || CBOR (checked with a second blake2b)', () => {
    const cbor = encodeManifest(base);
    const decoded = decodeManifest(cbor);
    expect(decoded.ok).toBe(true);
    if (decoded.ok !== true) return;
    expect(decoded.cbor).toBe(cbor);
    expect(decoded.manifest).toEqual(base);
    expect(encodeManifest(decoded.manifest)).toBe(cbor);
    expect(decoded.hash).toBe(sdkBlake2b.hash(HexBlob(Buffer.from(MANIFEST_HASH_TAG, 'utf8').toString('hex') + cbor), 32));
    expect(manifestHash(base)).toBe(decoded.hash);
    expect(decodeManifest(b(cbor)).ok).toBe(true);
  });

  it('matches the provisional vectors', async () => {
    expect(manifestHash(base)).toBe(VECTORS.standard.hash);
    expect(String(encodeManifest(base).length / 2)).toBe(VECTORS.standard.bytes);
    const backupId = vaultId(backupVault, 'preprod');
    const backup = newManifest({
      vault: backupVault,
      network: 'preprod',
      owners: ownersOf(people.slice(0, 2)),
      backupHolders: [{ vaultKeys: people[2].vaultKeys, devices: [await signedBinding({ vaultId: backupId, role: 'backupHolder', participant: people[2], device: 3 })] }],
      revisedAt: REVISED_AT,
    });
    expect(manifestHash(backup)).toBe(VECTORS.backup.hash);
    expect(manifestTemplate(backup)).toEqual({ kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 });
    const laptop = base.roles.owners.find(e => e.credential === people[0].credential).devices[0];
    expect(bindingDigest(laptop)).toBe(VECTORS.bindingDigest);
    expect(bindingDeviceDigest(laptop)).toBe(VECTORS.bindingDeviceDigest);
  });

  it('has one encoding whatever order the input lists come in', async () => {
    const d = await Promise.all([1, 4, 5, 6].map(n => signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: n })));
    const v = await Promise.all([7, 8, 9].map(n => signedBinding({ vaultId: id, role: 'viewer', device: n })));
    const build = (devs: OwnerDeviceBinding[], viewers: OwnerDeviceBinding[][], owners = [0, 1, 2]) => encodeManifest(newManifest({
      vault,
      network: 'preprod',
      owners: owners.map(i => ({ vaultKeys: people[i].vaultKeys, ...(i === 0 ? { devices: devs } : {}) })),
      viewers: viewers.map(devices => ({ devices })),
      revisedAt: REVISED_AT,
    }));
    expect(build(d, [[v[0], v[1]], [v[2]]])).toBe(build([...d].reverse(), [[v[2]], [v[1], v[0]]], [2, 0, 1]));
    expect(build(d, [[v[0], v[1]], [v[2]]])).not.toBe(build(d, [[v[0]], [v[1]], [v[2]]]));
  });

  it('refuses a vault whose scripts list keys in another order, unless the caller allows it', () => {
    const hashes = people.slice(0, 3).map(p => ({ payment: p.credential, stake: Ed25519KeyHashHex(sdkBlake2b.hash(HexBlob(p.vaultKeys.stake), 28)) }));
    const permuted = instantiateVaultScripts({ template: { kind: 'standard', threshold: 2 }, owners: hashes }, {
      payment: { owners: hashes.map(h => h.payment).sort(), backups: [] },
      stake: { owners: hashes.map(h => h.stake).sort().reverse(), backups: [] },
    });
    expect(permuted.payment.hash).toBe(vault.payment.hash);
    expect(permuted.stake.hash).not.toBe(vault.stake.hash);
    expect(scriptsHaveCanonicalKeyOrder(vault)).toBe(true);
    expect(scriptsHaveCanonicalKeyOrder(permuted)).toBe(false);
    const input = { vault: permuted, network: 'preprod' as const, owners: ownersOf(people.slice(0, 3)), revisedAt: REVISED_AT };
    expect(() => newManifest(input)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST', message: expect.stringContaining('NON_CANONICAL_KEY_ORDER') }));
    expect(newManifest({ ...input, allowNonCanonicalKeyOrder: true }).vaultId).toBe(vaultId(permuted, 'preprod'));
  });

  it('refuses a manifest that breaks its rules, with GeroVaultError INVALID_MANIFEST', () => {
    const invalid = (m: unknown) => () => encodeManifest(m as VaultManifest);
    const err = expect.objectContaining({ code: 'INVALID_MANIFEST' });
    expect(invalid({ ...base, schema: 2 })).toThrow(err);
    expect(invalid({ ...base, version: 2 })).toThrow(err);
    expect(invalid({ ...base, revisedAt: REVISED_AT * 1000 })).toThrow(err);
    expect(invalid({ ...base, viewersSeeProposalContents: true })).toThrow(err);
    expect(invalid({ ...base, paymentScript: base.paymentScript.toUpperCase() })).toThrow(err);
    expect(invalid({ ...base, roles: { ...base.roles, guardians: base.roles.owners.slice(0, 1) } })).toThrow(err);
    expect(invalid({ ...base, roles: { ...base.roles, owners: base.roles.owners.slice(0, 2) } })).toThrow(err);
    expect(invalid(undefined)).toThrow(err);
  });

  it('builds only from a vault\'s scripts on a known network', () => {
    expect(() => newManifest({ vault: { payment: undefined, stake: undefined }, network: 'preprod', owners: [], revisedAt: 1 }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_TEMPLATE' }));
    // @ts-expect-error: not a vault network.
    expect(() => newManifest({ vault, network: 'sanchonet', owners: [], revisedAt: 1 })).toThrow(expect.objectContaining({ code: 'UNKNOWN_NETWORK' }));
  });
});

describe('the participants are exactly the scripts\' keys', () => {
  const sig = (keyHash: Ed25519KeyHashHex): Cardano.NativeScript => ({ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireSignature, keyHash });
  const atLeast = (required: number, keys: Ed25519KeyHashHex[]): Cardano.NativeScript =>
    ({ __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireNOf, required, scripts: keys.map(sig) });
  const stakeHash = (p: TestParticipant) => Ed25519KeyHashHex(sdkBlake2b.hash(HexBlob(p.vaultKeys.stake), 28));
  /** `bare` with other scripts, its vault id recomputed. */
  const withScripts = (payment: Cardano.NativeScript, stake: Cardano.NativeScript) => mutated(p => {
    const scripts = { payment: vaultScript(ROLE.PAYMENT, payment), stake: vaultScript(ROLE.STAKE, stake) };
    p['paymentScript'] = b(scripts.payment.cbor);
    p['stakeScript'] = b(scripts.stake.cbor);
    p['vaultId'] = b(vaultId(scripts, 'preprod'));
  }, bare);
  const three = () => people.slice(0, 3);

  it('accepts the honest scripts', () => {
    expect(refusal(encodeManifest(bare))).toBe('ok');
  });

  it.each([
    ['KEY_NOT_IN_SCRIPT', 'an owner the scripts do not name', () => mutated(p => {
      const o = ownerOf(p, 2);
      o['vaultKeys'] = plainKeys(people[3].vaultKeys);
      o['credential'] = b(people[3].credential);
    }, bare)],
    ['SCRIPT_KEY_UNACCOUNTED', 'an owner left out', () => mutated(p => {
      list(p, 'roles', 'owners').splice(ownerIndex(p, 2), 1);
    }, bare)],
    ['VAULT_ID_MISMATCH', 'the vault id of another network', () => mutated(p => { p['vaultId'] = b(vaultId(vault, 'preview')); }, bare)],
    ['SCRIPT_INVALID', 'a script that is not CBOR', () => mutated(p => { p['paymentScript'] = new Uint8Array([0xff]); }, bare)],
    ['UNKNOWN_TEMPLATE', 'an all script', () => withScripts(
      { __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireAllOf, scripts: three().map(p => sig(p.credential)) },
      atLeast(2, three().map(stakeHash)),
    )],
    ['TEMPLATE_MISMATCH', 'a stake threshold other than the payment threshold', () => withScripts(
      atLeast(2, three().map(p => p.credential).sort()),
      atLeast(3, three().map(stakeHash).sort()),
    )],
    ['OUTSIDE_POLICY', 'a threshold of 1', () => withScripts(atLeast(1, three().map(p => p.credential).sort()), atLeast(1, three().map(stakeHash).sort()))],
  ] as [string, string, () => string][])('refuses %s: %s', (code, _what, make) => {
    expect(refusal(make())).toBe(code);
  });

  it('refuses a participant in the other branch, external cosigners included', () => {
    const backupId = vaultId(backupVault, 'preprod');
    expect(backupId).toBeDefined();
    const asOwner = { vault: backupVault, network: 'preprod' as const, owners: ownersOf(people.slice(0, 3)), revisedAt: REVISED_AT };
    expect(() => newManifest(asOwner)).toThrow(expect.objectContaining({ message: expect.stringContaining('ROLE_MISMATCH') }));
    const external = (role: 'owner' | 'backupHolder') => ({
      vault: backupVault,
      network: 'preprod' as const,
      owners: ownersOf(people.slice(0, 2)),
      external: [{ vaultKeys: people[2].vaultKeys, label: 'Heir', importedBy: people[0].credential, role }],
      revisedAt: REVISED_AT,
    });
    expect(() => newManifest(external('owner'))).toThrow(expect.objectContaining({ message: expect.stringContaining('ROLE_MISMATCH') }));
    expect(newManifest(external('backupHolder')).roles.external[0].role).toBe('backupHolder');
  });

  it('carries external cosigners as keys imported by an owner', () => {
    const make = (importedBy: Ed25519KeyHashHex) => () => newManifest({
      vault,
      network: 'preprod',
      owners: ownersOf(people.slice(0, 2)),
      external: [{ vaultKeys: people[2].vaultKeys, label: 'Other wallet', importedBy, role: 'owner' }],
      revisedAt: REVISED_AT,
    });
    const m = make(people[0].credential)();
    expect(m.roles.external[0]).toMatchObject({ credential: people[2].credential, importedBy: people[0].credential, role: 'owner' });
    expect(refusal(encodeManifest(m))).toBe('ok');
    expect(make(people[2].credential)).toThrow(expect.objectContaining({ message: expect.stringContaining('IMPORTER_INVALID') }));
    expect(make(people[3].credential)).toThrow(expect.objectContaining({ message: expect.stringContaining('IMPORTER_INVALID') }));
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0)['credential'] = b(people[3].credential); }, m))).toBe('CREDENTIAL_MISMATCH');
  });

  it('pins each owner\'s stake key to their binding: crossed stake keys are refused where a binding exists', () => {
    // Owners 0 and 1 have bindings. Swapping their stake keys in the entries leaves the scripts
    // satisfied, but each binding carries its owner's own keys.
    const crossed = mutated(p => {
      const a = ownerOf(p, 0)['vaultKeys'] as P;
      const c = ownerOf(p, 1)['vaultKeys'] as P;
      [a['stake'], c['stake']] = [c['stake'], a['stake']];
    });
    expect(refusal(crossed)).toBe('BINDING_MISMATCH');
    // Without bindings the scripts alone cannot tell; the owners' own checks and the ceremony do
    // (manifestCheck.spec.ts, verificationNumber.spec.ts).
    const unbound = newManifest({ vault, network: 'preprod', owners: [people[0].vaultKeys, mix(people[1].vaultKeys, people[2].vaultKeys), mix(people[2].vaultKeys, people[1].vaultKeys)].map(vaultKeys => ({ vaultKeys })), revisedAt: REVISED_AT });
    expect(refusal(encodeManifest(unbound))).toBe('ok');
  });
});

/** Index of owner `n` in the plain owners list. */
function ownerIndex(p: P, n: number): number {
  return list(p, 'roles', 'owners').findIndex(o => hexOf((o as P)['credential'] as Uint8Array) === people[n].credential);
}

describe('device bindings', () => {
  it('derive the device id as gero-xdev does, and sign two tagged digests of the body', async () => {
    const device = await testDevice(1);
    const body = deviceBinding({ vaultId: id, role: 'owner', vaultKeys: people[0].vaultKeys, ed25519Pub: device.ed25519Pub, x25519Pub: device.x25519Pub, label: 'Laptop' });
    expect(body.credential).toBe(people[0].credential);
    expect(body.deviceId).toBe(deviceIdFromPubKey(device.ed25519Pub));
    expect(deviceIdOf(device.ed25519Pub)).toBe(body.deviceId);
    const cbor = deviceBindingCbor(body);
    const plain = plainBinding({ ...body, deviceSig: '' } as OwnerDeviceBinding);
    delete plain['deviceSig'];
    delete plain['attestation'];
    expect(cbor).toBe(hexOf(cborgEncode(plain)));
    const tagged = (tag: string) => sdkBlake2b.hash(HexBlob(Buffer.from(tag, 'utf8').toString('hex') + cbor), 32);
    expect(bindingDigest(body)).toBe(tagged(BINDING_DIGEST_TAG));
    expect(bindingDeviceDigest(body)).toBe(tagged(BINDING_DEVICE_TAG));
    expect(bindingDigest(body)).not.toBe(bindingDeviceDigest(body));
    const signed = base.roles.owners.find(e => e.credential === people[0].credential).devices[0];
    expect(bindingDigest(signed)).toBe(bindingDigest({ ...signed, label: 'Laptop' }));
    expect(deviceBindingCbor({ ...signed, attestation: undefined, deviceSig: '00' } as OwnerDeviceBinding)).toBe(deviceBindingCbor(signed));
  });

  it('verify the device signature over the device digest', async () => {
    const signed = base.roles.owners.find(e => e.credential === people[0].credential).devices[0];
    expect(await verifyDeviceSignature(signed)).toBe(true);
    expect(await verifyDeviceSignature({ ...signed, label: 'Another label' })).toBe(false);
    expect(await verifyDeviceSignature({ ...signed, deviceSig: '00'.repeat(64) })).toBe(false);
    expect(await verifyDeviceSignature(undefined)).toBe(false);
  });

  it('write no credential and no vault keys for a viewer', async () => {
    const device = await testDevice(9);
    const viewer = deviceBinding({ vaultId: id, role: 'viewer', ed25519Pub: device.ed25519Pub, x25519Pub: device.x25519Pub, label: 'Accountant' });
    expect(viewer.credential).toBeUndefined();
    expect(deviceBindingCbor(viewer)).toContain(hexOf(cborgEncode({ credential: new Uint8Array(0) })).slice(2));
  });

  it('refuse small-order and non-canonical device keys (checked against noble curves)', async () => {
    const torsion = new Set<string>();
    let q = nobleEd25519.Point.ZERO;
    const order8 = nobleEd25519.Point.fromHex('26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05');
    for (let i = 0; i < 8; i++) {
      torsion.add(hexOf(q.toBytes()));
      q = q.add(order8);
    }
    expect(torsion.size).toBe(8);
    for (const key of torsion) {
      expect(nobleEd25519.Point.fromHex(key).isSmallOrder()).toBe(true);
      expect(isUsableEd25519Key(key)).toBe(false);
    }
    const p = 'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f';
    expect(isUsableEd25519Key(p)).toBe(false);
    expect(isUsableEd25519Key('01' + '00'.repeat(31))).toBe(false);
    for (let n = 1; n <= 9; n++) expect(isUsableEd25519Key((await testDevice(n)).ed25519Pub)).toBe(true);

    const smallX = [
      '00'.repeat(32), '01' + '00'.repeat(31),
      'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
      '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    ];
    for (const u of smallX) {
      expect(() => nobleX25519.getSharedSecret(nobleX25519.utils.randomSecretKey(), u)).toThrow();
      expect(isUsableX25519Key(u)).toBe(false);
    }
    expect(isUsableX25519Key(p)).toBe(false);
    expect(isUsableX25519Key('eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f')).toBe(false);
    const real = hexOf(nobleX25519.getPublicKey(new Uint8Array(32).fill(9)));
    expect(isUsableX25519Key(real)).toBe(true);
    const topBit = b(real);
    topBit[31] |= 0x80;
    expect(isUsableX25519Key(hexOf(topBit))).toBe(false);

    const device = await testDevice(1);
    const make = (keys: { ed25519Pub: string; x25519Pub: string }) => () =>
      deviceBinding({ vaultId: id, role: 'owner', vaultKeys: people[0].vaultKeys, ...keys, label: 'L' });
    expect(make({ ed25519Pub: '01' + '00'.repeat(31), x25519Pub: device.x25519Pub })).toThrow(expect.objectContaining({ message: expect.stringContaining('DEVICE_KEY_INVALID') }));
    expect(make({ ed25519Pub: device.ed25519Pub, x25519Pub: '00'.repeat(32) })).toThrow(expect.objectContaining({ message: expect.stringContaining('DEVICE_KEY_INVALID') }));
  });

  it('refuse a bad binding with GeroVaultError INVALID_DEVICE_BINDING', async () => {
    const device = await testDevice(1);
    const ok = { vaultId: id, role: 'owner' as const, vaultKeys: people[0].vaultKeys, ed25519Pub: device.ed25519Pub, x25519Pub: device.x25519Pub, label: 'Laptop' };
    const err = expect.objectContaining({ code: 'INVALID_DEVICE_BINDING' });
    for (const bad of [
      { ...ok, ed25519Pub: device.ed25519Pub.slice(2) },
      { ...ok, ed25519Pub: device.ed25519Pub.toUpperCase() },
      { ...ok, x25519Pub: device.ed25519Pub },
      { ...ok, vaultKeys: undefined },
      { ...ok, role: 'viewer' as const },
      { ...ok, role: 'admin' },
      { ...ok, vaultId: id.slice(2) },
      { ...ok, bindingVersion: 0 },
    ]) {
      expect(() => deviceBinding(bad as typeof ok)).toThrow(err);
    }
    expect(() => deviceIdOf('00')).toThrow(err);
  });
});

describe('labels', () => {
  const withLabel = (label: string) => {
    try {
      normalizeManifest(newManifest({
        vault,
        network: 'preprod',
        owners: ownersOf(people.slice(0, 2)),
        external: [{ vaultKeys: people[2].vaultKeys, label, importedBy: people[0].credential, role: 'owner' }],
        revisedAt: REVISED_AT,
      }));
      return 'accepted';
    } catch (e) {
      return (e as Error).message.split(':')[0];
    }
  };

  it.each([
    ['a zero-width space', `Al${char(0x200b)}ice`],
    ['a zero-width joiner', `Bob${char(0x200d)}`],
    ['a byte order mark', `${char(0xfeff)}Carol`],
    ['a line separator', `line${char(0x2028)}break`],
    ['a paragraph separator', `para${char(0x2029)}break`],
    ['a soft hyphen', `Da${char(0x00ad)}vid`],
    ['a word joiner', `Er${char(0x2060)}in`],
    ['tag characters', `Eve${char(0xe0041)}${char(0xe0042)}`],
    ['a right-to-left override', `evil${char(0x202e)}gpj.exe`],
    ['a private use character', `x${char(0xe000)}`],
    ['an unassigned code point', `x${char(0x0378)}`],
    ['a Hangul filler (U+115F)', `x${char(0x115f)}`],
    ['a Hangul filler (U+1160)', `x${char(0x1160)}`],
    ['a Hangul filler (U+3164)', `x${char(0x3164)}`],
    ['a halfwidth Hangul filler', `x${char(0xffa0)}`],
    ['a decomposed accent (not NFC)', `Rene${char(0x0301)}`],
    ['the field separator', 'Bob|Alice'],
    ['a newline', 'line\nbreak'],
    ['an empty label', ''],
    ['65 bytes', char(0xe9).repeat(33)],
  ])('refuses %s', (_what, label) => {
    expect(withLabel(label)).toBe('LABEL_INVALID');
  });

  it('accepts ordinary text in NFC, other scripts and emoji', () => {
    for (const label of [`Ren${char(0xe9)}`, 'Treasury 2027', char(0x6c34), `Team ${char(0x1f680)}`]) expect(withLabel(label)).toBe('accepted');
  });
});

describe('revisions', () => {
  it('link the next revision by hash and version, never back in time', async () => {
    const device = await signedBinding({ vaultId: id, role: 'owner', participant: people[2], device: 3, label: 'Ledger' });
    const v2 = nextManifestRevision(base, {
      roles: { owners: base.roles.owners.map(e => (e.credential === people[2].credential ? { ...e, devices: [device] } : e)) },
      revisedAt: REVISED_AT + 60,
    });
    expect(v2.version).toBe(2);
    expect(v2.prevManifestHash).toBe(manifestHash(base));
    expect(checkManifestRevision(base, v2)).toEqual({ ok: true });
    const decoded = decodeManifest(encodeManifest(v2));
    expect(decoded.ok === true && decoded.manifest).toEqual(v2);
    expect(isManifestFork(base, v2)).toBe(false);

    const sibling = nextManifestRevision(base, { roles: { viewers: [] }, revisedAt: REVISED_AT + 60 });
    expect(isManifestFork(v2, sibling)).toBe(true);
    expect(isManifestFork(v2, v2)).toBe(false);

    expect(checkManifestRevision(base, { ...v2, prevManifestHash: '00'.repeat(32) })).toEqual({ ok: false, code: 'PREV_HASH_MISMATCH' });
    expect(checkManifestRevision(base, { ...v2, version: 3 })).toEqual({ ok: false, code: 'VERSION_NOT_NEXT' });
    expect(checkManifestRevision(v2, base)).toEqual({ ok: false, code: 'VERSION_NOT_NEXT' });
    expect(checkManifestRevision(base, { ...v2, revisedAt: REVISED_AT - 1 })).toEqual({ ok: false, code: 'TIME_BACKWARDS' });
    expect(checkManifestRevision(base, { ...v2, revisedAt: REVISED_AT })).toEqual({ ok: true });
    expect(checkManifestRevision(bare, { ...nextManifestRevision(bare, { roles: {}, revisedAt: REVISED_AT }), network: 'preview' })).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(checkManifestRevision(base, { ...v2, revisedAt: -1 })).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(() => nextManifestRevision(base, { roles: {}, revisedAt: REVISED_AT - 1 })).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });

  it('keep the script participants: a vault\'s keys never change', () => {
    const withExternal = newManifest({
      vault,
      network: 'preprod',
      owners: ownersOf(people.slice(0, 2)),
      external: [{ vaultKeys: people[2].vaultKeys, label: 'Other wallet', importedBy: people[0].credential, role: 'owner' }],
      revisedAt: REVISED_AT,
    });
    // The same scripts, the third key now claimed by an owner entry instead of the external entry.
    const moved = nextManifestRevision(bare, { roles: {}, revisedAt: REVISED_AT });
    const relabelled = nextManifestRevision(withExternal, { roles: { external: [{ ...withExternal.roles.external[0], label: 'Renamed' }] }, revisedAt: REVISED_AT });
    expect(checkManifestRevision(withExternal, relabelled)).toEqual({ ok: true });
    expect(checkManifestRevision(withExternal, { ...moved, prevManifestHash: manifestHash(withExternal) })).toEqual({ ok: false, code: 'PARTICIPANTS_CHANGED' });
    expect(() => nextManifestRevision(withExternal, { roles: { external: [{ ...withExternal.roles.external[0], importedBy: people[1].credential }] }, revisedAt: REVISED_AT }))
      .toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});

describe('decoding untrusted manifests', () => {
  it('accepts the canonical encoding of the model it was built from', () => {
    expect(refusal(encodePlain(plainOf(base)))).toBe('ok');
  });

  it.each([
    ['UNSUPPORTED_PROTOCOL', (p: P) => { p['protocol'] = 'gero-vault/v2'; }],
    ['UNSUPPORTED_SCHEMA', (p: P) => { p['schema'] = 2; }],
    ['UNKNOWN_NETWORK', (p: P) => { p['network'] = 'cardano-sanchonet'; }],
    ['UNKNOWN_NETWORK', (p: P) => { p['network'] = 'preprod'; }],
    ['SCHEMA_INVALID', (p: P) => { p['extra'] = 1; }],
    ['SCHEMA_INVALID', (p: P) => { delete p['revisedAt']; }],
    ['SCHEMA_INVALID', (p: P) => { p['vaultId'] = id; }],
    ['SCHEMA_INVALID', (p: P) => { p['schema'] = true; }],
    ['SCHEMA_INVALID', (p: P) => { p['viewersSeeProposalContents'] = 0; }],
    ['NOT_IN_PHASE_1', (p: P) => { p['viewersSeeProposalContents'] = true; }],
    ['FIELD_INVALID', (p: P) => { p['vaultId'] = b(id).slice(1); }],
    ['FIELD_INVALID', (p: P) => { p['revisedAt'] = REVISED_AT * 1000; }],
    ['VAULT_ID_MISMATCH', (p: P) => { (p['paymentScript'] as Uint8Array)[10] ^= 1; }],
    ['VERSION_INVALID', (p: P) => { p['version'] = 0; }],
    ['VERSION_INVALID', (p: P) => { p['prevManifestHash'] = new Uint8Array(32); }],
    ['VERSION_INVALID', (p: P) => { p['version'] = 2; }],
    ['FIELD_INVALID', (p: P) => { p['prevManifestHash'] = new Uint8Array(31); }],
    ['NOT_IN_PHASE_1', (p: P) => { p['policiesDisplay'] = { whitelist: 1 }; }],
    ['NOT_IN_PHASE_1', (p: P) => { list(p, 'roles', 'guardians').push(list(p, 'roles', 'owners')[0]); }],
    ['NOT_IN_PHASE_1', (p: P) => { list(p, 'roles', 'delegates').push(list(p, 'roles', 'owners')[0]); }],
    ['SCHEMA_INVALID', (p: P) => { delete at(p, 'roles')['external']; }],
    ['CREDENTIAL_MISMATCH', (p: P) => { ownerOf(p, 2)['credential'] = new Uint8Array(28).fill(7); }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 2), 'vaultKeys')['stake'] = at(ownerOf(p, 2), 'vaultKeys')['payment']; }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 2), 'vaultKeys')['stake'] = new Uint8Array(64); }],
    ['SCHEMA_INVALID', (p: P) => { ownerOf(p, 2)['vaultKeys'] = { payment: new Uint8Array(32) }; }],
    ['DUPLICATE_PARTICIPANT', (p: P) => { const o = list(p, 'roles', 'owners'); o.splice(1, 0, o[0]); }],
    ['IMPORTER_INVALID', (p: P) => {
      list(p, 'roles', 'external').push({ credential: b(people[3].credential), vaultKeys: plainKeys(people[3].vaultKeys), label: 'X', importedBy: new Uint8Array(28), role: 'owner' });
    }],
    ['BINDING_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['role'] = 'backupHolder'; }],
    ['BINDING_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['vaultId'] = new Uint8Array(32); }],
    ['BINDING_MISMATCH', (p: P) => {
      const d = at(ownerOf(p, 0), 'devices', 0);
      d['credential'] = ownerOf(p, 1)['credential'];
      d['vaultKeys'] = ownerOf(p, 1)['vaultKeys'];
    }],
    ['BINDING_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'vaultKeys')['stake'] = at(ownerOf(p, 1), 'vaultKeys')['stake']; }],
    ['CREDENTIAL_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['credential'] = ownerOf(p, 1)['credential']; }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['role'] = 'admin'; }],
    ['DEVICE_ID_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['deviceId'] = new Uint8Array(16); }],
    ['FIELD_INVALID', (p: P) => {
      const d = at(ownerOf(p, 0), 'devices', 0);
      d['x25519Pub'] = d['ed25519Pub'];
    }],
    ['DEVICE_KEY_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['x25519Pub'] = new Uint8Array(32); }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['bindingVersion'] = 0; }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['deviceSig'] = new Uint8Array(63); }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['attestation'] = {}; }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['method'] = 7; }],
    ['SCHEMA_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['method'] = 'cip8'; }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['proof'] = new Uint8Array(0); }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['proof'] = new Uint8Array(2049); }],
    ['SCHEMA_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['attestation'] = { method: 0 }; }],
    ['ATTESTATION_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0, 'devices', 0)['attestation'] = { method: 0, proof: new Uint8Array(4) }; }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['credential'] = new Uint8Array(28); }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['vaultKeys'] = { payment: new Uint8Array(32), stake: new Uint8Array(32) }; }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['devices'] = []; }],
    ['LABEL_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['label'] = `x${char(0x200b)}`; }],
    ['DUPLICATE_DEVICE', (p: P) => {
      const d = structuredClone(at(ownerOf(p, 0), 'devices', 0));
      d['credential'] = ownerOf(p, 2)['credential'];
      d['vaultKeys'] = structuredClone(ownerOf(p, 2)['vaultKeys']);
      list(ownerOf(p, 2), 'devices').push(d);
    }],
    ['DUPLICATE_DEVICE', (p: P) => { at(ownerOf(p, 1), 'devices', 0)['x25519Pub'] = at(ownerOf(p, 0), 'devices', 0)['x25519Pub']; }],
    ['TOO_MANY_ENTRIES', (p: P) => {
      const devices = list(ownerOf(p, 0), 'devices');
      for (let i = 0; i < 5; i++) devices.push(devices[0]);
    }],
    ['TOO_MANY_ENTRIES', (p: P) => {
      const owners = list(p, 'roles', 'owners');
      while (owners.length < 21) owners.push(owners[0]);
    }],
    ['NOT_CANONICAL', (p: P) => { list(p, 'roles', 'owners').reverse(); }],
  ] as [string, (p: P) => void][])('refuses %s (case %#)', (code, fn) => {
    expect(refusal(mutated(fn))).toBe(code);
  });

  it('refuses map keys out of canonical order', () => {
    const reversed = Object.fromEntries(Object.entries(plainOf(base)).reverse());
    expect(refusal(hexOf(cborgEncode(reversed, { mapSorter: () => 0 })))).toBe('NOT_CANONICAL');
  });

  it('refuses malformed CBOR, wrong input shapes and anything over the bounds', () => {
    const cbor = encodeManifest(base);
    expect(refusal(cbor + '00')).toBe('MALFORMED_CBOR');
    expect(refusal(cbor.slice(0, -2))).toBe('MALFORMED_CBOR');
    expect(refusal('bf' + cbor.slice(2) + 'ff')).toBe('MALFORMED_CBOR');
    expect(refusal('c0' + cbor)).toBe('MALFORMED_CBOR');
    expect(refusal('f6')).toBe('MALFORMED_CBOR');
    expect(refusal('fb3ff8000000000000')).toBe('MALFORMED_CBOR');
    expect(refusal('b80c' + cbor.slice(2))).toBe('MALFORMED_CBOR');
    expect(refusal('a2616101616101')).toBe('MALFORMED_CBOR');
    const nest = (d: number): CborWritable => (d === 0 ? 0 : [nest(d - 1)]);
    expect(refusal(hexOf(encodeCanonicalCbor(nest(10))))).toBe('SCHEMA_INVALID');
    expect(refusal(hexOf(encodeCanonicalCbor(nest(11))))).toBe('MALFORMED_CBOR');
    expect(refusal(hexOf(encodeCanonicalCbor(Array(16383).fill(0))))).toBe('SCHEMA_INVALID');
    expect(refusal(hexOf(encodeCanonicalCbor(Array(16384).fill(0))))).toBe('TOO_LARGE');
    expect(refusal('a0')).toBe('SCHEMA_INVALID');
    expect(refusal('80')).toBe('SCHEMA_INVALID');
    // One string form: lowercase hex, nothing else.
    expect(refusal(cbor.toUpperCase())).toBe('MALFORMED_INPUT');
    expect(refusal(`0x${cbor}`)).toBe('MALFORMED_INPUT');
    expect(refusal(` ${cbor}`)).toBe('MALFORMED_INPUT');
    expect(refusal('abc')).toBe('MALFORMED_INPUT');
    expect(refusal(42)).toBe('MALFORMED_INPUT');
    expect(refusal(undefined)).toBe('MALFORMED_INPUT');
    expect(refusal([1, 2])).toBe('MALFORMED_INPUT');
    expect(refusal({ length: 3 })).toBe('MALFORMED_INPUT');
    expect(refusal(new Proxy(new Uint8Array(4), { get() { throw new Error('boom'); } }))).toBe('MALFORMED_INPUT');
    expect(refusal('00'.repeat(262145))).toBe('TOO_LARGE');
    expect(refusal(new Uint8Array(262145))).toBe('TOO_LARGE');
    // Bytes in any Uint8Array view decode the same.
    expect(refusal(Buffer.from(cbor, 'hex'))).toBe('ok');
    const padded = b(`ff${cbor}ff`);
    expect(refusal(padded.subarray(1, padded.length - 1))).toBe('ok');
  });

  it('never throws on structural mutations and random bytes, and accepts only canonical bytes', () => {
    let seed = 12345;
    const rand = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed;
    };
    const pick = <T>(xs: readonly T[]): T => xs[rand() % xs.length];
    const baseBytes = b(encodeManifest(base));
    const INTS = [0, 1, 2, 3, 23, 24, 255, 256, 65535, 65536, 4294967295, 4294967296, Number.MAX_SAFE_INTEGER, -1, -24, -25];
    const leaf = (): unknown => {
      switch (rand() % 8) {
        case 0: return pick(INTS);
        case 1: return pick([true, false]);
        case 2: return pick(['', 'owner', 'viewer', 'external', 'gero-vault/v1', 'cardano-preprod', 'x'.repeat(rand() % 70), 'a|b', char(0x202e)]);
        case 3: return new Uint8Array(pick([0, 1, 16, 27, 28, 29, 31, 32, 33, 63, 64, 2048, 2049]));
        case 4: return [];
        case 5: return {};
        case 6: return Uint8Array.from({ length: pick([16, 28, 32, 64]) }, () => rand() & 0xff);
        default: return [pick(INTS)];
      }
    };
    const plain = () => cborgDecode(baseBytes, { useMaps: false }) as P;
    const paths: (string | number)[][] = [];
    const collect = (v: unknown, path: (string | number)[]) => {
      paths.push(path);
      if (Array.isArray(v)) v.forEach((x, i) => collect(x, [...path, i]));
      else if (v && typeof v === 'object' && !(v instanceof Uint8Array)) for (const k of Object.keys(v)) collect((v as P)[k], [...path, k]);
    };
    collect(plain(), []);
    const mutate = (root: P): P => {
      const path = pick(paths);
      if (path.length === 0) return root;
      let parent: P;
      try {
        parent = at(root, ...path.slice(0, -1));
      } catch {
        return root;
      }
      if (!parent || typeof parent !== 'object') return root;
      const k = path[path.length - 1] as string;
      const v = parent[k];
      switch (rand() % 6) {
        case 0: parent[k] = leaf(); break;
        case 1: if (Array.isArray(parent)) parent.splice(Number(k), 1); else delete parent[k]; break;
        case 2: if (Array.isArray(parent)) parent.push(structuredClone(v)); else parent[`${k}x`] = v; break;
        case 3: if (v instanceof Uint8Array && v.length) v[rand() % v.length] ^= 1 << (rand() % 8); break;
        case 4: if (typeof v === 'number') parent[k] = v + pick([-1, 1, 2 ** 32]); break;
        default: parent[k] = structuredClone(at(root, ...pick(paths)));
      }
      return root;
    };
    for (let round = 0; round < 1500; round++) {
      let bytes: Uint8Array;
      if (round % 3 === 2) {
        bytes = Uint8Array.from(baseBytes);
        for (let i = 0; i <= rand() % 5; i++) bytes[rand() % bytes.length] = rand() & 0xff;
      } else {
        let root = plain();
        for (let i = 0; i <= rand() % 3; i++) root = mutate(root);
        try {
          bytes = round % 3 === 1 ? cborgEncode(root, { mapSorter: () => (rand() % 3) - 1 }) : encodeCanonicalCbor(root as unknown as CborWritable);
        } catch {
          continue;
        }
      }
      const r = decodeManifest(round % 2 ? bytes : hexOf(bytes));
      if (r.ok === true) {
        expect(r.cbor).toBe(hexOf(bytes));
        expect(encodeManifest(r.manifest)).toBe(r.cbor);
        expect(manifestHash(r.manifest)).toBe(r.hash);
      }
    }
  });
});
