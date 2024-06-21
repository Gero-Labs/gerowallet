import {defineStore} from 'pinia';
import loading from '@/plugins/loading';

// import { ChromeSyncStorage } from '@/store/chrome-storage'
// import { LocalPersistedStorage} from "@/store/local-storage";

import db from '@/db';
import {Wallet} from '@/models/wallet';
import Dexie, {liveQuery} from "dexie";
import socket from "@/plugins/socket";
import { STORAGE } from '@/chrome/config';

// const env = process.env['VUE_APP_ENV']
// const plugin = env === 'production' ? LocalPersistedStorage:
// Vue.use(Vuex)

let appWallet = undefined;

export const useStore = defineStore('store', {
  persist: {paths: ['loggedWallet', 'wallets', 'locale', 'network', 'provider', 'price', 'stakingProView', 'assets', 'baseAddress', 'utxos', 'addresses']},
  state: () => ({
    loggedWallet: undefined,
    baseAddress: undefined,
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
        const currentStake = this.getWallet.stakeAddress().to_address().to_bech32();
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
    calculatedUtxos(state) {
      const utxos = [];
      const outputs = [];
      const inputSet = new Set();

      if (state.transactions && state.transactions.length > 0) {
        // Collect all outputs and inputs
        state.transactions.forEach(tx => {
          if (tx.outputs) {
            outputs.push(...tx.outputs);
          }
          if (tx.inputs) {
            tx.inputs.forEach(input => {
              inputSet.add(`${input.tx_hash}-${input.tx_index}`);
            });
          }
        });

        // Check outputs against inputs set
        const walletAddress = this.getWallet.stakeAddress().to_address().to_bech32();
        outputs.forEach(output => {
          if (!inputSet.has(`${output.tx_hash}-${output.tx_index}`) && walletAddress === output.stake_addr) {
            utxos.push(output);
          }
        });
      }
      // Resolve Assets
      // if (utxos) {
      //   utxos.forEach(utxo => {
      //     if (utxo.asset_list) {
      //       utxo.asset_list.forEach(asset => {
      //         const resolved = state.assets.find(ast => ast['policy_id'] === asset['policy_id'] && ast['asset_name'] === asset['asset_name'])
      //         if (!resolved) {
      //           this.getWallet.getAssetInfo(asset['policy_id'], asset['asset_name'])
      //         } else {
      //           asset['total_amount'] = resolved?.quantity
      //           asset['name'] = Buffer.from(resolved.asset_name, 'hex').toString('ascii')
      //           if (resolved?.metadata?.logo) {
      //             asset['logo'] = 'data:image/png;base64,' + resolved.metadata.logo;
      //           } else if (resolved?.onchain_metadata?.image) {
      //             asset['logo'] = process.env['VUE_APP_BACKEND_URL'] + '/api/ipfs/' + resolved.onchain_metadata.image
      //           } else {
      //             asset['logo'] = ''; // Set empty logo if not found
      //           }
      //         }
      //       })
      //     }
      //   })
      // }
      return utxos;
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
      // Resolve Assets
      // if (utxos) {
      //   utxos.forEach(utxo => {
      //     if (utxo.asset_list) {
      //       utxo.asset_list.forEach(asset => {
      //         const resolved = this.assets.find(ast => ast['policy_id'] === asset['policy_id'] && ast['asset_name'] === asset['asset_name'])
      //         if (!resolved) {
      //           this.getWallet.getAssetInfo(asset['policy_id'], asset['asset_name'])
      //         } else {
      //           asset['total_amount'] = resolved?.quantity
      //           asset['name'] = Buffer.from(resolved.asset_name, 'hex').toString('ascii')
      //           if (resolved?.metadata?.logo) {
      //             asset['logo'] = 'data:image/png;base64,' + resolved.metadata.logo;
      //           } else if (resolved?.onchain_metadata?.image) {
      //             asset['logo'] = process.env['VUE_APP_BACKEND_URL'] + '/api/ipfs/' + resolved.onchain_metadata.image
      //           } else {
      //             asset['logo'] = ''; // Set empty logo if not found
      //           }
      //         }
      //       })
      //     }
      //   })
      // }
      await this.setAddresses(Array.from(addresses))
        .then(() => this.setUtxos(utxos))
    },
    setBaseAddress(baseAddress) {
      this.baseAddress = baseAddress
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
      this.assets = []
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
        next: newTransactions => {
          const newT = newTransactions.map(tx => tx.transaction)
          if (newT !== this.transactions) {
            this.transactions = newT
            this.setUtxosAndAddresses(newT)
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
