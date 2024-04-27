import Dexie from "dexie";
import {Wallet} from "@/models/wallet";
import {WalletType} from "@/models/types";

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
        const wallet = new Wallet(null, name, icon, WalletType.Normal, theme, order, mnemonic, password, chain, network)
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
    }
}