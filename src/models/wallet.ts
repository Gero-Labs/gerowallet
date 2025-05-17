import Dexie from 'dexie';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import * as CryptoTS from 'crypto-ts';
import cryptoRandomString from 'crypto-random-string';
import {
  Address,
  BaseAddress,
  Bip32PrivateKey,
  Certificate,
  CertificateKind,
  decrypt_with_password,
  encrypt_with_password,
  FixedTransaction,
  PrivateKey,
  PublicKey,
  RewardAddress,
  StakeDeregistration,
  Transaction,
  TransactionBody,
  TransactionInput,
  TransactionWitnessSet,
} from '@emurgo/cardano-serialization-lib-browser';
import { Api } from '@/api/api';
import networks from '@/utils/networks';
import {
  Blockchain,
  ChainDerivations,
  CoinTypes,
  ERROR,
  purpose,
  Tip,
  WalletType,
  WalletTypePurpose,
} from '@/models/types';
import db from '@/db';
import { chunkArray } from 'array-chunk-by-size';
import { extractKeyHash } from '@/chrome/extension';
import { APIError, DataSignError, STORAGE, TxSendError, TxSignError } from '@/chrome/config';
import { HARDENED, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import ledger from '@/shared/utils/ledger';
// import trezor from '@/shared/utils/trezor';
import loading from '@/plugins/loading';
import { appWallet, useStore } from '@/stores';
import {
  addVkeys,
  createCOSEKeyHex,
  createSignDataBuilder, getOwnedCred, hdPathToArray,
  safeFreeCSLObject,
  toHexArray,
  toHexString,
} from '@/shared/utils/converter';
import { parseHttpError } from '@/shared/utils/parser';
import { Cardano, Serialization } from '@cardano-sdk/core';
import {
  convertToTxSchema,
  getAddress,
  getCip129DrepId,
  getDrepKey,
  getPublicKey,
  getRewardAddress,
  getStakeKey,
} from '@/chrome/serialization';
import { Ed25519PublicKey, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import trezor from '@/shared/utils/trezor';
import { walletDBSchema, walletDBVersion } from '@/db/schema';
import zkFoldApi from '@/api/zk-fold.api';

export class Wallet {
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

  encryptedPrivateKey: any;
  passwordLastUpdate: Date;
  userId?: string;
  encryptedMnemonic?: string;
  zkBaseAddress?: Cardano.Address;

  constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network, userId?: string, encryptedMnemonic?: string) {
    this.id = id;
    this.name = name;
    this.icon = icon;
    this.type = type;
    this.theme = theme;
    this.order = order;
    this.encryptedPrivateKey = encryptedPrivateKey;
    this.publicKey = publicKey;
    this.passwordLastUpdate = passwordLastUpdate;
    this.chain = chain;
    this.network = network;
    this.userId = userId
    this.encryptedMnemonic = encryptedMnemonic
  }

  async init(): Promise<void> {
    const promises = []
    if (this.type === WalletType.Google) {
      promises.push(zkFoldApi.walletAddress(this.userId).then(res => {
        if (res['status'] !== 200) {
          throw new Error('Failed to get address');
        }
        this.zkBaseAddress = Cardano.Address.fromBech32(res['data']['address'])
      }))
    }
    promises.push(this.db.open().catch(async err => {
      if (err.name === 'NoSuchDatabaseError') {
        await db.createNewWalletDb(this.id, !!this.encryptedMnemonic);
      }
    }))
    await Promise.all(promises)
  }

  static class(wallet, provider) {
    const wal: Wallet = new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
      wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network, wallet.userId, wallet.encryptedMnemonic);
    wal.api = new Api(wallet, provider);
    wal.db = new Dexie('wallet-' + wallet.id);
    wal.db.version(walletDBVersion).stores(walletDBSchema);
    return wal;
  }

  static multisigClass(wallet, provider) {
    const wal: Wallet = new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
      wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network);
    wal.api = new Api(wallet, provider);
    wal.db = new Dexie(wallet.multisigDBName);
    wal.db.version(walletDBVersion).stores(walletDBSchema);
    wal.db.open().catch(async err => {
      if (err.name === 'NoSuchDatabaseError') {
        await db.createNewWalletDb(wallet.id, false, false);
      }
      console.log(err);
    });
    return wal;
  }

  static resolvePrivateKey(mnemonic: string): Bip32PrivateKey {
    const bip39entropy = bip39.mnemonicToEntropy(mnemonic);
    return Bip32PrivateKey.from_bip39_entropy(Buffer.from(bip39entropy, 'hex'), Buffer.from(''));
  }

  static encryptPrivateKey(rootKey, password): string {
    const privateKey = this.encryptWithPassword(password, rootKey.as_bytes());
    return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString();
  }

  static encryptWithPassword(password, rootKeyBytes): string {
    const passwordHex = Buffer.from(password).toString('hex');
    const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
    const salt = cryptoRandomString({ length: 2 * 32 });
    const nonce = cryptoRandomString({ length: 2 * 12 });
    return encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
  }

  verifySpendingPassword(password: string) {
    try {
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      return true;
    } catch (e) {
      return false;
    }
  }

  requestAccountKey(password: string, accountIndex: number): {
    accountKey: Bip32PrivateKey,
    paymentKey: PrivateKey,
    stakeKey: PrivateKey
  } {
    let accountKey: Bip32PrivateKey;
    try {
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const buffer: Buffer = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      accountKey = Bip32PrivateKey.from_bytes(buffer)
        .derive(WalletTypePurpose.CIP1852) // purpose
        .derive(CoinTypes.CARDANO) // coin type;
        .derive(HARDENED + accountIndex);
    } catch (e) {
      throw ERROR.wrongPassword;
    }

    return {
      accountKey,
      paymentKey: accountKey.derive(0).derive(0).to_raw_key(),
      stakeKey: accountKey.derive(2).derive(0).to_raw_key(),
    };
  }

  decryptWithPassword(password: string, privateKey): Buffer {
    const passwordHex = Buffer.from(password).toString('hex');
    let decryptedHex;
    try {
      decryptedHex = decrypt_with_password(passwordHex, privateKey);
    } catch (err) {
      throw new Error('Wrong Passphrase');
    }
    return Buffer.from(decryptedHex, 'hex');
  }

  networkId(): number {
    return networks.resolveNetworkId(this.chain, this.network);
  }

  pubKey(index: number): Ed25519PublicKey {
    return getPublicKey(this.publicKey)
      .derive([ChainDerivations.EXTERNAL, index])
      .toRawKey();
  }

  pubKeyInternal(index: number): Ed25519PublicKey {
    return getPublicKey(this.publicKey)
      .derive([ChainDerivations.INTERNAL, index])
      .toRawKey();
  }

  stakeKey(): Ed25519PublicKey {
    return getStakeKey(this.publicKey, 0)
  }

  drepKey(): Ed25519PublicKey {
    return getDrepKey(this.publicKey, 0)
  }

  baseAddress(): Cardano.Address {
    let address: Cardano.Address;
    if (this.type === WalletType.Google) {
      address = this.zkBaseAddress;
    } else {
      address = this.deriveAddressFromPath(0)
    }
    return address;
    // return BaseAddress.from_address(Address.from_bech32("addr1q8gzvfe9dxc2csqcra6u78a9t2qyg5u2k3zkllsynu975yt4raqscm7t80hqu0lq3vxtphzz7fx2xt5vm0he5fmf0nzq2et2pa"))
  }

  stakeAddress(): Cardano.Address {
    return getRewardAddress(this.publicKey, this.chain, this.network)
    // return RewardAddress.from_address(Address.from_bech32("stake1u9637sgvdl9nhmsw8lsgkr9sm3p0yn9r96xdhmu6ya5he3q847rpv"))
  }

  isEnterpriseAddress(): boolean {
    const baseAddress = this.baseAddress();
    return baseAddress.getType() === Cardano.AddressType.EnterpriseScript;
  }

  drepId(): Cardano.DRepID {
    return getCip129DrepId(this.publicKey);
  }

  paymentKeyHash(address: string): Hash28ByteBase16 {
    const keyAddress: Cardano.Address = Cardano.Address.fromBech32(address);
    try {
      return Cardano.BaseAddress.fromAddress(keyAddress).getPaymentCredential().hash;
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    try {
      return Cardano.EnterpriseAddress.fromAddress(keyAddress).getPaymentCredential().hash
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    try {
      return Cardano.PointerAddress.fromAddress(keyAddress).getPaymentCredential().hash
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    try {
      return Cardano.RewardAddress.fromAddress(keyAddress).getPaymentCredential().hash
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    return undefined;
  }

  async signData(address: string, payload: string, password: string, accountIndex: number, isUsb: boolean) {
    let signatureHex: string, keyHex: string;

    const buildAndSignData = (builder: any, signingData: Uint8Array, accountKey: PrivateKey | undefined) => {
      const signedData = accountKey ? accountKey.sign(signingData).to_bytes() : signingData;
      const coseSign1 = builder.build(signedData);
      const signatureHex = toHexString(coseSign1.to_bytes());
      safeFreeCSLObject(builder);
      safeFreeCSLObject(coseSign1);
      return signatureHex;
    };

    if (this.type === WalletType.Ledger) {
      const response: SignedMessageData = await ledger.signData(
        address, payload, networks.resolveNetwork(this.chain, this.network), accountIndex, isUsb,
      );

      const builder = createSignDataBuilder(toHexArray(response.addressFieldHex), payload, payload.length > 99);
      signatureHex = buildAndSignData(builder, toHexArray(response.signatureHex), undefined);
      keyHex = createCOSEKeyHex(toHexArray(response.signingPublicKeyHex));

    } else {
      const keyHash: string = chrome.storage
        ? await extractKeyHash(address)
        : BaseAddress.from_address(
          Address.from_bech32(Buffer.from(address, 'hex').toString()),
        ).payment_cred().to_keyhash().to_bech32('addr_vkh');

      const prefix: string = keyHash.startsWith('addr_vkh') ? 'addr_vkh' : 'stake_vkh';
      const { paymentKey, stakeKey } = this.requestAccountKey(password, accountIndex);
      const accountKey: PrivateKey = prefix === 'addr_vkh' ? paymentKey : stakeKey;
      const publicKey: PublicKey = accountKey.to_public();

      if (keyHash !== publicKey.hash().to_bech32(prefix)) {
        throw DataSignError.ProofGeneration;
      }

      const builder = createSignDataBuilder(toHexArray(address), payload, false);
      const toSign = builder.make_data_to_sign().to_bytes();
      signatureHex = buildAndSignData(builder, toSign, accountKey);
      keyHex = createCOSEKeyHex(publicKey.as_bytes());
    }

    return { signature: signatureHex, key: keyHex };
  }

  // async signTx(unsignedTx: string, partialSign: boolean = false, password: string, keyIndex = 0, utxos, addresses: string[], isUsb?: boolean) {
  //   try {
  //     await Crypto.ready()
  //     const rawTx = deserializeTx(unsignedTx);
  //     const txBody: TransactionBody = rawTx.body();
  //     const credList: Set<any> = new Set()
  //     for (let i = 0; i < txBody.inputs().values().length ; i++) {
  //       const input: TransactionInput = txBody.inputs().values()[i];
  //       const inputTxHash = input.transactionId();
  //       const inputTxIndex = input.index();
  //       const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);
  //
  //       if (utxo) {
  //         const address: string = addresses[utxo.payment_addr.bech32]
  //         credList.add(address)
  //       }
  //     }
  //
  //     // if (this.type === WalletType.Ledger) { // Ledger Signing Logic
  //     //   const wit: string = await ledger.txToLedger(rawTx, this, credList, 0, addresses, utxos, isUsb);
  //     //   return { witnesses: wit };
  //     // } else if (this.type === WalletType.Trezor) { // Trezor Signing Logic
  //     //   console.log('Signing with Trezor...');
  //     //   const wit: TransactionWitnessSet = <TransactionWitnessSet>(
  //     //     await trezor.txToTrezor(txBody, this.baseAddress().toBech32(), 0, true, utxos)
  //     //   );
  //     //   if (!wit) {
  //     //     throw new Error('Trezor did not return a valid witness set.');
  //     //   }
  //     //   const witnessHex = Buffer.from(wit.to_bytes()).toString('hex');
  //     //   return { witnesses: witnessHex };
  //     // } else { // Software Wallet Signing
  //
  //       if (
  //         !partialSign &&
  //         rawTx.witnessSet().vkeys() !== undefined &&
  //         rawTx.witnessSet().vkeys()!.size() !== 0
  //       )
  //         throw new Error(
  //           "Signatures already exist in the transaction in a non partial sign call",
  //         );
  //
  //       const txHash = deserializeTxHash(resolveTxHash(unsignedTx));
  //
  //       console.log('Signing with Software Wallet...');
  //       const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
  //       const decodedHash = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
  //       password = null;
  //       if (!decodedHash && partialSign === false) {
  //         throw TxSignError.ProofGeneration;
  //       }
  //       const prvPaymentKey = resolvePrivatePaymentKey(decodedHash, keyIndex);
  //
  //       const vkeyWitness = new VkeyWitness(
  //         prvPaymentKey.toPublic().hex(),
  //         prvPaymentKey.sign(HexBlob(txHash)).hex(),
  //       );
  //       return {
  //         witnesses: addWitnessSets(unsignedTx, [vkeyWitness])
  //       };
  //     // }
  //   } catch (error) {
  //     throw new Error(`An error occurred during signTx: ${error}.`);
  //   }
  // }

  async signTx(txCbor: string, partialSign: boolean = false, password: string, accountIndex: number, utxos, addresses: string[], isUsb?: boolean): Promise<{ witnesses: string }> {
    const rawTx: FixedTransaction = FixedTransaction.from_hex(txCbor);
    const witnessSet: TransactionWitnessSet = rawTx.witness_set();
    const txBody: TransactionBody = rawTx.body();
    const baseAddress: Cardano.Address = this.baseAddress();
    const stakeAddress: RewardAddress = RewardAddress.from_address(Address.from_bech32(this.stakeAddress().toBech32()))
    const network= networks.resolveNetwork(appWallet.chain, appWallet.network);
    const credList: Set<any> = new Set()
    const accountData = {
      state: {
        networkId: network.networkId
      },
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
    }
    for (let i = 0; i < txBody.inputs().len(); i++) {
      const input: TransactionInput = txBody.inputs().get(i);
      const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
      const inputTxIndex = input.index();
      const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);

      if (utxo) {
        const address: string = addresses[utxo.payment_addr.bech32]
        credList.add(address)
      }
    }
    if (txBody.certs()) {
      console.log('certs')
      for (let i = 0 ; i < txBody.certs().len() ; i++) {
        const certificate: Certificate = txBody.certs().get(i);
        let keyHash
        if (certificate.kind() == CertificateKind.StakeRegistration) {
          const stakeRegistration = certificate.as_stake_registration()
          keyHash = stakeRegistration.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeDeregistration) {
          const stakeDeregistration: StakeDeregistration = certificate.as_stake_deregistration()
          keyHash = stakeDeregistration.stake_credential().to_keyhash().to_hex();
        } else if (certificate.kind() == CertificateKind.StakeDelegation) {
          const stakeDelegation = certificate.as_stake_delegation()
          keyHash = stakeDelegation.stake_credential().to_keyhash().to_hex();
        }
        // else if (certificate.kind() == CertificateKind.PoolRegistration) {
        //
        // } else if (certificate.kind() == CertificateKind.PoolRetirement) {
        //
        // } else if (certificate.kind() == CertificateKind.GenesisKeyDelegation) {
        //
        // } else if (certificate.kind() == CertificateKind.MoveInstantaneousRewardsCert) {
        //
        // } else if (certificate.kind() == CertificateKind.CommitteeHotAuth) {
        //
        // } else if (certificate.kind() == CertificateKind.CommitteeColdResign) {
        //
        // } else if (certificate.kind() == CertificateKind.DRepDeregistration) {
        //
        // }
        // else if (certificate.kind() == CertificateKind.DRepRegistration) {
        //
        // }
        // else if (certificate.kind() == CertificateKind.DRepUpdate) {
        //
        // } else if (certificate.kind() == CertificateKind.StakeAndVoteDelegation) {
        //
        // }
        else if (certificate.kind() == CertificateKind.StakeRegistrationAndDelegation) {
          const stakeRegistrationAndDelegation = certificate.as_stake_registration_and_delegation()
          keyHash = stakeRegistrationAndDelegation.stake_credential().to_keyhash().to_hex();
        }
        // else if (certificate.kind() == CertificateKind.StakeVoteRegistrationAndDelegation) {
        //
        // }
        else if (certificate.kind() == CertificateKind.VoteDelegation) {
          const voteDelegation = certificate.as_vote_delegation()
          keyHash = voteDelegation.stake_credential().to_keyhash().to_hex();
        }
        // else if (certificate.kind() == CertificateKind.VoteRegistrationAndDelegation) {
        //
        // }
        if (accountData.keys.stake[0].cred === keyHash) {
          credList.add(accountData.keys.stake[0])
        }
      }
    }
    if (txBody.withdrawals()) {
      const bigNum = txBody.withdrawals().get(stakeAddress)
      if (bigNum) {
        credList.add(accountData.keys.stake[0])
      }
    }
    const vKeyHashes = new Set();
    if (witnessSet?.vkeys()) {
      for (let i = 0 ; i < witnessSet.vkeys().len() ; i++) {
        vKeyHashes.add(witnessSet.vkeys().get(i).vkey().public_key().hash().to_hex())
      }
    }
    if (txBody.required_signers()) {
      for (let i = 0 ; i < txBody.required_signers().len(); i++) {
        const requiredKeyHash = txBody.required_signers().get(i)
        const requiredVKeyHash = requiredKeyHash.to_hex()
        if (!vKeyHashes.has(requiredVKeyHash)) {
          credList.add(getOwnedCred([accountData.keys], requiredVKeyHash))
        }
      }
    }
    if (this.type === WalletType.Ledger) { // Ledger Signing Logic
      const wit: string = await ledger.txToLedger(rawTx, this, credList, 0, addresses, utxos, isUsb);
      return { witnesses: wit };
    } else if (this.type === WalletType.Trezor) { // Trezor Signing Logic
      console.log('Signing with Trezor...');
      const wit: TransactionWitnessSet = <TransactionWitnessSet>(
        await trezor.txToTrezor(txBody, this.baseAddress().toBech32(), accountIndex, true, utxos)
      );
      if (!wit) {
        throw new Error('Trezor did not return a valid witness set.');
      }
      const witnessHex = Buffer.from(wit.to_bytes()).toString('hex');
      return { witnesses: witnessHex };
    } else { // Software Wallet Signing
      console.log('Signing with Software Wallet...');
      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const decodedHash = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
      password = null;
      if (!decodedHash && partialSign === false) {
        throw TxSignError.ProofGeneration;
      }
      const prvRootKeyBech32: Bip32PrivateKey = Bip32PrivateKey.from_bytes(decodedHash)
      const txHash = rawTx.transaction_hash();

      addVkeys(txHash, witnessSet, credList, prvRootKeyBech32)
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

  async startSync() {
    console.log('startSync');
    useStore().clearSyncIntervals()
    // Chain Tip
    try {
      await appWallet.sync()
    } catch (err) {
      console.log(err)
    }
    if (!useStore().intervals.syncIntervalId) {
      useStore().intervals.syncIntervalId = setInterval(async () => {
        try {
          await appWallet.sync()
        } catch (err) {
          console.log(err)
        }
      }, 20000)
    }

    // Ticker Price
    try {
      useStore().setPrice(await appWallet.fetchTickerStatistics())
    } catch (err) {
      console.log(err)
    }
    if (!useStore().intervals.tickerStatisticsIntervalId) {
      useStore().intervals.tickerStatisticsIntervalId = setInterval(async () => {
        try {
          useStore().setPrice(await appWallet.fetchTickerStatistics())
        } catch (err) {
          console.log(err)
        }
      }, 20000)
    }

    // Fiat Rates
    try {
      useStore().setFiatRates(await appWallet.fetchFiatRates())
    } catch (err) {
      console.log(err)
    }
    if (!useStore().intervals.fiatRatesIntervalId) {
      useStore().intervals.fiatRatesIntervalId = setInterval(async () => {
        try {
          useStore().setFiatRates(await appWallet.fetchFiatRates())
        } catch (err) {
          console.log(err)
        }
      }, 14400000);
    }
  }

  endSync() {
    clearInterval(useStore().intervals.syncIntervalId)
    clearInterval(useStore().intervals.fiatRatesIntervalId)
    clearInterval(useStore().intervals.tickerStatisticsIntervalId)
  }

  async sync(): Promise<void> {
    if (this.syncLock) {
      // If sync is already running, wait for it to complete
      await this.syncLock;
      return;
    }
    this.syncLock = (async () => {
      try {
        loading.setSyncing(true);
        console.log('sync');
        let tip: Tip = await this.fetchTip();
        const lastSyncInfo = await this.getLastSyncInfo();
        if (!lastSyncInfo) {
          // loading.setText('Restoring Wallet Data. Please Wait ...')
          loading.setRestoring(true);
          await this.restore(tip);
          loading.setRestoring(false);
        } else if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
          const promises = [];
          if (!this.isEnterpriseAddress()) {
            promises.push(this.syncTable(1)); // Sync Staking Pools
            promises.push(this.syncTable(2)); // Sync DReps
          }
          // promises.push(this.syncProtocolParams(tip.epoch));
          const prevAccountInfo = await this.getAccountInfo();
          const from = !lastSyncInfo ? 0 : lastSyncInfo['height']
          const baseAddress: Cardano.Address = this.baseAddress()
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
        loading.setSyncing(false); // Ensure to reset syncing state after execution
      }
    })();
    // Wait for the locked sync operation to complete
    await this.syncLock;
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

  async resync() {
    await this.db
      .open()
      .then(db => {
        const syncTable = db.table('sync');
        syncTable.clear();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
    await this.db
      .open()
      .then(db => {
        const syncTable = db.table('account');
        syncTable.clear();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
    await appWallet.sync();
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
    loading.setSyncing(false);
  }

  async syncAssets(units: string[], _force?: boolean): Promise<void> {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    await this.setAssets(units, blockchainDB);
  }

  async setAssets(units: string[], blockchainDB: Dexie) {
    const promises: any[] = [];
    const smallerArrays = chunkArray({ input: units, bytesSize: 5 * 1024 });
    smallerArrays.forEach(smallerArray => {
      promises.push(this.getAssetsInfo(smallerArray, blockchainDB));
    });
    (await Promise.all(promises)).flat();
  }

  async setAssets2(assets): Promise<void> {
    console.log('setAssets');
    const blockchainDB: Dexie = await this.getBlockchainDb();
    const assetsTable = blockchainDB.table('assets');
    if (assetsTable) {
      assetsTable.bulkPut(assets);
    }
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

  public async getDetailedAssetsInfo(policyId: string, assetName: string) {
    try {
      // const blockchainDB: Dexie = await this.getBlockchainDb();
      // const assetsTable = blockchainDB.table('assets');
      const res = await this.api.getDetailedAssetsInfo(policyId, assetName);
      if (res.status === 200) {
        // assetsTable.bulkPut(res);
        return res.data;
      } else {
        console.log(parseHttpError(res))
      }
    } catch (e) {
      console.log(e);
    }
    return null;
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

  async fetchTip(): Promise<Tip> {
    try {
      const tip = await this.api.getTip();
      useStore().setConnected(true)
      return tip
    } catch (e) {
      useStore().setConnected(false)
      throw e
    }
  }

  async fetchTickerStatistics(): Promise<any> {
    return await this.api.fetchTickerStatistics();
  }

  async fetchFiatRates(): Promise<any> {
    return await this.api.fetchFiatRates();
  }

  async syncAccountInfo(): Promise<any> {
    try {
      let res;
      if (this.isEnterpriseAddress()) {
        res = await this.api.getAccountInfo(this.baseAddress().toBech32());
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

  async syncAddresses(knownAddresses: string[]): Promise<Set<string>> {
    const resolvedAddressesSet: Set<string> = new Set();
    try {
      const db = await this.db.open();
      const addressesTable = db.table('addresses');
      if (!addressesTable) {
        throw new Error('No Addresses table.');
      }

      // Resolve the addresses using your helper function.
      const resolvedAddresses = this.resolvePathsForMissingAddresses(knownAddresses);

      // If we found any resolved addresses, bulk insert them.
      if (resolvedAddresses?.length > 0) {
        await addressesTable.bulkPut(resolvedAddresses);
      }

      // Return the resolved addresses.
      resolvedAddresses.forEach(address => {
        resolvedAddressesSet.add(address.address);
      })
      return resolvedAddressesSet;
    } catch (err) {
      console.error(`Failed to open database: ${err}`);
      return resolvedAddressesSet;
    }
  }

  resolvePathsForMissingAddresses(usedAddresses: string[]) {
    const resolvedAddresses = [];
    let addressIndex: number = 0;       // Start from the first address index
    let consecutiveUnused: number = 0;  // Track consecutive unused addresses
    const GAP_LIMIT = 20;       // Define the gap limit as 20
    while (consecutiveUnused < GAP_LIMIT) {
      const derivedAddress: string = this.deriveAddressFromPath(addressIndex).toBech32();
      const internalDerivedAddress: string = this.deriveInternalAddressFromPath(addressIndex).toAddress().toBech32();
      let found: boolean = false;
      if (usedAddresses.includes(derivedAddress)) {
        resolvedAddresses.push({
          address: derivedAddress,
          path: `m/${purpose.hdwallet}'/1815'/0'/${ChainDerivations.EXTERNAL}/${addressIndex}`,
          cred: this.paymentKeyHash(derivedAddress),
        });
        consecutiveUnused = 0;  // Reset unused counter if we find a match
        found = true;
      }
      if (usedAddresses.includes(internalDerivedAddress)) {
        resolvedAddresses.push({
          address: internalDerivedAddress,
          path: `m/${purpose.hdwallet}'/1815'/0'/${ChainDerivations.INTERNAL}/${addressIndex}`,
          cred: this.paymentKeyHash(internalDerivedAddress)
        });
        consecutiveUnused = 0;  // Reset unused counter if we find a match
        found = true;
      }
      if (!found) {
        consecutiveUnused++;  // Increment unused address counter if no match is found
      }
      // If we've resolved all missing addresses, we can break early
      if (usedAddresses.length === resolvedAddresses.length) {
        break;
      }
      addressIndex++;  // Move to the next address index
    }
    return resolvedAddresses;
  }

  deriveAddressFromPath(addressIndex: number): Cardano.Address {
    return getAddress(this.publicKey, this.chain, this.network, addressIndex)
  }

  deriveInternalAddressFromPath(addressIndex) {
    return Cardano.BaseAddress.fromCredentials(
      this.networkId(),
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16.fromEd25519KeyHashHex(this.pubKeyInternal(addressIndex).hash().hex())
      },
      {
        type: Cardano.CredentialType.KeyHash,
        hash: Hash28ByteBase16.fromEd25519KeyHashHex(this.stakeKey().hash().hex())
      }
    );
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

  async syncAccountTransactions(height: number): Promise<any> {
    try {
      let res
      if (this.isEnterpriseAddress()) {
        res = await this.api.getAccountTransactions(this.baseAddress().toBech32(), height);
      } else {
        res = await this.api.getAccountTransactions(this.stakeAddress().toBech32(), height);
      }
      if (res && Array.isArray(res)) {
        const promises = [];
        const txHashes: string[] = res.map(tx => tx.tx_hash);
        const smallerArrays = chunkArray({ input: txHashes, bytesSize: 5 * 1024 });
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

  async getDb(): Promise<Dexie> {
    return this.db.open();
  }

  public async getBlockchainDb(): Promise<Dexie> {
    return db.checkAndCreateBlockchainDatabase(this.chain + '_' + this.network);
  }

  async addConnectedDapp(domain: string) {
    try {
      const db = await this.db.open();
      const dappsTable = db.table('connected_dapps');

      if (!dappsTable) throw new Error('No Connected Dapps Table.');

      // Check if the domain already exists in the table
      const existingDapp = await dappsTable.get({ domain: domain });

      if (existingDapp) {
        console.log(`Domain ${domain} already exists, ignoring.`);
        return;
      }

      // Insert new domain
      const domainObject = { domain, time: new Date().getTime() }
      domainObject['id'] = await dappsTable.put(domainObject)
      console.log(`Domain ${domain} added successfully.`);

      // Update chrome storage if available
      if (chrome?.storage) {
        const res = await chrome.storage.local.get([STORAGE.whitelisted]);
        const whitelisted = res[STORAGE.whitelisted] || [];
        whitelisted.push(domainObject);
        await chrome.storage.local.set({ [STORAGE.whitelisted]: whitelisted });
        console.log(`Updated chrome storage with new domain:`, domainObject);
      }
    } catch (err) {
      console.error(`Failed to add connected dapp: ${err}`);
    }
  }
}
