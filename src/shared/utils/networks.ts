import { Blockchain, Network } from '@/models/types';

export default {
  networks: [
    {
      icon: require('@/assets/svg/cardano.svg'),
      title: 'Cardano Mainnet',
      blockchain: Blockchain.CARDANO,
      network: Network.MAINNET,
      supportedHardware: true,
      networkId: 1,
    },
    {
      icon: require('@/assets/svg/cardano.svg'),
      title: 'Cardano Preprod',
      blockchain: Blockchain.CARDANO,
      network: Network.PREPROD,
      supportedHardware: false,
      networkId: 0,
    },
    {
      icon: require('@/assets/svg/cardano.svg'),
      title: 'Cardano Preview',
      blockchain: Blockchain.CARDANO,
      network: Network.PREVIEW,
      supportedHardware: false,
      networkId: 0,
    },
    {
      icon: require('@/assets/img/apex.jpg'),
      title: 'Apex Prime Testnet',
      blockchain: Blockchain.APEX_PRIME,
      network: Network.TESTNET,
      supportedHardware: false,
      networkId: 0,
    },
  ],
  resolveNetwork(chain: string, network: string) {
    return this.networks.find(element => element.blockchain === chain && element.network === network);
  },
  resolveNetworkId(chain: string, network: string) {
    return this.resolveNetwork(chain, network).networkId;
  },
};
