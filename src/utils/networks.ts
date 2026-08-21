import { Blockchain, Network, Provider } from '@/models/types';
import cardanoBlueLogo from '@/assets/svg/cardano-blue.svg';
import cardanoSvg from '@/assets/svg/cardano.svg';
import apexSvg from '@/assets/svg/ap3x.svg';
import midnightLogo from '@/assets/svg/midnight.svg';
import bitcoinLogo from '@/assets/bitcoin-logo.svg';

export interface NetworkInfo {
  icon: string;
  iconColor: string;  // Wallet icon color for this blockchain
  title: string;
  blockchain: string;
  network: string;
  comingSoon?: boolean;  // Network shown but not yet selectable
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
  perpetualsSupport: boolean;
  geroCardSupport: boolean;
  goMiningSupport: boolean;
  babylonSupport: boolean;
  ordinalsSupport: boolean;
  thorchainSupport: boolean;
  mempoolSupport: boolean;
  lightningSupport: boolean;
  /**
   * RealFi Earn (USDr / sUSDr yield) availability for this network.
   *
   * Optional and resolved with `?? false`, so a network that predates the feature
   * stays off without touching its entry — only the networks that opt in carry it.
   * Cardano PREPROD only while the integration is validated against RealFi's
   * testnet; mainnet flips on when their mainnet ships and we have signed off.
   */
  realFiSupport?: boolean;
  networkParams: {
    networkMagic: number;
  }
}
export default {
  networks: [
    {
      icon: cardanoBlueLogo,
      iconColor: 'blue',
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
      perpetualsSupport: true,
      geroCardSupport: true,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 764824073
      }
    },
    {
      icon: cardanoBlueLogo,
      iconColor: 'blue',
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
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      // RealFi runs its public testnet on Cardano preprod; this is the only
      // network the Earn surface is reachable from today.
      realFiSupport: true,
      networkParams: {
        networkMagic: 1
      }
    },
    {
      icon: cardanoBlueLogo,
      iconColor: 'blue',
      title: 'Cardano Preview',
      blockchain: Blockchain.CARDANO,
      network: Network.PREVIEW,
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
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 2
      }
    },
    {
      icon: apexSvg,
      iconColor: 'orange',
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
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 764824073
      }
    },
    {
      icon: apexSvg,
      iconColor: 'orange',
      title: 'Apex Vector Mainnet',
      blockchain: Blockchain.APEX_VECTOR,
      network: Network.MAINNET,
      supportedHardware: false,
      networkId: 1,
      currencySymbol: 'Â',
      currencyTicker: 'AP3X',
      currencyName: 'Apex Fusion',
      currencyDescription: 'Apex Fusion Native Token',
      currencyImage: apexSvg,
      // Live values from yaci-apex-vector-mainnet /api/v1/epochs/latest/parameters (epoch 233)
      protocolParams: {
        min_fee_a: 45,
        min_fee_b: 156253,
        max_tx_size: 16384,
        min_utxo_value: "0",
        key_deposit: "500000000",
        pool_deposit: "5000000000000",
        max_val_size: 5000,
        price_mem: 0.0577,
        price_step: 0.0000721,
        coins_per_utxo_size: "4310"
      },
      geroPool: '',
      defaultProvider: Provider.KOIOS,
      cashbackSupport: false,
      // Apex Vector has no delegated staking — hide the Staking page/nav on it.
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport:true,
      swapSupport: false,
      buySupport: false,
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 764824073  // Apex Vector cardano-node shelley/byron genesis (RequiresNoMagic)
      }
    },
    // Bitcoin visibility is gated by the isBitcoinEnabled feature flag (gero-sync),
    // enforced in NetworkSelector.isFamilySelectable — NOT by removing the entries.
    // With the flag OFF the Bitcoin family renders as a disabled "Soon" tile and no
    // wallet can be created, so BTC stays hidden from onboarding; flip the flag to
    // reveal it without a client release. (Replaces the old BITCOIN_REMOVED_2_7
    // comment-out; mainnet stays comingSoon until validated — testnet is live.)
    // Bitcoin Mainnet
    {
      icon: bitcoinLogo,
      iconColor: 'yellow',
      title: 'Bitcoin Mainnet',
      blockchain: Blockchain.BITCOIN,
      network: Network.MAINNET,
      comingSoon: true,
      supportedHardware: true,
      networkId: 0,
      currencySymbol: '\u20BF',  // ₿ symbol
      currencyTicker: 'BTC',
      currencyName: 'Bitcoin',
      currencyDescription: 'Bitcoin Native Currency',
      currencyImage: bitcoinLogo,
      protocolParams: {
        min_fee_a: 0,
        min_fee_b: 0,
        max_tx_size: 0,
        min_utxo_value: "0",
        key_deposit: "0",
        pool_deposit: "0",
        max_val_size: 0,
        price_mem: 0,
        price_step: 0,
        coins_per_utxo_size: "0"
      },
      geroPool: '',
      defaultProvider: Provider.BLOCKSTREAM,
      cashbackSupport: false,
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport: true,
      swapSupport: false,
      buySupport: true,
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: true,
      babylonSupport: true,
      ordinalsSupport: true,
      thorchainSupport: true,
      mempoolSupport: true,
      lightningSupport: true,
      networkParams: {
        networkMagic: 0xF9BEB4D9  // Bitcoin mainnet magic bytes
      }
    },
    // Bitcoin Testnet. Display title says "Testnet4" (the onboarding pill strips the
    // "Bitcoin " prefix → "Testnet4") so users pick a matching faucet — the backend
    // testnet Esplora is mempool.space/testnet4. `network` stays TESTNET (drives
    // subscribe/Esplora selection); only the label is variant-specific. Keep this in
    // sync with gero-sync's bitcoin.testnet.esplora-url if the testnet source moves.
    {
      icon: bitcoinLogo,
      iconColor: 'yellow',
      title: 'Bitcoin Testnet4',
      blockchain: Blockchain.BITCOIN,
      network: Network.TESTNET,
      supportedHardware: true,
      networkId: 1,
      currencySymbol: 'tBTC',
      currencyTicker: 'tBTC',
      currencyName: 'Bitcoin Testnet',
      currencyDescription: 'Bitcoin Test Network Currency',
      currencyImage: bitcoinLogo,
      protocolParams: {
        min_fee_a: 0,
        min_fee_b: 0,
        max_tx_size: 0,
        min_utxo_value: "0",
        key_deposit: "0",
        pool_deposit: "0",
        max_val_size: 0,
        price_mem: 0,
        price_step: 0,
        coins_per_utxo_size: "0"
      },
      geroPool: '',
      defaultProvider: Provider.BLOCKSTREAM,
      cashbackSupport: false,
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport: true,
      swapSupport: false,
      buySupport: false,
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: true,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: true,
      lightningSupport: true,
      networkParams: {
        networkMagic: 0x0709110B  // Bitcoin testnet magic bytes
      }
    },
    // Midnight Preview (testnet)
    {
      icon: midnightLogo,
      iconColor: 'grey',
      title: 'Midnight Preview',
      blockchain: Blockchain.MIDNIGHT,
      network: Network.PREVIEW,
      // No hardware wallet support: Midnight ZK proof generation requires the
      // secret key in cleartext, which Ledger/Trezor cannot expose.
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 'tNIGHT',
      currencyTicker: 'tNIGHT',
      currencyName: 'Midnight Preview',
      currencyDescription: 'Midnight Preview Network Token',
      currencyImage: midnightLogo,
      // Midnight uses Substrate fee model (DUST), not Cardano protocol params.
      // These fields stay zeroed; Midnight-specific parameters live elsewhere.
      protocolParams: {
        min_fee_a: 0,
        min_fee_b: 0,
        max_tx_size: 0,
        min_utxo_value: "0",
        key_deposit: "0",
        pool_deposit: "0",
        max_val_size: 0,
        price_mem: 0,
        price_step: 0,
        coins_per_utxo_size: "0"
      },
      geroPool: '',
      defaultProvider: Provider.UNDEFINED,
      cashbackSupport: false,
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport: true,
      swapSupport: false,
      buySupport: false,
      zkFoldSupport: false,
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 0  // Midnight uses Substrate; magic bytes don't apply
      }
    },
    // Midnight Preprod (testnet)
    {
      icon: midnightLogo,
      iconColor: 'grey',
      title: 'Midnight Preprod',
      blockchain: Blockchain.MIDNIGHT,
      network: Network.PREPROD,
      supportedHardware: false,
      networkId: 0,
      currencySymbol: 'tNIGHT',
      currencyTicker: 'tNIGHT',
      currencyName: 'Midnight Preprod',
      currencyDescription: 'Midnight Preprod Network Token',
      currencyImage: midnightLogo,
      protocolParams: {
        min_fee_a: 0,
        min_fee_b: 0,
        max_tx_size: 0,
        min_utxo_value: "0",
        key_deposit: "0",
        pool_deposit: "0",
        max_val_size: 0,
        price_mem: 0,
        price_step: 0,
        coins_per_utxo_size: "0"
      },
      geroPool: '',
      defaultProvider: Provider.UNDEFINED,
      cashbackSupport: false,
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport: true,
      swapSupport: false,
      buySupport: false,
      zkFoldSupport: false,
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 0
      }
    },
    // Midnight Mainnet
    {
      icon: midnightLogo,
      iconColor: 'grey',
      title: 'Midnight Mainnet',
      blockchain: Blockchain.MIDNIGHT,
      network: Network.MAINNET,
      supportedHardware: false,
      networkId: 1,
      currencySymbol: 'NIGHT',
      currencyTicker: 'NIGHT',
      currencyName: 'Midnight',
      currencyDescription: 'Midnight Native Token',
      currencyImage: midnightLogo,
      protocolParams: {
        min_fee_a: 0,
        min_fee_b: 0,
        max_tx_size: 0,
        min_utxo_value: "0",
        key_deposit: "0",
        pool_deposit: "0",
        max_val_size: 0,
        price_mem: 0,
        price_step: 0,
        coins_per_utxo_size: "0"
      },
      geroPool: '',
      defaultProvider: Provider.UNDEFINED,
      cashbackSupport: false,
      stakingSupport: false,
      governanceSupport: false,
      daoSupport: false,
      transactionSupport: true,
      swapSupport: false,
      buySupport: false,
      perpetualsSupport: false,
      geroCardSupport: false,
      goMiningSupport: false,
      babylonSupport: false,
      ordinalsSupport: false,
      thorchainSupport: false,
      mempoolSupport: false,
      lightningSupport: false,
      networkParams: {
        networkMagic: 0
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
  resolveGeroCardSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.geroCardSupport
  },
  /**
   * RealFi Earn availability for a wallet's chain + network.
   *
   * Answers only "can this wallet reach RealFi at all" — it is deliberately
   * independent of `featureFlagsStore.isRealFiEnabled()`, which answers "is the
   * feature live". Both must pass; the router and the nav item AND them together,
   * the same way Pool Operator combines staking support with its own flag.
   */
  resolveRealFiSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.realFiSupport ?? false
  },
  resolveGoMiningSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.goMiningSupport ?? false
  },
  resolveBabylonSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.babylonSupport ?? false
  },
  resolveOrdinalsSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.ordinalsSupport ?? false
  },
  resolveThorchainSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.thorchainSupport ?? false
  },
  resolveMempoolSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.mempoolSupport ?? false
  },
  resolveLightningSupport(chain: string, network: string): boolean {
    if (!chain || !network) {
      return false
    }
    return this.resolveNetwork(chain, network)?.lightningSupport ?? false
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
  resolveIconColor(chain: string, network: string): string {
    return this.resolveNetwork(chain, network)?.iconColor || 'green';
  },
};
