import Dexie from 'dexie';
import { type StoredTransaction } from '@/models/transaction.types';
import { Api } from '@/api/api';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { APIError, TxSendError } from '@/chrome/config';
import networks from '@/utils/networks';
import { blockChainDBSchema, blockChainDBVersion } from '@/db/schema';
import {
  Blockchain,
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
  convertTransactionsForStorage,
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
  hdPathToArray,
  keyHashFromAddress,
  toStakeAddress,
} from '@/chrome/serialization';
import { decryptWithPassword, decrypt } from '@/shared/utils/crypto';
import { deriveBitcoinAddress } from '@/chains/bitcoin/bitcoinKeyManager';
import WalletStore from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import {
  analyzeTransactionForSignatures,
  findCollectionDescription,
  findCollectionName,
  longestCommonStartingSubstring,
  resolveAsset,
} from '@/shared/utils/resolver';
import { getDb } from '@/db/wallet-db';
import MusicStore from '@/stores/musicStore';
import SyncService from '@/services/sync.service';
import { LoaderFactory } from '@/db/loaders';
import { Buffer } from 'buffer';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import {
  Hash28ByteBase16,
  Bip32PrivateKey,
  Ed25519PrivateKey,
  Ed25519PublicKey,
} from '@cardano-sdk/crypto';
import { debugLog } from '@/utils/debug';
import type { GroupedAddress } from '@/chrome/serialization';
import { signDataCip8 } from '@/chrome/serialization';

let blockchainDb: Dexie = null;

export class WalletBg {
  api: Api;
  syncService: SyncService;
  loaderFactory: LoaderFactory;


  id: number;
  name: string;
  icon: string;
  type: string;
  theme: string;
  order: number;
  chain: string;
  network: string;
  addressType?: string;
  publicKey: string;
  provider: Provider;
  btSupported: boolean;
  xfp?: string;

  encryptedPrivateKey: string;
  passwordLastUpdate: Date;
  userId?: string;
  encryptedMnemonic?: string;
  baseAddress: string;
  stakeAddress?: string;
  token?: string;
  // PRF Encryption Support (Version 14+)
  encryptionMethod?: 'password' | 'prf';
  prfEncryptedPrivateKey?: string;
  prfEncryptedMnemonic?: string;
  webAuthnCredentialId?: string;
  prfSpendingPassword?: string;

  constructor(wallet: any, googleBaseAddress?: string) {
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
    // PRF encryption fields
    this.encryptionMethod = wallet.encryptionMethod;
    this.prfEncryptedPrivateKey = wallet.prfEncryptedPrivateKey;
    this.prfEncryptedMnemonic = wallet.prfEncryptedMnemonic;
    this.webAuthnCredentialId = wallet.webAuthnCredentialId;
    this.prfSpendingPassword = wallet.prfSpendingPassword;
    this.addressType = wallet.addressType || 'segwit';  // Version 15+
    this.provider = networks.resolveDefaultProvider(this.chain, this.network);
    this.btSupported = wallet.btSupported;
    this.xfp = wallet.xfp; // xfp is validated during wallet creation
    this.api = new Api(wallet, this.provider);

    // Chain-specific address derivation
    if (this.chain === Blockchain.BITCOIN) {
      // Bitcoin address derivation (synchronous)
      this.baseAddress = deriveBitcoinAddress(
        this.publicKey,
        this.network,
        this.addressType,
        0,  // External chain (receive addresses)
        0   // Address index 0
      );
      this.stakeAddress = '';  // Bitcoin has no staking address
      console.log('✅ Bitcoin address initialized:', this.baseAddress);
    } else if (wallet.type === WalletType.Google) {
      // Google wallet (Cardano)
      this.baseAddress = googleBaseAddress
      this.stakeAddress = toStakeAddress(googleBaseAddress, networks.resolveNetworkId(wallet.chain, wallet.network) as Cardano.NetworkId)
    } else {
      // Normal Cardano wallet
      this.baseAddress = getAddress(this.publicKey, this.chain, this.network, 0).toBech32();
      this.stakeAddress = getRewardAddress(this.publicKey, this.chain, this.network).toBech32();
    }
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

  /**
   * Apply UTxOs: set on store, resolve assets, persist to DB.
   * Called on login (from DB) and when server UTxOs arrive.
   */
  async applyUtxos(utxos: Cardano.Utxo[], persist = false) {
    if (!utxos || utxos.length === 0) return;

    // Defense-in-depth: filter to only UTxOs matching wallet's payment credentials
    const myCredentials = new Set(this.derivePaymentCredentials());
    const filtered = utxos.filter(([, txOut]) => {
      try {
        const addr = Cardano.Address.fromString(txOut.address as string);
        const baseAddr = addr?.asBase();
        if (!baseAddr) return true; // keep non-base addresses (enterprise, etc.)
        const paymentCred = baseAddr.getPaymentCredential().hash;
        return myCredentials.has(paymentCred);
      } catch {
        return true; // keep if we can't parse
      }
    });
    if (filtered.length !== utxos.length) {
      debugLog(`🔒 Credential filter: ${utxos.length} → ${filtered.length} UTxOs (${utxos.length - filtered.length} Franken removed)`);
    }
    utxos = filtered;

    const uniqueAssets: Set<string> = new Set<string>();
    for (const [, txOut] of utxos) {
      if (txOut.value.assets) {
        txOut.value.assets.keys().forEach((key: string) => uniqueAssets.add(key));
      }
    }

    debugLog(`📦 applyUtxos: ${utxos.length} UTxOs, ${uniqueAssets.size} assets, persist=${persist}`);

    await this.syncService.syncAssets(Array.from(uniqueAssets));
    this.setAssets(utxos);
    WalletStore.setUtxos(utxos);

    // Persist to per-wallet DB so UTxOs survive logout
    if (persist) {
      try {
        const db = await this.getDb();
        const table = db.table('utxos');
        await table.clear();
        // Store as serializable objects (BigInt → string, Map → array of entries)
        const serialized = utxos.map(([txIn, txOut]) => ({
          txId: txIn.txId,
          index: txIn.index,
          address: txOut.address,
          coins: txOut.value.coins.toString(),
          assets: txOut.value.assets ? Array.from(txOut.value.assets.entries()).map(([k, v]) => ({ unit: k, quantity: v.toString() })) : [],
          datumHash: txOut.datumHash || null,
          datum: txOut.datum || null,
          scriptReference: txOut.scriptReference || null,
        }));
        await table.bulkPut(serialized);
      } catch (e) {
        debugLog('Failed to persist UTxOs:', e);
      }
    }
  }

  /**
   * Load persisted UTxOs from per-wallet DB. Fast — no server needed.
   */
  public async loadCachedUtxos() {
    try {
      const db = await this.getDb();
      const table = db.table('utxos');
      const rows = await table.toArray();
      if (!rows || rows.length === 0) return;

      debugLog(`📦 Loading ${rows.length} persisted UTxOs from DB`);

      // Reconstruct Cardano.Utxo[] from serialized rows
      const utxos: Cardano.Utxo[] = rows.map((row: any) => {
        const assets = new Map<Cardano.AssetId, bigint>();
        if (row.assets) {
          for (const a of row.assets) {
            assets.set(Cardano.AssetId(a.unit), BigInt(a.quantity));
          }
        }
        return [
          {
            txId: Cardano.TransactionId(row.txId),
            index: row.index,
            address: row.address as Cardano.PaymentAddress,
          },
          {
            address: row.address as Cardano.PaymentAddress,
            value: { coins: BigInt(row.coins), assets: assets.size > 0 ? assets : undefined },
            datumHash: row.datumHash || undefined,
            datum: row.datum || undefined,
            scriptReference: row.scriptReference || undefined,
          },
        ] as Cardano.Utxo;
      });

      await this.applyUtxos(utxos);
    } catch (e) {
      debugLog('Failed to load cached UTxOs:', e);
    }
  }

  /**
   * Load persisted keys from per-wallet DB so the receive dialog works before first sync.
   */
  public async loadCachedKeys() {
    try {
      const db = await this.getDb();
      const table = db.table('addresses');
      const row = await table.where({ address: this.publicKey }).first();
      if (row?.resolvedKeys) {
        debugLog('🔑 Loading cached keys from DB');
        WalletStore.setKeys(row.resolvedKeys);
      }
    } catch (e) {
      debugLog('Failed to load cached keys:', e);
    }
  }

  /**
   * Dexie subscription callback — kept for Bitcoin wallets only.
   * Cardano UTxOs come from server via applyUtxos().
   */
  async setUtxosAndAddresses(transactions: StoredTransaction[]) {
    if (this.chain === Blockchain.BITCOIN) {
      debugLog('🔄 setUtxosAndAddresses (Bitcoin) with', transactions?.length || 0, 'transactions');
      return;
    }
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
    const isStakingSupported = networks.resolveStakingSupport(this.chain, this.network);
    if (!this.isEnterpriseAddress() && isStakingSupported) {
      chrome.alarms.create('refreshStakingPools', { delayInMinutes: 0, periodInMinutes: 240 });
    }
    if (!this.isEnterpriseAddress() && networks.resolveGovernanceSupport(this.chain, this.network)) {
      chrome.alarms.create('refreshDReps', { delayInMinutes: 0, periodInMinutes: 280 });
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
        debugLog(`Failed to open database: ${err.stack || err}`);
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

    // Synthesize lovelace token from account when UTxOs aren't available (e.g. preprod/testnet)
    const controlled = Number(accountInfo.controlled_amount);
    if (controlled > 0 && WalletStore.state.utxos.length === 0) {
      const network = networks.resolveNetwork(this.chain, this.network);
      WalletStore.setTokens({
        lovelace: {
          unit: 'lovelace',
          name: network?.currencyName,
          policy_id: '',
          img: network?.currencyImage,
          quantity: accountInfo.controlled_amount,
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
        },
      });
    }

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
          const convertedTxs = convertTransactionsForStorage(txs, WalletStore.state.utxos as Cardano.Utxo[]);

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
            } else if (
              existingTx.pending !== newTx.pending ||
              existingTx.tx_timestamp !== newTx.tx_timestamp ||
              // Re-enrich thin records: a tx previously stored UTxO-only (no deserialized
              // body/witness — e.g. synced before CBOR support or during a cbor-fetch miss)
              // must be overwritten once we now have a body, so the detail view can render
              // certificates/datum/redeemers/metadata instead of only UTxOs.
              (!existingTx.body && !!newTx.body)
            ) {
              // Transaction exists but pending status, timestamp, or body enrichment changed - update it
              txsToUpdate.push(newTx);
            }
          });

          // Only update if there are changes
          if (txsToUpdate.length > 0) {
            debugLog(`Saving ${txsToUpdate.length} transactions to database (${convertedTxs.length} total processed)`);
            await txsTable.bulkPut(txsToUpdate);

            // IMPORTANT ARCHITECTURAL PATTERN:
            // Don't manually call WalletStore.setTransactions() here. Instead, rely on the
            // Dexie subscription pattern used throughout the codebase:
            //   1. Database write (bulkPut) triggers Dexie subscription
            //   2. TransactionsLoader in walletLoader.ts processes ALL transactions
            //   3. Loader calculates derived fields (ada, assets, sentAssets, receivedAssets)
            //   4. Loader updates WalletStore with fully processed transactions
            //
            // This ensures consistent processing for both pending and confirmed transactions
            // and prevents duplicate processing or stale data issues.
          } else {
            debugLog(`No transaction updates needed - all ${convertedTxs.length} transactions unchanged`);
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
      // Early exit optimization: If we've found all used addresses AND scanned 20 consecutive
      // unused addresses after the last used one, we can stop early.
      // This maintains BIP44 gap limit compliance while avoiding unnecessary scanning.
      if (usedAddresses.length > 0 &&
          usedAddresses.length === resolvedAddresses.length &&
          consecutiveUnused >= BIP44_SCAN_SIZE) {
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

  /** Current credential derivation range (indices 0..N-1 per chain) */
  private credentialRange = 20;

  /**
   * Derive payment credential hashes (blake2b-224) for external and internal chains.
   */
  derivePaymentCredentials(): string[] {
    const credentials: string[] = [];
    for (let i = 0; i < this.credentialRange; i++) {
      credentials.push(getPaymentKeyExternal(this.publicKey, i).hash().hex());
    }
    for (let i = 0; i < this.credentialRange; i++) {
      credentials.push(getPaymentKeyInternal(this.publicKey, i).hash().hex());
    }
    return credentials;
  }

  /**
   * Check if server-provided addresses are all covered by current credentials.
   * If not, expand the range and return the new full set. Returns null if no expansion needed.
   */
  expandCredentialsIfNeeded(serverAddresses: string[]): string[] | null {
    if (!serverAddresses || serverAddresses.length === 0) return null;

    const currentCreds = new Set(this.derivePaymentCredentials());
    let needsExpansion = false;

    for (const addr of serverAddresses) {
      try {
        const parsed = Cardano.Address.fromString(addr);
        const baseAddr = parsed?.asBase();
        if (!baseAddr) continue;
        const paymentCred = baseAddr.getPaymentCredential().hash;
        if (!currentCreds.has(paymentCred)) {
          needsExpansion = true;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!needsExpansion) return null;

    // Double the range and re-derive
    this.credentialRange = Math.min(this.credentialRange * 2, 500);
    debugLog(`🔑 Expanding credential range to ${this.credentialRange} per chain`);
    return this.derivePaymentCredentials();
  }

  stakeKey(): Ed25519PublicKey {
    return getStakeKey(this.publicKey, 0);
  }

  /**
   * Decrypt root private key (supports both password and PRF encryption)
   *
   * @param password - Spending password (may be optional for PRF wallets without passwordUnlockEnabled)
   * @returns Promise<Bip32PrivateKey> - Decrypted root private key
   * @throws Error if decryption fails or password is incorrect
   */
  private async decryptRootPrivateKey(password?: string): Promise<Bip32PrivateKey> {
    if (this.encryptionMethod === 'prf') {
      // ============================================================================
      // PRF DECRYPTION MODE
      // ============================================================================

      if (!this.prfEncryptedPrivateKey || !this.webAuthnCredentialId) {
        throw new Error('PRF wallet missing required encrypted data or credential ID');
      }

      // Step 1: Verify spending password if required (password unlock enabled)
      if (this.prfSpendingPassword) {
        if (!password) {
          throw ERROR.wrongPassword; // Password required but not provided
        }

        const { verifySpendingPassword } = await import('@/shared/utils/webauthn-prf');
        const isValid = await verifySpendingPassword(password, this.prfSpendingPassword);

        if (!isValid) {
          throw ERROR.wrongPassword;
        }
      }

      // Step 2: Decrypt private key with PRF (requires biometric authentication)
      const { decryptPrivateKeyWithPrf } = await import('@/shared/utils/webauthn-prf');

      try {
        const privateKeyBytes = await decryptPrivateKeyWithPrf(
          this.prfEncryptedPrivateKey,
          this.webAuthnCredentialId,
          this.id.toString()
        );

        return Bip32PrivateKey.fromBytes(privateKeyBytes);
      } catch (error: any) {
        // User cancelled or PRF evaluation failed
        if (error.message?.includes('cancelled')) {
          throw new Error('Biometric authentication was cancelled');
        }
        throw new Error(`Failed to decrypt private key with PRF: ${error.message}`);
      }

    } else {
      // ============================================================================
      // PASSWORD DECRYPTION MODE (EXISTING)
      // ============================================================================

      if (!password) {
        throw ERROR.wrongPassword;
      }

      try {
        const decrypted = decrypt(this.encryptedPrivateKey, password);
        const buffer: Buffer = decryptWithPassword(password, JSON.parse(decrypted));
        return Bip32PrivateKey.fromBytes(buffer);
      } catch (e) {
        throw ERROR.wrongPassword;
      }
    }
  }

  async requestAccountKey(
    type: 'stake' | 'payment' | 'change' | 'drep',
    password: string,
    accountIndex: number,
    index: number,
  ): Promise<Ed25519PrivateKey> {
    // Decrypt root private key (supports both password and PRF encryption)
    const rootKey = await this.decryptRootPrivateKey(password);

    return this.deriveAccountKey(rootKey, type, accountIndex, index);
  }

  /**
   * Derive an account key from pre-decrypted root private key bytes (PRF
   * wallets — the root key was already decrypted in the browser context via
   * the WebAuthn PRF extension, mirroring signTx's privateKeyBytes path).
   *
   * Uses the SAME derivation as requestAccountKey; the only difference is the
   * root key comes from Bip32PrivateKey.fromBytes() instead of decrypt.
   */
  private requestAccountKeyFromBytes(
    type: 'stake' | 'payment' | 'change' | 'drep',
    privateKeyBytes: Uint8Array,
    accountIndex: number,
    index: number,
  ): Ed25519PrivateKey {
    const rootKey: Bip32PrivateKey = Bip32PrivateKey.fromBytes(privateKeyBytes);
    return this.deriveAccountKey(rootKey, type, accountIndex, index);
  }

  /**
   * Shared CIP-1852 derivation used by both the password (requestAccountKey)
   * and PRF (requestAccountKeyFromBytes) paths. Keeps the two byte-for-byte
   * identical so PRF signatures match password signatures.
   */
  private deriveAccountKey(
    rootKey: Bip32PrivateKey,
    type: 'stake' | 'payment' | 'change' | 'drep',
    accountIndex: number,
    index: number,
  ): Ed25519PrivateKey {
    // Derive account key
    const accountKey: Bip32PrivateKey = rootKey.derive([
      WalletTypePurpose.CIP1852,
      CoinTypes.CARDANO,
      HARDENED + accountIndex,
    ]);

    // Derive specific key type
    if (type === 'stake') {
      return accountKey.derive([ChainDerivations.CHIMERIC_ACCOUNT, index]).toRawKey();
    } else if (type === 'payment') {
      return accountKey.derive([ChainDerivations.EXTERNAL, index]).toRawKey()
    } else if (type === 'change') {
      return accountKey.derive([ChainDerivations.INTERNAL, index]).toRawKey()
    } else { //drep
      return accountKey.derive([ChainDerivations.DREP, index]).toRawKey()
    }
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

  /**
   * Fetch Bitcoin UTXOs from the Bitcoin API
   * @returns Promise<IUnifiedUtxo[]> Array of unified UTXOs
   */
  async fetchBitcoinUtxos(): Promise<any[]> {
    const { BitcoinApi } = await import('@/api/bitcoin-api');
    const { parseBitcoinUtxos } = await import('@/chains/bitcoin/bitcoinUtxoManager');
    const { deriveBitcoinAddress: deriveBtcAddr } = await import('@/chains/bitcoin/bitcoinKeyManager');

    const bitcoinApi = new BitcoinApi({ chain: this.chain, network: this.network }, this.provider);

    try {
      // Build a reverse lookup: address -> { chain, index } from discovered addresses.
      // Scan external (chain=0) and change (chain=1) using BIP44 gap limit (20).
      const GAP_LIMIT = 20;
      const addressToDerivation = new Map<string, { chain: number; index: number }>();

      // Fetch UTXOs for all discovered addresses, deduplicating by txHash:index
      const allUtxos: any[] = [];
      const utxoSeen = new Set<string>();

      for (const chain of [0, 1]) {
        let consecutiveUnused = 0;
        let idx = 0;
        while (consecutiveUnused < GAP_LIMIT) {
          const addr = deriveBtcAddr(this.publicKey, this.network, this.addressType || 'segwit', chain, idx);
          let rawUtxos: any[] = [];
          try {
            rawUtxos = await bitcoinApi.getUtxos(addr);
          } catch (err) {
            // Skip addresses that fail; don't break the whole fetch
            console.warn(`Failed to fetch UTXOs for ${addr}:`, err);
          }

          if (rawUtxos.length > 0) {
            consecutiveUnused = 0; // Reset gap counter on used address
            const parsed = parseBitcoinUtxos(rawUtxos, addr);
            for (const utxo of parsed) {
              const key = `${utxo.txHash}:${utxo.index}`;
              if (!utxoSeen.has(key)) {
                utxoSeen.add(key);
                utxo.derivationChain = chain;
                utxo.derivationIndex = idx;
                allUtxos.push(utxo);
              }
            }
          } else {
            consecutiveUnused++;
          }
          addressToDerivation.set(addr, { chain, index: idx });
          idx++;
        }
      }

      debugLog(`📦 Fetched ${allUtxos.length} Bitcoin UTXOs across ${addressToDerivation.size} addresses`);

      return allUtxos;
    } catch (error) {
      console.error('Failed to fetch Bitcoin UTXOs:', error);
      throw error;
    }
  }

  /**
   * Sync Bitcoin wallet data (UTXOs and balance)
   * Called during wallet login and periodic sync
   */
  async syncBitcoinWallet(): Promise<void> {
    try {
      debugLog('🔄 Syncing Bitcoin wallet...');

      // Fetch UTXOs
      const utxos = await this.fetchBitcoinUtxos();

      // Update wallet store with UTXOs (balance is calculated automatically in setUtxos)
      WalletStore.setUtxos(utxos);

      debugLog('✅ Bitcoin wallet sync complete');
    } catch (error) {
      console.error('Failed to sync Bitcoin wallet:', error);
      throw error;
    }
  }

  /**
   * Sync Bitcoin transaction history
   * Discovers used addresses and fetches transaction history
   */
  async syncBitcoinTransactions(): Promise<void> {
    try {
      debugLog('🔄 Syncing Bitcoin transactions...');

      const { syncBitcoinTransactions } = await import('@/chains/bitcoin/bitcoinTransactionSync');
      const { BitcoinApi } = await import('@/api/bitcoin-api');

      // Get current block height for confirmation calculation
      const bitcoinApi = new BitcoinApi({ chain: this.chain, network: this.network }, this.provider);
      const tip = await bitcoinApi.getTip();

      // Sync transaction history
      const transactions = await syncBitcoinTransactions(
        {
          chain: this.chain,
          network: this.network,
          publicKey: this.publicKey,
          addressType: this.addressType || 'segwit',
        },
        this.provider,
        tip.height
      );

      // Update wallet store with transactions
      WalletStore.setTransactions(transactions);

      debugLog(`✅ Bitcoin transaction sync complete: ${transactions.length} transactions`);
    } catch (error) {
      console.error('Failed to sync Bitcoin transactions:', error);
      throw error;
    }
  }

  /**
   * Complete Bitcoin wallet sync (UTXOs + transactions)
   * Called periodically and after transactions
   */
  async syncBitcoinWalletComplete(): Promise<void> {
    try {
      debugLog('🔄 Starting complete Bitcoin wallet sync...');

      // Sync UTXOs first (updates balance)
      await this.syncBitcoinWallet();

      // Then sync transaction history
      await this.syncBitcoinTransactions();

      debugLog('✅ Complete Bitcoin wallet sync finished');
    } catch (error) {
      console.error('Failed to sync Bitcoin wallet:', error);
      // Don't throw - allow partial sync to succeed
    }
  }

  // Bitcoin sync interval tracking
  private bitcoinSyncInterval: NodeJS.Timeout | null = null;
  private readonly BITCOIN_SYNC_INTERVAL_MS = 60000; // 1 minute

  /**
   * Start periodic Bitcoin wallet sync
   * Syncs UTXOs and transactions every minute
   */
  startBitcoinPeriodicSync(): void {
    if (this.chain !== Blockchain.BITCOIN) {
      debugLog('⚠️ Not a Bitcoin wallet, skipping periodic sync');
      return;
    }

    // Clear any existing interval
    this.stopBitcoinPeriodicSync();

    debugLog('🔄 Starting Bitcoin periodic sync (every 60 seconds)...');

    // Set up periodic sync
    this.bitcoinSyncInterval = setInterval(async () => {
      try {
        await this.syncBitcoinWalletComplete();
      } catch (error) {
        console.error('Bitcoin periodic sync failed:', error);
      }
    }, this.BITCOIN_SYNC_INTERVAL_MS);
  }

  /**
   * Stop periodic Bitcoin wallet sync
   */
  stopBitcoinPeriodicSync(): void {
    if (this.bitcoinSyncInterval) {
      clearInterval(this.bitcoinSyncInterval);
      this.bitcoinSyncInterval = null;
      debugLog('🛑 Bitcoin periodic sync stopped');
    }
  }

  /**
   * Sign Bitcoin PSBT transaction (software wallets)
   * Supports both password and PRF wallet encryption
   *
   * @param psbtHex PSBT in hexadecimal format
   * @param password Wallet password (for password wallets)
   * @param prfSecret PRF secret from WebAuthn (for PRF wallets)
   * @returns Signed transaction with hex and txid
   */
  async signBitcoinTransaction(
    psbtHex: string,
    password?: string,
    prfSecret?: Uint8Array
  ): Promise<{ txHex: string; txId: string }> {
    const { signAndFinalizePsbt } = await import('@/chains/bitcoin/bitcoinSigner');
    const { decrypt } = await import('@/shared/utils/crypto');

    try {
      debugLog('🔐 Signing Bitcoin transaction...');

      if (this.encryptionMethod === 'prf') {
        // ============================================================================
        // PRF WALLET - SIGN WITH PRF SECRET
        // ============================================================================

        if (!this.prfEncryptedMnemonic) {
          throw new Error('PRF wallet has no encrypted mnemonic');
        }

        if (!prfSecret) {
          throw new Error('PRF secret is required for PRF wallet signing');
        }

        // Decrypt mnemonic using the raw PRF output from the frontend
        const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');
        if (!this.webAuthnCredentialId) {
          throw new Error('PRF wallet missing credential ID');
        }
        const mnemonic = await decryptMnemonicWithPrfOutput(
          this.prfEncryptedMnemonic,
          prfSecret,
          this.webAuthnCredentialId,
          this.id.toString()
        );

        // Sign and finalize PSBT
        const signedTx = await signAndFinalizePsbt(
          psbtHex,
          mnemonic,
          this.network,
          this.addressType,
          0
        );

        debugLog('✅ Bitcoin transaction signed with PRF');
        return { txHex: signedTx.hex, txId: signedTx.id };

      } else {
        // ============================================================================
        // PASSWORD WALLET - SIGN WITH PASSWORD
        // ============================================================================

        if (!password) {
          throw new Error('Password is required for password wallet signing');
        }

        if (!this.encryptedMnemonic) {
          throw new Error('Password wallet has no encrypted mnemonic');
        }

        // Decrypt mnemonic with password
        const decryptedMnemonic = decrypt(this.encryptedMnemonic, password);

        // Sign and finalize PSBT
        const signedTx = await signAndFinalizePsbt(
          psbtHex,
          decryptedMnemonic,
          this.network,
          this.addressType,
          0
        );

        debugLog('✅ Bitcoin transaction signed with password');
        return { txHex: signedTx.hex, txId: signedTx.id };
      }
    } catch (error) {
      console.error('Failed to sign Bitcoin transaction:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Transaction signing failed: ${errorMessage}`);
    }
  }

  /**
   * Sign Bitcoin PSBT with hardware wallet
   *
   * NOTE: Hardware wallet signing for Bitcoin is not yet implemented in the background context.
   * Hardware wallets (Ledger, Trezor, Keystone) require frontend APIs (WebUSB, WebBLE, QR codes)
   * and cannot run in the service worker background context.
   *
   * Bitcoin hardware wallet support will be implemented in the frontend,
   * similar to how Cardano hardware wallet signing works.
   *
   * @throws Error indicating hardware wallet signing is not supported in background
   */
  async signBitcoinTransactionWithHardware(): Promise<{
    success: boolean;
    error?: string;
  }> {
    return {
      success: false,
      error: 'Bitcoin hardware wallet signing must be handled in the frontend context. Please use a software wallet or implement frontend hardware wallet support.',
    };
  }

  /**
   * Get the compressed public key (33 bytes hex) for the active Bitcoin receiving address.
   * Used by bitcoin_getPublicKey DApp API.
   */
  async getBitcoinPublicKey(): Promise<string> {
    const { HDKey } = await import('@scure/bip32');
    const accountNode = HDKey.fromExtendedKey(this.publicKey);
    const childNode = accountNode.derive('m/0/0');
    if (!childNode.publicKey) throw new Error('Failed to derive Bitcoin public key');
    return Buffer.from(childNode.publicKey).toString('hex');
  }

  /**
   * Sign a PSBT for a DApp request (Unisat-compatible bitcoin_signPsbt / bitcoin_signPsbts).
   *
   * @param psbtHex   - PSBT as hex or base64 string
   * @param options   - { autoFinalized?: boolean } — if false, returns signed PSBT hex instead of tx hex
   * @param password  - Spending password (password wallets)
   * @param prfSecret - Raw PRF output bytes (PRF wallets)
   * @returns         - Signed PSBT hex, or finalized tx hex when autoFinalized !== false
   */
  async signBitcoinDappPsbt(
    psbtHex: string,
    options?: { autoFinalized?: boolean; toSignInputs?: any[] },
    password?: string,
    prfSecret?: Uint8Array
  ): Promise<string> {
    const { signPsbtWithMnemonic } = await import('@/chains/bitcoin/bitcoinSigner');
    const { getBitcoinNetwork } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
    const { decrypt } = await import('@/shared/utils/crypto');

    // Decrypt mnemonic
    let mnemonic: string;
    if (this.encryptionMethod === 'prf') {
      if (!this.prfEncryptedMnemonic) throw new Error('PRF wallet has no encrypted mnemonic');
      if (!prfSecret) throw new Error('PRF secret is required for PRF wallet signing');
      const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');
      mnemonic = await decryptMnemonicWithPrfOutput(
        this.prfEncryptedMnemonic, prfSecret, this.webAuthnCredentialId!, this.id.toString()
      );
    } else {
      if (!password) throw new Error('Password is required for password wallet signing');
      if (!this.encryptedMnemonic) throw new Error('Wallet has no encrypted mnemonic');
      mnemonic = decrypt(this.encryptedMnemonic, password);
    }

    const bitcoin = await import('bitcoinjs-lib');
    const bitcoinNetwork = getBitcoinNetwork(this.network);

    let psbt: any;
    try {
      psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoinNetwork });
    } catch {
      psbt = bitcoin.Psbt.fromBase64(psbtHex, { network: bitcoinNetwork });
    }

    const signedPsbt = signPsbtWithMnemonic(psbt, mnemonic, this.network, this.addressType, 0);

    if (options?.autoFinalized !== false) {
      signedPsbt.finalizeAllInputs();
      return signedPsbt.extractTransaction().toHex();
    }
    return signedPsbt.toHex();
  }

  /**
   * Sign a message for a DApp (Unisat-compatible bitcoin_signMessage).
   *
   * @param message   - UTF-8 message string
   * @param type      - 'ecdsa' (default) or 'bip322-simple'
   * @param password  - Spending password (password wallets)
   * @param prfSecret - Raw PRF output bytes (PRF wallets)
   * @returns         - Base64-encoded signature
   */
  async signBitcoinDappMessage(
    message: string,
    type: 'ecdsa' | 'bip322-simple' = 'ecdsa',
    password?: string,
    prfSecret?: Uint8Array
  ): Promise<string> {
    const { decrypt } = await import('@/shared/utils/crypto');
    const { deriveBitcoinRootKey, getDerivationPurpose, BitcoinCoinType, BitcoinTestnetCoinType } =
      await import('@/chains/bitcoin/bitcoinKeyManager');

    // Decrypt mnemonic
    let mnemonic: string;
    if (this.encryptionMethod === 'prf') {
      if (!this.prfEncryptedMnemonic) throw new Error('PRF wallet has no encrypted mnemonic');
      if (!prfSecret) throw new Error('PRF secret is required for PRF wallet signing');
      const { decryptMnemonicWithPrfOutput } = await import('@/shared/utils/webauthn-prf');
      mnemonic = await decryptMnemonicWithPrfOutput(
        this.prfEncryptedMnemonic, prfSecret, this.webAuthnCredentialId!, this.id.toString()
      );
    } else {
      if (!password) throw new Error('Password is required for password wallet signing');
      if (!this.encryptedMnemonic) throw new Error('Wallet has no encrypted mnemonic');
      mnemonic = decrypt(this.encryptedMnemonic, password);
    }

    // Derive signing key (first receiving address: m/purpose'/coinType'/0'/0/0)
    const rootKey = deriveBitcoinRootKey(mnemonic);
    const purpose = getDerivationPurpose(this.addressType || 'segwit');
    const coinType = this.network.toLowerCase() === 'mainnet' ? BitcoinCoinType : BitcoinTestnetCoinType;
    const signingKey = rootKey.derive(`m/${purpose}'/${coinType}'/0'/0/0`);
    if (!signingKey.privateKey || !signingKey.publicKey) throw new Error('Failed to derive signing key');

    const privKey = Buffer.from(signingKey.privateKey);
    const pubKey = Buffer.from(signingKey.publicKey);

    if (type === 'bip322-simple') {
      return this._signBip322Simple(message, privKey, pubKey);
    }

    // ECDSA: Bitcoin message signing with magic prefix
    return this._signEcdsaMessage(message, privKey);
  }

  private async _signEcdsaMessage(message: string, privKey: Buffer): Promise<string> {
    const ecc = await import('tiny-secp256k1');
    const { sha256 } = await import('@noble/hashes/sha2');

    const MAGIC = Buffer.from('\x18Bitcoin Signed Message:\n', 'binary');
    const msgBuf = Buffer.from(message, 'utf8');
    const varint = Buffer.allocUnsafe(1);
    varint.writeUInt8(msgBuf.length);
    const prefixed = Buffer.concat([MAGIC, varint, msgBuf]);
    const msgHash = sha256(sha256(prefixed));

    const { signature, recoveryId } = ecc.signRecoverable(msgHash, privKey);
    const prefix = 27 + 4 + recoveryId; // 27+4 for compressed key
    return Buffer.concat([Buffer.from([prefix]), Buffer.from(signature)]).toString('base64');
  }

  private async _signBip322Simple(message: string, privKey: Buffer, pubKey: Buffer): Promise<string> {
    const bitcoin = await import('bitcoinjs-lib');
    const ecc = await import('tiny-secp256k1');
    const { getBitcoinNetwork } = await import('@/chains/bitcoin/bitcoinPsbtBuilder');
    const { sha256 } = await import('@noble/hashes/sha2');

    const bitcoinNetwork = getBitcoinNetwork(this.network);

    // BIP-322: tagged hash of the message
    const tag = Buffer.from('BIP0322-signed-message', 'utf8');
    const tagHash = sha256(tag);
    const msgHash = Buffer.from(sha256(Buffer.concat([tagHash, tagHash, Buffer.from(message, 'utf8')])));

    // P2WPKH scriptPubKey for signing key
    const hash160 = bitcoin.crypto.hash160(pubKey);
    const scriptPubKey = Buffer.concat([Buffer.from([0x00, 0x14]), hash160]);

    // Build virtual to_spend tx to compute its txid
    const toSpendTx = new bitcoin.Transaction();
    toSpendTx.version = 0;
    toSpendTx.addInput(Buffer.alloc(32, 0), 0xffffffff, 0,
      bitcoin.script.compile([bitcoin.opcodes['OP_0'], msgHash]));
    toSpendTx.addOutput(scriptPubKey, 0);
    const toSpendHash = toSpendTx.getHash();

    // Build to_sign PSBT spending to_spend
    const psbt = new bitcoin.Psbt({ network: bitcoinNetwork });
    (psbt as any).setVersion(0);
    psbt.addInput({
      hash: toSpendHash,
      index: 0,
      sequence: 0,
      witnessUtxo: { script: scriptPubKey, value: 0 },
    });
    psbt.addOutput({ script: bitcoin.script.compile([bitcoin.opcodes['OP_RETURN']]), value: 0 });

    psbt.signInput(0, {
      publicKey: pubKey,
      sign: (hash: Buffer) => Buffer.from(ecc.sign(hash, privKey)),
    });
    psbt.finalizeAllInputs();

    // Extract witness and serialize as varint-length-prefixed bytes → base64
    const witness = psbt.extractTransaction().ins[0].witness;
    const varInt = (n: number) => {
      if (n < 0xfd) return Buffer.from([n]);
      const b = Buffer.allocUnsafe(3); b[0] = 0xfd; b.writeUInt16LE(n, 1); return b;
    };
    const parts: Buffer[] = [varInt(witness.length)];
    for (const item of witness) parts.push(varInt(item.length), item);
    return Buffer.concat(parts).toString('base64');
  }

  async verifySpendingPassword(password: string): Promise<boolean> {
    if (this.encryptionMethod === 'prf') {
      // ============================================================================
      // PRF WALLET - VERIFY SPENDING PASSWORD HASH
      // ============================================================================

      // If no spending password hash is stored, password verification is not required
      if (!this.prfSpendingPassword) {
        return true; // Pure PRF mode (no password)
      }

      // Verify password hash (password unlock is enabled)
      try {
        const { verifySpendingPassword } = await import('@/shared/utils/webauthn-prf');
        return await verifySpendingPassword(password, this.prfSpendingPassword);
      } catch (e) {
        return false;
      }

    } else {
      // ============================================================================
      // PASSWORD WALLET - VERIFY BY DECRYPTION
      // ============================================================================

      try {
        const decrypted = decrypt(this.encryptedPrivateKey, password);
        decryptWithPassword(password, JSON.parse(decrypted));
        return true;
      } catch (e) {
        return false;
      }
    }
  }

  /**
   * Cardano JS SDK transaction signing method
   * @param txInput - Either a CBOR hex string or Cardano.Tx object (Cardano JS SDK)
   * @param password - Wallet password for software wallets
   * @param accountIndex - Account index for derivation
   * @param utxos - UTXOs for reference
   * @param addresses - Address mappings (key-value pairs of addresses)
   * @returns Promise with witness set hex string
   */
  async signTx(
    txInput: string | Cardano.Tx,
    password: string,
    accountIndex: number,
    utxos: Cardano.Utxo[],
    addresses: Keys,
    privateKeyBytes?: Uint8Array, // Optional pre-decrypted private key for PRF wallets
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

    // Get root private key
    let rootPrivateKey: Bip32PrivateKey;
    if (privateKeyBytes) {
      // Use pre-decrypted private key (PRF wallet - already authenticated in browser context)
      const { Bip32PrivateKey } = await import('@cardano-sdk/crypto');
      rootPrivateKey = Bip32PrivateKey.fromBytes(privateKeyBytes);
    } else {
      // Decrypt root private key (password-based wallets)
      rootPrivateKey = await this.decryptRootPrivateKey(password);
    }
    password = null; // Clear password from memory

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
    );

    // Sign with each required key
    for (const signer of requiredSigners) {
      const privateKey: Bip32PrivateKey = accountPrivateKey.derive(signer.derivationPath);
      const rawPublicKey: Ed25519PublicKey = privateKey.toRawKey().toPublic();
      const signature = privateKey.toRawKey().sign(HexBlob(transaction.id));
      signatures.set(rawPublicKey.hex(), signature.hex());
    }

    // Create a witness set - ensure a signature map is properly set
    const witness: Cardano.Witness = {
      signatures: new Map(signatures), // Create a new Map to ensure it's properly set
    };
    // Serialize witness to CBOR hex
    return { witnesses: Serialization.TransactionWitnessSet.fromCore(witness).toCbor() };
  }

  /**
   * Submit transaction using Cardano JS SDK
   * @param txInput - Either a legacy Transaction object, CBOR hex string, or Cardano.Tx object (Cardano JS SDK)
   * @param _utxos - UTXOs for transaction schema conversion
   * @returns Promise with transaction ID
   */
  async submitTx(txInput: string | Cardano.Tx, _utxos: any[]): Promise<string> {
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
      const txIdResponse = await this.api.submitTx(txCbor);

      const isValidTxId = /^[a-f0-9]{64}$/i.test(txIdResponse);
      if (!isValidTxId) {
        console.error(txIdResponse);
        throw new Error(txIdResponse);
      }
      // Create transaction record using sync service pattern
      const txDeserialized: Cardano.Tx = Serialization.TxCBOR.deserialize(Serialization.TxCBOR(txCbor));
      const pendingTx = {
        id: txIdResponse, // Required for a database key path
        tx_hash: txIdResponse,
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

      return txIdResponse;
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
        throw new Error(APIError.InvalidRequest.info.concat('', ' ', JSON.stringify(error)));
      }
    }
  }

  async signData(
    address: Cardano.PaymentAddress | Cardano.RewardAccount | string,
    payload: string,
    password: string,
    accountIndex: number,
    keys: Keys,
    privateKeyBytes?: Uint8Array, // Optional pre-decrypted root key for PRF wallets
  ) {
    // Use Cardano SDK's cip30signData implementation directly (same as Lace)
    // This ensures 100% compatibility with the Cardano SDK standard

    const signWith = addrToSignWith(address);
    const knownAddresses = this.convertKeysToGroupedAddresses(keys, accountIndex);

    // Create a minimal KeyAgent-like object that implements the required interface
    const keyAgent = {
      derivePublicKey: async (derivationPath: { role: number; index: number }) => {
        // Derive public key based on role
        if (derivationPath.role === ChainDerivations.DREP) {
          return getDrepKey(this.publicKey, derivationPath.index).hex();
        } else if (derivationPath.role === ChainDerivations.CHIMERIC_ACCOUNT) {
          return getStakeKey(this.publicKey, derivationPath.index).hex();
        } else if (derivationPath.role === ChainDerivations.EXTERNAL) {
          return getPaymentKeyExternal(this.publicKey, derivationPath.index).hex();
        } else if (derivationPath.role === ChainDerivations.INTERNAL) {
          return getPaymentKeyInternal(this.publicKey, derivationPath.index).hex();
        }
        throw new Error(`Unknown derivation role: ${derivationPath.role}`);
      },
      signBlob: async (derivationPath: { role: number; index: number }, blob: string) => {
        // Determine key type from role
        let keyType: 'payment' | 'change' | 'stake' | 'drep';
        if (derivationPath.role === ChainDerivations.DREP) {
          keyType = 'drep';
        } else if (derivationPath.role === ChainDerivations.CHIMERIC_ACCOUNT) {
          keyType = 'stake';
        } else if (derivationPath.role === ChainDerivations.EXTERNAL) {
          keyType = 'payment';
        } else if (derivationPath.role === ChainDerivations.INTERNAL) {
          keyType = 'change';
        } else {
          throw new Error(`Unknown derivation role: ${derivationPath.role}`);
        }

        // Get the private key. PRF wallets pass the pre-decrypted root key
        // bytes (already authenticated in the browser via WebAuthn PRF); all
        // other wallets decrypt the root key with the spending password. The
        // derivation is identical in both branches.
        const privateKey = privateKeyBytes
          ? this.requestAccountKeyFromBytes(keyType, privateKeyBytes, accountIndex, derivationPath.index)
          : await this.requestAccountKey(keyType, password, accountIndex, derivationPath.index);

        // Sign the blob
        const signature = privateKey.sign(HexBlob(blob));

        return {
          publicKey: privateKey.toPublic().hex(),
          signature: signature.hex()
        };
      }
    };

    // Call custom CIP-8 signing implementation (avoids blocking cip8 import)
    // This implementation matches the SDK's cip30signData behavior
    const result = await signDataCip8(keyAgent, knownAddresses, signWith, payload);
    password = null; // Clear password reference from memory (mirrors signTx)
    return result;
  }

  /**
   * Convert Gero's Keys structure to SDK's GroupedAddress[] format
   * @private
   */
  private convertKeysToGroupedAddresses(keys: Keys, accountIndex: number): GroupedAddress[] {
    const networkId = this.networkId();
    const stakeAddress = this.stakeAddress;
    const groupedAddresses: GroupedAddress[] = [];

    // Convert payment addresses
    keys.payment.forEach((key) => {
      groupedAddresses.push({
        type: ChainDerivations.EXTERNAL, // AddressType.External = 0
        index: hdPathToArray(key.path)[4],
        networkId,
        accountIndex,
        address: key.address,
        rewardAccount: stakeAddress,
      });
    });

    // Convert change addresses
    keys.change.forEach((key) => {
      groupedAddresses.push({
        type: ChainDerivations.INTERNAL, // AddressType.Internal = 1
        index: hdPathToArray(key.path)[4],
        networkId,
        accountIndex,
        address: key.address,
        rewardAccount: stakeAddress,
      });
    });

    return groupedAddresses;
  }

  isEnterpriseAddress(): boolean {
    // Bitcoin has no enterprise addresses
    if (this.chain === Blockchain.BITCOIN) {
      return false;
    }

    // Guard against empty address (async initialization)
    if (!this.baseAddress) {
      return false;
    }

    try {
      return Cardano.Address.fromBech32(this.baseAddress).getType() === Cardano.AddressType.EnterpriseScript;
    } catch (error) {
      console.error('Error parsing address in isEnterpriseAddress:', error);
      return false;
    }
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

}

export function alarmListener(_alarm) {
  // No-op: Xerberus risk-refresh alarm removed. Kept (exported + registered) because
  // walletManager.service.ts relies on this reference for addListener/removeListener.
}
