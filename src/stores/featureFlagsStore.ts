import Vue from 'vue';
import featureFlagService from '@/services/featureFlag.service';

export interface FeatureFlags {
  swapEnabled: boolean;
  isGeroCardEnabled: boolean;
  isBlogEnabled: boolean;
  isPhysicalCardOrderingEnabled: boolean;
  isGoMiningEnabled: boolean;
  isPoolOperatorEnabled: boolean;
}

interface FeatureFlagsState {
  flags: FeatureFlags;
  isInitialized: boolean;
  isLoading: boolean;
}

const featureFlagsState = Vue.observable<FeatureFlagsState>({
  flags: {
    swapEnabled: false,
    isGeroCardEnabled: false,
    isBlogEnabled: false,
    isPhysicalCardOrderingEnabled: false,
    isGoMiningEnabled: false,
    isPoolOperatorEnabled: false,
  },
  isInitialized: false,
  isLoading: false,
});

export const featureFlagsStore = {
  state: featureFlagsState,

  /**
   * Initialize the feature flag service and load current flag values.
   * @param baseUrl - gero-sync flag service URL (e.g. "https://sync.gerowallet.io").
   */
  async initialize(baseUrl: string): Promise<void> {
    if (featureFlagsState.isInitialized) {
      return;
    }

    featureFlagsState.isLoading = true;

    try {
      await featureFlagService.initialize(baseUrl, 'gero-extension', 5);
      this.loadFlags();
      this.subscribeToFlagChanges();
      featureFlagsState.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize feature flags:', error);
    } finally {
      featureFlagsState.isLoading = false;
    }
  },

  /**
   * Load all feature flags from the service.
   */
  loadFlags(): void {
    featureFlagsState.flags.swapEnabled = featureFlagService.getFlag('isSwapEnabled', false);
    featureFlagsState.flags.isGeroCardEnabled = featureFlagService.getFlag('isGeroCardEnabled', false);
    featureFlagsState.flags.isBlogEnabled = featureFlagService.getFlag('isBlogEnabled', false);
    featureFlagsState.flags.isPhysicalCardOrderingEnabled = featureFlagService.getFlag('isPhysicalCardOrderingEnabled', false);
    featureFlagsState.flags.isGoMiningEnabled = featureFlagService.getFlag('isGoMiningEnabled', false);
    featureFlagsState.flags.isPoolOperatorEnabled = featureFlagService.getFlag('isPoolOperatorEnabled', false);
  },

  /**
   * Subscribe to flag changes in real-time.
   */
  subscribeToFlagChanges(): void {
    featureFlagService.onFlagChange('isSwapEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'swapEnabled', newValue);
    });
    featureFlagService.onFlagChange('isGeroCardEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isGeroCardEnabled', newValue);
    });
    featureFlagService.onFlagChange('isBlogEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isBlogEnabled', newValue);
    });
    featureFlagService.onFlagChange('isPhysicalCardOrderingEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isPhysicalCardOrderingEnabled', newValue);
    });
    featureFlagService.onFlagChange('isGoMiningEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isGoMiningEnabled', newValue);
    });
    featureFlagService.onFlagChange('isPoolOperatorEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isPoolOperatorEnabled', newValue);
    });
  },

  /**
   * Check if swap feature is enabled
   */
  isSwapEnabled(): boolean {
    return featureFlagsState.flags.swapEnabled;
  },

  /**
   * Check if Gero Card feature is enabled
   */
  isGeroCardEnabled(): boolean {
    return featureFlagsState.flags.isGeroCardEnabled;
  },

  /**
   * Check if Blog Page is enabled
   */
  isBlogEnabled(): boolean {
    return featureFlagsState.flags.isBlogEnabled;
  },

  /**
   * Check if Physical Card Ordering is enabled
   */
  isPhysicalCardOrderingEnabled(): boolean {
    return featureFlagsState.flags.isPhysicalCardOrderingEnabled;
  },

  /**
   * Check if GoMining integration is enabled
   */
  isGoMiningEnabled(): boolean {
    return featureFlagsState.flags.isGoMiningEnabled;
  },

  /**
   * Check if Pool Operator dashboard is enabled
   */
  isPoolOperatorEnabled(): boolean {
    return featureFlagsState.flags.isPoolOperatorEnabled;
  },

  /**
   * Reset flags (disable all until re-initialized).
   */
  reset(): void {
    Vue.set(featureFlagsState, 'flags', {
      swapEnabled: false,
      isGeroCardEnabled: false,
      isBlogEnabled: false,
      isPhysicalCardOrderingEnabled: false,
      isGoMiningEnabled: false,
      isPoolOperatorEnabled: false,
    });
    featureFlagsState.isInitialized = false;
    featureFlagsState.isLoading = false;
  },
};

export default featureFlagsStore;
