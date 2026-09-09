// End-to-end guard: restoring the same seed twice on the same chain+network
// must be rejected before a second record is written. Runs against a real
// (in-memory) IndexedDB rather than mocking '@/db/gero-db', because
// createNewWallet, getAllWallets and findExistingWallet all live in that same
// module — a vi.mock() of it cannot intercept those same-file calls.
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { Blockchain, Network, Theme } from '@/models/types';
import type { Wallet } from '@/models/types';
import { createNewWallet, findExistingWallet, getAllWallets, DuplicateWalletError } from '@/db/gero-db';

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
