import { defineStore } from 'pinia'
import loading from "@/plugins/loading";

// import { ChromeSyncStorage } from '@/store/chrome-storage'
// import { LocalPersistedStorage} from "@/store/local-storage";

import db from "@/db";
import i18n from "@/plugins/i18n";

// const env = process.env.VUE_APP_ENV
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

export const useStore = defineStore('store',{
    persist: true,
    state: () => ({
        loggedWalletId: undefined,
        wallets: [],
        locale: 'en'
    }),
    getters: {
        isLoggedIn: state => !!(state.loggedWalletId),
        getLoggedWalletId: state => state.loggedWalletId,
        getWallets: state => state.wallets,
        getLocale: state => state.locale
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
            loading.setLoading(true)
            const wallets = await db.getAllWallets()
            if (Array.isArray(wallets) && wallets.length) {
                this.wallets = wallets
            }
            loading.setLoading(false)
        },
        setLocale(locale) {
            this.locale = locale
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