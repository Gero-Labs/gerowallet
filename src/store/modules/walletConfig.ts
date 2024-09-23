import { defineStore } from 'pinia';
import Dexie, { liveQuery } from 'dexie';
import { appWallet } from '@/store';
import { STORAGE } from '@/chrome/config';

export const walletConfigStore = defineStore( 'walletConfigStore', {
  persist: {
    paths: ['config', 'utxos', 'addresses', 'account']
  },
  state: () => ({
    config: undefined,
    utxos: undefined,
    addresses: undefined,
    account: undefined
  }),
  getters: {
    getTxAutoSubmit(state) {
      console.log(state.config)
      if ('txAutoSubmit' in state.config) {
        return state.config.txAutoSubmit
      }
      return true
    }
  },
  actions: {
    async setUtxos(utxos) {
      console.log('Setting UTXOs:', utxos);
      this.utxos = utxos
      if (chrome?.storage) {
        if (utxos) {
          await chrome.storage.local.set({ [STORAGE.utxos]: utxos });
        } else {
          await chrome.storage.local.remove(STORAGE.utxos);
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
    async loadConfig() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        liveQuery(() => db.table('config').toArray()).subscribe({
          next: value => {
            this.config = value.reduce(function(map, val) {
              map[val.key] = val.value
              return map
            }, {});
            resolve(this.config)
          }
        })
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
        liveQuery(() => db.table('addresses').toArray()).subscribe({
          next: value => {
            this.setAddresses(value.reduce(function(map, val) {
              map[val.address] = val
              return map
            }, {}));
            resolve(this.addresses)
          }
        })
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
        liveQuery(() => appWallet && db.table('account').where({walletId: appWallet.id}).first()).subscribe({
          next: newAccount => {
            this.setAccount(newAccount)
            resolve(this.account)
          },
          error: error => {
            console.error('Failed to Fetch AccountInfo:', error)
            reject(error)
          }
        });
      });
    },
  },
});
