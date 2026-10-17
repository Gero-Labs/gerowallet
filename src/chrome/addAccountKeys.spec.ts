// "Add account" for a recovery-phrase or Google wallet, with real key derivation:
// only the requested account's xpub comes out, from the wallet's own root key.
import { describe, it, expect, vi } from 'vitest';
import * as bip39 from 'bip39';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { Blockchain, Network, WalletType, type Wallet } from '@/models/types';
import { deriveAccountXpubs } from '@/shared/utils/softwareAccounts';
import { AddAccountError, deriveAccountXpubFlow } from './addAccountKeys';

// Fixed test vectors — never used to hold funds.
const rootOf = (mnemonic: string) => Bip32PrivateKey.fromBip39Entropy(Buffer.from(bip39.mnemonicToEntropy(mnemonic), 'hex'), '');
const ROOT = rootOf('legal winner thank year wave sausage worth useful legal winner thank yellow');
const OTHER_ROOT = rootOf('letter advice cage absurd amount doctor acoustic avoid letter advice cage above');

const xpub = async (root: Bip32PrivateKey, index: number) => (await deriveAccountXpubs(root, [index]))[0].publicKey;

async function wallets(): Promise<Record<number, Wallet>> {
  const base = { chain: Blockchain.CARDANO, network: Network.PREPROD, publicKey: await xpub(ROOT, 0) };
  return {
    1: { id: 1, name: 'Daily', type: WalletType.Normal, encryptionMethod: 'password', encryptedPrivateKey: 'sealed', ...base },
    2: { id: 2, name: 'Account #1', type: WalletType.Normal, encryptionMethod: 'password', ...base, publicKey: await xpub(ROOT, 1), accountIndex: 1, parentWalletId: 1 },
    3: { id: 3, name: 'Google', type: WalletType.Google, encryptionMethod: 'mpc', ...base },
    4: { id: 4, name: 'PassKey', type: WalletType.Normal, encryptionMethod: 'prf', prfEncryptedPrivateKey: 'prf-sealed', ...base },
    5: { id: 5, name: 'Ledger', type: WalletType.Ledger, ...base },
  };
}

function deps(overrides: { session?: Uint8Array; root?: Bip32PrivateKey } = {}) {
  const decrypted: Uint8Array[] = [];
  return {
    decrypted,
    getWallets: wallets,
    sessionRootKey: vi.fn((id: number) => (id === 3 ? overrides.session : undefined)),
    decryptRootKey: vi.fn((blob: string, password: string) => {
      if (blob !== 'sealed' || password !== 'right') throw new Error('wrong password');
      const bytes = Buffer.from((overrides.root ?? ROOT).bytes());
      decrypted.push(bytes);
      return bytes;
    }),
  };
}

const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: AddAccountError) => error.code);

describe('deriveAccountXpubFlow', () => {
  it('returns the requested account of a recovery-phrase wallet, and wipes the root key', async () => {
    const d = deps();
    await expect(deriveAccountXpubFlow({ walletId: 1, accountIndex: 3, password: 'right' }, d)).resolves.toBe(await xpub(ROOT, 3));
    expect(d.decrypted[0].every((byte) => byte === 0)).toBe(true);
  });

  it('works from an added account, through its account #0', async () => {
    await expect(deriveAccountXpubFlow({ walletId: 2, accountIndex: 2, password: 'right' }, deps())).resolves.toBe(await xpub(ROOT, 2));
  });

  it('refuses a wrong or missing password', async () => {
    expect(await failure(deriveAccountXpubFlow({ walletId: 1, accountIndex: 1, password: 'wrong' }, deps()))).toBe('wrong-password');
    expect(await failure(deriveAccountXpubFlow({ walletId: 1, accountIndex: 1 }, deps()))).toBe('wrong-password');
  });

  it('refuses a root key that is not this wallet’s', async () => {
    expect(await failure(deriveAccountXpubFlow({ walletId: 1, accountIndex: 1, password: 'right' }, deps({ root: OTHER_ROOT })))).toBe('not-supported');
  });

  it('uses an unlocked Google session, and asks to unlock without one', async () => {
    const session = Uint8Array.from(ROOT.bytes());
    await expect(deriveAccountXpubFlow({ walletId: 3, accountIndex: 1 }, deps({ session }))).resolves.toBe(await xpub(ROOT, 1));
    expect(session).toEqual(Uint8Array.from(ROOT.bytes())); // the session's copy is left alone
    expect(await failure(deriveAccountXpubFlow({ walletId: 3, accountIndex: 1 }, deps()))).toBe('locked');
  });

  it('leaves PassKey and hardware wallets, account #0 and unknown wallets alone', async () => {
    expect(await failure(deriveAccountXpubFlow({ walletId: 4, accountIndex: 1 }, deps()))).toBe('not-supported');
    expect(await failure(deriveAccountXpubFlow({ walletId: 5, accountIndex: 1 }, deps()))).toBe('not-supported');
    expect(await failure(deriveAccountXpubFlow({ walletId: 1, accountIndex: 0, password: 'right' }, deps()))).toBe('not-supported');
    expect(await failure(deriveAccountXpubFlow({ walletId: 9, accountIndex: 1 }, deps()))).toBe('not-found');
    await expect(deriveAccountXpubFlow({ walletId: 1, accountIndex: 2 ** 31, password: 'right' }, deps())).rejects.toThrow();
  });
});
