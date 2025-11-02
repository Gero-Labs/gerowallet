import Dexie from 'dexie';
import { LoaderRegistry } from './base';
import { AssetsLoader, GenesisLoader, EpochParamsLoader } from './network';
import {
  AccountLoader,
  ContactsLoader,
  ConfigLoader,
  RewardsLoader,
  ConnectedDappsLoader,
  TransactionsLoader,
} from './walletLoader';

/**
 * Factory for creating and managing all wallet loaders
 */
export class LoaderFactory {
  private registry = new LoaderRegistry();

  constructor(
    private walletContext: {
      id: any;
      chain: any;
      network: any;
      baseAddress: string;
      stakeAddress: string;
      isEnterpriseAddress: () => boolean;
      networkId: () => number;
      getDb: () => Promise<Dexie>;
      getBlockchainDb: () => Promise<Dexie>;
      setUtxosAndAddresses: (transactions: any[]) => Promise<void>;
      triggerResync?: () => Promise<void>;
    }
  ) {}

  /**
   * Create and register all loaders
   */
  createAllLoaders(): void {
    // Network loaders
    this.registry.register('assets', new AssetsLoader(this.walletContext.getBlockchainDb.bind(this.walletContext)));
    this.registry.register(
      'genesis_info',
      new GenesisLoader(this.walletContext.getBlockchainDb.bind(this.walletContext))
    );
    this.registry.register(
      'epoch_params',
      new EpochParamsLoader(
        this.walletContext.getBlockchainDb.bind(this.walletContext),
      )
    );

    // Wallet loaders
    this.registry.register(
      'account',
      new AccountLoader(this.walletContext.getDb.bind(this.walletContext), this.walletContext.id)
    );
    this.registry.register('contacts', new ContactsLoader(this.walletContext.getDb.bind(this.walletContext)));
    this.registry.register('config', new ConfigLoader(this.walletContext.getDb.bind(this.walletContext)));
    this.registry.register('rewards', new RewardsLoader(this.walletContext.getDb.bind(this.walletContext)));
    this.registry.register('dapps', new ConnectedDappsLoader(this.walletContext.getDb.bind(this.walletContext)));
    this.registry.register(
      'transactions',
      new TransactionsLoader(this.walletContext.getDb.bind(this.walletContext), this.walletContext)
    );
  }

  /**
   * Load all data using registered loaders
   */
  async loadAll(): Promise<void> {
    const loaders = this.registry.getAllLoaders();
    const promises = Array.from(loaders.values()).map(loader => loader.load());
    await Promise.allSettled(promises);
  }

  /**
   * Load specific data by loader key
   */
  async load(key: string): Promise<any> {
    const loader = this.registry.getLoader(key);
    if (!loader) {
      throw new Error(`Loader '${key}' not found`);
    }
    return loader.load();
  }

  /**
   * Unsubscribe from all loaders
   */
  unsubscribeAll(): void {
    this.registry.unsubscribeAll();
  }

  /**
   * Unsubscribe from specific loader
   */
  unsubscribe(key: string): void {
    this.registry.unregister(key);
  }

  /**
   * Get a specific loader instance
   */
  getLoader(key: string) {
    return this.registry.getLoader(key);
  }

  /**
   * Check if a loader is registered
   */
  hasLoader(key: string): boolean {
    return this.registry.getLoader(key) !== undefined;
  }
}
