import Dexie, { DexieError } from 'dexie';
import { walletDBSchema, walletDBVersion } from '@/db/schema';

const dbCache: Map<string, Dexie> = new Map();

export async function getDb(id: number): Promise<Dexie> {
    const dbName = 'wallet-' + id;
    
    if (dbCache.has(dbName)) {
        return dbCache.get(dbName)!;
    }
    
    try {
        const db: Dexie = new Dexie(dbName);
        await db.open();
        dbCache.set(dbName, db);
        return db;
    } catch (error: DexieError | any) {
        console.log(error)
        if (error.name === 'NoSuchDatabaseError') {
            const db: Dexie = new Dexie(dbName);
            db.version(walletDBVersion).stores(walletDBSchema);
            await db.open();
            dbCache.set(dbName, db);
            return db;
        } else {
            console.error('Error opening database:', error);
            return null
        }
    }
}

export async function setWalletConfiguration(id: number, key: string, value: any) {
  const db: Dexie = await getDb(id);
  const configTable = db.table('config');
  const configuration = await configTable.where({ key: key }).first();
  if (!configuration) {
    await configTable.put({
      key: key,
      value: value
    });
  } else {
    console.log('Updating configuration', configuration)
    configuration.value = value;
    await configTable.put(configuration);
  }
}

export async function addOrUpdateContact(id: number, contact, address?: string) {
  const db: Dexie = await getDb(id);
  if (address) {
    db.table('contacts').update(address, {address: contact.address, name: contact.name})
  } else {
    db.table('contacts').put({address: contact.address, name: contact.name})
  }
}

export async function removeContact(id: number, address: string) {
  const db: Dexie = await getDb(id);
  db.table('contacts').delete(address)
}

export async function addConnectedDapp(walletId: number, domain: string) {
  try {
    const db: Dexie = await getDb(walletId);
    const dappsTable = db.table('connected_dapps');

    if (!dappsTable) throw new Error('No Connected Dapps Table.');

    // Check if the domain already exists in the table
    const existingDapp = await dappsTable.get({ domain: domain });

    if (existingDapp) {
      console.log(`Domain ${domain} already exists, ignoring.`);
      return existingDapp;
    }

    // Insert new domain
    const domainObject = { domain, time: new Date().getTime() };
    domainObject['id'] = await dappsTable.put(domainObject);
    console.log(`Domain ${domain} added successfully.`);

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


