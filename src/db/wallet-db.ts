import Dexie from 'dexie';
import {
  walletDBSchema,
  walletDBVersion
} from '@/db/schema';

const dbCache = new Map<string, Dexie>();
const pendingOpens = new Map<string, Promise<Dexie | null>>();

export async function getDb(id: number): Promise<Dexie | null> {
  const dbName = 'wallet-' + id;
  const cached = dbCache.get(dbName);
  if (cached?.isOpen()) return cached;
  dbCache.delete(dbName);

  const pending = pendingOpens.get(dbName);
  if (pending) return pending;

  // Publish the pending open before any asynchronous initialization. Parallel
  // background callers must share one connection, including on first login.
  const opening = Promise.resolve().then(async (): Promise<Dexie | null> => {
    const db = new Dexie(dbName);
    try {
      // All historical changes were additive, with no data transformations.
      // The complete shared schema upgrades old wallets and retains multisig.
      db.version(walletDBVersion).stores(walletDBSchema);
      await db.open();
      dbCache.set(dbName, db);
      return db;
    } catch (error) {
      db.close();
      console.error('Error opening database:', error);
      return null;
    }
  }).finally(() => pendingOpens.delete(dbName));

  pendingOpens.set(dbName, opening);
  return opening;
}

export async function setWalletConfiguration(id: number, key: string, value) {
  const db: Dexie = await getDb(id);
  const configTable = db.table('config');
  const configuration = await configTable.where({ key: key }).first();
  if (!configuration) {
    await configTable.put({
      key: key,
      value: value
    });
  } else {
    configuration.value = value;
    await configTable.put(configuration);
  }
}

export async function addOrUpdateContact(id: number, contact, address?: string) {
  const db: Dexie = await getDb(id);
  const data = { address: contact.address, name: contact.name, handle: contact.handle || null };
  if (address) {
    await db.table('contacts').update(address, data);
  } else {
    await db.table('contacts').put(data);
  }
}

export async function removeContact(id: number, address: string) {
  const db: Dexie = await getDb(id);
  await db.table('contacts').delete(address);
}

export async function addConnectedDapp(walletId: number, domain: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const dappsTable = db.table('connected_dapps');

    if (!dappsTable) throw new Error('No Connected Dapps Table.');

    // Check if the domain already exists in the table
    const existingDapp = await dappsTable.get({ domain: domain });

    if (existingDapp) {
      return existingDapp;
    }

    // Insert new domain
    const domainObject = { domain, time: new Date().getTime() };
    domainObject['id'] = await dappsTable.put(domainObject);

    return domainObject;
  } catch (err) {
    console.error(`Failed to add connected dapp: ${err}`);
    throw err;
  }
}

export async function removeDapp(id: number, dappId: string) {
  const db: Dexie = await getDb(id);
  db.table('connected_dapps').delete(dappId)
}

export function clearDbCache(id: number) {
  const dbName = 'wallet-' + id;
  const db = dbCache.get(dbName);
  if (db) {
    db.close();
    dbCache.delete(dbName);
  }
}

export async function removePendingTransaction(walletId: number, txId: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const txTable = db.table('transactions');

    if (!txTable) throw new Error('No Transactions Table.');

    // Get the transaction to verify it's pending
    const transaction = await txTable.get(txId);

    if (!transaction) {
      console.warn(`Transaction ${txId} not found`);
      return false;
    }

    if (!transaction.pending) {
      console.warn(`Transaction ${txId} is not pending, cannot remove`);
      return false;
    }

    // Remove the transaction
    await txTable.delete(txId);

    return true;
  } catch (err) {
    console.error(`Failed to remove pending transaction: ${err}`);
    throw err;
  }
}

// Note: Portfolio data is now stored directly in wallet databases
// Old portfolio_* databases will be migrated during upgrade

