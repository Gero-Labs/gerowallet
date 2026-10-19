// End-to-end guard: restoring the same seed twice on the same chain+network
// must be rejected before a second record is written. Runs against a real
// (in-memory) IndexedDB rather than mocking '@/db/gero-db', because
// createNewWallet, getAllWallets and findExistingWallet all live in that same
// module — a vi.mock() of it cannot intercept those same-file calls.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { bech32 } from 'bech32';
import { Blockchain, Network, Theme, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import { createNewHardwareWallet, createNewWallet, findExistingWallet, getAllWallets, DuplicateWalletError } from '@/db/gero-db';

// Fixed test vector — never used to hold funds.
const MNEMONIC = 'test walk nut penalty hip pave soap entry language right filter choice';
const PASSWORD = 'Test-Password-1!';

async function restore(name: string, chain: string, network: string) {
  return createNewWallet(name, 'icon', Theme.GERO, MNEMONIC, PASSWORD, chain, network);
}

// getAllWallets() returns an id-keyed map, not an array.
async function storedWallets(): Promise<Record<number, Wallet>> {
  return (await getAllWallets()) as Record<number, Wallet>;
}

describe('duplicate restore', () => {
  it('rejects a second restore of the same seed on the same chain and network', async () => {
    const firstId = await restore('First', Blockchain.CARDANO, Network.MAINNET);
    expect(typeof firstId).toBe('number');

    await expect(restore('Different name', Blockchain.CARDANO, Network.MAINNET))
      .rejects.toBeInstanceOf(DuplicateWalletError);

    const wallets = await storedWallets();
    expect(Object.values(wallets).filter((w) => w.chain === Blockchain.CARDANO)).toHaveLength(1);
  });

  it('reports the existing wallet so the UI can offer to open it', async () => {
    const existing = await findExistingWallet({
      chain: Blockchain.CARDANO,
      network: Network.MAINNET,
      publicKey: (await storedWallets())[1].publicKey,
    });
    expect(existing?.name).toBe('First');
  });

  it('still allows the same seed on a different network', async () => {
    const id = await restore('Preprod', Blockchain.CARDANO, Network.PREPROD);
    expect(typeof id).toBe('number');
  });

  it('still allows the same seed on a different chain', async () => {
    const id = await restore('Bitcoin', Blockchain.BITCOIN, Network.MAINNET);
    expect(typeof id).toBe('number');
  });

  it('rejects a second Bitcoin restore of the same seed', async () => {
    await expect(restore('Bitcoin again', Blockchain.BITCOIN, Network.MAINNET))
      .rejects.toBeInstanceOf(DuplicateWalletError);
  });
});

describe('duplicate hardware pairing', () => {
  /** A device account's xpub as pairing stores it: bech32 over 64 key + chain-code bytes. */
  const deviceXpub = (fill: string) => bech32.encode('xpub', bech32.toWords(Buffer.from(fill.repeat(64), 'hex')), 1023);

  function pair(name: string, publicKey: string, network: string = Network.MAINNET, type: string = WalletType.Keystone) {
    return createNewHardwareWallet({
      name, icon: 'icon', type, theme: Theme.GERO, chain: Blockchain.CARDANO, network, publicKey,
      keys: [{ publicKey: 'aa'.repeat(32), chainCode: 'bb'.repeat(32), path: "1852'/1815'/0'" }],
      btSupported: false, xfp: '0a1b2c3d',
    });
  }

  it('rejects pairing the same device account twice, and stores no second copy', async () => {
    await pair('Keystone', deviceXpub('a1'));

    const second = pair('Keystone again', deviceXpub('a1'));
    await expect(second).rejects.toBeInstanceOf(DuplicateWalletError);
    await expect(second).rejects.toMatchObject({ existingWallet: { name: 'Keystone' } });

    const copies = Object.values(await storedWallets()).filter((w) => w.publicKey === deviceXpub('a1'));
    expect(copies).toHaveLength(1);
  });

  it('still allows another account of the same device', async () => {
    expect(typeof await pair('Keystone account 1', deviceXpub('b2'))).toBe('number');
  });

  it('still allows the same device account on another network', async () => {
    expect(typeof await pair('Keystone preprod', deviceXpub('a1'), Network.PREPROD)).toBe('number');
  });

  it('never treats two watch wallets as the same: they carry no public key', async () => {
    const watch = { name: 'Watch', icon: 'icon', type: WalletType.Watch, theme: Theme.GERO, chain: Blockchain.CARDANO, network: Network.MAINNET, publicKey: '' };
    expect(typeof await createNewHardwareWallet({ ...watch, watchAddress: 'addr1-a' })).toBe('number');
    expect(typeof await createNewHardwareWallet({ ...watch, watchAddress: 'addr1-b' })).toBe('number');
  });
});
