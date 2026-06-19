import Dexie, { IndexableType, Table } from 'dexie';
import { Api } from '@/api/api';
import { Tip, Blockchain, Provider, Network } from '@/models/types';
import LoadingState from '@/stores/loading';
import NetworkStore from '@/stores/networkStore';
import { chunkArray } from 'array-chunk-by-size';
import { Serialization, Cardano } from '@cardano-sdk/core';
import { AxiosResponse } from 'axios';
import { parseHttpError } from '@/shared/utils/parser';
import { WalletBg } from '@/chrome/walletBg';
import { debugLog } from '@/utils/debug';
import blockchainApi from '@/api/blockchain-api';
import webSocketService from '@/services/websocket.service';
import WalletStore from '@/stores/walletStore';

/**
 * SyncService handles all wallet synchronization operations
 * Manages blockchain sync, account info, transactions, assets, and rewards
 */
export class SyncService {
  private walletBg: WalletBg | null = null;
  private api: Api;

  constructor(walletBg: WalletBg) {
    this.walletBg = walletBg;
    this.api = walletBg.api;
  }

  /**
   * Main sync method that handles tip synchronization
   * @param tip - Optional blockchain tip to sync to
   */
  async sync(tip?: Tip) {
    // Bitcoin wallets don't use the Gero backend sync service
    if (this.walletBg?.chain === Blockchain.BITCOIN) {
      return;
    }

    try {
      if (!tip) {
        tip = await this.api.getTip();
      }
      const lastSyncInfo = await this.walletBg.getLastSyncInfo();
      if (!lastSyncInfo) {
        LoadingState.setRestoring(true);
        try {
          await this.walletBg.restore(tip);
        } finally {
          LoadingState.setRestoring(false);
        }
      } else if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
        const promises = [];
        promises.push(this.syncGenesis());
        if (promises.length > 0) {
          await Promise.all(promises);
        }
        const prevAccountInfo = await this.walletBg.getAccountInfo();
        const latestTxBlockHeight = await this.getLatestTransactionBlockHeight();
        const from = latestTxBlockHeight + 1 || 0
        let address: string;
        if (this.walletBg.isEnterpriseAddress() || this.walletBg.type == 'Google') {
          address = this.walletBg.baseAddress;
        } else {
          address = this.walletBg.stakeAddress;
        }
        const rewards_sum = prevAccountInfo?.rewards_sum ? prevAccountInfo?.rewards_sum : "0";
        const controlled_amount = prevAccountInfo?.controlled_amount ? prevAccountInfo?.controlled_amount : "0";
        const withdrawable_amount = prevAccountInfo?.withdrawable_amount ? prevAccountInfo?.withdrawable_amount : "0";

        const epoch = await this.walletBg.getEpochProtocolIfNotExists(tip.epoch)
        const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === this.walletBg.chain);
        const networkEnum: string = Object.keys(Network).find(key => Network[key] === this.walletBg.network);

        // Use REST API instead of Ably publish to avoid rate limiting
        // (Multiple wallet instances publishing to same Ably channel causes 429 errors)
        const syncResponse = await blockchainApi.syncRest({
          chain: chainEnum,
          network: networkEnum,
          provider: Provider[this.walletBg.provider],
          from,
          to: tip,
          address,
          rewards_sum,
          controlled_amount,
          withdrawable_amount,
          epoch,
        });

        // Process the sync response immediately
        if (syncResponse && syncResponse.success) {
          await this.setSync(syncResponse);
        } else {
          console.error('Sync failed: REST sync returned unsuccessful response', {
            success: syncResponse?.success,
            address,
            from,
            toHeight: tip.height,
          });
        }
      }
    } catch (err) {
      debugLog(err);
    }
  }

  /**
   * Perform a fast REST sync to get latest blockchain data immediately
   * This is useful during wallet login to prevent tip-related errors
   * @param tip - Optional blockchain tip to sync to
   */
  async syncViaRest(tip?: Tip) {
    // Bitcoin wallets don't use the Gero backend sync service
    if (this.walletBg?.chain === Blockchain.BITCOIN) {
      return;
    }

    try {
      if (!tip) {
        tip = await this.api.getTip();
      }

      const lastSyncInfo = await this.walletBg.getLastSyncInfo();
      if (!lastSyncInfo) {
        LoadingState.setRestoring(true);
        try {
          await this.walletBg.restore(tip);
        } finally {
          LoadingState.setRestoring(false);
        }
        return;
      }

      // Only sync if tip is newer
      if (tip.height <= lastSyncInfo['height']) {
        debugLog('syncViaRest: Tip is not newer, skipping sync');

        // IMPORTANT: Even if we skip sync, we MUST set the tip in NetworkStore
        // to prevent "Cannot read properties of null (reading 'slot')" errors
        NetworkStore.setTip({
          blockNo: tip.height,
          slot: tip.slot,
          hash: tip.hash,
          time: tip.time ? tip.time * 1000 : undefined,
          epoch: tip.epoch,
          epoch_slot: tip.epoch_slot || 0,
        });
        return;
      }

      const promises = [];
      promises.push(this.syncGenesis());
      if (promises.length > 0) {
        await Promise.all(promises);
      }

      const prevAccountInfo = await this.walletBg.getAccountInfo();
      const latestTxBlockHeight = await this.getLatestTransactionBlockHeight();
      const from = latestTxBlockHeight + 1 || 0;
      let address: string;
      if (this.walletBg.isEnterpriseAddress() || this.walletBg.type == 'Google') {
        address = this.walletBg.baseAddress;
      } else {
        address = this.walletBg.stakeAddress;
      }
      const rewards_sum = prevAccountInfo?.rewards_sum ? prevAccountInfo?.rewards_sum : "0";
      const controlled_amount = prevAccountInfo?.controlled_amount ? prevAccountInfo?.controlled_amount : "0";
      const withdrawable_amount = prevAccountInfo?.withdrawable_amount ? prevAccountInfo?.withdrawable_amount : "0";

      const epoch = await this.walletBg.getEpochProtocolIfNotExists(tip.epoch);
      const chainEnum: string = Object.keys(Blockchain).find(key => Blockchain[key] === this.walletBg.chain);
      const networkEnum: string = Object.keys(Network).find(key => Network[key] === this.walletBg.network);

      const syncResponse = await blockchainApi.syncRest({
        chain: chainEnum,
        network: networkEnum,
        provider: Provider[this.walletBg.provider],
        from,
        to: tip,
        address,
        rewards_sum,
        controlled_amount,
        withdrawable_amount,
        epoch,
      });
      // Process the sync response
      if (syncResponse && syncResponse.success) {
        await this.setSync(syncResponse);
      } else {
        console.warn('REST sync returned unsuccessful response:', syncResponse);
      }
    } catch (err) {
      console.error('syncViaRest error:', err);
      debugLog(err);
    }
  }

  /**
   * Resync wallet by clearing sync data and triggering full catch-up via gero-sync.
   * Clears transactions, sync checkpoint, and account tables, then resubscribes
   * with lastSyncedBlock=0 so gero-sync fetches everything from Nexus.
   */
  async resync() {
    debugLog('Resync: refreshing UTxOs and account from server');
    const startTime = Date.now();
    LoadingState.setRestoring(true);
    LoadingState.setProgress(5);
    LoadingState.setText('Syncing wallet data...');
    try {
      if (this.walletBg) {
        const db = await this.walletBg.getDb();
        const txTable = db.table('transactions');
        if (txTable) {
          await txTable.clear();
          debugLog('Resync: cleared transactions table');
        }
      }

      if (webSocketService.isConnected()) {
        webSocketService.pauseSyncCheck();
        const syncPromise = webSocketService.waitForSync();
        webSocketService.resubscribe(0);
        await syncPromise;
        webSocketService.resumeSyncCheck();
        // Ensure overlay is visible for at least 1.5s
        const elapsed = Date.now() - startTime;
        if (elapsed < 1500) {
          await new Promise(r => setTimeout(r, 1500 - elapsed));
        }
        debugLog('Resync: complete');
      } else {
        debugLog('Resync: WebSocket not connected, falling back to REST sync');
        await this.sync();
      }
    } catch (err) {
      console.error('Resync error:', err);
    } finally {
      LoadingState.setProgress(0);
      LoadingState.setRestoring(false);
      LoadingState.setText('');
    }
  }

  /**
   * Handle a chain rollback by deleting transactions above the rollback point
   * and resetting the sync checkpoint.
   */
  async handleRollback(rollbackToSlot: number): Promise<void> {
    debugLog(`Handling rollback to slot ${rollbackToSlot}`);

    const db = await this.walletBg.getDb();

    // Delete transactions that are above the rollback point
    const txTable = db.table('transactions');
    const allTxs = await txTable.toArray();
    const invalidTxIds = allTxs
      .filter((tx: any) => tx.absolute_slot && tx.absolute_slot > rollbackToSlot)
      .map((tx: any) => tx.id);

    if (invalidTxIds.length > 0) {
      await txTable.bulkDelete(invalidTxIds);
      debugLog(`Deleted ${invalidTxIds.length} invalidated transactions`);
    }

    // Reset sync checkpoint to before the rollback point
    // gero-sync will push new fork blocks via normal SYNC flow
    const syncInfo = await this.walletBg.getLastSyncInfo();
    if (syncInfo && syncInfo.slot > rollbackToSlot) {
      await db.table('sync').put({
        id: 1,
        height: 0,
        hash: '',
        slot: rollbackToSlot,
        time: syncInfo.time,
        epoch: syncInfo.epoch,
        epoch_slot: 0,
      });
      debugLog(`Reset sync checkpoint to slot ${rollbackToSlot}`);
    }
  }

  /**
   * Process sync object received from sync channel
   * @param syncObject - Sync data object containing various blockchain data
   */
  async setSync(syncObject) {
    if (syncObject && (syncObject.success || syncObject.type === 'SYNC')) {
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
      // Wire server-provided addresses from CATCH_UP_COMPLETE for key derivation
      if (syncObject.addresses && Array.isArray(syncObject.addresses) && syncObject.addresses.length > 0) {
        promises.push(this.syncKeys(syncObject.addresses));
      }
      // Check if server addresses exceed our credential range — resubscribe if needed
      if (syncObject.addresses && Array.isArray(syncObject.addresses)) {
        const expanded = this.walletBg.expandCredentialsIfNeeded(syncObject.addresses);
        if (expanded) {
          debugLog(`🔄 Resubscribing with expanded credentials (${expanded.length})`);
          webSocketService.resubscribe(0, expanded);
          return; // resubscribe will trigger a new catch-up with the full credential set
        }
      }
      // Apply server-provided UTxOs — set on store, resolve assets, persist to DB
      if (syncObject.utxos && Array.isArray(syncObject.utxos)) {
        const converted = this.convertNexusUtxos(syncObject.utxos);
        debugLog(`Applying ${converted.length} server UTxOs`);
        promises.push(this.walletBg.applyUtxos(converted, true));
      }
      if (promises.length > 0) {
        await Promise.all(promises);
      }
      debugLog('setSync', syncObject);
      if (syncObject.block) {
        NetworkStore.setTip({
          blockNo: syncObject.block.height,
          slot: syncObject.block.slot,
          hash: syncObject.block.hash,
          time: syncObject.block.time ? syncObject.block.time * 1000 : undefined,
          epoch: syncObject.block.epoch,
          epoch_slot: syncObject.block.epoch_slot || 0,
        });
      }
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
            debugLog(res.status)
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
        return this.walletBg.setAccountInfo(res);
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
        const txMap: Map<string, any> = res.reduce((map, tx: any) => {
          map.set(tx.tx_hash, tx);
          return map;
        }, new Map<string, any>());
        const promises = [];
        const txHashes: string[] = res.map(tx => tx.tx_hash);
        const smallerArrays: string[][] = chunkArray({ input: txHashes, bytesSize: 4000 });
        smallerArrays.forEach(smallerArray => {
          promises.push(this.api.getTransactionsCbor(smallerArray).then(txCborsResult => {
            if (txCborsResult.status == 200) {
              return txCborsResult.data.map((txCbor: any) => {
                let txDeserialized: Cardano.Tx | {} = {};
                if (txCbor.cbor) {
                  txDeserialized = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(txCbor.cbor));
                }
                const tx = txMap.get(txCbor.tx_hash);
                return {
                  tx_hash: txCbor.tx_hash,
                  utxo: txCbor.utxo,
                  block_hash: txCbor.block_hash,
                  block_height: txCbor.block_height || tx.block_height,
                  epoch_no: txCbor.epoch_no,
                  absolute_slot: txCbor.absolute_slot,
                  tx_timestamp: txCbor.tx_timestamp || tx.block_time,
                  tx_size: txCbor.tx_size,
                  cbor: txCbor.cbor,
                  pending: false, // Transactions from blockchain are confirmed (not pending)
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
      debugLog(e);
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
        console.error('syncKeys error - No Addresses Table');
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
      WalletStore.setKeys(resolvedKeys);
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
        debugLog(res.data);
        return res.data;
      }
    } catch (e) {
      debugLog(e);
    }
    return null;
  }

  /**
   * Get the block height of the latest transaction
   * @returns The latest transaction's block height, or 0 if no transactions exist
   */
  async getLatestTransactionBlockHeight(): Promise<number> {
    try {
      const db = await this.walletBg.getDb();
      const transactionsTable = db.table('transactions');

      if (!transactionsTable) {
        return 0;
      }

      // Get all transactions and find the one with the highest block_height
      const transactions = await transactionsTable.toArray();

      if (!transactions || transactions.length === 0) {
        return 0;
      }

      // Find the transaction with the maximum block_height
      const latestTx = transactions.reduce((latest, current) => {
        return (current.block_height || 0) > (latest.block_height || 0) ? current : latest;
      });

      const blockHeight = latestTx.block_height || 0;
      debugLog(`Latest transaction block height: ${blockHeight}`);
      return blockHeight;

    } catch (e) {
      debugLog('Error getting latest transaction block height:', e);
      return 0;
    }
  }

  /**
   * Convert Nexus UTxO format to Cardano.Utxo[] (TxIn/TxOut tuples).
   * Nexus: {txHash, txIndex, address, value, assetList, datumHash, inlineDatum, referenceScript}
   * Wallet: [[{txId, index, address}, {address, value: {coins, assets}, datumHash, datum, scriptReference}]]
   */
  private convertNexusUtxos(nexusUtxos: any[]): Cardano.Utxo[] {
    const result: Cardano.Utxo[] = [];
    for (const u of nexusUtxos) {
      try {
        const txHash = u.txHash || u.tx_hash;
        const txIndex = u.txIndex ?? u.tx_index ?? u.output_index ?? 0;
        const address = u.address || u.owner_addr;
        const lovelace = BigInt(u.value || u.lovelace_amount || '0');

        // Build assets map from assetList
        const assets = new Map<Cardano.AssetId, bigint>();
        const assetList = u.assetList || u.assets || u.amounts || [];
        for (const a of assetList) {
          const unit = a.unit || (a.policyId && a.assetName ? a.policyId + a.assetName : null);
          if (unit && unit !== 'lovelace') {
            assets.set(Cardano.AssetId(unit), BigInt(a.quantity || '0'));
          }
        }

        const txIn: Cardano.HydratedTxIn = {
          txId: Cardano.TransactionId(txHash),
          index: txIndex,
          address: address as Cardano.PaymentAddress,
        };

        const txOut: Cardano.TxOut = {
          address: address as Cardano.PaymentAddress,
          value: {
            coins: lovelace,
            assets: assets.size > 0 ? assets : undefined,
          },
          datumHash: u.datumHash || undefined,
          datum: u.inlineDatum || undefined,
          scriptReference: u.referenceScript || undefined,
        };

        result.push([txIn, txOut]);
      } catch (e) {
        debugLog('Failed to convert Nexus UTxO:', e, u);
      }
    }
    return result;
  }
}

export default SyncService;
