// An added Bitcoin account signs at its own index, from its account #0's recovery
// phrase. These drive a real WalletBg (real Dexie via fake-indexeddb, real key
// derivation and message signing). Address derivation is stubbed: under vitest,
// bitcoinjs-lib checks keys against Node's Buffer while the sources get the
// polyfill (the bundles use one Buffer, so the extension is unaffected).
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
vi.mock('@/chains/bitcoin/bitcoinKeyManager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/chains/bitcoin/bitcoinKeyManager')>()),
  deriveBitcoinAddress: vi.fn(() => 'tb1q-derived'),
}));

import { WalletBg } from './walletBg';
import WalletStore from '@/stores/walletStore';
import { InvalidAccountIndexError } from '@/shared/utils/walletAccount';
import { SecretPurpose } from '@/shared/utils/crypto';
import { sealTextSecret } from '@/shared/utils/secretWriters';
import { deriveBitcoinAccountXpub, deriveBitcoinAddress, deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { Blockchain, Network, WalletType } from '@/models/types';

// clearForWalletSwitch() clears the wallet-scoped alarms; there is no extension API here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]),
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: { local: { set: vi.fn(), get: vi.fn() } },
  runtime: {},
};

// Fixed test vector — never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD = 'public-test-password';
const xpubAt = (accountIndex: number) => deriveBitcoinAccountXpub(PHRASE, Network.TESTNET, 'segwit', accountIndex);

let walletSeq = 0;
async function bitcoinWallet(accountIndex: number, publicKey = xpubAt(accountIndex)): Promise<WalletBg> {
  walletSeq += 1;
  const encryptedMnemonic = await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic);
  const wallet = {
    id: 950_000 + walletSeq, name: `bitcoin-${walletSeq}`, chain: Blockchain.BITCOIN, network: Network.TESTNET, type: WalletType.Normal,
    addressType: 'segwit', publicKey, accountIndex, encryptionMethod: 'password' as const, encryptedMnemonic,
  };
  return new WalletBg(wallet);
}

/** The signature `message` gets from the given account's first receive key, made the same way. */
async function signatureOf(bg: WalletBg, accountIndex: number, message: string): Promise<string> {
  const key = deriveBitcoinRootKey(PHRASE).derive(`m/84'/1'/${accountIndex}'/0/0`);
  return (bg as unknown as { _signEcdsaMessage(m: string, k: Buffer): Promise<string> })._signEcdsaMessage(message, Buffer.from(key.privateKey!));
}

describe('WalletBg on an added Bitcoin account', () => {
  beforeEach(() => {
    WalletStore.clearForWalletSwitch();
  });

  it('signs with that account’s key, and takes its addresses from that account’s xpub', async () => {
    const bg = await bitcoinWallet(2);

    expect(bg.accountIndex).toBe(2);
    expect(deriveBitcoinAddress).toHaveBeenLastCalledWith(xpubAt(2), Network.TESTNET, 'segwit', 0, 0);
    const signature = await bg.signBitcoinDappMessage('hello', 'ecdsa', PASSWORD);
    expect(signature).toBe(await signatureOf(bg, 2, 'hello'));
    expect(signature).not.toBe(await signatureOf(bg, 0, 'hello'));
  });

  it('refuses to sign when the phrase does not derive the record’s xpub at its index', async () => {
    const bg = await bitcoinWallet(1, xpubAt(0));

    await expect(bg.signBitcoinDappMessage('hello', 'ecdsa', PASSWORD)).rejects.toThrow(InvalidAccountIndexError);
    await expect(bg.signBitcoinTransaction('70736274ff', PASSWORD)).rejects.toThrow('does not belong to this account');
  });

  it('still signs account #0 with account #0’s key', async () => {
    const bg = await bitcoinWallet(0);

    expect(await bg.signBitcoinDappMessage('hello', 'ecdsa', PASSWORD)).toBe(await signatureOf(bg, 0, 'hello'));
  });
});
