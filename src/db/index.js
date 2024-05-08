import Dexie from "dexie";
import {
    BIP44_SCAN_SIZE,
    Blockchain,
    ChainDerivations, CoinTypes,
    CoreAddressTypes,
    getInitialSeeds,
    Network,
    Provider,
    STAKING_KEY_INDEX, WalletType, WalletTypePurpose,
} from "@/models/types";
import {RewardAddress, StakeCredential} from "@emurgo/cardano-serialization-lib-browser";
import {HARDENED} from "@cardano-foundation/ledgerjs-hw-app-cardano";
import {Wallet} from "@/models/wallet";
import {useStore} from "@/store";

const db = new Dexie("GeroWalletDatabase");

await db.version(10).stores({
    wallets: '++id, name, icon, type, theme, order, encryptedPrivateKey, publicKey, passwordLastUpdate, chain, network',
    config: '++id, key, value',
    provider: '++id, name, chain, network, baseUrl, apiKey',
});


db.open().catch(err => {
    console.error(`Failed to open database: ${err.stack || err}`);
});

await initializeConfigTable()

await initializeProviderTable()
async function initializeConfigTable() {
    await db.config.toArray()
        .then(async rows => {
            if (rows.length === 0) {
                const initialData = [
                    {key: 'provider', value: Provider.KOIOS}
                ];
                await db.config.bulkAdd(initialData)
                    .catch(error => {
                        console.error('Error adding initial data:', error);
                    });
            }
        })
}

async function initializeProviderTable() {
    await db.provider.toArray()
        .then(async rows => {
            if (rows.length === 0) {
                const initialData = [
                    {
                        name: Provider.KOIOS,
                        chain: Blockchain.CARDANO,
                        network: Network.MAINNET,
                        baseUrl: 'https://api.koios.rest/api/v1/',
                        apiKey: null
                    }
                ];
                await db.provider.bulkAdd(initialData)
                    .catch(error => {
                        console.error('Error adding initial data:', error);
                    });
            }
        })
}
export default {
    async getProvider(chain, network) {
      const provider = await this.getConfiguration('provider')
      return db.provider.where({name: provider.value, chain: chain, network: network}).first()
    },
    async getConfiguration(key) {
      return db.config.where({key: key}).first()
    },
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
        const rootKey = Wallet.resolvePrivateKey(mnemonic)
        const encryptedPrivateKey = Wallet.encryptPrivateKey(rootKey, password)
        const accountIndex = 0
        const publicKey = rootKey
            .derive(WalletTypePurpose.CIP1852)
            .derive(CoinTypes.CARDANO)
            .derive(HARDENED + accountIndex)
            .to_public().to_bech32()
        const wallet = new Wallet(null, name, icon, WalletType.Normal, theme, order, encryptedPrivateKey, publicKey, new Date(), chain, network)
        // JSON.stringify(wallet, (key, value) => (value === null) ? undefined : value)
        const walletId = await db.wallets.add({
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
        await useStore().loadWallets()
        return walletId;
    },
    async createNewHardwareWallet(name, icon, type, theme, chain, network, publicKey) {
        let order = await this.getLatestWalletByOrder()
        if (order == null) {
            order = 1
        } else {
            order++
        }
        const walletId = await db.wallets.add({
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
        await useStore().loadWallets()
        return walletId
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
    const stakingKeyAddresses = [];
    const accountAddr = RewardAddress.new(chainNetworkId, StakeCredential.from_keyhash(stakingKey.hash()));
    stakingKeyAddresses.push({
      type: CoreAddressTypes.CARDANO_REWARD,
      digest: this.digestForHash(
        Buffer.from(accountAddr.to_address().to_bytes()).toString("hex"),
        getInitialSeeds().AddressSeed
      ),
      hash: Buffer.from(accountAddr.to_address().to_bytes()).toString("hex"),
      walletId,
    });

    addressesIndex.map((i) => {
      const externalAddresses = this.scan.addShelleyUtxoAddress(stakingKey, externalAddrs[i], chainNetworkId, walletId);
      db.address.bulkAdd(externalAddresses);
    });
    addressesIndex.map((i) => {
      const internalAddresses = this.scan.addShelleyUtxoAddress(stakingKey, internalAddrs[i], chainNetworkId, walletId);
      db.address.bulkAdd(internalAddresses);
    });
    db.address.bulkAdd(stakingKeyAddresses).catch((e) => console.log(e));
  },
};
