import Dexie, { DexieError } from 'dexie';
import {
  blockChainDBSchema,
  blockChainDBVersion,
  walletDBSchema,
  walletDBVersion,
} from '@/db/schema';

let db: Dexie = null

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
