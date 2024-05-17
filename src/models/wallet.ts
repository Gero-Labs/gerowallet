import Dexie from 'dexie';
import * as bip39 from 'bip39';
import { Buffer } from 'buffer';
import * as CryptoTS from 'crypto-ts';
import cryptoRandomString from 'crypto-random-string';
import * as serialization from '@emurgo/cardano-serialization-lib-browser';
import { BaseAddress, Bip32PrivateKey, Bip32PublicKey, RewardAddress, PublicKey, StakeCredential } from '@emurgo/cardano-serialization-lib-browser';
import {Api} from '@/api/api';
import networks from '@/shared/utils/networks';
import {ChainDerivations, STAKING_KEY_INDEX} from '@/models/types';

export class Wallet {
  db: Dexie;
  api: Api;

  id: any
  name: any
  icon: any
  type: any
  theme: any
  order: any
  chain: any
  network: any
  publicKey: string

  encryptedPrivateKey: any
  passwordLastUpdate: Date

  constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network) {
    this.id = id;
    this.name = name;
    this.icon = icon;
    this.type = type;
    this.theme = theme;
    this.order = order;
    this.encryptedPrivateKey = encryptedPrivateKey;
    this.publicKey = publicKey;
    this.passwordLastUpdate = new Date();
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
    return serialization.Bip32PrivateKey.from_bip39_entropy(Buffer.from(bip39entropy, 'hex'), Buffer.from(''));
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
    return serialization.encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
  }

  decryptWithPassword(password, encryptedKeyHex): Buffer {
    const passwordHex = Buffer.from(password).toString('hex');
    let decryptedHex;
    try {
      decryptedHex = serialization.decrypt_with_password(passwordHex, encryptedKeyHex);
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
      StakeCredential.from_keyhash(this.stakeKey().hash())
    );
  }

  stakeAddress(): RewardAddress {
    return RewardAddress.new(this.networkId(), StakeCredential.from_keyhash(this.stakeKey().hash()));
  }

  async getLastSyncInfo(): Promise<any> {
    return await this.db
      .open()
      .then(async db => {
        const syncTable = db.table('sync');
        if (!syncTable) throw new Error('No Sync table.');
        return syncTable.where({ walletId: this.id }).first();
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async getAccountInfo(): Promise<any> {
    return await this.db
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

  async setLastSyncInfo(tip, lastSyncInfo): Promise<void> {
    await this.db
      .open()
      .then(db => {
        const syncTable = db.table('sync');
        if (!syncTable) throw new Error('No Sync table.');

        if (lastSyncInfo) {
          return syncTable.update(lastSyncInfo.id, {
            walletId: this.id,
            blockHash: tip.hash,
            height: tip.height,
            absSlot: tip.slot,
            time: tip.time,
            epoch: tip.epoch,
            epoch_slot: tip.epoch_slot
          });
        } else {
          return syncTable.put({
            walletId: this.id,
            blockHash: tip.hash,
            height: tip.height,
            absSlot: tip.slot,
            time: tip.time,
            epoch: tip.epoch,
            epoch_slot: tip.epoch_slot
          });
        }
      })
      .catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async setAccountInfo(accountInfo): Promise<any> {
    const resAccount = await this.getAccountInfo();
    const acc = {
      walletId: this.id,
      ...accountInfo
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
      ...acc
    };
  }

  async sync(tip): Promise<void> {
    console.log('sync');
    const lastSyncInfo = await this.getLastSyncInfo();
    if (!lastSyncInfo || tip.height > lastSyncInfo.height) {
      const accountInfo = await this.syncAccountInfo();
      if (accountInfo) {
        await this.syncAccountRewards(); //TODO should be synced at a particular time every epoch
      }
      const newTxs = await this.syncAccountTransactions(lastSyncInfo.height);
      console.log(newTxs);
      await this.syncTxIos(newTxs);
      //TODO account transactions
      // const addresses = await this.syncAddresses();
      // await this.syncAddressesTransactions(0, addresses); //TODO lastSyncInfo.height
      // await this.syncUtxos();

      await this.setLastSyncInfo(tip, lastSyncInfo);
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
      console.log(e);
    }
  }

  async syncAccountRewards(): Promise<void> {
    try {
      const res = await this.api.getAccountRewards(this.stakeAddress().to_address().to_bech32());
      if (res) {
        await this.setAccountRewards(res);
      }
    } catch (e) {
      console.log(e);
    }
  }

  async setAccountRewards(res): Promise<any[] | void> {
    return await this.db
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
      const res = await this.api.getAccountTransactions(this.stakeAddress().to_address().to_bech32(), height)
      if (res && Array.isArray(res)) {
        const promises = []
        res.forEach(value => {
          promises.push(this.api.getTransactionInfo(value.tx_hash))
        })
        const txs = await Promise.all(promises)
        await this.setAccountTransactions(txs)
        return txs
      }
    } catch (e) {
      console.log(e)
    }
  }

  async setAccountTransactions(txs): Promise<any> {
    return this.db.open()
      .then(db => {
        const txsTable = db.table('transactions')
        if (txsTable) {
          txs = txs.map(tx => {
            return {id: tx.hash, transaction: tx}
          })
          txsTable.bulkPut(txs)
        }
      }).catch(err => {
        console.error(`Failed to open database: ${err.stack || err}`);
      });
  }

  async syncTxIos(txs): Promise<any> {
    try {
      if (txs && Array.isArray(txs)) {
        const promises = []
        txs.forEach(value => {
          console.log(value)
          promises.push(this.api.getTransactionUtxos(value.hash))
        })
        const txIos = await Promise.all(promises)
        await this.setTxIos(txIos)
      }
    } catch (e) {
      console.log(e)
    }
  }

  async setTxIos(txIos) {
    return this.db.open()
      .then(db => {
        const txIoTable = db.table('tx_io')
        if (txIoTable && txIos) {
          txIoTable.bulkPut(txIos)
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

  async setAddressTransactions() {}

  async getDb(): Promise<Dexie> {
    return await this.db.open();
  }

  async syncAddresses(): Promise<any> {
    try {
      const res = await this.api.getAccountAddresses(this.stakeAddress().to_address().to_bech32());
      if (res) {
        console.log(res);
        return await this.setAccountAddresses(res);
      }
    } catch (e) {
      console.log(e);
    }
  }

  async setAccountAddresses(res): Promise<any> {
    return await this.db
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
}
