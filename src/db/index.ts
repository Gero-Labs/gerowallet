import Dexie, {DexieError} from 'dexie';
import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { useStore } from '@/stores';
import { Wallet } from '@/models/wallet';
import { CoinTypes, Currency, WalletType, WalletTypePurpose } from '@/models/types';
import { walletDBSchema, walletDBVersion } from '@/db/schema';
import { encrypt } from '@/shared/utils/crypto';
import * as bip39 from 'bip39';

const db: Dexie = new Dexie('GeroWalletDatabase');
const blockChainDBVersion: number = 2;

db.version(10).stores({
  wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
  config: '++id, key, value',
  provider: '++id, [name+chain+network], baseUrl, apiKey',
})
  .upgrade(async (tx) => {
    console.log('Upgrading database schema to version 11...', tx);
    try {
      const oldWallets = await tx.table('conceptualWallet').toArray();
      const keys = await tx.table('key').toArray();
      const publicKeyMap: Map<number, string> = new Map();
      const encryptedPrivateKeyMap: Map<number, string> = new Map();
      for (const key of keys) {
        const id = key.conceptualWalletId;
        if (key.hash.includes('xpub')) {
          publicKeyMap.set(id, key.hash);
        } else if (key.isEncrypted) {
          encryptedPrivateKeyMap.set(id, key.hash)
        }
      }

      // Check if the old table exists. If so, we are upgrading from the old version.
      if (oldWallets) {
        console.log('Migrating data from old schema (v9.2) to new schema (v10)...');

        for (const oldWallet of oldWallets) {
          const walletId = oldWallet.conceptualWalletId;
          // Map fields from the old schema to the new one.
          // For example:
          const newWallet = {
            id: walletId,
            name: oldWallet.name,
            icon: oldWallet.color,  // Default or map using your own logic
            type: oldWallet.walletType || 'Normal',
            theme: 'gero',
            order: oldWallet.listOrder,
            encryptedPrivateKey: encryptedPrivateKeyMap.get(walletId),
            publicKey: publicKeyMap.get(walletId),
            passwordLastUpdate: new Date(),
            chain: 'Cardano',
            network: 'Mainnet',
          };

          // Add the new wallet into the new wallets table.
          await tx.table('wallets').add(newWallet);
        }
      }
    } catch (error) {
      console.error('Error migrating data from old schema to new schema:', error);
    }
});

db.version(11).stores({
  wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network, userId',
  config: '++id, key, value',
  provider: '++id, [name+chain+network], baseUrl, apiKey',
})

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
    const configuration = await this.getConfiguration(key);
    if (!configuration) {
      await db['config'].put({
        key: key,
        value: value
      });
    } else {
      configuration.value = value;
      await db['config'].put(configuration);
    }
  },
  async getGeroConfig() {
    const geroConfigArray = await db['config'].toArray()
    if (geroConfigArray && geroConfigArray.length > 0) {
      return geroConfigArray.reduce((map: Record<string, any>, config: any) => {
        map[config.key] = config.value;
        return map;
      }, {});
    }
    return { };
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
  async createNewWallet(name, icon, theme, mnemonic: string, password, chain, network) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }
    let isRestore = true;
    if (!mnemonic) {
      isRestore = false;
      mnemonic = bip39.generateMnemonic(256);
    }
    const encryptedMnemonic = encrypt(mnemonic, password);
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
      new Date(), chain, network, null, encryptedMnemonic);
    const walletId = await db['wallets'].add({
      name: wallet.name,
      icon: wallet.icon,
      type: wallet.type,
      theme: wallet.theme,
      order: wallet.order,
      encryptedPrivateKey: wallet.encryptedPrivateKey,
      encryptedMnemonic: wallet.encryptedMnemonic,
      publicKey: wallet.publicKey,
      passwordLastUpdate: wallet.passwordLastUpdate,
      chain: wallet.chain,
      network: wallet.network
    });
    await this.createNewWalletDb(walletId, !!wallet.encryptedMnemonic, isRestore);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewGoogleWallet(name: string, icon: string, theme: string, password: string, chain: string, network: string, jwt: string) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }
    const parts = jwt.split(".");
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    const userId = payload.email;
    const wallet = new Wallet(null, name, icon, WalletType.Google, theme, order, null, null,
      new Date(), chain, network, userId);
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
      network: wallet.network,
      userId: userId,
    });
    await this.createNewWalletDb(walletId, !!wallet.encryptedMnemonic);
    await useStore().loadWallets();
    return walletId;
  },
  async getGoogleWalletWithEmail(email: string) {
    const wallets = await db['wallets'].where('userId').equals(email).toArray();
    if (wallets && wallets.length > 0) {
      return wallets[0];
    }
    return null;
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
    await this.createNewWalletDb(walletId, !!wallet.encryptedMnemonic);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewWalletDb(walletId: number|string, hasEncryptedMnemonic: boolean, isRestore: boolean = false) {
    const walletName = typeof walletId === 'number' ? `wallet-${walletId}` : walletId;
    const db = new Dexie(walletName);
    this.setWalletDBVersionSchema(db)
    db.open().catch(err => {
      console.error(`Failed to open database: ${err.stack || err}`);
    });
    await db['config'].toArray().then(async rows => {
      if (rows.length === 0) {
        const initialData = [
          { key: 'currency', value: Currency.USD.short },
          { key: 'txAutoSubmit', value: true }
        ];
        if (hasEncryptedMnemonic) {
          if (isRestore) {
            initialData.push({ key: 'backup', value: true })
          } else {
            initialData.push({ key: 'backup', value: false })
          }
        }
        await db['config'].bulkAdd(initialData).catch(error => {
          console.error('Error adding initial data:', error);
        });
      }
    });
  },
  async deleteWallet(walletId: number|string) {
    const walletName = typeof walletId === 'number' ? `wallet-${walletId}` : walletId;
    await db['wallets'].delete(walletId)
    await Dexie.delete(walletName).catch(err => {
      console.error(`Failed to delete database '${walletName}': ${err.stack || err}`);
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
        this.setBlockchainDBVersionSchema(db)
        return db.open();
      } else {
        // Handle other errors
        console.error('Error opening database:', error);
        return null
      }
    }
  },
  setBlockchainDBVersionSchema(db: Dexie) {
    db.version(blockChainDBVersion).stores({
      pools: 'pool_id_bech32',
      dreps: 'drep_id',
      sync: '++id, time',
      assets: 'asset, fingerprint, asset_name, policy_id',
      // protocol_params: 'epoch'
    });
  },
  setWalletDBVersionSchema(db: Dexie) {
    console.log('setWalletDBVersionSchema')
    db.version(walletDBVersion).stores(walletDBSchema);
  }
};
