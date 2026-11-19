// A dApp's approved `solana:signMessage`: signed at the record's own account, verifiable with
// its address, and refused for bytes that are a transaction or a record whose phrase does not
// derive its address.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import { walletStore } from '@/stores/walletStore';
import { SecretPurpose } from '@/shared/utils/crypto';
import { sealTextSecret } from '@/shared/utils/secretWriters';
import { InvalidAccountIndexError } from '@/shared/utils/walletAccount';
import { deriveSolanaAddressFromMnemonic } from '@/chains/solana/solanaKeyManager';
import { base58Decode } from '@/chains/solana/solanaBase58';
import { verifySolanaSignature } from '@/chains/solana/solanaTransaction';
import { Blockchain, Network, WalletType } from '@/models/types';

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

const PASSWORD = 'public-test-password';
// Public BIP39 test vector; never fund these wallets.
const PHRASE = `${'abandon '.repeat(23)}art`;
const MESSAGE = new TextEncoder().encode('Sign in to example.com\nNonce: 42');

async function solanaWallet(id: number, accountIndex: number, address: string): Promise<WalletBg> {
  const encryptedMnemonic = await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic);
  const record = {
    id, name: 'Sol', chain: Blockchain.SOLANA, network: Network.DEVNET, type: WalletType.Normal,
    encryptionMethod: 'password' as const, encryptedMnemonic, accountIndex, publicKey: address,
  };
  walletStore.loggedWallet = { id, network: Network.DEVNET } as never;
  walletStore.isLocked = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  return new WalletBg(record as any);
}

describe('WalletBg.signSolanaMessage', () => {
  it("signs with the record's account, verifiable against its address", async () => {
    const address = deriveSolanaAddressFromMnemonic(PHRASE, 1);
    const bg = await solanaWallet(960_001, 1, address);
    const signature = await bg.signSolanaMessage(MESSAGE, PASSWORD);
    expect(signature).toHaveLength(64);
    expect(verifySolanaSignature(signature, MESSAGE, base58Decode(address))).toBe(true);
    expect(verifySolanaSignature(signature, MESSAGE, base58Decode(deriveSolanaAddressFromMnemonic(PHRASE, 0)))).toBe(false);
  });

  it('refuses bytes that are a transaction message', async () => {
    const bg = await solanaWallet(960_002, 0, deriveSolanaAddressFromMnemonic(PHRASE, 0));
    const txMessage = new Uint8Array([1, 0, 0, 1, ...new Array(32).fill(7), ...new Array(32).fill(9), 1, 0, 1, 0, 1, 2]);
    await expect(bg.signSolanaMessage(txMessage, PASSWORD)).rejects.toThrow('LOOKS_LIKE_TRANSACTION');
  });

  it('refuses a record whose phrase does not derive its address', async () => {
    const bg = await solanaWallet(960_003, 1, deriveSolanaAddressFromMnemonic(PHRASE, 2));
    await expect(bg.signSolanaMessage(MESSAGE, PASSWORD)).rejects.toBeInstanceOf(InvalidAccountIndexError);
  });

  it('needs the password', async () => {
    const bg = await solanaWallet(960_004, 0, deriveSolanaAddressFromMnemonic(PHRASE, 0));
    await expect(bg.signSolanaMessage(MESSAGE)).rejects.toThrow('Password is required');
  });
});
