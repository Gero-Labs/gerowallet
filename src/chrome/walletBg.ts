import Dexie, { DexieError } from 'dexie';
import { Api } from '@/api/api';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519PublicKey, Hash28ByteBase16 } from '@cardano-sdk/crypto'
import { APIError, TxSendError, TxSignError } from '@/chrome/config';
import networks from '@/utils/networks';
import { blockChainDBSchema, blockChainDBVersion, walletDBSchema, walletDBVersion } from '@/db/schema';
import {
  ChainDerivations,
  Provider,
  purpose,
  coin_type,
  Tip,
  WalletType,
  BIP44_SCAN_SIZE, WalletTypePurpose, CoinTypes, ERROR,
} from '@/models/types';
import {
  addrToSignWith, decryptWithPassword,
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
  toPaymentCredential,
} from '@/chrome/serialization';
import WalletStore from '@/stores/walletStore';
import NetworkStore from '@/stores/networkStore';
import DexHunterStore from '@/stores/dexHunterStore';
import XerberusStore from '@/stores/xerberusStore';
import { resolveAsset, findCollectionDescription, findCollectionName, longestCommonStartingSubstring } from '@/shared/utils/resolver';
import RealFiStore from '@/stores/realFiStore';
import TapToolsStore from '@/stores/tapToolsStore';
import CoinGeckoStore from '@/stores/coinGeckoStore';
import MusicStore from '@/stores/musicStore';
import SyncService from '@/services/sync.service';
import { LoaderFactory } from '@/db/loaders';
import { HARDENED, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import ledger from '@/shared/utils/ledger';
import {
  buildAndSignData,
  createCoseKey,
  createCOSEKeyHex,
  createSignDataBuilder,
  toHexArray,
} from '@/shared/utils/converter';
import { Ed25519PrivateKey } from '@cardano-sdk/crypto';
import { DataSignError } from '@/chrome/config';
import { COSESign1Builder } from '@emurgo/cardano-message-signing-browser';
import { Serialization, util } from '@cardano-sdk/core';
import verifyDataSignature from '@cardano-foundation/cardano-verify-datasignature';
import { Buffer } from 'buffer';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import * as CryptoTS from 'crypto-ts';
import {
  Address,
  Certificate,
  CertificateKind,
  FixedTransaction,
  RewardAddress,
  StakeDeregistration, Transaction,
  TransactionBody,
  TransactionInput,
  TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import {
  addVkeys,
  getOwnedCred,
  hdPathToArray,
} from '@/shared/utils/converter';
import { convertToTxSchema } from '@/chrome/helper';
import {
  serializeCardanoJsSdkTx,
  // deserializeCardanoJsSdkTx,
  // computeTxHash,
  // extractStakeCredentialsFromCertificates,
  // createSignableTransaction
} from '@/chrome/cardanoJsSdkCbor';

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
    this.provider = networks.resolveDefaultProvider(this.chain, this.network)
    this.api = new Api(wallet, this.provider);
    this.baseAddress = getAddress(this.publicKey, this.chain, this.network, 0).toBech32();
    this.stakeAddress = getRewardAddress(this.publicKey, this.chain, this.network).toBech32()
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
      setUtxosAndAddresses: this.setUtxosAndAddresses.bind(this)
    });
    this.loaderFactory.createAllLoaders();
  }

  unsubscribeAll() {
    // Unsubscribe from new loader system
    this.loaderFactory.unsubscribeAll();
  }

  networkId(): number {
    return networks.resolveNetworkId(this.chain, this.network);
  }

  async sync(tip?: Tip) {
    return this.syncService.sync(tip);
  }

  async resync() {
    return this.syncService.resync();
  }

  async setSync(syncObject) {
    return this.syncService.setSync(syncObject);
  }

  public async loadPools() {
    return this.loaderFactory.load('pools');
  }

  public async loadRewards() {
    return this.loaderFactory.load('rewards');
  }

  public async loadDReps() {
    return this.loaderFactory.load('dreps');
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
    if (NetworkStore.state.epochParams[epoch]) {
      return null
    }
    return epoch
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
    addresses.add(this.baseAddress);
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
    await this.syncService.syncAssets(Array.from(uniqueAssets))
    //TODO wait for network Store to Load Assets

    // Resolve Assets from UTxOs
    this.setAssets(Array.from(utxos.values()));

    // Keys
    if (this.type !== WalletType.Google) {
        const keys = await this.syncService.syncKeys(Array.from(addresses));
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
    console.log('new tokens', tokens);
    WalletStore.setTokens(tokens);
    chrome.alarms.onAlarm.addListener(alarmListener);
    chrome.alarms.create('coinGeckoPrices', { delayInMinutes: 0, periodInMinutes: 1 });
    const isSwapSupported = networks.resolveSwapSupport(this.chain, this.network);
    console.log('isSwapSupported', isSwapSupported);
    if (isSwapSupported) {
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
    return this.loaderFactory.load('transactions');
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

  async syncTable(tableId): Promise<void> {
    return this.syncService.syncTable(tableId);
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
      const derivedAddress: string = this.deriveExternalAddressFromPath(addressIndex).toBech32();
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

  deriveExternalAddressFromPath(addressIndex: number): Cardano.Address {
    return getAddress(this.publicKey, this.chain, this.network, addressIndex)
  }

  deriveInternalAddressFromPath(addressIndex) {
    return Cardano.BaseAddress.fromCredentials(
      this.networkId(),
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(this.paymentKeyInternal(addressIndex).hash().hex())
      },
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16(this.stakeKey().hash().hex())
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
    return getStakeKey(this.publicKey, 0)
  }

  drepKey(): Ed25519PublicKey {
    return getDrepKey(this.publicKey, 0)
  }

  requestAccountKey(password: string, accountIndex: number): {
    accountKey: Bip32PrivateKey,
    paymentKey: Ed25519PrivateKey,
    stakeKey: Ed25519PrivateKey,
    drepKey: Ed25519PrivateKey
  } {
    let accountKey: Bip32PrivateKey;
    try {
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const buffer: Buffer = decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      accountKey = Bip32PrivateKey.fromBytes(buffer)
        .derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + accountIndex]);
    } catch (e) {
      throw ERROR.wrongPassword;
    }

    return {
      accountKey,
      paymentKey: accountKey.derive([ChainDerivations.EXTERNAL, 0]).toRawKey(),
      stakeKey: accountKey.derive([ChainDerivations.CHIMERIC_ACCOUNT, 0]).toRawKey(),
      drepKey: accountKey.derive([ChainDerivations.DREP, 0]).toRawKey()
    };
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

  verifySpendingPassword(password: string) {
    console.log('verifySpendingPassword', password);
    try {
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Enhanced signTx method that supports both Cardano JS SDK and legacy Emurgo transactions
   * @param txInput - Either a CBOR hex string (legacy) or Cardano.Tx object (Cardano JS SDK)
   * @param partialSign - Whether this is a partial signing operation
   * @param password - Wallet password for software wallets
   * @param accountIndex - Account index for derivation
   * @param utxos - UTXOs for reference
   * @param addresses - Address mappings
   * @param isUsb - USB connection flag for hardware wallets
   * @returns Promise with witness set hex string
   */
  async signTx(txInput: string | Cardano.Tx, partialSign: boolean = false, password: string, accountIndex: number, utxos, addresses: string[], isUsb?: boolean): Promise<{ witnesses: string }> {
    let txCbor: string;
    let isCardanoJsSdk = false;

    // Check if input is a Cardano JS SDK transaction or legacy CBOR hex
    if (typeof txInput === 'string') {
      // Legacy CBOR hex string
      txCbor = txInput;
    } else {
      // Cardano JS SDK transaction object
      isCardanoJsSdk = true;
      txCbor = serializeCardanoJsSdkTx(txInput);
    }

    // Parse transaction using Emurgo library (needed for hardware wallet compatibility)
    const rawTx: FixedTransaction = FixedTransaction.from_hex(txCbor);
    const witnessSet: TransactionWitnessSet = rawTx.witness_set();
    const txBody: TransactionBody = rawTx.body();
    const baseAddress: Cardano.Address = Cardano.Address.fromBech32(this.baseAddress);
    const stakeAddress: RewardAddress = RewardAddress.from_address(Address.from_bech32(this.stakeAddress));

    const credList: Set<any> = new Set();
    const accountData = {
      account: {
        pub: this.publicKey,
        path: [purpose.hdwallet, 1815, accountIndex]
      },
      keys: {
        payment: Object.values(addresses).filter(address => hdPathToArray(address['path'])[3] === 0),
        stake: [{
          cred: Serialization.Credential.fromCore(Cardano.BaseAddress.fromAddress(baseAddress).getStakeCredential()).value().hash,
          path: `m/${purpose.hdwallet}'/1815'/${accountIndex}'/${ChainDerivations.CHIMERIC_ACCOUNT}/0`
        }],
        change: Object.values(addresses).filter(address => hdPathToArray(address['path'])[3] === 1),
        script: [],
        drep: [],
        cc_cold: [],
        cc_hot: []
      }
    };

    // Analyze transaction inputs for required credentials
    for (let i = 0; i < txBody.inputs().len(); i++) {
      const input: TransactionInput = txBody.inputs().get(i);
      const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
      const inputTxIndex = input.index();
      const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);

      if (utxo) {
        const address: string = addresses[utxo.payment_addr.bech32];
        credList.add(address);
      }
    }

    // Enhanced certificate analysis for both legacy and Cardano JS SDK certificates
    if (txBody.certs()) {
      console.log('Processing certificates for signing');
      for (let i = 0; i < txBody.certs().len(); i++) {
        const certificate: Certificate = txBody.certs().get(i);
        let keyHash: string;

        // Handle different certificate types
        if (certificate.kind() == CertificateKind.StakeRegistration) {
          const stakeRegistration = certificate.as_stake_registration();
          keyHash = stakeRegistration.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeDeregistration) {
          const stakeDeregistration: StakeDeregistration = certificate.as_stake_deregistration();
          keyHash = stakeDeregistration.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeDelegation) {
          const stakeDelegation = certificate.as_stake_delegation();
          keyHash = stakeDelegation.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeRegistrationAndDelegation) {
          const stakeRegistrationAndDelegation = certificate.as_stake_registration_and_delegation();
          keyHash = stakeRegistrationAndDelegation.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.VoteDelegation) {
          const voteDelegation = certificate.as_vote_delegation();
          keyHash = voteDelegation.stake_credential().to_keyhash().to_hex();
        }

        if (keyHash && accountData.keys.stake[0].cred === keyHash) {
          credList.add(accountData.keys.stake[0]);
        }
      }
    }

    // Check for withdrawals
    if (txBody.withdrawals()) {
      const bigNum = txBody.withdrawals().get(stakeAddress);
      if (bigNum) {
        credList.add(accountData.keys.stake[0]);
      }
    }

    // Handle existing vkey witnesses
    const vKeyHashes = new Set();
    if (witnessSet?.vkeys()) {
      for (let i = 0; i < witnessSet.vkeys().len(); i++) {
        vKeyHashes.add(witnessSet.vkeys().get(i).vkey().public_key().hash().to_hex());
      }
    }

    // Handle required signers
    if (txBody.required_signers()) {
      for (let i = 0; i < txBody.required_signers().len(); i++) {
        const requiredKeyHash = txBody.required_signers().get(i);
        const requiredVKeyHash = requiredKeyHash.to_hex();
        if (!vKeyHashes.has(requiredVKeyHash)) {
          credList.add(getOwnedCred([accountData.keys], requiredVKeyHash));
        }
      }
    }

    console.log(`Signing ${isCardanoJsSdk ? 'Cardano JS SDK' : 'legacy Emurgo'} transaction with ${credList.size} credentials`);

    // Handle different wallet types
    if (this.type === WalletType.Ledger) {
      // Ledger signing logic would go here
      // For now, return empty witnesses to indicate hardware wallet integration needed
      return { witnesses: '' };
    } else if (this.type === WalletType.Trezor) {
      // Trezor signing logic would go here
      return { witnesses: '' };
    } else {
      // Software wallet signing
      console.log('Signing with Software Wallet...');
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const decodedHash = decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      password = null;

      if (!decodedHash && partialSign === false) {
        throw TxSignError.ProofGeneration;
      }

      const prvRootKeyBech32: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash);
      const txHash = rawTx.transaction_hash();

      addVkeys(txHash, witnessSet, credList, prvRootKeyBech32);

      return {
        witnesses: witnessSet.to_hex()
      };
    }
  }

  async submitTx(tx: Transaction, utxos) {
    const txCbor = tx.to_hex()
    try {
      const txId = await this.api.submitTx(txCbor);
      const tx = convertToTxSchema(txId, txCbor, utxos, this.networkId())
      this.setAccountTransactions([tx])
        .catch(e => console.log(e))
      return txId;
    } catch (error) {
      console.log(error)
      if (error['response'].status === 400) {
        throw new Error(TxSendError.Failure.info.concat('', ' ', JSON.stringify(error['response'].data)));
      } else if (error['response'].status === 500) {
        throw new Error(APIError.InternalError.info);
      } else if (error['response'].status === 429) {
        throw new Error(TxSendError.Refused.info);
      } else if (error['response'].status === 425) {
        throw new Error(ERROR.fullMempool);
      } else {
        throw new Error(APIError.InvalidRequest.info.concat('', ' ', JSON.stringify(error['response'].data)));
      }
    }
  }

  async signData(address: Cardano.PaymentAddress | Cardano.RewardAccount | string, payload: string, password: string, accountIndex: number, isUsb: boolean) {
    let signatureHex: string, keyHex: string;
    const addr: Cardano.PaymentAddress | Cardano.RewardAccount = addrToSignWith(address);

    if (this.type === WalletType.Ledger) {
      const response: SignedMessageData = await ledger.signData(
        addr, payload, networks.resolveNetwork(this.chain, this.network), accountIndex, isUsb,
      );
      const builder = createSignDataBuilder(toHexArray(response.addressFieldHex), payload);
      signatureHex = buildAndSignData(builder, toHexArray(response.signatureHex), undefined);
      keyHex = createCOSEKeyHex(toHexArray(response.signingPublicKeyHex));
    } else {
      console.log('Signing with Software Wallet...');
      const addressBytes = toHexArray(Cardano.Address.fromBech32(addr).toBytes())
      const credential: Cardano.Credential = toPaymentCredential(Cardano.Address.fromBech32(addr));
      const keyHash: string = credential.hash;
      let accountKey: Ed25519PrivateKey
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
      keyHex = util.bytesToHex(coseKey.to_bytes())
      console.log(verifyDataSignature(signatureHex, keyHex, Buffer.from(payload, "hex").toString("utf8"), addr));
    }

    return { signature: signatureHex, key: keyHex };
  }

  async syncAccountInfo(): Promise<any> {
    return this.syncService.syncAccountInfo();
  }

  async syncAccountRewards(): Promise<void> {
    return this.syncService.syncAccountRewards();
  }

  async syncAccountTransactions(height: number): Promise<any> {
    return this.syncService.syncAccountTransactions(height);
  }

  async syncAssets(uniqueUnits: string[]): Promise<void> {
    return this.syncService.syncAssets(uniqueUnits);
  }

  isEnterpriseAddress(): boolean {
    return Cardano.Address.fromBech32(this.baseAddress).getType() === Cardano.AddressType.EnterpriseScript;
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

export function alarmListener(alarm) {
  if (alarm.name === 'refreshDexHunterPrices') {
    console.log('new refreshDexHunterPrices', alarm)
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
