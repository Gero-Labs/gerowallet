import { defineStore } from 'pinia';
import Dexie, { liveQuery } from 'dexie';
import { appWallet, subscriptions } from '@/stores';
import db from '@/db';

export const governanceStore = defineStore( 'governanceStore', {
  persist: {
    paths: ['dreps', 'drepId']
  },
  state: () => ({
    dreps: undefined,
    drepId: undefined,
  }),
  getters: {

  },
  actions: {
    setDRepId(drepId) {
      this.drepId = drepId
    },
    async loadDReps() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      let blockchainDB: Dexie = await appWallet.getBlockchainDb()

      // Check if the 'dreps' table exists, if not, create it
      if (!blockchainDB.tables.some(table => table.name === 'dreps')) {
        try {
          // Close the database first
          await blockchainDB.close();

          // Increment the version and define the new schema
          blockchainDB = new Dexie(blockchainDB.name);
          db.setBlockchainDBVersionSchema(blockchainDB)

          // Re-open the database
          await blockchainDB.open();
        } catch (error) {
          console.error('Error creating table or reopening DB:', error);
          throw error;
        }
      }

      return new Promise((resolve, reject) => {
        subscriptions.set('governance', liveQuery(() => blockchainDB.table('dreps').toArray()).subscribe({
          next: newDReps => {
            this.dreps = newDReps.reduce(function(map, drep) {
              map[drep.drep_id] = drep
              return map;
            }, {})
            resolve(this.dreps);
          },
          error: error => {
            console.error('Failed to Fetch DReps:', error)
            reject(error);
          }
        }));
      });
    },
  }
});
