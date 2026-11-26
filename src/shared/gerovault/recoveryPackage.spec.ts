// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// A fast stand-in for Argon2id that still depends on the passphrase, the salt and every
// parameter; the real derivation runs in `recoveryVectors.spec.ts`.
vi.mock('@noble/hashes/argon2.js', async () => {
  const { blake2b } = await import('@noble/hashes/blake2.js');
  return {
    argon2idAsync: vi.fn(async (password: Uint8Array, salt: Uint8Array, opts: { m: number; t: number; p: number; dkLen: number; version: number }) => {
      const params = new TextEncoder().encode(`|${opts.m}|${opts.t}|${opts.p}|${opts.version}|`);
      return blake2b(new Uint8Array([...password, ...params, ...salt]), { dkLen: opts.dkLen });
    }),
  };
});

import { argon2idAsync } from '@noble/hashes/argon2.js';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import * as library from './index';
import { deriveRoleKeys, deriveVaultPublicKeys, vaultKeyHashes } from './keys';
import { sealRecoveryFile } from './recoveryFormat';
import {
  MAX_ADDRESS_BOOK_ENTRIES,
  MAX_PROPOSALS,
  ManifestRevision,
  RecoveryPackage,
  RecoveryPackageContents,
  encodeRecoveryPayload,
  manifestRevisionHashOf,
} from './recoveryPayload';
import {
  ATTESTATION_TIMEOUT_MS,
  OwnAttestationQuery,
  OwnAttestationVerifier,
  MAX_CHAIN_REGISTRATIONS,
  MAX_REVEALED_SCRIPTS,
  RecoveryChainFacts,
  RecoveryChainUtxo,
  RestoreResult,
  RestoredNativeCandidate,
  backupPathOpensAtMs,
  exportRecoveryPackage,
  openRecoveryPackage,
  recoveryPackageStaleness,
  restoreVaultFromPackage,
  verifyOwnAttestationInManifests,
} from './recoveryPackage';
import { RegistrationInput, encodeRegistration } from './registration';
import { buildVaultFromParticipants, vaultAddresses } from './scripts';
import { vaultId } from './vaultId';
import { ATTESTATION_METHOD, OwnerAttestation, isCanonicalAttestation, verifyAttestation } from './attestation';
import { VaultManifest, encodeManifest, newManifest, nextManifestRevision, nextRevisionRemovingDevice } from './manifest';
import { ExternalEndorsement, externalEndorsementDigest, verificationDigest } from './verificationNumber';
import {
  TestParticipant,
  VECTOR_REVISED_AT,
  attestationBy,
  expiredTxAttestation,
  removalBy,
  signedBinding,
  signedEndorsement,
  signedExternal,
  vectorFixture,
} from './__fixtures__/manifest';
import { RoleKeys, VaultScripts } from './types';
import { testCosignerAccount } from './__fixtures__/vectors';
import {
  BACKUP_OPENS_AT_MS,
  EXPORTED_AT_MS,
  PLUTUS_VALIDATOR,
  backupContents,
  backupVault,
  externalRoleKeys,
  participantAt,
  plutusContents,
  standardContents,
  standardVault,
  vectorPeople,
} from './__fixtures__/recoveryPackageVectors';

const kdf = vi.mocked(argon2idAsync);
const PASS = 'a passphrase for the restore tests';

let people: RoleKeys[];
let outsider: RoleKeys;
let outsider2: RoleKeys;
let standard: VaultScripts;
let backup: VaultScripts;

/** A registration as a provider serves it: the metadata map and the scripts, CBOR hex. */
function registered(vault: Pick<VaultScripts, 'payment' | 'stake'>): RegistrationInput {
  const reg = encodeRegistration(vault);
  return { metadata: { cbor: reg.offChain.metadata }, nativeScripts: { cbor: reg.offChain.native_scripts } };
}

const onChain = (...vaults: Pick<VaultScripts, 'payment' | 'stake'>[]): RecoveryChainFacts => ({
  network: 'preprod',
  registrations: vaults.map(registered),
});

const nothing: RecoveryChainFacts = { network: 'preprod' };

/** The exporter's role keys for contents built by the fixtures: participant i is people[i]. */
const exporterOf = (contents: RecoveryPackageContents): RoleKeys => people[contents.self.position];

async function opened(contents: RecoveryPackageContents, roleKeys = exporterOf(contents)): Promise<RecoveryPackage> {
  const { file } = await exportRecoveryPackage(contents, PASS, roleKeys);
  const result = await openRecoveryPackage(file, PASS);
  if (result.ok !== true) throw new Error(`${result.code} ${result.detail ?? ''}`);
  return result.package;
}

/** Seals contents without the export's checks, as a hostile or broken writer could. */
async function sealedAnyway(contents: RecoveryPackageContents): Promise<RecoveryPackage> {
  const result = await openRecoveryPackage(await sealRecoveryFile(encodeRecoveryPayload(contents), PASS), PASS);
  if (result.ok !== true) throw new Error(`${result.code} ${result.detail ?? ''}`);
  return result.package;
}

const code = (r: RestoreResult) => (r.ok === true ? 'RESTORED' : r.code);

function candidateOf(r: RestoreResult): RestoredNativeCandidate {
  if (r.ok !== true) throw new Error(`${r.code} ${r.detail ?? ''}`);
  return r.candidate;
}

function deepFreeze<X>(x: X): X {
  if (x && typeof x === 'object' && !ArrayBuffer.isView(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as object)) deepFreeze(v);
  }
  return x;
}

beforeAll(async () => {
  people = await vectorPeople();
  outsider = await deriveRoleKeys(await testCosignerAccount(3));
  outsider2 = await deriveRoleKeys(await testCosignerAccount(4));
  standard = await standardVault(people);
  backup = await backupVault(people);
});

beforeEach(() => {
  kdf.mockClear();
});

describe('export', () => {
  it('seals, then opens the file once with the passphrase before returning it', async () => {
    const contents = await standardContents(people);
    const { file, proposalsDropped, proposalHistoryTruncated } = await exportRecoveryPackage(contents, PASS, people[0]);
    expect(kdf).toHaveBeenCalledTimes(2);
    expect({ proposalsDropped, proposalHistoryTruncated }).toEqual({ proposalsDropped: 0, proposalHistoryTruncated: false });
    expect(await exportRecoveryPackage(contents, PASS, people[0])).toMatchObject({
      addressBookDropped: 0,
      addressBookTruncated: false,
      skipped: { proposals: 0, addressBook: 0, participantLabels: 0 },
    });
    const again = await exportRecoveryPackage(contents, PASS, people[0]);
    expect(Buffer.from(again.file).equals(Buffer.from(file))).toBe(false);
    const result = await openRecoveryPackage(file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.participants).toEqual(contents.participants);
  });

  it('cannot reuse a salt and nonce: the test-only values are not reachable from the library', () => {
    expect(exportRecoveryPackage.length).toBe(3);
    expect('sealRecoveryFile' in library).toBe(false);
    expect('openRecoveryFile' in library).toBe(false);
  });

  it('fails when the file does not open again to the same payload', async () => {
    const contents = await standardContents(people);
    const real = kdf.getMockImplementation();
    if (!real) throw new Error('no stand-in');
    kdf.mockImplementationOnce(real).mockImplementationOnce(async () => new Uint8Array(32).fill(9));
    await expect(exportRecoveryPackage(contents, PASS, people[0])).rejects.toMatchObject({ code: 'PACKAGE_CHECK_FAILED' });
  });

  it('refuses a passphrase the writer does not accept before any derivation', async () => {
    const contents = await standardContents(people);
    for (const bad of ['', 'fifteen code pt', 'sixteen\tcode pts', '\uDFFF and many more characters', undefined]) {
      await expect(exportRecoveryPackage(contents, bad as string, people[0])).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    }
    expect(kdf).not.toHaveBeenCalled();
  });

  it('checks the exporter: the seed must derive the exporter entry at its index', async () => {
    const contents = await standardContents(people, 0);
    await expect(exportRecoveryPackage(contents, PASS, people[1])).rejects.toMatchObject({ code: 'SEED_MISMATCH' });
    await expect(exportRecoveryPackage(contents, PASS, outsider)).rejects.toMatchObject({ code: 'SEED_MISMATCH' });
    for (const self of [{ position: 1, index: 1 }, { position: 0, index: 2 }, { position: 0, index: 0 }]) {
      await expect(exportRecoveryPackage({ ...contents, self }, PASS, people[0])).rejects.toMatchObject({ code: 'SEED_MISMATCH' });
    }
    await expect(exportRecoveryPackage(contents, PASS, undefined as never)).rejects.toMatchObject({ code: 'INVALID_ROLE_KEY' });
    expect(kdf).not.toHaveBeenCalled();
  });

  it('refuses contents whose scripts do not rebuild from their keys, roles and terms', async () => {
    const contents = await standardContents(people);
    const foreign = { ...contents, participants: [contents.participants[0], await participantAt(outsider, 1, 'owner'), contents.participants[2]] };
    await expect(exportRecoveryPackage(foreign, PASS, people[0])).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const missing = { ...contents, participants: contents.participants.slice(0, 2) };
    await expect(exportRecoveryPackage(missing, PASS, people[0])).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const role = { ...contents, participants: [contents.participants[0], { ...contents.participants[1], role: 'backup' as const }, contents.participants[2]] };
    await expect(exportRecoveryPackage(role, PASS, people[0])).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('roles') });

    const withBackup = await backupContents(people);
    if (withBackup.vault.kind !== 'native' || contents.vault.kind !== 'native') throw new Error('native');
    const noTerms = { ...withBackup, vault: { ...withBackup.vault, backup: undefined } };
    await expect(exportRecoveryPackage(noTerms, PASS, people[2])).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('backup terms') });
    const otherSlot = { ...withBackup, vault: { ...withBackup.vault, backup: { threshold: 1, afterSlot: 200_000_001 } } };
    await expect(exportRecoveryPackage(otherSlot, PASS, people[2])).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('backup terms') });
    const otherThreshold = { ...withBackup, vault: { ...withBackup.vault, backup: { threshold: 2, afterSlot: 200_000_000 } } };
    await expect(exportRecoveryPackage(otherThreshold, PASS, people[2])).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const stray = { ...contents, vault: { ...contents.vault, backup: { threshold: 1, afterSlot: 1 } } };
    await expect(exportRecoveryPackage(stray, PASS, people[0])).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('backup terms') });
  });

  it('refuses an external key that does not derive the vault keys recorded with it', async () => {
    const contents = await backupContents(people);
    const wrong = { ...contents, participants: [contents.participants[0], { ...contents.participants[1], external: externalRoleKeys(outsider) }, contents.participants[2]] };
    await expect(exportRecoveryPackage(wrong, PASS, people[2])).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('external') });
  });

  it('never fails for history size: the oldest proposals go first and the package says so', async () => {
    const contents = await standardContents(people);
    const proposals = Array.from({ length: MAX_PROPOSALS + 2 }, (_, i) => ({ id: i.toString(16).padStart(8, '0'), cbor: '80' }));
    const exported = await exportRecoveryPackage({ ...contents, proposals }, PASS, people[0]);
    expect(exported).toMatchObject({ proposalsDropped: 2, proposalHistoryTruncated: true });
    const result = await openRecoveryPackage(exported.file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.proposals[0]).toEqual(proposals[2]);
    expect(result.package.proposalHistoryTruncated).toBe(true);
  });

  it('never fails for the address book: the oldest entries go first and the package says so', async () => {
    const contents = await standardContents(people);
    const addressBook = Array.from({ length: MAX_ADDRESS_BOOK_ENTRIES + 4 }, (_, i) => ({
      address: Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(i.toString(16).padStart(56, '0')),
      }).toAddress().toBech32(),
      label: `Payee ${i}`,
    }));
    const exported = await exportRecoveryPackage({ ...contents, addressBook }, PASS, people[0]);
    expect(exported).toMatchObject({ addressBookDropped: 4, addressBookTruncated: true, proposalHistoryTruncated: false });
    const result = await openRecoveryPackage(exported.file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.addressBook[0]).toEqual(addressBook[4]);
    expect(result.package.addressBookTruncated).toBe(true);
  });

  it('never fails for one bad history or address book entry: it leaves it out and says so', async () => {
    const contents = await standardContents(people);
    const addr = (i: number) => Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(i.toString(16).padStart(56, '0')),
    }).toAddress().toBech32();
    const mainnet = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16('11'.repeat(28)),
    }).toAddress().toBech32();
    const exported = await exportRecoveryPackage({
      ...contents,
      manifests: [{ version: 1, cbor: 'a0' }],
      proposals: [{ id: '01', cbor: 'ab' }, { id: '01', cbor: 'cd' }, { id: '02', cbor: 'ab'.repeat(65537) }],
      addressBook: [
        { address: addr(1), label: 'a' },
        { address: addr(1), label: 'b' },
        { address: addr(2), label: 'x'.repeat(65) },
        { address: mainnet, label: 'm' },
      ],
      participants: [{ ...contents.participants[0], label: 'Bob\nSmith' }, ...contents.participants.slice(1)],
    }, PASS, people[0]);
    expect(exported.skipped).toEqual({ proposals: 2, addressBook: 3, participantLabels: 1, endorsements: 0, externalAttestations: 0 });
    expect(exported).toMatchObject({ proposalsDropped: 2, addressBookDropped: 3, proposalHistoryTruncated: true, addressBookTruncated: true });
    const result = await openRecoveryPackage(exported.file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.proposals).toEqual([{ id: '01', cbor: 'cd' }]);
    expect(result.package.addressBook).toEqual([{ address: addr(1), label: 'b' }]);
    expect(result.package.participants[0].label).toBeUndefined();
  });

  it('refuses to export a damaged manifest history', async () => {
    const contents = await standardContents(people);
    await expect(exportRecoveryPackage({ ...contents, manifests: [{ version: 1, cbor: 'a0' }, { version: 2, cbor: 'zz' }] }, PASS, people[0]))
      .rejects.toMatchObject({ code: 'MANIFEST_HISTORY_CORRUPT' });
    await expect(exportRecoveryPackage({ ...contents, manifests: [{ version: 1, cbor: 'a0' }, { version: 1, cbor: 'a1' }] }, PASS, people[0]))
      .rejects.toMatchObject({ code: 'MANIFEST_HISTORY_CORRUPT' });
    expect(kdf).not.toHaveBeenCalled();
  });

  it('carries labels authored with newer Unicode data than this client has, unchanged', async () => {
    const contents = await backupContents(people);
    // An unassigned code point here may be assigned on the client that wrote it; an isolate and
    // decomposed text are carried as stored too. Only the screen sanitises (displayLabel).
    const labels = ['new' + String.fromCharCode(0x378), 'Alice' + String.fromCharCode(0x202e) + 'ecila', 'Ame' + String.fromCharCode(0x301) + 'lie'];
    const exported = await exportRecoveryPackage({
      ...contents,
      participants: contents.participants.map((p, i) => ({ ...p, label: labels[i] })),
      addressBook: [{ ...contents.addressBook[0], label: labels[0] }],
    }, PASS, people[2]);
    // Its manifests are placeholders that do not decode, so its endorsement cannot be checked.
    expect(exported.skipped).toEqual({ proposals: 0, addressBook: 0, participantLabels: 0, endorsements: 1, externalAttestations: 1 });
    const result = await openRecoveryPackage(exported.file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.participants.map(p => p.label)).toEqual(labels);
    expect(result.package.addressBook[0].label).toBe(labels[0]);
  });

  it('exports a Plutus package for its owner or guardian: the seed is checked, the payment key only', async () => {
    const contents = await plutusContents(people);
    const pkg = await opened(contents);
    expect(pkg.vault).toEqual({ kind: 'plutus', seed: { txId: '0f'.repeat(32), index: 3 }, templateVersion: 1, validator: PLUTUS_VALIDATOR });
    await expect(exportRecoveryPackage(contents, PASS, people[1])).rejects.toMatchObject({ code: 'SEED_MISMATCH' });
    const guardian = { ...contents, self: { position: 2, index: 7 } };
    await expect(exportRecoveryPackage(guardian, PASS, people[2])).resolves.toMatchObject({ proposalsDropped: 0 });
  });
});

describe('open', () => {
  it('refuses a wrong passphrase, a truncated or tampered file and unknown versions, and loses nothing', async () => {
    const { file } = await exportRecoveryPackage(await standardContents(people), PASS, people[0]);
    const copy = Uint8Array.from(file);
    const codeOf = async (f: unknown, p: unknown = PASS) => {
      const r = await openRecoveryPackage(f, p);
      return r.ok === true ? 'OPENED' : r.code;
    };
    expect(await codeOf(file, 'not the passphrase')).toBe('WRONG_PASSPHRASE');
    expect(await codeOf(file.subarray(0, file.length - 10))).toBe('TRUNCATED');
    expect(await codeOf(file.subarray(0, 40))).toBe('TRUNCATED');
    const tampered = Uint8Array.from(file);
    tampered[100] ^= 0x80;
    expect(await codeOf(tampered)).toBe('TAMPERED');
    const later = Uint8Array.from(file);
    later[8] = 2;
    expect(await codeOf(later)).toBe('UNKNOWN_VERSION');
    // Every refusal left the file as it was, and the right passphrase still opens it.
    expect(file).toEqual(copy);
    expect(await codeOf(file)).toBe('OPENED');
  });

  it('refuses an authenticated payload that is invalid or of a later version', async () => {
    const valid = encodeRecoveryPayload(await standardContents(people));
    const later = Uint8Array.from(valid);
    expect(later[2]).toBe(0x01); // ac 00 01: the payload version
    later[2] = 0x02;
    const r1 = await openRecoveryPackage(await sealRecoveryFile(later, PASS), PASS);
    expect(r1).toMatchObject({ ok: false, code: 'UNKNOWN_PAYLOAD_VERSION' });
    const r2 = await openRecoveryPackage(await sealRecoveryFile(new Uint8Array([0xa0]), PASS), PASS);
    expect(r2).toMatchObject({ ok: false, code: 'PAYLOAD_INVALID' });
  });
});

describe('restore of a native vault', () => {
  it('every participant restores the vault from their own package and seed, as a candidate', async () => {
    const expectedId = vaultId(standard, 'preprod');
    for (let i = 0; i < people.length; i++) {
      const pkg = await opened(await standardContents(people, i));
      const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[i], chain: onChain(standard) }));
      expect(c.status).toBe('candidate');
      expect(c.vaultId).toBe(expectedId);
      expect(c.addresses).toEqual(vaultAddresses(standard, 'preprod'));
      expect(c.scripts.payment.cbor).toBe(standard.payment.cbor);
      expect(c.self).toEqual({ position: i, index: 1, role: 'owner' });
      expect(c.participants).toEqual(pkg.participants);
      expect(c.chainState).toEqual({ registered: true, funded: false, used: false, neverSeen: false });
      expect(c.conflicts).toEqual([]);
      expect(c.canonicalOrder).toBe(true);
      expect(c.backup).toBeUndefined();
      expect(c.ownAttestation).toEqual({ verified: false });
      expect(c.depositsBlocked).toBe(true);
    }
  });

  it('restores a funded vault that was never registered, with no chain evidence at all', async () => {
    const pkg = await opened(await standardContents(people));
    const funded = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', funded: true } }));
    expect(funded.chainState).toEqual({ registered: false, funded: true, used: false, neverSeen: false });
    expect(funded.vaultId).toBe(vaultId(standard, 'preprod'));
    // Every Gero service and every provider unreachable: the scripts are the vault.
    const blind = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: nothing }));
    expect(blind.chainState).toEqual({ registered: false, funded: false, used: false, neverSeen: true });
    expect(blind.addresses).toEqual(vaultAddresses(standard, 'preprod'));
  });

  it('a package with the restorer\'s key but no attestation restores as a candidate with deposits blocked', async () => {
    const pkg = await opened(await backupContents(people));
    const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: onChain(backup) }));
    expect(pkg.manifests.length).toBeGreaterThan(0);
    expect(c).toMatchObject({ status: 'candidate', ownAttestation: { verified: false }, depositsBlocked: true });
  });

  it('asks the attestation hook, and lifts the deposit block only on an answer bound to this vault', async () => {
    const pkg = await opened(await backupContents(people));
    const own = await deriveVaultPublicKeys(people[2], 1);
    const credential = (await vaultKeyHashes(own)).payment;
    const id = vaultId(backup, 'preprod');
    const queries: OwnAttestationQuery[] = [];
    const verified = candidateOf(await restoreVaultFromPackage(pkg, {
      roleKeys: people[2],
      chain: onChain(backup),
      verifyOwnAttestation: async q => {
        queries.push(q);
        return { verified: true, recordedAtMs: 1795000000000, vaultId: q.vaultId, credential: q.credential, attestingDeviceRemoved: false };
      },
    }));
    expect(verified).toMatchObject({
      ownAttestation: { verified: true, recordedAtMs: 1795000000000, vaultId: id, credential, attestingDeviceRemoved: false },
      depositsBlocked: false,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ network: 'preprod', vaultId: id, vaultKeys: own, credential });
    expect(queries[0].scripts.payment.hash).toBe(backup.payment.hash);
    expect(queries[0].scripts.stake.hash).toBe(backup.stake.hash);
    expect(queries[0].participants).toEqual(pkg.participants);
    expect(queries[0].manifests).toEqual(pkg.manifests);
    expect(queries[0].signal.aborted).toBe(true); // released once the restore stopped waiting
    for (const hook of [
      async () => { throw new Error('verifier down'); },
      async () => ({ verified: true, recordedAtMs: 1, attestingDeviceRemoved: false }) as never,
      async () => ({ verified: 'yes', recordedAtMs: 1, vaultId: id, credential, attestingDeviceRemoved: false }) as never,
      async () => ({ verified: true, recordedAtMs: 1, vaultId: id, credential: (await vaultKeyHashes(await deriveVaultPublicKeys(people[0], 1))).payment, attestingDeviceRemoved: false }),
      // An answer that does not say whether the attesting device is still bound.
      async () => ({ verified: true, recordedAtMs: 1, vaultId: id, credential }) as never,
      async () => undefined as never,
    ]) {
      const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: onChain(backup), verifyOwnAttestation: hook }));
      expect(c).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
    }
  });

  it('keeps deposits blocked when the verifier reports the attesting device removed, and dates nothing after the export', async () => {
    const pkg = await opened(await backupContents(people));
    const answer = (attestingDeviceRemoved: boolean, recordedAtMs: number): OwnAttestationVerifier =>
      async q => ({ verified: true, recordedAtMs, vaultId: q.vaultId, credential: q.credential, attestingDeviceRemoved });
    expect(candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: nothing, verifyOwnAttestation: answer(true, 1) })))
      .toMatchObject({ ownAttestation: { verified: true, recordedAtMs: 1, attestingDeviceRemoved: true }, depositsBlocked: true });
    expect(candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: nothing, verifyOwnAttestation: answer(false, pkg.exportedAtMs + 1) })))
      .toMatchObject({ ownAttestation: { verified: true, recordedAtMs: pkg.exportedAtMs, attestingDeviceRemoved: false }, depositsBlocked: false });
  });

  it('verifies the restorer\'s own attestation from the manifest history by default, with the manifest code\'s verifier', async () => {
    const { manifest, people: signers } = await vectorFixture();
    const manifests = [{ version: manifest.version, cbor: encodeManifest(manifest) }];
    const credentials = await Promise.all(people.map(async p => (await vaultKeyHashes(await deriveVaultPublicKeys(p, 1))).payment));
    expect(credentials).toEqual(signers.slice(0, 3).map(s => s.credential));
    // Owner 1 has a device attested with CIP-8, owner 2 one attested with an expired transaction.
    for (const i of [0, 1]) {
      const pkg = await opened({ ...(await standardContents(people, i)), manifests });
      const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[i], chain: nothing }));
      expect(c).toMatchObject({
        depositsBlocked: false,
        ownAttestation: {
          verified: true,
          recordedAtMs: VECTOR_REVISED_AT * 1000,
          vaultId: vaultId(standard, 'preprod'),
          credential: credentials[i],
          verificationDigest: verificationDigest(manifest),
          attestingDeviceRemoved: false,
        },
      });
    }
    // Owner 3 has no device yet, so no attestation of theirs: deposits stay blocked.
    const third = await opened({ ...(await standardContents(people, 2)), manifests });
    expect(candidateOf(await restoreVaultFromPackage(third, { roleKeys: people[2], chain: nothing })))
      .toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
  });

  it('refuses by default an attestation that is not this restorer\'s, in this vault, untampered', async () => {
    const { manifest } = await vectorFixture();
    const cbor = encodeManifest(manifest);
    const restore = async (contents: RecoveryPackageContents, roleKeys: RoleKeys) =>
      candidateOf(await restoreVaultFromPackage(await opened(contents, roleKeys), { roleKeys, chain: nothing }));
    const blocked = { ownAttestation: { verified: false }, depositsBlocked: true };
    // The standard vault's manifest copied into a package of another vault that shares the key.
    const backupPackage = await backupContents(people);
    expect(await restore({ ...backupPackage, self: { position: 0, index: 1 }, manifests: [{ version: 1, cbor }] }, people[0])).toMatchObject(blocked);
    // One flipped byte in the stored attestation: it no longer verifies, or the revision no longer decodes.
    const at = cbor.indexOf(manifest.roles.owners[0].devices[0].attestation?.proof.slice(-40) ?? 'none');
    expect(at).toBeGreaterThan(0);
    const flipped = `${cbor.slice(0, at)}${cbor[at] === '0' ? '1' : '0'}${cbor.slice(at + 1)}`;
    expect(await restore({ ...(await standardContents(people, 0)), manifests: [{ version: 1, cbor: flipped }] }, people[0])).toMatchObject(blocked);
    // Bytes that are not a manifest.
    expect(await restore({ ...(await standardContents(people, 0)), manifests: [{ version: 1, cbor: 'a0' }] }, people[0])).toMatchObject(blocked);
  });

  it('keeps deposits blocked when a careless verifier accepts an attestation copied from another vault', async () => {
    const pkg = await opened(await backupContents(people));
    // The restorer's own attestation, really made for the standard vault, which shares their key.
    const copied = { vaultId: vaultId(standard, 'preprod'), recordedAtMs: 1795000000000 };
    const c = candidateOf(await restoreVaultFromPackage(pkg, {
      roleKeys: people[2],
      chain: onChain(backup),
      verifyOwnAttestation: async q => ({ verified: true, recordedAtMs: copied.recordedAtMs, vaultId: copied.vaultId, credential: q.credential, attestingDeviceRemoved: false }),
    }));
    expect(c).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
  });

  it('never hangs on the verifier: it gives up after the timeout or when the caller aborts', async () => {
    const pkg = await opened(await backupContents(people));
    let signal: AbortSignal | undefined;
    const hung = async (q: OwnAttestationQuery) => {
      signal = q.signal;
      return new Promise<never>(() => undefined);
    };
    const started = Date.now();
    const timedOut = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: nothing, verifyOwnAttestation: hung, attestationTimeoutMs: 50 }));
    expect(timedOut).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(signal?.aborted).toBe(true);
    const controller = new AbortController();
    const pending = restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: nothing, verifyOwnAttestation: hung, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(candidateOf(await pending)).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
    const already = new AbortController();
    already.abort();
    expect(candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: nothing, verifyOwnAttestation: hung, signal: already.signal })))
      .toMatchObject({ ownAttestation: { verified: false } });
  });

  it('a backup holder rebuilds the dated backup path from their package alone, its time from the slot', async () => {
    const pkg = await opened(await backupContents(people));
    const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: nothing }));
    expect(c.self.role).toBe('backup');
    expect(c.scripts.template).toEqual({ kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 });
    expect(c.backup).toEqual({ threshold: 1, afterSlot: 200_000_000, opensAtMs: BACKUP_OPENS_AT_MS });
    expect(new Date(BACKUP_OPENS_AT_MS).toISOString()).toBe('2028-10-20T19:33:20.000Z');
    expect(c.addresses.base).toBe(vaultAddresses(backup, 'preprod').base);
  });

  it('pools what registrations and revealed scripts show, for display', async () => {
    const pkg = await opened(await standardContents(people));
    // A payment-only registration and the stake script run on chain.
    const paymentOnly: RegistrationInput = { metadata: { json: { types: [0] } }, nativeScripts: { cbors: [standard.payment.cbor] } };
    const c = candidateOf(await restoreVaultFromPackage(pkg, {
      roleKeys: people[0],
      chain: { network: 'preprod', registrations: [paymentOnly], revealedScripts: [standard.stake.cbor] },
    }));
    expect(c.chainState).toEqual({ registered: true, funded: false, used: true, neverSeen: false });
    const used = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', used: true } }));
    expect(used.chainState.used).toBe(true);
  });

  it('reports other scripts holding the restorer\'s key at this index, and never refuses for them', async () => {
    // Vault B: the victim's key at index 1 with two keys an attacker holds.
    const b = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: people[0], index: 1 }, { roleKeys: outsider, index: 1 }, { roleKeys: outsider2, index: 1 }],
    });
    const honest = await opened(await standardContents(people, 0));
    const both = { network: 'preprod' as const, registrations: [registered(standard), registered(b)] };
    const a = candidateOf(await restoreVaultFromPackage(honest, { roleKeys: people[0], chain: both }));
    expect(a.chainState.registered).toBe(true);
    expect(a.conflicts).toEqual([b.payment.hash, b.stake.hash].sort());
    // The attacker's package for vault B, under a passphrase the attacker chose.
    const bContents: RecoveryPackageContents = {
      ...(await standardContents(people, 0)),
      vault: { kind: 'native', payment: b.payment, stake: b.stake },
      participants: await Promise.all([people[0], outsider, outsider2].map(p => participantAt(p, 1, 'owner'))),
    };
    const attacker = await opened(bContents, people[0]);
    const rb = candidateOf(await restoreVaultFromPackage(attacker, { roleKeys: people[0], chain: both }));
    expect(rb).toMatchObject({ status: 'candidate', depositsBlocked: true });
    expect(rb.conflicts).toEqual([standard.payment.hash, standard.stake.hash].sort());
    // A revealed script holding the key counts too, in any valid encoding.
    const revealed = candidateOf(await restoreVaultFromPackage(honest, { roleKeys: people[0], chain: { network: 'preprod', revealedScripts: [b.payment.cbor] } }));
    expect(revealed.conflicts).toEqual([b.payment.hash]);
    expect(revealed.chainState.used).toBe(false);
  });

  it('decodes registrations itself: hand-built objects and published noise are ignored', async () => {
    const pkg = await opened(await standardContents(people));
    const fake = { encryption: 'none', scripts: [], payment: { hash: standard.payment.hash }, stake: { hash: standard.stake.hash }, participants: {} };
    const noise: RegistrationInput = { metadata: { json: { types: [0, 2] } }, nativeScripts: { cbors: ['00', '00'] } };
    const c = candidateOf(await restoreVaultFromPackage(pkg, {
      roleKeys: people[0],
      chain: { network: 'preprod', registrations: [fake as unknown as RegistrationInput, noise] },
    }));
    expect(c.chainState.registered).toBe(false);
  });

  it('restores vaults whose participants sit at different indexes, and carries the vault warnings', async () => {
    const indexes = [3, 1, 7];
    const vault = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 3 },
      owners: people.map((roleKeys, i) => ({ roleKeys, index: indexes[i] })),
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    const contents: RecoveryPackageContents = {
      ...(await standardContents(people)),
      vault: { kind: 'native', payment: vault.payment, stake: vault.stake },
      self: { position: 2, index: 7 },
      participants: await Promise.all(people.map((p, i) => participantAt(p, indexes[i], 'owner'))),
    };
    const c = candidateOf(await restoreVaultFromPackage(await opened(contents), { roleKeys: people[2], chain: onChain(vault) }));
    expect(c.self.index).toBe(7);
    expect(c.warnings).toEqual(['ALL_OWNERS_REQUIRED']);
    expect(c.vaultId).toBe(vaultId(vault, 'preprod'));
  });

  it('refuses a seed that is not the exporter\'s', async () => {
    const pkg = await opened(await standardContents(people, 0));
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[1], chain: onChain(standard) }))).toBe('SEED_MISMATCH');
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: outsider, chain: onChain(standard) }))).toBe('SEED_MISMATCH');
    // The right seed with an index the package does not record for it.
    const wrongIndex = await sealedAnyway({ ...(await standardContents(people, 0)), self: { position: 0, index: 2 } });
    expect(code(await restoreVaultFromPackage(wrongIndex, { roleKeys: people[0], chain: onChain(standard) }))).toBe('SEED_MISMATCH');
  });

  it('refuses chain facts for another network', async () => {
    const pkg = await opened(await standardContents(people));
    const r = await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { ...onChain(standard), network: 'preview' } });
    expect(code(r)).toBe('NETWORK_MISMATCH');
  });

  it('trusts nothing in a hand-built package object but its canonical bytes', async () => {
    const pkg = await opened(await standardContents(people, 0));
    if (pkg.vault.kind !== 'native') throw new Error('native');
    // The structure of another vault's script with this vault's bytes and hash.
    const forged = { ...pkg, vault: { ...pkg.vault, payment: { ...pkg.vault.payment, script: backup.payment.script } } };
    const c = candidateOf(await restoreVaultFromPackage(forged, { roleKeys: people[0], chain: nothing }));
    expect(c.scripts.payment.script).toEqual(standard.payment.script);
    expect(c.scripts.template).toEqual({ kind: 'standard', threshold: 2 });
  });

  it('refuses a package sealed without the export checks whose contents disagree with its scripts', async () => {
    const contents = await standardContents(people);
    const foreign = await sealedAnyway({
      ...contents,
      participants: [contents.participants[0], await participantAt(outsider, 1, 'owner'), contents.participants[2]],
    });
    expect(await restoreVaultFromPackage(foreign, { roleKeys: people[0], chain: onChain(standard) }))
      .toMatchObject({ ok: false, code: 'PACKAGE_INCONSISTENT', detail: 'rebuild: PARTICIPANT_NOT_IN_VAULT' });
    const roles = await sealedAnyway({ ...contents, participants: [contents.participants[0], contents.participants[1], { ...contents.participants[2], role: 'backup' }] });
    expect(await restoreVaultFromPackage(roles, { roleKeys: people[0], chain: onChain(standard) }))
      .toMatchObject({ ok: false, code: 'PACKAGE_INCONSISTENT', detail: 'roles differ from the scripts' });
    const withBackup = await backupContents(people);
    const external = await sealedAnyway({
      ...withBackup,
      participants: [withBackup.participants[0], { ...withBackup.participants[1], external: externalRoleKeys(people[0]) }, withBackup.participants[2]],
    });
    expect(await restoreVaultFromPackage(external, { roleKeys: people[2], chain: onChain(backup) }))
      .toMatchObject({ ok: false, code: 'PACKAGE_INCONSISTENT', detail: 'an external key does not derive its vault keys' });
  });

  it('never changes its inputs, frozen or not, on success or refusal', async () => {
    const pkg = deepFreeze(await opened(await backupContents(people)));
    const snapshot = JSON.stringify(pkg);
    const chains = [onChain(backup), onChain(standard), { network: 'preview' as const }, { network: 'preprod' as const, revealedScripts: [backup.payment.cbor] }].map(deepFreeze);
    const results: string[] = [];
    for (const chain of chains) {
      for (const roleKeys of [people[2], people[0], outsider]) {
        const before = JSON.stringify(chain);
        results.push(code(await restoreVaultFromPackage(pkg, deepFreeze({ roleKeys, chain }))));
        expect(JSON.stringify(chain)).toBe(before);
      }
    }
    expect(JSON.stringify(pkg)).toBe(snapshot);
    expect(results).toEqual([
      'RESTORED', 'SEED_MISMATCH', 'SEED_MISMATCH',
      'RESTORED', 'SEED_MISMATCH', 'SEED_MISMATCH',
      'NETWORK_MISMATCH', 'NETWORK_MISMATCH', 'NETWORK_MISMATCH',
      'RESTORED', 'SEED_MISMATCH', 'SEED_MISMATCH',
    ]);
    const contents = deepFreeze(await backupContents(people));
    const before = JSON.stringify(contents);
    await exportRecoveryPackage(contents, PASS, people[2]);
    expect(JSON.stringify(contents)).toBe(before);
  });

  it('reads only the first chain facts beyond the bounds, ignores unreadable ones, and never refuses for them', async () => {
    const pkg = await opened(await standardContents(people, 0));
    const noise = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: people[0], index: 1 }, { roleKeys: outsider, index: 9 }],
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    const many = [registered(standard), ...Array(MAX_CHAIN_REGISTRATIONS).fill(registered(noise))];
    const over = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: many } }));
    expect(over).toMatchObject({ chainFactsTruncated: true, chainState: { registered: true } });
    expect(over.conflicts).toEqual([noise.payment.hash, noise.stake.hash].sort());
    const at = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: many.slice(0, MAX_CHAIN_REGISTRATIONS) } }));
    expect(at.chainFactsTruncated).toBe(false);
    // Past the bound nothing more is read.
    const late = [...Array(MAX_CHAIN_REGISTRATIONS).fill(registered(noise)), registered(standard)];
    expect(candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: late } })))
      .toMatchObject({ chainFactsTruncated: true, chainState: { registered: false } });
    const revealed = [...Array(MAX_REVEALED_SCRIPTS + 1).fill(noise.payment.cbor)];
    expect(candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', revealedScripts: revealed } })))
      .toMatchObject({ chainFactsTruncated: true });
    const unreadable = candidateOf(await restoreVaultFromPackage(pkg, {
      roleKeys: people[0],
      chain: { network: 'preprod', revealedScripts: ['zz', 'abc', '', 42 as never, standard.payment.cbor] },
    }));
    expect(unreadable).toMatchObject({ chainFactsTruncated: false, chainState: { used: true } });
  });

  it('checks both of the restorer\'s keys against every script of a registration, whatever role it declares', async () => {
    const pkg = await opened(await standardContents(people, 0));
    const b = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: people[0], index: 1 }, { roleKeys: outsider, index: 1 }, { roleKeys: outsider2, index: 1 }],
    });
    const filler = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: outsider, index: 5 }, { roleKeys: outsider2, index: 5 }],
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    // A script holding the restorer's payment key, declared as a stake script, and the other way round.
    const misdeclared: RegistrationInput = { metadata: { json: { types: [0, 2] } }, nativeScripts: { cbors: [filler.payment.cbor, b.payment.cbor] } };
    const swapped: RegistrationInput = { metadata: { json: { types: [0, 2] } }, nativeScripts: { cbors: [b.stake.cbor, filler.stake.cbor] } };
    for (const registration of [misdeclared, swapped]) {
      const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [registration] } }));
      expect(c.conflicts.length).toBe(1);
      expect([b.payment.hash, b.stake.hash]).toContain(c.conflicts[0]);
    }
  });

  it('refuses malformed input without throwing', async () => {
    const pkg = await opened(await standardContents(people));
    const chain = onChain(standard);
    const cases: [unknown, unknown][] = [
      [pkg, { chain }],
      [pkg, { roleKeys: { payment: people[0].stake, stake: people[0].payment }, chain }],
      [pkg, { roleKeys: people[0] }],
      [pkg, undefined],
      [undefined, { roleKeys: people[0], chain }],
      [{ ...pkg, self: { position: 9, index: 1 } }, { roleKeys: people[0], chain }],
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: 'none' } }],
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', funded: 'yes' } }],
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', revealedScripts: 'none' } }],
    ];
    for (const [p, options] of cases) {
      const r = await restoreVaultFromPackage(p as RecoveryPackage, options as never);
      expect(code(r)).toBe('INVALID_INPUT');
    }
  });
});

describe('restore of a Plutus vault', () => {
  const STATE = Buffer.from('state').toString('hex');
  let h: Hash28ByteBase16;
  let address: string;
  const fullAddress = (hash: Hash28ByteBase16) => {
    const credential = { type: Cardano.CredentialType.ScriptHash, hash };
    return Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, credential, credential).toAddress().toBech32();
  };
  const utxo = (at: string, policyId: string, quantity: bigint | number | string = 1n, assetName = STATE): RecoveryChainUtxo =>
    ({ address: at, assets: [{ policyId, assetName, quantity }] });

  beforeAll(() => {
    // The ledger's Plutus V3 hash of the stand-in validator, from the SDK.
    h = Serialization.Script.fromCore({ __type: Cardano.ScriptType.Plutus, bytes: HexBlob(PLUTUS_VALIDATOR), version: Cardano.PlutusLanguageVersion.V3 }).hash() as Hash28ByteBase16;
    address = fullAddress(h);
  });

  it('a Plutus package without a pinned template goes as far as the datum check, spend only', async () => {
    const pkg = await opened(await plutusContents(people));
    const r = await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preview', utxos: [utxo(address, h)] } });
    expect(r).toEqual({
      ok: false,
      code: 'PLUTUS_DATUM_CODEC_UNAVAILABLE',
      detail: 'the state datum check needs the GV-64 datum codec',
      plutus: { scriptHash: h, address, templateVersion: 1, templateVerified: false, spendOnly: true },
    });
    for (const quantity of [1, '1', 1n]) {
      expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preview', utxos: [utxo(address, h, quantity)] } })))
        .toBe('PLUTUS_DATUM_CODEC_UNAVAILABLE');
    }
    // The guardian restores their own package the same way.
    const guardian = await opened({ ...(await plutusContents(people)), self: { position: 2, index: 7 } }, people[2]);
    expect(code(await restoreVaultFromPackage(guardian, { roleKeys: people[2], chain: { network: 'preview', utxos: [utxo(address, h)] } })))
      .toBe('PLUTUS_DATUM_CODEC_UNAVAILABLE');
  });

  it('refuses a validator whose hash does not match the state UTxO\'s address', async () => {
    const pkg = await opened(await plutusContents(people));
    const other = Hash28ByteBase16('ab'.repeat(28));
    const chain = (utxos: RecoveryChainUtxo[]): RecoveryChainFacts => ({ network: 'preview', utxos });
    const cases: RecoveryChainUtxo[][] = [
      [], // nothing on chain
      [utxo(fullAddress(other), other)], // a state UTxO of another validator
      [utxo(fullAddress(other), h)], // this vault's token at another address
      [utxo(address, other)], // another policy's token at this address
      [utxo(address, h, 2n)], // not exactly one
      [utxo(address, h, ' 0x1 ')],
      [utxo(address, h, '1.0')],
      [utxo(address, h, '01')],
      [utxo(address, h, 1.5)],
      [utxo(address, h, '1n')],
      [utxo(address, h.toUpperCase())],
      [utxo(address, h, 1n, Buffer.from('stat').toString('hex'))], // another asset name
      [utxo(vaultAddresses(standard, 'preview').base, h)], // a native vault's address
    ];
    for (const utxos of cases) {
      const r = await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: chain(utxos) });
      expect(r).toMatchObject({ ok: false, code: 'PLUTUS_VAULT_NOT_FOUND', plutus: { scriptHash: h, address, templateVerified: false } });
    }
  });

  it('looks only for the state token, however many UTxOs and whatever else they hold', async () => {
    const pkg = await opened(await plutusContents(people));
    const filler = Array.from({ length: 5000 }, (_, i) => utxo(fullAddress(Hash28ByteBase16(i.toString(16).padStart(56, '0'))), 'ab'.repeat(28)));
    const garbage = [null, { address: 42 }, { address, assets: 'x' }, { assets: [null] }] as never[];
    const r = await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preview', utxos: [...filler, ...garbage, utxo(address, h)] } });
    expect(code(r)).toBe('PLUTUS_DATUM_CODEC_UNAVAILABLE');
  });

  it('checks the seed first', async () => {
    const pkg = await opened(await plutusContents(people));
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[1], chain: { network: 'preview', utxos: [utxo(address, h)] } }))).toBe('SEED_MISMATCH');
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preview', utxos: 'none' as never } }))).toBe('INVALID_INPUT');
  });
});

describe('the dated backup path\'s time', () => {
  it('is the slot\'s time from each network\'s first Shelley slot, one second per slot', () => {
    expect(backupPathOpensAtMs('mainnet', 4492800)).toBe(1596059091000);
    expect(backupPathOpensAtMs('preprod', 86400)).toBe(1655769600000);
    expect(backupPathOpensAtMs('preview', 0)).toBe(1666656000000);
    // Mainnet epoch 209 starts one 432000-slot epoch later, as public indexers report.
    expect(backupPathOpensAtMs('mainnet', 4492800 + 432000)).toBe(1596491091000);
    expect(backupPathOpensAtMs('preprod', 200_000_000)).toBe(BACKUP_OPENS_AT_MS);
  });

  it('is undefined before the Shelley era or on an unknown network', () => {
    expect(backupPathOpensAtMs('mainnet', 4492799)).toBeUndefined();
    expect(backupPathOpensAtMs('preprod', 86399)).toBeUndefined();
    expect(backupPathOpensAtMs('preprod', 1.5)).toBeUndefined();
    expect(backupPathOpensAtMs('sanchonet' as never, 100)).toBeUndefined();
  });
});

describe('staleness reminder', () => {
  const m = (version: number, cbor: string) => ({ version, cbor });

  it('shows when the package is older than the latest manifest revision', async () => {
    const pkg = await opened(await backupContents(people));
    const newest = pkg.manifests[pkg.manifests.length - 1];
    expect(recoveryPackageStaleness(pkg, undefined)).toEqual({ stale: false });
    expect(recoveryPackageStaleness(pkg, { version: newest.version })).toEqual({ stale: false });
    expect(recoveryPackageStaleness(pkg, { version: newest.version, hash: newest.hash })).toEqual({ stale: false });
    expect(recoveryPackageStaleness(pkg, { version: newest.version + 1 })).toEqual({ stale: true, reason: 'OLDER_REVISION' });
    expect(recoveryPackageStaleness(pkg, { version: newest.version, hash: 'ab'.repeat(32) })).toEqual({ stale: true, reason: 'OTHER_REVISION' });
    expect(recoveryPackageStaleness(pkg, { version: 0 })).toEqual({ stale: false });
    expect(recoveryPackageStaleness({ manifests: [] }, { version: 0 })).toEqual({ stale: true, reason: 'NO_MANIFEST' });
    expect(recoveryPackageStaleness({ manifests: [m(4, 'a0')] }, { version: 5 })).toEqual({ stale: true, reason: 'OLDER_REVISION' });
    // The newest revision is the highest version, whatever order a list gives.
    expect(recoveryPackageStaleness({ manifests: [m(5, 'a1'), m(4, 'a0')] }, { version: 5, hash: manifestRevisionHashOf('a1') })).toEqual({ stale: false });
  });

  it('reads a malformed package manifest list as stale, without throwing', () => {
    for (const manifests of [[m(3, 'not hex')], [m(3, 'AB')], [m(-1, 'ab')], [null], 'none']) {
      expect(recoveryPackageStaleness({ manifests } as never, { version: 3, hash: 'ab'.repeat(32) })).toEqual({ stale: true, reason: 'UNREADABLE_PACKAGE' });
    }
  });

  it('refuses a malformed latest revision, which is the wallet\'s own record', () => {
    for (const bad of [{ version: -1 }, { version: 1.5 }, { version: 1, hash: 'AB'.repeat(32) }, { version: 1, hash: 'ab' }]) {
      expect(() => recoveryPackageStaleness({ manifests: [] }, bad)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST_REVISION' }));
    }
  });
});

describe('export: endorsements', () => {
  let tp: TestParticipant[];
  let latest: VaultManifest;
  let proof: string;
  let endorsement: ExternalEndorsement;
  let endorsed: RecoveryPackageContents;
  const expired = (p: string): OwnerAttestation => ({ method: ATTESTATION_METHOD.EXPIRED_TX, proof: p });

  /** The first one-bit change of `a` that stays in the stored form and no longer verifies. */
  async function brokenButStored(a: OwnerAttestation, verifies: (x: OwnerAttestation) => Promise<boolean>): Promise<OwnerAttestation> {
    for (let i = 0; i < a.proof.length; i += 2) {
      const byte = (parseInt(a.proof.slice(i, i + 2), 16) ^ 1).toString(16).padStart(2, '0');
      const x = { method: a.method, proof: `${a.proof.slice(0, i)}${byte}${a.proof.slice(i + 2)}` };
      if (isCanonicalAttestation(x) && !(await verifies(x))) return x;
    }
    throw new Error('fixture: every one-bit change leaves the stored form or still verifies');
  }

  async function exported(contents: RecoveryPackageContents) {
    const out = await exportRecoveryPackage(contents, PASS, people[0]);
    const result = await openRecoveryPackage(out.file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    return { skipped: out.skipped, pkg: result.package };
  }

  beforeAll(async () => {
    const fx = await vectorFixture();
    tp = fx.people;
    // Owners 1 and 2 bound; the third cosigner an external wallet imported by owner 1. Its
    // attestation reached owner 2, who endorses it.
    latest = newManifest({
      vault: fx.vault,
      network: 'preprod',
      owners: [
        { vaultKeys: tp[0].vaultKeys, devices: [await signedBinding({ vaultId: fx.id, role: 'owner', participant: tp[0], device: 1 })] },
        { vaultKeys: tp[1].vaultKeys, devices: [await signedBinding({ vaultId: fx.id, role: 'owner', participant: tp[1], device: 2 })] },
      ],
      external: [signedExternal({ vaultId: fx.id, participant: tp[2], importer: tp[0] })],
      revisedAt: VECTOR_REVISED_AT,
    });
    proof = expiredTxAttestation(tp[2].signer, tp[2].credential, { kind: 'verification', digest: verificationDigest(latest) }).proof;
    endorsement = signedEndorsement(latest, tp[1], tp[2].credential, proof);
    const base = await standardContents(people, 0);
    endorsed = {
      ...base,
      participants: base.participants.map((p, i) => (i === 2 ? { ...p, external: externalRoleKeys(people[2]) } : p)),
      manifests: [{ version: 1, cbor: encodeManifest(latest) }],
      endorsements: [endorsement],
      externalAttestations: [expired(proof)],
    };
  });

  it('keeps an endorsement that verifies against the latest accepted manifest, with the attestation it names', async () => {
    const { skipped, pkg } = await exported(endorsed);
    expect(pkg.endorsements).toEqual([endorsement]);
    expect(pkg.externalAttestations).toEqual([expired(proof)]);
    expect(skipped).toMatchObject({ endorsements: 0, externalAttestations: 0 });
  });

  it('leaves out and counts an endorsement with an altered proof, and an endorsement of an altered external proof', async () => {
    const digest = externalEndorsementDigest(endorsement);
    const altered = await brokenButStored(endorsement.attestation, async x =>
      (await verifyAttestation(x, endorsement.endorserCredential, { kind: 'endorsement', digest })).ok === true);
    const one = await exported({ ...endorsed, endorsements: [{ ...endorsement, attestation: altered }] });
    expect(one.skipped).toMatchObject({ endorsements: 1, externalAttestations: 1 });
    expect(one.pkg).toMatchObject({ endorsements: [], externalAttestations: [] });
    // An altered external proof, endorsed as it is: the pair matches by hash, the proof does not verify.
    const badProof = (await brokenButStored(expired(proof), async x =>
      (await verifyAttestation(x, tp[2].credential, { kind: 'verification', digest: verificationDigest(latest) })).ok === true)).proof;
    const two = await exported({
      ...endorsed,
      endorsements: [signedEndorsement(latest, tp[1], tp[2].credential, badProof), endorsement],
      externalAttestations: [expired(badProof), expired(proof)],
    });
    expect(two.skipped).toMatchObject({ endorsements: 1, externalAttestations: 1 });
    expect(two.pkg).toMatchObject({ endorsements: [endorsement], externalAttestations: [expired(proof)] });
  });

  it('leaves out an endorsement attested by another key than its endorser\'s', async () => {
    const otherKey = { ...endorsement, attestation: attestationBy(tp[3], { kind: 'endorsement', digest: externalEndorsementDigest(endorsement) }) };
    const { skipped, pkg } = await exported({ ...endorsed, endorsements: [otherKey] });
    expect(skipped).toMatchObject({ endorsements: 1, externalAttestations: 1 });
    expect(pkg).toMatchObject({ endorsements: [], externalAttestations: [] });
  });

  it('leaves out an endorsement whose attestation is not carried, and an attestation no endorsement names', async () => {
    const unpairedEndorsement = await exported({ ...endorsed, externalAttestations: [] });
    expect(unpairedEndorsement.skipped).toMatchObject({ endorsements: 1, externalAttestations: 0 });
    expect(unpairedEndorsement.pkg.endorsements).toEqual([]);
    const unpairedAttestation = await exported({ ...endorsed, endorsements: [] });
    expect(unpairedAttestation.skipped).toMatchObject({ endorsements: 0, externalAttestations: 1 });
    expect(unpairedAttestation.pkg.externalAttestations).toEqual([]);
  });

  it('checks against the latest revision only', async () => {
    // The external cosigner later joined as an owner: the endorsement no longer applies.
    const { manifest: joined } = await vectorFixture();
    const v2 = { ...joined, version: 2, prevManifestHash: manifestRevisionHashOf(endorsed.manifests[0].cbor), revisedAt: VECTOR_REVISED_AT + 60 };
    const later = await exported({ ...endorsed, manifests: [...endorsed.manifests, { version: 2, cbor: encodeManifest(v2) }] });
    expect(later.skipped).toMatchObject({ endorsements: 1, externalAttestations: 1 });
    // A latest revision that is not a manifest: nothing can be checked, so nothing is carried.
    const broken = await exported({ ...endorsed, manifests: [...endorsed.manifests, { version: 2, cbor: 'a0' }] });
    expect(broken.skipped).toMatchObject({ endorsements: 1, externalAttestations: 1 });
  });
});

describe('the default attestation verifier over long histories', () => {
  const N = 1000;
  /** The revision in which owner 3 binds their first device. */
  const BOUND_AT = 700;
  const dateOf = (version: number) => (VECTOR_REVISED_AT + (version - 1) * 60) * 1000;
  const EXPORTED = dateOf(N) + 86_400_000;
  let fx: Awaited<ReturnType<typeof vectorFixture>>;
  let history: ManifestRevision[];

  async function queryFor(i: number, manifests: readonly ManifestRevision[], signal = new AbortController().signal): Promise<OwnAttestationQuery> {
    const vaultKeys = await deriveVaultPublicKeys(people[i], 1);
    return {
      network: 'preprod',
      vaultId: fx.id,
      scripts: fx.vault,
      participants: (await standardContents(people, i)).participants,
      manifests: manifests.map(m => ({ ...m, hash: manifestRevisionHashOf(m.cbor) as string })),
      vaultKeys,
      credential: (await vaultKeyHashes(vaultKeys)).payment,
      signal,
    };
  }

  const restoreAs = async (i: number, manifests: readonly ManifestRevision[], timeout?: number) =>
    candidateOf(await restoreVaultFromPackage(
      { ...(await standardContents(people, i)), exportedAtMs: EXPORTED, manifests },
      { roleKeys: people[i], chain: nothing, ...(timeout ? { attestationTimeoutMs: timeout } : {}) },
    ));

  beforeAll(async () => {
    fx = await vectorFixture();
    const tablet = await signedBinding({ vaultId: fx.id, role: 'owner', participant: fx.people[2], device: 3, label: 'Tablet' });
    // An honest history: each revision a minute after the last, linked by hash, as the manifest
    // code writes them.
    let m = fx.manifest;
    let cbor = encodeManifest(m);
    history = [{ version: 1, cbor }];
    for (let v = 2; v <= N; v++) {
      const roles = v === BOUND_AT
        ? { ...m.roles, owners: m.roles.owners.map(e => (e.credential === fx.people[2].credential ? { ...e, devices: [tablet] } : e)) }
        : m.roles;
      m = { ...m, roles, version: v, prevManifestHash: manifestRevisionHashOf(cbor), revisedAt: m.revisedAt + 60 };
      cbor = encodeManifest(m);
      history.push({ version: v, cbor });
    }
  }, 120000);

  it('lets the restore\'s timeout fire: the scan yields between revisions and stops once aborted', async () => {
    // Owner 3 before their device: no attestation in 699 distinct revisions.
    const unbound = history.slice(0, BOUND_AT - 1);
    const controller = new AbortController();
    const query = await queryFor(2, unbound, controller.signal);
    setTimeout(() => controller.abort(), 50);
    const started = performance.now();
    expect(await verifyOwnAttestationInManifests(query)).toEqual({ verified: false });
    expect(performance.now() - started).toBeLessThan(1000);
    // Through a restore with a short timeout: timers keep running while it waits.
    let ticks = 0;
    const ticker = setInterval(() => {
      ticks++;
    }, 10);
    try {
      expect(await restoreAs(2, unbound, 100)).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
    } finally {
      clearInterval(ticker);
    }
    expect(ticks).toBeGreaterThanOrEqual(3);
  });

  it('verifies an honest long history well inside the default timeout, dated by the earliest revision holding the binding', async () => {
    for (const [i, recordedAtMs] of [[0, dateOf(1)], [1, dateOf(1)], [2, dateOf(BOUND_AT)]] as const) {
      const query = await queryFor(i, history);
      const started = performance.now();
      expect(await verifyOwnAttestationInManifests(query)).toMatchObject({ verified: true, recordedAtMs, attestingDeviceRemoved: false });
      expect(performance.now() - started).toBeLessThan(ATTESTATION_TIMEOUT_MS / 5);
    }
    expect(await restoreAs(2, history)).toMatchObject({
      ownAttestation: { verified: true, recordedAtMs: dateOf(BOUND_AT), attestingDeviceRemoved: false },
      depositsBlocked: false,
    });
  });

  it('decodes repeated bytes once, and counts a revision only at its own version', async () => {
    const copies = Array.from({ length: 3000 }, (_, k) => ({ version: k + 1, cbor: history[0].cbor }));
    const [third, first] = [await queryFor(2, copies), await queryFor(0, copies)];
    const started = performance.now();
    expect(await verifyOwnAttestationInManifests(third)).toEqual({ verified: false });
    expect(await verifyOwnAttestationInManifests(first)).toMatchObject({ verified: true, recordedAtMs: dateOf(1), attestingDeviceRemoved: false });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('reports an attesting device removed later and keeps deposits blocked until the verification is redone', async () => {
    const { manifest, people: tp, id } = fx;
    const laptop = manifest.roles.owners[0].devices[0];
    const v2 = nextRevisionRemovingDevice(manifest, { deviceId: laptop.deviceId, removal: removalBy(tp[0], id, laptop), revisedAt: manifest.revisedAt + 86400 });
    const v1v2 = [{ version: 1, cbor: encodeManifest(manifest) }, { version: 2, cbor: encodeManifest(v2) }];
    expect(await restoreAs(0, v1v2)).toMatchObject({
      ownAttestation: { verified: true, recordedAtMs: dateOf(1), attestingDeviceRemoved: true },
      depositsBlocked: true,
    });
    // Without the revision that held it, there is no attestation at all.
    expect(await restoreAs(0, v1v2.slice(1))).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
    // A device bound again with a fresh attestation lifts the block, dated by its own revision.
    const tablet = await signedBinding({ vaultId: id, role: 'owner', participant: tp[0], device: 21 });
    const v3 = nextManifestRevision(v2, {
      roles: { owners: v2.roles.owners.map(e => (e.credential === tp[0].credential ? { ...e, devices: [tablet] } : e)) },
      revisedAt: v2.revisedAt + 60,
    });
    expect(await restoreAs(0, [...v1v2, { version: 3, cbor: encodeManifest(v3) }])).toMatchObject({
      ownAttestation: { verified: true, recordedAtMs: v3.revisedAt * 1000, attestingDeviceRemoved: false },
      depositsBlocked: false,
    });
  });

  it('never dates an attestation after the package was exported: the recorded date is not signed', async () => {
    const late = { ...fx.manifest, revisedAt: 99_999_999_999 };
    const contents = { ...(await standardContents(people, 0)), manifests: [{ version: 1, cbor: encodeManifest(late) }] };
    expect(contents.exportedAtMs).toBe(EXPORTED_AT_MS);
    expect(candidateOf(await restoreVaultFromPackage(contents, { roleKeys: people[0], chain: nothing }))).toMatchObject({
      ownAttestation: { verified: true, recordedAtMs: EXPORTED_AT_MS, attestingDeviceRemoved: false },
      depositsBlocked: false,
    });
  });
});
