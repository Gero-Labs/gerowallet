import Dexie from 'dexie';
import { walletDBSchema, walletDBVersion } from '@/db/schema';

// Function to create and configure the Dexie instance for the wallet DB
function getWalletDB(walletId) {
  const db: Dexie = new Dexie('wallet-' + walletId);
  db.version(walletDBVersion).stores(walletDBSchema);
  return db;
}

export async function setAccountTransactions(walletId, txs): Promise<any> {
  return getWalletDB(walletId).open()
    .then(db => {
      const txsTable = db.table('transactions');
      if (txsTable) {
        txs = txs.map(tx => {
          return { id: tx.tx_hash, transaction: tx };
        });
        txsTable.bulkPut(txs);
      }
    }).catch(err => {
      console.error(`Failed to open database: ${err.stack || err}`);
    });
}
