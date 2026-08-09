import Vue from 'vue';
import featureFlagService from '@/services/featureFlag.service';

export interface FeatureFlags {
  swapEnabled: boolean;
  isGeroCardEnabled: boolean;
  isBlogEnabled: boolean;
  isPhysicalCardOrderingEnabled: boolean;
  isGoMiningEnabled: boolean;
  // Master visibility gate for the Bitcoin chain in onboarding. Default OFF: Bitcoin
  // is hidden (shown as a "Soon" teaser) until flipped ON via gero-sync — this
  // replaces the hardcoded BITCOIN_REMOVED_2_7 comment-out in networks.ts.
  isBitcoinEnabled: boolean;
  // Master gate for the daemon-free Trezor WebUSB signing path.
  isTrezorWebUsbEnabled: boolean;
  isPoolOperatorEnabled: boolean;
  isNexusWithdrawalEnabled: boolean;
  isNexusUnstakeEnabled: boolean;
  isNexusDelegateEnabled: boolean;
  isNexusVoteDelegationEnabled: boolean;
  isCrossDeviceSigningEnabled: boolean;
  isCopilotEnabled: boolean;
  // Routes Bitcoin sync through gero-sync (WS push). Default ON as of the Phase-5
  // cutover; acts as a remote KILL-SWITCH — set false to fall back to the Esplora
  // poller if the WS path misbehaves in prod. See walletManager.isBitcoinGeroSyncEnabled.
  isBitcoinGeroSyncEnabled: boolean;
  isMidnightConvertEnabled: boolean;
  isGoogleWalletEnabled: boolean;
  // Master gate for WalletConnect v2 pairing/signing. Default OFF: even with a
  // VITE_WALLETCONNECT_PROJECT_ID configured, the background skips WalletKit init
  // and the Connected dApps UI hides the WalletConnect section until flipped ON
  // via gero-sync — acts as a remote KILL-SWITCH.
  isWalletConnectEnabled: boolean;
  /**
   * Origins allowed to draw from the Nexus shared-pool collateral. A dApp must be
   * on this Gero-curated list AND already connected by the user before the wallet
   * will lend a pool UTxO to it (see background `isTrustedCollateralDapp`). Served
   * by gero-sync so the trust set can change without a client release. Empty = no
   * dApp gets pool collateral.
   *
   * Entries MUST be full origins (scheme+host+port), e.g. "https://app.minswap.org".
   * They are compared by EXACT origin equality — never substring — so a bare host
   * or a trailing-path entry will not match. Malformed entries are ignored.
   */
  collateralTrustedDapps: string[];
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
    isBitcoinEnabled: false,
    isTrezorWebUsbEnabled: false,
    isPoolOperatorEnabled: false,
    isNexusWithdrawalEnabled: false,
    isNexusUnstakeEnabled: false,
    isNexusDelegateEnabled: false,
    isNexusVoteDelegationEnabled: false,
    isCrossDeviceSigningEnabled: false,
    isCopilotEnabled: false,
    isBitcoinGeroSyncEnabled: true, // Phase-5 cutover: WS default; kill-switch to false = poller
    isMidnightConvertEnabled: false,
    isGoogleWalletEnabled: false,
    isWalletConnectEnabled: false,
    collateralTrustedDapps: [],
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
    featureFlagsState.flags.isBitcoinEnabled = featureFlagService.getFlag('isBitcoinEnabled', false);
    featureFlagsState.flags.isTrezorWebUsbEnabled = featureFlagService.getFlag('isTrezorWebUsbEnabled', false);
    featureFlagsState.flags.isPoolOperatorEnabled = featureFlagService.getFlag('isPoolOperatorEnabled', false);
    featureFlagsState.flags.isNexusWithdrawalEnabled = featureFlagService.getFlag('isNexusWithdrawalEnabled', false);
    featureFlagsState.flags.isNexusUnstakeEnabled = featureFlagService.getFlag('isNexusUnstakeEnabled', false);
    featureFlagsState.flags.isNexusDelegateEnabled = featureFlagService.getFlag('isNexusDelegateEnabled', false);
    featureFlagsState.flags.isNexusVoteDelegationEnabled = featureFlagService.getFlag('isNexusVoteDelegationEnabled', false);
    featureFlagsState.flags.isCrossDeviceSigningEnabled = featureFlagService.getFlag('isCrossDeviceSigningEnabled', false);
    featureFlagsState.flags.isCopilotEnabled = featureFlagService.getFlag('isCopilotEnabled', false);
    featureFlagsState.flags.isBitcoinGeroSyncEnabled = featureFlagService.getFlag('isBitcoinGeroSyncEnabled', true);
    featureFlagsState.flags.isMidnightConvertEnabled = featureFlagService.getFlag('isMidnightConvertEnabled', false);
    // MPC "Sign in with Google" wallet — ships DARK (default false) until the
    // recovery/sign flows have been through a security audit (see Plan D).
    featureFlagsState.flags.isGoogleWalletEnabled = featureFlagService.getFlag('isGoogleWalletEnabled', false);
    // WalletConnect ships DARK (default false); the background reads this mirror
    // to decide whether to init WalletKit at all.
    featureFlagsState.flags.isWalletConnectEnabled = featureFlagService.getFlag('isWalletConnectEnabled', false);
    featureFlagsState.flags.collateralTrustedDapps = featureFlagService.getFlag<string[]>('collateralTrustedDapps', []);
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
    featureFlagService.onFlagChange('isBitcoinEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isBitcoinEnabled', newValue);
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
    featureFlagService.onFlagChange('isNexusDelegateEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isNexusDelegateEnabled', newValue);
    });
    featureFlagService.onFlagChange('isNexusVoteDelegationEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isNexusVoteDelegationEnabled', newValue);
    });
    featureFlagService.onFlagChange('isCrossDeviceSigningEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isCrossDeviceSigningEnabled', newValue);
      // Mirror the live flip so the background picks it up on next login.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isCopilotEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isCopilotEnabled', newValue);
    });
    featureFlagService.onFlagChange('isBitcoinGeroSyncEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isBitcoinGeroSyncEnabled', newValue);
      // Mirror the live flip so the background picks it up on next login.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isMidnightConvertEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isMidnightConvertEnabled', newValue);
    });
    featureFlagService.onFlagChange('isGoogleWalletEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isGoogleWalletEnabled', newValue);
    });
    featureFlagService.onFlagChange('isWalletConnectEnabled', (newValue) => {
      Vue.set(featureFlagsState.flags, 'isWalletConnectEnabled', newValue);
      // Mirror the live flip so the background picks it up on next login/init.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('collateralTrustedDapps', (newValue) => {
      Vue.set(featureFlagsState.flags, 'collateralTrustedDapps', Array.isArray(newValue) ? newValue : []);
      // Mirror the live change so the background collateral gate picks it up.
      persistFlagsForBackground();
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
   * Whether the Bitcoin chain is visible/selectable in onboarding. Driven by the
   * gero-sync `isBitcoinEnabled` flag (default off). Replaces the hardcoded
   * BITCOIN_REMOVED_2_7 hide so BTC can be turned on without a client release.
   */
  isBitcoinEnabled(): boolean {
    return featureFlagsState.flags.isBitcoinEnabled;
  },

  /**
   * Check if Pool Operator dashboard is enabled
   */
  isPoolOperatorEnabled(): boolean {
    return featureFlagsState.flags.isPoolOperatorEnabled;
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
   * Check if stake-pool delegation should be built server-side via Nexus
   * (`/api/tx/build/delegation` + `/api/tx/build/vote-delegation`) instead of the
   * client-side @cardano-sdk builder. Software + Ledger only — Trezor stays on the
   * client builder (nexus emits combined Conway certs Trezor cannot sign).
   */
  isNexusDelegateEnabled(): boolean {
    return featureFlagsState.flags.isNexusDelegateEnabled;
  },

  /**
   * Check if governance vote (DRep) delegation should be built server-side via Nexus
   * (`/api/tx/build/vote-delegation`) instead of the client-side @cardano-sdk builder.
   * Software + Ledger only — Trezor stays on the client builder.
   */
  isNexusVoteDelegationEnabled(): boolean {
    return featureFlagsState.flags.isNexusVoteDelegationEnabled;
  },

  /**
   * Check if the cross-device signing bridge is enabled.
   * Ships DARK (default false): when off, no cross-device relay message is sent
   * and the WebSocket service behaves exactly as before.
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
   * Check if the Midnight shield/unshield Convert flow is enabled.
   * Ships DARK (default false): the shield direction is PROTOCOL-blocked at
   * ledger generation 8 - the balance check never nets Shielded(raw) against
   * Unshielded(raw), so the hand-rolled two-halves swap deterministically
   * fails node validation with error 138 BalanceCheckOverspend (verified
   * against midnight-ledger verify.rs + live on preprod, 2026-07-14). All
   * the code stays (dialog, builders, BG handlers, nexus swap-mode); flip
   * this once Midnight ships a sanctioned pool-conversion path (likely
   * contract-mediated via shielded_mints).
   */
  isMidnightConvertEnabled(): boolean {
    return featureFlagsState.flags.isMidnightConvertEnabled;
  },

  /**
   * Check if the MPC "Sign in with Google" wallet (no seed phrase) is enabled.
   * Ships DARK (default false): the onboarding method card and its routes stay
   * hidden until this is flipped, and stays testnet-only until audited.
   */
  isGoogleWalletEnabled(): boolean {
    return featureFlagsState.flags.isGoogleWalletEnabled;
  },

  /**
   * Check if WalletConnect v2 is enabled.
   * Ships DARK (default false): the background skips WalletKit init and the
   * Connected dApps UI hides the WalletConnect section until this is flipped ON,
   * so gero-sync can hold or kill WalletConnect without a client release.
   */
  isWalletConnectEnabled(): boolean {
    return featureFlagsState.flags.isWalletConnectEnabled;
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
      isBitcoinEnabled: false,
      isPoolOperatorEnabled: false,
      isNexusWithdrawalEnabled: false,
      isNexusUnstakeEnabled: false,
      isNexusDelegateEnabled: false,
      isNexusVoteDelegationEnabled: false,
      isCrossDeviceSigningEnabled: false,
      isCopilotEnabled: false,
      isBitcoinGeroSyncEnabled: true, // matches the documented default (WS on); kill-switch is explicit false
      isMidnightConvertEnabled: false,
      isGoogleWalletEnabled: false,
      isWalletConnectEnabled: false,
      collateralTrustedDapps: [],
    });
    featureFlagsState.isInitialized = false;
    featureFlagsState.isLoading = false;
  },
};

export default featureFlagsStore;
