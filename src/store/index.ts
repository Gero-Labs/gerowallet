import {defineStore} from 'pinia';
import loading from '@/plugins/loading';

// import { ChromeSyncStorage } from '@/store/chrome-storage'
// import { LocalPersistedStorage} from "@/store/local-storage";

import db from '@/db';
import {Wallet} from '@/models/wallet';
import Dexie, {liveQuery} from "dexie";
import socket from "@/plugins/socket";
import { STORAGE } from '@/chrome/config';
import {
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,
  resolveAsset,
} from '@/shared/utils/resolver';

// const env = process.env['VUE_APP_ENV']
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

let appWallet = undefined;

export const useStore = defineStore('store', {
  persist: {paths: ['loggedWallet', 'wallets', 'locale', 'network', 'provider', 'price', 'stakingProView', 'assets', 'baseAddress', 'utxos', 'addresses', 'resolvedAssets', 'resolvedCollections', 'stakeAddress']},
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
    loadingTxs: true,
    assets: [],
    pools: [],
    rewards: [],
    connectedDapps: [],
    accountInfo: undefined,
    latestTip: undefined,
    stakingProView: false,
    utxos: undefined,
    resolvedAssets: undefined,
    resolvedCollections: undefined,
    addresses: undefined,
    fiatRates: undefined,
    currency: undefined,
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
              if (input.stake_addr === currentStake) {
                sentAmount += +input.value;
                if (input.asset_list.length) {
                  input.asset_list.forEach(asset => {
                    const assetName = asset.policy_id + asset.asset_name;
                    if (sentAssets[assetName]) {
                      sentAssets[assetName].quantity += Number(sentAssets[assetName].quantity);
                    } else {
                      sentAssets[assetName] = structuredClone(asset);
                    }
                  });
                }
              }
            });

            tx.outputs.forEach(output => {
              if (output.stake_addr === currentStake) {
                receivedAmount += +output.value;
                if (output.asset_list.length > 0) {
                  output.asset_list.forEach(asset => {
                    const assetName = asset.policy_id + asset.asset_name;
                    if (receivedAssets[assetName]) {
                      receivedAssets[assetName].quantity += Number(receivedAssets[assetName].quantity);
                    } else {
                      receivedAssets[assetName] = structuredClone(asset);
                    }
                  });
                }
              }
            });

            const totalAmount = receivedAmount - sentAmount;
            const assets = {...sentAssets};
            Object.values(receivedAssets).forEach(receivedAsset => {
              const assetName = receivedAsset['policy_id'] + receivedAsset['asset_name'];

              if (assets[assetName]) {
                assets[assetName].quantity += Number(receivedAsset['quantity']);

                if (assets[assetName].quantity === 0) delete assets[assetName];
              } else {
                assets[assetName] = receivedAsset;
              }
            });
            currentBalance += totalAmount

            const statuses = []

            if (totalAmount > 0) {
              statuses.push('Received')
            } else {
              statuses.push('Sent')
            }
            if (tx.withdrawals?.length > 0) {
              statuses.push('Withdrawal')
            }
            const adaAsset = {
              policy_id: "",
              asset_name: "lovelace",
              decimals: 6,
              quantity: totalAmount,
              logo: require('@/assets/svg/cardano.svg')
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
              assets: [adaAsset, ...Object.values(assets)]
            }
          })
      }
      return []
    },
    getPools: state => state.pools,
    getAccountInfo: state => state.accountInfo
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
    async setAddresses(addresses: string[]) {
      this.addresses = addresses
      if (chrome?.storage) {
        if (addresses) {
          await chrome.storage.local.set({ [STORAGE.addresses]: addresses });
        } else {
          await chrome.storage.local.remove(STORAGE.addresses);
        }
      }
    },
    async setUtxos(utxos) {
      this.utxos = utxos
      if (chrome?.storage) {
        if (utxos) {
          await chrome.storage.local.set({ [STORAGE.utxos]: utxos });
        } else {
          await chrome.storage.local.remove(STORAGE.utxos);
        }
      }
    },
    async setResolvedAssets() {
      const assets = {};
      let adaBalance = 0;

      this.utxos.forEach(utxo => {
        adaBalance += Number(utxo.value);
        utxo.asset_list?.forEach(asset => {
          const key = asset.policy_id + asset.asset_name;
          if (assets[key]) {
            assets[key].quantity += Number(asset.quantity);
          } else {
            assets[key] = { ...asset, quantity: Number(asset.quantity) };
          }
        });
      });

      const assetArray = Object.values(assets);
      const resolvedAssets = await Promise.all(assetArray.map(asset => resolveAsset(this.assets, asset)));

      if (adaBalance > 0) {
        resolvedAssets.push({
          unit: '',
          name: "ADA",
          policy_id: '',
          img: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAXgAAAFbCAYAAADfpZU+AAAACXBIWXMAAAsTAAALEwEAmpwYAAAFGmlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPD94cGFja2V0IGJlZ2luPSLvu78iIGlkPSJXNU0wTXBDZWhpSHpyZVN6TlRjemtjOWQiPz4gPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iQWRvYmUgWE1QIENvcmUgNi4wLWMwMDIgNzkuMTY0NDYwLCAyMDIwLzA1LzEyLTE2OjA0OjE3ICAgICAgICAiPiA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPiA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6cGhvdG9zaG9wPSJodHRwOi8vbnMuYWRvYmUuY29tL3Bob3Rvc2hvcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RFdnQ9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZUV2ZW50IyIgeG1wOkNyZWF0b3JUb29sPSJBZG9iZSBQaG90b3Nob3AgMjEuMiAoTWFjaW50b3NoKSIgeG1wOkNyZWF0ZURhdGU9IjIwMjAtMDUtMjJUMTI6MTM6MDgrMDE6MDAiIHhtcDpNb2RpZnlEYXRlPSIyMDIwLTA2LTI5VDExOjI0OjExKzAxOjAwIiB4bXA6TWV0YWRhdGFEYXRlPSIyMDIwLTA2LTI5VDExOjI0OjExKzAxOjAwIiBkYzpmb3JtYXQ9ImltYWdlL3BuZyIgcGhvdG9zaG9wOkNvbG9yTW9kZT0iMyIgcGhvdG9zaG9wOklDQ1Byb2ZpbGU9InNSR0IgSUVDNjE5NjYtMi4xIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOmNkNjBjZWM1LTFlMmYt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",
          quantity: adaBalance,
          metadata: {
            name: "Cardano",
            ticker: "ADA",
            description: "Cardano Native Token",
            decimals: 6,
          },
          onchain_metadata: null,
        });
      }
      return resolvedAssets;
    },
    async setUtxosAndAddresses(transactions) {
      const utxos = [];
      const outputs = [];
      const inputSet = new Set();
      const addresses: Set<string> = new Set();
      const stakeAddress = appWallet.stakeAddress().to_address().to_bech32()

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
        const walletAddress = this.getWallet.stakeAddress().to_address().to_bech32();
        outputs.forEach(output => {
          if (!inputSet.has(`${output.tx_hash}-${output.tx_index}`) && walletAddress === output.stake_addr) {
            utxos.push(output);
          }
          if (output.stake_addr && output.stake_addr === stakeAddress) {
            addresses.add(output.payment_addr.bech32)
          }
        });
      }
      await this.setAddresses(Array.from(addresses))
        .then(() => this.setUtxos(utxos))
        .then(() => this.setResolvedAssets()
          .then(assets => {
            this.resolvedAssets = assets.filter(asset => asset?.metadata || asset?.name === "ADA")
            const collectibles = assets.filter(asset => !asset?.metadata && asset?.name !== "ADA");
            const collections = { }
            collectibles.forEach(collectible => {
              if (collections[collectible.policy_id]) {
                collections[collectible.policy_id]['items'].push(collectible)
                collections[collectible.policy_id]['quantity'] += Number(collectible.quantity)
              } else {
                collections[collectible.policy_id] = {}
                collections[collectible.policy_id]['items'] = [collectible]
                collections[collectible.policy_id]['name'] = findCollectionName(collectible)
                collections[collectible.policy_id]['description'] = findCollectionDescription(collectible)
                collections[collectible.policy_id]['img'] = collections[collectible.policy_id]['items'][0].img
                collections[collectible.policy_id]['quantity'] = Number(collectible.quantity)
              }
            })
            Object.values(collections).forEach(collection => {
              if (collection['name'] == null) {
                const items = collection['items']
                if (items.length > 1 && items[0]['onchain_metadata']) {
                  collection['name'] = longestCommonStartingSubstring(items
                    .filter(item => item['onchain_metadata'])
                    .map(item => item['onchain_metadata'].name))
                } else {
                  if (items[0]?.onchain_metadata?.name) {
                    collection['name'] = items[0]?.onchain_metadata?.name
                  } else {
                    collection['name'] = items[0]['policy_id']
                  }
                }
                if (!collection['name']) {
                  collection['name'] = items[0]['policy_id']
                }
              }
            })
            this.resolvedCollections = Object.values(collections)
        }))
    },
    setBaseAddress(baseAddress) {
      this.baseAddress = baseAddress
    },
    setStakeAddress(stakeAddress) {
      this.stakeAddress = stakeAddress
    },
    async login(walletId: number) {
      loading.setLoading(true);
      const wallet = this.wallets.find(wal => wal.id === walletId);
      if (!wallet) {
        return null;
      }
      await this.setLoggedWallet(wallet);
      try {
        this.provider = await db.getProvider(wallet.chain, wallet.network);
      } catch (err) {
        console.log(err)
      }
      appWallet = Wallet.class(wallet, this.provider);
      this.setBaseAddress(appWallet.baseAddress().to_address().to_bech32())
      this.setStakeAddress(appWallet.stakeAddress().to_address().to_bech32())
      socket.stompConnect(appWallet)
      const promises = []
      promises.push(this.loadSync())
      promises.push(this.loadAccountInfo())
      promises.push(this.loadTransactions())
      promises.push(this.loadAssets())
      promises.push(this.loadPools())
      promises.push(this.loadRewards())
      promises.push(this.loadConnectedDapps())
      await Promise.all(promises)
      try {
        await appWallet.fetchTip().then(tip => {
          appWallet.sync(tip)
        });
      } catch (err) {
        console.log(err)
      }
      loading.setLoading(false);
    },
    async logout() {
      loading.setLoading(true);
      socket.stompDisconnect();
      await this.setLoggedWallet(undefined)
      if (chrome?.storage) {
        await chrome.storage.local.remove(STORAGE.whitelisted);
      }
      this.provider = undefined;
      this.transactions = undefined;
      this.assets = [];
      this.utxos = undefined
      this.resolvedAssets = undefined
      this.pools = []
      this.accountInfo = undefined;
      this.latestTip = undefined;
      appWallet = undefined
      loading.setLoading(false);
    },
    async loadWallets(): Promise<void> {
      loading.setLoading(true);
      const wallets = await db.getAllWallets();
      if (Array.isArray(wallets) && wallets.length) {
        this.wallets = wallets;
      }
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
    async setFiatRates(fiatRates) {
      this.fiatRates = fiatRates
    },
    setStakingProView(isPro) {
      this.stakingProView = isPro
    },
    async loadSync() {
      if (!appWallet) {
        return
      }
      const db = await appWallet.getDb()
      liveQuery(() => db.table('sync').orderBy('height').last()).subscribe({
        next: newTip => {
          this.latestTip = newTip
        },
        error: error => {
          console.error('Failed to Fetch Tip:', error)
        }
      });
    },
    async loadAccountInfo() {
      if (!appWallet) {
        return
      }
      const db = await appWallet.getDb()
      liveQuery(() => db.table('account').where({walletId: this.loggedWallet.id}).first()).subscribe({
        next: newAccountInfo => {
          this.accountInfo = newAccountInfo
        },
        error: error => {
          console.error('Failed to Fetch AccountInfo:', error)
        }
      });
    },
    async loadTransactions() {
      if (!appWallet) {
        return
      }
      const db: Dexie = await appWallet.getDb()
      liveQuery(() => db.table('transactions').toArray()).subscribe({
        next: async newTransactions => {
          const newT = newTransactions.map(tx => tx.transaction)
          if (newT !== this.transactions) {
            this.transactions = newT
            await this.setUtxosAndAddresses(newT)
            console.log('setNew')
          }
        },
        error: error => {
          console.error('Failed to Fetch Transactions:', error)
        }
      });
    },
    async loadAssets() {
      if (!appWallet) {
        return
      }
      const db: Dexie = await appWallet.getBlockchainDb()
      liveQuery(() => db.table('assets').toArray()).subscribe({
        next: newAssets => {
          this.assets = newAssets
        },
        error: error => {
          console.error('Failed to Fetch Assets:', error)
        }
      });
    },
    async loadPools() {
      if (!appWallet) {
        return
      }
      const db: Dexie = await appWallet.getBlockchainDb()
      liveQuery(() => db.table('pools').toArray()).subscribe({
        next: newPools => {
          this.pools = newPools
        },
        error: error => {
          console.error('Failed to Fetch Pools:', error)
        }
      });
    },
    async loadRewards() {
      if (!appWallet) {
        return
      }
      const db = await appWallet.getDb()
      liveQuery(() => db.table('rewards').orderBy("epoch").toArray()).subscribe({
        next: newRewards => {
          this.rewards = newRewards
        },
        error: error => {
          console.error('Failed to Fetch Rewards:', error)
        }
      });
    },
    async loadConnectedDapps() {
      if (!appWallet) {
        return
      }
      const db = await appWallet.getDb()
      liveQuery(() => db.table('connected_dapps').toArray()).subscribe({
        next: newConnectedDapps => {
          this.connectedDapps = newConnectedDapps
          if (chrome?.storage) {
            if (newConnectedDapps) {
              chrome.storage.local.set({[STORAGE.whitelisted]: newConnectedDapps});
            } else {
              chrome.storage.local.remove(STORAGE.whitelisted);
            }
          }
        },
        error: error => {
          console.error('Failed to Fetch Connected Dapps:', error)
        }
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
