// Accounts added under a recovery-phrase wallet, against a real (in-memory)
// IndexedDB: createAccountWallet, getAllWallets and the duplicate check all live
// in gero-db, which a vi.mock() of that module cannot intercept.
import 'fake-indexeddb/auto';
import { describe, it, expect, beforeAll } from 'vitest';
import { Blockchain, Network, Theme, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import { createAccountWallet, createNewHardwareWallet, createNewWallet, derivePublicKeyFromMnemonic, getAllWallets, DuplicateWalletError } from '@/db/gero-db';
import { getDb } from '@/db/wallet-db';
import { deriveAccountXpubsFromMnemonic } from '@/shared/utils/softwareAccounts';
import { GROUP_SECRET_FIELDS } from '@/shared/utils/walletAccount';
import { deriveBitcoinRootKey } from '@/chains/bitcoin/bitcoinKeyManager';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';

// Fixed test vector — never used to hold funds.
const MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const PASSWORD = 'Test-Password-1!';

let headId: number;
let xpubs: string[];

beforeAll(async () => {
  headId = await createNewWallet('Daily', 'icon', Theme.GERO, MNEMONIC, PASSWORD, Blockchain.CARDANO, Network.PREPROD) as number;
  xpubs = (await deriveAccountXpubsFromMnemonic(MNEMONIC, [0, 1, 2])).map((account) => account.publicKey);
});

const stored = async (id: number): Promise<Wallet> => ((await getAllWallets()) as Record<number, Wallet>)[id];

describe('account xpubs of a recovery phrase', () => {
  it('derives account #0 exactly as the stored wallet has it, so duplicates are found', async () => {
    expect(xpubs[0]).toBe(await derivePublicKeyFromMnemonic(MNEMONIC));
    expect((await stored(headId)).publicKey).toBe(xpubs[0]);
    expect(new Set(xpubs).size).toBe(3);
  });
});

describe('createAccountWallet', () => {
  it('stores the account under its account #0, with none of the wallet’s secrets', async () => {
    const account = await createAccountWallet(headId, { name: 'Account #1', publicKey: xpubs[1], accountIndex: 1 });
    const record = await stored(account.id);

    expect(record).toMatchObject({
      name: 'Account #1', chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal,
      encryptionMethod: 'password', publicKey: xpubs[1], accountIndex: 1, parentWalletId: headId,
    });
    for (const field of GROUP_SECRET_FIELDS.filter((f) => f !== 'encryptionMethod')) {
      expect(record[field]).toBeUndefined();
    }
    // No recovery phrase on the account, so no backup reminder of its own.
    const rows = await (await getDb(account.id)).table('config').toArray();
    expect(rows.map((row: { key: string }) => row.key)).not.toContain('backup');
  });

  it('refuses an account Gero already has', async () => {
    await expect(createAccountWallet(headId, { name: 'Again', publicKey: xpubs[1], accountIndex: 1 }))
      .rejects.toBeInstanceOf(DuplicateWalletError);
  });

  it('refuses account #0, an added account as parent, a missing parent and a hardware wallet', async () => {
    const added = Object.values((await getAllWallets()) as Record<number, Wallet>).find((w) => w.parentWalletId === headId)!;
    const ledgerId = await createNewHardwareWallet({ name: 'Ledger', type: WalletType.Ledger, chain: Blockchain.CARDANO, network: Network.PREPROD, publicKey: 'xpub1ledgerplaceholder' });

    await expect(createAccountWallet(headId, { name: 'x', publicKey: xpubs[2], accountIndex: 0 })).rejects.toThrow();
    await expect(createAccountWallet(added.id, { name: 'x', publicKey: xpubs[2], accountIndex: 2 })).rejects.toThrow();
    await expect(createAccountWallet(999_999, { name: 'x', publicKey: xpubs[2], accountIndex: 2 })).rejects.toThrow();
    await expect(createAccountWallet(ledgerId as number, { name: 'x', publicKey: xpubs[2], accountIndex: 2 })).rejects.toThrow();
    await expect(createAccountWallet(headId, { name: 'x', publicKey: xpubs[2], accountIndex: -1 })).rejects.toThrow();
  });
});

describe('createAccountWallet on Bitcoin', () => {
  it('stores a Bitcoin account under its recovery-phrase wallet, with its address type and none of its secrets', async () => {
    const btcId = await createNewWallet('Savings', 'icon', Theme.GERO, MNEMONIC, PASSWORD, Blockchain.BITCOIN, Network.TESTNET) as number;
    const head = await stored(btcId);
    const [own, next] = await deriveAccountXpubsFromMnemonic(MNEMONIC, [0, 1], { chain: Blockchain.BITCOIN, network: Network.TESTNET });
    expect(head.publicKey).toBe(own.publicKey);

    const account = await createAccountWallet(btcId, { name: 'Account #1', publicKey: next.publicKey, accountIndex: 1 });
    const record = await stored(account.id);

    expect(record).toMatchObject({ chain: Blockchain.BITCOIN, network: Network.TESTNET, type: WalletType.Normal, addressType: 'segwit', publicKey: next.publicKey, accountIndex: 1, parentWalletId: btcId });
    expect(record.encryptedMnemonic).toBeUndefined();
    expect(record.encryptedPrivateKey).toBeUndefined();
  });

  it('stores the phrase’s master key fingerprint, which its added accounts share', async () => {
    // BIP32: the first four bytes of hash160 of the master public key.
    const masterFingerprint = Buffer.from(ripemd160(sha256(deriveBitcoinRootKey(MNEMONIC).publicKey!)).subarray(0, 4)).toString('hex');
    const btcId = await createNewWallet('Savings mainnet', 'icon', Theme.GERO, MNEMONIC, PASSWORD, Blockchain.BITCOIN, Network.MAINNET) as number;
    const [, next] = await deriveAccountXpubsFromMnemonic(MNEMONIC, [0, 1], { chain: Blockchain.BITCOIN, network: Network.MAINNET });

    const account = await createAccountWallet(btcId, { name: 'Account #1', publicKey: next.publicKey, accountIndex: 1 });

    expect((await stored(btcId)) as Wallet & { xfp?: string }).toMatchObject({ xfp: masterFingerprint });
    expect((await stored(account.id)) as Wallet & { xfp?: string }).toMatchObject({ xfp: masterFingerprint });
  });

  it('refuses a Bitcoin hardware wallet as parent', async () => {
    const ledgerId = await createNewHardwareWallet({ name: 'BTC Ledger', type: WalletType.Ledger, chain: Blockchain.BITCOIN, network: Network.TESTNET, publicKey: 'xpub-btc-ledger-placeholder' });
    await expect(createAccountWallet(ledgerId as number, { name: 'x', publicKey: 'xpub-other', accountIndex: 1 })).rejects.toThrow();
  });
});

describe('a new wallet whose phrase the caller generated', () => {
  const backupRow = async (id: number) => (await (await getDb(id)).table('config').toArray())
    .find((row: { key: string }) => row.key === 'backup')?.value;

  it('still asks for a backup, where a typed phrase counts as restored', async () => {
    // Another fixed test vector — never used to hold funds.
    const generated = 'letter advice cage absurd amount doctor acoustic avoid letter advice cage above';
    const id = await createNewWallet('Fresh', 'icon', Theme.GERO, generated, PASSWORD, Blockchain.CARDANO, Network.PREPROD, undefined, { generatedMnemonic: true }) as number;

    expect(await backupRow(id)).toBe(false);
    expect(await backupRow(headId)).toBe(true);
    // Its account #0 is the key the onboarding read from the same phrase.
    expect((await stored(id)).publicKey).toBe((await deriveAccountXpubsFromMnemonic(generated, [0]))[0].publicKey);
  });
});
