// src/chrome/walletBgMidnightAccount.spec.ts
//
// A Midnight wallet is account #0 today: resolveAccountIndex() refuses any other index on
// Midnight. The Midnight signing paths still derive at the record's own account, like the
// Cardano and Bitcoin ones, so that lifting that refusal (issue 1330) cannot leave them
// signing with account #0's keys. This drives the private-sync path of a real WalletBg with
// a stand-in key manager and checks which account it derives.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));
const { deriveMidnightKeys } = vi.hoisted(() => ({
  deriveMidnightKeys: vi.fn(async () => ({
    unshieldedSecretKey: new Uint8Array(32),
    dustSecretKey: new Uint8Array(32),
    zswapSecretKey: new Uint8Array(32),
    seed: new Uint8Array(64),
  })),
}));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ deriveMidnightKeys }));
vi.mock('@/chains/midnight/midnightPrivateSyncSession', () => ({
  activateMidnightPrivateSession: vi.fn(async () => undefined),
  midnightPrivateSessionEpoch: () => 1,
  prepareMidnightPrivateSession: vi.fn(),
}));

import { WalletBg } from './walletBg';
import { walletStore } from '@/stores/walletStore';
import { SecretPurpose } from '@/shared/utils/crypto';
import { sealTextSecret } from '@/shared/utils/secretWriters';
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
const PHRASE = `${'abandon '.repeat(23)}art`;

async function midnightWallet(id: number): Promise<WalletBg> {
  const encryptedMnemonic = await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic);
  const record = { id, name: 'Night', chain: Blockchain.MIDNIGHT, network: Network.PREPROD, type: WalletType.Normal, encryptionMethod: 'password' as const, encryptedMnemonic, publicKey: '{}' };
  walletStore.loggedWallet = { id, network: Network.PREPROD } as never;
  walletStore.isLocked = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test fixture stands in for the persisted Wallet record
  return new WalletBg(record as any);
}

describe('WalletBg Midnight signing paths derive at the wallet’s account', () => {
  beforeEach(() => {
    deriveMidnightKeys.mockClear();
  });

  it('derives account 0 for a Midnight wallet, the only account it can hold today', async () => {
    const bg = await midnightWallet(950_001);

    await bg.startMidnightPrivateSync(PASSWORD);

    expect(bg.accountIndex).toBe(0);
    expect(deriveMidnightKeys).toHaveBeenCalledWith(PHRASE, Network.PREPROD, 0, { skipCardano: true });
  });

  it('follows the wallet’s account rather than a fixed 0', async () => {
    const bg = await midnightWallet(950_002);
    // What a Midnight account #1 record would resolve to once issue 1330 allows one.
    bg.accountIndex = 1;

    await bg.startMidnightPrivateSync(PASSWORD);

    expect(deriveMidnightKeys).toHaveBeenCalledWith(PHRASE, Network.PREPROD, 1, { skipCardano: true });
  });
});
