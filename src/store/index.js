import {defineStore} from 'pinia'
import loading from "@/plugins/loading";

// import { ChromeSyncStorage } from '@/store/chrome-storage'
// import { LocalPersistedStorage} from "@/store/local-storage";

import db from "@/db";
import {Wallet} from "@/models/wallet";
import {Provider} from "@/models/types";
import {Api} from "@/api/api";

// const env = process.env.VUE_APP_ENV
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

export const useStore = defineStore('store', {
    persist: true,
    state: () => ({
        loggedWallet: undefined,
        wallets: [],
        locale: 'en',
        network: undefined,
        provider: undefined,
        tip: undefined,
        accountInfo: undefined
    }),
    getters: {
        isLoggedIn: state => !!(state.loggedWallet),
        getLoggedWallet: state => state.loggedWallet,
        getWallets: state => state.wallets,
        getLocale: state => state.locale,
        getNetwork: state => state.network,
        getWallet: state => {
            const wallet = Wallet.class(state.loggedWallet)
            return {
                wallet: wallet,
                provider: (state.provider.name === Provider.KOIOS) ? new Api(state.provider, wallet.baseAddress().to_address().to_bech32()) : null
            }
        }
    },
    actions: {
        async login(walletId) {
            loading.setLoading(true)
            console.log('login')
            const wallet = this.wallets.find(wal => wal.id === walletId)
            if (!wallet) {
                return null
            }
            this.provider = await db.getProvider(wallet.chain, wallet.network)

            setInterval(() => {

            }, 60000)
            const wall = Wallet.class(wallet)
            new Api(this.provider, wall.baseAddress().to_address().to_bech32())

            this.loggedWallet = wallet
            loading.setLoading(false)
        },
        logout() {
            loading.setLoading(true)
            this.loggedWallet = undefined
            this.provider = undefined
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
        setNetwork(network) {
            this.network = network
        },
        setTip(tip) {
            this.tip = tip
        },
        setAccountInfo(accountInfo) {
            this.accountInfo = accountInfo
        }
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