import Dexie from 'dexie';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import * as CryptoTS from 'crypto-ts';
import cryptoRandomString from 'crypto-random-string';
import {
  BaseAddress,
  Bip32PrivateKey,
  Bip32PublicKey,
  RewardAddress,
  PublicKey,
  StakeCredential,
  encrypt_with_password,
  decrypt_with_password,
  PrivateKey,
  Transaction,
  TransactionWitnessSet,
  Vkeywitnesses,
  hash_transaction,
  make_vkey_witness,
  FixedTransaction,
  Address,
  EnterpriseAddress,
  PointerAddress,
  TransactionHash,
} from '@emurgo/cardano-serialization-lib-browser';
import { Api } from '@/api/api';
import networks from '@/shared/utils/networks';
import {
  Blockchain,
  ChainDerivations,
  CoinTypes,
  ERROR,
  STAKING_KEY_INDEX, WalletType,
  WalletTypePurpose,
} from '@/models/types';
import db from '@/db';
import { chunkArray } from 'array-chunk-by-size';
import { extractKeyHash } from '@/chrome/extension';
import { DataSignError, TxSignError } from '@/chrome/config';
import {
  AlgorithmId,
  CBORValue,
  HeaderMap,
  Label,
  ProtectedHeaderMap,
  Headers,
  COSESign1Builder, COSEKey, KeyType, Int, BigNum,
} from '@emurgo/cardano-message-signing-browser';
import { HARDENED } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import { TxScanRequest, TxScanResponse } from '@/models/tx-scan';
import ledger from '@/shared/utils/ledger';
import trezor from '@/shared/utils/trezor';

const blake2b = require('blake2b');

export class Wallet {
  db: Dexie;
  api: Api;
  locked: Boolean = false;

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

  constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network) {
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
  }

  static class(wallet, provider) {
    const wal = new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
      wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network);
    wal.api = new Api(provider);
    wal.db = new Dexie('wallet-' + wallet.id);
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
      const buffer = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)));
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

  pubKey(index: number): PublicKey {
    return Bip32PublicKey.from_bech32(this.publicKey)
      .derive(ChainDerivations.EXTERNAL)
      .derive(index)
      .to_raw_key();
  }

  stakeKey(): PublicKey {
    return Bip32PublicKey.from_bech32(this.publicKey)
      .derive(ChainDerivations.CHIMERIC_ACCOUNT)
      .derive(STAKING_KEY_INDEX)
      .to_raw_key();
  }

  baseAddress(): BaseAddress {
    return BaseAddress.new(
      this.networkId(),
      StakeCredential.from_keyhash(this.pubKey(0).hash()),
      StakeCredential.from_keyhash(this.stakeKey().hash()),
    );
  }

  stakeAddress(): RewardAddress {
    return RewardAddress.new(this.networkId(), StakeCredential.from_keyhash(this.stakeKey().hash()));
  }

  paymentKeyHash(address: string) {
    const keyAddress = Address.from_bech32(address);
    try {
      const baseKeyAddress = BaseAddress.from_address(keyAddress)
        .payment_cred()
        .to_keyhash();
      return baseKeyAddress.to_bytes();
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    try {
      const enterpriseKeyAddress = EnterpriseAddress.from_address(keyAddress)
        .payment_cred()
        .to_keyhash();
      return enterpriseKeyAddress.to_bytes();
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    try {
      const pointerKeyAddress = PointerAddress.from_address(keyAddress)
        .payment_cred()
        .to_keyhash();
      return pointerKeyAddress.to_bytes();
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    try {
      const rewardKeyAddress = RewardAddress.from_address(keyAddress)
        .payment_cred()
        .to_keyhash();
      return rewardKeyAddress.to_bytes();
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    return undefined;
  }

  stakeKeyHash(address) {
    const keyAddress = Address.from_bech32(address);
    try {
      const baseKeyAddress = BaseAddress.from_address(keyAddress)
        .stake_cred()
        .to_keyhash();
      return baseKeyAddress.to_bytes();
    } catch (e) {
      // I want application to not crush, but don't care about the message
    }
    return undefined;
  }

  async signData(address: string, payload: string, password: string, accountIndex: number) {
    const keyHash = await extractKeyHash(address);
    const prefix: string = keyHash.startsWith('addr_vkh') ? 'addr_vkh' : 'stake_vkh';
    let { paymentKey, stakeKey } = this.requestAccountKey(password, accountIndex);
    const accountKey: PrivateKey = prefix === 'addr_vkh' ? paymentKey : stakeKey;
    const publicKey = accountKey.to_public();
    console.log('t')
    if (keyHash !== publicKey.hash().to_bech32(prefix))
      throw DataSignError.ProofGeneration;
    const protectedHeaders = HeaderMap.new();
    protectedHeaders.set_algorithm_id(Label.from_algorithm_id(AlgorithmId.EdDSA));
    // protectedHeaders.set_key_id(publicKey.as_bytes()); // Removed to adhere to CIP-30
    protectedHeaders.set_header(Label.new_text('address'), CBORValue.new_bytes(Buffer.from(address, 'hex')));
    const protectedSerialized = ProtectedHeaderMap.new(protectedHeaders);
    const unprotectedHeaders = HeaderMap.new();
    const headers = Headers.new(protectedSerialized, unprotectedHeaders);
    const builder = COSESign1Builder.new(headers, Buffer.from(payload, 'hex'), false);
    const toSign = builder.make_data_to_sign().to_bytes();
    const signedSigStruc = accountKey.sign(toSign).to_bytes();
    const coseSign1 = builder.build(signedSigStruc);
    stakeKey.free();
    stakeKey = null;
    paymentKey.free();
    paymentKey = null;
    const key = COSEKey.new(Label.from_key_type(KeyType.OKP));
    key.set_algorithm_id(Label.from_algorithm_id(AlgorithmId.EdDSA));
    key.set_header(Label.new_int(Int.new_negative(BigNum.from_str('1'))), CBORValue.new_int(Int.new_i32(6))); // crv (-1) set to Ed25519 (6)
    key.set_header(Label.new_int(Int.new_negative(BigNum.from_str('2'))), CBORValue.new_bytes(publicKey.as_bytes())); // x (-2) set to public key
    return {
      signature: Buffer.from(coseSign1.to_bytes()).toString('hex'),
      key: Buffer.from(key.to_bytes()).toString('hex'),
    };
  }

  async signTx(txCbor: string, partialSign = false, password: string, accountIndex: number, utxos, addresses: string[]) {
    const rawTx = FixedTransaction.from_hex(txCbor);
    const vkeyWitnesses = Vkeywitnesses.new();
    const txBody = rawTx.body();
    const deduped = [];
    const keyHashes = [];

    const txHashHex = blake2b(new Uint8Array(32).length).update(rawTx.raw_body()).digest('hex');

    const changeAddress = this.baseAddress().to_address().to_bech32()
    let paymentKeyHash = this.paymentKeyHash(changeAddress);
    let paymentkeyHex = Buffer.from(paymentKeyHash).toString('hex');

    let stakeKeyHash = this.stakeKeyHash(changeAddress);
    let stakeKeyHex = Buffer.from(stakeKeyHash).toString('hex');

    for (let i = 0; i < txBody.inputs().len(); i++) {
      const input = txBody.inputs().get(i);
      const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
      const inputTxIndex = input.index();
      const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);

      if (utxo) {
        paymentKeyHash = this.paymentKeyHash(utxo.payment_addr.bech32);
        paymentkeyHex = Buffer.from(paymentKeyHash).toString('hex');

        stakeKeyHash = this.stakeKeyHash(utxo.payment_addr.bech32);
        stakeKeyHex = Buffer.from(stakeKeyHash).toString('hex');

        if (!keyHashes.includes(paymentkeyHex)) {
          keyHashes.push(paymentkeyHex);
          deduped.push(utxo);
        }
      }
    }

    const paymentKeyHashes = addresses.map(address => this.paymentKeyHash(address))
      .filter((hash) => !!hash)
      .map((keyHash) => Buffer.from(keyHash).toString('hex'));

    //get keyHashes from required signers
    const requiredSigners = txBody.required_signers();
    if (requiredSigners) {
      for (let i = 0; i < requiredSigners.len(); i++) {
        const requiredKeyHash = Buffer.from(requiredSigners.get(i).to_bytes()).toString('hex');
        if (!keyHashes.includes(requiredKeyHash)) {
          if (paymentKeyHashes.includes(requiredKeyHash)) {
            keyHashes.push(requiredKeyHash);
            deduped.push({ addressing: { type: 0, path: 0 } });
          } else if (requiredKeyHash === stakeKeyHex) {
            keyHashes.push(requiredKeyHash);
            deduped.push({ addressing: { type: 2, path: 0 } });
          }
        }
      }
    }

    if (this.type === WalletType.Trezor) {
      const wit: TransactionWitnessSet = <TransactionWitnessSet>(
        await trezor.txToTrezor(txBody, this.baseAddress().to_address().to_bech32(), 0, true, utxos)
      );
      return { witnesses: Buffer.from(wit.to_bytes()).toString('hex') }
    } else if (this.type === WalletType.Ledger) {
      const wit: TransactionWitnessSet = <TransactionWitnessSet>(
        await ledger.txToLedger(txBody, this.baseAddress().to_address().to_bech32(), 0, null, true, utxos)
      );
      return { witnesses: Buffer.from(wit.to_bytes()).toString('hex') }
    } else {
      // const privateKey = await this.sendNewTransactionService.getPrivateKey(password);
      // const decodedHash = await this.passwordCipher.decryptWithPassword(password, privateKey as string);

      const bytes = CryptoTS.AES.decrypt(this.encryptedPrivateKey, password);
      const decodedHash = this.decryptWithPassword(password, JSON.parse(bytes.toString(CryptoTS.enc.Utf8)))

      if (!decodedHash && partialSign === false) {
        throw TxSignError.ProofGeneration;
      }
      const txHash = TransactionHash.from_bytes(Buffer.from(txHashHex, 'hex'));

      deduped.forEach((utxo) => {
        const prvKey = Bip32PrivateKey.from_bytes(decodedHash)
          .derive(WalletTypePurpose.CIP1852)
          .derive(CoinTypes.CARDANO)
          .derive(HARDENED + accountIndex) // TODO: move this logic on a separate variable (Account key)
          .derive(utxo.addressing ? utxo.addressing.type : 0)
          .derive(utxo.addressing ? utxo.addressing.path : 0)
          .to_raw_key();
        const vKeyWitness = make_vkey_witness(txHash, prvKey);
        vkeyWitnesses.add(vKeyWitness);
      });
      if (
        !keyHashes.includes(stakeKeyHash) &&
        ((txBody.certs() && txBody.certs().len() > 0) ||
          (txBody.withdrawals() && txBody.withdrawals().len() > 0))
      ) {
        const prvKey = Bip32PrivateKey.from_bytes(decodedHash)
          .derive(WalletTypePurpose.CIP1852)
          .derive(CoinTypes.CARDANO)
          .derive(HARDENED + accountIndex)
          .derive(2)
          .derive(0)
          .to_raw_key();
        const vKeyWitness = make_vkey_witness(txHash, prvKey);
        vkeyWitnesses.add(vKeyWitness);
      }
      const witnesses = TransactionWitnessSet.new();
      witnesses.set_vkeys(vkeyWitnesses);
      if (!witnesses && partialSign === false) {
        throw TxSignError.ProofGeneration;
      }
      return { witnesses: Buffer.from(witnesses.to_bytes()).toString('hex'), };
    }
  }

  // async signTxHW(tx, keyHashes, account, hw, partialSign = false)  {
  //   const rawTx: Transaction = Transaction.from_bytes(Buffer.from(tx, 'hex'));
  //   const address = Address.from_bech32(account.paymentAddr);
  //   const network = address.network_id();
  //   const keys = {
  //     payment: { hash: null, path: null },
  //     stake: { hash: null, path: null },
  //   };
  //   if (hw.device === WalletType.Ledger.toLowerCase()) {
  //     const appAda = hw.appAda;
  //     keyHashes.forEach((keyHash) => {
  //       if (keyHash === account.paymentKeyHash)
  //         keys.payment = {
  //           hash: keyHash,
  //           path: [HARDENED + 1852, HARDENED + 1815, HARDENED + hw.account, 0, 0],
  //         };
  //       else if (keyHash === account.stakeKeyHash)
  //         keys.stake = {
  //           hash: keyHash,
  //           path: [HARDENED + 1852, HARDENED + 1815, HARDENED + hw.account, 2, 0],
  //         };
  //       else if (!partialSign) throw TxSignError.ProofGeneration;
  //       else return;
  //     });
  //     const ledgerTx = await ledger.txToLedger(rawTx, network, keys, Buffer.from(address.to_bytes()).toString('hex'), hw.account);
  //     const result = await appAda.signTransaction(ledgerTx);
  //     // getting public keys
  //     const witnessSet = TransactionWitnessSet.new();
  //     const vkeys = Vkeywitnesses.new();
  //     result.witnesses.forEach((witness) => {
  //       if (
  //         witness.path[3] == 0 // payment key
  //       ) {
  //         const vkey = Vkey.new(Bip32PublicKey.from_bytes(Buffer.from(account.publicKey, 'hex'))
  //             .derive(0)
  //             .derive(0)
  //             .to_raw_key());
  //         const signature = Ed25519Signature.from_hex(
  //           witness.witnessSignatureHex
  //         );
  //         vkeys.add(Vkeywitness.new(vkey, signature));
  //       } else if (
  //         witness.path[3] == 2 // stake key
  //       ) {
  //         const vkey = Vkey.new(Bip32PublicKey.from_bytes(Buffer.from(account.publicKey, 'hex'))
  //             .derive(2)
  //             .derive(0)
  //             .to_raw_key()
  //         );
  //         const signature = Ed25519Signature.from_hex(
  //           witness.witnessSignatureHex
  //         );
  //         vkeys.add(Vkeywitness.new(vkey, signature));
  //       }
  //     });
  //     witnessSet.set_vkeys(vkeys);
  //     return witnessSet;
  //   } else {
  //     keyHashes.forEach((keyHash) => {
  //       if (keyHash === account.paymentKeyHash)
  //         keys.payment = {
  //           hash: keyHash,
  //           path: `m/1852'/1815'/${hw.account}'/0/0`,
  //         };
  //       else if (keyHash === account.stakeKeyHash)
  //         keys.stake = {
  //           hash: keyHash,
  //           path: `m/1852'/1815'/${hw.account}'/2/0`,
  //         };
  //       else if (!partialSign) throw TxSignError.ProofGeneration;
  //       else return;
  //     });
  //     const trezorTx = await txToTrezor(rawTx, network, keys, Buffer.from(address.to_bytes()).toString('hex'), hw.account);
  //     const result = await TrezorConnect.cardanoSignTransaction(trezorTx);
  //     if (!result.success) throw new Error('Trezor could not sign tx');
  //     // getting public keys
  //     const witnessSet = TransactionWitnessSet.new();
  //     const vkeys = Vkeywitnesses.new();
  //     result.payload.witnesses.forEach((witness) => {
  //       const vkey = Vkey.new(PublicKey.from_bytes(Buffer.from(witness.pubKey, 'hex')));
  //       const signature = Ed25519Signature.from_hex(
  //         witness.signature
  //       );
  //       vkeys.add(Vkeywitness.new(vkey, signature));
  //     });
  //     witnessSet.set_vkeys(vkeys);
  //     return witnessSet;
  //   }
  // };

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
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setLastSyncInfo(tip): Promise<void> {
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

        if (!accountTable) throw new Error('No Account table.');

        if (resAccount) {
          return accountTable.update(resAccount.id, acc);
        } else {
          return accountTable.put(acc);
        }
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
    return {
      id: accountInfoId,
      ...acc,
    };
  }

  async sync(tip): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      console.log('sync');
      const lastSyncInfo = await this.getLastSyncInfo();
      if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
        const prevAccountInfo = await this.getAccountInfo()
        console.log(prevAccountInfo)
        const promises = [];
        promises.push(this.syncStakingPools());
        promises.push(this.syncAccountInfo().then(accountInfo => {
          if (accountInfo) {
            if (!prevAccountInfo || Number(prevAccountInfo.rewards_sum) != Number(accountInfo.rewards_sum)) {
              promises.push(this.syncAccountRewards());
            }
            if (!prevAccountInfo || Number(prevAccountInfo.controlled_amount) != Number(accountInfo.controlled_amount) /* TODO Add Pool ID ?*/) {
              promises.push(this.syncAccountTransactions(lastSyncInfo ? lastSyncInfo.height : 0).then(txs => {
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
                  promises.push(this.syncAssets(Array.from(units)));
                }
              }));
            }
          }
          return [];
        }));
        await Promise.all(promises);
        await this.setLastSyncInfo(tip);
      }

      this.locked = false;
    }
  }

  async syncAssets(units?: string[]): Promise<void> {
    const blockchainDB: Dexie = await this.getBlockchainDb();
    const assetsSyncTable = blockchainDB.table('assets_sync');
    const lastAssetsSyncArray = await assetsSyncTable.toArray();
    if (lastAssetsSyncArray.length > 0) {
      const lastAssetsSync = lastAssetsSyncArray[0];
      const hoursSinceEpoch: number = Math.floor(lastAssetsSync.time / (1000 * 60 * 60));
      if (hoursSinceEpoch % 4 === 0) {
        await this.setAssets(units, blockchainDB, assetsSyncTable);
      }
    } else {
      await this.setAssets(units, blockchainDB, assetsSyncTable);
    }
  }

  async setAssets(units: string[], blockchainDB: Dexie, assetsSyncTable) {
    const promises = [];
    const smallerArrays = chunkArray({ input: units, bytesSize: 5 * 1024 });
    smallerArrays.forEach(smallerArray => {
      promises.push(this.getAssetsInfo(smallerArray, blockchainDB));
    });
    const assets = (await Promise.all(promises)).flat();
    console.log(assets)
    assetsSyncTable.put({ time: new Date().getTime() });
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

  private async resolveAssetInfo(policyId: string, assetName: string) {
    try {
      const blockchainDB: Dexie = await this.getBlockchainDb();
      const assetsTable = blockchainDB.table('assets');
      const res = await this.api.getAssetsInfo([policyId + assetName]);
      if (res) {
        assetsTable.put(res);
        return res;
      }
    } catch (e) {
      console.log(e);
    }
  }

  async syncStakingPools(): Promise<void> {
    if (this.chain == Blockchain.CARDANO || this.chain == Blockchain.APEX_PRIME) {
      const blockchainDB: Dexie = await this.getBlockchainDb();
      const poolSyncTable = blockchainDB.table('pools_sync');
      const lastPoolSyncArray = await poolSyncTable.toArray();
      if (lastPoolSyncArray.length == 0) {
        await this.setStakingPools(blockchainDB, poolSyncTable);
      } else if (lastPoolSyncArray.length > 0) {
        const lastPoolSync = lastPoolSyncArray[0];
        if (lastPoolSync?.time) {
          const hoursSinceEpoch: number = Math.floor(lastPoolSync.time / (1000 * 60 * 60));
          if (hoursSinceEpoch % 4 === 0) {
            await this.setStakingPools(blockchainDB, poolSyncTable);
          }
        }
      }
    }
  }

  async setStakingPools(blockchainDB: Dexie, poolSyncTable) {
    const pools = await this.getStakingPools();
    blockchainDB.table('pools').bulkPut(pools);
    poolSyncTable.put({ time: new Date().getTime() });
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

  async fetchTip(): Promise<any> {
    return await this.api.getTip();
  }

  async syncAccountInfo(): Promise<any> {
    try {
      const res = await this.api.getAccountInfo(this.stakeAddress().to_address().to_bech32());
      if (res) {
        return await this.setAccountInfo(res);
      }
    } catch (e) {
      // console.log(e);
    }
  }

  async syncAccountRewards(): Promise<void> {
    try {
      const res = await this.api.getAccountRewards(this.stakeAddress().to_address().to_bech32());
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
      const res = await this.api.getAccountTransactions(this.stakeAddress().to_address().to_bech32(), height);
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

  async syncAddressesTransactions(fromBlockHeight, addresses): Promise<any[] | void> {
    try {
      const promises = [];
      addresses.forEach(address => {
        promises.push(this.api.getAddressTransactions(address.address, fromBlockHeight));
      });
      const res = await Promise.all(promises);
      const transactions = [];
      res.forEach(value => {
        value.forEach(tx => {
          transactions.push(tx);
        });
      });
      return transactions;
    } catch (e) {
      console.log(e);
    }
  }

  async getDb(): Promise<Dexie> {
    return this.db.open();
  }

  async syncAddresses(): Promise<any> {
    try {
      const res = await this.api.getAccountAddresses(this.stakeAddress().to_address().to_bech32());
      if (res) {
        return await this.setAccountAddresses(res);
      }
    } catch (e) {
      console.log(e);
    }
  }

  async setAccountAddresses(res): Promise<any> {
    return this.db
      .open()
      .then(db => {
        const addressesTable = db.table('addresses');

        if (!addressesTable) throw new Error('No Addresses table.');

        res.forEach(address => {
          addressesTable.put({ address: address.address });
        });
        return res;
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  public async getBlockchainDb(): Promise<Dexie> {
    return db.checkAndCreateBlockchainDatabase(this.chain + '_' + this.network);
  }

  async scanUrl(url: string): Promise<any> {
    return await this.api.scanUrl(url);
  }

  async scanTx(txScanRequest: TxScanRequest): Promise<TxScanResponse> {
    return await this.api.scanTx(txScanRequest)
  }

  async addConnectedDapp(domain: string) {
    await this.db
      .open()
      .then(db => {
        const dappsTable = db.table('connected_dapps');
        if (!dappsTable) throw new Error('No Connected Dapps Table.');
        return dappsTable.put({ domain: domain, time: new Date().getTime() });
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }
}
