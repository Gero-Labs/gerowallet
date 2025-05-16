import { defineStore } from 'pinia';
import loading from '@/plugins/loading';
import db from '@/db';
import { WalletType } from '@/models/types';
import { Wallet } from '@/models/wallet';
import Dexie, { liveQuery, Subscription } from 'dexie';
import { STORAGE } from '@/chrome/config';
import {
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,
  resolveAsset,
} from '@/shared/utils/resolver';
import networks from '@/utils/networks';
import { musicStore } from '@/stores/modules/music';
import { dexHunterStore } from '@/stores/modules/dexhunter';
import { unitToFingerprint } from '@/shared/utils/converter';
import filters from '@/shared/utils/filters';
import { bringStore } from '@/stores/modules/bring';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { governanceStore } from '@/stores/modules/governance';
import { tapToolsStore } from '@/stores/modules/tapTools';
import router from '@/modules/navigation/router';
import { parseHttpError } from '@/shared/utils/parser';
import { loadWallets, subscribeWallets } from '@/stores/loaders/walletLoader';
import { loadSync, subscribeSync } from '@/stores/loaders/syncLoader';
import { loadTransactions, subscribeTransactions } from '@/stores/loaders/transactionsLoader';
import { loadAssets } from '@/stores/loaders/assetsLoader';
import { loadConfig, subscribeConfig } from '@/stores/loaders/geroConfigLoader';

export let appWallet: Wallet = undefined;
export let subscriptions: Map<string, Subscription> = new Map<string, Subscription>()

export const useStore = defineStore('store', {
  persist: {
    paths: [
      'loggedWallet', 'wallets', 'locale', 'network', 'provider', 'price', 'stakingProView', 'assets', 'baseAddress', 'resolvedAssets', 'resolvedCollections', 'stakeAddress', 'pinnedTokens',
      'geroConfig', 'connected', 'intervals'
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
    connected: false,
    intervals: {
      syncIntervalId: null,
      fiatRatesIntervalId: null,
      tickerStatisticsIntervalId: null
    },
  }),
  getters: {
    isLoggedIn: state => !!state.loggedWallet,
    getLoggedWallet: state => state.loggedWallet,
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
    calculatedTransactions(state) {
      if (state.transactions) {
        let currentStake: string = '';
        let currentAddress: string = '';
        if (appWallet.isEnterpriseAddress()) {
          currentAddress = appWallet.baseAddress().toBech32();
        } else {
          currentStake = appWallet.stakeAddress().toBech32()
        }
        let currentBalance: number = 0;
        return structuredClone(state.transactions)
          .sort((a, b) => a.tx_timestamp - b.tx_timestamp)
          .map((tx) => {
            let sentAmount: number = 0;
            let receivedAmount: number = 0;
            const sentAssets = {};
            const receivedAssets = {};
            tx.inputs.forEach(input => {
              if ((input.stake_addr === currentStake || input.payment_addr.bech32 === currentAddress) && !input.datum_hash) {
                sentAmount += +input.value;
                if (input.asset_list.length) {
                  input.asset_list.forEach(asset => {
                    const assetName = asset.policy_id + asset.asset_name;
                    if (sentAssets[assetName]) {
                      sentAssets[assetName].quantity += Number(asset.quantity);
                    } else {
                      sentAssets[assetName] = structuredClone(asset);
                      sentAssets[assetName].quantity = Number(sentAssets[assetName].quantity);
                    }
                  });
                }
              }
            });

            tx.outputs.forEach(output => {
              if ((output.stake_addr === currentStake || output.payment_addr.bech32 === currentAddress) && !output.datum_hash) {
                receivedAmount += +output.value;
                if (output.asset_list.length > 0) {
                  output.asset_list.forEach(asset => {
                    const assetName = asset.policy_id + asset.asset_name;
                    if (receivedAssets[assetName]) {
                      receivedAssets[assetName].quantity += Number(asset.quantity);
                    } else {
                      receivedAssets[assetName] = structuredClone(asset);
                      receivedAssets[assetName].quantity = Number(receivedAssets[assetName].quantity);
                    }
                  });
                }
              }
            });

            const totalAmount = receivedAmount - sentAmount;
            const assets = {...sentAssets};
            const refAssets = {...sentAssets};
            Object.values(receivedAssets).forEach(receivedAsset => {
              const assetName = receivedAsset['policy_id'] + receivedAsset['asset_name'];

              if (assets[assetName]) {
                assets[assetName].quantity -= Number(receivedAsset['quantity']);

                if (assets[assetName].quantity === 0) delete assets[assetName];
              } else {
                assets[assetName] = receivedAsset;
              }
            });
            const refAssetsCopy = {...refAssets}
            Object.values(refAssets).forEach(asset => {
              const assetName = asset['policy_id'] + asset['asset_name'];
              if (Number(refAssetsCopy[assetName].quantity) === 0) {
                delete refAssetsCopy[assetName]
              }
            })
            currentBalance += totalAmount

            const statuses = []
            if (tx.certificates?.length > 0) {
              tx.certificates.forEach(certificate => {
                if (certificate.type === 'stake_registration') {
                  statuses.push('Stake Registration')
                }
                if (certificate.type === 'pool_delegation') {
                  const poolId = certificate.info.pool_id_bech32
                  const pool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
                  if (pool) {
                    statuses.push('Delegating to '+pool.ticker)
                  }
                }
                if (certificate.type === 'stake_deregistration') {
                  statuses.push('Stake Deregistration')
                }
                if (certificate.type === 'drep_registration') {
                  statuses.push('DRep Registration')
                }
                if (certificate.type === 'vote_delegation') {
                  statuses.push('Vote Delegation')
                }
                if (certificate.type === 'drep_retire') {
                  statuses.push('DRep Deregistration')
                }
              })
            }
            if (totalAmount > 0) {
              if (tx.certificates.length === 0) {
                statuses.push('Received Funds')
              }
            } else {
              if (tx.certificates.length === 0) {
                statuses.push('Sent Funds')
              }
            }
            if (tx.withdrawals?.length > 0 && tx.withdrawals.some(withdrawal => withdrawal.stake_addr === this.stakeAddress)) {
              statuses.push('Withdrawal')
            }
            const network = networks.resolveNetwork(this.loggedWallet?.chain, this.loggedWallet?.network)
            const nativeAsset = {
              policy_id: "",
              asset_name: "lovelace",
              decimals: 6,
              quantity: totalAmount,
              logo: network?.currencyImage
            }
            return {
              ...tx,
              sentAmount,
              receivedAmount,
              sentAssets: Object.values(sentAssets),
              receivedAssets: Object.values(receivedAssets),
              time: tx.tx_timestamp,
              ada: totalAmount,
              status: statuses.join(', '),
              assets: [nativeAsset, ...Object.values(assets)]
            }
          })
      }
      return []
    },
    getPools: state => state.pools,
  },
  actions: {
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
    setConnected(connected: boolean) {
      this.connected = connected
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
    async loadResolvedAssets() {
      const assets = {};
      let adaBalance = 0;
      // Aggregate ADA balance and assets
      walletConfigStore().utxos.forEach(utxo => {
        adaBalance += Number(utxo.value);
        utxo.asset_list?.forEach(asset => {
          const key = asset.policy_id + asset.asset_name;
          assets[key] = assets[key] || { ...asset, quantity: 0 };
          assets[key].quantity += Number(asset.quantity);
        });
      });

      if (!this.assets) {
        return new Promise((resolve, reject) => reject())
      }
      // Resolve assets
      console.log('assets:', assets)
      const assetArray = Object.values(assets);
      const unresolvedAssets = assetArray.filter(asset => !((asset['policy_id']+asset['asset_name']) in this.assets)).map(asset => (asset['policy_id']+asset['asset_name']))
      await appWallet.syncAssets(unresolvedAssets, true)
      const resAssets = assetArray.filter(asset => (asset['policy_id']+asset['asset_name']) in this.assets)
      const resolvedAssets = await Promise.all(resAssets.map(asset => resolveAsset(this.assets[asset['policy_id']+asset['asset_name']], asset)));
      // Add ADA to resolved assets
      if (adaBalance > 0) {
        const network = networks.resolveNetwork(this.loggedWallet?.chain, this.loggedWallet?.network);
        resolvedAssets.push({
          unit: '',
          name: network?.currencyName,
          policy_id: '',
          img: network?.currencyImage,
          quantity: adaBalance,
          metadata: {
            name: network?.currencyName,
            ticker: network?.currencyTicker,
            description: network?.currencyDescription,
            decimals: 6,
          },
          verified: true,
          onchain_metadata: null,
        });
        console.log('ADA balance:', resolvedAssets)
      }

      // Filter and enrich assets with additional information
      const ticker = networks.resolveCurrencyTicker(appWallet.chain, appWallet.network);
      const resolvingAsset = resolvedAssets
        .filter(asset => asset?.metadata || asset?.name === ticker)
        .map(async (token) => {
          if (token.unit && dexHunterStore().dexHunterTokens && dexHunterStore().dexHunterTokens[token.unit] && unitToFingerprint(token.unit) != 'asset1yxmhmq2sqddn4vfl0um2dtlg4r7g2p9u9ed6rc') {
            token.verified = dexHunterStore().dexHunterTokens[token.unit].verified;
            token['isScam'] = dexHunterStore().blacklistPolicies.includes(token.policy_id)
            const promises = []
            promises.push(appWallet.api.mcap(token.unit).then(res => {
              if (res?.status === 200) {
                const stats = res.data;
                token['mcap'] = stats.mcap;
                token['last_price'] = stats.price;
                token['value'] = Number(filters.toCurrency(
                  token['last_price'] * Number(token.quantity),
                  false,
                  token.metadata?.decimals,
                  '',
                  '',
                  false,
                  token.metadata?.decimals
                ).replaceAll(",", ""));
              } else {
                console.log(parseHttpError(res))
              }
            }).catch(err => {
              console.error(`Error fetching mcap for ${token.unit}:`, err);
            }))
           promises.push(appWallet.api.dailyPriceChange(token.unit)
             .then(changeStats => {
               token['change'] = changeStats['24h'] * 100;
             }).catch(err => {
               console.error(`Error fetching daily price change for ${token.unit}:`, err);
             }));
            appWallet.api.assetRisk(unitToFingerprint(token.unit)).then(riskStats => {
              token['risk'] = riskStats.status === 'success' ? riskStats.data.risk_category : 'N/A';
            }).catch(err => {
              console.warn(`Error fetching risk for ${token.unit}: ${err.message}`);
              token['risk'] = 'N/A';
            })
            try {
              await Promise.all(promises)
            } catch (e) {
              console.error(e)
            }
          } else if (token && token['name'] === 'Cardano' && this.price) {
            token['value'] = Number(filters.toCurrency(
              Number(token.quantity) * Number(this.price.lastPrice),
              false,
              token.metadata?.decimals,
              '',
              '',
              false,
              token.metadata?.decimals
            ).replaceAll(",", ""));
            token['risk'] = 'AAA'
          }
          return token;
        });

      // Wait for all the asynchronous operations to complete
      this.setResolvedAssets(await Promise.all(resolvingAsset));
      // Return unresolved assets
      return resolvedAssets.filter(asset => !asset?.metadata && asset?.name !== ticker);
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
        await appWallet.syncAssets(unresolvedUnits, true)
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
      const outputs = [];
      const inputSet = new Set();
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

      if (transactions && transactions.length > 0) {
        // Collect all outputs and inputs
        transactions.forEach(tx => {
          if (tx.outputs) {
            outputs.push(...tx.outputs);
          }
          if (tx.inputs) {
            tx.inputs.forEach(input => {
              inputSet.add(`${input.tx_hash}-${input.tx_index}`);
              if (input.stake_addr === stakeAddress || input.payment_addr.bech32 === address) {
                addresses.add(input.payment_addr.bech32)
              }
            });
          }
        });

        // Check outputs against inputs set
        outputs.forEach(output => {
          if (!inputSet.has(`${output.tx_hash}-${output.tx_index}`) && (stakeAddress === output.stake_addr || address === output.payment_addr.bech32)) {
            utxos.push(output);
          }
          if (output.stake_addr === stakeAddress || address === output.payment_addr.bech32) {
            addresses.add(output.payment_addr.bech32)
          }
        });
      }
      if (Array.isArray(transactions) && transactions.length > 0) {
        await Promise.all([tapToolsStore().loadPortfolio(), tapToolsStore().loadPortfolioTrendedValue()]);
      }
      if (appWallet.type === WalletType.Google) {
        await walletConfigStore().setUtxos(utxos)
          .then(() => this.loadResolvedAssets())
          .then(assets => this.resolveCollections(assets))
          .then((resolvedCollections) => {
            musicStore().resolveMusicPlaylist(resolvedCollections)
          });
      } else {
        await appWallet.syncAddresses(Array.from(addresses))
          .then((resolvedAddresses: Set<string>) => {
            const filteredKnownUtxos = utxos.filter(utxo => resolvedAddresses.has(utxo.payment_addr.bech32))
            walletConfigStore().setUtxos(filteredKnownUtxos)
          })
          .then(() => this.loadResolvedAssets())
          .then(assets => this.resolveCollections(assets))
          .then((resolvedCollections) => {
            musicStore().resolveMusicPlaylist(resolvedCollections)
          });
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
      const wallet = this.wallets.filter(wallet => networks.resolveNetwork(wallet?.chain, wallet?.network)).find(wal => wal.id === walletId);
      if (!wallet) {
        return null;
      }
      await this.setLoggedWallet(wallet);
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
      const promises = []
      promises.push(this.loadSync())
      promises.push(this.subscribeSync())
      await appWallet.startSync();
    },
    async login(walletId: number): Promise<void> {
      console.log('login')
      loading.setLoading(true);
      this.setLoadingTxs(true)
      this.unsubscribeAll()
      const wallet = this.wallets.filter(wallet => networks.resolveNetwork(wallet?.chain, wallet?.network)).find(wal => wal.id === walletId);
      if (!wallet) {
        await this.logout();
        this.setLoadingTxs(false);
        loading.setLoading(false);
        await router.push("/welcome");
        return;
      }
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
      await appWallet.startSync();
      await this.loadAssets()
      await dexHunterStore().loadBlacklistPolicies()
      await dexHunterStore().loadTokens()
      const promises = []
      await walletConfigStore().loadConfig()
      promises.push(walletConfigStore().loadAddresses())
      promises.push(this.loadSync())
      promises.push(walletConfigStore().loadAccountInfo())
      promises.push(this.loadPools())
      promises.push(governanceStore().loadDReps())
      promises.push(this.loadTransactions())
      promises.push(this.loadRewards())
      promises.push(this.loadConnectedDapps())
      promises.push(walletConfigStore().loadContacts())
      promises.push(bringStore().loadBringCache())
      await Promise.all(promises)
      this.setLoadingTxs(false)
      loading.setLoading(false);
      this.subscribeConfig()
      this.subscribeTransactions();
      this.subscribeSync()
    },
    clearSyncIntervals() {
      appWallet.endSync();
      this.intervals = {
        syncIntervalId: null,
        fiatRatesIntervalId: null,
        tickerStatisticsIntervalId: null,
      }
    },
    async logout() {
      console.log('logout')
      this.closeAllOtherExtensionPopups()
      loading.setLoading(true);
      this.clearSyncIntervals();
      this.unsubscribeAll()
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
      dexHunterStore().setBlacklistPolicies([])
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
      tapToolsStore().setPortfolio(undefined)
      tapToolsStore().setPortfolioTrendedValue(undefined)
      this.baseAddress = undefined
      this.stakeAddress = undefined
      appWallet = undefined
      loading.setLoading(false);
    },
    async sync() {
      if (!appWallet) {
        await appWallet.sync()
      }
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
    async loadWallets() {
      await loadWallets(this);
    },
    async subscribeWallets() {
      await subscribeWallets(this, subscriptions)
    },
    async loadSync() {
      return await loadSync(this, appWallet);
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
