// The recovery export and import flows end to end through the real package library and the real
// vault store (fake IndexedDB): every state the dialogs show, and every typed error.
import 'fake-indexeddb/auto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// A fast stand-in for Argon2id that still depends on the passphrase, the salt and every parameter;
// the real derivation runs in the library's own vectors spec.
vi.mock('@noble/hashes/argon2.js', async () => {
  const { blake2b } = await import('@noble/hashes/blake2.js');
  return {
    argon2idAsync: vi.fn(async (password: Uint8Array, salt: Uint8Array, opts: { m: number; t: number; p: number; dkLen: number; version: number }) => {
      const params = new TextEncoder().encode(`|${opts.m}|${opts.t}|${opts.p}|${opts.version}|`);
      return blake2b(new Uint8Array([...password, ...params, ...salt]), { dkLen: opts.dkLen });
    }),
  };
});

import Dexie from 'dexie';
import { Cardano } from '@cardano-sdk/core';
import { blake2b } from '@noble/hashes/blake2.js';
import {
  exportRecoveryPackage,
  openRecoveryPackage,
  restoreVaultFromPackage,
  type RoleKeys,
  type VaultNetwork,
} from '@/shared/gerovault';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import { PLUTUS_VALIDATOR, plutusContents, vectorPeople } from '@/shared/gerovault/__fixtures__/recoveryPackageVectors';
import { clearDbCache } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import type { VaultChainReader } from '@/modules/gerovault/contracts';
import { RoleKeysError, unavailableRoleKeysSource, type VaultRoleKeysSource } from '@/modules/gerovault/detail/roleKeys';
import { mockReader, utxo, vaultFixture, type VaultFixture } from '@/modules/gerovault/detail/__fixtures__/vaultFixtures';
import { readRecoveryExport, recoveryFileName } from './exportRecord';
import { recoveryContentsFromRecord } from './packageContents';
import { exportErrorOf, useRecoveryExport } from './useRecoveryExport';
import { fileRefusalError, readPackageFile, useRecoveryImport, type RecoveryImportDeps } from './useRecoveryImport';

const PASS = 'a passphrase for the screen tests';
let f: VaultFixture;

beforeAll(async () => {
  f = await vaultFixture();
});

let nextWallet = 309100;
const wallets: number[] = [];
function walletId(): number {
  const id = nextWallet++;
  wallets.push(id);
  return id;
}

afterEach(async () => {
  localStorage.clear();
  for (const id of wallets.splice(0)) {
    clearDbCache(id);
    await Dexie.delete(`wallet-${id}`);
  }
});

/** A role keys source that answers with `keys`, behind a spending password when one is given. */
function source(keys: RoleKeys, password?: string): VaultRoleKeysSource & { calls: number } {
  const s = {
    calls: 0,
    needsSpendingPassword: password !== undefined,
    roleKeys: async ({ spendingPassword }: { walletId: number; spendingPassword?: string }) => {
      s.calls++;
      if (password !== undefined && spendingPassword !== password) throw new RoleKeysError('WRONG_PASSWORD', 'wrong');
      return keys;
    },
  };
  return s;
}

const fileOf = (bytes: Uint8Array, name = 'vault.gvr') => ({ size: bytes.length, name, arrayBuffer: async () => bytes.slice().buffer });

describe('recovery export', () => {
  function exportFlow(keys: VaultRoleKeysSource, wallet = 7) {
    const download = vi.fn<(bytes: Uint8Array, name: string) => void>();
    const flow = useRecoveryExport(() => f.record, { walletId: () => wallet, roleKeys: keys, download, now: () => 1_800_000_500_000 });
    return { flow, download };
  }

  it('with a generated passphrase: four groups, a random one retyped, then the file', async () => {
    const { flow, download } = exportFlow(source(f.people[0].roleKeys));
    expect(flow.step.value).toBe('choose');
    flow.chooseGenerated();
    expect(flow.step.value).toBe('write');
    expect(flow.groups.value).toHaveLength(4);
    flow.toConfirm();
    expect(flow.step.value).toBe('confirm');
    expect(flow.confirmIndex.value).toBeGreaterThanOrEqual(0);
    expect(flow.confirmIndex.value).toBeLessThan(4);

    flow.confirmInput.value = '0000';
    await flow.runExport();
    expect(flow.confirmFailed.value).toBe(true);
    expect(flow.step.value).toBe('confirm');
    expect(download).not.toHaveBeenCalled();

    flow.confirmInput.value = flow.groups.value[flow.confirmIndex.value]!.toLowerCase();
    const passphrase = flow.generated.value;
    await flow.runExport();
    expect(flow.step.value).toBe('done');
    expect(download).toHaveBeenCalledTimes(1);
    const [bytes, name] = download.mock.calls[0]!;
    expect(name).toBe(recoveryFileName(f.id));
    expect(flow.result.value).toMatchObject({ fileName: name, bytes: bytes.length });
    expect(readRecoveryExport(7, f.id)).toEqual({ exportedAt: 1_800_000_500_000, manifestVersion: null, manifestHash: null });

    // The file opens with the passphrase and restores to this very vault.
    const opened = await openRecoveryPackage(bytes, passphrase);
    expect(opened.ok).toBe(true);
    if (opened.ok !== true) return;
    expect(opened.package.participants.map(p => p.label).filter(Boolean).sort()).toEqual(['Alice', 'Bob']);
    const restored = await restoreVaultFromPackage(opened.package, { roleKeys: f.people[0].roleKeys, chain: { network: 'preprod' } });
    expect(restored.ok === true && restored.candidate.vaultId).toBe(f.id);

    flow.downloadAgain();
    expect(download).toHaveBeenCalledTimes(2);
    flow.reset();
    expect(flow.generated.value).toBe('');
    expect(flow.step.value).toBe('choose');
  });

  it('with the user\'s own passphrase of at least 16 code points', async () => {
    const { flow, download } = exportFlow(source(f.people[0].roleKeys));
    flow.chooseOwn();
    expect(flow.step.value).toBe('own');
    flow.ownPassphrase.value = 'too short';
    flow.ownRepeat.value = 'too short';
    expect(flow.ownCheck.value.problem).toBe('TOO_SHORT');
    expect(flow.canExport.value).toBe(false);
    flow.ownPassphrase.value = PASS;
    flow.ownRepeat.value = `${PASS}x`;
    expect(flow.ownCheck.value.problem).toBe('MISMATCH');
    flow.ownRepeat.value = PASS;
    expect(flow.canExport.value).toBe(true);
    await flow.runExport();
    expect(flow.step.value).toBe('done');
    expect((await openRecoveryPackage(download.mock.calls[0]![0], PASS)).ok).toBe(true);
  });

  it('asks for the spending password when the keys need it, and keeps the step on a wrong one', async () => {
    const keys = source(f.people[0].roleKeys, 'right password');
    const { flow } = exportFlow(keys);
    flow.chooseOwn();
    flow.ownPassphrase.value = PASS;
    flow.ownRepeat.value = PASS;
    expect(flow.needsPassword.value).toBe(true);
    expect(flow.canExport.value).toBe(false);
    flow.spendingPassword.value = 'wrong';
    await flow.runExport();
    expect(flow.step.value).toBe('own');
    expect(flow.error.value).toBe('WRONG_PASSWORD');
    flow.spendingPassword.value = 'right password';
    await flow.runExport();
    expect(flow.step.value).toBe('done');
    expect(flow.spendingPassword.value).toBe('');
  });

  it('fails with a typed error when the keys are unavailable or the seed is another participant\'s', async () => {
    const unavailable = exportFlow(unavailableRoleKeysSource).flow;
    unavailable.chooseOwn();
    unavailable.ownPassphrase.value = PASS;
    unavailable.ownRepeat.value = PASS;
    await unavailable.runExport();
    expect(unavailable.step.value).toBe('failed');
    expect(unavailable.error.value).toBe('KEYS_UNAVAILABLE');

    const other = exportFlow(source(f.people[1].roleKeys)).flow;
    other.chooseOwn();
    other.ownPassphrase.value = PASS;
    other.ownRepeat.value = PASS;
    await other.runExport();
    expect(other.error.value).toBe('SEED_MISMATCH');
    expect(readRecoveryExport(7, f.id)).toBeUndefined();
  });

  it('maps every other failure to FAILED', () => {
    expect(exportErrorOf(new Error('x'))).toBe('FAILED');
    expect(exportErrorOf(new RoleKeysError('LOCKED', 'x'))).toBe('LOCKED');
  });
});

describe('recovery import', () => {
  let packageFile: Uint8Array;

  beforeAll(async () => {
    packageFile = (await exportRecoveryPackage(recoveryContentsFromRecord(f.record, 1_800_000_000_000), PASS, f.people[0].roleKeys)).file;
  });

  function importFlow(options: {
    keys?: VaultRoleKeysSource;
    network?: VaultNetwork;
    reader?: VaultChainReader;
    plutusState?: RecoveryImportDeps['plutusState'];
  } = {}) {
    const id = walletId();
    const flow = useRecoveryImport({
      wallet: () => ({ walletId: id, network: options.network ?? 'preprod' }),
      store: vaultStore,
      chainReader: () => options.reader ?? mockReader({ utxos: [utxo(f.address, 1, 4_000_000n)] }),
      roleKeys: options.keys ?? source(f.people[0].roleKeys),
      ...(options.plutusState ? { plutusState: options.plutusState } : {}),
    });
    return { flow, id };
  }

  it('refuses a file that is not a package, or too large, before asking for a passphrase', async () => {
    const { flow } = importFlow();
    await flow.pickFile(fileOf(new TextEncoder().encode('{"type":"gero-vault/v1|witnesses"}')));
    expect(flow.step.value).toBe('pick');
    expect(flow.error.value).toBe('NOT_A_PACKAGE');
    expect(await readPackageFile({ size: 17 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) })).toBe('TOO_LARGE');
    expect(await readPackageFile({ size: 1, arrayBuffer: async () => { throw new Error('gone'); } })).toBe('UNREADABLE_FILE');
  });

  it('names a wrong passphrase and lets the user type it again', async () => {
    const { flow } = importFlow();
    await flow.pickFile(fileOf(packageFile));
    expect(flow.step.value).toBe('unlock');
    expect(flow.canUnlock.value).toBe(false);
    flow.passphrase.value = 'not the passphrase at all';
    await flow.unlock();
    expect(flow.step.value).toBe('unlock');
    expect(flow.error.value).toBe('WRONG_PASSPHRASE');
    flow.passphrase.value = PASS;
    await flow.unlock();
    expect(flow.step.value).toBe('review');
    expect(flow.error.value).toBeUndefined();
  });

  it('calls a damaged file damaged', async () => {
    const damaged = packageFile.slice();
    damaged[damaged.length - 1] ^= 0x01;
    const { flow } = importFlow();
    await flow.pickFile(fileOf(damaged));
    flow.passphrase.value = PASS;
    await flow.unlock();
    expect(flow.step.value).toBe('failed');
    expect(flow.error.value).toBe('DAMAGED');
    expect(fileRefusalError('TRUNCATED')).toBe('DAMAGED');
    expect(fileRefusalError('KDF_TOO_WEAK')).toBe('UNKNOWN_VERSION');
  });

  it('restores a quarantined candidate with deposits blocked and the chain state as information', async () => {
    const reader = mockReader({ utxos: [utxo(f.address, 1, 4_000_000n)] });
    const { flow } = importFlow({ reader });
    await flow.pickFile(fileOf(packageFile));
    flow.passphrase.value = PASS;
    await flow.unlock();
    const c = flow.candidate.value;
    expect(flow.step.value).toBe('review');
    expect(c?.vaultId).toBe(f.id);
    expect(c?.status).toBe('candidate');
    expect(c?.depositsBlocked).toBe(true);
    expect(c?.chainState).toMatchObject({ funded: true, registered: false });
    expect(c?.self).toMatchObject({ position: 0, index: f.people[0].index, role: 'owner' });
    expect(reader.utxos).toHaveBeenCalledWith(f.address, expect.anything());
    expect(flow.chainView.value).toEqual({ registrationChecked: false, utxosRead: true, historyRead: true });
    expect(flow.held.value).toBeUndefined();
  });

  it('keeps the candidate in the store as restored, with its labels, and accepts only on confirmation', async () => {
    const { flow, id } = importFlow();
    await flow.pickFile(fileOf(packageFile));
    flow.passphrase.value = PASS;
    await flow.unlock();

    expect(await flow.acceptCandidate()).toBeUndefined();
    expect(await vaultStore.get(id, f.id)).toBeUndefined();

    const kept = await flow.saveCandidate();
    expect(flow.step.value).toBe('saved');
    expect(kept).toMatchObject({ vaultId: f.id, status: 'candidate', origin: 'restored', ownIndex: f.people[0].index, manifest: null });
    expect(kept?.participants.filter(p => p.self)).toHaveLength(1);
    expect(kept?.participants.find(p => p.self)?.label).toBe('Alice');
    expect(kept?.participants.map(p => p.label).filter(Boolean).sort()).toEqual(['Alice', 'Bob']);

    flow.agreed.value = true;
    const accepted = await flow.acceptCandidate();
    expect(flow.step.value).toBe('accepted');
    expect(accepted?.status).toBe('accepted');
    expect((await vaultStore.get(id, f.id))?.status).toBe('accepted');
  });

  it('says when this wallet already holds the vault', async () => {
    const { flow, id } = importFlow();
    await flow.pickFile(fileOf(packageFile));
    flow.passphrase.value = PASS;
    await flow.unlock();
    await flow.saveCandidate();

    const again = useRecoveryImport({
      wallet: () => ({ walletId: id, network: 'preprod' }),
      store: vaultStore,
      chainReader: () => mockReader(),
      roleKeys: source(f.people[0].roleKeys),
    });
    await again.pickFile(fileOf(packageFile));
    again.passphrase.value = PASS;
    await again.unlock();
    expect(again.held.value?.vaultId).toBe(f.id);
    await again.saveCandidate();
    expect(again.error.value).toBe('ALREADY_HELD');
  });

  it('refuses a package for a network this version keeps closed, on a wallet of that network too', async () => {
    const people = await vectorPeople();
    const closed = (await exportRecoveryPackage(await plutusContents(people), PASS, people[0])).file;
    const id = walletId();
    const flow = useRecoveryImport({
      wallet: () => ({ walletId: id, network: 'preview' }),
      store: vaultStore,
      chainReader: () => mockReader(),
      roleKeys: source(people[0]),
    });
    await flow.pickFile(fileOf(closed));
    flow.passphrase.value = PASS;
    await flow.unlock();
    expect(flow.error.value).toBe('NETWORK_CLOSED');
    expect(flow.step.value).toBe('failed');
  });

  it('refuses a package for another network or another seed', async () => {
    const preview = importFlow({ network: 'preview' }).flow;
    await preview.pickFile(fileOf(packageFile));
    preview.passphrase.value = PASS;
    await preview.unlock();
    expect(preview.error.value).toBe('OTHER_NETWORK');

    const other = importFlow({ keys: source(f.people[1].roleKeys) }).flow;
    await other.pickFile(fileOf(packageFile));
    other.passphrase.value = PASS;
    await other.unlock();
    expect(other.step.value).toBe('failed');
    expect(other.error.value).toBe('SEED_MISMATCH');

    const noKeys = importFlow({ keys: unavailableRoleKeysSource }).flow;
    await noKeys.pickFile(fileOf(packageFile));
    noKeys.passphrase.value = PASS;
    await noKeys.unlock();
    expect(noKeys.error.value).toBe('KEYS_UNAVAILABLE');
  });

  it('asks for the spending password when the keys need it', async () => {
    const { flow } = importFlow({ keys: source(f.people[0].roleKeys, 'pw') });
    await flow.pickFile(fileOf(packageFile));
    flow.passphrase.value = PASS;
    expect(flow.canUnlock.value).toBe(false);
    flow.spendingPassword.value = 'nope';
    await flow.unlock();
    expect(flow.step.value).toBe('unlock');
    expect(flow.error.value).toBe('WRONG_PASSWORD');
    flow.spendingPassword.value = 'pw';
    await flow.unlock();
    expect(flow.step.value).toBe('review');
  });

  it('reset drops the file, the passphrase and every result', async () => {
    const { flow } = importFlow();
    await flow.pickFile(fileOf(packageFile));
    flow.passphrase.value = PASS;
    await flow.unlock();
    flow.reset();
    expect(flow.step.value).toBe('pick');
    expect(flow.passphrase.value).toBe('');
    expect(flow.candidate.value).toBeUndefined();
    expect(flow.canUnlock.value).toBe(false);
  });
});

describe('recovery import of a Plutus vault', () => {
  let people: RoleKeys[];
  let file: Uint8Array;
  const h = bytesToHex(blake2b(Uint8Array.from([3, ...(hexToBytes(PLUTUS_VALIDATOR) as Uint8Array)]), { dkLen: 28 }));
  const stateUtxo = (address: string): Cardano.Utxo => [
    { txId: Cardano.TransactionId('1'.repeat(64)), index: 0, address: Cardano.PaymentAddress(address) },
    {
      address: Cardano.PaymentAddress(address),
      value: { coins: 2_000_000n, assets: new Map([[Cardano.AssetId(`${h}${Buffer.from('state').toString('hex')}`), 1n]]) },
    },
  ];

  beforeAll(async () => {
    people = await vectorPeople();
    // The vector is a preview vault; the slice restores preprod packages only.
    file = (await exportRecoveryPackage({ ...(await plutusContents(people)), network: 'preprod' }, PASS, people[0])).file;
  });

  async function run(reader: VaultChainReader, plutusState?: RecoveryImportDeps['plutusState']) {
    const id = walletId();
    const flow = useRecoveryImport({
      wallet: () => ({ walletId: id, network: 'preprod' }),
      store: vaultStore,
      chainReader: () => reader,
      roleKeys: source(people[0]),
      ...(plutusState ? { plutusState } : {}),
    });
    await flow.pickFile(fileOf(file));
    flow.passphrase.value = PASS;
    await flow.unlock();
    return flow;
  }

  it('says vault not found when no state UTxO is at its address', async () => {
    const flow = await run(mockReader());
    expect(flow.step.value).toBe('notFound');
    expect(flow.plutus.value?.scriptHash).toBe(h);
  });

  it('says the state is not readable here when the vault is found', async () => {
    const reader = mockReader();
    reader.utxos.mockImplementation(async (address: string) => [stateUtxo(address)]);
    const flow = await run(reader);
    expect(flow.step.value).toBe('plutusUnreadable');
    expect(flow.plutus.value?.templateVerified).toBe(false);
  });

  it('shows a retired vault\'s destination, for display only', async () => {
    const reader = mockReader();
    reader.utxos.mockImplementation(async (address: string) => [stateUtxo(address)]);
    const to = f.address;
    const flow = await run(reader, async () => ({ kind: 'retired', to, deregistrationFromMs: 1_900_000_000_000 }));
    expect(flow.step.value).toBe('retired');
    expect(flow.retired.value).toEqual({ kind: 'retired', to, deregistrationFromMs: 1_900_000_000_000 });
  });
});
