import * as LDClient from 'launchdarkly-js-client-sdk';

interface FeatureFlagConfig {
  clientSideID: string;
}

type FlagChangeCallback = (newValue: any, oldValue: any) => void;

class FeatureFlagService {
  private client: LDClient.LDClient | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private config: FeatureFlagConfig | null = null;
  private listeners = new Map<string, FlagChangeCallback[]>();

  /**
   * Initialize LaunchDarkly client
   * @param clientSideID - LaunchDarkly client-side ID
   * @param contextKey - Optional context key (defaults to 'anonymous-user')
   * @param timeout - Optional timeout in seconds for initialization (defaults to 5)
   * @returns Promise that resolves when initialization is complete
   */
  async initialize(clientSideID: string, contextKey?: string, timeout?: number): Promise<void> {
    // If already initializing, return the existing promise
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // If already initialized with the same config, skip
    if (this.isInitialized && this.config?.clientSideID === clientSideID) {
      return;
    }

    // Start initialization and cache the promise
    this.initializationPromise = (async () => {
      try {
        this.config = { clientSideID };

        // Create context with proper key
        const context = {
          kind: 'user',
          key: contextKey || 'anonymous-user',
        };

        this.client = LDClient.initialize(clientSideID, context);
        const initTimeout = timeout ?? 5;
        await this.client.waitForInitialization(initTimeout);
        this.isInitialized = true;

        // Re-attach existing listeners after initialization
        this.reattachListeners();
      } catch (error) {
        console.warn('🚩 FeatureFlag initialization failed, will use fallback values:', error);
        // Don't throw - feature flags should degrade gracefully
        // The service will return fallback values when getFlag() is called
        this.isInitialized = false;
        this.client = null;
      } finally {
        this.initializationPromise = null;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Re-attach all registered listeners after client initialization
   */
  private reattachListeners(): void {
    if (!this.client) return;

    for (const [flagKey, callbacks] of this.listeners.entries()) {
      for (const callback of callbacks) {
        this.client.on(`change:${flagKey}`, callback);
      }
    }
  }

  /**
   * Get a feature flag value
   * @param flagKey - The feature flag key
   * @param fallbackValue - Value to return if flag is not available
   * @returns The flag value or fallback
   */
  getFlag<T>(flagKey: string, fallbackValue: T): T {
    if (!this.isInitialized || !this.client) {
      return fallbackValue;
    }

    try {
      return this.client.variation(flagKey, fallbackValue) as T;
    } catch (error) {
      console.error(`🚩 Error getting feature flag "${flagKey}":`, error);
      return fallbackValue;
    }
  }

  /**
   * Get all feature flags as an object
   * @returns Object with all flag values
   */
  getAllFlags(): Record<string, any> {
    if (!this.isInitialized || !this.client) {
      return {};
    }

    try {
      return this.client.allFlags();
    } catch (error) {
      console.error('🚩 Error getting all flags:', error);
      return {};
    }
  }

  /**
   * Subscribe to flag changes
   * @param flagKey - The feature flag key to watch
   * @param callback - Function to call when flag changes
   * @returns Unsubscribe function
   */
  onFlagChange(flagKey: string, callback: FlagChangeCallback): () => void {
    // Store callback for re-attachment on reconnection
    if (!this.listeners.has(flagKey)) {
      this.listeners.set(flagKey, []);
    }
    this.listeners.get(flagKey)!.push(callback);

    // Attach listener if client is ready
    if (this.isInitialized && this.client) {
      this.client.on(`change:${flagKey}`, callback);
    }

    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(flagKey);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
        // Clean up empty arrays
        if (callbacks.length === 0) {
          this.listeners.delete(flagKey);
        }
      }

      // Remove from client if available
      if (this.client) {
        this.client.off(`change:${flagKey}`, callback);
      }
    };
  }

  /**
   * Check if the service is initialized
   */
  isReady(): boolean {
    return this.isInitialized && this.client !== null;
  }

  /**
   * Close the feature flag client
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.isInitialized = false;
      this.config = null;
      this.listeners.clear();
    }
  }
}

// Export singleton instance
export const launchDarklyService = new FeatureFlagService();
export default launchDarklyService;
