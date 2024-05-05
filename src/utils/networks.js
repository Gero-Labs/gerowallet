import {Blockchain, Network} from "@/models/types";

export default {
    networks: [
        {
            icon: require('@/assets/svg/cardano.svg'),
            title: 'Cardano Mainnet',
            blockchain: Blockchain.CARDANO,
            network: Network.MAINNET,
            supportedHardware: true
        },
        {
            icon: require('@/assets/img/apex.jpg'),
            title: 'Apex Prime Testnet',
            blockchain: Blockchain.APEX_PRIME,
            network: Network.TESTNET,
            supportedHardware: false
        }
    ],
    resolveNetwork(chain, network) {
        return this.networks.find(element => element.blockchain === chain && element.network === network)
    }
}
