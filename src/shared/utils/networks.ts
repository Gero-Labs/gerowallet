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
      currencySymbol: '₳',
      currencyName: 'ADA',
      protocolParams: {
        min_fee_a: 44,
        min_fee_b: 155381,
        max_tx_size: 16384,
        min_utxo_value: "0",
        key_deposit: "2000000",
        pool_deposit: "500000000",
        max_val_size: 5000,
        price_mem: 0.0577,
        price_step: 0.0000721,
        coins_per_utxo_size: "4310"
      }
    },
    {
      icon: require('@/assets/svg/cardano.svg'),
      title: 'Cardano Preprod',
      blockchain: Blockchain.CARDANO,
      network: Network.PREPROD,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 't₳',
      currencyName: 'tADA',
      protocolParams: {
        min_fee_a: 44,
        min_fee_b: 155381,
        max_tx_size: 16384,
        min_utxo_value: "0",
        key_deposit: "2000000",
        pool_deposit: "500000000",
        max_val_size: 5000,
        price_mem: 0.0577,
        price_step: 0.0000721,
        coins_per_utxo_size: "4310"
      }
    },
    {
      icon: require('@/assets/svg/cardano.svg'),
      title: 'Cardano Preview',
      blockchain: Blockchain.CARDANO,
      network: Network.PREVIEW,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 't₳',
      currencyName: 'tADA',
    },
    {
      icon: require('@/assets/img/apex.jpg'),
      title: 'Apex Prime Testnet',
      blockchain: Blockchain.APEX_PRIME,
      network: Network.TESTNET,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 'tÂ',
      currencyName: 'tAP3X',
      protocolParams: {
        min_fee_a: 44,
        min_fee_b: 155381,
        max_tx_size: 16384,
        min_utxo_value: "0",
        key_deposit: "0",
        pool_deposit: "0",
        max_val_size: 5000,
        price_mem: 0.0577,
        price_step: 0.0000721,
        coins_per_utxo_size: "4310"
      }
    },
    {
      icon: require('@/assets/img/apex.jpg'),
      title: 'Apex Vector Testnet',
      blockchain: Blockchain.APEX_VECTOR,
      network: Network.TESTNET,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 'tÂ',
      currencyName: 'tAP3X',
    },
  ],
  resolveNetwork(chain: string, network: string) {
    return this.networks.find(element => element.blockchain === chain && element.network === network);
  },
  resolveNetworkId(chain: string, network: string): number {
    return this.resolveNetwork(chain, network).networkId;
  },
  resolveCurrencySymbol(chain: string, network: string): string {
    return this.resolveNetwork(chain, network).currencySymbol
  },
  resolveCurrencyName(chain: string, network: string): string {
    return this.resolveNetwork(chain, network).currencyName
  }
};
