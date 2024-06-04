import Dexie from "dexie";
import { Blockchain, Network, Provider } from '@/models/types';

export class Database {
  private db: Dexie;

  constructor(databaseName: string) {
    this.db = new Dexie(databaseName);
  }

  async init() {
    try {
      await this.db.version(1).stores({
        wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
        config: '++id, key, value',
        provider: '++id, [name+chain+network], baseUrl, apiKey',
      });
    } catch (e: any) {
      console.error(`Failed to open database: ${e.stack || e}`);
    }
  }

  async initializeConfigTable() {
    return this.db['config'].toArray().then(async rows => {
      if (rows.length === 0) {
        const initialData = [{key: 'provider', value: Provider.KOIOS}];
        await this.db['config'].bulkAdd(initialData).catch(error => {
          console.error('Error adding initial data:', error);
        });
      }
    })
  }

  async initializeProviderTable() {
    await this.db['provider'].toArray().then(async rows => {
      if (rows.length === 0) {
        const initialData = [
          {
            name: Provider.KOIOS,
            chain: Blockchain.CARDANO,
            network: Network.MAINNET,
            baseUrl: 'https://api.koios.rest/api/v1/',
            apiKey: null
          },
          {
            name: Provider.KOIOS,
            chain: Blockchain.CARDANO,
            network: Network.PREPROD,
            baseUrl: 'https://preprod.koios.rest/api/v1/',
            apiKey: null
          },
          {
            name: Provider.KOIOS,
            chain: Blockchain.CARDANO,
            network: Network.PREVIEW,
            baseUrl: 'https://preview.koios.rest/api/v1/',
            apiKey: null
          },
          {
            name: Provider.KOIOS,
            chain: Blockchain.APEX_PRIME,
            network: Network.TESTNET,
            baseUrl: 'http://apex-prime-testnet.gerowallet.io:8053/',
            apiKey: null
          }
        ];
        await this.db['provider'].bulkAdd(initialData).catch(error => {
          console.error('Error adding initial data:', error);
        });
      }
    })
  }

  async getConfiguration(key: string) {
    return this.db['config'].where({key: key}).first();
  }

  async getProvider(chain: string, network: string) {
    const provider = await this.getConfiguration('provider');
    return this.db['provider'].where('[name+chain+network]').equals([provider.value, chain, network]).first();
  }

  async getAllWallets() {
    return this.db['wallets'].toArray();
  }

  async getLatestWalletByOrder() {
    const orderArray = await this.db['wallets'].orderBy('order').reverse().limit(1).keys();

    if (Array.isArray(orderArray) && orderArray.length) {
      return orderArray[0];

    }
    return null;
  }

  async createNewWallet(wallet: any) {
    return await this.db['wallets'].add({
      name: wallet.name,
      icon: wallet.icon,
      type: wallet.type,
      theme: wallet.theme,
      order: wallet.order,
      encryptedPrivateKey: wallet.encryptedPrivateKey,
      publicKey: wallet.publicKey,
      passwordLastUpdate: wallet.passwordLastUpdate,
      chain: wallet.chain,
      network: wallet.network
    });
  }

  async createNewHardwareWallet({name, icon, type, theme, chain, network, publicKey}) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }
    return await this.db['wallets'].add({
      name: name,
      icon: icon,
      type: type,
      theme: theme,
      order: order,
      publicKey: publicKey,
      passwordLastUpdate: new Date(),
      chain: chain,
      network: network
    });
  }

  async createNewWalletDb(walletId) {
    this.db.version(1).stores({
      config: '++id, key, value',
      sync: '++id, hash, height, slot, time, epoch, epoch_slot',
      account: '++id, walletId, active, controlled_amount, rewards_sum, reserves_sum, withdrawals_sum, treasury_sum, withdrawal_amount, pool_id',
      addresses: 'address',
      rewards: 'epoch, amount, pool_id, type',
      transactions: 'id',
    });
  }

  async checkAndCreateBlockchainDatabase(dbName) {
    try {
      return await this.db.open();
    } catch (error: any) {
      console.log(error)
      if (error.name === 'NoSuchDatabaseError') {
        // Database does not exist, create it
        const db = new Dexie(dbName);
        db.version(1).stores({
          pools: 'pool_id_bech32',
          pools_sync: 'time',
          assets: 'fingerprint, asset_name, policy_id',
          assets_sync: 'time'
        });
        return db.open();
      } else {
        // Handle other errors
        console.error('Error opening database:', error);
        return null
      }
    }
  }

}
