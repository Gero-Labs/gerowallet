// Stagenet is retired: the GeroWalletDatabase v18 upgrade moves every Midnight
// Stagenet wallet to Preview (issue 1453), and the same move runs after every
// open. Runs against a real (in-memory) IndexedDB seeded at v17, so the actual
// Dexie upgrade path executes.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { bech32m } from 'bech32';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Blockchain, Network, Theme, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import { geroDBSchema, geroDBVersion, geroWalletDbName } from '@/db/schema';

const CIPHERTEXT = 'synthetic-ciphertext';
const words = (fill: number, length = 32) => bech32m.toWords(Buffer.alloc(length, fill));
const address = (prefix: string, fill: number, length = 32) => bech32m.encode(prefix, words(fill, length), 1023);
const addresses = (network: string, fill: number) => ({
  unshielded: address(`mn_addr_${network}`, fill),
  shielded: address(`mn_shield-addr_${network}`, fill, 64),
  dust: address(`mn_dust_${network}`, fill, 33),
  publicKeyHex: 'aa'.repeat(32),
  addressHex: 'bb'.repeat(32),
  cardanoStakeAddress: 'stake_test1synthetic',
});

const STAGENET = 1;
const STAGENET_ACCOUNT_1 = 2;
const STAGENET_UNREADABLE = 3;
const MIDNIGHT_PREPROD = 4;
const CARDANO_PREVIEW = 5;
const BITCOIN = 6;

const base = { icon: 'icon', type: WalletType.Normal, theme: Theme.GERO, passwordLastUpdate: new Date(), encryptionMethod: 'password', encryptedPrivateKey: CIPHERTEXT };
const legacyWallets = [
  { ...base, id: STAGENET, order: 1, name: 'Midnight Stagenet', chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: JSON.stringify(addresses('stagenet', 1)), encryptedMnemonic: CIPHERTEXT },
  { ...base, id: STAGENET_ACCOUNT_1, order: 2, name: 'Midnight Stagenet #1', chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: JSON.stringify(addresses('stagenet', 2)), accountIndex: 1, parentWalletId: STAGENET },
  { ...base, id: STAGENET_UNREADABLE, order: 3, name: 'Midnight unreadable', chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: 'not json' },
  { ...base, id: MIDNIGHT_PREPROD, order: 4, name: 'Midnight Preprod', chain: Blockchain.MIDNIGHT, network: Network.PREPROD, publicKey: JSON.stringify(addresses('preprod', 4)) },
  { ...base, id: CARDANO_PREVIEW, order: 5, name: 'Cardano Preview', chain: Blockchain.CARDANO, network: Network.PREVIEW, publicKey: 'xpub1synthetic', encryptedMnemonic: CIPHERTEXT },
  { ...base, id: BITCOIN, order: 6, name: 'Bitcoin', chain: Blockchain.BITCOIN, network: Network.TESTNET, publicKey: 'tpubsynthetic' },
];

async function seedV17(): Promise<void> {
  const gero = new Dexie(geroWalletDbName);
  gero.version(17).stores(geroDBSchema);
  await gero.open();
  await gero.table('wallets').bulkAdd(legacyWallets);
  gero.close();
}

async function geroDb() {
  return (await import('@/db/gero-db')).getDb();
}

async function stored(id: number): Promise<Wallet & Record<string, unknown>> {
  return (await geroDb())['wallets'].get(id);
}

describe('GeroWalletDatabase v18: Midnight Stagenet wallets move to Preview (issue 1453)', () => {
  beforeAll(async () => {
    expect(geroDBVersion).toBe(18);
    await seedV17();
    await geroDb(); // opening at v18 runs the upgrade
  });

  it('moves every Midnight Stagenet wallet, added accounts included, and re-encodes its addresses', async () => {
    for (const [id, fill] of [[STAGENET, 1], [STAGENET_ACCOUNT_1, 2]] as const) {
      const wallet = await stored(id);
      expect(wallet.network).toBe(Network.PREVIEW);
      expect(wallet.chain).toBe(Blockchain.MIDNIGHT);
      expect(JSON.parse(wallet.publicKey)).toEqual(addresses('preview', fill));
      expect(wallet.previewMovePending).toEqual({ stagenetUnshielded: addresses('stagenet', fill).unshielded });
    }
    // Nothing else on the record changes: secrets, account and group stay as they were.
    const account = await stored(STAGENET_ACCOUNT_1);
    expect(account).toMatchObject({ accountIndex: 1, parentWalletId: STAGENET, encryptedPrivateKey: CIPHERTEXT, name: 'Midnight Stagenet #1' });
    expect((await stored(STAGENET)).encryptedMnemonic).toBe(CIPHERTEXT);
  });

  it('moves a record whose key cannot be read, leaving that key for the next re-derivation', async () => {
    const wallet = await stored(STAGENET_UNREADABLE);
    expect(wallet.network).toBe(Network.PREVIEW);
    expect(wallet.publicKey).toBe('not json');
    expect(wallet.previewMovePending).toEqual({ stagenetUnshielded: '' });
  });

  it('leaves Midnight Preprod, Cardano Preview and other chains untouched', async () => {
    for (const id of [MIDNIGHT_PREPROD, CARDANO_PREVIEW, BITCOIN]) {
      const wallet = await stored(id);
      const legacy = legacyWallets.find((w) => w.id === id)!;
      expect(wallet.network).toBe(legacy.network);
      expect(wallet.publicKey).toBe(legacy.publicKey);
      expect('previewMovePending' in wallet).toBe(false);
    }
  });

  it('leaves no Stagenet wallet behind', async () => {
    expect(await (await geroDb())['wallets'].where('network').equals('Stagenet').count()).toBe(0);
  });

  it('is idempotent: opening again moves nothing twice, and a Stagenet record written later is moved on the next open', async () => {
    const before = await (await geroDb())['wallets'].toArray();

    // A record written by an older context after the upgrade.
    const late = { ...base, id: 7, order: 7, name: 'Late Stagenet', chain: Blockchain.MIDNIGHT, network: 'Stagenet', publicKey: JSON.stringify(addresses('stagenet', 7)) };
    await (await geroDb())['wallets'].add(late);

    vi.resetModules(); // a fresh getDb(): a new open of the same database
    const reopened = await geroDb();
    const after = await reopened['wallets'].toArray();
    expect(after.filter((w: Wallet) => w.id !== 7)).toEqual(before);
    const moved = after.find((w: Wallet) => w.id === 7);
    expect(moved.network).toBe(Network.PREVIEW);
    expect(JSON.parse(moved.publicKey)).toEqual(addresses('preview', 7));
    expect(moved.previewMovePending).toEqual({ stagenetUnshielded: addresses('stagenet', 7).unshielded });
  });
});
