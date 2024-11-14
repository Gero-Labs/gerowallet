import { defineStore } from 'pinia';
import Dexie, { liveQuery } from 'dexie';
import { appWallet, subscriptions } from '@/store';
import { STORAGE } from '@/chrome/config';
import db from '@/db';

export const walletConfigStore = defineStore( 'walletConfigStore', {
  persist: {
    paths: ['config', 'utxos', 'addresses', 'account', 'collateral', 'contacts']
  },
  state: () => ({
    config: undefined,
    utxos: undefined,
    collateral: undefined,
    addresses: undefined,
    account: undefined,
    contacts: undefined,
  }),
  getters: {
    getTxAutoSubmit(state) {
      if (state?.config && 'txAutoSubmit' in state.config) {
        return state.config.txAutoSubmit
      }
      return true
    },
    getHideScamTokens(state) {
      if (state?.config && 'hideScamTokens' in state.config) {
        return state.config.hideScamTokens
      }
      return false
    },
    getHideUnverifiedTokens(state) {
      if (state?.config && 'hideUnverifiedTokens' in state.config) {
        return state.config.hideUnverifiedTokens
      }
      return false
    },
    getHideUnratedTokens(state) {
      if (state?.config && 'hideUnratedTokens' in state.config) {
        return state.config.hideUnratedTokens
      }
      return false
    },
    getTokenAllocationTableSort(state) {
      console.log(state.config)
      if (state?.config && 'tokenAllocationSort' in state.config) {
        return state.config.tokenAllocationSort
      }
      return {
        by: 'total_allocation',
        desc: true
      }
    }
  },
  actions: {
    async setUtxos(utxos) {
      console.log('Setting UTXOs:', utxos);
      this.utxos = utxos
      if (this.utxos) {
        const collateralCandidates = this.utxos.filter(utxo => utxo.asset_list.length === 0 && Number(utxo.value) >= 5000000 && Number(utxo.value) <= 20000000).sort((a, b) => {
          return Number(a.value) - Number(b.value)
        })
        if (collateralCandidates && collateralCandidates.length > 0) {
          await this.setCollateral(collateralCandidates[0])
        }
      }
      if (chrome?.storage) {
        if (utxos) {
          await chrome.storage.local.set({ [STORAGE.utxos]: utxos });
        } else {
          await chrome.storage.local.remove(STORAGE.utxos);
        }
      }
    },
    async setCollateral(collateral) {
      this.collateral = collateral
      if (chrome?.storage) {
        if (collateral) {
          await chrome.storage.local.set({ [STORAGE.collateral]: collateral });
        } else {
          await chrome.storage.local.remove(STORAGE.collateral);
        }
      }
    },
    async setAddresses(addresses) {
      this.addresses = addresses
      if (chrome?.storage) {
        if (addresses) {
          await chrome.storage.local.set({ [STORAGE.addresses]: addresses });
        } else {
          await chrome.storage.local.remove(STORAGE.addresses);
        }
      }
    },
    async setAccount(account) {
      this.account = account
      if (chrome?.storage) {
        if (account) {
          await chrome.storage.local.set({ [STORAGE.account]: account });
        } else {
          await chrome.storage.local.remove(STORAGE.account);
        }
      }
    },
    async setTxAutoSubmit(val) {
      const db: Dexie = await appWallet.getDb()
      db.table('config').put({key: 'txAutoSubmit', value: val})
    },
    async setHideScamTokens(val) {
      if (appWallet) {
        const db: Dexie = await appWallet.getDb()
        db.table('config').put({key: 'hideScamTokens', value: val})
      }
    },
    async setHideUnverifiedTokens(val) {
      if (appWallet) {
        const db: Dexie = await appWallet.getDb()
        db.table('config').put({key: 'hideUnverifiedTokens', value: val})
      }
    },
    async setHideUnratedTokens(val) {
      if (appWallet) {
        const db: Dexie = await appWallet.getDb()
        db.table('config').put({key: 'hideUnratedTokens', value: val})
      }
    },
    async setTokenAllocationTableSort(val) {
      if (appWallet) {
        const db: Dexie = await appWallet.getDb()
        db.table('config').put({key: 'tokenAllocationSort', value: val})
      }
    },
    setContacts(contacts) {
      this.contacts = contacts
    },
    async addOrUpdateContact(contact, address?: string) {
      if (this.contacts[contact.address] == null || this.contacts[contact.address].name != contact.name) {
        const db: Dexie = await appWallet.getDb()
        if (address) {
          db.table('contacts').update(address, {address: contact.address, name: contact.name})
        } else {
          db.table('contacts').put({address: contact.address, name: contact.name})
        }
      }
    },
    async removeContact(address) {
      const db: Dexie = await appWallet.getDb()
      db.table('contacts').delete(address)
    },
    async loadConfig() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => db.table('config').toArray()).subscribe({
          next: value => {
            this.config = value.reduce(function(map, val) {
              map[val.key] = val.value
              return map
            }, {});
            resolve(this.config)
          }
        }));
      })
    },
    async loadAddresses() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => db.table('addresses').toArray()).subscribe({
          next: value => {
            this.setAddresses(value.reduce(function(map, val) {
              map[val.address] = val
              return map
            }, {}));
            resolve(this.addresses)
          }
        }));
      })
    },
    async loadAccountInfo() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => appWallet && db.table('account').where({walletId: appWallet.id}).first()).subscribe({
          next: newAccount => {
            this.setAccount(newAccount)
            resolve(this.account)
          },
          error: error => {
            console.error('Failed to Fetch AccountInfo:', error)
            reject(error)
          }
        }));
      });
    },
    async loadContacts() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      let walletDB: Dexie = await appWallet.getDb()

      // Check if the 'contacts' table exists, if not, create it
      if (!walletDB.tables.some(table => table.name === 'contacts')) {
        try {
          // Close the database first
          await walletDB.close();

          // Increment the version and define the new schema
          walletDB = new Dexie(walletDB.name);
          db.setWalletDBVersionSchema(walletDB)

          // Re-open the database
          await walletDB.open();
        } catch (error) {
          console.error('Error creating table or reopening DB:', error);
          throw error;
        }
      }

      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => walletDB.table('contacts').toArray()).subscribe({
          next: newContacts => {
            this.setContacts(newContacts.reduce(function(map, contact) {
              map[contact.address] = contact
              return map;
            }, {}))
            resolve(this.contacts);
          },
          error: error => {
            console.error('Failed to Fetch Contacts:', error)
            reject(error);
          }
        }));
      });
    },
  },
});
