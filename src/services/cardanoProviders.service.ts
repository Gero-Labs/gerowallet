/**
 * Cardano Providers Service
 *
 * Creates and manages Cardano blockchain providers using @cardano-sdk/cardano-services-client
 * with persistent caching and WebSocket support.
 *
 * Based on Lace wallet's provider architecture for optimal performance.
 */

import { Logger } from '@cardano-sdk/util';
import {
  AssetProvider,
  ChainHistoryProvider,
  DRepProvider,
  NetworkInfoProvider,
  Provider,
  RewardAccountInfoProvider,
  RewardsProvider,
  StakePoolProvider,
  TxSubmitProvider,
  UtxoProvider,
  Cardano,
  HandleProvider
} from '@cardano-sdk/core';

import {
  BlockfrostClient,
  BlockfrostClientConfig,
  BlockfrostAssetProvider,
  BlockfrostChainHistoryProvider,
  BlockfrostDRepProvider,
  BlockfrostUtxoProvider,
  BlockfrostRewardsProvider,
  BlockfrostTxSubmitProvider,
  BlockfrostNetworkInfoProvider,
  BlockfrostRewardAccountInfoProvider,
  BlockfrostStakePoolProvider,
  CardanoWsClient,
  RateLimiter,
  createHttpProviderConfig,
  CreateHttpProviderConfig
} from '@cardano-sdk/cardano-services-client';

import { AddressDiscovery } from '@cardano-sdk/wallet';
import { createPersistentCacheStorage, RemoteApiProperties, RemoteApiPropertyType } from '@cardano-sdk/web-extension';
import { Blockchain, Network } from '@/models/types';

/**
 * Cache configuration for each provider
 * Values calculated from production usage (Lace approach)
 */
const CACHE_SIZE_1MB = 1024 * 1024;

enum CacheName {
  chainHistoryProvider = 'chain-history-provider-cache',
  handleProvider = 'handle-provider-cache',
  inputResolver = 'input-resolver-cache',
  utxoProvider = 'utxo-provider-cache',
  assetProvider = 'asset-provider-cache',
  stakePoolProvider = 'stake-pool-provider-cache'
}

const cacheAssignment: Record<CacheName, { count: number; size: number }> = {
  [CacheName.chainHistoryProvider]: {
    count: 5_180_160_021,
    size: 30 * CACHE_SIZE_1MB
  },
  [CacheName.handleProvider]: {
    count: 65_529_512_340,
    size: 30 * CACHE_SIZE_1MB
  },
  [CacheName.inputResolver]: {
    count: 65_529_512_340,
    size: 30 * CACHE_SIZE_1MB
  },
  [CacheName.utxoProvider]: {
    count: 6_530_251_302,
    size: 30 * CACHE_SIZE_1MB
  },
  [CacheName.assetProvider]: {
    count: 10_000_000,
    size: 20 * CACHE_SIZE_1MB
  },
  [CacheName.stakePoolProvider]: {
    count: 5_000_000,
    size: 20 * CACHE_SIZE_1MB
  }
};

/**
 * All providers needed for wallet operation
 */
export interface WalletProvidersDependencies {
  stakePoolProvider: StakePoolProvider;
  assetProvider: AssetProvider;
  txSubmitProvider: TxSubmitProvider;
  networkInfoProvider: NetworkInfoProvider;
  utxoProvider: UtxoProvider;
  rewardAccountInfoProvider: RewardAccountInfoProvider;
  rewardsProvider: RewardsProvider;
  handleProvider: HandleProvider;
  chainHistoryProvider: ChainHistoryProvider;
  drepProvider: DRepProvider;
  addressDiscovery: AddressDiscovery;
  inputResolver: Cardano.InputResolver;
  wsProvider?: CardanoWsClient;
}

/**
 * Rate limiter configuration for Blockfrost API
 */
export interface RateLimiterConfig {
  size: number;
  increaseInterval: number; // milliseconds
  increaseAmount: number;
}

/**
 * Provider configuration options
 */
export interface ProvidersConfig {
  chain: Blockchain;
  network: Network;
  blockfrostApiKey: string;
  customSubmitTxUrl?: string;
  logger: Logger;
  experiments?: {
    useWebSocket?: boolean;
    useBlockfrostCredentialQueries?: boolean;
  };
}

/**
 * BlockfrostAddressDiscovery implementation
 * Discovers used addresses for HD wallets
 */
class BlockfrostAddressDiscovery implements AddressDiscovery {
  constructor(
    private client: BlockfrostClient,
    private logger: Logger
  ) {}

  async discover(addresses: Cardano.PaymentAddress[]): Promise<Cardano.PaymentAddress[]> {
    const usedAddresses: Cardano.PaymentAddress[] = [];

    try {
      for (const address of addresses) {
        const txs = await this.client.addressTransactions(address, { count: 1, page: 1 });
        if (txs && txs.length > 0) {
          usedAddresses.push(address);
        }
      }
    } catch (error) {
      this.logger.error('AddressDiscovery error:', error);
    }

    return usedAddresses;
  }
}

/**
 * BlockfrostInputResolver implementation
 * Resolves transaction inputs with caching
 */
class BlockfrostInputResolver implements Cardano.InputResolver {
  private cache: any;

  constructor(
    private client: BlockfrostClient,
    private logger: Logger,
    cache: any
  ) {
    this.cache = cache;
  }

  async resolveInput(input: Cardano.TxIn): Promise<Cardano.TxOut | null> {
    const cacheKey = `${input.txId}#${input.index}`;

    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const txUtxos = await this.client.txsUtxos(input.txId);
      const output = txUtxos.outputs[input.index];

      if (output) {
        const txOut: Cardano.TxOut = {
          address: output.address as Cardano.PaymentAddress,
          value: {
            coins: BigInt(output.amount.find(a => a.unit === 'lovelace')?.quantity || '0'),
            assets: new Map(
              output.amount
                .filter(a => a.unit !== 'lovelace')
                .map(a => [Cardano.AssetId(a.unit), BigInt(a.quantity)])
            )
          }
        };

        // Cache the result
        await this.cache.set(cacheKey, txOut);
        return txOut;
      }
    } catch (error) {
      this.logger.error('InputResolver error:', error);
    }

    return null;
  }
}

/**
 * Get Blockfrost network URL based on chain and network
 */
function getBlockfrostUrl(chain: Blockchain, network: Network): string {
  if (chain === Blockchain.CARDANO) {
    switch (network) {
      case Network.MAINNET:
        return 'https://cardano-mainnet.blockfrost.io/api/v0';
      case Network.PREPROD:
        return 'https://cardano-preprod.blockfrost.io/api/v0';
      case Network.PREVIEW:
        return 'https://cardano-preview.blockfrost.io/api/v0';
      default:
        throw new Error(`Unsupported network: ${network}`);
    }
  }
  throw new Error(`Unsupported chain: ${chain}`);
}

/**
 * Get Cardano network ID
 */
function getNetworkId(network: Network): Cardano.NetworkId {
  switch (network) {
    case Network.MAINNET:
      return Cardano.NetworkId.Mainnet;
    case Network.PREPROD:
    case Network.PREVIEW:
      return Cardano.NetworkId.Testnet;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

/**
 * Create rate limiter for Blockfrost API
 */
function createRateLimiter(config?: RateLimiterConfig): RateLimiter {
  const defaultConfig: RateLimiterConfig = {
    size: 500, // Blockfrost free tier: 500 requests per second
    increaseInterval: 1000, // 1 second
    increaseAmount: 500
  };

  const finalConfig = { ...defaultConfig, ...config };

  return {
    size: finalConfig.size,
    increaseInterval: finalConfig.increaseInterval,
    increaseAmount: finalConfig.increaseAmount,
    counter: 0,
    lastIncrease: Date.now()
  };
}

/**
 * Singleton instance for WebSocket provider
 * Only one instance should be alive at a time
 */
let wsProviderInstance: CardanoWsClient | null = null;

/**
 * Create all Cardano providers with caching
 */
export async function createCardanoProviders(
  config: ProvidersConfig
): Promise<WalletProvidersDependencies> {
  const {
    chain,
    network,
    blockfrostApiKey,
    customSubmitTxUrl,
    logger,
    experiments = {}
  } = config;

  const {
    useWebSocket = false,
    useBlockfrostCredentialQueries = true
  } = experiments;

  // Create Blockfrost client
  const blockfrostUrl = getBlockfrostUrl(chain, network);
  const rateLimiter = createRateLimiter();

  const blockfrostConfig: BlockfrostClientConfig = {
    projectId: blockfrostApiKey,
    baseUrl: blockfrostUrl
  };

  const blockfrostClient = new BlockfrostClient(blockfrostConfig, { rateLimiter });

  // Create providers with caching
  const assetProvider = new BlockfrostAssetProvider(blockfrostClient, logger);

  const networkInfoProvider = new BlockfrostNetworkInfoProvider(blockfrostClient, logger);

  const chainHistoryProvider = new BlockfrostChainHistoryProvider(
    { queryTxsByCredentials: useBlockfrostCredentialQueries },
    {
      client: blockfrostClient,
      cache: createPersistentCacheStorage({
        extensionLocalStorage: chrome.storage.local,
        fallbackMaxCollectionItemsGuard: cacheAssignment[CacheName.chainHistoryProvider].count,
        resourceName: CacheName.chainHistoryProvider,
        quotaInBytes: cacheAssignment[CacheName.chainHistoryProvider].size
      }),
      networkInfoProvider,
      logger
    }
  );

  const rewardsProvider = new BlockfrostRewardsProvider(blockfrostClient, logger);

  const stakePoolProvider = new BlockfrostStakePoolProvider(
    {
      client: blockfrostClient,
      cache: createPersistentCacheStorage({
        extensionLocalStorage: chrome.storage.local,
        fallbackMaxCollectionItemsGuard: cacheAssignment[CacheName.stakePoolProvider].count,
        resourceName: CacheName.stakePoolProvider,
        quotaInBytes: cacheAssignment[CacheName.stakePoolProvider].size
      }),
      logger
    }
  );

  const drepProvider = new BlockfrostDRepProvider(blockfrostClient, logger);

  const addressDiscovery = new BlockfrostAddressDiscovery(blockfrostClient, logger);

  const rewardAccountInfoProvider = new BlockfrostRewardAccountInfoProvider({
    client: blockfrostClient,
    dRepProvider: drepProvider,
    logger,
    stakePoolProvider
  });

  // Create input resolver with cache
  const inputResolverCache = createPersistentCacheStorage({
    extensionLocalStorage: chrome.storage.local,
    fallbackMaxCollectionItemsGuard: cacheAssignment[CacheName.inputResolver].count,
    resourceName: CacheName.inputResolver,
    quotaInBytes: cacheAssignment[CacheName.inputResolver].size
  });

  const inputResolver = new BlockfrostInputResolver(
    blockfrostClient,
    logger,
    inputResolverCache
  );

  // Create handle provider (ADA Handle service)
  // Note: This would need to be implemented based on your ADA Handle integration
  const handleProvider: HandleProvider = {
    resolveHandles: async (handles) => {
      // Implement ADA Handle resolution
      return new Map();
    },
    healthCheck: async () => ({ ok: true })
  };

  // Create tx submit provider
  const txSubmitProvider: TxSubmitProvider = customSubmitTxUrl
    ? await createCustomTxSubmitProvider(customSubmitTxUrl, logger)
    : new BlockfrostTxSubmitProvider(blockfrostClient, logger);

  // WebSocket provider (optional)
  if (useWebSocket) {
    // Close previous WebSocket connection if exists
    if (wsProviderInstance) {
      await wsProviderInstance.close().catch((error) => logger.warn('Error closing wsProvider:', error));
    }

    const wsUrl = 'wss://backend.gerowallet.io/ws'; // Replace with your WebSocket URL
    wsProviderInstance = new CardanoWsClient(
      { chainHistoryProvider, logger },
      { url: wsUrl }
    );

    return {
      assetProvider,
      networkInfoProvider: wsProviderInstance.networkInfoProvider,
      txSubmitProvider,
      stakePoolProvider,
      utxoProvider: wsProviderInstance.utxoProvider,
      chainHistoryProvider: wsProviderInstance.chainHistoryProvider,
      rewardAccountInfoProvider,
      rewardsProvider,
      handleProvider,
      wsProvider: wsProviderInstance,
      addressDiscovery,
      inputResolver,
      drepProvider
    };
  }

  // HTTP-based UTXO provider (no WebSocket)
  const utxoProvider = new BlockfrostUtxoProvider(
    { queryUtxosByCredentials: useBlockfrostCredentialQueries },
    {
      cache: createPersistentCacheStorage({
        extensionLocalStorage: chrome.storage.local,
        fallbackMaxCollectionItemsGuard: cacheAssignment[CacheName.utxoProvider].count,
        resourceName: CacheName.utxoProvider,
        quotaInBytes: cacheAssignment[CacheName.utxoProvider].size
      }),
      client: blockfrostClient,
      logger
    }
  );

  return {
    assetProvider,
    networkInfoProvider,
    txSubmitProvider,
    stakePoolProvider,
    utxoProvider,
    chainHistoryProvider,
    rewardAccountInfoProvider,
    rewardsProvider,
    handleProvider,
    addressDiscovery,
    inputResolver,
    drepProvider
  };
}

/**
 * Create custom tx submit provider
 */
async function createCustomTxSubmitProvider(
  customSubmitTxUrl: string,
  logger: Logger
): Promise<TxSubmitProvider> {
  // Implement custom tx submit provider if needed
  // For now, we'll use a simple HTTP POST implementation
  return {
    submitTx: async (tx: Cardano.TxCBOR) => {
      const response = await fetch(customSubmitTxUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/cbor' },
        body: Buffer.from(tx, 'hex')
      });

      if (!response.ok) {
        throw new Error(`Transaction submission failed: ${response.statusText}`);
      }

      return response.json();
    },
    healthCheck: async () => ({ ok: true })
  };
}

/**
 * Clean up all providers and close connections
 */
export async function cleanupProviders(): Promise<void> {
  if (wsProviderInstance) {
    await wsProviderInstance.close().catch(console.error);
    wsProviderInstance = null;
  }
}

/**
 * Remote API properties for cross-context communication
 * Used for Chrome extension messaging
 */
export const walletProvidersProperties: RemoteApiProperties<WalletProvidersDependencies> = {
  stakePoolProvider: {
    queryStakePools: RemoteApiPropertyType.MethodReturningPromise,
    stakePoolStats: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  assetProvider: {
    getAsset: RemoteApiPropertyType.MethodReturningPromise,
    getAssets: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  txSubmitProvider: {
    submitTx: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  networkInfoProvider: {
    ledgerTip: RemoteApiPropertyType.MethodReturningPromise,
    protocolParameters: RemoteApiPropertyType.MethodReturningPromise,
    genesisParameters: RemoteApiPropertyType.MethodReturningPromise,
    lovelaceSupply: RemoteApiPropertyType.MethodReturningPromise,
    stake: RemoteApiPropertyType.MethodReturningPromise,
    eraSummaries: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  utxoProvider: {
    utxoByAddresses: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  rewardAccountInfoProvider: {
    delegationPortfolio: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise,
    rewardAccountInfo: RemoteApiPropertyType.MethodReturningPromise
  },
  rewardsProvider: {
    rewardsHistory: RemoteApiPropertyType.MethodReturningPromise,
    rewardAccountBalance: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  chainHistoryProvider: {
    transactionsByAddresses: RemoteApiPropertyType.MethodReturningPromise,
    transactionsByHashes: RemoteApiPropertyType.MethodReturningPromise,
    blocksByHashes: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  drepProvider: {
    getDRepInfo: RemoteApiPropertyType.MethodReturningPromise,
    getDRepsInfo: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  },
  inputResolver: {
    resolveInput: RemoteApiPropertyType.MethodReturningPromise
  },
  handleProvider: {
    getPolicyIds: RemoteApiPropertyType.MethodReturningPromise,
    resolveHandles: RemoteApiPropertyType.MethodReturningPromise,
    healthCheck: RemoteApiPropertyType.MethodReturningPromise
  }
};
