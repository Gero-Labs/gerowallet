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
      triggerResync?: () => Promise<void>;
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
        console.log('new TXs', newTransactions)
        try {
          // Check for the old transaction format and trigger migration if needed
          if (await this.detectAndHandleOldTransactionFormat(newTransactions)) {
            return; // Exit early as a resync is in progress
          }

          let transactions: any = [];
          if (newTransactions?.length) {
            const isEnterpriseAddress = this.walletContext.isEnterpriseAddress();
            const currentAddress = isEnterpriseAddress ? this.walletContext.baseAddress : '';
            const currentStake = !isEnterpriseAddress ? this.walletContext.stakeAddress : '';
            const networkId = this.walletContext.networkId();
            const network = networks.resolveNetwork(this.walletContext.chain, this.walletContext.network);

            const nativeAssetMetadata = {
              decimals: 6,
              description: network?.currencyDescription,
              logo: network?.currencyImage,
              name: network?.currencyName,
              ticker: network?.currencyTicker,
            };

            newTransactions.sort((a, b) => a.tx_timestamp - b.tx_timestamp);
            transactions = newTransactions.map((tx) => {
              let sentAmount = 0;
              let receivedAmount = 0;
              const sentAssets = new Map<string, any>();
              const receivedAssets = new Map<string, any>();

              this.processUtxos(tx.utxo?.inputs, currentAddress, currentStake, networkId, true, sentAssets, (amount) => {
                sentAmount += amount;
              });

              this.processUtxos(tx.utxo?.outputs, currentAddress, currentStake, networkId, false, receivedAssets, (amount) => {
                receivedAmount += amount;
              });

              const totalAmount = receivedAmount - sentAmount;

              const finalAssets = this.calculateFinalAssets(sentAssets, receivedAssets);

              const nativeAsset = {
                unit: "lovelace",
                policy_id: "",
                asset_name: "lovelace",
                quantity: totalAmount,
                metadata: nativeAssetMetadata
              };

              return {
                ...tx,
                sentAmount,
                receivedAmount,
                sentAssets: Array.from(sentAssets.values()),
                receivedAssets: Array.from(receivedAssets.values()),
                ada: totalAmount,
                assets: [nativeAsset, ...finalAssets]
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

  private processUtxos(
    utxos: any[] | undefined,
    currentAddress: string,
    currentStake: string,
    networkId: number,
    isSent: boolean,
    assetsMap: Map<string, any>,
    addLovelace: (amount: number) => void
  ): void {
    if (!utxos?.length) return;

    for (let i = 0; i < utxos.length; i++) {
      const utxo = utxos[i];
      const isOwnAddress = utxo.address === currentAddress ||
        toStakeAddress(utxo.address, networkId) === currentStake;

      if (!isOwnAddress || (isSent && utxo.data_hash) || (!isSent && utxo.datum_hash)) {
        continue;
      }

      const amounts = utxo.amount;
      if (!amounts?.length) continue;

      for (let j = 0; j < amounts.length; j++) {
        const amount = amounts[j];
        if (amount.unit === 'lovelace') {
          addLovelace(Number(amount.quantity));
        } else {
          this.updateAssetMap(assetsMap, amount);
        }
      }
    }
  }

  private updateAssetMap(assetsMap: Map<string, any>, asset: any): void {
    const existing = assetsMap.get(asset.unit);
    if (existing) {
      existing.quantity += Number(asset.quantity);
    } else {
      assetsMap.set(asset.unit, {
        ...asset,
        quantity: Number(asset.quantity)
      });
    }
  }

  private calculateFinalAssets(sentAssets: Map<string, any>, receivedAssets: Map<string, any>): any[] {
    const finalAssets: any[] = [];
    const processedUnits = new Set<string>();

    sentAssets.forEach((sentAsset, unit) => {
      const receivedAsset = receivedAssets.get(unit);
      const quantity = receivedAsset
        ? Number(receivedAsset.quantity) - Number(sentAsset.quantity)
        : -Number(sentAsset.quantity);

      if (quantity !== 0) {
        finalAssets.push({
          ...sentAsset,
          quantity
        });
      }
      processedUnits.add(unit);
    });

    receivedAssets.forEach((receivedAsset, unit) => {
      if (!processedUnits.has(unit)) {
        finalAssets.push(receivedAsset);
      }
    });

    return finalAssets;
  }

  /**
   * Detects old transaction format and triggers migration if needed
   * @param transactions - Array of transaction objects to check
   * @returns Promise<boolean> - true if migration was triggered, false otherwise
   */
  private async detectAndHandleOldTransactionFormat(transactions: any[]): Promise<boolean> {
    if (!transactions?.length) {
      return false;
    }

    // Check if any transaction has the old 'transaction' field
    const hasOldFormat = transactions.some(tx =>
      tx.hasOwnProperty('transaction') ||
      // Check for missing new fields that should exist in the new format
      !tx.hasOwnProperty('utxo')
    );

    if (hasOldFormat) {
      console.log('🔄 Detected old transaction format, triggering resync...');

      try {
        // Clear old transaction data to prepare for fresh sync
        const walletDB = await this.getDb();
        await walletDB.table('transactions').clear();
        console.log('✅ Cleared old transaction data');

        // Trigger resync if the method is available
        if (this.walletContext.triggerResync) {
          await this.walletContext.triggerResync();
          console.log('✅ Resync triggered successfully');
          return true;
        } else {
          console.warn('⚠️ triggerResync method not available in wallet context');
        }
      } catch (error) {
        console.error('❌ Failed to trigger migration resync:', error);
        // Don't block the wallet loading process even if migration fails
      }
    }

    return false;
  }
}
