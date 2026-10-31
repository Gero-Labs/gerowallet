// End-to-end guard: restoring the same seed twice on the same chain+network
// must be rejected before a second record is written. Runs against a real
// (in-memory) IndexedDB rather than mocking '@/db/gero-db', because
// createNewWallet, getAllWallets and findExistingWallet all live in that same
// module — a vi.mock() of it cannot intercept those same-file calls.
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Blockchain, Network, Theme, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import { createMpcGoogleWallet, createNewHardwareWallet, createNewWallet, findExistingWallet, getAllWallets, getDb, DuplicateWalletError } from '@/db/gero-db';

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

  function pair(name: string, publicKey: string, network: string = Network.MAINNET, type: string = WalletType.Keystone, extra: Record<string, unknown> = {}) {
    return createNewHardwareWallet({
      name, icon: 'icon', type, theme: Theme.GERO, chain: Blockchain.CARDANO, network, publicKey,
      keys: [{ publicKey: 'aa'.repeat(32), chainCode: 'bb'.repeat(32), path: "1852'/1815'/0'" }],
      btSupported: false, xfp: '0a1b2c3d', ...extra,
    });
  }

  it('refuses pairing the same Keystone again but keeps the firmware version it now reports', async () => {
    const firstId = await pair('Keystone', deviceXpub('c3'), Network.MAINNET, WalletType.Keystone, { firmwareVersion: '1.7.2' });

    await expect(pair('Keystone updated', deviceXpub('c3'), Network.MAINNET, WalletType.Keystone, { firmwareVersion: '3.2.0' }))
      .rejects.toBeInstanceOf(DuplicateWalletError);
    expect((await storedWallets())[firstId]).toMatchObject({ name: 'Keystone', firmwareVersion: '3.2.0' });

    // A pairing answer that reports no version leaves the recorded one alone.
    await expect(pair('Keystone again', deviceXpub('c3'))).rejects.toBeInstanceOf(DuplicateWalletError);
    expect((await storedWallets())[firstId].firmwareVersion).toBe('3.2.0');
  });

  describe('firmware version across the accounts of one device', () => {
    // Each test pairs its own device (fingerprint and keys), so none relies on another's records.
    const keystone = (xfp: string, version: string) => ({ xfp, firmwareVersion: version });

    it('refreshes the added accounts too when account #0 is paired again', async () => {
      const xfp = 'aabbcc01';
      const head = await pair('Device', deviceXpub('d4'), Network.MAINNET, WalletType.Keystone, keystone(xfp, '1.7.2'));
      const added = await pair('Device #1', deviceXpub('e5'), Network.MAINNET, WalletType.Keystone, { ...keystone(xfp, '1.7.2'), accountIndex: 1, parentWalletId: head });

      await expect(pair('Device', deviceXpub('d4'), Network.MAINNET, WalletType.Keystone, keystone(xfp, '3.2.0')))
        .rejects.toBeInstanceOf(DuplicateWalletError);

      const wallets = await storedWallets();
      expect([wallets[head].firmwareVersion, wallets[added].firmwareVersion]).toEqual(['3.2.0', '3.2.0']);
    });

    it('refreshes account #0 when a new account joins it', async () => {
      const xfp = 'aabbcc02';
      const head = await pair('Joined', deviceXpub('d5'), Network.MAINNET, WalletType.Keystone, keystone(xfp, '1.7.2'));
      await pair('Joined #2', deviceXpub('f6'), Network.MAINNET, WalletType.Keystone, { ...keystone(xfp, '3.4.0'), accountIndex: 2, parentWalletId: head });
      expect((await storedWallets())[head].firmwareVersion).toBe('3.4.0');
    });

    it('writes no version onto another kind of wallet with the same key', async () => {
      const xfp = 'aabbcc03';
      const ledger = await pair('Ledger', deviceXpub('a7'), Network.MAINNET, WalletType.Ledger, { xfp });
      await expect(pair('Keystone', deviceXpub('a7'), Network.MAINNET, WalletType.Keystone, keystone(xfp, '3.4.0')))
        .rejects.toBeInstanceOf(DuplicateWalletError);
      expect((await storedWallets())[ledger].firmwareVersion).toBeUndefined();
    });

    it('still reports the duplicate when the version cannot be written', async () => {
      const xfp = 'aabbcc04';
      const head = await pair('Unwritable', deviceXpub('d6'), Network.MAINNET, WalletType.Keystone, keystone(xfp, '1.7.2'));
      const db = await getDb();
      const update = vi.spyOn(Object.getPrototypeOf(db['wallets']), 'update').mockRejectedValueOnce(new Error('QuotaExceededError'));
      try {
        await expect(pair('Unwritable', deviceXpub('d6'), Network.MAINNET, WalletType.Keystone, keystone(xfp, '3.6.0')))
          .rejects.toBeInstanceOf(DuplicateWalletError);
        // The refresh did try to write the new version, and the failed write left the record as it was.
        expect(update).toHaveBeenCalledWith(head, { firmwareVersion: '3.6.0' });
      } finally {
        update.mockRestore();
      }
      expect((await storedWallets())[head].firmwareVersion).toBe('1.7.2');
    });
  });

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

describe('duplicate Google (MPC) restore', () => {
  // A Google wallet's account xpub as onboarding stores it (bech32 over key + chain code).
  const GOOGLE_XPUB = bech32.encode('xpub', bech32.toWords(Buffer.from('cd'.repeat(64), 'hex')), 1023);

  function restoreGoogle(name: string, network: string = Network.MAINNET) {
    return createMpcGoogleWallet({
      name, icon: 'icon', theme: Theme.GERO, chain: Blockchain.CARDANO, network,
      userId: 'google-sub-1', publicKey: GOOGLE_XPUB, encryptedDeviceShare: 'sealed-device-share',
    });
  }

  it('refuses a second copy of a Google wallet already on this device, and stores none', async () => {
    const firstId = await restoreGoogle('Daily');

    const refused = await restoreGoogle('Daily again').catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(DuplicateWalletError);
    expect((refused as DuplicateWalletError).existingWallet.id).toBe(firstId);
    const copies = Object.values(await storedWallets()).filter((w) => w.publicKey === GOOGLE_XPUB);
    expect(copies).toHaveLength(1);
  });

  it('still allows the same Google account on another network', async () => {
    expect(typeof await restoreGoogle('Daily preprod', Network.PREPROD)).toBe('number');
  });
});
