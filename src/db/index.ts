import Dexie, { DexieError } from 'dexie';
import {
  blockChainDBSchema,
  blockChainDBVersion,
  walletDBSchema,
  walletDBVersion,
} from '@/db/schema';

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

export function clearBlockchainDbCache(chain: string, network: string) {
  const dbName = `${chain}_${network}`;
  const db = blockchainDbCache.get(dbName);
  if (db) {
    db.close();
    blockchainDbCache.delete(dbName);
  }
}

/**
 * Set staking pools data in blockchain database
 * Used by alarm-based refresh mechanism
 */
export async function setStakingPools(chain: string, network: string, stakingPoolsData: any[]): Promise<void> {
  const blockchainDB = await getBlockchainDb(chain, network);
  if (!blockchainDB) {
    throw new Error('Failed to get blockchain database');
  }

  if (stakingPoolsData && stakingPoolsData.length > 0) {
    const poolsTable = blockchainDB.table('pools');
    await poolsTable.bulkPut(stakingPoolsData);
    console.debug(`✅ Staking pools stored in database (${stakingPoolsData.length} pools)`);
  } else {
    console.warn('⚠️ No staking pools data to store');
  }
}

/**
 * Set DReps data in blockchain database
 * Used by alarm-based refresh mechanism
 */
export async function setDReps(chain: string, network: string, drepsData: any[]): Promise<void> {
  const blockchainDB = await getBlockchainDb(chain, network);
  if (!blockchainDB) {
    throw new Error('Failed to get blockchain database');
  }

  if (drepsData && drepsData.length > 0) {
    const drepsTable = blockchainDB.table('dreps');
    await drepsTable.bulkPut(drepsData);
    console.debug(`✅ DReps stored in database (${drepsData.length} DReps)`);
  } else {
    console.warn('⚠️ No DReps data to store');
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
  setBlockchainDBVersionSchema(db: Dexie) {
    db.version(blockChainDBVersion).stores(blockChainDBSchema);
  },
  setWalletDBVersionSchema(db: Dexie) {
    console.log('setWalletDBVersionSchema')
    db.version(walletDBVersion).stores(walletDBSchema);
  },
  async checkIfDbExists(dbName: string) {
    return await Dexie.exists(dbName);
  }
};
