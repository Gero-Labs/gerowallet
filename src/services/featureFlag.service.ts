import * as LDClient from 'launchdarkly-js-client-sdk';

interface FeatureFlagConfig {
  clientSideID: string;
  user?: {
    key: string;
    name?: string;
    email?: string;
  };
}

class FeatureFlagService {
  private client: LDClient.LDClient | null = null;
  private isInitialized = false;
  private initializationPromise: Promise<void> | null = null;
  private config: FeatureFlagConfig | null = null;

  /**
   * Initialize LaunchDarkly client
   */
  async initialize(clientSideID: string, user?: { key: string; name?: string; email?: string }): Promise<void> {
    // If already initializing, return the existing promise
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    // If already initialized with the same config, skip
    if (this.isInitialized && this.config?.clientSideID === clientSideID) {
      return Promise.resolve();
    }

    this.initializationPromise = this._initialize(clientSideID, user);
    return this.initializationPromise;
  }

  private async _initialize(clientSideID: string, user?: { key: string; name?: string; email?: string }): Promise<void> {
    try {
      this.config = {
        clientSideID,
        user,
      };

      const ldUser: LDClient.LDUser = user || {
        key: 'anonymous',
        anonymous: true,
      };

      this.client = LDClient.initialize(clientSideID, ldUser);
      await this.client.waitForInitialization();
      this.isInitialized = true;
    } catch (error) {
      console.error('FeatureFlag connection failed:', error);
      throw error;
    } finally {
      this.initializationPromise = null;
    }
  }

  /**
   * Get a feature flag value
   */
  getFlag<T>(flagKey: string, fallbackValue: T): T {
    if (!this.isInitialized || !this.client) {
      return fallbackValue;
    }

    try {
      return this.client.variation(flagKey, fallbackValue) as T;
    } catch (error) {
      console.error(`Error getting feature flag "${flagKey}":`, error);
      return fallbackValue;
    }
  }

  /**
   * Subscribe to flag changes
   */
  onFlagChange(flagKey: string, callback: (newValue: any, oldValue: any) => void): void {
    if (!this.isInitialized || !this.client) {
      return;
    }

    this.client.on(`change:${flagKey}`, (current: any, previous: any) => {
      callback(current, previous);
    });
  }

  /**
   * Close the feature flag client
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.isInitialized = false;
    }
  }

}

// Export singleton instance
export const launchDarklyService = new FeatureFlagService();
export default launchDarklyService;
