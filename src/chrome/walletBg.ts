import Dexie, { DexieError } from 'dexie';
import { Api } from '@/api/api';
import { Cardano } from '@cardano-sdk/core';
import networks from '@/utils/networks';
import { blockChainDBSchema, blockChainDBVersion, walletDBSchema, walletDBVersion } from '@/db/schema';
import { Blockchain, Network, Provider, Tip, WalletType } from '@/models/types';
import zkFoldApi from '@/api/zk-fold.api';
import { getAddress, getRewardAddress } from '@/chrome/serialization';
import * as Ably from 'ably';
import axios from 'axios';
import LoadingState from '@/plugins/loading';
import { chunkArray } from 'array-chunk-by-size';

// @ts-ignore
const backendUrl: string = import.meta.env.VITE_BACKEND_URL;

let authParams: {
  chain: string;
  network: string;
  address: string;
} | null = null;

const subscribedChannels: Map<string, Ably.RealtimeChannel> = new Map<string, Ably.RealtimeChannel>();

export const ably: Ably.Realtime = new Ably.Realtime({
  autoConnect: false,
  closeOnUnload: true,         // still clean up on unload
  authCallback: (tokenParams, callback) => {
    if (!authParams) {
      // haven’t logged in yet
      return callback('Ably: not yet authenticated', null);
    }

    // fetch a fresh TokenRequest JSON from your backend
    axios.get(`${backendUrl}/api/ably/token?chain=${authParams.chain}&network=${authParams.network}&address=${authParams.address}`)
      .then(res => {
        // `res.data` must be the raw TokenRequest object:
        // { keyName, capability, clientId, timestamp, mac }
        console.log(res.data)
        callback(null, res.data);
      })
      .catch(err => callback(err.message, null));
  }
});

ably.connection.on('connecting', () => console.info('Ably connecting…'));
ably.connection.on('connected',  (connectionStateChange: Ably.ConnectionStateChange) => {
  if (connectionStateChange.current === 'connected') {
    console.info('Ably connected!')
  }
});
ably.connection.on('disconnected',() => console.info('Ably disconnected'));
ably.connection.on('failed',     e => console.error('Ably failed', e));

export class WalletBg {
  db: Dexie;
  api: Api;
  private syncLock: Promise<void> | null = null; // Lock for the sync function

  id: any;
  name: any;
  icon: any;
  type: any;
  theme: any;
  order: any;
  chain: any;
  network: any;
  publicKey: string;
  provider: Provider;

  encryptedPrivateKey: any;
  passwordLastUpdate: Date;
  userId?: string;
  encryptedMnemonic?: string;
  baseAddress: Cardano.Address;
  token?: string;

  constructor(wallet: any) {
    this.id = wallet.id;
    this.name = wallet.name;
    this.icon = wallet.icon;
    this.type = wallet.type;
    this.theme = wallet.theme;
    this.order = wallet.order;
    this.encryptedPrivateKey = wallet.encryptedPrivateKey;
    this.publicKey = wallet.publicKey;
    this.passwordLastUpdate = wallet.passwordLastUpdate;
    this.chain = wallet.chain;
    this.network = wallet.network;
    this.userId = wallet.userId;
    this.encryptedMnemonic = wallet.encryptedMnemonic;
    const provider = networks.resolveDefaultProvider(this.chain, this.network)
    this.api = new Api(wallet, provider);
    this.db = new Dexie('wallet-' + wallet.id);
    this.db.version(walletDBVersion).stores(walletDBSchema);
  }

  async init(): Promise<void> {
    const promises = []
    if (this.type === WalletType.Google) {
      promises.push(zkFoldApi.walletAddress(this.userId).then(res => {
        if (res['status'] !== 200) {
          throw new Error('Failed to get address');
        }
        this.baseAddress = Cardano.Address.fromBech32(res['data']['address'])
      }))
    } else {
      this.baseAddress = getAddress(this.publicKey, this.chain, this.network, 0);
    }
    // promises.push(this.db.open().catch(async err => {
    //   if (err.name === 'NoSuchDatabaseError') {
    //     await db.createNewWalletDb(this.id, !!this.encryptedMnemonic);
    //   }
    // })) TODO

    ably.connect();
    this.sync();
    const chain = Object.keys(Blockchain).find(key => Blockchain[key] === this.chain);
    const network = Object.keys(Network).find(key => Network[key] === this.network);
    let address
    if (this.isEnterpriseAddress()) {
      address = this.baseAddress.toBech32();
    } else {
      address = this.stakeAddress().toBech32();
    }
    authParams = { chain, network, address };
    const privateChan = address;
    if (!subscribedChannels.has(privateChan)) {
      const channel = ably.channels.get(privateChan);
      promises.push(channel
        .subscribe((msg: Ably.InboundMessage) => console.log('▶ Personal:', msg.data)));
      subscribedChannels.set(privateChan, channel);
      console.log("Subscribed to private channel: ", privateChan)
    }

    const groupChan = `${chain}.${network}`;
    if (!subscribedChannels.has(groupChan)) {
      const channel = ably.channels.get(groupChan);
      promises.push(channel
        .subscribe(async (msg: Ably.InboundMessage) => {
          switch (msg.name) {
            case 'TIP':
              await this.sync(JSON.parse(msg.data) as Tip);
              break;
            default:
              console.log('▶ Group:', msg.data)
          }
        }));
      subscribedChannels.set(groupChan, channel);
      console.log("Subscribed to group channel: ", groupChan)
    }
    await Promise.all(promises)
  }

  logout() {
    console.log('logout')
    subscribedChannels.values().forEach((channel: Ably.RealtimeChannel) => {
      channel.unsubscribe();
    });
    subscribedChannels.clear();
    try {
      ably.connection?.close();
      ably.close();
    } catch (e) {
      console.log(e)
    }
  }

  stakeAddress(): Cardano.Address {
    return getRewardAddress(this.publicKey, this.chain, this.network)
    // return RewardAddress.from_address(Address.from_bech32("stake1u9637sgvdl9nhmsw8lsgkr9sm3p0yn9r96xdhmu6ya5he3q847rpv"))
  }

  async sync(tip?: Tip) {
    if (this.syncLock) {
      // If sync is already running, wait for it to complete
      await this.syncLock;
      return;
    }
    this.syncLock = (async () => {
      try {
        LoadingState.setSyncing(true);
        console.log("Syncing...")
        if (!tip) {
          tip = await this.api.getTip();
        }
        const lastSyncInfo = await this.getLastSyncInfo();
        if (!lastSyncInfo) {
          // loading.setText('Restoring Wallet Data. Please Wait ...')
          LoadingState.setRestoring(true);
          await this.restore(tip);
          LoadingState.setRestoring(false);
        } else if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
          const promises = [];
          if (!this.isEnterpriseAddress()) {
            promises.push(this.syncTable(1)); // Sync Staking Pools
            promises.push(this.syncTable(2)); // Sync DReps
          }
          // promises.push(this.syncProtocolParams(tip.epoch));
          const prevAccountInfo = await this.getAccountInfo();
          const from = !lastSyncInfo ? 0 : lastSyncInfo['height']
          const baseAddress: Cardano.Address = this.baseAddress
          const isEnterpriseAddress: boolean = baseAddress.getType() === Cardano.AddressType.EnterpriseScript;
          let address: string;
          if (isEnterpriseAddress) {
            address = baseAddress.toBech32();
          } else {
            address = this.stakeAddress().toBech32();
          }
          const rewards_sum = prevAccountInfo?.rewards_sum ? prevAccountInfo?.rewards_sum : "0";
          const controlled_amount = prevAccountInfo?.controlled_amount ? prevAccountInfo?.controlled_amount : "0";
          const withdrawable_amount = prevAccountInfo?.withdrawable_amount ? prevAccountInfo?.withdrawable_amount : "0";
          await this.setSync(await this.api.sync(from, tip, address, rewards_sum, controlled_amount, withdrawable_amount));
        }
      } catch (err) {
        console.log(err);
      } finally {
        // Release the lock after execution
        this.syncLock = null;
      }
    })();
    // Wait for the locked sync operation to complete
    await this.syncLock;
  }

  async resync() {
    const promises = []
    promises.push(this.db
      .open()
      .then(db => {
        const syncTable = db.table('sync');
        syncTable.clear();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      }));
    promises.push(this.db
      .open()
      .then(db => {
        const syncTable = db.table('account');
        syncTable.clear();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      }));
    await Promise.all(promises);
    await this.sync();
  }

  async setSync(syncObject) {
    console.log('setSync', syncObject);
    if (syncObject && syncObject.success) {
      const promises = [];
      if (syncObject.account) {
        promises.push(this.setAccountInfo(syncObject.account));
      }
      if (syncObject.assets) {
        promises.push(this.setAssets2(syncObject.assets));
      }
      if (syncObject.rewards) {
        promises.push(this.setAccountRewards(syncObject.rewards));
      }
      if (syncObject.transactions) {
        promises.push(this.setAccountTransactions(syncObject.transactions));
      }
      if (syncObject.block) {
        promises.push(this.setLastSyncInfo(syncObject.block));
      }
      if (promises.length > 0) {
        await Promise.all(promises);
      }
    }
    LoadingState.setSyncing(false);
  }

  async getLastSyncInfo() {
    return this.db
      .open()
      .then(async db => {
        const syncTable = db.table('sync');
        if (!syncTable) throw new Error('No Sync table.');
        const rows = await syncTable.toArray();
        if (rows.length > 0) {
          return rows[0];
        } else {
          return null;
        }
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setLastSyncInfo(tip: Tip): Promise<void> {
    await this.db
      .open()
      .then(db => {
        const syncTable = db.table('sync');
        if (!syncTable) throw new Error('No Sync table.');
        return syncTable.put({ id: 1, ...tip });
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async getAccountInfo(): Promise<any> {
    return this.db
      .open()
      .then(async db => {
        const accountTable = db.table('account');
        if (!accountTable) throw new Error('No Account table.');
        return accountTable.where({ walletId: this.id }).first();
      })
      .catch(err => {
        console.debug(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setAccountInfo(accountInfo): Promise<any> {
    const resAccount = await this.getAccountInfo();
    const acc = {
      walletId: this.id,
      ...accountInfo,
    };
    const accountInfoId = await this.db
      .open()
      .then(db => {
        const accountTable = db.table('account');
        if (accountTable) {
          if (resAccount) {
            acc.id = resAccount.id;
          }
          return accountTable.put(acc);
        }
        return null;
      })
      .catch(err => {
        console.error(`${err.stack || err}`);
      });
    return {
      id: accountInfoId,
      ...acc,
    };
  }

  async setAssets2(assets): Promise<void> {
    console.log('setAssets');
    const blockchainDB: Dexie = await this.getBlockchainDb();
    const assetsTable = blockchainDB.table('assets');
    if (assetsTable) {
      assetsTable.bulkPut(assets);
    }
  }

  async setAccountRewards(res): Promise<any[] | void> {
    return this.db
      .open()
      .then(db => {
        const rew = [];
        const rewardsTable = db.table('rewards');

        if (!rewardsTable) throw new Error('No Rewards table.');

        res.forEach(reward => {
          rew.push(rewardsTable.put(reward));
        });

        return rew;
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setAccountTransactions(txs): Promise<any> {
    return this.db.open()
      .then(db => {
        const txsTable = db.table('transactions');
        if (txsTable) {
          txs = txs.map(tx => {
            return { id: tx.tx_hash, transaction: tx };
          });
          txsTable.bulkPut(txs);
        }
      }).catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async syncTable(tableId): Promise<void> { //pools - 1, dreps - 2
    if (this.chain == Blockchain.CARDANO || this.chain == Blockchain.APEX_PRIME) {
      const blockchainDB: Dexie = await this.getBlockchainDb();
      const syncTable = blockchainDB.table('sync');
      const lastSyncArray = await syncTable.toArray();
      const currentTime = new Date();
      const sync = lastSyncArray?.find(element => element.id == tableId)
      if (!sync) {
        await this.setSyncTable(blockchainDB, syncTable, tableId);
      } else {
        const lastSyncTime = new Date(sync.time);
        const hoursSinceLastSync = (currentTime.getTime() - lastSyncTime.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastSync >= 4) {
          await this.setSyncTable(blockchainDB, syncTable, tableId);
        }
      }
    }
  }

  async setSyncTable(blockchainDB: Dexie, syncTable, tableId: number) {
    let res
    let table
    if (tableId == 1) {
      res = await this.getStakingPools();
      table = 'pools'
    } else if (tableId == 2) {
      res = await this.getDReps();
      table = 'dreps'
    }
    blockchainDB.table(table).bulkPut(res);
    syncTable.put({ id: tableId, time: new Date().getTime() });
  }

  private async getStakingPools() {
    try {
      const res = await this.api.getAllPools();
      if (res) {
        return res;
      }
    } catch (e) {
      console.log(e);
    }
  }

  private async getDReps() {
    try {
      const res = await this.api.getAllDReps();
      if (res) {
        return res;
      }
    } catch (e) {
      console.log(e);
    }
  }

  async restore(tip: Tip): Promise<void> {
    const prevAccountInfo = await this.getAccountInfo();

    // Create an array to hold the promises that need to be awaited
    const promises = [];
    if (!this.isEnterpriseAddress()) {
      // Sync staking pools
      promises.push(this.syncTable(1));

      // Sync DReps
      promises.push(this.syncTable(2));
    }

    // Sync account info and handle rewards and transactions
    promises.push(this.syncAccountInfo().then(async accountInfo => {
      if (accountInfo) {
        if (!prevAccountInfo || Number(prevAccountInfo.rewards_sum) != Number(accountInfo.rewards_sum)) {
          await this.syncAccountRewards();
        }
        if (!prevAccountInfo || Number(prevAccountInfo.controlled_amount) != Number(accountInfo.controlled_amount) /* TODO Add Pool ID ?*/) {
          const txs = await this.syncAccountTransactions(0);
          if (txs) {
            const units: Set<string> = new Set();
            txs.forEach(tx => {
              tx.inputs.forEach(input => {
                if (input.asset_list) {
                  input.asset_list.forEach(asset => {
                    units.add(asset.policy_id + asset.asset_name);
                  });
                }
              });
              tx.outputs.forEach(output => {
                if (output.asset_list) {
                  output.asset_list.forEach(asset => {
                    units.add(asset.policy_id + asset.asset_name);
                  });
                }
              });
            });
            await this.syncAssets(Array.from(units), false);
          }
        }
      }
      return [];
    }));

    // Wait for all promises to complete
    await Promise.all(promises);

    // Set the last sync info once everything is done
    await this.setLastSyncInfo(tip);
  }

  async syncAccountInfo(): Promise<any> {
    try {
      let res;
      if (this.isEnterpriseAddress()) {
        res = await this.api.getAccountInfo(this.baseAddress.toBech32());
      } else {
        res = await this.api.getAccountInfo(this.stakeAddress().toBech32());
      }
      if (res) {
        return await this.setAccountInfo(res);
      }
    } catch (e) {
      // console.log(e);
    }
  }

  async syncAccountRewards(): Promise<void> {
    try {
      if (this.isEnterpriseAddress()) {
        return;
      }
      const res = await this.api.getAccountRewards(this.stakeAddress().toBech32());
      if (res) {
        await this.setAccountRewards(res);
      }
    } catch (e) {
      // console.log(e);
    }
  }

  async syncAccountTransactions(height: number): Promise<any> {
    try {
      let res
      if (this.isEnterpriseAddress()) {
        res = await this.api.getAccountTransactions(this.baseAddress.toBech32(), height);
      } else {
        res = await this.api.getAccountTransactions(this.stakeAddress().toBech32(), height);
      }
      if (res && Array.isArray(res)) {
        const promises = [];
        const txHashes: string[] = res.map(tx => tx.tx_hash);
        const smallerArrays = chunkArray({ input: txHashes, bytesSize: 4000 });
        smallerArrays.forEach(smallerArray => {
          promises.push(this.api.getTransactionsInfo(smallerArray));
        });
        const txs = (await Promise.all(promises)).flat();
        await this.setAccountTransactions(txs);
        return txs;
      }
    } catch (e) {
      console.log(e);
    }
  }

  async syncAssets(units: string[], _force?: boolean): Promise<void> {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    await this.setAssets(units, blockchainDB);
  }

  async setAssets(units: string[], blockchainDB: Dexie) {
    const promises: any[] = [];
    const smallerArrays = chunkArray({ input: units, bytesSize: 4000 });
    smallerArrays.forEach(smallerArray => {
      promises.push(this.getAssetsInfo(smallerArray, blockchainDB));
    });
    (await Promise.all(promises)).flat();
  }

  private async getAssetsInfo(units: string[], blockchainDB: Dexie) {
    if (!units || units.length == 0) {
      return;
    }
    try {
      const assetsTable = blockchainDB.table('assets');
      const res = await this.api.getAssetsInfo(units);
      if (res) {
        assetsTable.bulkPut(res);
        return res;
      }
    } catch (e) {
      console.log(e);
    }
  }

  isEnterpriseAddress(): boolean {
    return this.baseAddress.getType() === Cardano.AddressType.EnterpriseScript;
  }

  public async getBlockchainDb(): Promise<Dexie> {
    const dbName = this.chain + '_' + this.network
    try {
      // Attempt to open the database
      const db: Dexie = new Dexie(dbName);
      return await db.open();
    } catch (error: DexieError | any) {
      console.log(error)
      if (error.name === 'NoSuchDatabaseError') {
        // Database does not exist, create it
        const db: Dexie = new Dexie(dbName);
        db.version(blockChainDBVersion).stores(blockChainDBSchema);
        return db.open();
      } else {
        // Handle other errors
        console.error('Error opening database:', error);
        return null
      }
    }
  }
}

export async function login(wallet: any): Promise<WalletBg> {
  const walletBg: WalletBg = new WalletBg(wallet);
  await walletBg.init();
  return walletBg;
}
