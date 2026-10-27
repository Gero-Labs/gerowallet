// src/chrome/walletBgMidnightAccount.spec.ts
//
// A Midnight wallet holds accounts other than #0 (issue 1330): each is its own record,
// whose recovery phrase is its account #0's. The Midnight signing paths derive at the
// record's own account, and an added account is refused when its phrase does not derive
// the unshielded address its record stores. This drives a real WalletBg with a stand-in
// Midnight key manager (the private-sync path), and the DUST registration twin signer
// with real Cardano keys.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
/** Account N of the stand-in phrase has unshielded address `mn_addr_preprod1acctN`. */
const unshielded = (account: number) => `mn_addr_preprod1acct${account}`;
const { deriveMidnightKeys, derivedKeys, prepareMidnightPrivateSession, submitTx } = vi.hoisted(() => {
  const derivedKeys: Uint8Array[] = [];
  const keys = (size: number) => {
    const bytes = new Uint8Array(size).fill(7);
    derivedKeys.push(bytes);
    return bytes;
  };
  return {
    derivedKeys,
    deriveMidnightKeys: vi.fn(async (_mnemonic: string, _network: string, account: number) => ({
      unshieldedSecretKey: keys(32),
      dustSecretKey: keys(32),
      zswapSecretKey: keys(32),
      seed: keys(64),
      addresses: { unshielded: `mn_addr_preprod1acct${account}` },
    })),
    prepareMidnightPrivateSession: vi.fn(),
    submitTx: vi.fn(async () => ({ ok: true, text: async () => `"${'ab'.repeat(32)}"` })),
  };
});
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ deriveMidnightKeys }));
vi.mock('@/chains/midnight/midnightPrivateSyncSession', () => ({
  activateMidnightPrivateSession: vi.fn(async () => undefined),
  midnightPrivateSessionEpoch: () => 1,
  prepareMidnightPrivateSession,
}));
// The twin signer submits through the chain-agnostic submit endpoint; nothing leaves here.
vi.mock('@/chrome/serialization', async (importOriginal) => ({ ...(await importOriginal<object>()), submitTx }));

import { WalletBg } from './walletBg';
import { walletStore } from '@/stores/walletStore';
import { SecretPurpose } from '@/shared/utils/crypto';
import { sealTextSecret } from '@/shared/utils/secretWriters';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { deriveAccountXpubs } from '@/shared/utils/softwareAccounts';
import { InvalidAccountIndexError } from '@/shared/utils/walletAccount';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose } from '@/models/types';

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

/**
 * Account `accountIndex` of PHRASE as a logged-in WalletBg: an added account carries
 * its account #0's phrase, as the background logs it in (withGroupSecrets).
 */
async function midnightWallet(id: number, accountIndex: number, addresses: Record<string, string> = {}): Promise<WalletBg> {
  const encryptedMnemonic = await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic);
  const record = {
    id, name: 'Night', chain: Blockchain.MIDNIGHT, network: Network.PREPROD, type: WalletType.Normal,
    encryptionMethod: 'password' as const, encryptedMnemonic, accountIndex,
    ...(accountIndex > 0 ? { parentWalletId: id - 1, secretsWalletId: id - 1 } : {}),
    publicKey: JSON.stringify(addresses),
  };
  walletStore.loggedWallet = { id, network: Network.PREPROD } as never;
  walletStore.isLocked = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  return new WalletBg(record as any);
}

describe('WalletBg Midnight signing paths derive at the wallet’s account', () => {
  beforeEach(() => {
    deriveMidnightKeys.mockClear();
    prepareMidnightPrivateSession.mockClear();
    derivedKeys.length = 0;
  });

  it('derives account 0 for account #0, whatever its record stores', async () => {
    const bg = await midnightWallet(950_001, 0);

    await bg.startMidnightPrivateSync(PASSWORD);

    expect(bg.accountIndex).toBe(0);
    expect(deriveMidnightKeys).toHaveBeenCalledWith(PHRASE, Network.PREPROD, 0, { skipCardano: true });
    expect(prepareMidnightPrivateSession).toHaveBeenCalled();
  });

  it('derives an added account at its own index', async () => {
    const bg = await midnightWallet(950_003, 1, { unshielded: unshielded(1) });

    await bg.startMidnightPrivateSync(PASSWORD);

    expect(bg.accountIndex).toBe(1);
    expect(deriveMidnightKeys).toHaveBeenCalledWith(PHRASE, Network.PREPROD, 1, { skipCardano: true });
    expect(prepareMidnightPrivateSession).toHaveBeenCalled();
  });

  it('refuses an added account whose phrase does not derive its address, and wipes the keys', async () => {
    // The record says account #1 but stores account #2's address.
    const bg = await midnightWallet(950_005, 1, { unshielded: unshielded(2) });

    await expect(bg.startMidnightPrivateSync(PASSWORD)).rejects.toBeInstanceOf(InvalidAccountIndexError);

    expect(prepareMidnightPrivateSession).not.toHaveBeenCalled();
    expect(derivedKeys.length).toBeGreaterThan(0);
    expect(derivedKeys.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
});

describe('WalletBg DUST registration twin signer', () => {
  const rootKey = resolvePrivateKey(PHRASE);
  const paymentKey = (account: number) => rootKey
    .derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + account, 0, 0]).toPublic().toRawKey().hex();
  const twinXpub = async (account: number) => (await deriveAccountXpubs(rootKey, [account]))[0].publicKey;
  const TX = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('00'.repeat(32)),
    body: {
      inputs: [{ txId: Cardano.TransactionId('11'.repeat(32)), index: 0 }],
      outputs: [],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
  }).toCbor();
  const keysOf = (account: number, cardanoXpub?: string) => ({
    unshielded: unshielded(account), publicKeyHex: 'aa'.repeat(32), addressHex: 'bb'.repeat(32),
    ...(cardanoXpub ? { cardanoXpub } : {}),
  });
  const signers = () => {
    const [signed] = submitTx.mock.lastCall as unknown as [string];
    return [...(Serialization.Transaction.fromCbor(Serialization.TxCBOR(signed)).toCore().witness.signatures.keys())];
  };

  beforeEach(() => submitTx.mockClear());

  it('signs an added account with its own Cardano twin', async () => {
    const bg = await midnightWallet(950_007, 1, keysOf(1, await twinXpub(1)));

    await bg.signAndSubmitDustRegistrationTx(TX, PASSWORD);

    expect(signers()).toContain(paymentKey(1));
    expect(signers()).not.toContain(paymentKey(0));
  });

  it('refuses an added account whose twin is not the one its record stores', async () => {
    const bg = await midnightWallet(950_009, 1, keysOf(1, await twinXpub(0)));

    await expect(bg.signAndSubmitDustRegistrationTx(TX, PASSWORD)).rejects.toBeInstanceOf(InvalidAccountIndexError);
    expect(submitTx).not.toHaveBeenCalled();
  });

  it('keeps signing account #0 with Cardano account 0', async () => {
    const bg = await midnightWallet(950_011, 0, keysOf(0));

    await bg.signAndSubmitDustRegistrationTx(TX, PASSWORD);

    expect(signers()).toContain(paymentKey(0));
  });
});
