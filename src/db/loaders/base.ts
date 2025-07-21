import { liveQuery, Subscription } from 'dexie';

/**
 * Base loader interface for all data loaders
 */
export interface ILoader {
  /**
   * Load data and set up subscription
   * @returns Promise that resolves with the loaded data
   */
  load(): Promise<any>;

  /**
   * Unsubscribe from the data loader
   */
  unsubscribe(): void;

  /**
   * Check if the loader is currently subscribed
   */
  isSubscribed(): boolean;
}

/**
 * Base loader class with common functionality
 */
export abstract class BaseLoader implements ILoader {
  protected subscription: Subscription | null = null;
  protected subscriptionKey: string;

  constructor(subscriptionKey: string) {
    this.subscriptionKey = subscriptionKey;
  }

  abstract load(): Promise<any>;

  unsubscribe(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }

  isSubscribed(): boolean {
    return this.subscription !== null;
  }

  /**
   * Create a live query subscription with error handling
   * @param queryFn - Function that returns the database query
   * @param onNext - Callback for when data changes
   * @param onError - Optional error callback
   */
  protected createSubscription<T>(
    queryFn: () => Promise<T> | T,
    onNext: (data: T) => void,
    onError?: (error: any) => void
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.subscription = liveQuery(queryFn).subscribe({
        next: (data: T) => {
          onNext(data);
          resolve(data);
        },
        error: (error: any) => {
          console.error(`Loader ${this.subscriptionKey} failed:`, error);
          if (onError) {
            onError(error);
          }
          reject(error);
        }
      });
    });
  }
}

/**
 * Loader registry to manage all active loaders
 */
export class LoaderRegistry {
  private static instance: LoaderRegistry;
  private loaders: Map<string, ILoader> = new Map();

  static getInstance(): LoaderRegistry {
    if (!LoaderRegistry.instance) {
      LoaderRegistry.instance = new LoaderRegistry();
    }
    return LoaderRegistry.instance;
  }

  register(key: string, loader: ILoader): void {
    this.loaders.set(key, loader);
  }

  unregister(key: string): void {
    const loader = this.loaders.get(key);
    if (loader) {
      loader.unsubscribe();
      this.loaders.delete(key);
    }
  }

  unsubscribeAll(): void {
    this.loaders.forEach(loader => loader.unsubscribe());
    this.loaders.clear();
  }

  getLoader(key: string): ILoader | undefined {
    return this.loaders.get(key);
  }

  getAllLoaders(): Map<string, ILoader> {
    return new Map(this.loaders);
  }
}