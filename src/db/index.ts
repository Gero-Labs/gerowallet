import Dexie from 'dexie';
import {
  blockChainDBSchema,
  blockChainDBVersion,
  walletDBSchema,
  walletDBVersion,
} from '@/db/schema';
import { debugLog } from '@/utils/debug';

let db: Dexie = null

const blockchainDbCache: Map<string, Dexie> = new Map();

export async function getBlockchainDb(chain: string, network: string): Promise<Dexie> {
  const dbName = `${chain}_${network}`;

  if (blockchainDbCache.has(dbName)) {
    return blockchainDbCache.get(dbName)!;
  }

  try {
    const db: Dexie = new Dexie(dbName);
    db.version(blockChainDBVersion).stores(blockChainDBSchema);
    await db.open();
    blockchainDbCache.set(dbName, db);
    return db;
  } catch (error: DexieError | any) {
    debugLog('Blockchain database error:', error)
    if (error.name === 'NoSuchDatabaseError') {
      const db: Dexie = new Dexie(dbName);
      db.version(blockChainDBVersion).stores(blockChainDBSchema);
      await db.open();
      blockchainDbCache.set(dbName, db);
      return db;
    } else {
      console.error('Error opening blockchain database:', error);
      return null
    }
  }
}

export function clearBlockchainDbCache(chain: string, network: string) {
  const dbName = `${chain}_${network}`;
  const db = blockchainDbCache.get(dbName);
  if (db) {
    db.close();
    blockchainDbCache.delete(dbName);
  }
}

export default {
  async getAllWallets() {
    return db['wallets'].toArray();
  },
  async checkAndCreateBlockchainDatabase(dbName: string) {
    try {
      // Attempt to open the database
      const db: Dexie = new Dexie(dbName);
      return db.open();
    } catch (error: DexieError | any) {
      console.log(error)
      if (error.name === 'NoSuchDatabaseError') {
        // Database does not exist, create it
        const db: Dexie = new Dexie(dbName);
        this.setBlockchainDBVersionSchema(db)
        return db.open();
      } else {
        // Handle other errors
        console.error('Error opening database:', error);
        return null
      }
    }
  },
  setBlockchainDBVersionSchema(db: Dexie) {
    db.version(blockChainDBVersion).stores(blockChainDBSchema);
  },
  setWalletDBVersionSchema(db: Dexie) {
    console.log('setWalletDBVersionSchema')
    db.version(walletDBVersion).stores(walletDBSchema);
  },
  async checkIfDbExists(dbName: string) {
    return Dexie.exists(dbName);
  }
};
