import { defineStore } from 'pinia';
import loading from '@/plugins/loading';

import db from '@/db';
import { Wallet } from '@/models/wallet';
import Dexie, { liveQuery, Subscription } from 'dexie';
import socket from '@/plugins/socket';
import { STORAGE } from '@/chrome/config';
import {
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,
  resolveAsset,
} from '@/shared/utils/resolver';
import networks from '@/shared/utils/networks';
import { Blockchain } from '@/models/types';
import { musicStore } from '@/store/modules/music';
import { dexHunterStore } from '@/store/modules/dexhunter';
import { unitToFingerprint } from '@/shared/utils/converter';
import filters from '@/shared/utils/filters';
import { bringStore } from '@/store/modules/bring';
import { walletConfigStore } from '@/store/modules/walletConfig';
import { governanceStore } from '@/store/modules/governance';
import { tapToolsStore } from '@/store/modules/tapTools';

export let appWallet: Wallet = undefined;
export let subscriptions: Subscription[] = []

export const useStore = defineStore('store', {
  persist: {
    paths: [
      'loggedWallet', 'wallets', 'locale', 'network', 'provider', 'price', 'stakingProView', 'assets', 'baseAddress', 'resolvedAssets', 'resolvedCollections', 'stakeAddress', 'pinnedTokens'
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
    getPrice: state => state.price,
    calculatedTransactions(state) {
      if (state.transactions) {
        const currentStake = appWallet.stakeAddress().to_address().to_bech32();
        let currentBalance: number = 0;
        return structuredClone(state.transactions)
          .sort((a, b) => a.tx_timestamp - b.tx_timestamp)
          .map((tx) => {
            let sentAmount: number = 0;
            let receivedAmount: number = 0;
            const sentAssets = {};
            const receivedAssets = {};
            tx.inputs.forEach(input => {
              if (input.stake_addr === currentStake && !input.datum_hash) {
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
              if (output.stake_addr === currentStake && !output.datum_hash) {
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
      }

      // Filter and enrich assets with additional information
      const ticker = networks.resolveCurrencyTicker(appWallet.chain, appWallet.network);
      const resolvingAsset = resolvedAssets
        .filter(asset => asset?.metadata || asset?.name === ticker)
        .map(async (token) => {
          if (token.unit && dexHunterStore().dexHunterTokens[token.unit]) {
            token.verified = dexHunterStore().dexHunterTokens[token.unit].verified;
            token['isScam'] = dexHunterStore().blacklistPolicies.includes(token.policy_id)
            const promises = []
            promises.push(appWallet.api.mcap(token.unit).then(stats => {
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
            }).catch(err => {
              console.error(`Error fetching mcap for ${token.unit}:`, err);
            }))
           promises.push(appWallet.api.dailyPriceChange(networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network), token.unit)
             .then(changeStats => {
               token['change'] = changeStats.change;
             }).catch(err => {
               console.error(`Error fetching daily price change for ${token.unit}:`, err);
             }));
            promises.push(appWallet.api.assetRisk(unitToFingerprint(token.unit)).then(riskStats => {
              token['risk'] = riskStats.status === 'success' ? riskStats.data.risk_category : 'N/A';
            }).catch(err => {
              console.error(`Error fetching risk for ${token.unit}:`, err);
              token['risk'] = 'N/A';
            }))
            try {
              await Promise.all(promises)
            } catch (e) {
              console.error(e)
            }
          } else if (token['name'] === 'Cardano' && this.price) {
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
            console.log('')
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
      const stakeAddress: string = appWallet.stakeAddress().to_address().to_bech32()

      if (transactions && transactions.length > 0) {
        // Collect all outputs and inputs
        transactions.forEach(tx => {
          if (tx.outputs) {
            outputs.push(...tx.outputs);
          }
          if (tx.inputs) {
            tx.inputs.forEach(input => {
              inputSet.add(`${input.tx_hash}-${input.tx_index}`);
              if (input.stake_addr && input.stake_addr === stakeAddress) {
                addresses.add(input.payment_addr.bech32)
              }
            });
          }
        });

        // Check outputs against inputs set
        outputs.forEach(output => {
          if (!inputSet.has(`${output.tx_hash}-${output.tx_index}`) && stakeAddress === output.stake_addr) {
            utxos.push(output);
          }
          if (output.stake_addr && output.stake_addr === stakeAddress) {
            addresses.add(output.payment_addr.bech32)
          }
        });
      }
      if (Array.isArray(transactions) && transactions.length > 0) {
        await Promise.all([tapToolsStore().loadPortfolio(), tapToolsStore().loadPortfolioTrendedValue()]);
      }
      await appWallet.syncAddresses(Array.from(addresses))
        .then(() => walletConfigStore().setUtxos(utxos))
        .then(() => this.loadResolvedAssets())
        .then(assets => this.resolveCollections(assets))
        .then((resolvedCollections) => {
          musicStore().resolveMusicPlaylist(resolvedCollections)
        });

    },
    setBaseAddress(baseAddress) {
      this.baseAddress = baseAddress
    },
    setStakeAddress(stakeAddress) {
      this.stakeAddress = stakeAddress
    },
    async simpleLogin(walletId: number) {
      const wallet = this.wallets.find(wal => wal.id === walletId);
      if (!wallet) {
        return null;
      }
      await this.setLoggedWallet(wallet);
      try {
        this.provider = networks.resolveDefaultProvider(this.loggedWallet.chain, this.loggedWallet. network);
      } catch (err) {
        console.log(err)
      }
      appWallet = Wallet.class(wallet, this.provider);
      this.setBaseAddress(appWallet.baseAddress().to_address().to_bech32())
      this.setStakeAddress(appWallet.stakeAddress().to_address().to_bech32())
      governanceStore().setDRepId(appWallet.drepId().to_bech32())
      await this.loadAssets()
      socket.stompConnect(appWallet)
      const promises = []
      promises.push(this.loadSync())
      try {
        const tip = await appWallet.fetchTip()
        await appWallet.sync(tip)
      } catch (err) {
        console.log(err)
      }
    },
    async login(walletId: number) {
      loading.setLoading(true);
      this.setLoadingTxs(true)
      console.log('login')
      subscriptions.forEach(sub => {
        sub.unsubscribe();
      })
      subscriptions = []
      const wallet = this.wallets.find(wal => wal.id === walletId);
      if (!wallet) {
        return null;
      }
      await this.setLoggedWallet(wallet);
      try {
        this.provider = networks.resolveDefaultProvider(this.loggedWallet.chain, this.loggedWallet. network);
      } catch (err) {
        console.log(err)
      }
      appWallet = Wallet.class(wallet, this.provider);
      this.setBaseAddress(appWallet.baseAddress().to_address().to_bech32())
      this.setStakeAddress(appWallet.stakeAddress().to_address().to_bech32())
      governanceStore().setDRepId(appWallet.drepId().to_bech32())
      try {
        socket.stompConnect(appWallet)
      } catch (e) {
        console.error(e)
      }
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
      try {
        const tip = await appWallet.fetchTip()
        await appWallet.sync(tip)
      } catch (err) {
        console.log(err)
      }
      this.setLoadingTxs(false)
      loading.setLoading(false);
    },
    async logout() {
      loading.setLoading(true);
      subscriptions.forEach(sub => {
        sub.unsubscribe();
      })
      subscriptions = []
      socket.stompDisconnect();
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
    setLocale(locale) {
      this.locale = locale;
    },
    setNetwork(network) {
      this.network = network;
    },
    setPrice(price) {
      if (this.loggedWallet && (this.loggedWallet.chain === Blockchain.APEX_VECTOR || this.loggedWallet.chain === Blockchain.APEX_PRIME)) {
        this.price = 1
      } else {
        this.price = price
      }
    },
    async setFiatRates(fiatRates) {
      this.fiatRates = fiatRates
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
    async loadWallets(): Promise<void> {
      subscriptions.push(liveQuery(() => db.getAllWallets()).subscribe({
        next: wallets => {
          this.wallets = wallets
        },
        error: error => {
          console.error('Failed to get all Wallets:', error)
        }
      }));
    },
    async loadSync() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => db.table('sync').orderBy('height').last()).subscribe({
          next: newTip => {
            this.latestTip = newTip
            console.log('latestTip', this.latestTip)
            resolve(this.latestTip)
          },
          error: error => {
            console.error('Failed to Fetch Tip:', error)
            reject(error)
          }
        }));
      });
    },
    async loadTransactions() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => db.table('transactions').toArray()).subscribe({
          next: async newTransactions => {
            const newT = newTransactions.map(tx => tx.transaction)
            if (newT !== this.transactions) {
              this.transactions = newT
              await this.setUtxosAndAddresses(newT)
              console.log('setNew')
              resolve(this.transactions)
            }
          },
          error: error => {
            console.error('Failed to Fetch Transactions:', error)
            reject(error)
          }
        }));
      });
    },
    async loadAssets() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getBlockchainDb();
      // Return a promise that resolves when the data is fully loaded
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => db.table('assets').toArray()).subscribe({
          next: newAssets => {
            this.setAssets(newAssets.reduce((map, asset) => {
              map[asset.asset] = asset;
              return map;
            }, {}))
            resolve(this.assets); // Resolve the promise when data is loaded
          },
          error: error => {
            console.error('Failed to Fetch Assets:', error);
            reject(error); // Reject the promise if an error occurs
          }
        }));
      });
    },
    async loadPools() {
      if (!appWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await appWallet.getBlockchainDb()
      return new Promise((resolve, reject) => {
        subscriptions.push(liveQuery(() => db.table('pools').toArray()).subscribe({
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
        subscriptions.push(liveQuery(() => db.table('rewards').orderBy("epoch").toArray()).subscribe({
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
        subscriptions.push(liveQuery(() => db.table('connected_dapps').toArray()).subscribe({
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
