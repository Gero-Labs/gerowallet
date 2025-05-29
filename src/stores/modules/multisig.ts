import { defineStore } from 'pinia';

import { Wallet } from '@/models/wallet';
import Dexie, { liveQuery } from 'dexie';
import { STORAGE } from '@/chrome/config';
import {
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,
  resolveAsset,
} from '@/shared/utils/resolver';
import networks from '@/utils/networks';
import { dexHunterStore } from '@/stores/modules/dexhunter';
import { unitToFingerprint } from '@/shared/utils/converter';
import filters from '@/shared/utils/filters';
import { walletConfigStore } from '@/stores/modules/walletConfig';
import { parseHttpError } from '@/shared/utils/parser';
import { loadWallets, subscribeWallets } from '@/stores/loaders/walletLoader';
import { loadTransactions, subscribeTransactions } from '@/stores/loaders/transactionsLoader';
import { loadAssets } from '@/stores/loaders/assetsLoader';
import { subscriptions } from '@/stores';
import { tapToolsStore } from './tapTools';
import { musicStore } from './music';
import { chunkArray } from 'array-chunk-by-size';
import _ from 'lodash';
import loading from '@/plugins/loading';

export let multisigAppWallet: Wallet = undefined;


export const multisigStore = defineStore('multisigStore', {
  persist: {
    paths: [
      'multiSigWallets',
      'multiSigWallet',
      'assets',
      'baseAddress',
      'resolvedAssets',
      'resolvedCollections',
      'stakeAddress',
      'pinnedTokens',
      'price',
    ]
  },
  state: (): MultisigWalletState => ({
    multiSigWallets: [],
    multiSigWallet: {},
    baseAddress: undefined,
    stakeAddress: '',
    transactions: [],
    pendingTxs: undefined,
    provider: undefined,
    loadingTxs: false,
    isSyncing: false,
    assets: [],
    pools: [],
    rewards: [],
    connectedDapps: [],
    resolvedAssets: [],
    resolvedCollections: [],
    pinnedTokens: [],
    price: undefined,
  }),
  getters: {
    getMultiSigWallet: state => state.multiSigWallet,
    getMultiSigWallets: state => state.multiSigWallets,
    getWallet: state => {
      if (!multisigAppWallet && state.multiSigWallet.id) {
        multisigAppWallet = Wallet.multisigClass(state.multiSigWallet, 1);
      }
      return multisigAppWallet;
    },
    calculatedTransactions(state) {
      if (state.transactions) {
        const currentStake = (state.multiSigWallet as MultisigWalletInterface).stakeAddress;
        let currentBalance = 0;
        const clonedTransactions = structuredClone(state.transactions)
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
            currentBalance += totalAmount;
            const assets = { ...sentAssets };
            const refAssets = { ...sentAssets };
            Object.values(receivedAssets).forEach(receivedAsset => {
              const assetName = receivedAsset['policy_id'] + receivedAsset['asset_name'];

              if (assets[assetName]) {
                assets[assetName].quantity -= Number(receivedAsset['quantity']);

                if (assets[assetName].quantity === 0) delete assets[assetName];
              } else {
                assets[assetName] = receivedAsset;
              }
            });
            const refAssetsCopy = { ...refAssets }
            Object.values(refAssets).forEach(asset => {
              const assetName = asset['policy_id'] + asset['asset_name'];
              if (Number(refAssetsCopy[assetName].quantity) === 0) {
                delete refAssetsCopy[assetName]
              }
            })

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
                    statuses.push('Delegating to ' + pool.ticker)
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
              statuses.push('Withdrawal');
            }
            const network = networks.resolveNetwork((this.multiSigWallet as MultisigWalletInterface).chain, (this.multiSigWallet as MultisigWalletInterface).network);
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
        return {
          transactions: clonedTransactions,
          currentBalance,
          total: 0,
          paid: 0,
          pending: 0,
          expired: 0,
        };
      }
      return {
        transactions: [],
        currentBalance: 0,
        total: 0,
        paid: 0,
        pending: 0,
        expired: 0,
      }
    },
    getPools: state => state.pools,
  },
  actions: {
    async initAll() {
      multisigAppWallet = Wallet.multisigClass(this.getMultiSigWallet, 1);
      this.setBaseAddress(this.getMultiSigWallet.paymentAddress)
      this.setStakeAddress(this.getMultiSigWallet.stakeAddress)
      //governanceStore().setDRepId(appWallet.drepId())
      await multisigAppWallet.startSync();
      await this.loadAssets()
      await dexHunterStore().loadBlacklistPolicies()
      await dexHunterStore().loadTokens()
      const promises = []
      await walletConfigStore().loadConfig(multisigAppWallet)
      promises.push(walletConfigStore().loadAddresses())
      //promises.push(this.loadSync())
      promises.push(walletConfigStore().loadAccountInfo())
      promises.push(this.loadPools())
      //promises.push(governanceStore().loadDReps())
      promises.push(this.loadTransactions())
      promises.push(this.loadRewards())
      promises.push(this.loadConnectedDapps())
      promises.push(walletConfigStore().loadContacts())
      //promises.push(bringStore().loadBringCache())
      await Promise.all(promises)
      this.setLoadingTxs(false)
      loading.setLoading(false);
      this.subscribeTransactions();
    },
    setLoadingTxs(value) {
      this.loadingTxs = value
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
      const unresolvedAssets = assetArray.filter(asset => !((asset['policy_id'] + asset['asset_name']) in this.assets)).map(asset => (asset['policy_id'] + asset['asset_name']))
      await multisigAppWallet.syncAssets(unresolvedAssets, true)
      const resAssets = assetArray.filter(asset => (asset['policy_id'] + asset['asset_name']) in this.assets)
      const resolvedAssets = await Promise.all(resAssets.map(asset => resolveAsset(this.assets[asset['policy_id'] + asset['asset_name']], asset)));

      // Add ADA to resolved assets
      if (adaBalance > 0) {
        const network = networks.resolveNetwork(
          (this.multiSigWallet as MultisigWalletInterface)?.chain,
          (this.multiSigWallet as MultisigWalletInterface)?.network
        );
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
      const ticker = networks.resolveCurrencyTicker(multisigAppWallet.chain, multisigAppWallet.network);
      const resolvingAsset = resolvedAssets
        .filter(asset => asset?.metadata || asset?.name === ticker)
        .map(async (token) => {
          if (token.unit && dexHunterStore().dexHunterTokens && dexHunterStore().dexHunterTokens[token.unit] && unitToFingerprint(token.unit) != 'asset1yxmhmq2sqddn4vfl0um2dtlg4r7g2p9u9ed6rc') {
            token.verified = dexHunterStore().dexHunterTokens[token.unit].verified;
            token['isScam'] = dexHunterStore().blacklistPolicies.includes(token.policy_id)
            const promises = []
            promises.push(multisigAppWallet.api.mcap(token.unit).then(res => {
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
            promises.push(multisigAppWallet.api.dailyPriceChange(token.unit)
              .then(changeStats => {
                token['change'] = changeStats['24h'] * 100;
              }).catch(err => {
                console.error(`Error fetching daily price change for ${token.unit}:`, err);
              }));
            promises.push(multisigAppWallet.api.assetRisk(unitToFingerprint(token.unit)).then(riskStats => {
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
        await multisigAppWallet.syncAssets(unresolvedUnits, true)
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
      if (!multisigAppWallet) {
        return
      }
      const stakeAddress: string = (this.multiSigWallet as MultisigWalletInterface).stakeAddress;

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
      await multisigAppWallet.syncAddresses(Array.from(addresses))
        .then((resolvedAddresses: Set<string>) => {
          const filteredKnownUtxos = utxos.filter(utxo => resolvedAddresses.has(utxo.payment_addr.bech32))
          walletConfigStore().setUtxos(filteredKnownUtxos)
        })
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
    setAssets(assets) {
      this.assets = assets
      if (chrome?.storage) {
        if (assets) {
          chrome.storage.local.set({ [STORAGE.assets]: assets });
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
    async loadWallets() {
      await loadWallets({ wallets: this.multiSigWallets });
    },
    async subscribeWallets() {
      await subscribeWallets({ wallets: this.multiSigWallets }, subscriptions);
    },
    async loadTransactions() {
      return await loadTransactions(this, multisigAppWallet);
    },
    async subscribeTransactions() {
      return await subscribeTransactions(this, multisigAppWallet, subscriptions);
    },
    async loadAssets() {
      return await loadAssets(this, multisigAppWallet, subscriptions);
    },
    async loadPools() {
      if (!multisigAppWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db: Dexie = await multisigAppWallet.getBlockchainDb()
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
      if (!multisigAppWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db = await multisigAppWallet.getDb()
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
      if (!multisigAppWallet) {
        return new Promise((resolve, reject) => {
          reject()
        });
      }
      const db = await multisigAppWallet.getDb()
      return new Promise((resolve, reject) => {
        subscriptions.set('dapps', liveQuery(() => db.table('connected_dapps').toArray()).subscribe({
          next: newConnectedDapps => {
            this.connectedDapps = newConnectedDapps
            if (chrome?.storage) {
              if (newConnectedDapps) {
                chrome.storage.local.set({ [STORAGE.whitelisted]: newConnectedDapps });
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
      if (!multisigAppWallet) {
        return
      }
      const db = await multisigAppWallet.getDb()
      db.table('connected_dapps').delete(id)
    },
    async setSelectedMultisig(selectedMultisig: any, chain: string, network: string) {
      this.multiSigWallet = { ...selectedMultisig, chain: chain, network: network };
      const currentWallet = this.getWallet;
      try {
        const res = await currentWallet.api.getAccountTransactions((this.multiSigWallet as MultisigWalletInterface).stakeAddress, 0);
        console.log("res:::", res);
        if (res && Array.isArray(res)) {
          const promises = [];
          const txHashes: string[] = res.map(tx => tx.tx_hash);
          const smallerArrays = chunkArray({ input: txHashes, bytesSize: 5 * 1024 });
          smallerArrays.forEach(smallerArray => {
            promises.push(currentWallet.api.getTransactionsInfo(smallerArray));
          });
          if ('id' in this.multiSigWallet) {
            promises.push(currentWallet.api.multiSig.transactions.getByWallet(this.multiSigWallet.id));
          }
          const txs = (await Promise.any(promises)).flat();
          await currentWallet.setAccountTransactions(txs);
          this.setTransactions(txs);
        }
      } catch (e) {
        console.log(e);
      }
    },

    setMultiSigWallets(multiSigWallets: any[]) {
      this.multiSigWallets = multiSigWallets;
    },
    generateMultisigDBName(parentWalletPubkey: string, multisigName: string) {
      return `multisig-${parentWalletPubkey.slice(0, 21)}-${_.kebabCase(multisigName)}`;
    },
    setTransactions(transactions: any[]) {
      this.transactions = transactions;
    }
  },
});
