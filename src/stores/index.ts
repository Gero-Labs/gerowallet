import { defineStore } from 'pinia';
import loading from '@/plugins/loading';
import db from '@/db';
import { ERROR, WalletType } from '@/models/types';
import { Wallet } from '@/models/wallet';
import Dexie, { liveQuery, Subscription } from 'dexie';
import { STORAGE } from '@/chrome/config';
import {
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,

} from '@/shared/utils/resolver';
import networks from '@/utils/networks';
import { musicStore } from '@/stores/modules/music';
import { dexHunterStore } from '@/stores/modules/dexhunter';
import { bringStore } from '@/stores/modules/bring';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { governanceStore } from '@/stores/modules/governance';
import router from '@/modules/navigation/router';
import { subscribeSync } from '@/stores/loaders/syncLoader';
import { loadTransactions, subscribeTransactions } from '@/stores/loaders/transactionsLoader';
import { loadAssets } from '@/stores/loaders/assetsLoader';
import { loadConfig, subscribeConfig } from '@/stores/loaders/geroConfigLoader';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import * as CryptoTS from 'crypto-ts';
import { Buffer } from 'buffer';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { decrypt, encrypt } from '@/shared/utils/crypto';
import { Cardano } from '@cardano-sdk/core'

export let appWallet: Wallet = undefined;
export let subscriptions: Map<string, Subscription> = new Map<string, Subscription>()

export const useStore = defineStore('store', {
  persist: {
    paths: [
      'loggedWallet', 'wallets', 'locale', 'network', 'provider', 'price', 'stakingProView', 'assets', 'baseAddress', 'resolvedAssets', 'resolvedCollections', 'stakeAddress',
      'pinnedTokens', 'geroConfig', 'intervals'
    ]
  },
  state: () => ({
    loggedWallet: undefined,
    baseAddress: undefined,
    stakeAddress: undefined,
    wallets: [],
    locale: 'us',
    network: undefined,
    provider: undefined,
    price: undefined,
    transactions: undefined,
    pendingTxs: undefined,
    loadingTxs: false,
    isSyncing: false,
    assets: undefined,
    pools: [],
    rewards: [],
    connectedDapps: [],
    latestTip: undefined,
    stakingProView: false,
    resolvedAssets: undefined,
    resolvedCollections: undefined,
    fiatRates: undefined,
    currency: undefined,
    pinnedTokens: [],
    geroConfig: undefined,
    intervals: {
      fiatRatesIntervalId: null,
      tickerStatisticsIntervalId: null
    },
  }),
  getters: {
    isLoggedIn: state => !!state.loggedWallet,
    getWallets: state => state.wallets,
    getLocale: state => state.locale,
    getNetwork: state => state.network,
    getWallet: state => {
      if (!appWallet && state.loggedWallet) {
        appWallet = Wallet.class(state.loggedWallet, state.provider);
      }
      return appWallet;
    },
    getWelcomeDone(state) {
      if (state?.geroConfig) {
        return state.geroConfig.welcomeDone
      }
      return true
    },
    getPrice: state => state.price,
    getPools: state => state.pools,
  },
  actions: {
    async setWalletName(walletId: number, name: string) {
      // 1) Persist the change in Dexie
      await db.setWalletName(walletId, name);
      // 2) immediately reload Pinia state
      this.wallets = await db.getAllWallets();
      // 3) keep loggedWallet in sync
      if (this.loggedWallet?.id === walletId) {
        const wallet = this.wallets.find(w => w.id === walletId)!;
        if (!wallet) {
          return
        }
        await this.setLoggedWallet(wallet)
        appWallet.name = name;
      }
    },
    async setWalletIcon(walletId: number, icon: string) {
      // 1) Persist the change in Dexie
      await db.setWalletIcon(walletId, icon);
      // 2) immediately reload Pinia state
      this.wallets = await db.getAllWallets();
      // 3) keep loggedWallet in sync
      if (this.loggedWallet?.id === walletId) {
        const wallet = this.wallets.find(w => w.id === walletId)!;
        if (!wallet) {
          return
        }
        await this.setLoggedWallet(wallet)
        appWallet.icon = icon;
      }
    },
    async updateSpendingPassword(walletId: number, currentPassword: string, newPassword: string, _lockType: string) {
      if (appWallet.type === WalletType.Normal && appWallet.id === walletId) {
        try {
          const bytes = CryptoTS.AES.decrypt(appWallet.encryptedPrivateKey, currentPassword);
          const buffer: Buffer = appWallet.decryptWithPassword(currentPassword, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
          const rootKey = Bip32PrivateKey.fromBytes(buffer);
          const encryptedPrivateKey = Wallet.encryptPrivateKey(rootKey, newPassword);
          let encryptedMnemonic = null;
          if (appWallet.encryptedMnemonic) {
            const decryptedMnemonic = decrypt(appWallet.encryptedMnemonic, currentPassword)
            encryptedMnemonic = encrypt(decryptedMnemonic, newPassword)
          }
          await db.updatePrivateKeyAndMnemonic(walletId, encryptedPrivateKey, encryptedMnemonic);
          // 2) immediately reload Pinia state
          this.wallets = await db.getAllWallets();
          // 3) keep loggedWallet in sync
          if (this.loggedWallet?.id === walletId) {
            const wallet = this.wallets.find(w => w.id === walletId)!;
            if (!wallet) {
              return
            }
            await this.setLoggedWallet(wallet)
            appWallet.encryptedPrivateKey = encryptedPrivateKey;
            if (encryptedMnemonic) {
              appWallet.encryptedMnemonic = encryptedMnemonic;
            }
          }
        } catch (e) {
          throw ERROR.wrongPassword;
        }
      }
    },
    async setLogin(walletId: number) {
      const wallet = this.wallets.filter(wallet => networks.resolveNetwork(wallet?.chain, wallet?.network)).find(wal => wal.id === walletId);
      if (!wallet) {
        return null;
      }
      await this.setLoggedWallet(wallet);
    },
    closeAllOtherExtensionPopups() {
      // First, get the current window's ID.
      chrome.windows.getCurrent(function(currentWindow) {
        const currentId = currentWindow.id;
        // Get all open windows.
        chrome.windows.getAll({}, function(windows) {
          windows.forEach(function(win) {
            // Check if the window is a popup and is not the current one.
            if (win.id !== currentId && win.type === 'popup') {
              chrome.windows.remove(win.id, function() {
                if (chrome.runtime.lastError) {
                  console.error('Error closing window:', chrome.runtime.lastError);
                } else {
                  console.log('Closed popup window with id:', win.id);
                }
              });
            }
          });
        });
      });
    },
    setLoadingTxs(value) {
      this.loadingTxs = value
    },
    async setLoggedWallet(wallet) {
      this.loggedWallet = wallet;
      if (chrome?.storage) {
        if (wallet) {
          await chrome.storage.local.set({'loggedWallet': wallet});
        } else {
          await chrome.storage.local.remove('loggedWallet');
        }
      }
    },
    async getLoggedWallet() {
      if (this.loggedWallet) {
        return this.loggedWallet
      } else {
        const res = await chrome.storage.local.get([STORAGE.loggedWallet]);
        console.log(res)
        return res[STORAGE.loggedWallet];
      }
    },
    setResolvedAssets(val) {
      this.resolvedAssets = val
    },
    async resolveCollections(collectibles) {
      const unresolvedUnits = []
      const collections = {}
      collectibles.forEach(collectible => {
        if (!this.assets) {
          return
        }
        const asset = this.assets[collectible.unit]
        if (!asset) {
          unresolvedUnits.push(collectible.unit)
        }
        if (collections[collectible.policy_id]) {
          collections[collectible.policy_id]['items'].push(collectible)
          collections[collectible.policy_id]['quantity'] += Number(collectible.quantity)
          const description = findCollectionDescription(collectible)
          if (description) {
            collections[collectible.policy_id]['description'] = description
          }
        } else {
          collections[collectible.policy_id] = {}
          collections[collectible.policy_id]['items'] = [collectible]
          collections[collectible.policy_id]['name'] = findCollectionName(collectible)
          const description = findCollectionDescription(collectible)
          if (description) {
            collections[collectible.policy_id]['description'] = description
          }
          collections[collectible.policy_id]['img'] = collections[collectible.policy_id]['items'][0].img
          collections[collectible.policy_id]['quantity'] = Number(collectible.quantity)
          collections[collectible.policy_id]['isScam'] = collectible.isScam
        }
      })
      if (unresolvedUnits.length > 0) {
        // await appWallet.syncAssets(unresolvedUnits, true)
      }
      Object.values(collections).forEach(collection => {
        const items = collection['items']
        if (items[0]['policy_id'] === 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a') {
          collection['name'] = 'adaHandle'
        } else if (items[0]['policy_id'] === '85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18') {
          collection['name'] = 'MusicBox Dimensions'
        } else if (!collection['name']) {
          if (items.some(item => item['onchain_metadata'])) {
            collection['name'] = longestCommonStartingSubstring(items
              .filter(item => item['onchain_metadata'] && item['onchain_metadata'][Object.keys(item['onchain_metadata']).find(key => key.toLowerCase() === 'name')])
              .map(item => item['onchain_metadata'][Object.keys(item['onchain_metadata']).find(key => key.toLowerCase() === 'name')]))
          }
          if (!collection['name']) {
            collection['name'] = longestCommonStartingSubstring(items.map(item => item[Object.keys(item).find(key => key.toLowerCase() === 'name')]))
          }
          if (!collection['name']) {
            collection['name'] = items[0]['policy_id']
          }
        }
        if (Array.isArray(collection['name'])) {
          collection['name'] = collection['name'].join(' ');
        }
      })
      this.resolvedCollections = Object.values(collections)
      return this.resolvedCollections
    },
    async setUtxosAndAddresses(transactions) {
      const utxos: any[] = [];
      const addresses: Set<string> = new Set();
      if (!appWallet) {
        return
      }
      let stakeAddress: string = '';
      let address: string = '';
      if (appWallet.isEnterpriseAddress()) {
        address = appWallet.baseAddress().toBech32();
      } else {
        stakeAddress = appWallet.stakeAddress().toBech32()
      }

      const liveUtxos = new Map<string, [Cardano.TxIn, Cardano.TxOut]>();
      transactions.sort((a, b) =>
        a.block_height === b.block_height
          ? a.tx_timestamp - b.tx_timestamp
          : a.block_height - b.block_height
      );

      for (const transaction of transactions) {
        for (const inp of transaction.tx.body.inputs) {
          liveUtxos.delete(`${inp.txId}:${inp.index}`);
        }
        transaction.tx.body.outputs.forEach((out, idx) => {
          let outAddress = out.address
          const outAddressType = Cardano.Address.fromString(outAddress).getType()
          try {
            if (!appWallet.isEnterpriseAddress() && outAddressType === Cardano.AddressType.BasePaymentKeyStakeKey) {
              const baseAddress: Cardano.BaseAddress = Cardano.Address.fromBech32(outAddress).asBase()
              const rewardAddr = Cardano.RewardAddress.fromCredentials(
                appWallet.networkId(),
                baseAddress.getStakeCredential()
              );
              outAddress = rewardAddr.toAddress().toBech32();
            }
            if (address === outAddress || stakeAddress === outAddress) {
              addresses.add(out.address)
              liveUtxos.set(
                `${transaction.tx.id}:${idx}`,
                [
                  {
                    txId: transaction.tx.id,
                    index: idx
                  },
                  {
                    address: out.address,
                    value: out.value,
                    datumHash: out.datumHash,
                    datum: out.datum,
                    scriptReference: out.scriptReference
                  }
                ]
              );
            }
          } catch (e) {
            console.error(e)
          }
        });
      }

      if (Array.isArray(transactions) && transactions.length > 0) {

      }
      if (appWallet.type === WalletType.Google) {
        await walletConfigStore().setUtxos(utxos)
          .then(assets => this.resolveCollections(assets))
          .then((resolvedCollections) => {
            musicStore().resolveMusicPlaylist(resolvedCollections)
          });
      } else {
        // await appWallet.syncAddresses(Array.from(addresses))
        //   .then((resolvedAddresses: Set<string>) => {
        //     const filteredKnownUtxos = utxos.filter(utxo => resolvedAddresses.has(utxo.payment_addr.bech32))
        //     walletConfigStore().setUtxos(filteredKnownUtxos)
        //   })
        //   .then(() => this.loadResolvedAssets())
        //   .then(assets => this.resolveCollections(assets))
        //   .then((resolvedCollections) => {
        //     musicStore().resolveMusicPlaylist(resolvedCollections)
        //   });
      }
    },
    setBaseAddress(baseAddress) {
      this.baseAddress = baseAddress
    },
    setStakeAddress(stakeAddress) {
      this.stakeAddress = stakeAddress
    },
    unsubscribeAll() {
      Array.from(subscriptions.values()).forEach(sub => {
        sub.unsubscribe();
      })
      subscriptions = new Map<string, Subscription>();
    },
    async simpleLogin(walletId: number) {
      console.log('simpleLogin')
      const wallet = await this.getLoggedWallet()
      console.log(appWallet)
      console.log(await this.getLoggedWallet())
      try {
        this.provider = networks.resolveDefaultProvider(this.loggedWallet?.chain, this.loggedWallet?.network);
      } catch (err) {
        console.log(err)
      }
      appWallet = Wallet.class(wallet, this.provider);
      await appWallet.init()
      this.setBaseAddress(appWallet.baseAddress().toBech32())
      this.setStakeAddress(appWallet.stakeAddress().toBech32())
      governanceStore().setDRepId(appWallet.drepId())
      await this.loadAssets()
    },
    async login(walletId: number): Promise<void> {
      console.log('login')
      loading.setLoading(true);
      this.setLoadingTxs(true);
      this.unsubscribeAll();
      const wallet = this.wallets.filter(wallet => networks.resolveNetwork(wallet?.chain, wallet?.network)).find(wal => wal.id === walletId);
      if (!wallet) {
        await this.logout();
        this.setLoadingTxs(false);
        loading.setLoading(false);
        await router.push("/welcome");
        return;
      }
      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGIN,
        data: { wallet },
      });
      await this.setLoggedWallet(wallet);
      try {
        this.provider = networks.resolveDefaultProvider(this.loggedWallet?.chain, this.loggedWallet?.network);
      } catch (err) {
        console.log(err)
      }
      appWallet = Wallet.class(wallet, this.provider);
      await appWallet.init()
      await this.loadConfig()
      this.setBaseAddress(appWallet.baseAddress().toBech32())
      if (appWallet.type !== WalletType.Google) {
        this.setStakeAddress(appWallet.stakeAddress().toBech32())
        governanceStore().setDRepId(appWallet.drepId())
      }
      // await this.loadAssets()
      // await dexHunterStore().loadTokens(false)
      const promises = []
      await walletConfigStore().loadConfig()
      promises.push(walletConfigStore().loadAddresses())
      // promises.push(this.loadSync())
      promises.push(walletConfigStore().loadAccountInfo())
      // promises.push(this.loadPools())
      promises.push(governanceStore().loadDReps())
      // promises.push(this.loadTransactions())
      // promises.push(tapToolsStore().loadPortfolio())
      // promises.push(tapToolsStore().loadPortfolioTrendedValue())
      promises.push(this.loadRewards())
      promises.push(this.loadConnectedDapps())
      promises.push(walletConfigStore().loadContacts())
      // promises.push(bringStore().loadBringCache())
      await Promise.all(promises)
      this.setLoadingTxs(false)
      loading.setLoading(false);
      this.subscribeConfig()
      // this.subscribeTransactions();
      this.subscribeSync()
    },
    async logout() {
      console.log('logout')
      this.closeAllOtherExtensionPopups()
      loading.setLoading(true);
      this.unsubscribeAll()
      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGOUT,
        data: { },
      });
      await this.setLoggedWallet(undefined)
      if (chrome?.storage) {
        await chrome.storage.local.remove(STORAGE.whitelisted);
      }
      window.dispatchEvent(new CustomEvent('gero:logout', {
        bubbles: true,
        cancelable: true,
        composed: false,
      }))
      musicStore().setMusicPlaylist(undefined)
      dexHunterStore().setTokens(undefined)
      this.provider = undefined;
      this.transactions = undefined;
      this.assets = undefined;
      await walletConfigStore().setUtxos(undefined)
      this.setResolvedAssets(undefined)
      this.pools = []
      await walletConfigStore().setAccount(undefined);
      this.latestTip = undefined;
      this.resolvedCollections = undefined
      await walletConfigStore().setAddresses(undefined)
      walletConfigStore().setContacts(undefined)
      this.baseAddress = undefined
      this.stakeAddress = undefined
      appWallet = undefined
      loading.setLoading(false);
    },
    setLocale(locale) {
      this.locale = locale;
    },
    setNetwork(network) {
      this.network = network;
    },
    setPrice(price) {
      this.price = price
    },
    setFiatRates(fiatRates) {
      this.fiatRates = fiatRates
    },
    async setWelcomeDone(welcomeDone) {
      await db.setConfiguration('welcomeDone', welcomeDone)
    },
    setStakingProView(isPro) {
      this.stakingProView = isPro
    },
    setAssets(assets) {
      this.assets = assets
      if (chrome?.storage) {
        if (assets) {
          chrome.storage.local.set({[STORAGE.assets]: assets});
        } else {
          chrome.storage.local.remove(STORAGE.assets);
        }
      }
    },
    toggleFavoriteToken(val) {
      const index = this.pinnedTokens.indexOf(val.unit);
      if (index === -1) {
        this.pinnedTokens.push(val.unit)
      } else {
        this.pinnedTokens.splice(index, 1);
      }
    },
    async loadConfig() {
      await loadConfig(this)
    },
    async subscribeConfig() {
      await subscribeConfig(this, subscriptions)
    },
    async subscribeSync() {
      await subscribeSync(this, appWallet, subscriptions)
    },
    async loadTransactions() {
      return await loadTransactions(this, appWallet);
    },
    async subscribeTransactions() {
      return await subscribeTransactions(this, appWallet, subscriptions);
    },
    async loadAssets() {
      return await loadAssets(this, appWallet, subscriptions);
    },
    async loadPools() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getBlockchainDb()
      return new Promise((resolve, reject) => {
        subscriptions.set('pools', liveQuery(() => db.table('pools').toArray()).subscribe({
          next: newPools => {
            this.pools = newPools
            resolve(this.pools);
          },
          error: error => {
            console.error('Failed to Fetch Pools:', error)
            reject(error);
          }
        }));
      });
    },
    async loadRewards() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.set('rewards', liveQuery(() => db.table('rewards').orderBy("epoch").toArray()).subscribe({
          next: newRewards => {
            this.rewards = newRewards
            resolve(this.rewards)
          },
          error: error => {
            console.error('Failed to Fetch Rewards:', error)
            reject(error)
          }
        }));
      });
    },
    async loadConnectedDapps() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.set('dapps', liveQuery(() => db.table('connected_dapps').toArray()).subscribe({
          next: newConnectedDapps => {
            this.connectedDapps = newConnectedDapps
            if (chrome?.storage) {
              if (newConnectedDapps) {
                chrome.storage.local.set({[STORAGE.whitelisted]: newConnectedDapps});
              } else {
                chrome.storage.local.remove(STORAGE.whitelisted);
              }
            }
            resolve(this.connectedDapps)
          },
          error: error => {
            console.error('Failed to Fetch Connected Dapps:', error)
            reject(error)
          }
        }));
      });
    },
    async disconnectDapp(id: number) {
      if (!appWallet) {
        return
      }
      const db = await appWallet.getDb()
      db.table('connected_dapps').delete(id)
    }
  },
});

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
