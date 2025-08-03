import Dexie from 'dexie';
import { Api } from '@/api/api';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519PublicKey, Hash28ByteBase16, Ed25519PublicKeyHex, Ed25519SignatureHex } from '@cardano-sdk/crypto'
import { APIError, TxSendError, TxSignError } from '@/chrome/config';
import networks from '@/utils/networks';
import { blockChainDBSchema, blockChainDBVersion } from '@/db/schema';
import {
  ChainDerivations,
  Provider,
  purpose,
  coin_type,
  Tip,
  WalletType,
  BIP44_SCAN_SIZE, WalletTypePurpose, CoinTypes, ERROR, Keys,
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
import { getDb } from '@/db/wallet-db';
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
import { util } from '@cardano-sdk/core';
import { Buffer } from 'buffer';
import { Bip32PrivateKey } from '@cardano-sdk/crypto';
import {
  Transaction,
} from '@emurgo/cardano-serialization-lib-browser';
import { convertToTxSchema } from '@/chrome/helper';
import {
  deserializeCardanoJsSdkTx,
  computeTxHash,
  serializeWitness,
} from '@/chrome/cardanoJsSdkCbor';
import { decrypt } from '@/shared/utils/crypto';

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

  getControlledAmount() {
    let controlledAmount: bigint = 0n;
    WalletStore.state.utxos.forEach((utxo: Cardano.Utxo) => {
      controlledAmount += utxo[1].value.coins
    })
    return controlledAmount;
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
      epochParamsTable.put({
        epoch: key,
        ...epoch_params[key],
      });
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
      const decrypted = decrypt(this.encryptedPrivateKey, password);
      const buffer: Buffer = decryptWithPassword(password, JSON.parse(decrypted));
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
      // Note: Staking pools sync moved to alarm-based refresh (every 4 hours)
      // Note: DReps sync moved to alarm-based refresh (every 4.5 hours)
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
   * @param isUsb - USB connection flag for hardware wallets
   * @returns Promise with witness set hex string
   */
  async signTx(txInput: string | Cardano.Tx, partialSign: boolean = false, password: string, accountIndex: number, utxos: Cardano.Utxo[], addresses: Keys, isUsb?: boolean): Promise<{ witnesses: string }> {
    let transaction: Cardano.Tx;

    // Convert input to Cardano JS SDK transaction
    if (typeof txInput === 'string') {
      // Deserialize CBOR hex string to Cardano JS SDK transaction
      transaction = deserializeCardanoJsSdkTx(txInput);
    } else {
      // Already a Cardano JS SDK transaction object
      transaction = txInput;
    }


    // Handle different wallet types
    if (this.type === WalletType.Ledger) {
      // Ledger signing logic would go here
      // For now, return empty witnesses to indicate hardware wallet integration needed
      return { witnesses: '' };
    } else if (this.type === WalletType.Trezor) {
      // Trezor signing logic would go here
      return { witnesses: '' };
    } else {
      // Software wallet signing using Cardano JS SDK

      // Decrypt private key
      const decrypted = decrypt(this.encryptedPrivateKey, password);
      const decodedHash = decryptWithPassword(password, JSON.parse(decrypted));
      password = null;

      if (!decodedHash && partialSign === false) {
        throw TxSignError.ProofGeneration;
      }

      const rootPrivateKey: Bip32PrivateKey = Bip32PrivateKey.fromBytes(decodedHash);

      // Derive account private key
      const accountPrivateKey = rootPrivateKey.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED + accountIndex]);

      // Create signature map for the witness
      const signatures = new Map<string, string>();

      // Analyze transaction to determine required signatures
      const requiredSigners = this.analyzeTransactionForSignatures(transaction, utxos, addresses, accountIndex);

      // Sign with each required key
      for (const signer of requiredSigners) {
        const privateKey = accountPrivateKey.derive(signer.derivationPath);
        const rawPublicKey = privateKey.toRawKey().toPublic();

        // Create transaction hash for signing
        const txBodyHash = computeTxHash(transaction.body);
        const txBodyHashBytes = Buffer.from(txBodyHash, 'hex');

        // Sign the transaction hash
        const signature = privateKey.toRawKey().sign(txBodyHashBytes);

        // Use the raw public key bytes (32 bytes) for the witness map, not the extended key
        const rawPublicKeyBytes = rawPublicKey.bytes();
        const rawPublicKeyHex = Buffer.from(rawPublicKeyBytes).toString('hex');

        signatures.set(
          rawPublicKeyHex as Ed25519PublicKeyHex,
          signature.hex() as Ed25519SignatureHex
        );
      }

      // Create witness set - ensure signatures map is properly set
      const witness: Cardano.Witness = {
        signatures: new Map(signatures), // Create a new Map to ensure it's properly set
        scripts: transaction.witness?.scripts,
        datums: transaction.witness?.datums,
        redeemers: transaction.witness?.redeemers,
        bootstrap: transaction.witness?.bootstrap
      };


      // Serialize witness to CBOR hex
      const witnessHex = serializeWitness(witness);

      return {
        witnesses: witnessHex
      };
    }
  }

  /**
   * Analyzes transaction to determine which keys need to sign
   * @param transaction - The transaction to analyze
   * @param utxos - Available UTXOs
   * @param addresses - Address mappings
   * @param accountIndex - Account index for derivation
   * @returns Array of signers with their derivation paths
   */
  private analyzeTransactionForSignatures(
    transaction: Cardano.Tx,
    utxos: Cardano.Utxo[],
    addresses: Keys,
    accountIndex: number
  ): Array<{ derivationPath: number[], type: string }> {
    const requiredSigners: Array<{ derivationPath: number[], type: string }> = [];

    // Check transaction inputs
    for (const input of transaction.body.inputs) {
      const utxo = utxos.find(u =>
        u[0].txId === input.txId && u[0].index === input.index
      );

      if (utxo) {
        const outputAddress = utxo[1].address;

        // The addresses parameter is actually the keys object from wallet store
        // It has structure: { payment: [addressObj], change: [addressObj], stake: [addressObj], ... }
        let foundAddressInfo = null;

        // Search in payment addresses
        if (addresses.payment) {
          foundAddressInfo = addresses.payment.find((addr: any) => addr.address === outputAddress);
        }

        // Search in change addresses if not found in payment
        if (!foundAddressInfo && addresses.change) {
          foundAddressInfo = addresses.change.find((addr: any) => addr.address === outputAddress);
        }

        if (foundAddressInfo && foundAddressInfo.path) {
          const pathArray = this.parseDerivationPath(foundAddressInfo.path);
          requiredSigners.push({
            derivationPath: pathArray,
            type: 'payment'
          });
        } else {
          // This should not happen if the wallet store is properly populated
          // But fallback to external 0 as last resort
          requiredSigners.push({
            derivationPath: [ChainDerivations.EXTERNAL, 0],
            type: 'payment'
          });
        }
      }
    }

    // Check for certificates (staking operations)
    if (transaction.body.certificates && transaction.body.certificates.length > 0) {
      for (const certificate of transaction.body.certificates) {
        if (certificate.__typename === Cardano.CertificateType.StakeRegistration ||
            certificate.__typename === Cardano.CertificateType.StakeDeregistration ||
            certificate.__typename === Cardano.CertificateType.StakeDelegation ||
            certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation) {
          // Need stake key signature
          requiredSigners.push({
            derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
            type: 'stake'
          });
        }
        // Add more certificate types as needed
      }
    }

    // Check for withdrawals
    if (transaction.body.withdrawals && transaction.body.withdrawals.length > 0) {
      for (const rewardAddress of transaction.body.withdrawals) {
        if (rewardAddress.stakeAddress === this.stakeAddress) {
          // Need stake key signature for withdrawal
          requiredSigners.push({
            derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
            type: 'stake'
          });
        }
      }
    }

    // Check for required signers field
    if (transaction.body.requiredExtraSignatures && transaction.body.requiredExtraSignatures.length > 0) {
      for (const keyHash of transaction.body.requiredExtraSignatures) {
        // Try to match the key hash to our known keys
        const paymentKeyHash = this.paymentKeyExternal(0).hash().hex();
        const stakeKeyHash = this.stakeKey().hash().hex();

        if (keyHash === Hash28ByteBase16(paymentKeyHash)) {
          requiredSigners.push({
            derivationPath: [ChainDerivations.EXTERNAL, 0],
            type: 'payment'
          });
        } else if (keyHash === Hash28ByteBase16(stakeKeyHash)) {
          requiredSigners.push({
            derivationPath: [ChainDerivations.CHIMERIC_ACCOUNT, 0],
            type: 'stake'
          });
        }
      }
    }

    // Remove duplicates
    const uniqueSigners = requiredSigners.filter((signer, index, self) =>
      index === self.findIndex(s =>
        s.derivationPath.join(',') === signer.derivationPath.join(',') && s.type === signer.type
      )
    );

    return uniqueSigners;
  }

  /**
   * Parses a derivation path string into an array of numbers
   * @param pathString - Derivation path string (e.g., "m/1852'/1815'/0'/0/0")
   * @returns Array of derivation path numbers
   */
  private parseDerivationPath(pathString: string): number[] {
    return pathString
      .replace('m/', '')
      .split('/')
      .map(segment => {
        const num = parseInt(segment.replace("'", ""));
        return segment.includes("'") ? num + HARDENED : num;
      })
      .slice(3); // Remove the first 3 elements (purpose, coin_type, account) as they're handled at account level
  }

  /**
   * Submit transaction using Cardano JS SDK
   * @param txInput - Either a legacy Transaction object, CBOR hex string, or Cardano.Tx object (Cardano JS SDK)
   * @param utxos - UTXOs for transaction schema conversion
   * @returns Promise with transaction ID
   */
  async submitTx(txInput: Transaction | string | Cardano.Tx, utxos: any[]): Promise<string> {
    let txCbor: string;
    let transaction: Cardano.Tx;

    // Handle different input types and convert to CBOR hex
    if (typeof txInput === 'string') {
      // Already a CBOR hex string
      txCbor = txInput;
      transaction = deserializeCardanoJsSdkTx(txInput);
    } else if (txInput instanceof Transaction) {
      // Legacy Emurgo Transaction object
      txCbor = txInput.to_hex();
      transaction = deserializeCardanoJsSdkTx(txCbor);
    } else {
      // Cardano JS SDK transaction object
      transaction = txInput;
      txCbor = Serialization.Transaction.fromCore(transaction).toCbor();
    }

    try {

      // Submit transaction via API
      const txId = await this.api.submitTx(txCbor);

      // Convert to transaction schema for database storage
      const txSchema = convertToTxSchema(txId, txCbor, utxos, this.networkId());

      // Store transaction in database
      this.setAccountTransactions([txSchema])
        .catch(e => console.error('Error storing transaction:', e));

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
        throw err;  // or return null, depending on your error-handling strategy
      }
    }

    return blockchainDb;
  }

  async startSync() {
    this.endSync();

    try {
      const tickerStatistics = await this.api.fetchTickerStatistics()
      NetworkStore.setPrice(tickerStatistics)
    } catch (err) {
      // Ignore ticker statistics errors
    }
    if (!NetworkStore.state.tickerStatisticsIntervalId) {
      NetworkStore.setTickerStatisticsIntervalId(setInterval(async () => {
        try {
          const tickerStatistics = await this.api.fetchTickerStatistics()
          NetworkStore.setPrice(tickerStatistics)
        } catch (err) {
          // Ignore ticker statistics errors
        }
      }, 20000))
    }

    // Fiat Rates
    try {
      const fiatRates = await this.api.fetchFiatRates()
      WalletStore.setFiatRates(fiatRates)
    } catch (err) {
      // Ignore fiat rates errors
    }
    if (!WalletStore.state.fiatRatesIntervalId) {
      WalletStore.setFiatRatesIntervalId(setInterval(async () => {
        try {
          const fiatRates = await this.api.fetchFiatRates()
          WalletStore.setFiatRates(fiatRates)
        } catch (err) {
          // Ignore fiat rates errors
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

/**
 * Alarm handler for refreshing staking pools every 4 hours
 * Implements the syncTable(1) functionality from SyncService
 */
async function refreshStakingPoolsAlarm() {
  try {

    // Get current logged wallet from WalletStore
    const loggedWallet = WalletStore.state.loggedWallet;
    if (!loggedWallet) {
      return;
    }

    // Import the API and database functions
    const { default: blockchainApi } = await import('@/api/blockchain-api');
    const { setStakingPools } = await import('@/db/index');

    // Fetch fresh staking pools data
    const stakingPoolsData = await blockchainApi.getAllStakingPools(loggedWallet.chain, loggedWallet.network);

    // Store staking pools data in database
    await setStakingPools(loggedWallet.chain, loggedWallet.network, stakingPoolsData);
  } catch (error) {
    console.error('❌ Error in staking pools refresh alarm:', error);
  }
}

/**
 * Alarm handler for refreshing DReps every ~4.5 hours (280 minutes)
 * Implements the syncTable(2) functionality from SyncService
 */
async function refreshDRepsAlarm() {
  try {

    // Get current logged wallet from WalletStore
    const loggedWallet = WalletStore.state.loggedWallet;
    if (!loggedWallet) {
      return;
    }

    // Import the API and database functions
    const { default: blockchainApi } = await import('@/api/blockchain-api');
    const { setDReps } = await import('@/db/index');

    // Fetch fresh DReps data
    const drepsData = await blockchainApi.getAllDReps(loggedWallet.chain, loggedWallet.network);

    // Store DReps data in database
    await setDReps(loggedWallet.chain, loggedWallet.network, drepsData);
  } catch (error) {
    console.error('❌ Error in DReps refresh alarm:', error);
  }
}

export function alarmListener(alarm) {
  if (alarm.name === 'refreshStakingPools') {
    refreshStakingPoolsAlarm();
  } else if (alarm.name === 'refreshDReps') {
    refreshDRepsAlarm();
  } else if (alarm.name === 'refreshDexHunterPrices') {
    DexHunterStore.updatePrices(Object.keys(WalletStore.state.tokens))
  } else if (alarm.name === 'refreshXerberusRisks') {
    XerberusStore.updateRisks(Object.values(WalletStore.state.tokens).map((token: any) => token.fingerprint))
  } else if (alarm.name === 'refreshTokenHistory') {
    RealFiStore.updateTokenHistory(Object.values(WalletStore.state.tokens).map((token: any) => token.unit))
  } else if (alarm.name.includes('portfolio')) {
    const stakeAddress = alarm.name.split('|')[1]
    TapToolsStore.loadPortfolio(stakeAddress)
  } else if (alarm.name.includes('trendedPortfolio')) {
    const stakeAddress = alarm.name.split('|')[1]
    TapToolsStore.loadPortfolioTrendedValue(stakeAddress)
  } else if (alarm.name === 'coinGeckoPrices') {
    CoinGeckoStore.updatePrices();
  }
}
