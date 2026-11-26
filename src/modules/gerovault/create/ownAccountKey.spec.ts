// This wallet's CIP-1854 account key behind its credential: the background flow, the root-key
// check and the page client. Test entropy only, never a real wallet.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { accountXpub, cardanoAccountPath } from '@/shared/utils/walletAccount';
import { Messaging } from '@/chrome/messaging';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import {
  OwnAccountKeyError,
  canHoldVaultKeys,
  deriveMultisigAccountKeyFlow,
  multisigAccountKeyOfRoot,
  type DeriveMultisigAccountKeyDeps,
} from './ownAccountKeyFlow';
import { GEROVAULT_DERIVE_ACCOUNT_KEY, requestMultisigAccountKey } from './ownAccountKey';

const HARDENED = 0x80000000;
let rootBytes: Uint8Array;
let accountZero: string;
let expected: string;

beforeAll(async () => {
  await ready();
  const root = Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 1), '');
  rootBytes = Uint8Array.from(root.bytes());
  const zero = root.derive([HARDENED + 1852, HARDENED + 1815, HARDENED]).toPublic().hex();
  accountZero = accountXpub(zero.slice(0, 64), zero.slice(64), cardanoAccountPath(0)).publicKey;
  // The fixtures' test cosigner 1 is the same entropy, derived at m/1854'/1815'/0'.
  expected = (await testAccounts())[1].toPublic().hex();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function wallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: 7,
    name: 'Test',
    chain: Blockchain.CARDANO,
    network: Network.PREPROD,
    type: WalletType.Normal,
    encryptionMethod: 'password',
    encryptedPrivateKey: 'sealed',
    publicKey: accountZero,
    ...overrides,
  } as Wallet;
}

function deps(record: Wallet, extra: Partial<DeriveMultisigAccountKeyDeps> = {}) {
  const handed: Uint8Array[] = [];
  const all: DeriveMultisigAccountKeyDeps = {
    getWallets: async () => ({ [record.id]: record }),
    sessionRootKey: () => undefined,
    decryptRootKey: (_sealed, password) => {
      if (password !== 'right') throw new Error('bad password');
      const copy = Uint8Array.from(rootBytes);
      handed.push(copy);
      return copy;
    },
    ...extra,
  };
  return { deps: all, handed };
}

async function codeOf(work: Promise<unknown>): Promise<string | undefined> {
  try {
    await work;
  } catch (error) {
    return error instanceof OwnAccountKeyError ? error.code : 'OTHER';
  }
  return undefined;
}

describe('which wallets hold vault keys', () => {
  it('takes account #0 of a recovery-phrase or Google wallet', () => {
    expect(canHoldVaultKeys(wallet())).toBe(true);
    expect(canHoldVaultKeys(wallet({ type: WalletType.Google, encryptionMethod: 'mpc' }))).toBe(true);
    expect(canHoldVaultKeys(wallet({ encryptionMethod: 'prf' }))).toBe(true);
  });

  it('refuses hardware, watch, legacy Google, other chains and added accounts', () => {
    expect(canHoldVaultKeys(wallet({ type: WalletType.Ledger }))).toBe(false);
    expect(canHoldVaultKeys(wallet({ type: WalletType.Watch }))).toBe(false);
    expect(canHoldVaultKeys(wallet({ type: WalletType.Google, encryptionMethod: 'password' }))).toBe(false);
    expect(canHoldVaultKeys(wallet({ chain: Blockchain.BITCOIN }))).toBe(false);
    expect(canHoldVaultKeys(wallet({ accountIndex: 1 }))).toBe(false);
    expect(canHoldVaultKeys(wallet({ parentWalletId: 3 }))).toBe(false);
  });
});

describe('the root key check', () => {
  it('derives m/1854\'/1815\'/0\' from this wallet\'s root key', async () => {
    expect(await multisigAccountKeyOfRoot(rootBytes, accountZero)).toBe(expected);
  });

  it('refuses a root key that does not derive this wallet\'s account #0', async () => {
    const other = Bip32PrivateKey.fromBip39Entropy(Buffer.alloc(16, 2), '').bytes();
    expect(await codeOf(multisigAccountKeyOfRoot(Uint8Array.from(other), accountZero))).toBe('not-supported');
    expect(await codeOf(multisigAccountKeyOfRoot(rootBytes, undefined))).toBe('not-supported');
  });
});

describe('the background flow', () => {
  it('decrypts with the spending password, answers with the public key and wipes the root key', async () => {
    const { deps: d, handed } = deps(wallet());
    expect(await deriveMultisigAccountKeyFlow({ walletId: 7, password: 'right' }, d)).toBe(expected);
    expect(handed).toHaveLength(1);
    expect(handed[0].every(b => b === 0)).toBe(true);
  });

  it('refuses a wrong or missing password', async () => {
    const { deps: d } = deps(wallet());
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 7, password: 'wrong' }, d))).toBe('wrong-password');
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 7 }, d))).toBe('wrong-password');
  });

  it('takes a Google wallet\'s key from its unlocked session only', async () => {
    const google = wallet({ type: WalletType.Google, encryptionMethod: 'mpc', encryptedPrivateKey: undefined });
    const session = Uint8Array.from(rootBytes);
    expect(await deriveMultisigAccountKeyFlow({ walletId: 7 }, deps(google, { sessionRootKey: () => session }).deps)).toBe(expected);
    expect(session.some(b => b !== 0)).toBe(true);
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 7 }, deps(google).deps))).toBe('locked');
  });

  it('leaves PassKey wallets to the page, and refuses unknown or unsupported wallets', async () => {
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 7, password: 'right' }, deps(wallet({ encryptionMethod: 'prf' })).deps))).toBe('not-supported');
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 8, password: 'right' }, deps(wallet()).deps))).toBe('not-found');
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: '7', password: 'right' }, deps(wallet()).deps))).toBe('not-found');
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 7, password: 'right' }, deps(wallet({ type: WalletType.Trezor })).deps))).toBe('not-supported');
    expect(await codeOf(deriveMultisigAccountKeyFlow({ walletId: 7, password: 'right' }, deps(wallet({ accountIndex: 2 })).deps))).toBe('not-supported');
  });
});

describe('the page client', () => {
  it('sends the wallet and password and reads the public key back', async () => {
    const send = vi.spyOn(Messaging, 'sendToBackgroundFromOptions').mockResolvedValue({ data: { success: true, publicKey: expected } });
    const key = await requestMultisigAccountKey(7, 'right');
    expect(key.hex).toBe(expected);
    expect(send).toHaveBeenCalledWith({ method: GEROVAULT_DERIVE_ACCOUNT_KEY, data: { walletId: 7, password: 'right' } });
  });

  it('says unavailable when no background handler answers, and passes refusals on', async () => {
    vi.spyOn(Messaging, 'sendToBackgroundFromOptions').mockResolvedValueOnce({ error: 'The message port closed' });
    expect(await codeOf(requestMultisigAccountKey(7, 'x'))).toBe('unavailable');
    vi.spyOn(Messaging, 'sendToBackgroundFromOptions').mockResolvedValueOnce({ data: { success: false, error: 'wrong-password' } });
    expect(await codeOf(requestMultisigAccountKey(7, 'x'))).toBe('wrong-password');
    vi.spyOn(Messaging, 'sendToBackgroundFromOptions').mockResolvedValueOnce({ data: { success: false, error: 'something else' } });
    expect(await codeOf(requestMultisigAccountKey(7, 'x'))).toBe('not-supported');
  });
});
