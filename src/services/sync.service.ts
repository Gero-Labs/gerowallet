import Dexie, { IndexableType, Table } from 'dexie';
import { Api } from '@/api/api';
import { Tip, Blockchain, Provider } from '@/models/types';
import LoadingState from '@/stores/loading';
import NetworkStore from '@/stores/networkStore';
import ablyService from '@/services/ably.service';
import networks from '@/utils/networks';
import { chunkArray } from 'array-chunk-by-size';
import { Serialization } from '@cardano-sdk/core';
import { AxiosResponse } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { WalletBg } from '@/chrome/walletBg';

/**
 * SyncService handles all wallet synchronization operations
 * Manages blockchain sync, account info, transactions, assets, and rewards
 */
export class SyncService {
  private walletBg: WalletBg | null = null;
  private api: Api;

  constructor(walletBg: any) {
    this.walletBg = walletBg;
    this.api = walletBg.api;
  }

  /**
   * Main sync method that handles tip synchronization
   * @param tip - Optional blockchain tip to sync to
   */
  async sync(tip?: Tip) {
    try {
      if (!tip) {
        tip = await this.api.getTip();
      }
      const lastSyncInfo = await this.walletBg.getLastSyncInfo();
      if (!lastSyncInfo) {
        LoadingState.setRestoring(true);
        await this.walletBg.restore(tip);
      } else if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
        const promises = [];
        promises.push(this.syncGenesis());
        if (!this.walletBg.isEnterpriseAddress()) {
          if (networks.resolveStakingSupport(this.walletBg.chain, this.walletBg.network)) {
            promises.push(this.syncTable(1)); // Sync Staking Pools
          }
          if (networks.resolveGovernanceSupport(this.walletBg.chain, this.walletBg.network)) {
            promises.push(this.syncTable(2)); // Sync DReps
          }
        }
        if (promises.length > 0) {
          await Promise.all(promises);
        }
        const prevAccountInfo = await this.walletBg.getAccountInfo();
        const from = !lastSyncInfo ? 0 : lastSyncInfo['height']
        let address: string;
        if (this.walletBg.isEnterpriseAddress()) {
          address = this.walletBg.baseAddress;
        } else {
          address = this.walletBg.stakeAddress;
        }
        const rewards_sum = prevAccountInfo?.rewards_sum ? prevAccountInfo?.rewards_sum : "0";
        const controlled_amount = prevAccountInfo?.controlled_amount ? prevAccountInfo?.controlled_amount : "0";
        const withdrawable_amount = prevAccountInfo?.withdrawable_amount ? prevAccountInfo?.withdrawable_amount : "0";

        const epoch = await this.walletBg.getEpochProtocolIfNotExists(tip.epoch)
        console.debug("Epoch: ", epoch) // TODO new Epoch Animation

        await ablyService.publishToSyncChannel(this.walletBg.chain, this.walletBg.network, {
          chain: this.walletBg.chain,
          network: this.walletBg.network,
          provider: Provider[this.walletBg.provider],
          from,
          to: tip,
          address,
          rewards_sum,
          controlled_amount,
          withdrawable_amount,
          epoch,
        });
      }
    } catch (err) {
      console.log(err);
    }
  }

  /**
   * Resync wallet by clearing sync data and starting fresh
   */
  async resync() {
    const promises = []
    promises.push(this.walletBg.getDb()
      .then(db => {
        const syncTable = db.table('sync');
        syncTable.clear();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      }));
    promises.push(this.walletBg.getDb()
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

  /**
   * Process sync object received from sync channel
   * @param syncObject - Sync data object containing various blockchain data
   */
  async setSync(syncObject) {
    if (syncObject && syncObject.success) {
      const promises: any[] = [];
      if (syncObject.account) {
        promises.push(this.walletBg.setAccountInfo(syncObject.account));
      }
      if (syncObject.assets) {
        promises.push(this.walletBg.setAssets2(syncObject.assets));
      }
      if (syncObject.rewards) {
        promises.push(this.walletBg.setAccountRewards(syncObject.rewards));
      }
      if (syncObject.transactions) {
        promises.push(this.walletBg.setAccountTransactions(syncObject.transactions));
      }
      if (syncObject.epoch_params) {
        promises.push(this.walletBg.setEpochParams(syncObject.epoch_params));
      }
      if (syncObject.block) {
        promises.push(this.walletBg.setLastSyncInfo(syncObject.block));
      }
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      console.log('setSync', syncObject);
      NetworkStore.setTip({
        blockNo: syncObject.block.height,
        slot: syncObject.block.slot,
        hash: syncObject.block.hash,
        time: syncObject.block.time * 1000,
        epoch: syncObject.block.epoch,
        epoch_slot: syncObject.block.epoch_slot,
      });
    }
  }

  /**
   * Sync specific blockchain table (pools or DReps)
   * @param tableId - Table identifier (1 for pools, 2 for DReps)
   */
  async syncTable(tableId): Promise<void> {
    if (this.walletBg.chain == Blockchain.CARDANO || this.walletBg.chain == Blockchain.APEX_PRIME) {
      const blockchainDB: Dexie = await this.walletBg.getBlockchainDb();
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

  /**
   * Set sync table data for pools or DReps
   * @param blockchainDB - Blockchain database instance
   * @param syncTable - Sync table record
   * @param tableId - Table identifier
   */
  async setSyncTable(blockchainDB: Dexie, syncTable, tableId: number) {
    let res;
    let table;
    if (tableId == 1) {
      res = await this.getStakingPools();
      table = 'pools'
    } else if (tableId == 2) {
      res = await this.getDReps();
      table = 'dreps'
    }
    if (res) {
      blockchainDB.table(table).bulkPut(res);
      const syncTablesTable = blockchainDB.table('sync_tables') || blockchainDB.table('sync');
      syncTablesTable.put({ id: tableId, time: new Date().getTime() });
    }
  }

  /**
   * Sync genesis block information
   */
  async syncGenesis(): Promise<void> {
    if (this.walletBg.chain == Blockchain.CARDANO || this.walletBg.chain == Blockchain.APEX_PRIME) {
      const blockchainDB: Dexie = await this.walletBg.getBlockchainDb();
      const genesisTable = blockchainDB.table('genesis_info');
      const genesisArray = await genesisTable.toArray();
      if (genesisArray.length === 0) {
        try {
          const res = await this.api.getGenesis();
          if (res.status === 200) {
            await genesisTable.put({ id: 0, ...res.data });
            NetworkStore.setGenesis(res.data)
          } else {
            console.log(res.status)
            console.warn(parseHttpError(res))
          }
        } catch (error) {
          console.error(error);
        }
      }
    }
  }

  /**
   * Sync account information
   */
  async syncAccountInfo(): Promise<any> {
    try {
      let res;
      if (this.walletBg.isEnterpriseAddress()) {
        res = await this.api.getAccountInfo(this.walletBg.baseAddress);
      } else {
        res = await this.api.getAccountInfo(this.walletBg.stakeAddress);
      }
      if (res) {
        return await this.walletBg.setAccountInfo(res);
      }
    } catch (e) {
      // console.log(e);
    }
  }

  /**
   * Sync account rewards
   */
  async syncAccountRewards(): Promise<void> {
    try {
      if (this.walletBg.isEnterpriseAddress()) {
        return;
      }
      const res = await this.api.getAccountRewards(this.walletBg.stakeAddress);
      if (res) {
        await this.walletBg.setAccountRewards(res);
      }
    } catch (e) {
      // console.log(e);
    }
  }

  /**
   * Sync account transactions from a specific height
   * @param height - Block height to sync from
   */
  async syncAccountTransactions(height: number): Promise<any> {
    try {
      let res;
      if (this.walletBg.isEnterpriseAddress()) {
        res = await this.api.getAccountTransactions(this.walletBg.baseAddress, height);
      } else {
        res = await this.api.getAccountTransactions(this.walletBg.stakeAddress, height);
      }
      if (res && Array.isArray(res)) {
        const promises = [];
        const txHashes: string[] = res.map(tx => tx.tx_hash);
        const smallerArrays: string[][] = chunkArray({ input: txHashes, bytesSize: 4000 });
        smallerArrays.forEach(smallerArray => {
          promises.push(this.api.getTransactionsCbor(smallerArray).then(txCborsResult => {
            if (txCborsResult.status == 200) {
              return txCborsResult.data.map(txCbor => {
                const txDeserialized = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(txCbor.cbor));
                return {
                  utxo: txCbor.utxo,
                  block_hash: txCbor.block_hash,
                  block_height: txCbor.block_height,
                  epoch_no: txCbor.epoch_no,
                  absolute_slot: txCbor.absolute_slot,
                  tx_timestamp: txCbor.tx_timestamp,
                  tx_size: txCbor.tx_size,
                  cbor: txCbor.cbor,
                  ...txDeserialized,
                }
              })
            }
          }))
        })
        const txsCborResults = (await Promise.all(promises)).flat();
        await this.walletBg.setAccountTransactions(txsCborResults);
        return txsCborResults;
      }
    } catch (e) {
      console.log(e);
    }
  }

  /**
   * Sync assets information
   * @param uniqueUnits - Array of unique asset units to sync
   */
  async syncAssets(uniqueUnits: string[]): Promise<void> {
    if (!uniqueUnits || uniqueUnits.length === 0) {
      return;
    }

    const blockchainDB: Dexie = await this.walletBg.getBlockchainDb();
    const assetsTable: Table<any, IndexableType, any> = blockchainDB.table('assets');
    const existingRows = await assetsTable.bulkGet(uniqueUnits);
    const units = uniqueUnits.filter((unit, idx) => !existingRows[idx]);
    const promises: any[] = [];
    const smallerArrays: string[][] = chunkArray({ input: units, bytesSize: 4000 });
    smallerArrays.forEach((smallerArray: string[]) => {
      promises.push(this.getAssetsInfo(smallerArray));
    });
    const resAll = await Promise.all(promises);
    const assets = resAll.flat().filter(res => res)
    assetsTable.bulkPut(assets);
  }

  /**
   * Sync key information for known addresses
   * @param knownAddresses - Array of known addresses to sync keys for
   */
  async syncKeys(knownAddresses: string[]): Promise<any> {
    if (!knownAddresses || knownAddresses.length === 0) {
      return null;
    }

    let resolvedKeys: any = {};
    try {
      const db: any = await this.walletBg.getDb();
      const addressesTable = db.table('addresses');
      if (!addressesTable) {
        throw new Error('No Addresses Table.');
      }
      resolvedKeys = this.walletBg.resolvePathsForMissingAddresses(knownAddresses);
      await db.transaction('rw', addressesTable, async () => {
        await addressesTable.clear();
        await addressesTable.put({
          address: this.walletBg.publicKey,
          resolvedKeys
        });
      });
      return resolvedKeys;
    } catch (err) {
      console.error(`Failed to open database: ${err}`);
      return resolvedKeys;
    }
  }

  /**
   * Get assets information for specific units
   */
  async getAssetsInfo(units: string[]) {
    if (!units || units.length == 0) {
      return null;
    }
    try {
      const res: AxiosResponse = await this.api.getAssetsInfo(units);
      if (res.status === 200 && res.data.length > 0) {
        console.log(res.data);
        return res.data;
      }
    } catch (e) {
      console.log(e);
    }
    return null;
  }

  /**
   * Get staking pools data
   */
  async getStakingPools() {
    try {
      const res = await this.api.getAllPools();
      if (res) {
        return res;
      }
    } catch (e) {
      console.log(e);
    }
    return null;
  }

  /**
   * Get DReps (Delegated Representatives) data
   */
  async getDReps() {
    try {
      const res = await this.api.getAllDReps();
      if (res) {
        return res;
      }
    } catch (e) {
      console.log(e);
    }
    return null;
  }
}

export default SyncService;
