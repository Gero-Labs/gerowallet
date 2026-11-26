/**
 * Test-only participants and devices for the manifest specs. Nothing here is a real wallet or a
 * real device: the account keys are the published cardano-addresses key and keys generated from
 * fixed test entropy (`vectors.ts`), device keys come from fixed labels, and an attestation is
 * placeholder bytes (attestations are verified by GV-22, not by the manifest codec).
 */
import { Ed25519KeyHashHex, Ed25519PrivateKey, ready } from '@cardano-sdk/crypto';
import { blake2b } from '@noble/hashes/blake2.js';
import { deriveRoleKeys, deriveVaultPublicKeys, vaultKeyHashes } from '../keys';
import {
  DeviceBindingBody,
  ManifestRole,
  OwnerAttestation,
  OwnerDeviceBinding,
  VaultManifest,
  deviceBinding,
  newManifest,
} from '../manifest';
import { buildVaultFromParticipants } from '../scripts';
import { RoleKeys, VaultPublicKeys, VaultScripts } from '../types';
import { vaultId } from '../vaultId';
import { publishedAccountKey, testCosignerAccount } from './vectors';

const utf8 = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** Role keys of four test participants: the published key and test cosigners 1, 2 and 3. */
export async function testPeople(): Promise<RoleKeys[]> {
  const accounts = await Promise.all([publishedAccountKey(), testCosignerAccount(1), testCosignerAccount(2), testCosignerAccount(3)]);
  return Promise.all(accounts.map(deriveRoleKeys));
}

export async function vaultKeysAt(people: readonly RoleKeys[], indexes: readonly number[]): Promise<VaultPublicKeys[]> {
  return Promise.all(people.map((p, i) => deriveVaultPublicKeys(p, indexes[i])));
}

/** A test device: an Ed25519 key from a fixed seed, and an unrelated fixed X25519 value. */
export async function testDevice(n: number): Promise<{ ed25519Pub: string; x25519Pub: string }> {
  await ready();
  const seed = blake2b(utf8(`gerovault test device ${n} ed25519`), { dkLen: 32 });
  return {
    ed25519Pub: Ed25519PrivateKey.fromNormalBytes(seed).toPublic().hex(),
    x25519Pub: hex(blake2b(utf8(`gerovault test device ${n} x25519`), { dkLen: 32 })),
  };
}

/** Placeholder attestation bytes: not a signature. */
export function placeholderAttestation(n: number): OwnerAttestation {
  return { method: 'cip8', proof: hex(utf8(`placeholder attestation ${n}`)) };
}

export const VECTOR_CREATED_AT = 1795651200;

/**
 * The vector manifest of the manifest and safety code specs: owners the published key and test
 * cosigners 1 and 2, all at vault index 1, 2 of 3, preprod. Owner 1 has test device 1 ("Laptop"),
 * owner 2 test device 2 ("Phone"), owner 3 no device yet; one viewer with test device 9
 * ("Accountant").
 */
export async function vectorFixture(): Promise<{
  people: RoleKeys[];
  keys: VaultPublicKeys[];
  credentials: Ed25519KeyHashHex[];
  vault: VaultScripts;
  id: string;
  manifest: VaultManifest;
}> {
  const people = await testPeople();
  const keys = await vaultKeysAt(people.slice(0, 3), [1, 1, 1]);
  const credentials = await Promise.all(keys.map(async k => (await vaultKeyHashes(k)).payment));
  const vault = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: keys.map(vaultKeys => ({ vaultKeys })) });
  const id = vaultId(vault, 'preprod');
  const manifest = newManifest({
    vault,
    network: 'preprod',
    owners: [
      { vaultKeys: keys[0], devices: [await boundDevice(id, 'owner', credentials[0], 1, 'Laptop')] },
      { vaultKeys: keys[1], devices: [await boundDevice(id, 'owner', credentials[1], 2, 'Phone')] },
      { vaultKeys: keys[2] },
    ],
    viewers: [{ devices: [await boundDevice(id, 'viewer', undefined, 9, 'Accountant')] }],
    createdAt: VECTOR_CREATED_AT,
  });
  return { people, keys, credentials, vault, id, manifest };
}

/** A bound device of a participant, attested with placeholder bytes (none for a viewer). */
export async function boundDevice(
  vaultId: string,
  role: ManifestRole,
  credential: string | undefined,
  n: number,
  label = `Device ${n}`,
): Promise<OwnerDeviceBinding> {
  const keys = await testDevice(n);
  const body: DeviceBindingBody = deviceBinding({
    vaultId,
    role,
    ...(credential ? { credential: credential as DeviceBindingBody['credential'] } : {}),
    ...keys,
    label,
  });
  return role === 'viewer' ? body : { ...body, attestation: placeholderAttestation(n) };
}
