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
import { deriveRoleKeys } from './keys';
import { sealRecoveryFile } from './recoveryFormat';
import { RecoveryPackage, RecoveryPackageContents, encodeRecoveryPayload } from './recoveryPayload';
import {
  RecoveryChainFacts,
  RestoreResult,
  exportRecoveryPackage,
  openRecoveryPackage,
  recoveryPackageStaleness,
  restoreVaultFromPackage,
} from './recoveryPackage';
import { DecodedRegistration, decodeRegistration, encodeRegistration } from './registration';
import { buildVaultFromParticipants, vaultAddresses } from './scripts';
import { vaultId } from './vaultId';
import { RoleKeys, VaultScripts } from './types';
import { testCosignerAccount } from './__fixtures__/vectors';
import {
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
let standard: VaultScripts;
let backup: VaultScripts;

function registered(vault: Pick<VaultScripts, 'payment' | 'stake'>): DecodedRegistration {
  const reg = encodeRegistration(vault);
  const decoded = decodeRegistration({ metadata: { cbor: reg.offChain.metadata }, nativeScripts: { cbor: reg.offChain.native_scripts } });
  if (decoded.ok !== true) throw new Error(decoded.code);
  return decoded.registration;
}

/** A registration of two scripts that need not belong together. */
function registeredPair(paymentCbor: string, stakeCbor: string): DecodedRegistration {
  const decoded = decodeRegistration({ metadata: { json: { types: [0, 2] } }, nativeScripts: { cbors: [paymentCbor, stakeCbor] } });
  if (decoded.ok !== true) throw new Error(decoded.code);
  return decoded.registration;
}

const onChain = (...vaults: Pick<VaultScripts, 'payment' | 'stake'>[]): RecoveryChainFacts => ({
  network: 'preprod',
  registrations: vaults.map(registered),
});

async function opened(contents: RecoveryPackageContents): Promise<RecoveryPackage> {
  const result = await openRecoveryPackage(await exportRecoveryPackage(contents, PASS), PASS);
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

beforeAll(async () => {
  people = await vectorPeople();
  outsider = await deriveRoleKeys(await testCosignerAccount(3));
  standard = await standardVault(people);
  backup = await backupVault(people);
});

beforeEach(() => {
  kdf.mockClear();
});

describe('export', () => {
  it('seals, then opens the file once with the passphrase before returning it', async () => {
    const contents = await standardContents(people);
    const file = await exportRecoveryPackage(contents, PASS);
    expect(kdf).toHaveBeenCalledTimes(2);
    const again = await exportRecoveryPackage(contents, PASS);
    expect(Buffer.from(again).equals(Buffer.from(file))).toBe(false);
    const result = await openRecoveryPackage(file, PASS);
    if (result.ok !== true) throw new Error(result.code);
    expect(result.package.participants).toEqual(contents.participants);
  });

  it('fails when the file does not open again to the same payload', async () => {
    const contents = await standardContents(people);
    const real = kdf.getMockImplementation();
    if (!real) throw new Error('no stand-in');
    kdf.mockImplementationOnce(real).mockImplementationOnce(async () => new Uint8Array(32).fill(9));
    await expect(exportRecoveryPackage(contents, PASS)).rejects.toMatchObject({ code: 'PACKAGE_CHECK_FAILED' });
  });

  it('refuses a passphrase that cannot be one before any derivation', async () => {
    const contents = await standardContents(people);
    for (const bad of ['', '\uDFFF', undefined]) {
      await expect(exportRecoveryPackage(contents, bad as string)).rejects.toMatchObject({ code: 'INVALID_PASSPHRASE' });
    }
    expect(kdf).not.toHaveBeenCalled();
  });

  it('refuses contents whose scripts do not rebuild from their keys, roles and terms', async () => {
    const contents = await standardContents(people);
    const foreign = { ...contents, participants: [contents.participants[0], await participantAt(outsider, 1, 'owner'), contents.participants[2]] };
    await expect(exportRecoveryPackage(foreign, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const missing = { ...contents, participants: contents.participants.slice(0, 2) };
    await expect(exportRecoveryPackage(missing, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const role = { ...contents, participants: [contents.participants[0], { ...contents.participants[1], role: 'backup' as const }, contents.participants[2]] };
    await expect(exportRecoveryPackage(role, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('roles') });

    const withBackup = await backupContents(people);
    if (withBackup.vault.kind !== 'native' || contents.vault.kind !== 'native') throw new Error('native');
    const noTerms = { ...withBackup, vault: { ...withBackup.vault, backup: undefined } };
    await expect(exportRecoveryPackage(noTerms, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('backup terms') });
    const otherSlot = { ...withBackup, vault: { ...withBackup.vault, backup: { threshold: 1, afterSlot: 200_000_001, atMs: 0 } } };
    await expect(exportRecoveryPackage(otherSlot, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('backup terms') });
    const otherThreshold = { ...withBackup, vault: { ...withBackup.vault, backup: { threshold: 2, afterSlot: 200_000_000, atMs: 0 } } };
    await expect(exportRecoveryPackage(otherThreshold, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE' });
    const stray = { ...contents, vault: { ...contents.vault, backup: { threshold: 1, afterSlot: 1, atMs: 0 } } };
    await expect(exportRecoveryPackage(stray, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('backup terms') });
  });

  it('refuses an external key that does not derive the vault keys recorded with it', async () => {
    const contents = await backupContents(people);
    const wrong = { ...contents, participants: [contents.participants[0], { ...contents.participants[1], external: externalRoleKeys(outsider) }, contents.participants[2]] };
    await expect(exportRecoveryPackage(wrong, PASS)).rejects.toMatchObject({ code: 'INVALID_PACKAGE', message: expect.stringContaining('external') });
  });

  it('exports a Plutus package: its fields are kept for the derivation to come', async () => {
    const pkg = await opened(await plutusContents(people));
    expect(pkg.vault).toMatchObject({ kind: 'plutus', templateVersion: 1, seed: { index: 3 } });
  });
});

describe('open', () => {
  it('refuses a wrong passphrase, a truncated or tampered file and unknown versions, and loses nothing', async () => {
    const file = await exportRecoveryPackage(await standardContents(people), PASS);
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
    expect(later[2]).toBe(0x01); // aa 00 01: the payload version
    later[2] = 0x02;
    const r1 = await openRecoveryPackage(await sealRecoveryFile(later, PASS), PASS);
    expect(r1).toMatchObject({ ok: false, code: 'UNKNOWN_PAYLOAD_VERSION' });
    const r2 = await openRecoveryPackage(await sealRecoveryFile(new Uint8Array([0xa0]), PASS), PASS);
    expect(r2).toMatchObject({ ok: false, code: 'PAYLOAD_INVALID' });
  });
});

describe('restore of a native vault', () => {
  it('every participant restores the vault from their own package and seed', async () => {
    const expectedId = vaultId(standard, 'preprod');
    for (let i = 0; i < people.length; i++) {
      const pkg = await opened(await standardContents(people, i));
      const r = await restoreVaultFromPackage(pkg, { roleKeys: people[i], chain: onChain(standard) });
      if (r.ok !== true) throw new Error(r.code);
      expect(r.vault.vaultId).toBe(expectedId);
      expect(r.vault.addresses).toEqual(vaultAddresses(standard, 'preprod'));
      expect(r.vault.scripts.payment.cbor).toBe(standard.payment.cbor);
      expect(r.vault.self).toEqual({ position: i, index: 1, role: 'owner' });
      expect(r.vault.evidence).toBe('registration');
      expect(r.vault.canonicalOrder).toBe(true);
      expect(r.vault.backup).toBeUndefined();
    }
  });

  it('a backup holder rebuilds the dated backup path from their package alone', async () => {
    const pkg = await opened(await backupContents(people));
    const r = await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: onChain(backup) });
    if (r.ok !== true) throw new Error(r.code);
    expect(r.vault.self.role).toBe('backup');
    expect(r.vault.scripts.template).toEqual({ kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 200_000_000 });
    expect(r.vault.backup).toEqual({ threshold: 1, afterSlot: 200_000_000, atMs: 1858852800000 });
    expect(r.vault.addresses.base).toBe(vaultAddresses(backup, 'preprod').base);
  });

  it('accepts scripts the chain revealed when there is no registration', async () => {
    const pkg = await opened(await backupContents(people));
    const r = await restoreVaultFromPackage(pkg, {
      roleKeys: people[2],
      chain: { network: 'preprod', registrations: [], revealedScripts: [backup.stake.cbor, standard.payment.cbor, backup.payment.cbor] },
    });
    expect(r).toMatchObject({ ok: true, vault: { evidence: 'revealed' } });
    const half = await restoreVaultFromPackage(pkg, { roleKeys: people[2], chain: { network: 'preprod', registrations: [], revealedScripts: [backup.payment.cbor] } });
    expect(code(half)).toBe('NOT_ON_CHAIN');
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
    const r = await restoreVaultFromPackage(await opened(contents), { roleKeys: people[2], chain: onChain(vault) });
    if (r.ok !== true) throw new Error(r.code);
    expect(r.vault.self.index).toBe(7);
    expect(r.vault.warnings).toEqual(['ALL_OWNERS_REQUIRED']);
    expect(r.vault.vaultId).toBe(vaultId(vault, 'preprod'));
  });

  it('refuses a seed that is not the exporter\'s', async () => {
    const pkg = await opened(await standardContents(people, 0));
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[1], chain: onChain(standard) }))).toBe('SEED_MISMATCH');
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: outsider, chain: onChain(standard) }))).toBe('SEED_MISMATCH');
    // The right seed with an index the package does not record for it.
    const wrongIndex = await opened({ ...(await standardContents(people, 0)), self: { position: 0, index: 2 } });
    expect(code(await restoreVaultFromPackage(wrongIndex, { roleKeys: people[0], chain: onChain(standard) }))).toBe('SEED_MISMATCH');
  });

  it('refuses chain facts for another network', async () => {
    const pkg = await opened(await standardContents(people));
    const r = await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { ...onChain(standard), network: 'preview' } });
    expect(code(r)).toBe('NETWORK_MISMATCH');
  });

  it('refuses a vault the chain does not show', async () => {
    const pkg = await opened(await standardContents(people));
    const unrelated = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [outsider, people[1]].map(roleKeys => ({ roleKeys, index: 5 })),
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [] } }))).toBe('NOT_ON_CHAIN');
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: onChain(unrelated) }))).toBe('NOT_ON_CHAIN');
  });

  it('refuses a package whose scripts do not match the chain', async () => {
    const pkg = await opened(await standardContents(people));
    // The chain pairs this vault's payment script with another stake script.
    const otherHalf = registeredPair(standard.payment.cbor, backup.stake.cbor);
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [otherHalf] } }))).toBe('CHAIN_MISMATCH');
    // The chain has the exporter's key at this index in another vault.
    const other = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: people[0], index: 1 }, { roleKeys: outsider, index: 1 }],
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain: onChain(other) }))).toBe('CHAIN_MISMATCH');
    // A matching registration wins over any number of others: anyone can publish one.
    const r = await restoreVaultFromPackage(pkg, {
      roleKeys: people[0],
      chain: { network: 'preprod', registrations: [otherHalf, registered(other), registered(standard), registered(standard)] },
    });
    expect(r).toMatchObject({ ok: true, vault: { evidence: 'registration' } });
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
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [], revealedScripts: ['zz'] } }],
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [], revealedScripts: ['abc'] } }],
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [], revealedScripts: [''] } }],
      [pkg, { roleKeys: people[0], chain: { network: 'preprod', registrations: [], revealedScripts: [42] } }],
    ];
    for (const [p, options] of cases) {
      const r = await restoreVaultFromPackage(p as RecoveryPackage, options as never);
      expect(code(r)).toBe('INVALID_INPUT');
    }
  });
});

describe('restore of a Plutus vault', () => {
  it('checks the seed, then stops: deriving h needs the audited template', async () => {
    const pkg = await opened(await plutusContents(people));
    const chain: RecoveryChainFacts = { network: 'preview', registrations: [] };
    expect(await restoreVaultFromPackage(pkg, { roleKeys: people[0], chain }))
      .toEqual({ ok: false, code: 'PLUTUS_TEMPLATE_UNAVAILABLE', detail: 'template version 1' });
    expect(code(await restoreVaultFromPackage(pkg, { roleKeys: people[1], chain }))).toBe('SEED_MISMATCH');
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
  });

  it('refuses a malformed latest revision', () => {
    for (const bad of [{ version: -1 }, { version: 1.5 }, { version: 1, hash: 'AB'.repeat(32) }, { version: 1, hash: 'ab' }]) {
      expect(() => recoveryPackageStaleness({ manifests: [] }, bad)).toThrow(expect.objectContaining({ code: 'INVALID_MANIFEST_REVISION' }));
    }
  });
});
