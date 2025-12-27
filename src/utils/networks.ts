import { Blockchain, Network, Provider } from '@/models/types';
import cardanoBlueLogo from '@/assets/svg/cardano-blue.svg';
import cardanoSvg from '@/assets/svg/cardano.svg';
import apexSvg from '@/assets/svg/ap3x.svg';
import apex from '@/assets/img/apex.jpg';

export interface NetworkInfo {
  icon: string;
  title: string;
  blockchain: string;
  network: string;
  supportedHardware: boolean;
  networkId: number;
  currencySymbol: string;
  currencyTicker: string;
  currencyName: string;
  currencyDescription: string;
  currencyImage: string;
  protocolParams: {
    min_fee_a: number;
    min_fee_b: number;
    max_tx_size: number;
    min_utxo_value: string;
    key_deposit: string;
    pool_deposit: string;
    max_val_size: number;
    price_mem: number;
    price_step: number;
    coins_per_utxo_size: string;
  },
  geroPool: string;
  defaultProvider: Provider;
  cashbackSupport: boolean;
  stakingSupport: boolean;
  governanceSupport: boolean;
  daoSupport: boolean;
  transactionSupport: boolean;
  swapSupport: boolean;
  buySupport: boolean;
  zkFoldSupport: boolean;
  perpetualsSupport: boolean;
  multiSigSupport: boolean,
  geroCardSupport: boolean;
  networkParams: {
    networkMagic: number;
  }
}
export default {
  networks: [
    {
      icon: cardanoBlueLogo,
      title: 'Cardano Mainnet',
      blockchain: Blockchain.CARDANO,
      network: Network.MAINNET,
      supportedHardware: true,
      networkId: 1,
      currencySymbol: '₳',
      currencyTicker: 'ADA',
      currencyName: 'Cardano',
      currencyDescription: 'Cardano Native Token',
      currencyImage: cardanoSvg,
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
      },
      geroPool: 'pool12yscr8j3zs34ewxrwlk0p2w5uvgcnrzywpp78ddjsj8kxd530f9',
      defaultProvider: Provider.KOIOS,
      cashbackSupport: true,
      stakingSupport: true,
      governanceSupport: true,
      daoSupport: true,
      transactionSupport:true,
      swapSupport: true,
      buySupport: true,
      zkFoldSupport: false,
      perpetualsSupport: true,
      multiSigSupport: false,
      geroCardSupport: true,
      networkParams: {
        networkMagic: 764824073
      }
    },
    {
      icon: cardanoBlueLogo,
      title: 'Cardano Preprod',
      blockchain: Blockchain.CARDANO,
      network: Network.PREPROD,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 't₳',
      currencyTicker: 'tADA',
      currencyName: 'Cardano',
      currencyDescription: 'Cardano Native Token',
      currencyImage: cardanoSvg,
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
      },
      defaultProvider: Provider.KOIOS,
      cashbackSupport: false,
      stakingSupport: true,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport:true,
      swapSupport: false,
      buySupport: false,
      zkFoldSupport: false,
      perpetualsSupport: false,
      multiSigSupport: false,
      geroCardSupport: false,
      networkParams: {
        networkMagic: 1
      }
    },
    {
      icon: apex,
      title: 'Apex Prime Mainnet',
      blockchain: Blockchain.APEX_PRIME,
      network: Network.MAINNET,
      supportedHardware: false,
      networkId: 1,
      currencySymbol: 'Â',
      currencyTicker: 'AP3X',
      currencyName: 'Apex Fusion',
      currencyDescription: 'Apex Fusion Native Token',
      currencyImage: apexSvg,
      protocolParams: {
        min_fee_a: 47,
        min_fee_b: 158298,
        max_tx_size: 16384,
        min_utxo_value: "0",
        key_deposit: "2000000",
        pool_deposit: "300000000",
        max_val_size: 5000,
        price_mem: 0.0577,
        price_step: 0.0000721,
        coins_per_utxo_size: "4310"
      },
      geroPool: 'pool13k76f7tt46psnhp75cwnfg5dtkjvwq64fg53tp2zthnzqyge58k',
      defaultProvider: Provider.KOIOS,
      cashbackSupport: false,
      stakingSupport: true,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport:true,
      swapSupport: false,
      buySupport: false,
      zkFoldSupport: false,
      perpetualsSupport: false,
      multiSigSupport: false,
      geroCardSupport: false,
      networkParams: {
        networkMagic: 764824073
      }
    },
    {
      icon: apex,
      title: 'Apex Vector Testnet',
      blockchain: Blockchain.APEX_VECTOR,
      network: Network.TESTNET,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 'tÂ',
      currencyTicker: 'tAP3X',
      currencyName: 'Apex Fusion',
      currencyDescription: 'Apex Fusion Native Token',
      currencyImage: apexSvg,
      defaultProvider: Provider.BLOCKFROST,
      cashbackSupport: false,
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport:true,
      swapSupport: false,
      buySupport: false,
      zkFoldSupport: false,
      perpetualsSupport: false,
      multiSigSupport: false,
      geroCardSupport: false,
      networkParams: {
        networkMagic: 1
      }
    },
  ]  as NetworkInfo[],
  resolveNetwork(chain: string, network: string): NetworkInfo {
    return this.networks.find(element => element.blockchain === chain && element.network === network);
  },
  resolveNetworkId(chain: string, network: string): number {
    return this.resolveNetwork(chain, network)?.networkId;
  },
  resolveCurrencySymbol(chain: string, network: string): string {
    if (!chain || !network) {
      return ''
    }
    return this.resolveNetwork(chain, network)?.currencySymbol
  },
  resolveCurrencyTicker(chain: string, network: string): string {
    if (!chain || !network) {
      return ''
    }
    return this.resolveNetwork(chain, network)?.currencyTicker
  },
  resolveCurrencyName(chain: string, network: string): string {
    if (!chain || !network) {
      return ''
    }
    return this.resolveNetwork(chain, network)?.currencyName
  },
  resolveCurrencyImage(chain: string, network: string): string {
    if (!chain || !network) {
      return ''
    }
    return this.resolveNetwork(chain, network)?.currencyImage
  },
  resolvePool(chain: string, network: string): string {
    return this.resolveNetwork(chain, network)?.geroPool
  },
  resolveDefaultProvider(chain: string, network: string): Provider {
    if (!chain || !network) {
      return Provider.UNDEFINED
    }
    return this.resolveNetwork(chain, network)?.defaultProvider
  },
  resolveCashbackSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.cashbackSupport
  },
  resolveStakingSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.stakingSupport
  },
  resolveGovernanceSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.governanceSupport
  },
  resolveMultiSigSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.multiSigSupport
  },
  resolveGeroCardSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.geroCardSupport
  },
  resolveDaoSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.daoSupport
  },
  resolveTransactionsSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.transactionSupport
  },
  resolveSwapSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.swapSupport
  },
  resolveBuySupported(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.buySupport
  },
  resolvePerpetualsSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.perpetualsSupport
  },
  resolveNetworkMagic(chain: string, network: string): number {
    return this.resolveNetwork(chain, network)?.networkParams?.networkMagic || 0;
  },
};
