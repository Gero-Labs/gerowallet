import { defineStore } from 'pinia';
import Dexie, { liveQuery } from 'dexie';
import { appWallet } from '@/store';

export const walletConfigStore = defineStore( 'walletConfigStore', {
  persist: {
    paths: ['config']
  },
  state: () => ({
    config: undefined,
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
  },
});
