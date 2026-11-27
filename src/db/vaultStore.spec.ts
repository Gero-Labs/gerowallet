import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildVaultFromParticipants,
  encodeManifest,
  numberVerification,
  parseVaultPublicKeys,
  ROLE,
  vaultId,
  vaultScript,
  type VaultManifest,
  type VaultScripts,
} from '@/shared/gerovault';
import { vectorFixture, type TestParticipant } from '@/shared/gerovault/__fixtures__/manifest';
import type { VaultCandidateInput } from '@/modules/gerovault/contracts';
import { clearDbCache } from './wallet-db';
import { VaultStoreError, vaultStore } from './vaultStore';

let people: TestParticipant[];
let vault: VaultScripts;
let id: string;
let manifest: VaultManifest;
let other: { vault: VaultScripts; id: string };

beforeAll(async () => {
  ({ people, vault, id, manifest } = await vectorFixture());
  const otherVault = await buildVaultFromParticipants({
    template: { kind: 'standard', threshold: 2 },
    owners: people.slice(1, 4).map(p => ({ vaultKeys: p.vaultKeys })),
  });
  other = { vault: otherVault, id: vaultId(otherVault, 'preprod') };
});

let nextWallet = 207100;
const wallets: number[] = [];
function walletId(): number {
  const wallet = nextWallet++;
  wallets.push(wallet);
  return wallet;
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const wallet of wallets.splice(0)) {
    clearDbCache(wallet);
    await Dexie.delete(`wallet-${wallet}`);
  }
});

/** The vector vault (owners: people 0, 1 and 2, 2 of 3, preprod) as this wallet, person 0, adds it. */
function candidate(overrides: Partial<VaultCandidateInput> = {}): VaultCandidateInput {
  return {
    vaultId: id,
    network: 'preprod',
    origin: 'created',
    name: 'Treasury',
    paymentScriptCbor: vault.payment.cbor,
    stakeScriptCbor: vault.stake.cbor,
    participants: people.slice(0, 3).map((p, i) => ({ role: 'owner', vaultKeys: p.vaultKeys, label: `Owner ${i + 1}`, self: i === 0 })),
    ownIndex: 1,
    ...overrides,
  };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(VaultStoreError);
  return (error as VaultStoreError).code;
}

describe('vault store', () => {
  it('adds a candidate that reads back with its keys, scripts and times', async () => {
    const wallet = walletId();
    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
    const added = await vaultStore.addCandidate(wallet, candidate());
    expect(added).toMatchObject({
      recordVersion: 1,
      kind: 'native',
      vaultId: id,
      network: 'preprod',
      status: 'candidate',
      origin: 'created',
      name: 'Treasury',
      paymentScriptHash: vault.payment.hash,
      stakeScriptHash: vault.stake.hash,
      ownIndex: 1,
      manifest: null,
      verifications: [],
      createdAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_000,
      acceptedAt: null,
    });
    clearDbCache(wallet);
    const read = await vaultStore.get(wallet, id);
    expect(read).toEqual(added);
    expect(read!.participants.map(p => [p.credential, p.self, p.label])).toEqual(
      people.slice(0, 3).map((p, i) => [p.credential, i === 0, `Owner ${i + 1}`]),
    );
    for (const [i, participant] of read!.participants.entries()) {
      expect(participant.vaultKeys.payment).toMatch(/^addr_shared_vk1/);
      expect(parseVaultPublicKeys(participant.vaultKeys)).toEqual(people[i].vaultKeys);
    }
    expect(await vaultStore.list(wallet)).toEqual([added]);
  });

  it('keeps each wallet\'s vaults apart', async () => {
    const [mine, theirs] = [walletId(), walletId()];
    await vaultStore.addCandidate(mine, candidate());
    expect(await vaultStore.list(theirs)).toEqual([]);
    expect(await vaultStore.get(theirs, id)).toBeUndefined();
  });

  it('refuses a vault id the scripts and network do not give', async () => {
    const wallet = walletId();
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ vaultId: vaultId(vault, 'preview') })))).toBe('VAULT_ID_MISMATCH');
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ network: 'preview' })))).toBe('VAULT_ID_MISMATCH');
    expect(await vaultStore.list(wallet)).toEqual([]);
  });

  it('refuses scripts that are not a vault template or not the same one', async () => {
    const wallet = walletId();
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ paymentScriptCbor: 'zz' })))).toBe('INVALID_INPUT');
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ paymentScriptCbor: '8200581c' + '00'.repeat(28) })))).toBe('INVALID_INPUT');
    // A 2 of 4 stake script beside the 2 of 3 payment script.
    const wide = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: people.map(p => ({ vaultKeys: p.vaultKeys })),
    });
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ stakeScriptCbor: wide.stake.cbor })))).toBe('INVALID_INPUT');
    // Same shape, other keys: the scripts pass, the vault id does not.
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ stakeScriptCbor: other.vault.stake.cbor })))).toBe('VAULT_ID_MISMATCH');
  });

  it('refuses participants who are not exactly the scripts\' keys, or not one self', async () => {
    const wallet = walletId();
    const owners = people.slice(0, 3).map((p, i) => ({ role: 'owner' as const, vaultKeys: p.vaultKeys, self: i === 0 }));
    const cases: VaultCandidateInput['participants'][] = [
      owners.slice(0, 2),
      [...owners.slice(0, 2), { role: 'owner', vaultKeys: people[3].vaultKeys }],
      [...owners, { role: 'owner', vaultKeys: people[3].vaultKeys }],
      [owners[0], owners[1], { ...owners[2], role: 'backupHolder' }],
      owners.map(p => ({ ...p, self: false })),
      owners.map(p => ({ ...p, self: true })),
      [owners[0], owners[1], owners[1]],
    ];
    for (const participants of cases) {
      expect(await refusal(vaultStore.addCandidate(wallet, candidate({ participants })))).toBe('INVALID_INPUT');
    }
    expect(await vaultStore.list(wallet)).toEqual([]);
  });

  it('takes an imported vault whose stake credential is its payment script, and only an imported one', async () => {
    const wallet = walletId();
    const shared = { payment: vault.payment, stake: vaultScript(ROLE.STAKE, vault.payment.script) };
    const input = candidate({ origin: 'imported', stakeScriptCbor: shared.stake.cbor, vaultId: vaultId(shared, 'preprod') });
    expect(await refusal(vaultStore.addCandidate(wallet, { ...input, origin: 'created' }))).toBe('INVALID_INPUT');
    const record = await vaultStore.addCandidate(wallet, input);
    expect(record.stakeScriptHash).toBe(record.paymentScriptHash);
    // The participants still have to be exactly the script's keys.
    const outsider = candidate({
      origin: 'imported',
      stakeScriptCbor: shared.stake.cbor,
      vaultId: vaultId(shared, 'preprod'),
      participants: [...people.slice(0, 2), people[3]].map((p, i) => ({ role: 'owner' as const, vaultKeys: p.vaultKeys, self: i === 0 })),
    });
    expect(await refusal(vaultStore.addCandidate(walletId(), outsider))).toBe('INVALID_INPUT');
  });

  it('refuses a bad index, network, origin, label or wallet id', async () => {
    const wallet = walletId();
    for (const overrides of [
      { ownIndex: -1 }, { ownIndex: 2 ** 31 }, { ownIndex: 1.5 },
      { network: 'testnet' as never }, { origin: 'synced' as never }, { name: 'bad\u0000name' },
    ]) {
      expect(await refusal(vaultStore.addCandidate(wallet, candidate(overrides)))).toBe('INVALID_INPUT');
    }
    expect(await refusal(vaultStore.list(-1))).toBe('INVALID_INPUT');
    expect(await refusal(vaultStore.get(wallet, 'ABC'))).toBe('INVALID_INPUT');
  });

  it('takes this wallet at index 0, which the dApp signing guard then refuses as well', async () => {
    const wallet = walletId();
    expect((await vaultStore.addCandidate(wallet, candidate({ ownIndex: 0 }))).ownIndex).toBe(0);
  });

  it('refuses the same vault twice', async () => {
    const wallet = walletId();
    await vaultStore.addCandidate(wallet, candidate());
    expect(await refusal(vaultStore.addCandidate(wallet, candidate({ name: 'Again' })))).toBe('VAULT_EXISTS');
    expect((await vaultStore.get(wallet, id))!.name).toBe('Treasury');
  });

  it('accepts a candidate once, with the manifest of this vault only', async () => {
    const wallet = walletId();
    await vaultStore.addCandidate(wallet, candidate());
    await vaultStore.addCandidate(wallet, candidate({
      vaultId: other.id,
      paymentScriptCbor: other.vault.payment.cbor,
      stakeScriptCbor: other.vault.stake.cbor,
      participants: people.slice(1, 4).map((p, i) => ({ role: 'owner', vaultKeys: p.vaultKeys, self: i === 0 })),
    }));
    const bytes = encodeManifest(manifest);
    expect(await refusal(vaultStore.accept(wallet, other.id, { manifest: bytes }))).toBe('MANIFEST_INVALID');
    expect(await refusal(vaultStore.accept(wallet, id, { manifest: bytes.slice(0, -2) }))).toBe('MANIFEST_INVALID');

    vi.spyOn(Date, 'now').mockReturnValue(1_800_000_500_000);
    const accepted = await vaultStore.accept(wallet, id, { manifest: bytes });
    expect(accepted).toMatchObject({ status: 'accepted', acceptedAt: 1_800_000_500_000, updatedAt: 1_800_000_500_000 });
    expect(accepted.manifest).toMatchObject({ cbor: bytes, version: 1 });
    expect(await refusal(vaultStore.accept(wallet, id))).toBe('NOT_A_CANDIDATE');
    expect(await refusal(vaultStore.accept(wallet, 'ab'.repeat(32)))).toBe('NOT_FOUND');
    expect((await vaultStore.list(wallet, { status: 'accepted' })).map(v => v.vaultId)).toEqual([id]);
    expect((await vaultStore.list(wallet, { status: 'candidate' })).map(v => v.vaultId)).toEqual([other.id]);
    expect(await vaultStore.list(wallet, { network: 'preview' })).toEqual([]);
  });

  it('updates the name, labels, manifest and verification records, and nothing else', async () => {
    const wallet = walletId();
    await vaultStore.addCandidate(wallet, candidate());
    const record = numberVerification(manifest, people[1].credential, 1_800_000_000);
    const updated = await vaultStore.update(wallet, id, {
      name: null,
      labels: { [people[1].credential]: 'Bob', [people[2].credential]: null },
      manifest: encodeManifest(manifest),
      verifications: [record],
    });
    expect(updated.name).toBeUndefined();
    expect(updated.participants.map(p => p.label)).toEqual(['Owner 1', 'Bob', undefined]);
    expect(updated.manifest?.version).toBe(1);
    expect(updated.verifications).toEqual([record]);
    expect(await vaultStore.get(wallet, id)).toEqual(updated);

    // The same revision again is fine; scripts, keys and status are never patched.
    await vaultStore.update(wallet, id, { manifest: encodeManifest(manifest) });
    for (const patch of [{ ownIndex: 2 }, { status: 'accepted' }, { paymentScriptCbor: other.vault.payment.cbor }]) {
      expect(await refusal(vaultStore.update(wallet, id, patch as never))).toBe('INVALID_INPUT');
    }
    expect(await refusal(vaultStore.update(wallet, id, { labels: { [people[3].credential]: 'Mallory' } }))).toBe('INVALID_INPUT');
    expect(await refusal(vaultStore.update(wallet, id, {
      verifications: [numberVerification(manifest, people[3].credential, 1_800_000_000)],
    }))).toBe('INVALID_INPUT');
    expect(await refusal(vaultStore.update(wallet, other.id, { name: 'Nope' }))).toBe('NOT_FOUND');
  });

  it('throws when the wallet database cannot be opened, never answering "no vaults"', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(Dexie.prototype, 'open').mockRejectedValueOnce(new Error('injected open failure'));
    expect(await refusal(vaultStore.list(walletId()))).toBe('STORE_UNAVAILABLE');
  });
});
