import { defineStore } from 'pinia';
import loading from '@/plugins/loading';
import db from '@/db';
import { ERROR, WalletType } from '@/models/types';
import { Wallet } from '@/models/wallet';
import { liveQuery, Subscription } from 'dexie';
import { STORAGE } from '@/chrome/config';
import networks from '@/utils/networks';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { governanceStore } from '@/stores/modules/governance';
import router from '@/modules/navigation/router';
import { loadAssets } from '@/stores/loaders/assetsLoader';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import * as CryptoTS from 'crypto-ts';
import { Buffer } from 'buffer';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import { decrypt, encrypt } from '@/shared/utils/crypto';
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
      // loading.setLoading(true);
      // this.setLoadingTxs(true);
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
      // promises.push(walletConfigStore().loadAddresses())
      // promises.push(this.loadSync())
      // promises.push(walletConfigStore().loadAccountInfo())
      // promises.push(this.loadPools())
      // promises.push(governanceStore().loadDReps())
      // promises.push(this.loadTransactions())
      // promises.push(tapToolsStore().loadPortfolio())
      // promises.push(tapToolsStore().loadPortfolioTrendedValue())
      promises.push(this.loadRewards())

      promises.push(walletConfigStore().loadContacts())
      // promises.push(bringStore().loadBringCache())
      await Promise.all(promises)
      // this.setLoadingTxs(false)
      // loading.setLoading(false);
      // this.subscribeTransactions();
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
    async loadAssets() {
      return await loadAssets(this, appWallet, subscriptions);
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
  },
});
