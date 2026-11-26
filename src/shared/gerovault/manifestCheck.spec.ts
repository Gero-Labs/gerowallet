import { beforeAll, describe, expect, it } from 'vitest';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import { encodeVaultPublicKeys, parseVaultPublicKeys, vaultKeyHashes } from './keys';
import { VaultManifest, deviceBinding, newManifest } from './manifest';
import { ManifestAckInput, OwnParticipant, checkManifestBeforeAck } from './manifestCheck';
import { decodeRegistration, dedupeRegistrations, encodeRegistration } from './registration';
import { buildVaultFromParticipants } from './scripts';
import { RoleKeys, VaultPublicKeys, VaultScripts } from './types';
import { vaultId } from './vaultId';
import { boundDevice, placeholderAttestation, testDevice, testPeople, vaultKeysAt } from './__fixtures__/manifest';

const CREATED_AT = 1795651200;

let people: RoleKeys[];
let keys: VaultPublicKeys[];
let cred: Ed25519KeyHashHex[];
let standard: VaultScripts;
let backupVault: VaultScripts;
let id: string;

const credentialOf = async (k: VaultPublicKeys) => (await vaultKeyHashes(k)).payment;
const owner = (i: number, index = 1): OwnParticipant => ({ kind: 'participant', roleKeys: people[i], index });

function manifestOf(vault: VaultScripts, owners: readonly VaultPublicKeys[], extra: Partial<Parameters<typeof newManifest>[0]> = {}): VaultManifest {
  return newManifest({ vault, network: 'preprod', owners: owners.map(vaultKeys => ({ vaultKeys })), createdAt: CREATED_AT, ...extra });
}

function check(manifest: VaultManifest, own: OwnParticipant, rest: Partial<ManifestAckInput> = {}) {
  return checkManifestBeforeAck({ manifest, scripts: standard, network: 'preprod', own, ...rest });
}

beforeAll(async () => {
  people = await testPeople();
  keys = await vaultKeysAt(people, [1, 1, 1, 1]);
  cred = await Promise.all(keys.map(credentialOf));
  standard = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: keys.slice(0, 3).map(vaultKeys => ({ vaultKeys })) });
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 },
    owners: keys.slice(0, 2).map(vaultKeys => ({ vaultKeys })),
    backups: [{ vaultKeys: keys[2] }],
  });
  id = vaultId(standard, 'preprod');
});

describe('checks before acknowledging a manifest', () => {
  it('accepts an honest manifest on every participant\'s device', async () => {
    const manifest = manifestOf(standard, keys.slice(0, 3));
    for (let i = 0; i < 3; i++) {
      expect(await check(manifest, owner(i)))
        .toEqual({ ok: true, vaultId: id, template: { kind: 'standard', threshold: 2 }, ownRole: 'owner', ownCredential: cred[i] });
    }
  });

  it('refuses a vault key that does not hash to the script\'s key hash', async () => {
    // A relay or creator swaps the third owner's keys for its own: the manifest is well formed,
    // but its keys are not the scripts' keys.
    const swapped = manifestOf(standard, [keys[0], keys[1], keys[3]]);
    expect(await check(swapped, owner(0))).toEqual({ ok: false, code: 'KEY_NOT_IN_SCRIPT', credential: cred[3] });
    // Only the stake key swapped.
    const mixed = parseVaultPublicKeys({ payment: encodeVaultPublicKeys(keys[2]).payment, stake: encodeVaultPublicKeys(keys[3]).stake });
    expect(await check(manifestOf(standard, [keys[0], keys[1], mixed]), owner(0))).toEqual({ ok: false, code: 'KEY_NOT_IN_SCRIPT', credential: cred[2] });
  });

  it('refuses a manifest that leaves out or adds a participant', async () => {
    expect(await check(manifestOf(standard, keys.slice(0, 2)), owner(0))).toEqual({ ok: false, code: 'SCRIPT_KEY_UNACCOUNTED' });
    expect(await check(manifestOf(standard, keys), owner(0))).toEqual({ ok: false, code: 'KEY_NOT_IN_SCRIPT', credential: cred[3] });
  });

  it('checks the device\'s own entry against the keys it derives at its own index', async () => {
    const manifest = manifestOf(standard, keys.slice(0, 3));
    expect(await check(manifest, owner(3))).toEqual({ ok: false, code: 'OWN_ENTRY_MISSING', credential: cred[3] });
    expect(await check(manifest, owner(0, 2))).toMatchObject({ ok: false, code: 'OWN_ENTRY_MISSING' });
    const ownStakeSwapped = parseVaultPublicKeys({ payment: encodeVaultPublicKeys(keys[0]).payment, stake: encodeVaultPublicKeys(keys[3]).stake });
    expect(await check(manifestOf(standard, [ownStakeSwapped, keys[1], keys[2]]), owner(0)))
      .toEqual({ ok: false, code: 'OWN_KEYS_MISMATCH', credential: cred[0] });
    expect(await check(manifest, { ...owner(0), role: 'backupHolder' } as OwnParticipant)).toEqual({ ok: false, code: 'OWN_ROLE_MISMATCH', credential: cred[0] });
    expect(await check(manifest, { kind: 'participant', roleKeys: people[0], index: -1 })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });

  it('checks the device\'s own binding when it expects one', async () => {
    const device = await testDevice(1);
    const honest = manifestOf(standard, keys.slice(0, 3), {
      owners: [{ vaultKeys: keys[0], devices: [await boundDevice(id, 'owner', cred[0], 1)] }, { vaultKeys: keys[1] }, { vaultKeys: keys[2] }],
    });
    expect(await check(honest, { ...owner(0), device } as OwnParticipant)).toMatchObject({ ok: true });
    // The relay swaps the device's key agreement key for its own.
    const relayKey = (await testDevice(7)).x25519Pub;
    const body = deviceBinding({ vaultId: id, role: 'owner', credential: cred[0], ed25519Pub: device.ed25519Pub, x25519Pub: relayKey, label: 'Device 1' });
    const swapped = manifestOf(standard, keys.slice(0, 3), {
      owners: [{ vaultKeys: keys[0], devices: [{ ...body, attestation: placeholderAttestation(1) }] }, { vaultKeys: keys[1] }, { vaultKeys: keys[2] }],
    });
    expect(await check(swapped, { ...owner(0), device } as OwnParticipant)).toEqual({ ok: false, code: 'OWN_DEVICE_MISMATCH', credential: cred[0] });
  });

  it('lets a viewer check its own binding', async () => {
    const manifest = manifestOf(standard, keys.slice(0, 3), { viewers: [{ devices: [await boundDevice(id, 'viewer', undefined, 9)] }] });
    const viewer = await check(manifest, { kind: 'viewer', device: await testDevice(9) });
    expect(viewer).toMatchObject({ ok: true, ownRole: 'viewer' });
    expect(viewer.ok === true && 'ownCredential' in viewer).toBe(false);
    expect(await check(manifest, { kind: 'viewer', device: await testDevice(8) })).toEqual({ ok: false, code: 'OWN_DEVICE_MISMATCH' });
  });

  it('gives one vault id whatever indexes the participants used, and carries none', async () => {
    const indexes = [21, 1, 3];
    const mixedKeys = await vaultKeysAt(people.slice(0, 3), indexes);
    const fromRoleKeys = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: people.slice(0, 3).map((roleKeys, i) => ({ roleKeys, index: indexes[i] })),
    });
    const fromVaultKeys = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: mixedKeys.map(vaultKeys => ({ vaultKeys })) });
    const manifest = manifestOf(fromRoleKeys, mixedKeys);
    expect(manifest.vaultId).toBe(vaultId(fromVaultKeys, 'preprod'));
    for (let i = 0; i < 3; i++) {
      expect(await check(manifest, owner(i, indexes[i]), { scripts: fromVaultKeys })).toMatchObject({ ok: true, vaultId: manifest.vaultId });
    }
    expect(await check(manifest, owner(0, 1), { scripts: fromVaultKeys })).toMatchObject({ ok: false, code: 'OWN_ENTRY_MISSING' });
  });

  it('refuses a manifest for other scripts, another network, another id or another threshold', async () => {
    const manifest = manifestOf(standard, keys.slice(0, 3));
    expect(await check(manifest, owner(0), { network: 'preview' })).toEqual({ ok: false, code: 'NETWORK_MISMATCH' });
    expect(await check(manifest, owner(0), { scripts: backupVault })).toEqual({ ok: false, code: 'SCRIPT_HASH_MISMATCH' });
    expect(await check({ ...manifest, vaultId: vaultId(standard, 'preview') }, owner(0))).toEqual({ ok: false, code: 'VAULT_ID_MISMATCH' });
    expect(await check({ ...manifest, threshold: 3 }, owner(0))).toEqual({ ok: false, code: 'THRESHOLD_MISMATCH' });
  });

  it('never makes a second vault from a duplicate registration of an accepted vault\'s scripts', async () => {
    const first = encodeRegistration(standard, { name: 'Treasury' });
    const second = encodeRegistration(standard, { name: 'Published again by someone else' });
    const decoded = [first, second].map(e => decodeRegistration({ metadata: { cbor: e.offChain.metadata }, nativeScripts: { cbor: e.offChain.native_scripts } }));
    const [a, b] = decoded.map(d => (d.ok === true ? d.registration : undefined));
    expect(dedupeRegistrations([a, b])).toEqual([a]);
    const fromSecond = { payment: b.payment, stake: b.stake };
    expect(vaultId(fromSecond, 'preprod')).toBe(vaultId({ payment: a.payment, stake: a.stake }, 'preprod'));
    const manifest = manifestOf(standard, keys.slice(0, 3));
    const accepted = { acceptedVaultIds: [vaultId({ payment: a.payment, stake: a.stake }, 'preprod')], scripts: fromSecond };
    expect(await check(manifest, owner(1), accepted)).toEqual({ ok: false, code: 'VAULT_ALREADY_ACCEPTED' });
    // A later revision of the accepted vault is the same vault, not a new one.
    const v2 = { ...manifest, version: 2, prevManifestHash: '11'.repeat(32) };
    expect(await check(v2, owner(1), accepted)).toMatchObject({ ok: true, vaultId: id });
  });

  it('matches each role slot to the participant\'s place in the scripts', async () => {
    const backupId = vaultId(backupVault, 'preprod');
    const honest = manifestOf(backupVault, keys.slice(0, 2), { backupHolders: [{ vaultKeys: keys[2] }] });
    const ok = { scripts: backupVault };
    expect(await check(honest, owner(0), ok)).toMatchObject({ ok: true, vaultId: backupId, ownRole: 'owner', template: { kind: 'backup', backupThreshold: 1 } });
    expect(await check(honest, owner(2), ok)).toMatchObject({ ok: true, ownRole: 'backupHolder' });
    expect(await check(honest, { ...owner(2), role: 'owner' } as OwnParticipant, ok)).toMatchObject({ ok: false, code: 'OWN_ROLE_MISMATCH' });
    // The backup holder listed as an owner.
    const moved = manifestOf(backupVault, keys.slice(0, 3));
    expect(await check(moved, owner(0), ok)).toEqual({ ok: false, code: 'ROLE_MISMATCH', credential: cred[2] });
  });

  it('checks an external cosigner with the keys this device holds for them', async () => {
    const manifest = manifestOf(standard, keys.slice(0, 2), { external: [{ credential: cred[2], label: 'Other wallet' }] });
    expect(await check(manifest, owner(0))).toEqual({ ok: false, code: 'EXTERNAL_KEYS_REQUIRED', credential: cred[2] });
    expect(await check(manifest, owner(0), { externalKeys: { [cred[2]]: { roleKeys: people[2] } } })).toMatchObject({ ok: true });
    expect(await check(manifest, owner(0), { externalKeys: { [cred[2]]: { vaultKeys: keys[2] } } })).toMatchObject({ ok: true });
    expect(await check(manifest, owner(0), { externalKeys: { [cred[2]]: { roleKeys: people[3] } } }))
      .toEqual({ ok: false, code: 'KEY_NOT_IN_SCRIPT', credential: cred[2] });
    const misnamed = manifestOf(standard, keys.slice(0, 2), { external: [{ credential: cred[3], label: 'Other wallet' }] });
    expect(await check(misnamed, owner(0), { externalKeys: { [cred[3]]: { roleKeys: people[2] } } }))
      .toEqual({ ok: false, code: 'EXTERNAL_CREDENTIAL_MISMATCH', credential: cred[3] });
  });

  it('never throws on bad input', async () => {
    const manifest = manifestOf(standard, keys.slice(0, 3));
    expect(await check({ ...manifest, threshold: 0 }, owner(0))).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await checkManifestBeforeAck(undefined)).toEqual({ ok: false, code: 'INVALID_MANIFEST' });
    expect(await check(manifest, undefined)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(manifest, { kind: 'other' } as unknown as OwnParticipant)).toEqual({ ok: false, code: 'INVALID_INPUT' });
    const tampered = { payment: { ...standard.payment, cbor: backupVault.payment.cbor }, stake: standard.stake };
    expect(await check(manifest, owner(0), { scripts: tampered })).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(manifest, owner(0), { scripts: { payment: standard.stake, stake: standard.payment } })).toEqual({ ok: false, code: 'INVALID_INPUT' });
    expect(await check(manifest, owner(0), { scripts: undefined })).toEqual({ ok: false, code: 'INVALID_INPUT' });
  });
});
