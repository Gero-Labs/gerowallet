/**
 * Test-only participants, devices and signatures for the manifest specs. Nothing here is a real
 * wallet or a real device: the account keys are the published cardano-addresses key and keys
 * generated from fixed test entropy (`vectors.ts`), and device keys come from fixed labels.
 * CIP-8 attestations go through the wallet's own CIP-30 `signData` builder (`converter.ts`).
 */
import { Cardano } from '@cardano-sdk/core';
import { Bip32PrivateKey, Ed25519KeyHashHex, Ed25519PrivateKey, Hash28ByteBase16, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { blake2b } from '@noble/hashes/blake2.js';
import { buildSignatureAndCoseKey } from '../../utils/converter';
import { ATTESTATION_METHOD, AttestedDigest, OwnerAttestation, assembleExpiredTx, canonicalAttestation, cip8Proof, expiredTxBodyHash } from '../attestation';
import { deriveRoleKeys, deriveVaultPublicKeys, multisigAccountPublicKey, vaultKeyHashes } from '../keys';
import {
  ExternalEntry,
  ExternalRole,
  ManifestRole,
  OwnerDeviceBinding,
  VaultManifest,
  bindingDeviceDigest,
  bindingDigest,
  deviceBinding,
  deviceIdOf,
  externalEntry,
  externalImportDigest,
  newManifest,
  viewerAdmissionDigest,
} from '../manifest';
import { buildVaultFromParticipants } from '../scripts';
import { RoleKeys, VaultPublicKeys, VaultScripts } from '../types';
import { vaultId } from '../vaultId';
import { CARDANO_ADDRESSES, bech32Bytes } from './vectors';

const HARDENED = 0x80000000;
const utf8 = (text: string) => new TextEncoder().encode(text);
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/** The private multisig account keys (`m/1854'/1815'/0'`) of four test participants. */
export async function testAccounts(): Promise<Bip32PrivateKey[]> {
  await ready();
  const cosigner = (seed: number) => Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, seed), '').derive([HARDENED + 1854, HARDENED + 1815, HARDENED]);
  return [Bip32PrivateKey.fromBytes(bech32Bytes(CARDANO_ADDRESSES.acctXsk)), cosigner(1), cosigner(2), cosigner(3)];
}

/** Role keys of the four test participants: the published key and test cosigners 1, 2 and 3. */
export async function testPeople(): Promise<RoleKeys[]> {
  const accounts = await testAccounts();
  return Promise.all(accounts.map(a => deriveRoleKeys(multisigAccountPublicKey(a.toPublic().hex()))));
}

export async function vaultKeysAt(people: readonly RoleKeys[], indexes: readonly number[]): Promise<VaultPublicKeys[]> {
  return Promise.all(people.map((p, i) => deriveVaultPublicKeys(p, indexes[i])));
}

/** A participant with the private vault payment key that signs their attestations. */
export interface TestParticipant {
  readonly roleKeys: RoleKeys;
  readonly index: number;
  readonly vaultKeys: VaultPublicKeys;
  readonly credential: Ed25519KeyHashHex;
  readonly signer: Ed25519PrivateKey;
}

export async function testParticipants(indexes: readonly number[] = [1, 1, 1, 1]): Promise<TestParticipant[]> {
  const accounts = await testAccounts();
  return Promise.all(accounts.map(async (account, i) => {
    const roleKeys = await deriveRoleKeys(multisigAccountPublicKey(account.toPublic().hex()));
    const vaultKeys = await deriveVaultPublicKeys(roleKeys, indexes[i]);
    const signer = account.derive([0, indexes[i]]).toRawKey();
    if (signer.toPublic().hex() !== vaultKeys.payment) throw new Error('fixture: the signer is not the vault payment key');
    return { roleKeys, index: indexes[i], vaultKeys, credential: (await vaultKeyHashes(vaultKeys)).payment, signer };
  }));
}

/** A test device: an Ed25519 key from a fixed seed, and an unrelated fixed X25519 value. */
export async function testDevice(n: number): Promise<{ ed25519Pub: string; x25519Pub: string; key: Ed25519PrivateKey }> {
  await ready();
  const key = Ed25519PrivateKey.fromNormalBytes(blake2b(utf8(`gerovault test device ${n} ed25519`), { dkLen: 32 }));
  const x = blake2b(utf8(`gerovault test device ${n} x25519`), { dkLen: 32 });
  x[31] &= 0x7f;
  return { ed25519Pub: key.toPublic().hex(), x25519Pub: hex(x), key };
}

/** A CIP-8 attestation of `digest` by `signer` as the wallet's own `signData` builder returns it. */
export function walletCip8Attestation(signer: Ed25519PrivateKey, credential: string, digest: string): OwnerAttestation {
  const address = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
    type: Cardano.CredentialType.KeyHash,
    hash: Hash28ByteBase16(credential),
  }).toAddress().toBytes();
  const { signature, key } = buildSignatureAndCoseKey(Uint8Array.from(Buffer.from(address, 'hex')), digest, signer);
  return { method: ATTESTATION_METHOD.CIP8, proof: cip8Proof(signature, key) };
}

/** The same, in the canonical stored form a manifest carries. */
export function cip8Attestation(signer: Ed25519PrivateKey, credential: string, digest: string): OwnerAttestation {
  const canonical = canonicalAttestation(walletCip8Attestation(signer, credential, digest));
  if (canonical.ok === false) throw new Error(`fixture: ${canonical.code}`);
  return canonical.attestation;
}

/** An expired-transaction attestation of `subject` by `signer`. */
export function expiredTxAttestation(signer: Ed25519PrivateKey, credential: string, subject: AttestedDigest): OwnerAttestation {
  const signature = signer.sign(HexBlob(expiredTxBodyHash(credential, subject))).hex();
  return { method: ATTESTATION_METHOD.EXPIRED_TX, proof: assembleExpiredTx(credential, subject, signer.toPublic().hex(), signature) };
}

/**
 * A bound device, signed by the device and attested by the participant. A viewer's binding is
 * admitted by the owner device `admitter` instead.
 */
export async function signedBinding(input: {
  readonly vaultId: string;
  readonly role: ManifestRole;
  readonly participant?: TestParticipant;
  readonly device: number;
  readonly label?: string;
  readonly method?: 'cip8' | 'expiredTx';
  readonly admitter?: number;
  readonly bindingVersion?: number;
  readonly x25519Pub?: string;
}): Promise<OwnerDeviceBinding> {
  const device = await testDevice(input.device);
  const body = deviceBinding({
    vaultId: input.vaultId,
    role: input.role,
    ...(input.participant ? { vaultKeys: input.participant.vaultKeys } : {}),
    ed25519Pub: device.ed25519Pub,
    x25519Pub: input.x25519Pub ?? device.x25519Pub,
    label: input.label ?? `Device ${input.device}`,
    ...(input.bindingVersion ? { bindingVersion: input.bindingVersion } : {}),
  });
  const deviceSig = device.key.sign(HexBlob(bindingDeviceDigest(body))).hex();
  if (input.role === 'viewer') {
    const admitter = await testDevice(input.admitter ?? 1);
    const signature = admitter.key.sign(HexBlob(viewerAdmissionDigest(body))).hex();
    return { ...body, deviceSig, admittedBy: { deviceId: deviceIdOf(admitter.ed25519Pub), signature } };
  }
  const { signer, credential } = input.participant;
  const digest = bindingDigest(body);
  const attestation = input.method === 'expiredTx'
    ? expiredTxAttestation(signer, credential, { kind: 'binding', digest })
    : cip8Attestation(signer, credential, digest);
  return { ...body, deviceSig, attestation };
}

/** An external entry for `participant`'s keys, imported and signed by the owner device `importer`. */
export async function signedExternal(input: {
  readonly vaultId: string;
  readonly participant: TestParticipant;
  readonly importer: number;
  readonly role?: ExternalRole;
  readonly label?: string;
}): Promise<ExternalEntry> {
  const device = await testDevice(input.importer);
  const body = externalEntry({
    vaultKeys: input.participant.vaultKeys,
    label: input.label ?? 'Other wallet',
    role: input.role ?? 'owner',
    importerDeviceId: deviceIdOf(device.ed25519Pub),
  });
  return { ...body, importSig: device.key.sign(HexBlob(externalImportDigest(input.vaultId, body))).hex() };
}

export const VECTOR_REVISED_AT = 1795651200;

/**
 * The vector manifest of the specs: owners the published key and test cosigners 1 and 2, all at
 * vault index 1, 2 of 3, preprod. Owner 1 has test device 1 ("Laptop", CIP-8 attestation), owner 2
 * test device 2 ("Phone", expired-transaction attestation), owner 3 no device yet; one viewer with
 * test device 9 ("Accountant"), admitted by test device 1.
 */
export async function vectorFixture(): Promise<{
  people: TestParticipant[];
  vault: VaultScripts;
  id: string;
  manifest: VaultManifest;
}> {
  const people = await testParticipants();
  const vault = await buildVaultFromParticipants({
    template: { kind: 'standard', threshold: 2 },
    owners: people.slice(0, 3).map(p => ({ vaultKeys: p.vaultKeys })),
  });
  const id = vaultId(vault, 'preprod');
  const manifest = newManifest({
    vault,
    network: 'preprod',
    owners: [
      { vaultKeys: people[0].vaultKeys, devices: [await signedBinding({ vaultId: id, role: 'owner', participant: people[0], device: 1, label: 'Laptop' })] },
      {
        vaultKeys: people[1].vaultKeys,
        devices: [await signedBinding({ vaultId: id, role: 'owner', participant: people[1], device: 2, label: 'Phone', method: 'expiredTx' })],
      },
      { vaultKeys: people[2].vaultKeys },
    ],
    viewers: [{ devices: [await signedBinding({ vaultId: id, role: 'viewer', device: 9, label: 'Accountant', admitter: 1 })] }],
    revisedAt: VECTOR_REVISED_AT,
  });
  return { people, vault, id, manifest };
}
