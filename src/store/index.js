import Vue from 'vue'
import Vuex from 'vuex'
import createPersistedState from 'vuex-persistedstate'
import db from "@/db";
import i18n from "@/plugins/i18n";

const env = process.env.VUE_APP_ENV

Vue.use(Vuex)

export default new Vuex.Store({
    namespaced: true,
    state: {
        wallets: [],
        loading: false,
        locale: 'en'
    },
    plugins: [
        createPersistedState({
            getState: async key => {
                if (env === 'production') {
                    // eslint-disable-next-line
                    const res = await chrome.storage.sync.get([key])
                    if (Object.keys(res).length === 0) {
                        return null
                    }
                    return res[key];
                } else {
                    console.log(JSON.parse(localStorage.getItem(key)))
                    return JSON.parse(localStorage.getItem(key))
                }
            },
            setState: async (key, state) => {
                if (env === 'production') {
                    // eslint-disable-next-line
                    await chrome.storage.sync.set({[key]: state});
                } else {
                    localStorage.setItem(key, JSON.stringify(state))
                    console.log('set')
                    console.log(JSON.parse(localStorage.getItem(key)))
                }
            },
        }),
    ],
    mutations: {
        async loginSuccess(state, payload) {
            state.wallets = payload.wallets
        },
        setLoading(state, payload) {
            state.loading = payload
        },
        setLocale(state, payload) {
            state.locale = payload.locale
            i18n.locale = state.locale
        }
    },
    actions: {
        async login({commit}) {
            commit('setLoading', true)
            const wallets = await db.getAllWallets()
            if (Array.isArray(wallets) && wallets.length) {
                commit('loginSuccess', {wallets})
            }
            commit('setLoading', false)
        },
        setLocale({commit}, locale) {
            commit('setLocale', locale)
        }
    },
    getters: {
        isLoggedIn: state => !!(Array.isArray(state.wallets) && state.wallets.length),
        getWallets: state => state.wallets,
        getLocale: state => state.locale
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