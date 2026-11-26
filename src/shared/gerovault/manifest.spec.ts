import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { ed25519 as nobleEd25519, x25519 as nobleX25519 } from '@noble/curves/ed25519.js';
import { decode as cborgDecode, encode as cborgEncode } from 'cborg';
import { deviceIdFromPubKey } from '../../services/crossDevice/deviceIdentity';
import { isUsableEd25519Key } from './attestation';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import { encodeVaultPublicKeys, parseVaultPublicKeys } from './keys';
import {
  BINDING_DEVICE_TAG,
  BINDING_DIGEST_TAG,
  DEVICE_REMOVAL_TAG,
  DeviceTombstone,
  EXTERNAL_IMPORT_TAG,
  ExternalEntry,
  MANIFEST_HASH_TAG,
  OwnerDeviceBinding,
  VIEWER_ADMISSION_TAG,
  VaultManifest,
  bindingDeviceDigest,
  bindingDigest,
  checkManifestRevision,
  decodeManifest,
  deviceBinding,
  deviceBindingCbor,
  deviceIdOf,
  deviceRemovalDigest,
  deviceStanding,
  deviceTombstone,
  encodeManifest,
  externalEntry,
  externalImportDigest,
  isManifestFork,
  isUsableX25519Key,
  keyWrapRecipients,
  lapsedAdmissions,
  manifestHash,
  manifestTemplate,
  newManifest,
  nextManifestRevision,
  nextRevisionRemovingDevice,
  normalizeManifest,
  scriptsHaveCanonicalKeyOrder,
  verifyDeviceSignature,
  viewerAdmissionDigest,
} from './manifest';
import { buildVaultFromParticipants, instantiateVaultScripts, vaultScript } from './scripts';
import { ROLE, VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import {
  TestParticipant,
  VECTOR_REVISED_AT,
  attestationBy,
  paddedCip8Attestation,
  removalBy,
  signedBinding,
  signedExternal,
  testDevice,
  vectorFixture,
  walletCip8Attestation,
} from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07).
 * - standard: `vectorFixture()`, revisedAt 1795651200.
 * - backup: owners the first two test participants, threshold 2, owner 1 with test device 1;
 *   backup holder the third, with test device 3 (CIP-8); backup threshold 1 after slot 200000000;
 *   preprod; no viewer.
 * - external: owners the first two, owner 1 with test device 1; the third as an external owner
 *   imported by owner 1 (a CIP-8 attestation by their payment key), label "Other wallet".
 * - binding: owner 1's binding of test device 1, its body's two tagged digests.
 * - removal: revision 2 of the standard vector, owner 1 removing test device 1 (CIP-8), revisedAt
 *   1795651260; the removal digest it signs.
 */
const VECTORS = {
  standard: { hash: '52a65677b6a1fb5d6c69b8b3e6fedc383bebf14e1d4f5b6f11e0865ac8696097', bytes: '2826' },
  backup: { hash: 'd9ec7a10ca2e45b978582f9a051630b47aa7718ee437899edf13fa8249b91f7e' },
  external: { hash: '58e36cd2ca0a1df4e25375509441cbd4de23147857b95fb9c2b018f1b7bfcfbb', importDigest: 'e98294d111998ed9ce0bec88173c6d97a0a698d9cbff435fe9b59a3020a836d5' },
  bindingDigest: 'f09eae9d91d7b990115437ed3413ef2a6c1f65894236914ef71c4170917faef5',
  bindingDeviceDigest: '9ce4156618b7d473f1c2dd6465744d978e57e0a2e779a904d62bee031b66e750',
  removal: { digest: '97c9561f63744a1f97afc5481f220dbfc0ee0da7df3ea02ca101ffc9a66ce7c6', hash: 'be5149fa70fa2d40506166ed914259e5b589c0dcaad38529c93f40337ffa2b17' },
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
let laptop: OwnerDeviceBinding;

const ownersOf = (list: readonly TestParticipant[]) => list.map(p => ({ vaultKeys: p.vaultKeys }));

/** Owners 1 and 2 (owner 1 with test device 1), and the third participant as an external cosigner imported by owner 1. */
async function withExternal(input: { vault?: VaultScripts; role?: 'owner' | 'backupHolder'; importer?: number; label?: string } = {}): Promise<VaultManifest> {
  const v = input.vault ?? vault;
  const vid = vaultId(v, 'preprod');
  return newManifest({
    vault: v,
    network: 'preprod',
    owners: [
      { vaultKeys: people[0].vaultKeys, devices: [await signedBinding({ vaultId: vid, role: 'owner', participant: people[0], device: 1 })] },
      { vaultKeys: people[1].vaultKeys },
    ],
    external: [signedExternal({ vaultId: vid, participant: people[2], importer: people[input.importer ?? 0], role: input.role, label: input.label })],
    revisedAt: REVISED_AT,
  });
}

beforeAll(async () => {
  ({ people, vault, id, manifest: base } = await vectorFixture());
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
    owners: ownersOf(people.slice(0, 2)),
    backups: ownersOf(people.slice(2, 3)),
  });
  bare = newManifest({ vault, network: 'preprod', owners: ownersOf(people.slice(0, 3)), revisedAt: REVISED_AT });
  laptop = base.roles.owners.find(e => e.credential === people[0].credential).devices[0];
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
    admittedBy: d.admittedBy ? { deviceId: b(d.admittedBy.deviceId), signature: b(d.admittedBy.signature) } : {},
  };
}

function plainTombstone(t: DeviceTombstone): P {
  return { deviceId: b(t.deviceId), ed25519Pub: b(t.ed25519Pub), bindingVersion: t.bindingVersion, removal: { method: t.removal.method, proof: b(t.removal.proof) }, removedIn: t.removedIn };
}

function plainOf(m: VaultManifest): P {
  const byCredential = <T extends { credential: string }>(list: readonly T[]) => [...list].sort((x, y) => (x.credential < y.credential ? -1 : 1));
  const participant = (e: VaultManifest['roles']['owners'][number]) => ({
    credential: b(e.credential),
    vaultKeys: plainKeys(e.vaultKeys),
    devices: e.devices.map(plainBinding),
    removedDevices: e.removedDevices.map(plainTombstone),
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
      viewers: m.roles.viewers.map(v => ({ credential: new Uint8Array(0), vaultKeys: {}, devices: v.devices.map(plainBinding), removedDevices: [] })),
      external: byCredential(m.roles.external).map((e: ExternalEntry) => ({
        credential: b(e.credential),
        vaultKeys: plainKeys(e.vaultKeys),
        label: e.label,
        role: e.role,
        importSig: { method: e.importSig.method, proof: b(e.importSig.proof) },
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
  it('builds a first manifest with every role slot, the scripts, and no threshold, index or importer field', async () => {
    expect(base.schema).toBe(1);
    expect(base.version).toBe(1);
    expect(base.prevManifestHash).toBeUndefined();
    expect(base.vaultId).toBe(id);
    expect(base.paymentScript).toBe(vault.payment.cbor);
    expect(base.stakeScript).toBe(vault.stake.cbor);
    expect(manifestTemplate(base)).toEqual({ kind: 'standard', threshold: 2 });
    const decoded = cborgDecode(b(encodeManifest(await withExternal())), { useMaps: false }) as P;
    const names = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && !(v instanceof Uint8Array)) for (const [k, x] of Object.entries(v)) { names.add(k); walk(x); }
    };
    walk(decoded);
    for (const name of ['index', 'y', 'threshold', 'scriptHash', 'stakeScriptHash', 'createdAt', 'roleXpubs', 'xpub', 'importedBy', 'importerDeviceId']) expect(names.has(name)).toBe(false);
    expect(Object.keys(at(decoded, 'roles')).sort()).toEqual(['backupHolders', 'delegates', 'external', 'guardians', 'owners', 'viewers']);
    expect(at(decoded, 'viewersSeeProposalContents')).toBe(false);
  });

  it('writes the spec 5.3 data model in canonical CBOR (checked with cborg)', async () => {
    expect(encodeManifest(base)).toBe(hexOf(cborgEncode(plainOf(base))));
    const m = await withExternal();
    expect(encodeManifest(m)).toBe(hexOf(cborgEncode(plainOf(m))));
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
      owners: [
        { vaultKeys: people[0].vaultKeys, devices: [await signedBinding({ vaultId: backupId, role: 'owner', participant: people[0], device: 1 })] },
        { vaultKeys: people[1].vaultKeys },
      ],
      backupHolders: [{ vaultKeys: people[2].vaultKeys, devices: [await signedBinding({ vaultId: backupId, role: 'backupHolder', participant: people[2], device: 3 })] }],
      revisedAt: REVISED_AT,
    });
    expect(manifestHash(backup)).toBe(VECTORS.backup.hash);
    expect(manifestTemplate(backup)).toEqual({ kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 });
    const ext = await withExternal();
    expect(manifestHash(ext)).toBe(VECTORS.external.hash);
    expect(externalImportDigest(id, ext.roles.external[0])).toBe(VECTORS.external.importDigest);
    expect(bindingDigest(laptop)).toBe(VECTORS.bindingDigest);
    expect(bindingDeviceDigest(laptop)).toBe(VECTORS.bindingDeviceDigest);
    expect(deviceRemovalDigest(id, laptop)).toBe(VECTORS.removal.digest);
    const removed = nextRevisionRemovingDevice(base, { deviceId: laptop.deviceId, removal: removalBy(people[0], id, laptop), revisedAt: REVISED_AT + 60 });
    expect(manifestHash(removed)).toBe(VECTORS.removal.hash);
  });

  it('has one encoding whatever order the input lists come in', async () => {
    const d = await Promise.all([1, 4, 5, 6].map(n => signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: n })));
    const v = await Promise.all([7, 8, 9].map(n => signedBinding({ vaultId: id, role: 'viewer', device: n, admitter: 1 })));
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

  it('refuses a participant in the other branch, external cosigners included', async () => {
    const asOwner = { vault: backupVault, network: 'preprod' as const, owners: ownersOf(people.slice(0, 3)), revisedAt: REVISED_AT };
    expect(() => newManifest(asOwner)).toThrow(expect.objectContaining({ message: expect.stringContaining('ROLE_MISMATCH') }));
    await expect(withExternal({ vault: backupVault, role: 'owner' })).rejects.toMatchObject({ message: expect.stringContaining('ROLE_MISMATCH') });
    expect((await withExternal({ vault: backupVault, role: 'backupHolder' })).roles.external[0].role).toBe('backupHolder');
  });

  it('carries external cosigners as keys imported and attested by an owner\'s payment key, the importer derived', async () => {
    const m = await withExternal();
    expect(m.roles.external[0]).toMatchObject({ credential: people[2].credential, importedBy: people[0].credential, role: 'owner' });
    expect(refusal(encodeManifest(m))).toBe('ok');
    // The importer is never a free field: it is the key that attested the import, an owner's.
    const byOwner2 = signedExternal({ vaultId: id, participant: people[2], importer: people[1], method: 'expiredTx' });
    expect(normalizeManifest({ ...m, roles: { ...m.roles, external: [byOwner2] } }).roles.external[0].importedBy).toBe(people[1].credential);
    const byStranger = signedExternal({ vaultId: id, participant: people[2], importer: people[3] });
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0)['importSig'] = { method: 0, proof: b(byStranger.importSig.proof) }; }, m))).toBe('IMPORTER_INVALID');
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0, 'importSig')['proof'] = new Uint8Array(4); }, m))).toBe('IMPORTER_INVALID');
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0)['importSig'] = {}; }, m))).toBe('SCHEMA_INVALID');
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0)['importerDeviceId'] = new Uint8Array(16); }, m))).toBe('SCHEMA_INVALID');
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0)['credential'] = b(people[3].credential); }, m))).toBe('CREDENTIAL_MISMATCH');
    expect(externalImportDigest(id, m.roles.external[0]))
      .toBe(sdkBlake2b.hash(HexBlob(Buffer.from(EXTERNAL_IMPORT_TAG, 'utf8').toString('hex') + hexOf(cborgEncode({
        vaultId: b(id), credential: b(people[2].credential), vaultKeys: plainKeys(people[2].vaultKeys), label: 'Other wallet', role: 'owner',
      }))), 32));
  });

  it('lets only the owners slot import, not a backup holder, also for an external backup holder', async () => {
    const vid = vaultId(backupVault, 'preprod');
    const make = (importer: TestParticipant) => newManifest({
      vault: backupVault,
      network: 'preprod',
      owners: ownersOf(people.slice(0, 2)),
      external: [signedExternal({ vaultId: vid, participant: people[2], importer, role: 'backupHolder' })],
      revisedAt: REVISED_AT,
    });
    expect(make(people[0]).roles.external[0].importedBy).toBe(people[0].credential);
    expect(() => make(people[2])).toThrow(expect.objectContaining({ message: expect.stringContaining('IMPORTER_INVALID') }));
    expect(() => make(people[3])).toThrow(expect.objectContaining({ message: expect.stringContaining('IMPORTER_INVALID') }));
    // A Gero backup holder of the vault cannot import an external owner either.
    const mixed = await buildVaultFromParticipants({
      template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
      owners: ownersOf([people[0], people[1], people[3]]),
      backups: ownersOf([people[2]]),
    });
    const mid = vaultId(mixed, 'preprod');
    const withImporter = (importer: TestParticipant) => () => newManifest({
      vault: mixed,
      network: 'preprod',
      owners: ownersOf(people.slice(0, 2)),
      backupHolders: ownersOf([people[2]]),
      external: [signedExternal({ vaultId: mid, participant: people[3], importer })],
      revisedAt: REVISED_AT,
    });
    expect(withImporter(people[1])().roles.external[0].importedBy).toBe(people[1].credential);
    expect(withImporter(people[2])).toThrow(expect.objectContaining({ message: expect.stringContaining('IMPORTER_INVALID') }));
  });

  it('pins each owner\'s stake key to their binding: crossed stake keys are refused where a binding exists', () => {
    const crossed = mutated(p => {
      const a = ownerOf(p, 0)['vaultKeys'] as P;
      const c = ownerOf(p, 1)['vaultKeys'] as P;
      [a['stake'], c['stake']] = [c['stake'], a['stake']];
    });
    expect(refusal(crossed)).toBe('BINDING_MISMATCH');
    // Without bindings the scripts alone cannot tell; the owners' own checks, the every-participant
    // rule of the funding gate and the ceremony do (manifestCheck.spec.ts, verificationNumber.spec.ts).
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
    for (const outside of ['deviceSig', 'attestation', 'admittedBy']) delete plain[outside];
    expect(cbor).toBe(hexOf(cborgEncode(plain)));
    const tagged = (tag: string) => sdkBlake2b.hash(HexBlob(Buffer.from(tag, 'utf8').toString('hex') + cbor), 32);
    expect(bindingDigest(body)).toBe(tagged(BINDING_DIGEST_TAG));
    expect(bindingDeviceDigest(body)).toBe(tagged(BINDING_DEVICE_TAG));
    expect(bindingDigest(body)).not.toBe(bindingDeviceDigest(body));
  });

  it('leave deviceSig, attestation and admittedBy out of the body both digests cover', () => {
    const viewer = base.roles.viewers[0].devices[0];
    const changed = { ...viewer, deviceSig: '11'.repeat(64), admittedBy: { deviceId: '22'.repeat(16), signature: '33'.repeat(64) } };
    expect(bindingDigest(changed)).toBe(bindingDigest(viewer));
    expect(bindingDeviceDigest(changed)).toBe(bindingDeviceDigest(viewer));
    expect(deviceBindingCbor(changed)).toBe(deviceBindingCbor(viewer));
    expect(bindingDigest({ ...laptop, attestation: undefined } as OwnerDeviceBinding)).toBe(bindingDigest(laptop));
    // The admission signs the binding digest under its own tag.
    expect(viewerAdmissionDigest(viewer)).toBe(sdkBlake2b.hash(HexBlob(Buffer.from(VIEWER_ADMISSION_TAG, 'utf8').toString('hex') + bindingDigest(viewer)), 32));
  });

  it('verify the device signature over the device digest', async () => {
    expect(await verifyDeviceSignature(laptop)).toBe(true);
    expect(await verifyDeviceSignature({ ...laptop, label: 'Another label' })).toBe(false);
    expect(await verifyDeviceSignature({ ...laptop, deviceSig: '00'.repeat(64) })).toBe(false);
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
    expect(isUsableEd25519Key('01' + '00'.repeat(30) + '80')).toBe(false);
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

  it('are admitted, for a viewer, by an owner device only, never by a backup holder\'s', async () => {
    const vid = vaultId(backupVault, 'preprod');
    const make = async (admitter: number) => newManifest({
      vault: backupVault,
      network: 'preprod',
      owners: [{ vaultKeys: people[0].vaultKeys, devices: [await signedBinding({ vaultId: vid, role: 'owner', participant: people[0], device: 1 })] }, { vaultKeys: people[1].vaultKeys }],
      backupHolders: [{ vaultKeys: people[2].vaultKeys, devices: [await signedBinding({ vaultId: vid, role: 'backupHolder', participant: people[2], device: 3 })] }],
      viewers: [{ devices: [await signedBinding({ vaultId: vid, role: 'viewer', device: 9, admitter })] }],
      revisedAt: REVISED_AT,
    });
    expect((await make(1)).roles.viewers).toHaveLength(1);
    await expect(make(3)).rejects.toMatchObject({ message: expect.stringContaining('ADMISSION_INVALID') });
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
      { ...ok, label: '   ' },
      { ...ok, label: `x${char(0x200b)}` },
    ]) {
      expect(() => deviceBinding(bad as typeof ok)).toThrow(err);
    }
    expect(() => deviceIdOf('00')).toThrow(err);
  });
});

describe('labels in manifests', () => {
  it('are written with the write rule and read with the read rule only', async () => {
    // Builders apply the write rule: NFC, trimmed, no invisible characters.
    expect(externalEntry({ vaultKeys: people[2].vaultKeys, label: `  Ren${'e'}${char(0x301)}  `, role: 'owner' }).label).toBe(`Ren${char(0xe9)}`);
    expect(() => externalEntry({ vaultKeys: people[2].vaultKeys, label: `Al${char(0x200b)}ice`, role: 'owner' }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('LABEL_INVALID') }));
    // The decoder applies the read rule only, so a label written by a client with newer Unicode
    // tables is still read (the signatures over it are checked by the ack).
    const unassigned = [0x0378, 0x0379, 0x1fafa].map(c => char(c)).find(c => /\p{Cn}/u.test(c));
    const m = await withExternal();
    expect(refusal(mutated(p => { at(p, 'roles', 'external', 0)['label'] = `new${unassigned}`; }, m))).toBe('ok');
    expect(refusal(mutated(p => { at(ownerOf(p, 0), 'devices', 0)['label'] = `x${char(0x200b)}y`; }))).toBe('ok');
    expect(refusal(mutated(p => { at(ownerOf(p, 0), 'devices', 0)['label'] = 'line\nbreak'; }))).toBe('LABEL_INVALID');
    expect(refusal(mutated(p => { at(ownerOf(p, 0), 'devices', 0)['label'] = char(0xe9).repeat(33); }))).toBe('LABEL_INVALID');
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
    expect(checkManifestRevision(base, { ...v2, revisedAt: -1 })).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(() => nextManifestRevision(base, { roles: {}, revisedAt: REVISED_AT - 1 })).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });

  it('keep the script participants and their importers: a vault\'s keys never change', async () => {
    const m = await withExternal();
    const relabelled = nextManifestRevision(m, { roles: { external: [signedExternal({ vaultId: id, participant: people[2], importer: people[0], label: 'Renamed' })] }, revisedAt: REVISED_AT });
    expect(checkManifestRevision(m, relabelled)).toEqual({ ok: true });
    const moved = nextManifestRevision(bare, { roles: {}, revisedAt: REVISED_AT });
    expect(checkManifestRevision(m, { ...moved, prevManifestHash: manifestHash(m) })).toEqual({ ok: false, code: 'PARTICIPANTS_CHANGED' });
    // Another owner imports again while the importer is still an owner: refused.
    const reimported = { ...m, version: 2, prevManifestHash: manifestHash(m), roles: { ...m.roles, external: [signedExternal({ vaultId: id, participant: people[2], importer: people[1] })] } };
    expect(checkManifestRevision(m, reimported)).toEqual({ ok: false, code: 'IMPORTER_CHANGED' });
  });

  it('carry every authorisation of an unchanged body forward, byte for byte', async () => {
    const next = (roles: Partial<VaultManifest['roles']>, from: VaultManifest = base) =>
      ({ ...from, version: from.version + 1, prevManifestHash: manifestHash(from), roles: { ...from.roles, ...roles } }) as VaultManifest;
    // Owner 1's binding attested again, by the other method: the same body, another authorisation.
    const reattested = { ...laptop, attestation: attestationBy(people[0], { kind: 'binding', digest: bindingDigest(laptop) }, 'expiredTx') };
    expect(checkManifestRevision(base, next({ owners: base.roles.owners.map(e => (e.credential === people[0].credential ? { ...e, devices: [reattested] } : e)) })))
      .toEqual({ ok: false, code: 'AUTHORISATION_CHANGED' });
    // The viewer admitted again by owner 2's device while owner 1's device, its admitter, is still bound.
    const readmitted = await signedBinding({ vaultId: id, role: 'viewer', device: 9, label: 'Accountant', admitter: 2 });
    expect(checkManifestRevision(base, next({ viewers: [{ devices: [readmitted] }] }))).toEqual({ ok: false, code: 'AUTHORISATION_CHANGED' });
    // An import attested again by the same owner with the other method.
    const m = await withExternal();
    const again = signedExternal({ vaultId: id, participant: people[2], importer: people[0], method: 'expiredTx' });
    expect(checkManifestRevision(m, next({ external: [again] }, m))).toEqual({ ok: false, code: 'AUTHORISATION_CHANGED' });
    // A changed body carries its new authorisation.
    const renamed = await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 1, label: 'Laptop 2', bindingVersion: 2 });
    expect(checkManifestRevision(base, next({ owners: base.roles.owners.map(e => (e.credential === people[0].credential ? { ...e, devices: [renamed] } : e)) })))
      .toEqual({ ok: true });
  });

});

describe('device removal', () => {
  let removed: VaultManifest;
  let phone: OwnerDeviceBinding;
  const LATER = REVISED_AT + 60;
  /** `from`'s next revision with the role slots given, unchecked. */
  const next = (roles: Partial<VaultManifest['roles']>, from: VaultManifest) =>
    ({ ...from, version: from.version + 1, prevManifestHash: manifestHash(from), roles: { ...from.roles, ...roles } }) as VaultManifest;
  /** `m`'s owners with participant `n`'s entry changed. */
  const ownersChanged = (m: VaultManifest, n: number, change: object) => m.roles.owners.map(e => (e.credential === people[n].credential ? { ...e, ...change } : e));

  beforeAll(() => {
    removed = nextRevisionRemovingDevice(base, { deviceId: laptop.deviceId, removal: removalBy(people[0], id, laptop), revisedAt: LATER });
    phone = base.roles.owners.find(e => e.credential === people[1].credential).devices[0];
  });

  it('drops the binding and keeps a tombstone, attested by the participant over { vaultId, deviceId, bindingVersion }', () => {
    const entry = removed.roles.owners.find(e => e.credential === people[0].credential);
    expect(entry.devices).toEqual([]);
    expect(entry.removedDevices).toEqual([{ deviceId: laptop.deviceId, ed25519Pub: laptop.ed25519Pub, bindingVersion: 1, removal: removalBy(people[0], id, laptop), removedIn: 2 }]);
    expect(deviceRemovalDigest(id, laptop)).toBe(sdkBlake2b.hash(HexBlob(Buffer.from(DEVICE_REMOVAL_TAG, 'utf8').toString('hex')
      + hexOf(cborgEncode({ vaultId: b(id), deviceId: b(laptop.deviceId), bindingVersion: 1 }))), 32));
    expect(checkManifestRevision(base, removed)).toEqual({ ok: true });
    const decoded = decodeManifest(encodeManifest(removed));
    expect(decoded.ok === true && decoded.manifest).toEqual(removed);
    expect(() => deviceRemovalDigest(id, { deviceId: laptop.deviceId, bindingVersion: 0 })).toThrow(expect.objectContaining({ code: 'INVALID_DEVICE_BINDING' }));
    expect(() => nextRevisionRemovingDevice(base, { deviceId: '00'.repeat(16), removal: removalBy(people[0], id, laptop), revisedAt: LATER }))
      .toThrow(expect.objectContaining({ code: 'INVALID_DEVICE_BINDING' }));
  });

  it('leaves the removed device no standing and no key wraps, and lapses the admissions it made', async () => {
    const viewer = base.roles.viewers[0].devices[0];
    expect(deviceStanding(base, laptop.ed25519Pub)).toMatchObject({ status: 'bound', binding: { deviceId: laptop.deviceId } });
    expect(deviceStanding(removed, laptop.ed25519Pub)).toEqual({ status: 'removed' });
    expect(deviceStanding(removed, phone.ed25519Pub)).toMatchObject({ status: 'bound' });
    expect(lapsedAdmissions(base)).toEqual([]);
    expect(lapsedAdmissions(removed)).toEqual([viewer.deviceId]);
    expect(deviceStanding(removed, viewer.ed25519Pub)).toMatchObject({ status: 'lapsed' });
    expect(deviceStanding(removed, (await testDevice(50)).ed25519Pub)).toEqual({ status: 'unknown' });
    expect(deviceStanding(removed, 'not a key')).toEqual({ status: 'unknown' });
    expect(keyWrapRecipients(base).map(d => d.deviceId).sort()).toEqual([laptop.deviceId, phone.deviceId].sort());
    expect(keyWrapRecipients(removed).map(d => d.deviceId)).toEqual([phone.deviceId]);
  });

  it('keeps every tombstone it has no reason to drop, and refuses a removal without one or a tombstone of nothing removed', async () => {
    const byPhone = await signedBinding({ vaultId: id, role: 'viewer', device: 9, label: 'Accountant', admitter: 2 });
    expect(checkManifestRevision(removed, next({ owners: ownersChanged(removed, 0, { removedDevices: [] }), viewers: [{ devices: [byPhone] }] }, removed)))
      .toEqual({ ok: false, code: 'TOMBSTONE_DROPPED' });
    expect(checkManifestRevision(removed, next({ owners: ownersChanged(removed, 1, { devices: [] }) }, removed))).toEqual({ ok: false, code: 'REMOVAL_UNATTESTED' });
    const ofPhone = deviceTombstone(phone, removalBy(people[1], id, phone), 3);
    expect(checkManifestRevision(removed, next({ owners: ownersChanged(removed, 1, { devices: [], removedDevices: [ofPhone] }) }, removed))).toEqual({ ok: true });
    expect(checkManifestRevision(removed, next({ owners: ownersChanged(removed, 1, { devices: [], removedDevices: [{ ...ofPhone, bindingVersion: 2 }] }) }, removed)))
      .toEqual({ ok: false, code: 'REMOVAL_UNATTESTED' });
    // A new tombstone names the revision that removes the device.
    expect(checkManifestRevision(removed, next({ owners: ownersChanged(removed, 1, { devices: [], removedDevices: [{ ...ofPhone, removedIn: 2 }] }) }, removed)))
      .toEqual({ ok: false, code: 'TOMBSTONE_INVALID' });
    const neverBound = await signedBinding({ vaultId: id, role: 'owner', participant: people[1], device: 5 });
    const stray = deviceTombstone(neverBound, removalBy(people[1], id, neverBound), 3);
    expect(checkManifestRevision(removed, next({ owners: ownersChanged(removed, 1, { removedDevices: [stray] }) }, removed))).toEqual({ ok: false, code: 'TOMBSTONE_INVALID' });
    // A tombstone moved to another participant's entry is a new tombstone there, of nothing removed.
    const laptopTombstone = removed.roles.owners.find(e => e.credential === people[0].credential).removedDevices[0];
    const moved = next({
      owners: removed.roles.owners.map(e => (e.credential === people[0].credential ? { ...e, removedDevices: [] } : e.credential === people[1].credential ? { ...e, removedDevices: [laptopTombstone] } : e)),
    }, removed);
    expect(checkManifestRevision(removed, moved)).toEqual({ ok: false, code: 'TOMBSTONE_INVALID' });
  });

  it('keeps only the newest tombstone of a device', async () => {
    const back = await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 1, label: 'Laptop', bindingVersion: 2 });
    const readded = nextManifestRevision(removed, { roles: { owners: ownersChanged(removed, 0, { devices: [back] }) }, revisedAt: LATER });
    const again = nextRevisionRemovingDevice(readded, { deviceId: laptop.deviceId, removal: removalBy(people[0], id, back), revisedAt: LATER });
    expect(again.roles.owners.find(e => e.credential === people[0].credential).removedDevices)
      .toEqual([{ deviceId: laptop.deviceId, ed25519Pub: laptop.ed25519Pub, bindingVersion: 2, removal: removalBy(people[0], id, back), removedIn: 4 }]);
    expect(checkManifestRevision(readded, again)).toEqual({ ok: true });
    // Keeping both is refused, and so is keeping the older one.
    const old = removed.roles.owners.find(e => e.credential === people[0].credential).removedDevices[0];
    const newer = again.roles.owners.find(e => e.credential === people[0].credential).removedDevices[0];
    expect(() => normalizeManifest(next({ owners: ownersChanged(readded, 0, { devices: [], removedDevices: [old, newer] }) }, readded)))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('DUPLICATE_DEVICE') }));
    expect(checkManifestRevision(readded, next({ owners: ownersChanged(readded, 0, { devices: [], removedDevices: [old] }) }, readded)))
      .toEqual({ ok: false, code: 'REMOVAL_UNATTESTED' });
  });

  it('never binds a removed binding version again: the device comes back with a higher one and a new attestation', async () => {
    expect(() => nextManifestRevision(removed, { roles: { owners: ownersChanged(removed, 0, { devices: [laptop] }) }, revisedAt: LATER }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('REMOVED_DEVICE_BOUND') }));
    expect(refusal(mutated(p => { list(ownerOf(p, 0), 'devices').push(plainBinding(laptop)); }, removed))).toBe('REMOVED_DEVICE_BOUND');
    const back = await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 1, label: 'Laptop', bindingVersion: 2 });
    const readded = nextManifestRevision(removed, { roles: { owners: ownersChanged(removed, 0, { devices: [back] }) }, revisedAt: LATER });
    expect(deviceStanding(readded, laptop.ed25519Pub)).toMatchObject({ status: 'bound', binding: { bindingVersion: 2 } });
    expect(readded.roles.owners.find(e => e.credential === people[0].credential).removedDevices).toHaveLength(1);
    // Its admissions count again: the owner bound it again with a new attestation.
    expect(lapsedAdmissions(readded)).toEqual([]);
  });

  it('carries a lapsed admission forward or takes a new one by a bound owner device, never a new one by a removed device', async () => {
    const byPhone = await signedBinding({ vaultId: id, role: 'viewer', device: 9, label: 'Accountant', admitter: 2 });
    const readmitted = nextManifestRevision(removed, { roles: { viewers: [{ devices: [byPhone] }] }, revisedAt: LATER });
    expect(deviceStanding(readmitted, byPhone.ed25519Pub)).toMatchObject({ status: 'bound' });
    expect(nextManifestRevision(removed, { roles: {}, revisedAt: LATER }).roles.viewers).toEqual(removed.roles.viewers);
    const auditor = await signedBinding({ vaultId: id, role: 'viewer', device: 8, label: 'Auditor', admitter: 1 });
    expect(() => nextManifestRevision(removed, { roles: { viewers: [...removed.roles.viewers, { devices: [auditor] }] }, revisedAt: LATER }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('ADMITTED_BY_REMOVED_DEVICE') }));
    // A first manifest cannot hold a lapsed admission at all.
    expect(() => normalizeManifest({ ...removed, version: 1, prevManifestHash: undefined }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('ADMISSION_INVALID') }));
  });

  it.each([
    ['DEVICE_ID_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0)['deviceId'] = new Uint8Array(16); }],
    ['DEVICE_KEY_INVALID', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0)['ed25519Pub'] = b(`01${'00'.repeat(31)}`); }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0)['bindingVersion'] = 0; }],
    ['SCHEMA_INVALID', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0)['removal'] = {}; }],
    ['TOMBSTONE_INVALID', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0, 'removal')['method'] = 7; }],
    ['TOMBSTONE_INVALID', (p: P) => {
      at(ownerOf(p, 0), 'removedDevices', 0, 'removal')['proof'] = b(walletCip8Attestation(people[0].signer, people[0].credential, deviceRemovalDigest(id, laptop)).proof);
    }],
    ['TOMBSTONE_INVALID', (p: P) => {
      // A removal padded through a signed address longer than any Cardano address.
      at(ownerOf(p, 0), 'removedDevices', 0, 'removal')['proof'] = b(paddedCip8Attestation(people[0], deviceRemovalDigest(id, laptop), 58).proof);
    }],
    ['DUPLICATE_DEVICE', (p: P) => { const t = list(ownerOf(p, 0), 'removedDevices'); t.push(structuredClone(t[0])); }],
    ['DUPLICATE_DEVICE', (p: P) => { const t = list(ownerOf(p, 0), 'removedDevices'); t.push({ ...(structuredClone(t[0]) as P), bindingVersion: 16 }); }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0)['removedIn'] = 1; }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'removedDevices', 0)['removedIn'] = 3; }],
    ['SCHEMA_INVALID', (p: P) => { delete at(ownerOf(p, 0), 'removedDevices', 0)['removedIn']; }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['removedDevices'] = [structuredClone(at(ownerOf(p, 0), 'removedDevices', 0))]; }],
    ['SCHEMA_INVALID', (p: P) => { delete ownerOf(p, 1)['removedDevices']; }],
  ] as [string, (p: P) => void][])('refuses a tombstone that breaks the rules: %s (case %#)', (code, fn) => {
    expect(refusal(mutated(fn, removed))).toBe(code);
  });

  it('holds at most 1,024 tombstones', () => {
    const tombstone = removed.roles.owners.find(e => e.credential === people[0].credential).removedDevices[0];
    expect(() => normalizeManifest({ ...removed, roles: { ...removed.roles, owners: ownersChanged(removed, 0, { removedDevices: Array(1025).fill(tombstone) }) } }))
      .toThrow(expect.objectContaining({ message: expect.stringContaining('TOO_MANY_ENTRIES') }));
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
    ['ATTESTATION_INVALID', (p: P) => {
      // The wallet's own signData output is valid, but not the stored form: refused at decode.
      at(ownerOf(p, 0), 'devices', 0, 'attestation')['proof'] = b(walletCip8Attestation(people[0].signer, people[0].credential, bindingDigest(laptop)).proof);
    }],
    ['ATTESTATION_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0, 'devices', 0)['attestation'] = { method: 0, proof: new Uint8Array(4) }; }],
    ['ADMISSION_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0, 'devices', 0)['admittedBy'] = {}; }],
    ['ADMISSION_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0, 'devices', 0, 'admittedBy')['deviceId'] = new Uint8Array(16); }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0, 'devices', 0, 'admittedBy')['signature'] = new Uint8Array(63); }],
    ['ADMISSION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['admittedBy'] = at(p, 'roles', 'viewers', 0, 'devices', 0, 'admittedBy'); }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['credential'] = new Uint8Array(28); }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['vaultKeys'] = { payment: new Uint8Array(32), stake: new Uint8Array(32) }; }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['devices'] = []; }],
    ['LABEL_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['label'] = `x${char(0x85)}`; }],
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
    expect(refusal(Buffer.from(cbor, 'hex'))).toBe('ok');
    const padded = b(`ff${cbor}ff`);
    expect(refusal(padded.subarray(1, padded.length - 1))).toBe('ok');
  });

  it('never throws on structural mutations and random bytes, and accepts only canonical bytes', async () => {
    let seed = 12345;
    const rand = () => {
      seed ^= seed << 13; seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5; seed >>>= 0;
      return seed;
    };
    const pick = <T>(xs: readonly T[]): T => xs[rand() % xs.length];
    const baseBytes = b(encodeManifest(await withExternal()));
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
    // A fresh copy each time: cborg returns byte strings as views into its input, and the
    // mutations below flip bytes in place.
    const plain = () => cborgDecode(Uint8Array.from(baseBytes), { useMaps: false }) as P;
    /** The value at `path`, or undefined when an earlier mutation removed it. */
    const lookup = (root: P, path: readonly (string | number)[]): unknown => {
      let o: unknown = root;
      for (const k of path) {
        if (o === null || typeof o !== 'object') return undefined;
        o = (o as P)[k as string];
      }
      return o;
    };
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
      const parent = lookup(root, path.slice(0, -1)) as P;
      if (!parent || typeof parent !== 'object') return root;
      const k = path[path.length - 1] as string;
      const v = parent[k];
      switch (rand() % 6) {
        case 0: parent[k] = leaf(); break;
        case 1: if (Array.isArray(parent)) parent.splice(Number(k), 1); else delete parent[k]; break;
        case 2: if (Array.isArray(parent)) parent.push(structuredClone(v)); else parent[`${k}x`] = v; break;
        case 3: if (v instanceof Uint8Array && v.length) v[rand() % v.length] ^= 1 << (rand() % 8); break;
        case 4: if (typeof v === 'number') parent[k] = v + pick([-1, 1, 2 ** 32]); break;
        default: {
          const source = lookup(root, pick(paths));
          if (source !== undefined) parent[k] = structuredClone(source);
        }
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
