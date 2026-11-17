// Solana wallet records: what a create/restore stores, how accounts are derived and
// compared, and the network entries.
import { describe, expect, it } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Blockchain, Network } from '@/models/types';
import { deriveAccountXpubsFromMnemonic } from '@/shared/utils/softwareAccounts';
import { rootKeyFromMnemonic } from '@/shared/utils/rootKeyFromMnemonic';
import { isSameWalletKey, toWalletIdentity } from '@/db/walletIdentity';
import networks from '@/utils/networks';
import { deriveSolanaKeypairFromSeed, solanaSeedFromMnemonic } from './solanaKeyManager';

// Fixed test phrase — never used to hold funds. Addresses pinned to solana-keygen.
const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const ACCOUNT_0 = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const ACCOUNT_1 = 'Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb';

describe('Solana accounts from a recovery phrase', () => {
  it('each account record stores its address', async () => {
    const accounts = await deriveAccountXpubsFromMnemonic(ABANDON, [0, 1], { chain: Blockchain.SOLANA, network: Network.DEVNET });
    expect(accounts).toEqual([
      { accountIndex: 0, publicKey: ACCOUNT_0, keys: [] },
      { accountIndex: 1, publicKey: ACCOUNT_1, keys: [] },
    ]);
  });

  it('rejects invalid account indexes', async () => {
    await expect(deriveAccountXpubsFromMnemonic(ABANDON, [-1], { chain: Blockchain.SOLANA, network: Network.DEVNET })).rejects.toThrow();
  });
});

describe('the stored root key', () => {
  it('is the BIP-39 seed, and every account derives from it', () => {
    const stored = rootKeyFromMnemonic(Blockchain.SOLANA, ABANDON);
    expect(stored).toHaveLength(64);
    expect(bytesToHex(stored)).toBe(bytesToHex(solanaSeedFromMnemonic(ABANDON)));
    expect(deriveSolanaKeypairFromSeed(stored, 0).address).toBe(ACCOUNT_0);
    expect(deriveSolanaKeypairFromSeed(stored, 1).address).toBe(ACCOUNT_1);
  });
});

describe('wallet identity', () => {
  it('compares Solana addresses exactly (base58 is case-sensitive)', () => {
    expect(isSameWalletKey(Blockchain.SOLANA, ACCOUNT_0, ACCOUNT_0)).toBe(true);
    expect(isSameWalletKey(Blockchain.SOLANA, ACCOUNT_0, ACCOUNT_0.toLowerCase())).toBe(false);
    expect(toWalletIdentity({ chain: Blockchain.SOLANA, network: Network.MAINNET, publicKey: ` ${ACCOUNT_0} ` }).key).toBe(ACCOUNT_0);
  });
});

describe('Solana networks', () => {
  it('has Mainnet (not yet selectable) and Devnet, with every feature off', () => {
    const mainnet = networks.resolveNetwork(Blockchain.SOLANA, Network.MAINNET);
    const devnet = networks.resolveNetwork(Blockchain.SOLANA, Network.DEVNET);
    expect(mainnet?.comingSoon).toBe(true);
    expect(devnet?.comingSoon).toBeFalsy();
    for (const net of [mainnet, devnet]) {
      expect(net?.currencyTicker).toBe('SOL');
      expect(net?.supportedHardware).toBe(false);
      expect(net?.transactionSupport).toBe(false);
      expect(net?.stakingSupport).toBe(false);
      expect(net?.buySupport).toBe(false);
    }
  });
});
