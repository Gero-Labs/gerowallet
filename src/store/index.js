import { defineStore } from 'pinia'
import loading from "@/plugins/loading";

// import { ChromeSyncStorage } from '@/store/chrome-storage'
// import { LocalPersistedStorage} from "@/store/local-storage";

import db from "@/db";
import {Wallet} from "@/models/wallet";

// const env = process.env.VUE_APP_ENV
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

export const useStore = defineStore('store',{
    persist: true,
    state: () => ({
        loggedWalletId: undefined,
        wallets: [],
        locale: 'en',
        network: undefined
    }),
    getters: {
        isLoggedIn: state => !!(state.loggedWalletId),
        getLoggedWalletId: state => state.loggedWalletId,
        getWallets: state => state.wallets,
        getLocale: state => state.locale,
        getNetwork: state => state.network,
        getWalletAddress: state => {
            const wallet = state.wallets.find(wallet => wallet.walletId === state.loggedWalletId)
            console.log(wallet)
        }
    },
    actions: {
        login(walletId){
            loading.setLoading(true)
            console.log('loading')
            this.loggedWalletId = walletId
            this.loadWallets()
            loading.setLoading(false)
        },
        logout() {
            loading.setLoading(true)
            this.loggedWalletId = undefined
            loading.setLoading(false)
        },
        async loadWallets() {
            const result = []
            loading.setLoading(true)
            const wallets = await db.getAllWallets()
            if (Array.isArray(wallets) && wallets.length) {
                this.wallets = wallets.map(wallet => new Wallet(wallet.walletId, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order, wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network))
            }
            loading.setLoading(false)
        },
        setLocale(locale) {
            this.locale = locale
        },
        setNetwork(network) {
            this.network = network
        },
    }
})


// export default {
//     namespaced: true,
//     save(key, value) {
//         if (env === 'production') {
//             // eslint-disable-next-line
//             chrome.storage.sync.set({ [key]: value });
//         } else {
//             localStorage.setItem(key, JSON.stringify(value))
//         }
//     },
//     async get(key) {
//         if (env === 'production') {
//             // eslint-disable-next-line
//             const res = await chrome.storage.sync.get([key])
//             if (Object.keys(res).length === 0) {
//                 return null
//             }
//             return res[key];
//         } else {
//             return JSON.parse(localStorage.getItem(key))
//         }
//     }
// }