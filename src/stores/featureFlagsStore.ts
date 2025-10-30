import Vue from 'vue';
import launchDarklyService from '@/services/featureFlag.service';

export interface FeatureFlags {
  swapEnabled: boolean;
  // Add more feature flags as needed
}

interface FeatureFlagsState {
  flags: FeatureFlags;
  isInitialized: boolean;
  isLoading: boolean;
}

const featureFlagsState = Vue.observable<FeatureFlagsState>({
  flags: {
    swapEnabled: false,
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
  },

  /**
   * Subscribe to flag changes in real-time
   */
  subscribeToFlagChanges(): void {
    launchDarklyService.onFlagChange('isSwapEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'swapEnabled', newValue);
    });
  },

  /**
   * Check if swap feature is enabled
   */
  isSwapEnabled(): boolean {
    return featureFlagsState.flags.swapEnabled;
  },

  /**
   * Reset flags (disable all until reloaded from LaunchDarkly)
   */
  reset(): void {
    Vue.set(featureFlagsState, 'flags', { swapEnabled: false });
    featureFlagsState.isInitialized = false;
    featureFlagsState.isLoading = false;
  },
};

export default featureFlagsStore;
