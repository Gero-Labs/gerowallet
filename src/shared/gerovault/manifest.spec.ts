import { beforeAll, describe, expect, it } from 'vitest';
import { blake2b as sdkBlake2b, Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { decode as cborgDecode, encode as cborgEncode } from 'cborg';
import { deviceIdFromPubKey } from '../../services/crossDevice/deviceIdentity';
import { CborWritable, encodeCanonicalCbor } from './canonicalCbor';
import {
  MANIFEST_HASH_TAG,
  OwnerDeviceBinding,
  VaultManifest,
  bindingDigest,
  checkManifestRevision,
  decodeManifest,
  deviceBinding,
  deviceBindingCbor,
  deviceIdOf,
  encodeManifest,
  isManifestFork,
  manifestHash,
  newManifest,
  nextManifestRevision,
} from './manifest';
import { buildVaultFromParticipants } from './scripts';
import { VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import { VECTOR_CREATED_AT, boundDevice, testDevice, vectorFixture } from './__fixtures__/manifest';

/**
 * PROVISIONAL vectors: not frozen until they match the other clients' vectors (GV-07).
 * - standard: `vectorFixture()`, createdAt 1795651200. Attestations are placeholder bytes.
 * - backup: owners the first two, threshold 2; backup holder test cosigner 2 with test device 3;
 *   backup threshold 1 after slot 200000000; preprod; no viewer.
 * - binding: owner 1's binding of test device 1, without its attestation.
 */
const VECTORS = {
  standard: { hash: '30964d0b058f0e9e6a4de045d053673c6f65d0c30d2332247106c609519660e5', bytes: 1633 },
  backup: { hash: '345d437c107f7503e27cc36b4c92d040d7f55f82e57502eb73e9820ee370891e' },
  bindingDigest: 'd1f2503ce3d30d0fc7fdbd194e7f2b00e4ebcac9fe36131607f82e142cebc71a',
};

const CREATED_AT = VECTOR_CREATED_AT;
const b = (h?: string) => (h ? Uint8Array.from(Buffer.from(h, 'hex')) : new Uint8Array(0));
const hexOf = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

let keys: VaultPublicKeys[];
let credentials: Ed25519KeyHashHex[];
let standard: VaultScripts;
let backupVault: VaultScripts;
let id: string;
let base: VaultManifest;

beforeAll(async () => {
  const fixture = await vectorFixture();
  ({ keys, credentials, id, manifest: base } = fixture);
  standard = fixture.vault;
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
    owners: keys.slice(0, 2).map(vaultKeys => ({ vaultKeys })),
    backups: [{ vaultKeys: keys[2] }],
  });
});

type P = Record<string, unknown>;

/** The data model of spec 5.3, built here independently of the encoder. */
function plainBinding(d: OwnerDeviceBinding): P {
  return {
    vaultId: b(d.vaultId),
    role: d.role,
    credential: b(d.credential),
    deviceId: b(d.deviceId),
    ed25519Pub: b(d.ed25519Pub),
    x25519Pub: b(d.x25519Pub),
    label: d.label,
    bindingVersion: d.bindingVersion,
    attestation: d.attestation ? { method: d.attestation.method, proof: b(d.attestation.proof) } : {},
  };
}

function plainOf(m: VaultManifest): P {
  const byCredential = <T extends { credential: string }>(list: readonly T[]) => [...list].sort((x, y) => (x.credential < y.credential ? -1 : 1));
  const participant = (e: VaultManifest['roles']['owners'][number]) => ({
    credential: b(e.credential),
    vaultKeys: { payment: b(e.vaultKeys.payment), stake: b(e.vaultKeys.stake) },
    devices: e.devices.map(plainBinding),
  });
  return {
    protocol: 'gero-vault/v1',
    network: `cardano-${m.network}`,
    vaultId: b(m.vaultId),
    scriptHash: b(m.scriptHash),
    stakeScriptHash: b(m.stakeScriptHash),
    threshold: m.threshold,
    roles: {
      owners: byCredential(m.roles.owners).map(participant),
      backupHolders: byCredential(m.roles.backupHolders).map(participant),
      guardians: [],
      delegates: [],
      viewers: m.roles.viewers.map(v => ({ credential: new Uint8Array(0), vaultKeys: {}, devices: v.devices.map(plainBinding) })),
      external: byCredential(m.roles.external).map(e => ({ credential: b(e.credential), label: e.label })),
    },
    viewersSeeProposalContents: 0,
    policiesDisplay: {},
    version: m.version,
    prevManifestHash: b(m.prevManifestHash),
    createdAt: m.createdAt,
  };
}

const at = (p: unknown, ...path: (string | number)[]): P => path.reduce<unknown>((o, k) => (o as P)[k as string], p) as P;
const list = (p: unknown, ...path: (string | number)[]): unknown[] => at(p, ...path) as unknown as unknown[];
const encodePlain = (p: P) => hexOf(encodeCanonicalCbor(p as unknown as CborWritable));
/** Owner `n` of the fixture (0 and 1 have a device, 2 has none), wherever sorting put it. */
const ownerOf = (p: P, n: number): P =>
  list(p, 'roles', 'owners').find(o => hexOf((o as P)['credential'] as Uint8Array) === credentials[n]) as P;

function mutated(fn: (p: P) => void): string {
  const p = plainOf(base);
  fn(p);
  return encodePlain(p);
}

describe('manifest encoding', () => {
  it('builds a first manifest with every role slot present and no index', () => {
    expect(base.version).toBe(1);
    expect(base.prevManifestHash).toBeUndefined();
    expect(base.vaultId).toBe(id);
    expect(base.scriptHash).toBe(standard.payment.hash);
    expect(base.stakeScriptHash).toBe(standard.stake.hash);
    expect(base.threshold).toBe(2);
    expect(Object.keys(base.roles).sort()).toEqual(['backupHolders', 'delegates', 'external', 'guardians', 'owners', 'viewers']);
    const decoded = cborgDecode(b(encodeManifest(base)), { useMaps: false }) as P;
    const names = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object' && !(v instanceof Uint8Array)) for (const [k, x] of Object.entries(v)) { names.add(k); walk(x); }
    };
    walk(decoded);
    for (const name of ['index', 'y', 'roleXpubs', 'xpub', 'path']) expect(names.has(name)).toBe(false);
    expect(Object.keys(at(decoded, 'roles')).sort()).toEqual(['backupHolders', 'delegates', 'external', 'guardians', 'owners', 'viewers']);
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
    const preimage = Buffer.from(MANIFEST_HASH_TAG, 'utf8').toString('hex') + cbor;
    expect(decoded.hash).toBe(sdkBlake2b.hash(HexBlob(preimage), 32));
    expect(manifestHash(base)).toBe(decoded.hash);
    expect(decodeManifest(b(cbor)).ok).toBe(true);
  });

  it('matches the provisional vectors', async () => {
    expect(manifestHash(base)).toBe(VECTORS.standard.hash);
    expect(encodeManifest(base).length / 2).toBe(VECTORS.standard.bytes);
    const backup = newManifest({
      vault: backupVault,
      network: 'preprod',
      owners: keys.slice(0, 2).map(vaultKeys => ({ vaultKeys })),
      backupHolders: [{ vaultKeys: keys[2], devices: [await boundDevice(vaultId(backupVault, 'preprod'), 'backupHolder', credentials[2], 3)] }],
      createdAt: CREATED_AT,
    });
    expect(manifestHash(backup)).toBe(VECTORS.backup.hash);
    expect(bindingDigest(base.roles.owners.find(e => e.credential === credentials[0]).devices[0])).toBe(VECTORS.bindingDigest);
  });

  it('has one encoding whatever order the input lists come in', async () => {
    const shuffled = newManifest({
      vault: standard,
      network: 'preprod',
      owners: [
        { vaultKeys: keys[2] },
        { vaultKeys: keys[1], devices: [await boundDevice(id, 'owner', credentials[1], 2, 'Phone')] },
        { vaultKeys: keys[0], devices: [await boundDevice(id, 'owner', credentials[0], 1, 'Laptop')] },
      ],
      viewers: [{ devices: [await boundDevice(id, 'viewer', undefined, 9, 'Accountant')] }],
      createdAt: CREATED_AT,
    });
    expect(encodeManifest(shuffled)).toBe(encodeManifest(base));
  });

  it('refuses a manifest that breaks its rules, with GeroVaultError INVALID_MANIFEST', () => {
    const invalid = (m: unknown) => () => encodeManifest(m as VaultManifest);
    const err = expect.objectContaining({ code: 'INVALID_MANIFEST' });
    expect(invalid({ ...base, threshold: 1 })).toThrow(err);
    expect(invalid({ ...base, threshold: 4 })).toThrow(err);
    expect(invalid({ ...base, version: 2 })).toThrow(err);
    expect(invalid({ ...base, createdAt: CREATED_AT * 1000 })).toThrow(err);
    expect(invalid({ ...base, viewersSeeProposalContents: true })).toThrow(err);
    expect(invalid({ ...base, roles: { ...base.roles, guardians: base.roles.owners.slice(0, 1) } })).toThrow(err);
    expect(invalid({ ...base, roles: { ...base.roles, external: [{ credential: credentials[0], label: 'Twice' }] } })).toThrow(err);
    expect(invalid({ ...base, roles: { ...base.roles, external: [{ credential: credentials[0].slice(2), label: 'Short' }] } })).toThrow(err);
    expect(invalid(undefined)).toThrow(err);
  });

  it('builds only from a vault template on a known network', () => {
    expect(() => newManifest({ vault: { payment: undefined, stake: undefined }, network: 'preprod', owners: [], createdAt: 1 }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_TEMPLATE' }));
    // @ts-expect-error: not a vault network.
    expect(() => newManifest({ vault: standard, network: 'sanchonet', owners: [], createdAt: 1 }))
      .toThrow(expect.objectContaining({ code: 'UNKNOWN_NETWORK' }));
  });
});

describe('device bindings', () => {
  it('derives the device id as gero-xdev does and digests the binding without its attestation', async () => {
    const device = await testDevice(1);
    const body = deviceBinding({ vaultId: id, role: 'owner', credential: credentials[0], ...device, label: 'Laptop' });
    expect(body.deviceId).toBe(deviceIdFromPubKey(device.ed25519Pub));
    expect(deviceIdOf(device.ed25519Pub)).toBe(body.deviceId);
    expect(body.bindingVersion).toBe(1);
    const cbor = deviceBindingCbor(body);
    const plain = plainBinding(body as OwnerDeviceBinding);
    delete plain['attestation'];
    expect(cbor).toBe(hexOf(cborgEncode(plain)));
    expect(bindingDigest(body)).toBe(sdkBlake2b.hash(HexBlob(cbor), 32));
    const attested: OwnerDeviceBinding = { ...body, attestation: { method: 'expiredTx', proof: 'abcd' } };
    expect(bindingDigest(attested)).toBe(bindingDigest(body));
    expect(deviceBindingCbor(attested)).toBe(cbor);
  });

  it('writes an empty credential for a viewer', async () => {
    const viewer = deviceBinding({ vaultId: id, role: 'viewer', ...(await testDevice(9)), label: 'Accountant' });
    expect(viewer.credential).toBeUndefined();
    expect(deviceBindingCbor(viewer)).toContain('6a63726564656e7469616c40');
  });

  it('refuses a bad binding with GeroVaultError INVALID_DEVICE_BINDING', async () => {
    const device = await testDevice(1);
    const ok = { vaultId: id, role: 'owner' as const, credential: credentials[0], ...device, label: 'Laptop' };
    const err = expect.objectContaining({ code: 'INVALID_DEVICE_BINDING' });
    for (const bad of [
      { ...ok, ed25519Pub: device.ed25519Pub.slice(2) },
      { ...ok, ed25519Pub: device.ed25519Pub.toUpperCase() },
      { ...ok, x25519Pub: device.ed25519Pub },
      { ...ok, credential: undefined },
      { ...ok, role: 'viewer' as const },
      { ...ok, role: 'admin' },
      { ...ok, vaultId: id.slice(2) },
      { ...ok, label: '' },
      { ...ok, label: 'a|b' },
      { ...ok, label: 'x'.repeat(65) },
      { ...ok, bindingVersion: 0 },
    ]) {
      expect(() => deviceBinding(bad as typeof ok)).toThrow(err);
    }
    expect(() => deviceIdOf('00')).toThrow(err);
  });
});

describe('revisions', () => {
  it('links the next revision to the previous one by hash and version', async () => {
    const owner3 = base.roles.owners.find(e => e.credential === credentials[2]);
    const device = await boundDevice(id, 'owner', credentials[2], 3, 'Ledger');
    const v2 = nextManifestRevision(base, {
      roles: { owners: base.roles.owners.map(e => (e === owner3 ? { ...e, devices: [device] } : e)) },
      createdAt: CREATED_AT + 60,
    });
    expect(v2.version).toBe(2);
    expect(v2.prevManifestHash).toBe(manifestHash(base));
    expect(checkManifestRevision(base, v2)).toEqual({ ok: true });
    const decoded = decodeManifest(encodeManifest(v2));
    expect(decoded.ok === true && decoded.manifest).toEqual(v2);
    expect(isManifestFork(base, v2)).toBe(false);

    const sibling = nextManifestRevision(base, { roles: { viewers: [] }, createdAt: CREATED_AT + 60 });
    expect(isManifestFork(v2, sibling)).toBe(true);
    expect(isManifestFork(v2, v2)).toBe(false);

    expect(checkManifestRevision(base, { ...v2, prevManifestHash: '00'.repeat(32) })).toEqual({ ok: false, code: 'PREV_HASH_MISMATCH' });
    expect(checkManifestRevision(base, { ...v2, version: 3 })).toEqual({ ok: false, code: 'VERSION_NOT_NEXT' });
    expect(checkManifestRevision(v2, base)).toEqual({ ok: false, code: 'VERSION_NOT_NEXT' });
    expect(checkManifestRevision(base, { ...v2, network: 'preview' })).toEqual({ ok: false, code: 'OTHER_VAULT' });
    expect(checkManifestRevision(base, { ...v2, threshold: 3 })).toEqual({ ok: false, code: 'OTHER_VAULT' });
    expect(checkManifestRevision(base, { ...v2, roles: { ...v2.roles, owners: v2.roles.owners.slice(0, 2) } }))
      .toEqual({ ok: false, code: 'PARTICIPANTS_CHANGED' });
    expect(checkManifestRevision(base, { ...v2, threshold: 0 })).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(() => nextManifestRevision(base, { roles: { owners: base.roles.owners.slice(0, 2) }, createdAt: CREATED_AT }))
      .toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
  });
});

describe('decoding untrusted manifests', () => {
  const refusal = (input: unknown) => {
    const r = decodeManifest(input as string);
    return r.ok === false ? r.code : 'ok';
  };

  it('accepts the canonical encoding of the model it was built from', () => {
    expect(refusal(encodePlain(plainOf(base)))).toBe('ok');
  });

  it.each([
    ['UNSUPPORTED_PROTOCOL', (p: P) => { p['protocol'] = 'gero-vault/v2'; }],
    ['UNKNOWN_NETWORK', (p: P) => { p['network'] = 'cardano-sanchonet'; }],
    ['UNKNOWN_NETWORK', (p: P) => { p['network'] = 'preprod'; }],
    ['SCHEMA_INVALID', (p: P) => { p['extra'] = 1; }],
    ['SCHEMA_INVALID', (p: P) => { delete p['createdAt']; }],
    ['SCHEMA_INVALID', (p: P) => { p['vaultId'] = id; }],
    ['SCHEMA_INVALID', (p: P) => { p['threshold'] = -2; }],
    ['FIELD_INVALID', (p: P) => { p['vaultId'] = b(id).slice(1); }],
    ['FIELD_INVALID', (p: P) => { p['stakeScriptHash'] = p['scriptHash']; }],
    ['FIELD_INVALID', (p: P) => { p['createdAt'] = CREATED_AT * 1000; }],
    ['THRESHOLD_INVALID', (p: P) => { p['threshold'] = 1; }],
    ['THRESHOLD_INVALID', (p: P) => { p['threshold'] = 4; }],
    ['VERSION_INVALID', (p: P) => { p['version'] = 0; }],
    ['VERSION_INVALID', (p: P) => { p['prevManifestHash'] = new Uint8Array(32); }],
    ['VERSION_INVALID', (p: P) => { p['version'] = 2; }],
    ['FIELD_INVALID', (p: P) => { p['prevManifestHash'] = new Uint8Array(31); }],
    ['NOT_IN_PHASE_1', (p: P) => { p['viewersSeeProposalContents'] = 1; }],
    ['SCHEMA_INVALID', (p: P) => { p['viewersSeeProposalContents'] = 2; }],
    ['NOT_IN_PHASE_1', (p: P) => { p['policiesDisplay'] = { whitelist: 1 }; }],
    ['NOT_IN_PHASE_1', (p: P) => { list(p, 'roles', 'guardians').push(list(p, 'roles', 'owners')[0]); }],
    ['NOT_IN_PHASE_1', (p: P) => { list(p, 'roles', 'delegates').push(list(p, 'roles', 'owners')[0]); }],
    ['SCHEMA_INVALID', (p: P) => { delete at(p, 'roles')['external']; }],
    ['CREDENTIAL_MISMATCH', (p: P) => { ownerOf(p, 2)['credential'] = new Uint8Array(28).fill(7); }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 2), 'vaultKeys')['stake'] = at(ownerOf(p, 2), 'vaultKeys')['payment']; }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 2), 'vaultKeys')['stake'] = new Uint8Array(64); }],
    ['SCHEMA_INVALID', (p: P) => { ownerOf(p, 2)['vaultKeys'] = { payment: new Uint8Array(32) }; }],
    ['DUPLICATE_PARTICIPANT', (p: P) => { list(p, 'roles', 'external').push({ credential: ownerOf(p, 0)['credential'], label: 'Again' }); }],
    ['DUPLICATE_PARTICIPANT', (p: P) => { const o = list(p, 'roles', 'owners'); o.splice(1, 0, o[0]); }],
    ['LABEL_INVALID', (p: P) => { list(p, 'roles', 'external').push({ credential: new Uint8Array(28).fill(255), label: 'Bob|Alice' }); }],
    ['LABEL_INVALID', (p: P) => { list(p, 'roles', 'external').push({ credential: new Uint8Array(28).fill(255), label: 'evil‮gpj.exe' }); }],
    ['LABEL_INVALID', (p: P) => { list(p, 'roles', 'external').push({ credential: new Uint8Array(28).fill(255), label: 'line\nbreak' }); }],
    ['LABEL_INVALID', (p: P) => { list(p, 'roles', 'external').push({ credential: new Uint8Array(28).fill(255), label: '' }); }],
    ['LABEL_INVALID', (p: P) => { list(p, 'roles', 'external').push({ credential: new Uint8Array(28).fill(255), label: 'é'.repeat(33) }); }],
    ['BINDING_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['role'] = 'backupHolder'; }],
    ['BINDING_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['vaultId'] = new Uint8Array(32); }],
    ['BINDING_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['credential'] = ownerOf(p, 1)['credential']; }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['role'] = 'admin'; }],
    ['DEVICE_ID_MISMATCH', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['deviceId'] = new Uint8Array(16); }],
    ['FIELD_INVALID', (p: P) => {
      const d = at(ownerOf(p, 0), 'devices', 0);
      d['x25519Pub'] = d['ed25519Pub'];
    }],
    ['FIELD_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['bindingVersion'] = 0; }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['attestation'] = {}; }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['method'] = 'sms'; }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['proof'] = new Uint8Array(0); }],
    ['ATTESTATION_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0, 'attestation')['proof'] = new Uint8Array(2049); }],
    ['SCHEMA_INVALID', (p: P) => { at(ownerOf(p, 0), 'devices', 0)['attestation'] = { method: 'cip8' }; }],
    ['ATTESTATION_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0, 'devices', 0)['attestation'] = { method: 'cip8', proof: new Uint8Array(4) }; }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['credential'] = new Uint8Array(28); }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['vaultKeys'] = { payment: new Uint8Array(32), stake: new Uint8Array(32) }; }],
    ['FIELD_INVALID', (p: P) => { at(p, 'roles', 'viewers', 0)['devices'] = []; }],
    ['DUPLICATE_DEVICE', (p: P) => {
      const d = structuredClone(at(ownerOf(p, 0), 'devices', 0));
      d['credential'] = ownerOf(p, 2)['credential'];
      list(ownerOf(p, 2), 'devices').push(d);
    }],
    ['DUPLICATE_DEVICE', (p: P) => {
      at(ownerOf(p, 1), 'devices', 0)['x25519Pub'] = at(ownerOf(p, 0), 'devices', 0)['x25519Pub'];
    }],
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
    const p = plainOf(base);
    const reversed = Object.fromEntries(Object.entries(p).reverse());
    expect(refusal(hexOf(cborgEncode(reversed, { mapSorter: () => 0 })))).toBe('NOT_CANONICAL');
  });

  it('refuses malformed CBOR and wrong input shapes', () => {
    const cbor = encodeManifest(base);
    expect(refusal(cbor + '00')).toBe('MALFORMED_CBOR');
    expect(refusal(cbor.slice(0, -2))).toBe('MALFORMED_CBOR');
    expect(refusal('bf' + cbor.slice(2) + 'ff')).toBe('MALFORMED_CBOR');
    expect(refusal('c0' + cbor)).toBe('MALFORMED_CBOR');
    expect(refusal('f5')).toBe('MALFORMED_CBOR');
    expect(refusal('fb3ff8000000000000')).toBe('MALFORMED_CBOR');
    expect(refusal('b8' + cbor.slice(1, 2).padStart(2, '0') + cbor.slice(2))).toBe('MALFORMED_CBOR');
    expect(refusal('a2616101616101')).toBe('MALFORMED_CBOR');
    expect(refusal('81'.repeat(20) + '00')).toBe('MALFORMED_CBOR');
    expect(refusal('a0')).toBe('SCHEMA_INVALID');
    expect(refusal('80')).toBe('SCHEMA_INVALID');
    expect(refusal('zz')).toBe('MALFORMED_INPUT');
    expect(refusal('abc')).toBe('MALFORMED_INPUT');
    expect(refusal(42)).toBe('MALFORMED_INPUT');
    expect(refusal(undefined)).toBe('MALFORMED_INPUT');
    expect(refusal('00'.repeat(262145))).toBe('TOO_LARGE');
    expect(refusal(new Uint8Array(262145))).toBe('TOO_LARGE');
  });

  it('never throws on mutated or random bytes', () => {
    const valid = b(encodeManifest(base));
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    for (let round = 0; round < 500; round++) {
      const bytes = round % 5 === 0 ? Uint8Array.from({ length: rand() % 300 }, () => rand() & 0xff) : Uint8Array.from(valid);
      if (round % 5 !== 0) for (let k = 0; k <= round % 4; k++) bytes[rand() % bytes.length] = rand() & 0xff;
      const r = decodeManifest(bytes);
      if (r.ok === true) expect(r.cbor).toBe(hexOf(bytes));
    }
  });
});
