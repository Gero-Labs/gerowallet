// A Midnight wallet's accounts come from its recovery phrase: each is the
// addresses JSON its record stores, account #0 exactly as a create or restore
// stores it (issue 1330). Real key derivation; only store messaging is stubbed.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

// The Cardano helpers load stores that reach for chrome messaging at import.
vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
import { Blockchain, Network } from '@/models/types';
import { deriveWalletPublicKey } from '@/db/gero-db';
import { isSameWalletKey } from '@/db/walletIdentity';
import { deriveMidnightAddresses } from '@/chains/midnight/midnightKeyManager';
import { deriveAccountXpubs, deriveAccountXpubsFromMnemonic } from './softwareAccounts';
import { resolvePrivateKey } from './resolver';

// Public BIP39 test vector; never fund these wallets.
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const MIDNIGHT = { chain: Blockchain.MIDNIGHT, network: Network.PREPROD };

describe('Midnight accounts of a recovery phrase', () => {
  it('derives account #0 exactly as the wallet record stores it, and every account apart', async () => {
    const accounts = await deriveAccountXpubsFromMnemonic(PHRASE, [0, 1, 3], MIDNIGHT);
    const stored = await deriveWalletPublicKey(PHRASE, Blockchain.MIDNIGHT, Network.PREPROD, undefined, await deriveMidnightAddresses(PHRASE, Network.PREPROD));

    expect(accounts.map((account) => account.accountIndex)).toEqual([0, 1, 3]);
    expect(accounts[0].publicKey).toBe(stored);
    const addresses = accounts.map((account) => JSON.parse(account.publicKey));
    for (const role of ['unshielded', 'shielded', 'dust'] as const) {
      expect(new Set(addresses.map((blob) => blob[role])).size).toBe(3);
    }
    expect(isSameWalletKey(Blockchain.MIDNIGHT, accounts[1].publicKey, stored)).toBe(false);
  }, 60_000);

  it('stores no viewing key, and the account\'s Cardano twin at the same account', async () => {
    const [account] = await deriveAccountXpubsFromMnemonic(PHRASE, [2], MIDNIGHT);
    const blob = JSON.parse(account.publicKey);
    const [twin] = await deriveAccountXpubs(resolvePrivateKey(PHRASE), [2]);

    expect(blob).not.toHaveProperty('zswapViewingKey');
    expect(blob.unshielded).toMatch(/^mn_addr_preprod1/);
    expect(blob.cardanoXpub).toBe(twin.publicKey);
  }, 60_000);

  it('follows the network', async () => {
    const [preprod] = await deriveAccountXpubsFromMnemonic(PHRASE, [1], MIDNIGHT);
    const [mainnet] = await deriveAccountXpubsFromMnemonic(PHRASE, [1], { ...MIDNIGHT, network: Network.MAINNET });

    expect(JSON.parse(mainnet.publicKey).unshielded).toMatch(/^mn_addr1/);
    expect(isSameWalletKey(Blockchain.MIDNIGHT, preprod.publicKey, mainnet.publicKey)).toBe(false);
  }, 60_000);

  it('refuses bad indices before deriving anything', async () => {
    await expect(deriveAccountXpubsFromMnemonic(PHRASE, [1, 1], MIDNIGHT)).rejects.toThrow();
    await expect(deriveAccountXpubsFromMnemonic(PHRASE, [-1], MIDNIGHT)).rejects.toThrow();
  });
});
