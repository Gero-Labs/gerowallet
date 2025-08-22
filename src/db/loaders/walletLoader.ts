import Dexie from 'dexie';
import { BaseLoader } from './base';
import WalletStore from '@/stores/walletStore';
import { toStakeAddress } from '@/chrome/serialization';
import networks from '@/utils/networks';
import Loading from '@/stores/loading';

/**
 * Loader for wallet account information
 */
export class AccountLoader extends BaseLoader {
  constructor(
    private getDb: () => Promise<Dexie>,
    private walletId: any
  ) {
    super('account');
  }

  async load(): Promise<any> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('account').where({ walletId: this.walletId }).first(),
      (account) => {
        WalletStore.setAccount(account);
      },
      (error) => {
        console.error('Failed to Fetch AccountInfo:', error);
      }
    );
  }
}

/**
 * Loader for wallet contacts
 */
export class ContactsLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('contacts');
  }

  async load(): Promise<any> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('contacts').toArray(),
      (newContacts) => {
        const contacts = newContacts.reduce(function(map, contact) {
          map[contact.address] = contact;
          return map;
        }, {});
        WalletStore.setContacts(contacts);
      },
      (error) => {
        console.error('Failed to Fetch Contacts:', error);
      }
    );
  }
}

/**
 * Loader for wallet configuration
 */
export class ConfigLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('config');
  }

  async load(): Promise<any> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('config').toArray(),
      (config) => {
        WalletStore.setConfig(config.reduce(function(map, val) {
          map[val.key] = val.value;
          return map;
        }, {}));
      }
    );
  }
}

/**
 * Loader for rewards data
 */
export class RewardsLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('rewards');
  }

  async load(): Promise<any> {
    const db = await this.getDb();

    return this.createSubscription(
      () => db.table('rewards').orderBy("epoch").toArray(),
      (newRewards) => {
        WalletStore.setRewards(newRewards);
      }
    );
  }
}

/**
 * Loader for connected DApps
 */
export class ConnectedDappsLoader extends BaseLoader {
  constructor(private getDb: () => Promise<Dexie>) {
    super('dapps');
  }

  async load(): Promise<any> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('connected_dapps').toArray(),
      (newConnectedDapps) => {
        WalletStore.setConnectedDapps(newConnectedDapps);
      },
      (error) => {
        console.error('Failed to Fetch Connected Dapps:', error);
      }
    );
  }
}

/**
 * Loader for wallet transactions with complex processing
 */
export class TransactionsLoader extends BaseLoader {
  constructor(
    private getDb: () => Promise<Dexie>,
    private walletContext: {
      baseAddress: string;
      stakeAddress: string;
      chain: any;
      network: any;
      isEnterpriseAddress: () => boolean;
      networkId: () => number;
      setUtxosAndAddresses: (transactions: any[]) => Promise<void>;
    }
  ) {
    super('transactions');
  }

  async load(): Promise<any> {
    const walletDB = await this.getDb();

    return this.createSubscription(
      () => walletDB.table('transactions').toArray(),
      async (newTransactions: any[]) => {
        Loading.setLoadingTxs(true);
        try {
          let transactions: any = [];
          if (newTransactions) {
            let currentStake: string = '';
            let currentAddress: string = '';
            if (this.walletContext.isEnterpriseAddress()) {
              currentAddress = this.walletContext.baseAddress;
            } else {
              currentStake = this.walletContext.stakeAddress;
            }

            transactions = newTransactions.sort((a, b) => a.tx_timestamp - b.tx_timestamp)
              .map((tx) => {
                let sentAmount: number = 0;
                let receivedAmount: number = 0;
                const sentAssets: any = {};
                const receivedAssets: any = {};

                tx.utxo?.inputs.forEach(input => {
                  if ((input.address === currentAddress || toStakeAddress(input.address, this.walletContext.networkId()) === currentStake) && !input.data_hash) {
                    const value = input.amount.find(amount => amount.unit === 'lovelace');
                    const asset_list = input.amount.filter(amount => amount.unit !== 'lovelace');
                    if (value) {
                      sentAmount += +value.quantity;
                    }
                    if (asset_list.length > 0) {
                      asset_list.forEach(asset => {
                        if (sentAssets[asset.unit]) {
                          sentAssets[asset.unit].quantity += Number(asset.quantity);
                        } else {
                          sentAssets[asset.unit] = structuredClone(asset);
                          sentAssets[asset.unit].quantity = Number(sentAssets[asset.unit].quantity);
                        }
                      });
                    }
                  }
                });

                tx.utxo?.outputs.forEach(output => {
                  if ((output.address === currentAddress || toStakeAddress(output.address, this.walletContext.networkId()) === currentStake) && !output.datum_hash) {
                    const value = output.amount.find(amount => amount.unit === 'lovelace');
                    const asset_list = output.amount.filter(amount => amount.unit !== 'lovelace');
                    if (value) {
                      receivedAmount += +value.quantity;
                    }

                    if (asset_list.length > 0) {
                      asset_list.forEach(asset => {
                        if (receivedAssets[asset.unit]) {
                          receivedAssets[asset.unit].quantity += Number(asset.quantity);
                        } else {
                          receivedAssets[asset.unit] = structuredClone(asset);
                          receivedAssets[asset.unit].quantity = Number(receivedAssets[asset.unit].quantity);
                        }
                      });
                    }
                  }
                });

                const totalAmount = receivedAmount - sentAmount;
                const assets: any = {...sentAssets};
                const refAssets = {...sentAssets};
                Object.values(receivedAssets).forEach((receivedAsset: any) => {
                  if (assets[receivedAsset.unit]) {
                    assets[receivedAsset.unit].quantity -= Number(receivedAsset.quantity);
                    if (assets[receivedAsset.unit].quantity === 0) delete assets[receivedAsset.unit];
                  } else {
                    assets[receivedAsset.unit] = receivedAsset;
                  }
                });

                const refAssetsCopy = {...refAssets};
                Object.values(refAssets).forEach((asset: any) => {
                  if (Number(refAssetsCopy[asset.unit].quantity) === 0) {
                    delete refAssetsCopy[asset.unit];
                  }
                });

                const network = networks.resolveNetwork(this.walletContext.chain, this.walletContext.network);
                const nativeAsset = {
                  unit: "lovelace",
                  policy_id: "",
                  asset_name: "lovelace",
                  quantity: totalAmount,
                  metadata: {
                    decimals: 6,
                    description: network?.currencyDescription,
                    logo: network?.currencyImage,
                    name: network?.currencyName,
                    ticker: network?.currencyTicker,
                  }
                };

                return {
                  ...tx,
                  sentAmount,
                  receivedAmount,
                  sentAssets: Object.values(sentAssets),
                  receivedAssets: Object.values(receivedAssets),
                  ada: totalAmount,
                  assets: [nativeAsset, ...Object.values(assets)]
                };
              });
          }
          WalletStore.setTransactions(transactions);
          
          try {
            await this.walletContext.setUtxosAndAddresses(transactions);
          } catch (error) {
            console.error('setUtxosAndAddresses failed:', error);
          }
        } catch (e) {
          console.error(e);
          // Return an empty array on error instead of failing completely
          WalletStore.setTransactions([]);
        } finally {
          Loading.setLoadingTxs(false);
        }
      },
      (error: any) => {
        console.error('Failed to fetch transactions:', error);
      }
    );
  }
}
