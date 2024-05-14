import * as bip39 from "bip39";
import cryptoRandomString from 'crypto-random-string';
import * as serialization from '@emurgo/cardano-serialization-lib-browser';
import {BaseAddress, Bip32PublicKey, RewardAddress, StakeCredential} from '@emurgo/cardano-serialization-lib-browser';
import {ChainDerivations, STAKING_KEY_INDEX} from '@/models/types';
import {Buffer} from "buffer";
import * as CryptoTS from "crypto-ts";
import networks from "@/shared/utils/networks";
import Dexie from "dexie";
import {Api} from "@/api/api";
import {useStore} from "@/store";

export class Wallet {
    db;
    api;

    constructor(id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network) {
        this.id = id
        this.name = name
        this.icon = icon
        this.type = type
        this.theme = theme
        this.order = order
        this.encryptedPrivateKey = encryptedPrivateKey
        this.publicKey = publicKey
        this.passwordLastUpdate = new Date()
        this.chain = chain
        this.network = network
    }

    static class(wallet, provider) {
        const wal = new Wallet(wallet.id, wallet.name, wallet.icon, wallet.type, wallet.theme, wallet.order,
            wallet.encryptedPrivateKey, wallet.publicKey, wallet.passwordLastUpdate, wallet.chain, wallet.network)
        wal.api = new Api(provider)
        wal.db = new Dexie('wallet-' + wallet.id)
        return wal;
    }

    static resolvePrivateKey(mnemonic) {
        const bip39entropy = bip39.mnemonicToEntropy(mnemonic)
        return serialization.Bip32PrivateKey.from_bip39_entropy(Buffer.from(bip39entropy, 'hex'), Buffer.from(''));
    }

    static encryptPrivateKey(rootKey, password) {
        const privateKey = this.encryptWithPassword(password, rootKey.as_bytes());
        return CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString()
    }

    static encryptWithPassword(password, rootKeyBytes) {
        const passwordHex = Buffer.from(password).toString('hex');
        const rootKeyHex = Buffer.from(rootKeyBytes, 'hex').toString('hex');
        const salt = cryptoRandomString({length: 2 * 32});
        const nonce = cryptoRandomString({length: 2 * 12});
        return serialization.encrypt_with_password(passwordHex, salt, nonce, rootKeyHex);
    }

    decryptWithPassword(password, encryptedKeyHex) {
        const passwordHex = Buffer.from(password).toString('hex');
        let decryptedHex;
        try {
            decryptedHex = serialization.decrypt_with_password(passwordHex, encryptedKeyHex);
        } catch (err) {
            throw new Error('Wrong Passphrase');
        }
        return Buffer.from(decryptedHex, 'hex');
    }

    networkId() {
        return networks.resolveNetworkId(this.chain, this.network)
    }

    pubKey(index) {
        return Bip32PublicKey.from_bech32(this.publicKey)
            .derive(ChainDerivations.EXTERNAL)
            .derive(index)
            .to_raw_key()
    }

    stakeKey() {
        return Bip32PublicKey.from_bech32(this.publicKey)
            .derive(ChainDerivations.CHIMERIC_ACCOUNT)
            .derive(STAKING_KEY_INDEX)
            .to_raw_key()
    }

    baseAddress() {
        return BaseAddress.new(
            this.networkId(),
            StakeCredential.from_keyhash(this.pubKey(0).hash()),
            StakeCredential.from_keyhash(this.stakeKey().hash())
        );
    }

    stakeAddress() {
        return RewardAddress.new(
            this.networkId(),
            StakeCredential.from_keyhash(this.stakeKey().hash())
        )
    }

    async getLastSyncInfo() {
        return await this.db.open()
            .then(async db => {
                const syncTable = db.table('sync')
                if (syncTable) {
                    return syncTable.where({walletId: this.id}).first()
                }
            }).catch(err => {
                console.error(`Failed to open database: ${err.stack || err}`);
            })
    }

    async getAccountInfo() {
        return await this.db.open()
            .then(async db => {
                const accountTable = db.table('account')
                if (accountTable) {
                    return accountTable.where({walletId: this.id}).first()
                }
            }).catch(err => {
                console.error(`Failed to open database: ${err.stack || err}`);
            })
    }

    async setLastSyncInfo(tip, lastSyncInfo) {
        await this.db.open()
            .then(db => {
                const syncTable = db.table('sync')
                if (syncTable) {
                    if (lastSyncInfo) {
                        return syncTable.update(lastSyncInfo.id, {
                            walletId: this.id,
                            blockHash: tip.hash,
                            height: tip.height,
                            absSlot: tip.slot,
                            time: tip.time,
                            epoch: tip.epoch,
                            epoch_slot: tip.epoch_slot
                        })
                    } else {
                        return syncTable.put({
                            walletId: this.id,
                            blockHash: tip.hash,
                            height: tip.height,
                            absSlot: tip.slot,
                            time: tip.time,
                            epoch: tip.epoch,
                            epoch_slot: tip.epoch_slot
                        })
                    }
                }
            }).catch(err => {
                console.error(`Failed to open database: ${err.stack || err}`);
            })
    }

    async setAccountInfo(accountInfo) {
        const resAccount = await this.getAccountInfo(this.id)
        const acc = {
            walletId: this.id,
            ...accountInfo
        }
        const accountInfoId = await this.db.open()
            .then(db => {
                const accountTable = db.table('account')
                if (accountTable) {
                    if (resAccount) {
                        return accountTable.update(resAccount.id, acc)
                    } else {
                        return accountTable.put(acc)
                    }
                }
            }).catch(err => {
                console.error(`Failed to open database: ${err.stack || err}`);
            })
        return {
            id: accountInfoId,
            ...acc
        }
    }

    async sync(tip) {
        console.log('sync')
        let lastSyncInfo = await this.getLastSyncInfo()
        if (!lastSyncInfo || tip.height > lastSyncInfo.height) {
            const accountInfo = await this.syncAccountInfo()
            if (accountInfo) {
                await this.syncAccountRewards() //TODO should be synced at a particular time every epoch
            }

            //TODO account transactions
            const addresses = await this.syncAddresses()
            await this.syncAddressesTransactions(0, addresses) //TODO lastSyncInfo.height
            await this.syncUtxos()

            await this.setLastSyncInfo(tip, lastSyncInfo)
        }
    }
    async fetchTip() {
        return await this.api.getTip()
    }

    async syncAccountInfo() {
        try {
            const res = await this.api.getAccountInfo(this.stakeAddress().to_address().to_bech32())
            if (res) {
                return await this.setAccountInfo(res)
            }
        } catch (e) {
            console.log(e)
        }
    }

    async syncAccountRewards() {
        try {
            const res = await this.api.getAccountRewards(this.stakeAddress().to_address().to_bech32())
            if (res) {
                console.log(res)
                await this.setAccountRewards(res)
            }
        } catch (e) {
            console.log(e)
        }
    }

    async syncAddressesTransactions(fromBlockHeight, addresses) {
        try {
            const promises = []
            addresses.forEach(address => {
                promises.push(this.api.getAddressTransactions(address, fromBlockHeight))
            })
            const res = await Promise.all(promises)
            console.log(res)
        } catch (e) {
            console.log(e)
        }
    }

    async setAccountRewards(res) {
        return await this.db.open()
            .then(db => {
                const rew = []
                const rewardsTable = db.table('rewards')
                if (rewardsTable) {
                    res.forEach(reward => {
                        rew.push(rewardsTable.put(reward))
                    })
                    return rew
                }
            }).catch(err => {
                console.error(`Failed to open database: ${err.stack || err}`);
            })
    }

    async getDb() {
        return await this.db.open()
    }

    async syncUtxos() {

    }

    async syncAddresses() {
        try {
            const res = await this.api.getAccountAddresses(this.stakeAddress().to_address().to_bech32())
            if (res) {
                console.log(res)
                return await this.setAccountAddresses(res)
            }
        } catch (e) {
            console.log(e)
        }
    }

    async setAccountAddresses(res) {
        return await this.db.open()
            .then(db => {
                const rew = []
                const addressesTable = db.table('addresses')
                if (addressesTable) {
                    res.forEach(address => {
                        rew.push(addressesTable.put(address.address))
                    })
                    return rew
                }
            }).catch(err => {
                console.error(`Failed to open database: ${err.stack || err}`);
            })
    }
}