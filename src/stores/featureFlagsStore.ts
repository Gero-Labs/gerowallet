import Vue from 'vue';
import featureFlagService from '@/services/featureFlag.service';

export interface FeatureFlags {
  swapEnabled: boolean;
  isGeroCardEnabled: boolean;
  isBlogEnabled: boolean;
  isPhysicalCardOrderingEnabled: boolean;
  isGoMiningEnabled: boolean;
  isPoolOperatorEnabled: boolean;
  isNexusWithdrawalEnabled: boolean;
  isNexusUnstakeEnabled: boolean;
  isCrossDeviceSigningEnabled: boolean;
  isCopilotEnabled: boolean;
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
    isNexusWithdrawalEnabled: false,
    isNexusUnstakeEnabled: false,
    isCrossDeviceSigningEnabled: false,
    isCopilotEnabled: false,
  },
  isInitialized: false,
  isLoading: false,
});

/**
 * Mirror flags into chrome.storage.local so the background service worker can read
 * them. featureFlagService is EventSource-based and cannot run in an MV3 service
 * worker, and featureFlagsStore is only initialized in UI contexts, so the
 * background (e.g. walletManager's cross-device bootstrap at login) reads
 * flag-gated decisions from here instead of the in-memory store.
 */
function persistFlagsForBackground(): void {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    void chrome.storage.local.set({ featureFlags: { ...featureFlagsState.flags } });
  }
}

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
    featureFlagsState.flags.isNexusWithdrawalEnabled = featureFlagService.getFlag('isNexusWithdrawalEnabled', false);
    featureFlagsState.flags.isNexusUnstakeEnabled = featureFlagService.getFlag('isNexusUnstakeEnabled', false);
    featureFlagsState.flags.isCrossDeviceSigningEnabled = featureFlagService.getFlag('isCrossDeviceSigningEnabled', false);
    featureFlagsState.flags.isCopilotEnabled = featureFlagService.getFlag('isCopilotEnabled', false);
    persistFlagsForBackground();
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
    featureFlagService.onFlagChange('isNexusWithdrawalEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isNexusWithdrawalEnabled', newValue);
    });
    featureFlagService.onFlagChange('isNexusUnstakeEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isNexusUnstakeEnabled', newValue);
    });
    featureFlagService.onFlagChange('isCrossDeviceSigningEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isCrossDeviceSigningEnabled', newValue);
      // Mirror the live flip so the background picks it up on next login.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isCopilotEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isCopilotEnabled', newValue);
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
    // Hard-pinned off for 2.7 (HIDE+GATE). Ignores remote LaunchDarkly flag.
    return false;
  },

  /**
   * Check if Pool Operator dashboard is enabled
   */
  isPoolOperatorEnabled(): boolean {
    // Hard-pinned off for 2.7 (HIDE+GATE). Ignores remote LaunchDarkly flag.
    return false;
  },

  /**
   * Check if reward withdrawals should be built server-side via Nexus
   * (`/api/tx/build/withdrawal`) instead of the client-side @cardano-sdk builder.
   */
  isNexusWithdrawalEnabled(): boolean {
    return featureFlagsState.flags.isNexusWithdrawalEnabled;
  },

  /**
   * Check if stake deregistration (unstake) should be built server-side via Nexus
   * (`/api/tx/build/stake-registration`) instead of the client-side @cardano-sdk builder.
   */
  isNexusUnstakeEnabled(): boolean {
    return featureFlagsState.flags.isNexusUnstakeEnabled;
  },

  /**
   * Check if the cross-device signing bridge is enabled.
   * Ships DARK (default false): when off, no cross-device relay message is sent
   * and the WebSocket service behaves exactly as before. See
   * docs/plans/2026-06-29-cross-device-signing-bridge.md.
   */
  isCrossDeviceSigningEnabled(): boolean {
    return featureFlagsState.flags.isCrossDeviceSigningEnabled;
  },

  /**
   * Check if the Gero Copilot agent (chat dock + proactive feed) is enabled.
   * Ships DARK (default false): when off, the AgentDock is not mounted and the
   * feed routes / nav entries are hidden on both the dashboard and mini-gero, so
   * gero-sync can hold or kill the whole agent without a client release.
   */
  isCopilotEnabled(): boolean {
    return featureFlagsState.flags.isCopilotEnabled;
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
      isNexusWithdrawalEnabled: false,
      isNexusUnstakeEnabled: false,
      isCrossDeviceSigningEnabled: false,
      isCopilotEnabled: false,
    });
    featureFlagsState.isInitialized = false;
    featureFlagsState.isLoading = false;
  },
};

export default featureFlagsStore;
