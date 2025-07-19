import { Mutex, withTimeout } from 'async-mutex';
import Dexie, { DexieError, IndexableType, liveQuery, Subscription, Table } from 'dexie';
import { Api } from '@/api/api';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519PublicKey, Hash28ByteBase16 } from '@cardano-sdk/crypto'
import networks from '@/utils/networks';
import { blockChainDBSchema, blockChainDBVersion, walletDBSchema, walletDBVersion } from '@/db/schema';
import {
  Blockchain,
  ChainDerivations,
  Network,
  Provider,
  purpose,
  coin_type,
  Tip,
  WalletType,
  BIP44_SCAN_SIZE,
} from '@/models/types';
import zkFoldApi from '@/api/zk-fold.api';
import {
  getAddress, getCcColdKey, getCcHotKey, getCip105DrepId, getCip129DrepId, getDrepKey,
  getPublicKey,
  getRewardAddress,
  getStakeKey,
  keyHashFromAddress, toStakeAddress,
} from '@/chrome/serialization';
import * as Ably from 'ably';
import { AxiosResponse } from 'axios';
import LoadingState from '@/plugins/loading';
import { chunkArray } from 'array-chunk-by-size';
import { STORAGE } from '@/chrome/config';
import WalletStore from '@/plugins/walletStore';
import NetworkStore from '@/plugins/networkStore';
import DexHunterStore from '@/plugins/dexHunterStore';
import XerberusStore from '@/plugins/xerberusStore';
import { resolveAsset, findCollectionDescription, findCollectionName, longestCommonStartingSubstring } from '@/shared/utils/resolver';
import RealFiStore from '@/plugins/realFiStore';
import { parseHttpError } from '@/shared/utils/parser';
import TapToolsStore from '@/plugins/tapToolsStore';
import CoinGeckoStore from '@/plugins/coinGeckoStore';
import MusicStore from '@/plugins/musicStore';
import ablyService from '@/services/ably.service';
import BringStore from '@/plugins/bringStore';

interface WhitelistedEntry {
  domain: string;
  id: number;
}

let blockchainDb: Dexie = null;

export class WalletBg {
  api: Api;
  private tipMutex = withTimeout(new Mutex(), 2 * 60_000);
  private syncMutex = withTimeout(new Mutex(), 2 * 60_000);

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
  baseAddress: string;
  stakeAddress?: string;
  token?: string;
  subscriptions: Map<string, Subscription> = new Map<string, Subscription>();

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
    this.provider = networks.resolveDefaultProvider(this.chain, this.network)
    this.api = new Api(wallet, this.provider);
    this.baseAddress = getAddress(this.publicKey, this.chain, this.network, 0).toBech32();
    this.stakeAddress = getRewardAddress(this.publicKey, this.chain, this.network).toBech32()
  }

  async init(): Promise<void> {
    LoadingState.setText('Setting up wallet address...');
    const promises = []
    if (this.type === WalletType.Google) {
      promises.push(zkFoldApi.walletAddress(this.userId).then(res => {
        if (res['status'] !== 200) {
          throw new Error('Failed to get address');
        }
        this.baseAddress = res['data']['address']
      }))
    }

    LoadingState.setText('Loading blockchain data...');
    this.loadGenesis()
    const promises2: any[] = []
    promises2.push(this.loadAssets(), this.loadEpochParams())
    if (networks.resolveStakingSupport(this.chain, this.network)) {
      promises2.push(this.loadPools())
      promises2.push(this.loadRewards())
    }
    if (networks.resolveSwapSupport(this.chain, this.network)) {
      promises2.push(this.loadDReps())
    }
    if (networks.resolveSwapSupport(this.chain, this.network)) {
      promises2.push(DexHunterStore.loadTokens())
      promises2.push(DexHunterStore.loadBlacklistPolicies())
    }
    if (networks.resolveCashbackSupport(this.chain, this.network)) {
      promises2.push(BringStore.loadBringCache(this.baseAddress))
    }
    await Promise.all(promises2)

    LoadingState.setText('Loading wallet data...');
    promises.push(
      this.startSync(),
      this.loadConfig(),
      this.loadAccount(),
      this.loadContacts(),
      this.loadConnectedDapps(),
      this.loadTransactions(),
    )

    const chain = Object.keys(Blockchain).find(key => Blockchain[key] === this.chain);
    const network = Object.keys(Network).find(key => Network[key] === this.network);
    let address: string;
    if (this.isEnterpriseAddress()) {
      address = this.baseAddress;
    } else {
      address = this.stakeAddress;
    }

    console.log('🔍 Wallet initialization debug:', {
      chain,
      network,
      address,
      baseAddress: this.baseAddress,
      stakeAddress: this.stakeAddress,
      isEnterpriseAddress: this.isEnterpriseAddress()
    });

    console.log('🔐 Setting up Ably service:', { chain, network, address });
    ablyService.setAuthParams(chain, network, address);
    ablyService.setApi(this.api);
    console.log('📡 Connecting to Ably service...');
    ablyService.connect();

    promises.push(
      ablyService.subscribeToPrivateChannel(address, {
        onSync: async (msg: Ably.InboundMessage) => {
          console.log('🔄 SYNC message received on private channel!', msg);
          try {
            if (this.syncMutex.isLocked()) {
              console.log('⏳ Sync mutex is locked, skipping');
              return;
            }
            this.syncMutex.runExclusive(async () => {
              LoadingState.setText('');
              LoadingState.setConnected(true);
              LoadingState.setSyncing(true);
              const syncObject = JSON.parse(msg.data);
              console.log('📊 Processing sync object:', syncObject);
              if (!ablyService.isTipProcessed(syncObject.block.hash)) {
                ablyService.markTipAsProcessed(syncObject.block.hash);
              }
              await this.setSync(syncObject);
              LoadingState.setSyncing(false);
            });
          } catch (e) {
            console.error('❌ Error processing sync message:', e);
          } finally {
            LoadingState.setRestoring(false);
          }
        },
        onMessage: async (msg: Ably.InboundMessage) => {
          console.log('📬 General message received on private channel:', msg);
        }
      })
    );

    // Subscribe to group channel
    promises.push(
      ablyService.subscribeToGroupChannel(chain, network, {
        onTip: async (msg: Ably.InboundMessage) => {
          try {
            if (this.tipMutex.isLocked()) {
              console.log('⏳ Tip mutex is locked, skipping');
              return;
            }
            const tip = JSON.parse(msg.data)?.data as Tip;
            console.log('TIP', tip);
            if (ablyService.isTipProcessed(tip.hash) || !tip.epoch) {
              return;
            }
            this.tipMutex.runExclusive(() => {
              this.sync(tip);
            })
              .catch(err => {
                console.error('TIP processing failed', err);
              });
          } catch (e) {
            console.error(e);
          }
        }
      })
    );

    // Wait for all initialization promises to complete
    LoadingState.setText('Finalizing wallet setup...');
    await Promise.all(promises);

    LoadingState.setText('Wallet initialization complete');
    LoadingState.setLoading(false);
    LoadingState.setText('');
  }

  unsubscribeAll() {
    Array.from(this.subscriptions.values()).forEach(sub => {
      sub.unsubscribe();
    })
    this.subscriptions.clear();
  }

  async logout() {
    console.log('logout')
    if (chrome.alarms.onAlarm.hasListeners()) {
      chrome.alarms.onAlarm.removeListener(alarmListener);
    }
    this.unsubscribeAll();
    ablyService.unsubscribeAll();
    await Promise.all([
      chrome.storage.local.set({ [STORAGE.utxos]: new Map<string, [Cardano.TxIn, Cardano.TxOut]>() }),
      chrome.storage.local.set({ [STORAGE.addresses]: new Set() }),
    ])
    ablyService.close();
    WalletStore.logout();
  }

  networkId(): number {
    return networks.resolveNetworkId(this.chain, this.network);
  }

  async sync(tip?: Tip) {
    try {
      if (!tip) {
        tip = await this.api.getTip();
      }
      const lastSyncInfo = await this.getLastSyncInfo();
      if (!lastSyncInfo) {
        // loading.setText('Restoring Wallet Data. Please Wait ...')
        LoadingState.setRestoring(true);
        await this.restore(tip);
      } else if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
        const promises = [];
        promises.push(this.syncGenesis());
        if (!this.isEnterpriseAddress()) {
          if (networks.resolveStakingSupport(this.chain, this.network)) {
            promises.push(this.syncTable(1)); // Sync Staking Pools
          }
          if (networks.resolveGovernanceSupport(this.chain, this.network)) {
            promises.push(this.syncTable(2)); // Sync DReps
          }
        }
        if (promises.length > 0) {
          await Promise.all(promises);
        }
        const prevAccountInfo = await this.getAccountInfo();
        const from = !lastSyncInfo ? 0 : lastSyncInfo['height']
        let address: string;
        if (this.isEnterpriseAddress()) {
          address = this.baseAddress;
        } else {
          address = this.stakeAddress;
        }
        const rewards_sum = prevAccountInfo?.rewards_sum ? prevAccountInfo?.rewards_sum : "0";
        const controlled_amount = prevAccountInfo?.controlled_amount ? prevAccountInfo?.controlled_amount : "0";
        const withdrawable_amount = prevAccountInfo?.withdrawable_amount ? prevAccountInfo?.withdrawable_amount : "0";

        const epoch = await this.getEpochProtocolIfNotExists(tip.epoch)
        console.debug("Epoch: ", epoch) // TODO new Epoch Animation

        await ablyService.publishToSyncChannel(this.chain, this.network, {
          chain: this.chain,
          network: this.network,
          provider: Provider[this.provider],
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

  async resync() {
    const promises = []
    promises.push(this.getDb()
      .then(db => {
        const syncTable = db.table('sync');
        syncTable.clear();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      }));
    promises.push(this.getDb()
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
    if (syncObject && syncObject.success) {
      const promises: any[] = [];
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
      if (syncObject.epoch_params) {
        promises.push(this.setEpochParams(syncObject.epoch_params));
      }
      if (syncObject.block) {
        promises.push(this.setLastSyncInfo(syncObject.block));
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

  public async loadPools() {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    return new Promise((resolve, _reject) => {
      this.subscriptions.set('pools', liveQuery(() => blockchainDB.table('pools').toArray())
        .subscribe({
          next: pools => {
            const map = pools.reduce((map: Record<string, any>, pool: any) => {
              map[pool.pool_id_bech32] = pool;
              return map;
            }, {});
            NetworkStore.setPools(map)
            resolve(pools)
          }
      }));
    })
  }

  public async loadRewards() {
    const db: Dexie = await this.getDb();
    return new Promise((resolve, _reject) => {
      this.subscriptions.set('rewards', liveQuery(() => db.table('rewards').orderBy("epoch").toArray())
        .subscribe({
          next: newRewards => {
            WalletStore.setRewards(newRewards)
            resolve(newRewards)
          }
        }));
    })
  }

  public async loadDReps() {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    return new Promise((resolve, _reject) => {
      this.subscriptions.set('dreps', liveQuery(() => blockchainDB.table('dreps').toArray())
        .subscribe({
          next: dreps => {
            const map = dreps.reduce((map: Record<string, any>, drep: any) => {
              map[drep.drep_id] = drep;
              return map;
            }, {});
            NetworkStore.setDReps(map)
            resolve(dreps)
          }
        }));
    })
  }

  public async loadConfig() {
    const walletDB: Dexie = await this.getDb();
    return new Promise((resolve, _reject) => {
      this.subscriptions.set('config', liveQuery(() => walletDB.table('config').toArray()).subscribe({
        next: config => {
          console.log('setWalletConfig', config)
          WalletStore.setConfig(config.reduce(function(map, val) {
            map[val.key] = val.value
            return map
          }, {}));
          resolve(config)
        }
      }));
    })
  }

  public async loadEpochParams() {
    const blockchainDb: Dexie = await this.getBlockchainDb();
    return new Promise((resolve, _reject) => {
      this.subscriptions.set('epoch_params', liveQuery(() => blockchainDb.table('epoch_params').orderBy('epoch').last()).subscribe({
        next: (epochParams: any) => {
          console.log('🔍 Epoch params received:', epochParams);
          let defaultEpochParams;
          if (!epochParams) {
            defaultEpochParams = networks.resolveNetwork(this.chain, this.network).protocolParams
          }
          try {
            const protocolParametersByron = {
              maxTxSize: epochParams?.max_tx_size || defaultEpochParams.max_tx_size,
            };
            const newProtocolParamsInShelley = {
              minFeeCoefficient: epochParams?.min_fee_a || defaultEpochParams.min_fee_a,
              minFeeConstant: epochParams?.min_fee_b || defaultEpochParams.min_fee_b,
              maxBlockBodySize: epochParams?.max_block_size,
              maxBlockHeaderSize: epochParams?.max_block_header_size,
              stakeKeyDeposit: epochParams?.key_deposit || parseInt(defaultEpochParams.key_deposit),
              poolDeposit: epochParams?.pool_deposit || parseInt(defaultEpochParams.pool_deposit),
              poolRetirementEpochBound: epochParams?.e_max,
              desiredNumberOfPools: epochParams?.n_opt,
              poolInfluence: epochParams?.a0,
              monetaryExpansion: epochParams?.rho,
              treasuryExpansion: epochParams?.tau,
              decentralizationParameter: epochParams?.decentralisation_param,
              minUtxoValue: epochParams?.min_utxo || parseInt(defaultEpochParams.min_utxo_value),
              minPoolCost: epochParams?.min_pool_cost,
              extraEntropy: epochParams?.extra_entropy,
              protocolVersion: {
                major: epochParams?.protocol_major_ver,
                minor: epochParams?.protocol_minor_ver,
              }
            }
            const newProtocolParamsInAlonzo = {
              coinsPerUtxoWord: epochParams?.coins_per_utxo_word,
              maxValueSize: epochParams?.max_val_size || defaultEpochParams.max_val_size,
              collateralPercentage: epochParams?.collateral_percent,
              maxCollateralInputs: epochParams?.max_collateral_inputs,
              costModels: new Map<Cardano.PlutusLanguageVersion, Cardano.CostModel>([
                [Cardano.PlutusLanguageVersion.V1, Object.values(epochParams.cost_models.PlutusV1)],
                [Cardano.PlutusLanguageVersion.V2, Object.values(epochParams.cost_models.PlutusV2)],
                [Cardano.PlutusLanguageVersion.V3, Object.values(epochParams.cost_models.PlutusV3)],
              ]),
              prices: {
                memory: epochParams?.price_mem,
                steps: epochParams?.price_step
              } as Cardano.ExUnits,
              maxExecutionUnitsPerTransaction: {
                memory: epochParams?.max_tx_ex_mem,
                steps: epochParams?.max_tx_ex_steps
              } as Cardano.ExUnits,
              maxExecutionUnitsPerBlock: {
                memory: epochParams?.max_block_ex_mem,
                steps: epochParams?.max_block_ex_steps
              } as Cardano.ExUnits
            }
            const newProtocolParamsInBabbage = {
              coinsPerUtxoByte: epochParams.coins_per_utxo_size
            }
            const newProtocolParamsInConway = {
              poolVotingThresholds: {
                motionNoConfidence: Cardano.FractionUtils.toFraction(epochParams.pvt_motion_no_confidence),
                committeeNormal: Cardano.FractionUtils.toFraction(epochParams.pvt_committee_normal),
                committeeNoConfidence: Cardano.FractionUtils.toFraction(epochParams.pvt_committee_no_confidence),
                hardForkInitiation: Cardano.FractionUtils.toFraction(epochParams.pvt_hard_fork_initiation),
                securityRelevantParamVotingThreshold: Cardano.FractionUtils.toFraction(epochParams.pvt_p_p_security_group),
              } as Cardano.PoolVotingThresholds,
              dRepVotingThresholds: {
                updateConstitution: Cardano.FractionUtils.toFraction(epochParams.dvt_update_to_constitution),
                ppNetworkGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_network_group),
                ppEconomicGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_economic_group),
                ppTechnicalGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_technical_group),
                ppGovernanceGroup: Cardano.FractionUtils.toFraction(epochParams.dvt_p_p_gov_group),
                treasuryWithdrawal: Cardano.FractionUtils.toFraction(epochParams.dvt_treasury_withdrawal),
              } as Cardano.DelegateRepresentativeThresholds,
              minCommitteeSize: epochParams.committee_min_size,
              committeeTermLimit: Cardano.EpochNo(epochParams.committee_max_term_length),
              governanceActionValidityPeriod: Cardano.EpochNo(epochParams.gov_action_lifetime),
              governanceActionDeposit: epochParams.gov_action_deposit,
              dRepDeposit: epochParams.drep_deposit,
              dRepInactivityPeriod: Cardano.EpochNo(epochParams.drep_activity),
              minFeeRefScriptCostPerByte: epochParams.min_fee_ref_script_cost_per_byte
            }
            NetworkStore.setEpochParams({
              ...protocolParametersByron,
              ...newProtocolParamsInShelley,
              ...newProtocolParamsInAlonzo,
              ...newProtocolParamsInBabbage,
              ...newProtocolParamsInConway
            } as Cardano.ProtocolParameters);
            resolve(epochParams)
          } catch (error) {
            console.error('❌ Error processing epoch params:', error);
            console.warn('⚠️ Using default epoch parameters due to error');
          }
        }
      }));
    })
  }

  public loadGenesis(): void {
    const sub = liveQuery(() =>
      blockchainDb.table('genesis_info').where({ id: 0 }).first()
    ).subscribe({
      next: (genesis) => {
        if (genesis) {
          console.log('setGenesis', genesis);
          NetworkStore.setGenesis(genesis);
        }
      },
      error: (err) => {
        console.error('liveQuery(genesis_info) failed:', err);
      }
    });
    this.subscriptions.set('genesis_info', sub);
  }

  public async loadAccount() {
    const walletDB: Dexie = await this.getDb();
    return new Promise((resolve, reject) => {
      this.subscriptions.set('account', liveQuery(() => walletDB.table('account').where({walletId: this.id}).first()).subscribe({
        next: account => {
          WalletStore.setAccount(account)
          resolve(account)
        },
        error: error => {
          console.error('Failed to Fetch AccountInfo:', error)
          reject(error)
        }
      }));
    });
  }

  public async loadContacts() {
    const walletDB: Dexie = await this.getDb();
    return new Promise((resolve, reject) => {
      this.subscriptions.set('contacts', liveQuery(() => walletDB.table('contacts').toArray()).subscribe({
        next: newContacts => {
          const contacts = newContacts.reduce(function(map, contact) {
            map[contact.address] = contact
            return map;
          }, {});
          WalletStore.setContacts(contacts)
          resolve(contacts);
        },
        error: error => {
          console.error('Failed to Fetch Contacts:', error)
          reject(error);
        }
      }));
    });
  }

  public async loadAssets() {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    return new Promise((resolve, _reject) => {
      this.subscriptions.set('assets', liveQuery(() => blockchainDB.table('assets')
        .toArray())
        .subscribe({
          next: assets => {
            const map = assets.reduce((map: Record<string, any>, asset: any) => {
              map[asset.asset] = asset;
              return map;
            }, {});
            NetworkStore.setAssets(map);
            resolve(map);
          }
      }));
    })
  }

  public async loadConnectedDapps() {
    const walletDB: Dexie = await this.getDb();
    return new Promise((resolve, reject) => {
      this.subscriptions.set('dapps', liveQuery(() => walletDB.table('connected_dapps').toArray()).subscribe({
        next: newConnectedDapps => {
          WalletStore.setConnectedDapps(newConnectedDapps)
          if (chrome?.storage) { // TODO Remove
            if (newConnectedDapps) {
              chrome.storage.local.set({[STORAGE.whitelisted]: newConnectedDapps});
            } else {
              chrome.storage.local.remove(STORAGE.whitelisted);
            }
          }
          resolve(this.connectedDapps as any[])
        },
        error: error => {
          console.error('Failed to Fetch Connected Dapps:', error)
          reject(error)
        }
      }));
    });
  }

  async setUtxosAndAddresses(transactions: any[]) {
    console.log('setUtxosAndAddresses', transactions)
    let stakeAddress: string = '';
    let address: string = '';
    if (this.isEnterpriseAddress()) {
      address = this.baseAddress;
    } else {
      stakeAddress = this.stakeAddress
    }

    const utxos: Map<string, Cardano.Utxo> = new Map<string, Cardano.Utxo>();
    const addresses: Set<string> = new Set<string>();
    const uniqueAssets: Set<string> = new Set<string>();
    for (const transaction of transactions) {
      for (const inp of transaction.body.inputs) {
        utxos.delete(`${inp.txId}#${inp.index}`);
      }
      transaction.body.outputs.forEach((out, idx) => {
        let outAddress = out.address
        const outAddressType = Cardano.Address.fromString(outAddress).getType()
        try { // TODO Support Byron Addresses
          if (!this.isEnterpriseAddress() && outAddressType === Cardano.AddressType.BasePaymentKeyStakeKey) {
            const baseAddress: Cardano.BaseAddress = Cardano.Address.fromBech32(outAddress).asBase()
            const rewardAddr: Cardano.RewardAddress = Cardano.RewardAddress.fromCredentials(
              this.networkId(),
              baseAddress.getStakeCredential()
            );
            outAddress = rewardAddr.toAddress().toBech32();
          }
          if (address === outAddress || stakeAddress === outAddress) {
            addresses.add(out.address)
            utxos.set(
              `${transaction.id}#${idx}`,
              [
                {
                  txId: Cardano.TransactionId(transaction.id),
                  index: idx,
                  address: out.address,
                },
                {
                  address: out.address,
                  value: out.value,
                  datumHash: out.datumHash,
                  datum: out.datum,
                  scriptReference: out.scriptReference
                }
              ]
            );
          }
          if (out.value.assets) {
            out.value.assets.keys().forEach((key: string) => {
              if (!uniqueAssets.has(key)) {
                uniqueAssets.add(key)
              }
            });
          }
        } catch (e) {
          console.error(e)
        }
      });
    }
    console.log('syncAssets', uniqueAssets);

    // Set Assets Info in Network DB
    await this.syncAssets(Array.from(uniqueAssets))
    //TODO wait for network Store to Load Assets

    // Resolve Assets from UTxOs
    this.setAssets(Array.from(utxos.values()));

    // Keys
    if (this.type !== WalletType.Google) {
        const keys = await this.syncKeys(Array.from(addresses));
        WalletStore.setKeys(keys);
    }

    // UTxOs
    WalletStore.setUtxos(Array.from(utxos.values()));
  }

  setAssets(utxos?: Cardano.Utxo[]) {
    if (!utxos) {
      return;
    }
    const assets = {};
    let adaBalance: bigint = 0n;
    utxos.values().forEach((utxo: Cardano.Utxo) => {
      adaBalance += utxo[1].value.coins;
      utxo[1].value.assets?.entries().forEach(asset => {
        const key: Cardano.AssetId = asset[0];
        const policyId: Cardano.PolicyId = Cardano.AssetId.getPolicyId(asset[0])
        const assetName: Cardano.AssetName = Cardano.AssetId.getAssetName(asset[0])
        if (!assets[key]) {
          assets[key] = {
            quantity: 0n,
            policy_id: '',
            asset_name: '',
            unit: '',
            fingerprint: '',
          };
        }
        assets[key].quantity += asset[1];
        assets[key].policy_id = Cardano.AssetId.getPolicyId(asset[0])
        assets[key].asset_name = Cardano.AssetId.getAssetName(asset[0])
        assets[key].unit = asset[0]
        assets[key].fingerprint = Cardano.AssetFingerprint.fromParts(policyId, assetName);
      });
    });
    if (adaBalance > 0) {
      const network = networks.resolveNetwork(this.chain, this.network);
      assets['lovelace'] = {
        unit: 'lovelace',
        name: network?.currencyName,
        policy_id: '',
        img: network?.currencyImage,
        quantity: adaBalance,
        metadata: {
          name: network?.currencyName,
          ticker: network?.currencyTicker,
          description: network?.currencyDescription,
          logo: network?.currencyImage,
          decimals: 6,
        },
        risk: 'AAA',
        verified: true,
        onchain_metadata: null,
      };
    }

    const resolvedAssets = Object.entries(assets).map(([key, asset]) => [key, asset['policy_id'] === '' ? asset : resolveAsset(asset)] as const);

    // Set Tokens
    const tokens = Object.fromEntries(resolvedAssets.filter(([, resolved]) => Boolean(resolved.metadata)));
    WalletStore.setTokens(tokens);
    chrome.alarms.onAlarm.addListener(alarmListener);
    chrome.alarms.create('coinGeckoPrices', { delayInMinutes: 0, periodInMinutes: 1 });
    if (networks.resolveSwapSupport(this.chain, this.network)) {
      chrome.alarms.create('refreshDexHunterPrices', { delayInMinutes: 0, periodInMinutes: 5 });
      chrome.alarms.create('refreshXerberusRisks', { delayInMinutes: 0, periodInMinutes: 720 });
      chrome.alarms.create('refreshTokenHistory', { delayInMinutes: 0, periodInMinutes: 20 });
      chrome.alarms.create(`portfolio|${this.stakeAddress}`, { delayInMinutes: 0, periodInMinutes: 60 });
      chrome.alarms.create(`trendedPortfolio|${this.stakeAddress}`, { delayInMinutes: 0, periodInMinutes: 60 });
    }
    // Set Collections
    const collectibles = Object.fromEntries(resolvedAssets.filter(([, resolved]) => !Boolean(resolved.metadata)));
    if (Object.values(collectibles).length === 0) {
      return;
    }
    const collections = {}
    Object.values(collectibles).forEach((collectible: any) => {
      let resolvedAsset
      if (collectible.policy_id === '') {
        resolvedAsset = collectible
      } else {
        resolvedAsset = resolveAsset(collectible)
      }
      if (collections[collectible.policy_id]) {
        collections[collectible.policy_id]['items'].push(collectible)
        collections[collectible.policy_id]['quantity'] += Number(collectible.quantity)
        const description = findCollectionDescription(resolvedAsset)
        if (description) {
          collections[collectible.policy_id]['description'] = description
        }
      } else {
        collections[collectible.policy_id] = {}
        collections[collectible.policy_id]['items'] = [resolvedAsset]
        collections[collectible.policy_id]['name'] = findCollectionName(resolvedAsset)
        const description = findCollectionDescription(resolvedAsset)
        if (description) {
          collections[collectible.policy_id]['description'] = description
        }
        collections[collectible.policy_id]['img'] = collections[collectible.policy_id]['items'][0].img
        collections[collectible.policy_id]['quantity'] = Number(collectible.quantity)
        collections[collectible.policy_id]['isScam'] = resolvedAsset.isScam
      }
    })
    Object.values(collections).forEach(collection => {
      const items = collection['items']
      if (items[0]['policy_id'] === 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a') {
        collection['name'] = 'adaHandle'
      } else if (items[0]['policy_id'] === '85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18') {
        collection['name'] = 'MusicBox Dimensions'
      } else if (!collection['name']) {
        if (items.some(item => item['onchain_metadata'])) {
          collection['name'] = longestCommonStartingSubstring(items
            .filter(item => item['onchain_metadata'] && item['onchain_metadata'][Object.keys(item['onchain_metadata']).find(key => key.toLowerCase() === 'name')])
            .map(item => item['onchain_metadata'][Object.keys(item['onchain_metadata']).find(key => key.toLowerCase() === 'name')]))
        }
        if (!collection['name']) {
          collection['name'] = longestCommonStartingSubstring(items.map(item => item[Object.keys(item).find(key => key.toLowerCase() === 'name')]).filter(item => !!item))
        }
        if (!collection['name']) {
          collection['name'] = items[0]['policy_id']
        }
      }
      if (Array.isArray(collection['name'])) {
        collection['name'] = collection['name'].join(' ');
      }
    })
    console.log('collections', collections)
    WalletStore.setCollections(collections)
    MusicStore.resolveMusicPlaylist(Object.values(collections))
  }

  public async loadTransactions() {
    const walletDB: Dexie = await this.getDb();
    return new Promise((resolve, reject) => {
      this.subscriptions.set('transactions', liveQuery(() => walletDB.table('transactions').toArray()).subscribe({
          next: async (newTransactions: any[]) => {
            console.log('newTransactions', newTransactions)
            try {
              let transactions: any = []
              if (newTransactions) {
                let currentStake: string = '';
                let currentAddress: string = '';
                if (this.isEnterpriseAddress()) {
                  currentAddress = this.baseAddress;
                } else {
                  currentStake = this.stakeAddress;
                }
                transactions = newTransactions.sort((a, b) => a.tx_timestamp - b.tx_timestamp)
                  .map((tx) => {
                    let sentAmount: number = 0;
                    let receivedAmount: number = 0;
                    const sentAssets: any = {};
                    const receivedAssets: any = {};
                    tx.utxo?.inputs.forEach(input => {
                      if ((input.address === currentAddress || toStakeAddress(input.address, this.networkId()) === currentStake) && !input.data_hash) {
                        const value = input.amount.find(amount => amount.unit === 'lovelace')
                        const asset_list = input.amount.filter(amount => amount.unit !== 'lovelace')
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
                      if ((output.address === currentAddress || toStakeAddress(output.address, this.networkId()) === currentStake) && !output.datum_hash) {
                        const value = output.amount.find(amount => amount.unit === 'lovelace')
                        const asset_list = output.amount.filter(amount => amount.unit !== 'lovelace')
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
                    const refAssetsCopy = {...refAssets}
                    Object.values(refAssets).forEach((asset: any) => {
                      if (Number(refAssetsCopy[asset.unit].quantity) === 0) {
                        delete refAssetsCopy[asset.unit]
                      }
                    })
                    const network = networks.resolveNetwork(this.chain, this.network)
                    const nativeAsset = {
                      unit: "lovelace",
                      policy_id: "",
                      asset_name: "lovelace",
                      quantity: totalAmount,
                      metadata:  {
                        decimals: 6,
                        description: network?.currencyDescription,
                        logo: network?.currencyImage,
                        name: network?.currencyName,
                        ticker: network?.currencyTicker,
                      }
                    }
                    return {
                      ...tx,
                      sentAmount,
                      receivedAmount,
                      sentAssets: Object.values(sentAssets),
                      receivedAssets: Object.values(receivedAssets),
                      ada: totalAmount,
                      assets: [nativeAsset, ...Object.values(assets)]
                    }
                  })
              }
              WalletStore.setTransactions(transactions)
              await this.setUtxosAndAddresses(transactions);
              resolve(transactions)
            } catch (e) {
              console.error(e)
              resolve([]) //TODO
            }
          },
          error: (error: any) => {
            console.error('Failed to fetch transactions:', error);
            reject(error);
          },
        }))
    });
  }

  public async disconnectDapp(id: number) {
    const walletDB: Dexie = await this.getDb();
    walletDB.table('connected_dapps').delete(id)
  }

  async getLastSyncInfo() {
    return this.getDb()
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
    await this.getDb()
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
    return this.getDb()
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
    const accountInfoId = await this.getDb()
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
    const blockchainDB: Dexie = await this.getBlockchainDb();
    const assetsTable = blockchainDB.table('assets');
    if (assetsTable) {
      assetsTable.bulkPut(assets);
    }
  }

  async setAccountRewards(res): Promise<any[] | void> {
    return this.getDb()
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
    console.log('txs', txs);
    return this.getDb()
      .then(db => {
        const txsTable = db.table('transactions');
        if (txsTable) {
          txsTable.bulkPut(txs);
        }
      }).catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setEpochParams(epoch_params: any): Promise<void> {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    const epochParamsTable = blockchainDB.table('epoch_params');
    const key = Object.keys(epoch_params)[0];
    if (epochParamsTable) {
      console.log('epoch_params', epoch_params);
      epochParamsTable.put({
        epoch: key,
        ...epoch_params[key],
      });
    }
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

  async syncGenesis(): Promise<void> {
    if (this.chain == Blockchain.CARDANO || this.chain == Blockchain.APEX_PRIME) {
      const blockchainDB: Dexie = await this.getBlockchainDb();
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

  async syncKeys(knownAddresses: string[]): Promise<any> {
    let resolvedKeys: any = {};
    try {
      const db: Dexie = await this.getDb();
      const addressesTable = db.table('addresses');
      if (!addressesTable) {
        throw new Error('No Addresses Table.');
      }
      resolvedKeys = this.resolvePathsForMissingAddresses(knownAddresses);
      await db.transaction('rw', addressesTable, async () => {
        await addressesTable.clear();
        await addressesTable.put({
          address: this.publicKey,
          resolvedKeys
        });
      });
      return resolvedKeys;
    } catch (err) {
      console.error(`Failed to open database: ${err}`);
      return resolvedKeys;
    }
  }

  resolvePathsForMissingAddresses(usedAddresses: string[]): any {
    const resolvedAddresses: any[] = [];
    let addressIndex: number = 0;       // Start from the first address index
    let consecutiveUnused: number = 0;  // Track consecutive unused addresses
    const keys = {
      stake: [{
        address: this.stakeAddress,
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.CHIMERIC_ACCOUNT}/${addressIndex}`,
        cred: Hash28ByteBase16(getStakeKey(this.publicKey, 0).hash().hex()),
      }],
      payment: [],
      change: [],
      ccCold: [{
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.CONSTITUTIONAL_COMMITTEE_COLD}/${addressIndex}`,
        cred: Hash28ByteBase16(getCcColdKey(this.publicKey, 0).hash().hex()),
      }],
      ccHot: [{
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.CONSTITUTIONAL_COMMITTEE_HOT}/${addressIndex}`,
        cred: Hash28ByteBase16(getCcHotKey(this.publicKey, 0).hash().hex()),
      }],
      drep129: [{
        address: getCip129DrepId(this.publicKey),
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.DREP}/${addressIndex}`,
        cred: Hash28ByteBase16(getDrepKey(this.publicKey, 0).hash().hex()),
      }],
      drep105: [{
        address: getCip105DrepId(this.publicKey),
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.DREP}/${addressIndex}`,
        cred: Hash28ByteBase16(getDrepKey(this.publicKey, 0).hash().hex()),
      }],
      script: []
    }
    while (consecutiveUnused < BIP44_SCAN_SIZE) {
      const derivedAddress: string = this.deriveAddressFromPath(addressIndex).toBech32();
      const internalDerivedAddress: string = this.deriveInternalAddressFromPath(addressIndex).toAddress().toBech32();
      let found: boolean = false;
      const derivedPaymentAddress = {
        address: derivedAddress,
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.EXTERNAL}/${addressIndex}`,
        cred: keyHashFromAddress(derivedAddress),
        used: false,
      }
      if (usedAddresses.includes(derivedAddress)) {
        resolvedAddresses.push(derivedPaymentAddress);
        consecutiveUnused = 0;
        derivedPaymentAddress.used = true
        found = true;
      }
      keys.payment.push(derivedPaymentAddress);
      const derivedChangeAddress = {
        address: internalDerivedAddress,
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.INTERNAL}/${addressIndex}`,
        cred: keyHashFromAddress(internalDerivedAddress),
        used: false,
      }
      if (usedAddresses.includes(internalDerivedAddress)) {
        resolvedAddresses.push(derivedChangeAddress);
        consecutiveUnused = 0;
        derivedChangeAddress.used = true
        found = true;
      }
      keys.change.push(derivedChangeAddress);
      if (!found) {
        consecutiveUnused++;  // Increment unused address counter if no match is found
      }
      // If we've resolved all missing addresses, we can break earlyCardano.
      if (usedAddresses.length === resolvedAddresses.length) {
        break;
      }
      addressIndex++;  // Move to the next address index
    }
    return keys;
  }

  deriveAddressFromPath(addressIndex: number): Cardano.Address {
    return getAddress(this.publicKey, this.chain, this.network, addressIndex)
  }

  deriveInternalAddressFromPath(addressIndex) {
    return Cardano.BaseAddress.fromCredentials(
      this.networkId(),
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(this.pubKeyInternal(addressIndex).hash().hex())
      },
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(this.stakeKey().hash().hex())
      }
    );
  }

  pubKeyInternal(index: number): Ed25519PublicKey {
    return getPublicKey(this.publicKey)
      .derive([ChainDerivations.INTERNAL, index])
      .toRawKey();
  }

  stakeKey(): Ed25519PublicKey {
    return getStakeKey(this.publicKey, 0)
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
          await this.syncAccountTransactions(0);
        }
      }
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
        res = await this.api.getAccountInfo(this.baseAddress);
      } else {
        res = await this.api.getAccountInfo(this.stakeAddress);
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
      const res = await this.api.getAccountRewards(this.stakeAddress);
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
        res = await this.api.getAccountTransactions(this.baseAddress, height);
      } else {
        res = await this.api.getAccountTransactions(this.stakeAddress, height);
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
        await this.setAccountTransactions(txsCborResults);
        return txsCborResults;
      }
    } catch (e) {
      console.log(e);
    }
  }

  async syncAssets(uniqueUnits: string[]): Promise<void> {
    const blockchainDB: Dexie = await this.getBlockchainDb();
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

  private async getAssetsInfo(units: string[]) {
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

  isEnterpriseAddress(): boolean {
    return Cardano.Address.fromBech32(this.baseAddress).getType() === Cardano.AddressType.EnterpriseScript;
  }

  private async getEpochProtocolIfNotExists(epoch: number) {
    if (NetworkStore.state.epochParams[epoch]) {
      return null
    }
    return epoch
  }

  public async getDb(): Promise<Dexie> {
    const dbName = 'wallet-' + this.id;
    try {
      const db: Dexie = new Dexie(dbName);
      return await db.open();
    } catch (error: DexieError | any) {
      console.log(error)
      if (error.name === 'NoSuchDatabaseError') {
        const db: Dexie = new Dexie(dbName);
        db.version(walletDBVersion).stores(walletDBSchema);
        return db.open();
      } else {
        console.error('Error opening database:', error);
        return null
      }
    }
  }

  public async getBlockchainDb(): Promise<Dexie> {
    if (!blockchainDb) {
      const dbName = `${this.chain}_${this.network}`;
      blockchainDb = new Dexie(dbName);
      blockchainDb.version(blockChainDBVersion).stores(blockChainDBSchema);
    }

    if (!blockchainDb.isOpen()) {
      try {
        await blockchainDb.open();
      } catch (err) {
        console.error('Error opening blockchain DB:', err);
        throw err;  // or return null, depending on your error-handling strategy
      }
    }

    return blockchainDb;
  }

  public isWhitelisted(origin: string): boolean {
    if (!this.connectedDapps || !Array.isArray(this.connectedDapps)) return false;
    const whitelisted = this.connectedDapps as WhitelistedEntry[]
    return !!whitelisted.find(el => origin.includes(el.domain));
  }

  async startSync() {
    console.log('startSync');
    this.endSync();

    try {
      const tickerStatistics = await this.api.fetchTickerStatistics()
      NetworkStore.setPrice(tickerStatistics)
    } catch (err) {
      console.log(err)
    }
    if (!NetworkStore.state.tickerStatisticsIntervalId) {
      NetworkStore.setTickerStatisticsIntervalId(setInterval(async () => {
        try {
          const tickerStatistics = await this.api.fetchTickerStatistics()
          NetworkStore.setPrice(tickerStatistics)
        } catch (err) {
          console.log(err)
        }
      }, 20000))
    }

    // Fiat Rates
    try {
      const fiatRates = await this.api.fetchFiatRates()
      console.log('fiatRates', fiatRates)
      WalletStore.setFiatRates(fiatRates)
    } catch (err) {
      console.log(err)
    }
    if (!WalletStore.state.fiatRatesIntervalId) {
      WalletStore.setFiatRatesIntervalId(setInterval(async () => {
        try {
          const fiatRates = await this.api.fetchFiatRates()
          console.log('fiatRates', fiatRates)
          WalletStore.setFiatRates(fiatRates)
        } catch (err) {
          console.log(err)
        }
      }, 14400000));
    }
  }

  endSync() {
    clearInterval(WalletStore.state.fiatRatesIntervalId)
    WalletStore.setFiatRatesIntervalId(null)
    NetworkStore.setTickerStatisticsIntervalId(null)
  }
}

export async function login(wallet: any): Promise<WalletBg> {
  LoadingState.setLoading(true);
  LoadingState.setText('Creating wallet instance...');

  try {
    const walletBg: WalletBg = new WalletBg(wallet);
    WalletStore.setLoggedWallet(walletBg);

    LoadingState.setText('Initializing wallet...');
    await walletBg.init();

    LoadingState.setText('Wallet ready');
    return walletBg;
  } catch (error) {
    LoadingState.setText('Wallet initialization failed');
    console.error('Error during wallet login:', error);
    throw error;
  } finally {
    // Keep loading state active during initialization, it will be cleared after all promises resolve
  }
}

export function alarmListener(alarm) {
  if (alarm.name === 'refreshDexHunterPrices') {
    console.log('refreshDexHunterPrices', alarm)
    DexHunterStore.updatePrices(Object.keys(WalletStore.state.tokens))
  } else if (alarm.name === 'refreshXerberusRisks') {
    console.log('refreshXerberusRisks', alarm)
    XerberusStore.updateRisks(Object.values(WalletStore.state.tokens).map((token: any) => token.fingerprint))
  } else if (alarm.name === 'refreshTokenHistory') {
    console.log('refreshTokenHistory', alarm)
    RealFiStore.updateTokenHistory(Object.values(WalletStore.state.tokens).map((token: any) => token.unit))
  } else if (alarm.name.includes('portfolio')) {
    console.log('portfolio', alarm);
    const stakeAddress = alarm.name.split('|')[1]
    TapToolsStore.loadPortfolio(stakeAddress)
  } else if (alarm.name.includes('trendedPortfolio')) {
    console.log('portfolioTrended', alarm);
    const stakeAddress = alarm.name.split('|')[1]
    TapToolsStore.loadPortfolioTrendedValue(stakeAddress)
  } else if (alarm.name === 'coinGeckoPrices') {
    console.log('coinGeckoPrices', alarm)
    CoinGeckoStore.updatePrices();
  }
}
