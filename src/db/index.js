import Dexie from "dexie";
import {Wallet} from "@/models/wallet";
import {
    BIP44_SCAN_SIZE,
    ChainDerivations, CoinTypes,
    CoreAddressTypes,
    getInitialSeeds, HARDENED,
    STAKING_KEY_INDEX,
    WalletType, WalletTypePurpose
} from "@/models/types";
import {Bip32PublicKey, RewardAddress, StakeCredential} from "@emurgo/cardano-serialization-lib-browser";
import * as CryptoTS from "crypto-ts";

const db = new Dexie("GeroWalletDatabase");

db.version(10).stores({
    wallets: '++walletId, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network'
});

export default {
    async getWalletById(id) {
        return db.wallets.where("id").equalsIgnoreCase(id);
    },
    async getAllWallets() {
      return db.wallets.toArray()
    },
    async getLatestWalletByOrder() {
        let orderArray = await db.wallets.orderBy('order').reverse().limit(1).keys()
        if (Array.isArray(orderArray) && orderArray.length) {
            return orderArray[0]
        }
        return null
    },
    async createNewWallet(name, icon, theme, mnemonic, password, chain, network) {
        let order = await this.getLatestWalletByOrder()
        if (order == null) {
            order = 1
        } else {
            order++
        }
        const rootKey = this.resolveRootKey(mnemonic)
        const privateKey = this.encryptWithPassword(password, rootKey.as_bytes())
        const encryptedPrivateKey = CryptoTS.AES.encrypt(JSON.stringify(privateKey), password).toString()
        const publicKey = rootKey
            .derive(WalletTypePurpose.CIP1852)
            .derive(CoinTypes.CARDANO)
            .derive(HARDENED)
            .to_public().to_bech32()
        const wallet = new Wallet(null, name, icon, WalletType.Normal, theme, order, encryptedPrivateKey, publicKey, new Date(), chain, network)
        // JSON.stringify(wallet, (key, value) => (value === null) ? undefined : value)
        return await db.wallets.add({
            name: wallet.name,
            icon: wallet.icon,
            type: wallet.type,
            theme: wallet.theme,
            order: wallet.order,
            encryptedPrivateKey: wallet.encryptedPrivateKey,
            publicKey: wallet.publicKey,
            passwordLastUpdate: wallet.passwordLastUpdate,
            chain: wallet.chain,
            network: wallet.network
        })
    },
    async createNewHardwareWallet(name, icon, type, theme, chain, network, publicKey) {
        let order = await this.getLatestWalletByOrder()
        if (order == null) {
            order = 1
        } else {
            order++
        }
        return await db.wallets.add({
            name: name,
            icon: icon,
            type: type,
            theme: theme,
            order: order,
            publicKey: publicKey,
            passwordLastUpdate: new Date(),
            chain: chain,
            network: network
        })
    },
    async saveAccountDefaultDerivations(chainNetworkId, publicKey, walletId) {
        const addressesIndex = [...Array(BIP44_SCAN_SIZE).keys()];
        const stakingKey = publicKey
            .derive(ChainDerivations.CHIMERIC_ACCOUNT)
            .derive(STAKING_KEY_INDEX)
            .to_raw_key();

        const externalAddrs = addressesIndex.map((i) => {
            const key = publicKey.derive(ChainDerivations.EXTERNAL).derive(i).to_raw_key();
            return key.hash();
        });
        const internalAddrs = addressesIndex.map((i) => {
            const key = publicKey.derive(ChainDerivations.INTERNAL).derive(i).to_raw_key();
            return key.hash();
        });
        const stakingKeyAddresses = []
        const accountAddr = RewardAddress.new(chainNetworkId, StakeCredential.from_keyhash(stakingKey.hash()));
        stakingKeyAddresses.push({
            type: CoreAddressTypes.CARDANO_REWARD,
            digest: this.digestForHash(
                Buffer.from(accountAddr.to_address().to_bytes()).toString('hex'),
                getInitialSeeds().AddressSeed,
            ),
            hash: Buffer.from(accountAddr.to_address().to_bytes()).toString('hex'),
            walletId,
        });

        addressesIndex.map((i) => {
            const externalAddresses = this.scan.addShelleyUtxoAddress(
                stakingKey,
                externalAddrs[i],
                chainNetworkId,
                walletId,
            );
            db.address.bulkAdd(externalAddresses);
        });
        addressesIndex.map((i) => {
            const internalAddresses = this.scan.addShelleyUtxoAddress(
                stakingKey,
                internalAddrs[i],
                chainNetworkId,
                walletId,
            );
            db.address.bulkAdd(internalAddresses);
        });
        db.address.bulkAdd(stakingKeyAddresses).catch((e) => console.log(e));
    }
}