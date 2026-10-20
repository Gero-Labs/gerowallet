// Midnight wallets created before #1333 was fixed were stored as backed up
// without the user confirming the phrase. The GeroWalletDatabase v17 upgrade
// stamps them and applyPendingBackupRecheck() turns the stamp back into "backup
// required" at login. Runs against a real (in-memory) IndexedDB seeded at v16,
// so the actual Dexie upgrade path executes.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeAll, describe, expect, it } from 'vitest';
import { Blockchain, Network, Theme, WalletType } from '@/models/types';
import type { Wallet } from '@/models/types';
import { geroDBSchema, geroWalletDbName, walletDBSchema, walletDBVersion } from '@/db/schema';
import { applyPendingBackupRecheck, createNewWallet, getDb } from '@/db/gero-db';

// Opaque placeholders: the upgrade only checks that a phrase is stored.
const CIPHERTEXT = 'synthetic-ciphertext';
const ADDRESSES = { unshielded: 'synthetic-unshielded', shielded: 'synthetic-shielded', dust: 'synthetic-dust' };

const MIDNIGHT_PASSWORD = 1;
const MIDNIGHT_PRF_PENDING = 2;
const MIDNIGHT_NO_PHRASE = 3;
const CARDANO = 4;

const base = { icon: 'icon', type: WalletType.Normal, theme: Theme.GERO, passwordLastUpdate: new Date() };
const legacyWallets = [
  { ...base, id: MIDNIGHT_PASSWORD, order: 1, name: 'Midnight', chain: Blockchain.MIDNIGHT, network: Network.PREPROD, publicKey: 'm1', encryptionMethod: 'password', encryptedPrivateKey: CIPHERTEXT, encryptedMnemonic: CIPHERTEXT },
  { ...base, id: MIDNIGHT_PRF_PENDING, order: 2, name: 'Midnight PassKey', chain: Blockchain.MIDNIGHT, network: Network.PREPROD, publicKey: 'm2', encryptionMethod: 'prf', prfEncryptedPrivateKey: CIPHERTEXT, prfEncryptedMnemonic: CIPHERTEXT },
  { ...base, id: MIDNIGHT_NO_PHRASE, order: 3, name: 'Midnight no phrase', chain: Blockchain.MIDNIGHT, network: Network.PREPROD, publicKey: 'm3', encryptionMethod: 'password', encryptedPrivateKey: CIPHERTEXT },
  { ...base, id: CARDANO, order: 4, name: 'Cardano', chain: Blockchain.CARDANO, network: Network.PREPROD, publicKey: 'c4', encryptionMethod: 'password', encryptedPrivateKey: CIPHERTEXT, encryptedMnemonic: CIPHERTEXT },
];
const legacyBackup: Record<number, boolean> = { [MIDNIGHT_PASSWORD]: true, [MIDNIGHT_PRF_PENDING]: false, [CARDANO]: true };

async function seedV16(): Promise<void> {
  const gero = new Dexie(geroWalletDbName);
  gero.version(16).stores(geroDBSchema);
  await gero.open();
  await gero.table('wallets').bulkAdd(legacyWallets);
  gero.close();
  for (const [id, backup] of Object.entries(legacyBackup)) {
    const walletDb = new Dexie(`wallet-${id}`);
    walletDb.version(walletDBVersion).stores(walletDBSchema);
    await walletDb.open();
    await walletDb.table('config').bulkAdd([{ key: 'currency', value: 'usd' }, { key: 'backup', value: backup }]);
    walletDb.close();
  }
}

async function storedWallet(id: number): Promise<Wallet> {
  return (await getDb())['wallets'].get(id);
}

async function backupFlag(id: number): Promise<unknown> {
  const walletDb = new Dexie(`wallet-${id}`);
  walletDb.version(walletDBVersion).stores(walletDBSchema);
  try {
    return (await walletDb.table('config').get('backup'))?.value;
  } finally {
    walletDb.close();
  }
}

describe('Midnight backup recheck (#1333)', () => {
  beforeAll(async () => {
    await seedV16();
    await getDb(); // opening at v17 runs the upgrade
  });

  it('stamps only Midnight wallets that hold a recovery phrase', async () => {
    expect((await storedWallet(MIDNIGHT_PASSWORD)).backupRecheckPending).toBe(true);
    expect((await storedWallet(MIDNIGHT_PRF_PENDING)).backupRecheckPending).toBe(true);
    expect((await storedWallet(MIDNIGHT_NO_PHRASE)).backupRecheckPending).toBeUndefined();
    expect((await storedWallet(CARDANO)).backupRecheckPending).toBeUndefined();
  });

  it('marks a stamped backed-up wallet as pending backup once', async () => {
    expect(await applyPendingBackupRecheck(MIDNIGHT_PASSWORD)).toBe(true);
    expect(await backupFlag(MIDNIGHT_PASSWORD)).toBe(false);
    expect('backupRecheckPending' in await storedWallet(MIDNIGHT_PASSWORD)).toBe(false);

    // The user then backs the phrase up; a later login must not undo it.
    const walletDb = new Dexie(`wallet-${MIDNIGHT_PASSWORD}`);
    walletDb.version(walletDBVersion).stores(walletDBSchema);
    await walletDb.table('config').put({ key: 'backup', value: true });
    walletDb.close();
    expect(await applyPendingBackupRecheck(MIDNIGHT_PASSWORD)).toBe(false);
    expect(await backupFlag(MIDNIGHT_PASSWORD)).toBe(true);
  });

  it('only clears the stamp of a wallet already pending backup', async () => {
    expect(await applyPendingBackupRecheck(MIDNIGHT_PRF_PENDING)).toBe(false);
    expect(await backupFlag(MIDNIGHT_PRF_PENDING)).toBe(false);
    expect('backupRecheckPending' in await storedWallet(MIDNIGHT_PRF_PENDING)).toBe(false);
  });

  it('leaves unstamped wallets alone', async () => {
    expect(await applyPendingBackupRecheck(CARDANO)).toBe(false);
    expect(await backupFlag(CARDANO)).toBe(true);
    expect(await applyPendingBackupRecheck(999)).toBe(false);
  });

  it('never stamps a Midnight wallet restored after the upgrade', async () => {
    const mnemonic = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
    const id = await createNewWallet('Restored later', 'icon', Theme.GERO, mnemonic, 'Valid-Pass-123!', Blockchain.MIDNIGHT, Network.PREPROD, undefined, { midnightAddresses: ADDRESSES });
    expect((await storedWallet(id)).backupRecheckPending).toBeUndefined();
    expect(await applyPendingBackupRecheck(id)).toBe(false);
    expect(await backupFlag(id)).toBe(true);
  });
});
