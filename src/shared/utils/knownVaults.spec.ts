// knownVaultScriptHashes() reads every wallet's stored vaults: the wallet ids from the wallet list,
// then each wallet's `vaults` table. It throws when a store cannot be read, never answering empty.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildVaultFromParticipants, vaultId, type VaultScripts } from '@/shared/gerovault';
import { testParticipants, type TestParticipant } from '@/shared/gerovault/__fixtures__/manifest';
import { geroDBSchema, geroDBVersion, geroWalletDbName } from '@/db/schema';
import { clearDbCache, getDb } from '@/db/wallet-db';
import { vaultStore } from '@/db/vaultStore';
import { knownVaultScriptHashes } from './knownVaults';

let people: TestParticipant[];
let first: VaultScripts;
let second: VaultScripts;

beforeAll(async () => {
  people = await testParticipants();
  const build = (owners: TestParticipant[]) => buildVaultFromParticipants({
    template: { kind: 'standard', threshold: 2 },
    owners: owners.map(p => ({ vaultKeys: p.vaultKeys })),
  });
  [first, second] = await Promise.all([build(people.slice(0, 3)), build(people.slice(1, 4))]);
});

const WALLETS = [207400, 207401];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const id of [...WALLETS, 207499]) {
    clearDbCache(id);
    await Dexie.delete(`wallet-${id}`);
  }
  await Dexie.delete(geroWalletDbName);
});

async function walletList(ids: number[]): Promise<void> {
  const db = new Dexie(geroWalletDbName);
  db.version(geroDBVersion).stores(geroDBSchema);
  await db.open();
  await db.table('wallets').bulkPut(ids.map(id => ({ id, name: `wallet ${id}` })));
  db.close();
}

async function store(walletId: number, vault: VaultScripts, owners: TestParticipant[], ownIndex = 1): Promise<void> {
  await vaultStore.addCandidate(walletId, {
    vaultId: vaultId(vault, 'preprod'),
    network: 'preprod',
    origin: 'created',
    paymentScriptCbor: vault.payment.cbor,
    stakeScriptCbor: vault.stake.cbor,
    participants: owners.map((p, i) => ({ role: 'owner', vaultKeys: p.vaultKeys, self: i === 0 })),
    ownIndex,
  });
}

describe('known vaults from the vault store', () => {
  it('answers none before the extension has a wallet list', async () => {
    expect(await knownVaultScriptHashes()).toEqual({ payment: new Set(), stake: new Set(), ownIndexZero: false });
  });

  it('answers none where there is no IndexedDB, so no store', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await knownVaultScriptHashes()).toEqual({ payment: new Set(), stake: new Set(), ownIndexZero: false });
  });

  it('gathers the script hashes of every wallet\'s vaults, candidates included', async () => {
    await walletList(WALLETS);
    await store(WALLETS[0], first, people.slice(0, 3));
    await store(WALLETS[1], second, people.slice(1, 4));
    await vaultStore.accept(WALLETS[1], vaultId(second, 'preprod'));

    const known = await knownVaultScriptHashes();
    expect(known.payment).toEqual(new Set([first.payment.hash, second.payment.hash]));
    expect(known.stake).toEqual(new Set([first.stake.hash, second.stake.hash]));
    expect(known.ownIndexZero).toBe(false);
  });

  it('says when a stored vault holds a wallet\'s own index 0', async () => {
    await walletList(WALLETS);
    await store(WALLETS[1], first, people.slice(0, 3), 0);
    expect((await knownVaultScriptHashes()).ownIndexZero).toBe(true);
  });

  it('reads only the wallets in the wallet list', async () => {
    await walletList([WALLETS[0]]);
    await store(207499, first, people.slice(0, 3));
    expect((await knownVaultScriptHashes()).payment.size).toBe(0);
  });

  it('throws on a row it cannot read, never leaving that vault out', async () => {
    await walletList(WALLETS);
    await store(WALLETS[0], first, people.slice(0, 3));
    const db = await getDb(WALLETS[1]);
    await db!.table('vaults').put({ vaultId: 'ab'.repeat(32), paymentScriptHash: 'not-a-hash', stakeScriptHash: second.stake.hash });
    await expect(knownVaultScriptHashes()).rejects.toThrow(/script hashes/);
  });

  it('throws when a wallet\'s database cannot be opened', async () => {
    await walletList(WALLETS);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const open = Dexie.prototype.open;
    vi.spyOn(Dexie.prototype, 'open').mockImplementation(function (this: Dexie) {
      return this.name === `wallet-${WALLETS[1]}` ? Promise.reject(new Error('injected open failure')) as never : open.call(this);
    });
    await expect(knownVaultScriptHashes()).rejects.toThrow(/could not be opened/);
  });
});
