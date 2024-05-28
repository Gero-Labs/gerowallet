import Dexie, { DexieError } from 'dexie';
import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';
import { useStore } from '@/store';
import { Wallet } from '@/models/wallet';
import { CoinTypes, WalletType, WalletTypePurpose } from '@/models/types';
import { sendMessageToBackground } from '@/messaging';

const db = new Dexie('GeroWalletDatabase');

await db.version(1).stores({
  wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
  config: '++id, key, value',
  provider: '++id, [name+chain+network], baseUrl, apiKey',
});

db.open().catch(err => {
  console.error(`Failed to open database: ${err.stack || err}`);
});

await initializeConfigTable();

await initializeProviderTable();

async function initializeConfigTable() {
  try {
    await sendMessageToBackground({action: 'initializeConfigTable'})
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e.message);
    } else {
      console.error('Error adding initial data:', e);
    }
  }
}

async function initializeProviderTable() {
  try {
    await sendMessageToBackground({action: 'initializeProviderTable'})
  } catch (e: unknown) {
    if (e instanceof Error) {
      console.error(e.message);
    } else {
      console.error('Error adding initial data:', e);
    }
  }
}

export default {
  async getProvider(chain: string, network: string): Promise<any> {
    try {
      return await sendMessageToBackground({action: 'getProvider', data: {chain: chain, network: network}});
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error('Error getProvider:', e);
      }
    }
  },
  async getConfiguration(key: string): Promise<any> {
    try {
      return await sendMessageToBackground({action: 'getConfiguration', data: {key: key}});
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error('Error getConfiguration:', e);
      }
    }
  },
  async getAllWallets(): Promise<any> {
    try {
      return await sendMessageToBackground({action: 'getAllWallets'})
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error('Error getAllWallets:', e);
      }
    }
  },
  async getLatestWalletByOrder(): Promise<any> {
    try {
      return await sendMessageToBackground({action: 'getLatestWalletByOrder'})
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error('Error getLatestWalletByOrder:', e);
      }
    }
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

    const data = {
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
    };

    const walletId = await sendMessageToBackground<number>({action: 'createNewWallet', data: data});
    await this.createNewWalletDb(walletId);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewHardwareWallet(name: string, icon: string, type, theme, chain, network, publicKey) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }

    const data = {
      name: name,
      icon: icon,
      type: type,
      theme: theme,
      order: order,
      publicKey: publicKey,
      passwordLastUpdate: new Date(),
      chain: chain,
      network: network
    };

    const walletId = await sendMessageToBackground<number>({action: 'createNewHardwareWallet', data: data});
    await this.createNewWalletDb(walletId);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewWalletDb(walletId: number): Promise<any> {
    try {
      return await sendMessageToBackground({action: 'createNewWalletDb', data: {walletId: walletId}});
    } catch (e: unknown) {
      if (e instanceof Error) {
        console.error(e.message);
      } else {
        console.error('Error createNewWalletDb:', e);
      }
    }
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
          pools_sync: 'time',
          assets: 'fingerprint, asset_name, policy_id',
          assets_sync: 'time'
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
