import Dexie from 'dexie';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import * as CryptoTS from 'crypto-ts';
import cryptoRandomString from 'crypto-random-string';
import {
  Address,
  BaseAddress,
  Bip32PrivateKey,
  Bip32PublicKey,
  Credential,
  decrypt_with_password,
  encrypt_with_password,
  EnterpriseAddress,
  FixedTransaction,
  make_vkey_witness,
  PointerAddress,
  PrivateKey,
  PublicKey,
  RewardAddress,
  Transaction,
  TransactionBody,
  TransactionHash,
  TransactionWitnessSet,
  Vkeywitnesses,
} from '@emurgo/cardano-serialization-lib-browser';
import { Api } from '@/api/api';
import networks from '@/shared/utils/networks';
import {
  Blockchain,
  ChainDerivations,
  CoinTypes,
  ERROR, purpose,
  STAKING_KEY_INDEX,
  WalletType,
  WalletTypePurpose,
} from '@/models/types';
import db from '@/db';
import { chunkArray } from 'array-chunk-by-size';
import { extractKeyHash } from '@/chrome/extension';
import { APIError, DataSignError, TxSendError, TxSignError } from '@/chrome/config';
import { HARDENED, SignedMessageData } from '@cardano-foundation/ledgerjs-hw-app-cardano/dist/types/public';
import ledger from '@/shared/utils/ledger';
import trezor from '@/shared/utils/trezor';
import socket from '@/plugins/socket';
import loading from '@/plugins/loading';
import { appWallet } from '@/store';
import {
  createCOSEKeyHex,
  createSignDataBuilder,
  safeFreeCSLObject, toHexArray, toHexString,
  toStakeKeyHash,
} from '@/shared/utils/converter';
const blake2b = require('blake2b');

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
    wal.api = new Api(wallet, provider);
    console.log('class');
    wal.db = new Dexie('wallet-' + wallet.id);
    wal.db.open().catch(async err => {
      if (err.name === 'NoSuchDatabaseError') {
        await db.createNewWalletDb(wallet.id);
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
    return this.deriveAddressFromPath(0)
  }

  stakeAddress(): RewardAddress {
    return RewardAddress.new(this.networkId(), Credential.from_keyhash(this.stakeKey().hash()));
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
        address, payload, networks.resolveNetwork(this.chain, this.network), accountIndex, isUsb
      );

      const builder = createSignDataBuilder(toHexArray(response.addressFieldHex), payload, payload.length > 99);
      signatureHex = buildAndSignData(builder, toHexArray(response.signatureHex), undefined);
      keyHex = createCOSEKeyHex(toHexArray(response.signingPublicKeyHex));

    } else {
      const keyHash: string = chrome.storage
        ? await extractKeyHash(address)
        : BaseAddress.from_address(
          Address.from_bech32(Buffer.from(address, 'hex').toString())
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

  async signTx(txCbor: string, partialSign: boolean = false, password: string, accountIndex: number, utxos, addresses: string[], isUsb?: boolean): Promise<{
    witnesses: string
  }> {
    const rawTx: FixedTransaction = FixedTransaction.from_hex(txCbor);
    const tx: Transaction = Transaction.from_hex(txCbor)
    const vkeyWitnesses: Vkeywitnesses = Vkeywitnesses.new();
    const txBody: TransactionBody = rawTx.body();
    const deduped: any[] = [];
    const keyHashes: any[] = [];

    const txHashHex = blake2b(new Uint8Array(32).length).update(rawTx.raw_body()).digest('hex');

    const changeAddress: string = this.baseAddress().to_address().to_bech32()
    let paymentKeyHash: Uint8Array = this.paymentKeyHash(changeAddress);
    let paymentkeyHex = Buffer.from(paymentKeyHash).toString('hex');

    let stakeKeyHash = toStakeKeyHash(changeAddress);
    let stakeKeyHex = stakeKeyHash.to_hex();

    // Process inputs and add corresponding witnesses
    for (let i = 0; i < txBody.inputs().len(); i++) {
      const input = txBody.inputs().get(i);
      const inputTxHash = Buffer.from(input.transaction_id().to_bytes()).toString('hex');
      const inputTxIndex = input.index();
      const utxo = utxos.find((utxo) => inputTxHash === utxo.tx_hash && utxo.tx_index === inputTxIndex);

      if (utxo) {
        paymentKeyHash = this.paymentKeyHash(utxo.payment_addr.bech32);
        paymentkeyHex = Buffer.from(paymentKeyHash).toString('hex');

        stakeKeyHash = toStakeKeyHash(utxo.payment_addr.bech32);
        stakeKeyHex = stakeKeyHash.to_hex()

        if (!keyHashes.includes(paymentkeyHex)) {
          keyHashes.push(paymentkeyHex);
          deduped.push(utxo);
        }
      }
    }

    const paymentKeyHashes = Object.keys(addresses).map(address => this.paymentKeyHash(address))
      .filter((hash) => !!hash)
      .map((keyHash) => Buffer.from(keyHash).toString('hex'));

    // Process required signers from the transaction body
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
          } else {
            console.warn('Required signer key hash missing:', requiredKeyHash);
          }
        }
      }
    }

    // Ledger Signing Logic
    if (this.type === WalletType.Ledger) {
      console.log(tx.to_json())
      const wit: TransactionWitnessSet = await ledger.txToLedger(txBody, this, 0, null, addresses, utxos, isUsb);
      return { witnesses: Buffer.from(wit.to_bytes()).toString('hex') };
    }

    // Trezor Signing Logic
    else if (this.type === WalletType.Trezor) {
      console.log('Signing with Trezor...');
      const wit: TransactionWitnessSet = <TransactionWitnessSet>(
        await trezor.txToTrezor(txBody, this.baseAddress().to_address().to_bech32(), accountIndex, true, utxos)
      );
      if (!wit) {
        throw new Error('Trezor did not return a valid witness set.');
      }

      const witnessHex = Buffer.from(wit.to_bytes()).toString('hex');
      console.log('Trezor Witness Set:', witnessHex);

      return { witnesses: witnessHex };
    }

    // Software Wallet Signing
    else {
      console.log('Signing with Software Wallet...');
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
          .derive(HARDENED + accountIndex)
          .derive(utxo.addressing ? utxo.addressing.type : 0)
          .derive(utxo.addressing ? utxo.addressing.path : 0)
          .to_raw_key();
        const vKeyWitness = make_vkey_witness(txHash, prvKey);
        vkeyWitnesses.add(vKeyWitness);
      });

      // Stake key signing for certificates or withdrawals
      if (!keyHashes.includes(stakeKeyHex) && ((txBody.certs() && txBody.certs().len() > 0) || (txBody.withdrawals() && txBody.withdrawals().len() > 0))) {
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
      return { witnesses: Buffer.from(witnesses.to_bytes()).toString('hex') };
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

  async submitTx(body: string) {
    const response = await this.api.submitTx(body);
    if (response.error) {
      if (response.status_code === 400) {
        throw new Error(TxSendError.Failure.info.concat('.', ' ', response.message));
      } else if (response.status_code === 500) {
        throw new Error(APIError.InternalError.info);
      } else if (response.status_code === 429) {
        throw new Error(TxSendError.Refused.info);
      } else if (response.status_code === 425) {
        throw new Error(ERROR.fullMempool);
      } else {
        throw new Error(APIError.InvalidRequest.info);
      }
    }
    return response;
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
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setLastSyncInfo(tip): Promise<void> {
    console.log(tip);
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
    if (this.syncLock) {
      // If sync is already running, wait for it to complete
      await this.syncLock;
      return;
    }
    this.syncLock = (async () => {
      try {
        console.log('sync');
        loading.setSyncing(true);
        const lastSyncInfo = await this.getLastSyncInfo();
        if (!lastSyncInfo) {
          // loading.setText('Restoring Wallet Data. Please Wait ...')
          loading.setRestoring(true);
          await this.restore(tip);
          loading.setRestoring(false);
        } else if (!lastSyncInfo || tip.height > lastSyncInfo['height']) {
          const promises = [];
          promises.push(this.syncStakingPools());
          const prevAccountInfo = await this.getAccountInfo();
          socket.sendSync(!lastSyncInfo ? 0 : lastSyncInfo['height'], tip, this.stakeAddress().to_address().to_bech32(), prevAccountInfo?.rewards_sum, prevAccountInfo?.controlled_amount, prevAccountInfo?.withdrawable_amount);
        }
      } finally {
        // Release the lock after execution
        this.syncLock = null;
        loading.setSyncing(false); // Ensure to reset syncing state after execution
      }
    })();
    // Wait for the locked sync operation to complete
    await this.syncLock;
  }

  async restore(tip): Promise<void> {
    const prevAccountInfo = await this.getAccountInfo();

    // Create an array to hold the promises that need to be awaited
    const promises = [];

    // Sync staking pools
    promises.push(this.syncStakingPools());

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
    try {
      const tip = await appWallet.fetchTip();
      await appWallet.sync(tip);
    } catch (err) {
      console.log(err);
    }
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

  async syncAssets(units: string[], force?: boolean): Promise<void> {
    console.log('syncAssets');
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
      if (res) {
        // assetsTable.bulkPut(res);
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
      const currentTime = new Date();

      if (lastPoolSyncArray.length == 0) {
        await this.setStakingPools(blockchainDB, poolSyncTable);
      } else if (lastPoolSyncArray.length > 0) {
        const lastPoolSync = lastPoolSyncArray[0];
        if (lastPoolSync?.time) {
          const lastSyncTime = new Date(lastPoolSync.time);
          const hoursSinceLastSync = (currentTime.getTime() - lastSyncTime.getTime()) / (1000 * 60 * 60);

          if (hoursSinceLastSync >= 4) {
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

  async syncAddresses(knownAddresses: string[]): Promise<void> {
    await this.db
      .open()
      .then(async db => {
        const addressesTable = db.table('addresses');
        if (!addressesTable) throw new Error('No Addresses table.');
        const storedAddresses = await addressesTable.toArray()
        const storedAddressSet = new Set(storedAddresses.map(addr => addr.address));
        const missingAddresses = knownAddresses.filter(address => !storedAddressSet.has(address));
        const resolvedAddress = this.resolvePathsForMissingAddresses(missingAddresses, 1000);
        if (resolvedAddress?.length > 0) {
          addressesTable.bulkPut(resolvedAddress)
        }
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  resolvePathsForMissingAddresses(missingAddresses, maxAddresses) {
    const resolvedAddresses = [];
    for (let addressIndex = 0; addressIndex < maxAddresses; addressIndex++) {
      const derivedAddress = this.deriveAddressFromPath(addressIndex).to_address().to_bech32();
      if (missingAddresses.includes(derivedAddress)) {
        resolvedAddresses.push({
          address: derivedAddress,
          path: `m/${purpose.hdwallet}'/1815'/0'/0/${addressIndex}`,
          cred: Buffer.from(this.paymentKeyHash(derivedAddress)).toString('hex')
        });
      }
      if (missingAddresses.length === resolvedAddresses.length) {
        break;
      }
    }
    return resolvedAddresses;
  }

  deriveAddressFromPath(addressIndex) {
    return BaseAddress.new(
      this.networkId(),
      Credential.from_keyhash(this.pubKey(addressIndex).hash()),
      Credential.from_keyhash(this.stakeKey().hash())
    )
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

      // If the domain already exists, we ignore the insertion
      if (existingDapp) {
        console.log(`Domain ${domain} already exists, ignoring.`);
        return; // Exit the function if the domain already exists
      }

      // If domain doesn't exist, insert it
      await dappsTable.put({ domain: domain, time: new Date().getTime() });
      console.log(`Domain ${domain} added successfully.`);

    } catch (err) {
      console.error(`Failed to add connected dapp: ${err.stack || err}`);
    }
  }
}
