import Vue from 'vue';
import launchDarklyService from '@/services/featureFlag.service';

export interface FeatureFlags {
  swapEnabled: boolean;
  isGeroCardEnabled: boolean;
  isBlogEnabled: boolean;
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
  },
  isInitialized: false,
  isLoading: false,
});

export const featureFlagsStore = {
  state: featureFlagsState,

  /**
   * Initialize LaunchDarkly and load feature flags
   */
  async initialize(clientSideID: string): Promise<void> {
    if (featureFlagsState.isInitialized) {
      return;
    }

    featureFlagsState.isLoading = true;

    try {
      await launchDarklyService.initialize(clientSideID, 'gero-extension', 5);
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
   * Load all feature flags from LaunchDarkly
   */
  loadFlags(): void {
    featureFlagsState.flags.swapEnabled = launchDarklyService.getFlag('isSwapEnabled', false);
    featureFlagsState.flags.isGeroCardEnabled = launchDarklyService.getFlag('isGeroCardEnabled', false);
    featureFlagsState.flags.isBlogEnabled = launchDarklyService.getFlag('isBlogEnabled', false);
  },

  /**
   * Subscribe to flag changes in real-time
   */
  subscribeToFlagChanges(): void {
    launchDarklyService.onFlagChange('isSwapEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'swapEnabled', newValue);
    });
    launchDarklyService.onFlagChange('isGeroCardEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isGeroCardEnabled', newValue);
    });
    launchDarklyService.onFlagChange('isBlogEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isBlogEnabled', newValue);
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
   * Reset flags (disable all until reloaded from LaunchDarkly)
   */
  reset(): void {
    Vue.set(featureFlagsState, 'flags', {
      swapEnabled: false,
      isGeroCardEnabled: false,
      isBlogEnabled: false
    });
    featureFlagsState.isInitialized = false;
    featureFlagsState.isLoading = false;
  },
};

export default featureFlagsStore;
