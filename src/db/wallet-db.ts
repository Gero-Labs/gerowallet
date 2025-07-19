import Dexie, { DexieError } from 'dexie';
import { walletDBSchema, walletDBVersion } from '@/db/schema';

export async function getDb(id: number): Promise<Dexie> {
    const dbName = 'wallet-' + id;
    try {
      const db: Dexie = new Dexie(dbName);
      return await db.open();
  } catch (error: DexieError | any) {
    console.log(error)
    if (error.name === 'NoSuchDatabaseError') {
      const db: Dexie = new Dexie(dbName);
      db.version(walletDBVersion).stores(walletDBSchema);
      return db.open();
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


