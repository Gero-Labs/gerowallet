import Dexie from 'dexie';
import { Api } from '@/api/api';
import { Cardano, Serialization, util } from '@cardano-sdk/core';
import {
  Bip32PrivateKey,
  Ed25519PrivateKey,
  Ed25519PublicKey,
  Hash28ByteBase16,
} from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { APIError, DataSignError, TxSendError, TxSignError } from '@/chrome/config';
import networks from '@/utils/networks';
import { blockChainDBSchema, blockChainDBVersion } from '@/db/schema';
import {
  HARDENED,
  BIP44_SCAN_SIZE,
  ChainDerivations,
  coin_type,
  CoinTypes,
  ERROR,
  Keys,
  Provider,
  purpose,
  Tip,
  WalletType,
  WalletTypePurpose,
} from '@/models/types';
import {
  addrToSignWith,
  getAddress,
  getCcColdKey,
  getCcHotKey,
  getCip105DrepId,
  getCip129DrepId,
  getDrepKey,
  getPaymentKeyExternal,
  getPaymentKeyInternal,
  getRewardAddress,
  getStakeKey,
  keyHashFromAddress,
  toPaymentCredential, toValueCore,
} from '@/chrome/serialization';
import { decryptWithPassword } from '@/shared/utils/crypto';
import WalletStore from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import DexHunterStore from '@/stores/dexHunterStore';
import XerberusStore from '@/stores/xerberusStore';
import {
  analyzeTransactionForSignatures,
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,
  resolveAsset,
} from '@/shared/utils/resolver';
import { getDb } from '@/db/wallet-db';
import RealFiStore from '@/stores/realFiStore';
import TapToolsStore from '@/stores/tapToolsStore';
import CoinGeckoStore from '@/stores/coinGeckoStore';
import MusicStore from '@/stores/musicStore';
import SyncService from '@/services/sync.service';
import { LoaderFactory } from '@/db/loaders';
import {
  buildAndSignData,
  convertTransactionsForStorage,
  createCoseKey,
  createSignDataBuilder,
  toHexArray,
} from '@/shared/utils/converter';
import { COSESign1Builder } from '@emurgo/cardano-message-signing-browser';
import { Buffer } from 'buffer';
import { deserializeCardanoJsSdkTx, serializeWitness } from '@/chrome/cardanoJsSdkCbor';
import { decrypt } from '@/shared/utils/crypto';
import { Hash32ByteBase16 } from '@cardano-sdk/crypto';

let blockchainDb: Dexie = null;

export class WalletBg {
  api: Api;
  syncService: SyncService;
  loaderFactory: LoaderFactory;

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
    this.provider = networks.resolveDefaultProvider(this.chain, this.network);
    this.api = new Api(wallet, this.provider);
    this.baseAddress = getAddress(this.publicKey, this.chain, this.network, 0).toBech32();
    this.stakeAddress = getRewardAddress(this.publicKey, this.chain, this.network).toBech32();
    this.syncService = new SyncService(this);
    this.loaderFactory = new LoaderFactory({
      id: this.id,
      chain: this.chain,
      network: this.network,
      baseAddress: this.baseAddress,
      stakeAddress: this.stakeAddress,
      isEnterpriseAddress: this.isEnterpriseAddress.bind(this),
      networkId: this.networkId.bind(this),
      getDb: this.getDb.bind(this),
      getBlockchainDb: this.getBlockchainDb.bind(this),
      setUtxosAndAddresses: this.setUtxosAndAddresses.bind(this),
      triggerResync: this.triggerResync.bind(this),
    });
    this.loaderFactory.createAllLoaders();
  }

  unsubscribeAll() {
    this.loaderFactory.unsubscribeAll();
    // CRITICAL: Clear all intervals and alarms during cleanup
    this.endSync();
  }

  networkId(): number {
    return networks.resolveNetworkId(this.chain, this.network);
  }

  public async loadRewards() {
    return this.loaderFactory.load('rewards');
  }

  public async loadConfig() {
    return this.loaderFactory.load('config');
  }

  public async loadEpochParams() {
    return this.loaderFactory.load('epoch_params');
  }

  public loadGenesis(): void {
    this.loaderFactory.load('genesis_info').catch(err => {
      console.error('Genesis loader failed:', err);
    });
  }

  public async loadAccount() {
    return this.loaderFactory.load('account');
  }

  public async loadContacts() {
    return this.loaderFactory.load('contacts');
  }

  public async loadAssets() {
    return this.loaderFactory.load('assets');
  }

  public async loadConnectedDapps() {
    return this.loaderFactory.load('dapps');
  }

  public async getEpochProtocolIfNotExists(epoch: number) {
    if (NetworkStore.state.tip?.epoch == epoch) {
      return null
    }
    return epoch;
  }

  async setUtxosAndAddresses(transactions: any[]) {
    console.debug('🔄 setUtxosAndAddresses called with', transactions?.length || 0, 'transactions');

    let stakeAddress: string = '';
    let address: string = '';
    if (this.isEnterpriseAddress()) {
      address = this.baseAddress;
      console.debug('🏢 Using enterprise address:', address);
    } else {
      stakeAddress = this.stakeAddress;
      console.debug('🏛️ Using stake address:', stakeAddress);
    }

    const utxos: Map<string, Cardano.Utxo> = new Map<string, Cardano.Utxo>();
    const addresses: Set<string> = new Set<string>();
    addresses.add(this.baseAddress);
    const uniqueAssets: Set<string> = new Set<string>();

    console.debug('🔍 Processing transactions for UTXOs...');
    for (const transaction of transactions) {
      if (transaction.body) {
        for (const inp of transaction.body.inputs) {
          utxos.delete(`${inp.txId}#${inp.index}`);
        }
        transaction.body.outputs.forEach((out, idx) => {
          let outAddress = out.address;
          const outAddressType: Cardano.AddressType = Cardano.Address.fromString(outAddress).getType();
          try {
            // TODO Support Byron Addresses
            if (!this.isEnterpriseAddress() && outAddressType === Cardano.AddressType.BasePaymentKeyStakeKey) {
              const baseAddress: Cardano.BaseAddress = Cardano.Address.fromBech32(outAddress).asBase();
              const rewardAddr: Cardano.RewardAddress = Cardano.RewardAddress.fromCredentials(
                this.networkId(),
                baseAddress.getStakeCredential()
              );
              outAddress = rewardAddr.toAddress().toBech32();
            }
            if (address === outAddress || stakeAddress === outAddress) {
              addresses.add(out.address);
              const utxoId = `${transaction.id || transaction.tx_hash}#${idx}`;
              utxos.set(utxoId, [
                {
                  txId: Cardano.TransactionId(transaction.id || transaction.tx_hash),
                  index: idx,
                  address: out.address,
                },
                {
                  address: out.address,
                  value: out.value,
                  datumHash: out.datumHash,
                  datum: out.datum,
                  scriptReference: out.scriptReference,
                },
              ]);
            }
            if (out.value.assets) {
              out.value.assets.keys().forEach((key: string) => {
                if (!uniqueAssets.has(key)) {
                  uniqueAssets.add(key);
                }
              });
            }
          } catch (e) {
            console.error(e);
          }
        });
      } else {
        for (const inp of transaction.utxo.inputs) {
          utxos.delete(`${inp.tx_hash}#${inp.output_index}`);
        }
        transaction.utxo.outputs.forEach((out, idx) => {
          let outAddress = out.address;
          const outAddressType: Cardano.AddressType = Cardano.Address.fromString(outAddress).getType();
          try {
            // TODO Support Byron Addresses
            if (!this.isEnterpriseAddress() && outAddressType === Cardano.AddressType.BasePaymentKeyStakeKey) {
              const baseAddress: Cardano.BaseAddress = Cardano.Address.fromBech32(outAddress).asBase();
              const rewardAddr: Cardano.RewardAddress = Cardano.RewardAddress.fromCredentials(
                this.networkId(),
                baseAddress.getStakeCredential()
              );
              outAddress = rewardAddr.toAddress().toBech32();
            }
            if (address === outAddress || stakeAddress === outAddress) {
              addresses.add(out.address);
              console.log('transaction', transaction)
              const utxoId: string = `${transaction.id || transaction.tx_hash}#${out.output_index}`;
              utxos.set(utxoId, [
                {
                  txId: Cardano.TransactionId(transaction.id || transaction.tx_hash),
                  index: out.output_index,
                  address: out.address,
                },
                {
                  address: out.address,
                  value: toValueCore(out.amount),
                  datumHash: out.datum_hash ? Hash32ByteBase16.fromHexBlob(HexBlob(out.datum_hash)) : null,
                  datum: out.inline_datum ? Serialization.PlutusData.fromCbor(HexBlob(out.inline_datum.bytes)).toCore() : null,
                  scriptReference: out.reference_script ? Serialization.Script.fromCbor(HexBlob(out.reference_script.bytes)).toCore() : null
                },
              ]);
            }
          } catch (e) {
            console.error(e);
          }
        });
        Array.from(utxos.values()).forEach((utxo: Cardano.Utxo) => {
          utxo[1].value.assets?.keys().forEach((key: string) => {
            if (!uniqueAssets.has(key)) {
              uniqueAssets.add(key);
            }
          });
        })
      }
    }

    // Set Assets Info in Network DB
    await this.syncService.syncAssets(Array.from(uniqueAssets));
    //TODO wait for network Store to Load Assets

    // Resolve Assets from UTxOs
    this.setAssets(Array.from(utxos.values()));

    // Keys
    console.debug('🔑 Wallet type check for keys sync:', this.type, 'WalletType.Google:', WalletType.Google);
    if (this.type !== WalletType.Google) {
      const keys = await this.syncService.syncKeys(Array.from(addresses));
      WalletStore.setKeys(keys);
    } else {
      console.debug('🔑 Skipping key sync for Google wallet type');
    }

    // UTxOs
    console.debug('💰 Setting', utxos.size, 'UTXOs to store');
    WalletStore.setUtxos(Array.from(utxos.values()));
    console.debug('✅ setUtxosAndAddresses completed successfully');
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
        const policyId: Cardano.PolicyId = Cardano.AssetId.getPolicyId(asset[0]);
        const assetName: Cardano.AssetName = Cardano.AssetId.getAssetName(asset[0]);
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
        assets[key].policy_id = Cardano.AssetId.getPolicyId(asset[0]);
        assets[key].asset_name = Cardano.AssetId.getAssetName(asset[0]);
        assets[key].unit = asset[0];
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

    const resolvedAssets = Object.entries(assets).map(
      ([key, asset]) => [key, asset['policy_id'] === '' ? asset : resolveAsset(asset)] as const
    );

    // Set Tokens
    const tokens = Object.fromEntries(resolvedAssets.filter(([, resolved]) => Boolean(resolved.metadata)));

    WalletStore.setTokens(tokens);
    chrome.alarms.onAlarm.addListener(alarmListener);
    chrome.alarms.create('coinGeckoPrices', { delayInMinutes: 0, periodInMinutes: 1 });
    const isSwapSupported = networks.resolveSwapSupport(this.chain, this.network);
    const isStakingSupported = networks.resolveStakingSupport(this.chain, this.network);
    if (!this.isEnterpriseAddress() && isStakingSupported) {
      chrome.alarms.create('refreshStakingPools', { delayInMinutes: 0, periodInMinutes: 240 });
    }
    if (!this.isEnterpriseAddress() && networks.resolveGovernanceSupport(this.chain, this.network)) {
      chrome.alarms.create('refreshDReps', { delayInMinutes: 0, periodInMinutes: 280 });
    }
    if (isSwapSupported) {
      chrome.alarms.create('refreshDexHunterPrices', { delayInMinutes: 0, periodInMinutes: 5 });
      chrome.alarms.create('refreshXerberusRisks', { delayInMinutes: 0, periodInMinutes: 720 });
      chrome.alarms.create('refreshTokenHistory', { delayInMinutes: 0, periodInMinutes: 20 });
      chrome.alarms.create(`portfolio|${this.stakeAddress}`, { delayInMinutes: 0, periodInMinutes: 60 });
    }
    // Set Collections
    const collectibles = Object.fromEntries(resolvedAssets.filter(([, resolved]) => !Boolean(resolved.metadata)));
    if (Object.values(collectibles).length === 0) {
      return;
    }
    const collections = {};
    Object.values(collectibles).forEach((collectible: any) => {
      let resolvedAsset;
      if (collectible.policy_id === '') {
        resolvedAsset = collectible;
      } else {
        resolvedAsset = resolveAsset(collectible);
      }
      if (collections[collectible.policy_id]) {
        collections[collectible.policy_id]['items'].push(collectible);
        collections[collectible.policy_id]['quantity'] += Number(collectible.quantity);
        const description = findCollectionDescription(resolvedAsset);
        if (description) {
          collections[collectible.policy_id]['description'] = description;
        }
      } else {
        collections[collectible.policy_id] = {};
        collections[collectible.policy_id]['items'] = [resolvedAsset];
        collections[collectible.policy_id]['name'] = findCollectionName(resolvedAsset);
        const description = findCollectionDescription(resolvedAsset);
        if (description) {
          collections[collectible.policy_id]['description'] = description;
        }
        collections[collectible.policy_id]['img'] = collections[collectible.policy_id]['items'][0].img;
        collections[collectible.policy_id]['quantity'] = Number(collectible.quantity);
        collections[collectible.policy_id]['isScam'] = resolvedAsset.isScam;
      }
    });
    Object.values(collections).forEach(collection => {
      const items = collection['items'];
      if (items[0]['policy_id'] === 'f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a') {
        collection['name'] = 'adaHandle';
      } else if (items[0]['policy_id'] === '85152e10643c1440ba2ba817e3dd1faf7bd7296a8b605efd0f0f2d18') {
        collection['name'] = 'MusicBox Dimensions';
      } else if (!collection['name']) {
        if (items.some(item => item['onchain_metadata'])) {
          collection['name'] = longestCommonStartingSubstring(
            items
              .filter(
                item =>
                  item['onchain_metadata'] &&
                  item['onchain_metadata'][
                    Object.keys(item['onchain_metadata']).find(key => key.toLowerCase() === 'name')
                  ]
              )
              .map(
                item =>
                  item['onchain_metadata'][
                    Object.keys(item['onchain_metadata']).find(key => key.toLowerCase() === 'name')
                  ]
              )
          );
        }
        if (!collection['name']) {
          collection['name'] = longestCommonStartingSubstring(
            items.map(item => item[Object.keys(item).find(key => key.toLowerCase() === 'name')]).filter(item => !!item)
          );
        }
        if (!collection['name']) {
          collection['name'] = items[0]['policy_id'];
        }
      }
      if (Array.isArray(collection['name'])) {
        collection['name'] = collection['name'].join(' ');
      }
    });
    WalletStore.setCollections(collections);
    MusicStore.resolveMusicPlaylist(Object.values(collections));
  }

  public async loadTransactions() {
    return this.loaderFactory.load('transactions');
  }

  /**
   * Trigger a resync operation to clear old data and fetch fresh data
   * Used for migration scenarios when data format changes
   */
  public async triggerResync(): Promise<void> {
    console.log('🔄 Starting migration resync...');
    try {
      await this.syncService.resync();
      console.log('✅ Migration resync completed successfully');
    } catch (error) {
      console.error('❌ Migration resync failed:', error);
      throw error;
    }
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
    return this.getDb()
      .then(async db => {
        const txsTable = db.table('transactions');
        if (txsTable) {
          // Use centralized conversion logic from converter.ts
          const convertedTxs = convertTransactionsForStorage(txs, WalletStore.state.utxos);

          // Get existing transactions by their IDs
          const txIds = convertedTxs.map(tx => tx.id);
          const existingTxs = await txsTable.where('id').anyOf(txIds).toArray();

          // Create a map of existing transactions for quick lookup
          const existingTxMap = new Map(existingTxs.map(tx => [tx.id, tx]));

          // Separate new transactions from those with pending status changes
          const txsToUpdate = [];

          convertedTxs.forEach(newTx => {
            const existingTx = existingTxMap.get(newTx.id);

            if (!existingTx) {
              // Transaction doesn't exist - it's new, add it
              txsToUpdate.push(newTx);
            } else if (existingTx.pending !== newTx.pending) {
              // Transaction exists but pending status changed - update it
              txsToUpdate.push(newTx);
            }
            // Otherwise, transaction exists and hasn't changed - skip it
          });

          // Only update if there are changes
          if (txsToUpdate.length > 0) {
            console.debug(`Saving ${txsToUpdate.length} transactions to database (${convertedTxs.length} total processed)`);
            await txsTable.bulkPut(txsToUpdate);
          } else {
            console.debug(`No transaction updates needed - all ${convertedTxs.length} transactions unchanged`);
          }
        }
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setEpochParams(epoch_params: any): Promise<void> {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    const epochParamsTable = blockchainDB.table('epoch_params');
    const key = Object.keys(epoch_params)[0];
    if (epochParamsTable) {
      epochParamsTable.put({
        epoch: key,
        ...epoch_params[key],
      });
    }
  }

  resolvePathsForMissingAddresses(usedAddresses: string[]): any {
    const resolvedAddresses: any[] = [];
    let addressIndex: number = 0; // Start from the first address index
    let consecutiveUnused: number = 0; // Track consecutive unused addresses
    const keys = {
      stake: [
        {
          address: this.stakeAddress,
          path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.CHIMERIC_ACCOUNT}/${addressIndex}`,
          cred: Hash28ByteBase16(getStakeKey(this.publicKey, 0).hash().hex()),
        },
      ],
      payment: [],
      change: [],
      ccCold: [
        {
          path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.CONSTITUTIONAL_COMMITTEE_COLD}/${addressIndex}`,
          cred: Hash28ByteBase16(getCcColdKey(this.publicKey, 0).hash().hex()),
        },
      ],
      ccHot: [
        {
          path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.CONSTITUTIONAL_COMMITTEE_HOT}/${addressIndex}`,
          cred: Hash28ByteBase16(getCcHotKey(this.publicKey, 0).hash().hex()),
        },
      ],
      drep129: [
        {
          address: getCip129DrepId(this.publicKey),
          path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.DREP}/${addressIndex}`,
          cred: Hash28ByteBase16(getDrepKey(this.publicKey, 0).hash().hex()),
        },
      ],
      drep105: [
        {
          address: getCip105DrepId(this.publicKey),
          path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.DREP}/${addressIndex}`,
          cred: Hash28ByteBase16(getDrepKey(this.publicKey, 0).hash().hex()),
        },
      ],
      script: [],
    };
    while (consecutiveUnused < BIP44_SCAN_SIZE) {
      const derivedAddress: string = this.deriveExternalAddressFromPath(addressIndex).toBech32();
      const internalDerivedAddress: string = this.deriveInternalAddressFromPath(addressIndex).toAddress().toBech32();
      let found: boolean = false;
      const derivedPaymentAddress = {
        address: derivedAddress,
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.EXTERNAL}/${addressIndex}`,
        cred: keyHashFromAddress(derivedAddress),
        used: false,
      };
      if (usedAddresses.includes(derivedAddress)) {
        resolvedAddresses.push(derivedPaymentAddress);
        consecutiveUnused = 0;
        derivedPaymentAddress.used = true;
        found = true;
      }
      keys.payment.push(derivedPaymentAddress);
      const derivedChangeAddress = {
        address: internalDerivedAddress,
        path: `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'/${ChainDerivations.INTERNAL}/${addressIndex}`,
        cred: keyHashFromAddress(internalDerivedAddress),
        used: false,
      };
      if (usedAddresses.includes(internalDerivedAddress)) {
        resolvedAddresses.push(derivedChangeAddress);
        consecutiveUnused = 0;
        derivedChangeAddress.used = true;
        found = true;
      }
      keys.change.push(derivedChangeAddress);
      if (!found) {
        consecutiveUnused++; // Increment unused address counter if no match is found
      }
      // If we've resolved all missing addresses, we can break earlyCardano.
      if (usedAddresses.length === resolvedAddresses.length) {
        break;
      }
      addressIndex++; // Move to the next address index
    }
    return keys;
  }

  deriveExternalAddressFromPath(addressIndex: number): Cardano.Address {
    return getAddress(this.publicKey, this.chain, this.network, addressIndex);
  }

  deriveInternalAddressFromPath(addressIndex) {
    return Cardano.BaseAddress.fromCredentials(
      this.networkId(),
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(this.paymentKeyInternal(addressIndex).hash().hex()),
      },
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(this.stakeKey().hash().hex()),
      }
    );
  }

  paymentKeyExternal(index: number): Ed25519PublicKey {
    return getPaymentKeyExternal(this.publicKey, index);
  }

  paymentKeyInternal(index: number): Ed25519PublicKey {
    return getPaymentKeyInternal(this.publicKey, index);
  }

  stakeKey(): Ed25519PublicKey {
    return getStakeKey(this.publicKey, 0);
  }

  drepKey(): Ed25519PublicKey {
    return getDrepKey(this.publicKey, 0);
  }

  requestAccountKey(
    password: string,
    accountIndex: number
  ): {
    accountKey: Bip32PrivateKey;
    paymentKey: Ed25519PrivateKey;
    stakeKey: Ed25519PrivateKey;
    drepKey: Ed25519PrivateKey;
  } {
    let accountKey: Bip32PrivateKey;
    try {
      const decrypted = decrypt(this.encryptedPrivateKey, password);
      const buffer: Buffer = decryptWithPassword(password, JSON.parse(decrypted));
      accountKey = Bip32PrivateKey.fromBytes(buffer).derive([
        WalletTypePurpose.CIP1852,
        CoinTypes.CARDANO,
        HARDENED + accountIndex,
      ]);
    } catch (e) {
      throw ERROR.wrongPassword;
    }

    return {
      accountKey,
      paymentKey: accountKey.derive([ChainDerivations.EXTERNAL, 0]).toRawKey(),
      stakeKey: accountKey.derive([ChainDerivations.CHIMERIC_ACCOUNT, 0]).toRawKey(),
      drepKey: accountKey.derive([ChainDerivations.DREP, 0]).toRawKey(),
    };
  }

  async restore(tip: Tip): Promise<void> {
    const prevAccountInfo = await this.getAccountInfo();

    // Create an array to hold the promises that need to be awaited
    const promises = [];

    // Sync account info and handle rewards and transactions
    promises.push(
      this.syncService.syncAccountInfo().then(async accountInfo => {
        if (accountInfo) {
          if (!prevAccountInfo || Number(prevAccountInfo.rewards_sum) != Number(accountInfo.rewards_sum)) {
            await this.syncService.syncAccountRewards();
          }
          if (
            !prevAccountInfo ||
            Number(prevAccountInfo.controlled_amount) != Number(accountInfo.controlled_amount) /* TODO Add Pool ID ?*/
          ) {
            await this.syncService.syncAccountTransactions(0);
          }
        }
      })
    );

    // Wait for all promises to complete
    await Promise.all(promises);

    // Set the last sync info once everything is done
    await this.setLastSyncInfo(tip);
  }

  verifySpendingPassword(password: string) {
    try {
      const decrypted = decrypt(this.encryptedPrivateKey, password);
      decryptWithPassword(password, JSON.parse(decrypted));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Cardano JS SDK transaction signing method
   * @param txInput - Either a CBOR hex string or Cardano.Tx object (Cardano JS SDK)
   * @param partialSign - Whether this is a partial signing operation
   * @param password - Wallet password for software wallets
   * @param accountIndex - Account index for derivation
   * @param utxos - UTXOs for reference
   * @param addresses - Address mappings (key-value pairs of addresses)
   * @param mergeWitnesses - Whether to merge existing witnesses into the transaction
   * @returns Promise with witness set hex string
   */
  async signTx(
    txInput: string | Cardano.Tx,
    partialSign: boolean = false,
    password: string,
    accountIndex: number,
    utxos: Cardano.Utxo[],
    addresses: Keys,
    mergeWitnesses: boolean = false,
  ): Promise<{ witnesses: string }> {
    let transaction: Cardano.Tx;

    // Convert input to Cardano JS SDK transaction
    if (typeof txInput === 'string') {
      // Deserialize CBOR hex string to Cardano JS SDK transaction
      transaction = deserializeCardanoJsSdkTx(txInput);
    } else {
      // Already a Cardano JS SDK transaction object
      transaction = txInput;
    }
    // Decrypt private key
    const decrypted = decrypt(this.encryptedPrivateKey, password);
    const decodedHash = decryptWithPassword(password, JSON.parse(decrypted));
    password = null;

    if (!decodedHash && partialSign === false) {
      throw TxSignError.ProofGeneration;
    }

    const rootPrivateKey: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash);

      // Derive an account private key
      const accountPrivateKey: Bip32PrivateKey = rootPrivateKey.derive([
        WalletTypePurpose.CIP1852,
        CoinTypes.CARDANO,
        HARDENED + accountIndex,
      ]);

      // Create a signature map for the witness
      const signatures = new Map<string, string>();

    // Analyze transaction to determine required signatures
    const requiredSigners = analyzeTransactionForSignatures(
      transaction,
      utxos,
      addresses,
      accountIndex,
      this.stakeAddress,
      this.paymentKeyExternal.bind(this),
      this.stakeKey.bind(this)
    );

    console.debug('🔍 Required signers analysis:');
    console.debug(`  Found ${requiredSigners.length} required signers`);
    requiredSigners.forEach((signer, index) => {
      console.debug(`  Signer ${index}: type=${signer.type}, path=[${signer.derivationPath.join(',')}]`);
    });

    // Sign with each required key
    for (const signer of requiredSigners) {
      console.debug(`🔏 Signing with ${signer.type} key, derivation path: [${signer.derivationPath.join(',')}]`);

        const privateKey: Bip32PrivateKey = accountPrivateKey.derive(signer.derivationPath);
        const rawPublicKey: Ed25519PublicKey = privateKey.toRawKey().toPublic();

        // Sign the transaction hash as a HexBlob type
        const signature = privateKey.toRawKey().sign(HexBlob(transaction.id));

      // Use the raw public key bytes (32 bytes) for the witness map, not the extended key
      const rawPublicKeyBytes = rawPublicKey.bytes();
      const rawPublicKeyHex = Buffer.from(rawPublicKeyBytes).toString('hex');

      console.debug(`  Public key: ${rawPublicKeyHex}`);
      console.debug(`  Signature: ${signature.hex().substring(0, 20)}...`);

        signatures.set(rawPublicKey.hex(), signature.hex());
      }

    console.debug(`🔏 Total signatures created: ${signatures.size}`);
    console.debug('🔏 Signature map entries:');
    signatures.forEach((sig, pubKey) => {
      console.debug(`  ${pubKey}: ${sig.substring(0, 20)}...`);
    });

      // Create a witness set - ensure a signature map is properly set
      const witness: Cardano.Witness = {
        signatures: new Map(signatures), // Create a new Map to ensure it's properly set
      };
      if (mergeWitnesses) {
        // Merge existing signatures with new ones
        if (transaction.witness?.signatures) {
          transaction.witness.signatures.forEach((sig, pubKey) => {
            witness.signatures.set(pubKey, sig);
          });
        }
        witness.scripts = transaction.witness?.scripts
        witness.datums = transaction.witness?.datums
        witness.redeemers = transaction.witness?.redeemers
        witness.bootstrap = transaction.witness?.bootstrap
      }

    // Serialize witness to CBOR hex
    const witnessHex = serializeWitness(witness);

    return {
      witnesses: witnessHex,
    };

  }

  /**
   * Submit transaction using Cardano JS SDK
   * @param txInput - Either a legacy Transaction object, CBOR hex string, or Cardano.Tx object (Cardano JS SDK)
   * @param utxos - UTXOs for transaction schema conversion
   * @returns Promise with transaction ID
   */
  async submitTx(txInput: string | Cardano.Tx, utxos: any[]): Promise<string> {
    let txCbor: string;

    // Handle different input types and convert to CBOR hex
    if (typeof txInput === 'string') {
      // Already a CBOR hex string
      txCbor = txInput;
    } else {
      // Cardano JS SDK transaction object
      txCbor = Serialization.Transaction.fromCore(txInput).toCbor();
    }

    try {
      // Submit transaction via API
      const txId = await this.api.submitTx(txCbor);

      // Create transaction record using sync service pattern
      const txDeserialized: Cardano.Tx = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(txCbor));
      const pendingTx = {
        id: txId, // Required for a database key path
        tx_hash: txId,
        block_hash: '',
        block_height: 0,
        epoch_no: 0,
        absolute_slot: 0,
        tx_timestamp: Math.floor(Date.now() / 1000),
        tx_size: 0,
        cbor: txCbor,
        pending: true,
        utxo: null, // No UTXO data for submitted transactions
        ...txDeserialized, // Spreads body, witness, auxiliaryData, isValid, etc.
      };

      // Store transaction in a database
      this.setAccountTransactions([pendingTx]).catch(e => console.error('Error storing transaction:', e));

      return txId;
    } catch (error) {
      console.error('Transaction submission error:', error);

      // Handle different error types
      if (error['response']?.status === 400) {
        throw new Error(TxSendError.Failure.info.concat('', ' ', JSON.stringify(error['response'].data)));
      } else if (error['response']?.status === 500) {
        throw new Error(APIError.InternalError.info);
      } else if (error['response']?.status === 429) {
        throw new Error(TxSendError.Refused.info);
      } else if (error['response']?.status === 425) {
        throw new Error(ERROR.fullMempool);
      } else {
        throw new Error(APIError.InvalidRequest.info.concat('', ' ', JSON.stringify(error['response'].data)));
      }
    }
  }

  async signData(
    address: Cardano.PaymentAddress | Cardano.RewardAccount | string,
    payload: string,
    password: string,
    accountIndex: number,
  ) {
    let signatureHex: string, keyHex: string;
    const addr: Cardano.PaymentAddress | Cardano.RewardAccount = addrToSignWith(address);
    const addressBytes = toHexArray(Cardano.Address.fromBech32(addr).toBytes());
    const credential: Cardano.Credential = toPaymentCredential(Cardano.Address.fromBech32(addr));
    const keyHash: string = credential.hash;
    let accountKey: Ed25519PrivateKey;
    const { paymentKey, stakeKey, drepKey } = this.requestAccountKey(password, accountIndex);
    if (keyHash === this.paymentKeyExternal(0).hash().hex()) {
      accountKey = paymentKey;
    } else if (keyHash === this.paymentKeyInternal(0).hash().hex()) {
      accountKey = paymentKey;
    } else if (keyHash === this.stakeKey().hash().hex()) {
      accountKey = stakeKey;
    } else if (keyHash === this.drepKey().hash().hex()) {
      accountKey = drepKey;
    } else {
      throw DataSignError.ProofGeneration;
    }
    const builder: COSESign1Builder = createSignDataBuilder(addressBytes, payload);
    const toSign = builder.make_data_to_sign().to_bytes();
    signatureHex = buildAndSignData(builder, toSign, accountKey);
    const coseKey = createCoseKey(addressBytes, accountKey.toPublic().hex());
    keyHex = util.bytesToHex(coseKey.to_bytes());
    return { signature: signatureHex, key: keyHex };
  }

  isEnterpriseAddress(): boolean {
    return Cardano.Address.fromBech32(this.baseAddress).getType() === Cardano.AddressType.EnterpriseScript;
  }

  public async getDb(): Promise<Dexie> {
    return getDb(this.id);
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
        throw err; // or return null, depending on your error-handling strategy
      }
    }

    return blockchainDb;
  }

  async startSync() {
    this.endSync();

    const updateTickerStatistics = async () => {
      try {
        const tickerStatistics = await this.api.fetchTickerStatistics();
        NetworkStore.setPrice(tickerStatistics);
      } catch (err) {
        // Ignore ticker statistics errors
      }
    };

    const updateFiatRates = async () => {
      try {
        const fiatRates = await this.api.fetchFiatRates();
        WalletStore.setFiatRates(fiatRates);
      } catch (err) {
        // Ignore fiat rates errors
      }
    };

    if (!NetworkStore.state.tickerStatisticsIntervalId) {
      await updateTickerStatistics();
      NetworkStore.setTickerStatisticsIntervalId(setInterval(updateTickerStatistics, 20000));
    }

    if (!WalletStore.state.fiatRatesIntervalId) {
      await updateFiatRates();
      WalletStore.setFiatRatesIntervalId(setInterval(updateFiatRates, 14400000));
    }
  }

  endSync() {
    if (WalletStore.state.fiatRatesIntervalId) {
      clearInterval(WalletStore.state.fiatRatesIntervalId);
      WalletStore.setFiatRatesIntervalId(null);
    }

    if (NetworkStore.state.tickerStatisticsIntervalId) {
      clearInterval(NetworkStore.state.tickerStatisticsIntervalId);
      NetworkStore.setTickerStatisticsIntervalId(null);
    }
  }
}

export function alarmListener(alarm) {

  if (alarm.name === 'refreshDexHunterPrices') {
    DexHunterStore.updatePrices(Object.keys(WalletStore.state.tokens));
  } else if (
    alarm.name === 'refreshXerberusRisks' &&
    WalletStore.state.account &&
    Number(WalletStore.state.account.controlled_amount) > 0
  ) {
    XerberusStore.updateRisks(Object.values(WalletStore.state.tokens).map((token: any) => token.fingerprint));
  } else if (alarm.name === 'refreshTokenHistory') {
    RealFiStore.updateTokenHistory(Object.values(WalletStore.state.tokens).map((token: any) => token.unit));
  } else if (
    alarm.name.includes('portfolio') &&
    WalletStore.state.account &&
    Number(WalletStore.state.account.controlled_amount) > 0
  ) {
    const stakeAddress = alarm.name.split('|')[1];
    TapToolsStore.loadPortfolio(stakeAddress);
  } else if (alarm.name === 'coinGeckoPrices') {
    CoinGeckoStore.updatePrices();
  }
}
