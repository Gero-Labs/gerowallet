// Hardware wallets pair and verify a Bitcoin account at the path the software wallet
// derives it at, on every network, and their keys are stored in the wallet's one xpub
// form (issue 1327).
import { describe, expect, it, vi } from 'vitest';

// bitcoinjs-lib is externalized to Node by Vitest and checks keys against Node's Buffer,
// while the sources get the polyfill. Hand the sources Node's Buffer too (the bundles use
// one Buffer, so the extension is unaffected).
vi.mock('vite-plugin-node-polyfills/shims/buffer', async () => {
  const { createRequire: requireFrom } = await import('node:module');
  const { Buffer } = requireFrom(import.meta.url)('node:buffer');
  return { default: Buffer, Buffer };
});

import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from 'bip39';
import { ACCOUNT_XPUB_VERSION, bitcoinAccountPath, bitcoinAddressPath, trezorCoin } from './bitcoinPaths';
import { deriveBitcoinAccountXpub, deriveBitcoinAddress, toAccountXpub } from './bitcoinKeyManager';

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

/** The account key at `path` with the given version bytes, as a device may export it. */
const exported = (path: string, publicVersion: number) =>
  HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE), { private: 0x04358394, public: publicVersion }).derive(path).publicExtendedKey;

describe('Bitcoin hardware paths', () => {
  it('puts a testnet account at coin type 1\'', () => {
    expect(bitcoinAccountPath('Mainnet', 'segwit', 0)).toBe("m/84'/0'/0'");
    expect(bitcoinAccountPath('Testnet', 'taproot', 2)).toBe("m/86'/1'/2'");
  });

  it('names an address by its account path, chain and index', () => {
    expect(bitcoinAddressPath('Testnet', 'segwit', 0, false, 4)).toBe("m/84'/1'/0'/0/4");
    expect(bitcoinAddressPath('Mainnet', 'legacy', 1, true, 0)).toBe("m/44'/0'/1'/1/0");
  });

  it('asks Trezor Connect for its testnet coin off Mainnet', () => {
    expect(trezorCoin('Mainnet')).toBe('btc');
    expect(trezorCoin('Testnet')).toBe('test');
  });
});

describe('toAccountXpub', () => {
  const softwareXpub = deriveBitcoinAccountXpub(PHRASE, 'Testnet', 'segwit');

  it.each([
    ['tpub', 0x043587cf],
    ['vpub', 0x045f1cf6],
    ['zpub', 0x04b24746],
    ['xpub', ACCOUNT_XPUB_VERSION],
  ])('stores a %s as the xpub a software wallet derives for the same account', (prefix, version) => {
    const key = exported("m/84'/1'/0'", version);
    expect(key.startsWith(prefix)).toBe(true);

    expect(toAccountXpub(key)).toBe(softwareXpub);
    expect(deriveBitcoinAddress(toAccountXpub(key), 'Testnet', 'segwit', 0, 0)).toBe(deriveBitcoinAddress(softwareXpub, 'Testnet', 'segwit', 0, 0));
  });

  it('refuses a private key or anything that is not an extended key', () => {
    const xprv = HDKey.fromMasterSeed(mnemonicToSeedSync(PHRASE)).derive("m/84'/1'/0'").privateExtendedKey;

    expect(() => toAccountXpub(xprv)).toThrow('Not an extended public key');
    expect(() => toAccountXpub('not-a-key')).toThrow('Not an extended public key');
  });
});
