// Every check of the spending password in the worker shares the unlock back-off of
// the wallet's secrets record: verifying it (VERIFY_SPENDING_PASSWORD) and opening
// the root key or recovery phrase to sign. Otherwise any of them would be a second,
// unthrottled way to guess the password. Drives a real WalletBg with real crypto.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/stores/priceStore', () => ({ default: { initialize: vi.fn(), disconnect: vi.fn() } }));

import { WalletBg } from './walletBg';
import { SecretPurpose } from '@/shared/utils/crypto';
import { sealKeySecret, sealTextSecret } from '@/shared/utils/secretWriters';
import { UNLOCK_FREE_ATTEMPTS, UnlockThrottledError } from './unlockGuards';
import { Blockchain, Network, WalletType } from '@/models/types';

const session = new Map<string, unknown>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal stand-in for the chrome namespace
(globalThis as any).chrome = {
  alarms: {
    getAll: (cb: (alarms: unknown[]) => void) => cb([]),
    clear: vi.fn(),
    create: vi.fn(),
    onAlarm: { addListener: vi.fn(), removeListener: vi.fn(), hasListener: () => false },
  },
  storage: {
    local: { set: vi.fn(), get: vi.fn() },
    session: {
      get: async (key: string) => (session.has(key) ? { [key]: session.get(key) } : {}),
      set: async (items: Record<string, unknown>) => { for (const [k, v] of Object.entries(items)) session.set(k, v); },
      remove: async (key: string) => { session.delete(key); },
    },
  },
  runtime: {},
};

// Fixed test vectors, never used to hold funds.
const PHRASE = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD = 'public-test-password';
// A public preprod account key: the worker parses it on construction.
const XPUB = 'acct_xvk14hczmhwlqeadp0f3m7vzgda9suxdpl73hvwzk9jhmfm3kzv05hwhyxdd40a0hac6u39ws58ek3y0kkcvwx08ds6s80qhasqqgmtgyzcreur64';

async function passwordWallet(id: number): Promise<WalletBg> {
  return new WalletBg({
    id, name: 'throttle', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal,
    publicKey: XPUB, accountIndex: 0, encryptionMethod: 'password' as const,
    encryptedPrivateKey: await sealKeySecret(new Uint8Array(96).fill(3), PASSWORD, SecretPurpose.RootKey),
    encryptedMnemonic: await sealTextSecret(PHRASE, PASSWORD, SecretPurpose.Mnemonic),
  });
}

async function exhaustFreeAttempts(check: () => Promise<unknown>): Promise<void> {
  for (let n = 0; n < UNLOCK_FREE_ATTEMPTS; n++) await check().catch(() => undefined);
}

describe('WalletBg spending password back-off', () => {
  beforeEach(() => session.clear());

  it('VERIFY_SPENDING_PASSWORD: after repeated wrong passwords even the right one waits', async () => {
    const wallet = await passwordWallet(960_001);
    await exhaustFreeAttempts(() => wallet.verifySpendingPassword('wrong'));
    await expect(wallet.verifySpendingPassword(PASSWORD)).rejects.toBeInstanceOf(UnlockThrottledError);
  });

  it('opening the recovery phrase to sign counts toward the same back-off', async () => {
    const wallet = await passwordWallet(960_002);
    const open = (password: string) => (wallet as unknown as { openMnemonicWithPassword(p: string): Promise<string> }).openMnemonicWithPassword(password);
    await exhaustFreeAttempts(() => open('wrong'));
    await expect(open(PASSWORD)).rejects.toBeInstanceOf(UnlockThrottledError);
    await expect(wallet.verifySpendingPassword(PASSWORD)).rejects.toBeInstanceOf(UnlockThrottledError);
  });

  it('a right password clears the count', async () => {
    const wallet = await passwordWallet(960_003);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS - 1; n++) await wallet.verifySpendingPassword('wrong');
    await expect(wallet.verifySpendingPassword(PASSWORD)).resolves.toBe(true);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS - 1; n++) {
      await expect(wallet.verifySpendingPassword('wrong')).resolves.toBe(false);
    }
  });

  it('an uncounted check (the unlock, which counts it itself) leaves the count alone', async () => {
    const wallet = await passwordWallet(960_004);
    for (let n = 0; n < UNLOCK_FREE_ATTEMPTS * 2; n++) {
      await expect(wallet.verifySpendingPassword('wrong', { counted: false })).resolves.toBe(false);
    }
    await expect(wallet.verifySpendingPassword(PASSWORD)).resolves.toBe(true);
  });

  it('a PassKey wallet without a spending password checks nothing, so it cannot clear a back-off', async () => {
    const wallet = await passwordWallet(960_005);
    await exhaustFreeAttempts(() => wallet.verifySpendingPassword('wrong'));
    const pureprf = new WalletBg({
      id: 960_005, name: 'prf', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal,
      publicKey: XPUB, accountIndex: 0, encryptionMethod: 'prf' as const, webAuthnCredentialId: 'cred',
    });
    await expect(pureprf.verifySpendingPassword('anything')).resolves.toBe(true);
    await expect(wallet.verifySpendingPassword(PASSWORD)).rejects.toBeInstanceOf(UnlockThrottledError);
  });
});
