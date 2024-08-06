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
import networks from '@/shared/utils/networks';

// const env = process.env['VUE_APP_ENV']
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

export let appWallet: Wallet = undefined;

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

            if (tx.certificates?.length > 0) {
              tx.certificates.forEach(certificate => {
                if (certificate.type === 'stake_registration') {
                  statuses.push('Stake Registration')
                } else if (certificate.type === 'delegation') {
                  const poolId = certificate.info.pool_id_bech32
                  const pool = this.pools.find(pool => pool.pool_id_bech32 === poolId)
                  if (pool) {
                    statuses.push('Delegating to '+pool.ticker)
                  }
                } else if (certificate.type === 'stake_deregistration') {
                  statuses.push('Stake Deregistration')
                }
              })
              console.log(this.pools)
            }
            if (totalAmount > 0) {
              statuses.push('Received')
            } else {
              if (tx.certificates.length === 0) {
                statuses.push('Sent')
              }
            }
            if (tx.withdrawals?.length > 0) {
              statuses.push('Withdrawal')
            }
            const network = networks.resolveNetwork(this.loggedWallet.chain, this.loggedWallet.network)
            const nativeAsset = {
              policy_id: "",
              asset_name: "lovelace",
              decimals: 6,
              quantity: totalAmount,
              logo: network.currencyImage
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
        const network = networks.resolveNetwork(this.loggedWallet.chain, this.loggedWallet.network)
        resolvedAssets.push(
          {
            unit: '',
            name: network.currencyName,
            policy_id: '',
            img: network.currencyImage,
            quantity: adaBalance,
            metadata: {
              name: network.currencyName,
              ticker: network.currencyTicker,
              description: network.currencyDescription,
              decimals: 6,
            },
            onchain_metadata: null,
          }
        );
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
        outputs.forEach(output => {
          if (!inputSet.has(`${output.tx_hash}-${output.tx_index}`) && stakeAddress === output.stake_addr) {
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
          .then(async assets => {
            this.resolvedAssets = assets.filter(asset => asset?.metadata || asset?.name === "ADA")
            const collectibles = assets.filter(asset => !asset?.metadata && asset?.name !== "ADA");
            const unresolvedUnits = []
            const collections = {}
            collectibles.forEach(collectible => {
              if (!this.assets) {
                return
              }
              const asset = this.assets.find(asset => asset.asset === collectible.unit)
              if (!asset) {
                unresolvedUnits.push(collectible.unit)
              }
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
            if (unresolvedUnits.length > 0) {
              await appWallet.syncAssets(unresolvedUnits, true)
            }
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
      window.dispatchEvent(new CustomEvent('gero:login', {
        bubbles: true,
        cancelable: true,
        composed: false,
      }))
      const promises = []
      promises.push(this.loadSync())
      promises.push(this.loadAccountInfo())
      promises.push(this.loadPools())
      promises.push(this.loadTransactions())
      promises.push(this.loadAssets())
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
      window.dispatchEvent(new CustomEvent('gero:logout', {
        bubbles: true,
        cancelable: true,
        composed: false,
      }))
      this.provider = undefined;
      this.transactions = undefined;
      this.assets = undefined;
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
