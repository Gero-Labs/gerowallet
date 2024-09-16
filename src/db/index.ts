import Dexie, {DexieError} from 'dexie';
import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { useStore } from '@/store';
import { Wallet } from '@/models/wallet';
import { CoinTypes, Currency, WalletType, WalletTypePurpose } from '@/models/types';

const db = new Dexie('GeroWalletDatabase');

await db.version(1).stores({
  wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
  config: '++id, key, value',
  provider: '++id, [name+chain+network], baseUrl, apiKey',
});

db.open().catch(err => {
  console.error(`Failed to open database: ${err.stack || err}`);
});

// await initializeConfigTable();
//
// async function initializeConfigTable() {
//   await db['config'].toArray().then(async rows => {
//     if (rows.length === 0) {
//       const initialData = [{ key: 'provider', value: Provider.KOIOS }];
//       await db['config'].bulkAdd(initialData).catch(error => {
//         console.error('Error adding initial data:', error);
//       });
//     }
//   });
// }

export default {
  async getProvider(chain, network) {
    const provider = await this.getConfiguration('provider');
    return db['provider'].where('[name+chain+network]').equals([provider.value, chain, network]).first();
  },
  async setConfiguration(key, value) {
    if (value) {
      db['config'].put({ key: key, value: value });
    } else {
      db['config'].where({ key: key}).delete();
    }
  },
  async getConfiguration(key) {
    return db['config'].where({ key: key }).first();
  },
  async getAllWallets() {
    return db['wallets'].toArray();
  },
  async getLatestWalletByOrder() {
    const orderArray = await db['wallets'].orderBy('order').reverse().limit(1).keys();
    if (Array.isArray(orderArray) && orderArray.length) {
      return orderArray[0];
    }
    return null;
  },
  async createNewWallet(name, icon, theme, mnemonic, password, chain, network) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }
    const rootKey = Wallet.resolvePrivateKey(mnemonic);
    const encryptedPrivateKey = Wallet.encryptPrivateKey(rootKey, password);
    const accountIndex = 0;
    const publicKey = rootKey
      .derive(WalletTypePurpose.CIP1852)
      .derive(CoinTypes.CARDANO)
      .derive(HARDENED + accountIndex)
      .to_public()
      .to_bech32();
    const wallet = new Wallet(null, name, icon, WalletType.Normal, theme, order, encryptedPrivateKey, publicKey,
      new Date(), chain, network);
    const walletId = await db['wallets'].add({
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
    await this.createNewWalletDb(walletId);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewHardwareWallet(wallet: any) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }
    const walletId = await db['wallets'].add({
      ...wallet,
      order: order,
      passwordLastUpdate: new Date(),
    });
    await this.createNewWalletDb(walletId);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewWalletDb(walletId: number) {
    const db = new Dexie('wallet-' + walletId);
    db.version(1).stores({
      config: 'key, value',
      sync: '++id, hash, height, slot, time, epoch, epoch_slot',
      account: '++id, walletId, active, controlled_amount, rewards_sum, reserves_sum, withdrawals_sum, treasury_sum, withdrawal_amount, pool_id',
      addresses: 'address',
      rewards: 'epoch, amount, pool_id, type',
      transactions: 'id',
      connected_dapps: '++id, domain, time',
    });
    db.open().catch(err => {
      console.error(`Failed to open database: ${err.stack || err}`);
    });
    await db['config'].toArray().then(async rows => {
      if (rows.length === 0) {
        const initialData = [
          { key: 'currency', value: Currency.USD.short },
          { key: 'txAutoSubmit', value: true }
        ];
        await db['config'].bulkAdd(initialData).catch(error => {
          console.error('Error adding initial data:', error);
        });
      }
    });
  },
  async checkAndCreateBlockchainDatabase(dbName: string) {
    try {
      // Attempt to open the database
      const db: Dexie = new Dexie(dbName);
      return await db.open();
    } catch (error: DexieError | any) {
      console.log(error)
      if (error.name === 'NoSuchDatabaseError') {
        // Database does not exist, create it
        const db: Dexie = new Dexie(dbName);
        db.version(1).stores({
          pools: 'pool_id_bech32',
          pools_sync: '++id, time',
          assets: 'asset, fingerprint, asset_name, policy_id',
          assets_sync: '++id, time'
        });
        return await db.open();
      } else {
        // Handle other errors
        console.error('Error opening database:', error);
        return null
      }
    }
  }
};
