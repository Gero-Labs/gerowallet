import Dexie from "dexie";
import {Wallet} from "@/models/wallet";

const db = new Dexie("GeroWalletDatabase");

db.version(10).stores({
    wallets: '++walletId, name, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network'
});

export default {
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
    async createNewWallet(name, theme, mnemonic, password, chain, network) {
        let order = await this.getLatestWalletByOrder()
        if (order == null) {
            order = 1
        } else {
            order++
        }
        const wallet = new Wallet(null, name, theme, order, mnemonic, password, chain, network)
        // JSON.stringify(wallet, (key, value) => (value === null) ? undefined : value)
        await db.wallets.add({
            name: wallet.name,
            theme: wallet.theme,
            order: wallet.order,
            encryptedPrivateKey: wallet.encryptedPrivateKey,
            publicKey: wallet.publicKey,
            passwordLastUpdate: wallet.passwordLastUpdate,
            chain: wallet.chain,
            network: wallet.network
        })
    }
}