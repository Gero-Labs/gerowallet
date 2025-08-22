import Dexie, { DexieError } from 'dexie';
import {
  blockChainDBSchema,
  blockChainDBVersion,
  portfolioDBSchema,
  portfolioDBVersion,
} from '@/db/schema';

let db: Dexie = null

const blockchainDbCache: Map<string, Dexie> = new Map();
const portfolioDbCache: Map<string, Dexie> = new Map();

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
    console.debug('Blockchain database error:', error)
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

export async function getPortfolioDb(address: string): Promise<Dexie> {
  const dbName = `portfolio_${address}`;
  const db: Dexie = new Dexie(dbName);
  db.version(portfolioDBVersion).stores(portfolioDBSchema);
  await db.open();
  return db;
}

export function clearBlockchainDbCache(chain: string, network: string) {
  const dbName = `${chain}_${network}`;
  const db = blockchainDbCache.get(dbName);
  if (db) {
    db.close();
    blockchainDbCache.delete(dbName);
  }
}

export function clearPortfolioDbCache(address: string) {
  const dbName = `portfolio_${address}`;
  const db = portfolioDbCache.get(dbName);
  if (db) {
    db.close();
    portfolioDbCache.delete(dbName);
  }
}

export default {
  async getAllWallets() {
    return db['wallets'].toArray();
  },

  async getGoogleWalletWithEmail(email: string) {
    const wallets = await db['wallets'].where('userId').equals(email).toArray();
    if (wallets && wallets.length > 0) {
      return wallets[0];
    }
    return null;
  },
  async checkAndCreateBlockchainDatabase(dbName: string) {
    try {
      // Attempt to open the database
      const db: Dexie = new Dexie(dbName);
      return await db.open();
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
  async createPortfolioDatabase(address: string) {
    const db = await getPortfolioDb(address);
    this.setPortfolioDBVersionSchema(db);
    return db;
  },
  setBlockchainDBVersionSchema(db: Dexie) {
    db.version(blockChainDBVersion).stores(blockChainDBSchema);
  },
  setPortfolioDBVersionSchema(db: Dexie) {
    db.version(portfolioDBVersion).stores(portfolioDBSchema);
  },
  async checkIfDbExists(dbName: string) {
    return await Dexie.exists(dbName);
  }
};
