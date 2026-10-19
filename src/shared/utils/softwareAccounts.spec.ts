import { describe, expect, it } from 'vitest';
import { Blockchain, Network } from '@/models/types';
import { bitcoinAccountPath, deriveBitcoinAccountXpub } from '@/chains/bitcoin/bitcoinKeyManager';
import { deriveAccountXpubsFromMnemonic } from './softwareAccounts';

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

describe('Bitcoin accounts of a recovery phrase', () => {
  it('derives each account as its record stores it, account #0 exactly as a restore does', async () => {
    const accounts = await deriveAccountXpubsFromMnemonic(PHRASE, [0, 1, 4], { chain: Blockchain.BITCOIN, network: Network.TESTNET });

    expect(accounts.map((account) => account.accountIndex)).toEqual([0, 1, 4]);
    expect(accounts.map((account) => account.publicKey)).toEqual([0, 1, 4].map((i) => deriveBitcoinAccountXpub(PHRASE, Network.TESTNET, 'segwit', i)));
    expect(new Set(accounts.map((account) => account.publicKey)).size).toBe(3);
  });

  it('follows the address type and network', async () => {
    const [taproot] = await deriveAccountXpubsFromMnemonic(PHRASE, [1], { chain: Blockchain.BITCOIN, network: Network.MAINNET, addressType: 'taproot' });

    expect(taproot.publicKey).toBe(deriveBitcoinAccountXpub(PHRASE, Network.MAINNET, 'taproot', 1));
    expect(taproot.publicKey).not.toBe(deriveBitcoinAccountXpub(PHRASE, Network.TESTNET, 'taproot', 1));
  });

  it('names the account path, with coin type 1 off Mainnet', () => {
    expect(bitcoinAccountPath(Network.MAINNET, 'segwit', 0)).toBe("m/84'/0'/0'");
    expect(bitcoinAccountPath(Network.TESTNET, 'segwit', 2)).toBe("m/84'/1'/2'");
    expect(bitcoinAccountPath(Network.MAINNET, 'taproot', 1)).toBe("m/86'/0'/1'");
    expect(bitcoinAccountPath(Network.MAINNET, 'legacy', 3)).toBe("m/44'/0'/3'");
  });

  it('refuses bad indices before deriving anything', async () => {
    await expect(deriveAccountXpubsFromMnemonic(PHRASE, [1, 1], { chain: Blockchain.BITCOIN, network: Network.MAINNET })).rejects.toThrow();
    await expect(deriveAccountXpubsFromMnemonic(PHRASE, [-1], { chain: Blockchain.BITCOIN, network: Network.MAINNET })).rejects.toThrow();
  });
});
