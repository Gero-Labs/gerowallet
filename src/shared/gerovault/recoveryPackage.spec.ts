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
import { MAX_ADDRESS_BOOK_ENTRIES, MAX_PROPOSALS, RecoveryPackage, RecoveryPackageContents, encodeRecoveryPayload, manifestRevisionHash } from './recoveryPayload';
import {
  OwnAttestationQuery,
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
} from './recoveryPackage';
import { RegistrationInput, encodeRegistration } from './registration';
import { buildVaultFromParticipants, vaultAddresses } from './scripts';
import { vaultId } from './vaultId';
import { RoleKeys, VaultScripts } from './types';
import { testCosignerAccount } from './__fixtures__/vectors';
import {
  BACKUP_OPENS_AT_MS,
  ENDORSEMENT,
  EXTERNAL_ATTESTATION,
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
      manifestsDropped: 0,
      skipped: { manifests: 0, proposals: 0, addressBook: 0, participantLabels: 0 },
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
      manifests: [{ version: 1, cbor: 'a0' }, { version: 2, cbor: 'zz' }],
      proposals: [{ id: '01', cbor: 'ab' }, { id: '01', cbor: 'cd' }, { id: '02', cbor: 'ab'.repeat(65537) }],
      addressBook: [
        { address: addr(1), label: 'a' },
        { address: addr(1), label: 'b' },
        { address: addr(2), label: 'x'.repeat(65) },
        { address: mainnet, label: 'm' },
      ],
      participants: [{ ...contents.participants[0], label: 'Bob' + String.fromCharCode(0x202e) }, ...contents.participants.slice(1)],
    }, PASS, people[0]);
    expect(exported.skipped).toEqual({ manifests: 1, proposals: 2, addressBook: 3, participantLabels: 1 });
    expect(exported).toMatchObject({ manifestsDropped: 1, proposalsDropped: 2, addressBookDropped: 3, proposalHistoryTruncated: true, addressBookTruncated: true });
    const result = await openRecoveryPackage(exported.file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.proposals).toEqual([{ id: '01', cbor: 'cd' }]);
    expect(result.package.addressBook).toEqual([{ address: addr(1), label: 'b' }]);
    expect(result.package.participants[0].label).toBeUndefined();
  });

  it('carries the endorsements and external attestations as they are', async () => {
    const pkg = await opened(await backupContents(people));
    expect(pkg.endorsements).toEqual([ENDORSEMENT]);
    expect(pkg.externalAttestations).toEqual([EXTERNAL_ATTESTATION]);
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
        return { verified: true, acceptedAtMs: 1795000000000, vaultId: q.vaultId, credential: q.credential };
      },
    }));
    expect(verified).toMatchObject({ ownAttestation: { verified: true, acceptedAtMs: 1795000000000, vaultId: id, credential }, depositsBlocked: false });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({ network: 'preprod', vaultId: id, vaultKeys: own, credential });
    expect(queries[0].scripts.payment.hash).toBe(backup.payment.hash);
    expect(queries[0].scripts.stake.hash).toBe(backup.stake.hash);
    expect(queries[0].participants).toEqual(pkg.participants);
    expect(queries[0].manifests).toEqual(pkg.manifests);
    expect(queries[0].signal.aborted).toBe(true); // released once the restore stopped waiting
    for (const hook of [
      async () => { throw new Error('verifier down'); },
      async () => ({ verified: true, acceptedAtMs: 1 }) as never,
      async () => ({ verified: 'yes', acceptedAtMs: 1, vaultId: id, credential }) as never,
      async () => ({ verified: true, acceptedAtMs: 1, vaultId: id, credential: (await vaultKeyHashes(await deriveVaultPublicKeys(people[0], 1))).payment }),
      async () => undefined as never,
    ]) {
      const c = candidateOf(await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: onChain(backup), verifyOwnAttestation: hook }));
      expect(c).toMatchObject({ ownAttestation: { verified: false }, depositsBlocked: true });
    }
  });

  it('keeps deposits blocked when a careless verifier accepts an attestation copied from another vault', async () => {
    const pkg = await opened(await backupContents(people));
    // The restorer's own attestation, really made for the standard vault, which shares their key.
    const copied = { vaultId: vaultId(standard, 'preprod'), acceptedAtMs: 1795000000000 };
    const c = candidateOf(await restoreVaultFromPackage(pkg, {
      roleKeys: people[2],
      chain: onChain(backup),
      verifyOwnAttestation: async q => ({ verified: true, acceptedAtMs: copied.acceptedAtMs, vaultId: copied.vaultId, credential: q.credential }),
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
    expect(recoveryPackageStaleness({ manifests: [m(5, 'a1'), m(4, 'a0')] }, { version: 5, hash: manifestRevisionHash('a1') })).toEqual({ stale: false });
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
