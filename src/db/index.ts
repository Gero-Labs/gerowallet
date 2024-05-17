import Dexie from 'dexie';
import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano';

import { useStore } from '@/store';
import { Wallet } from '@/models/wallet';
import { Blockchain, CoinTypes, Network, Provider, WalletType, WalletTypePurpose } from '@/models/types';

const db = new Dexie('GeroWalletDatabase');

await db.version(1).stores({
  wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
  config: '++id, key, value',
  provider: '++id, name, chain, network, baseUrl, apiKey',
});

db.open().catch(err => {
  console.error(`Failed to open database: ${err.stack || err}`);
});

await initializeConfigTable();

await initializeProviderTable();
async function initializeConfigTable() {
  await db['config'].toArray().then(async rows => {
    if (rows.length === 0) {
      const initialData = [{ key: 'provider', value: Provider.KOIOS }];
      await db['config'].bulkAdd(initialData).catch(error => {
        console.error('Error adding initial data:', error);
      });
    }
  });
}

async function initializeProviderTable() {
  await db['provider'].toArray().then(async rows => {
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
          chain: Blockchain.APEX_PRIME,
          network: Network.TESTNET,
          baseUrl: 'http://apex-prime-testnet.gerowallet.io:8053/',
          apiKey: null
        }
      ];
      await db['provider'].bulkAdd(initialData).catch(error => {
        console.error('Error adding initial data:', error);
      });
    }
  });
}

export default {
  async getProvider(chain, network) {
    const provider = await this.getConfiguration('provider');
    return db['provider'].where({ name: provider.value, chain: chain, network: network }).first();
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
  async createNewHardwareWallet(name, icon, type, theme, chain, network, publicKey) {
    let order = await this.getLatestWalletByOrder();
    if (order == null) {
      order = 1;
    } else {
      order++;
    }
    const walletId = await db['wallets'].add({
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
    await this.createNewWalletDb(walletId);
    await useStore().loadWallets();
    return walletId;
  },
  async createNewWalletDb(walletId) {
    const db = new Dexie('wallet-' + walletId);
    await db.version(1).stores({
      config: '++id, key, value',
      sync: '++id, walletId, blockHash, height, absSlot, time, epoch, epoch_slot',
      account:
        '++id, walletId, active, controlled_amount, rewards_sum, reserves_sum, withdrawals_sum, treasury_sum, withdrawal_amount, pool_id',
      addresses: 'address',
      rewards: 'epoch, amount, pool_id, type',
      transactions: 'id, transaction',
      tx_io: 'id',
      utxos: 'id',
    });
    db.open().catch(err => {
      console.error(`Failed to open database: ${err.stack || err}`);
    });
  },
};
