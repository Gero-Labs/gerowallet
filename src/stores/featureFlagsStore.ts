import { plainStoreSnapshot } from '@/stores/serialization';
import { writeFeatureFlagMirror } from '@/shared/utils/featureFlagMirror';
import { reactive } from 'vue';
import featureFlagService from '@/services/featureFlag.service';

// Build-time default for the CIP-45 flag (dev/test only); a flag-service value still wins.
const CIP45_DEFAULT_ENABLED =
  (import.meta as { env?: Record<string, unknown> }).env?.['VITE_CIP45_DEFAULT_ENABLED'] === 'true';

export interface FeatureFlags {
  swapEnabled: boolean;
  isGeroCardEnabled: boolean;
  isBlogEnabled: boolean;
  isHelpCenterEnabled: boolean;
  isPhysicalCardOrderingEnabled: boolean;
  isGoMiningEnabled: boolean;
  // Master visibility gate for the Bitcoin chain in onboarding. Default OFF: Bitcoin
  // is hidden (shown as a "Soon" teaser) until flipped ON via gero-sync — this
  // replaces the hardcoded BITCOIN_REMOVED_2_7 comment-out in networks.ts.
  isBitcoinEnabled: boolean;
  // Master gate for the Solana chain (src/chains/solana, Nexus /api/sol, Gero Sync SOLANA).
  // Default OFF: nothing Solana is reachable until it is flipped ON via gero-sync.
  isSolanaEnabled: boolean;
  // Master gate for the daemon-free Trezor WebUSB signing path.
  isTrezorWebUsbEnabled: boolean;
  isPoolOperatorEnabled: boolean;
  // Master gate for the Cardano on-chain governance surface (CIP-1694): the
  // /governance route, its nav item and the global-search DRep results. Default
  // OFF and ships dark. Network support is a SEPARATE gate —
  // `networks.resolveGovernanceSupport` — so both must pass before the route or
  // the nav item appears.
  isGovernanceEnabled: boolean;
  // Signing gate for official DRep votes and advisory CIP-0204 holder answers.
  // Default OFF and ships dark, SEPARATELY from `isGovernanceEnabled`: voting is a
  // value-moving surface (signed, irreversible on-chain statements), so the read
  // surface can go live while vote casting is still being verified on preprod.
  // Callers must AND it with `isGovernanceEnabled` — a vote affordance only makes
  // sense on a visible governance surface.
  isGovernanceVotingEnabled: boolean;
  // Master gate for the RealFi Earn surface (USDr / sUSDr yield). Default OFF and
  // ships dark: RealFi is a value-moving surface, so it is enabled deliberately via
  // gero-sync, never by a flag-service outage. Network support is a SEPARATE gate —
  // `networks.resolveRealFiSupport` currently returns true for Cardano preprod only —
  // so both must pass before the route or the nav item appears.
  isRealFiEnabled: boolean;
  // Staking, unstaking, claiming and cancelling from inside Gero (orders built by
  // Nexus, signed here). Default OFF: without it the Earn page hands transacting to
  // RealFi's own app. Only meaningful with `isRealFiEnabled` on.
  isRealFiStakingEnabled: boolean;
  // The Earn page's in-wallet USDCx → USDrf swap. Default OFF: the only route is the
  // SundaeSwap V4 pool, which the aggregator serves only once V4 is promoted. Until then
  // the swap would open with no route.
  isRealFiUsdrfSwapEnabled: boolean;
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
  // Gate for the non-custodial live support chat (Chatwoot). Default OFF. The UI
  // that owns the support entry point checks this before offering the feature;
  // the chat plumbing itself is inert until something calls into it, so hiding
  // the entry point is what holds or kills the feature without a client release.
  //
  // MOUNTS THE DOCK ON ITS OWN: the Agent Dock ("Gero Companion") is mounted by
  // both options/App.vue and sidepanel/App.vue behind
  // `isCopilotEnabled() || isLiveChatEnabled()`, so this flag alone is enough to
  // bring the dock up as a support-only Companion (the Assistant toggle segment
  // renders visible but disabled until isCopilotEnabled also flips on).
  isLiveChatEnabled: boolean;
  // Master gate for WalletConnect v2 pairing/signing. Default OFF: even with a
  // VITE_WALLETCONNECT_PROJECT_ID configured, the background skips WalletKit init
  // and the Connected dApps UI hides the WalletConnect section until flipped ON
  // via gero-sync — acts as a remote KILL-SWITCH.
  isWalletConnectEnabled: boolean;
  // Master gate for the CIP-45 (WebRTC dApp bridge) pairing/signing surface.
  // Default OFF: the peerjs signaling connection and the Connected dApps CIP-45
  // section stay dark until flipped ON via gero-sync — acts as a remote
  // KILL-SWITCH, mirroring isWalletConnectEnabled.
  isCip45Enabled: boolean;
  // Submit API (Settings → Advanced). Default OFF, ships dark. Gates the UI ONLY: the
  // background router honours a saved endpoint whatever this says, because a remote
  // flip must never reroute a privacy user's transactions to Gero.
  isSubmitApiEnabled: boolean;
  // Midnight private (shielded) sends proven on this device in Gero Cloud mode.
  // Default OFF, ships dark: a decision for Adam and the CTO. Off, a private send
  // proves on Gero Cloud (its consent names the coin secret key); on, it proves
  // here (Zswap proofs: 30-70 s on a fast laptop) and Gero receives no secret.
  // Public sends prove their DUST fee on this device either way.
  isMidnightShieldedDeviceProvingEnabled: boolean;
  // Gero Prover: Midnight proofs made by a desktop helper app on this computer (native, all
  // cores, the graphics processor where it has a backend) instead of the WASM prover in the
  // browser. Default OFF, ships dark: the helper and its upstream provers are unaudited. Off,
  // the Proof server page and the send dialogs are exactly as before, and a stored choice of
  // the helper reads as the Docker proof server (walletProverFor). The flag never loosens a
  // check: the helper is used only when the user also chose it and allowed the browser to
  // talk to it (midnightProvingFlags.ts).
  isGeroProverEnabled: boolean;
  // Midnight proofs in the browser on several processor threads: a multi-threaded build of the
  // same zkir prover (midnightZkirThreads.ts), used when the browser can run it and its files
  // match their pins, else the standard build. Also offers "In this browser" under Proof server →
  // This computer, where every proof of a send, private ones included, is made in the browser.
  // Default OFF, ships dark: the threaded build is upstream demo-grade code and is not approved
  // to ship. A speed setting, not a trust decision: both builds are the same prover with the
  // same pinned keys.
  isMidnightThreadedProvingEnabled: boolean;
  // CIP-113 Send (Gero's own transfer of a programmable token). Default OFF, ships dark.
  // Gates the UI ONLY: the Send action on a CIP-113 token. Display, the signing refusals and
  // the background's checks stay on the build-time network gates (cip113Deployments.ts).
  isCip113Enabled: boolean;
  // Gero pays the DUST fee of a Midnight send for a wallet whose Cardano twin stakes ADA
  // (fee station, midnightStation.ts). Default OFF, ships dark. Gates the UI ONLY: the
  // "Gero covers this fee" row on the send screens. The worker is held by the build-time
  // network list (midnightStationConfig.ts) and the server by its own switch.
  isMidnightSponsoredFeesEnabled: boolean;
  // NFT rescue (cancelling listings and offers stuck at a closed marketplace's contracts,
  // Cardano mainnet). Default OFF, ships dark. Gates the UI ONLY: the card that finds them
  // and the cancel action. The background still verifies every transaction it signs.
  isNftMarketEnabled: boolean;
  // Multi-account (issue 1307). Default OFF, ships dark. Gates the UI ONLY: the
  // Choose accounts step, Add account and the account switchers. A record already
  // holding an account other than #0 keeps signing for it whatever this says.
  isMultiAccountEnabled: boolean;
  // GeroVault (multisig vaults): the /vaults routes and the Vaults navigation item.
  // Default OFF, ships dark. Gates the UI ONLY; nothing in the background reads it.
  isVaultsEnabled: boolean;
  // Gero Card "Complete your cardholder details" step. Default ON and a remote KILL-SWITCH:
  // false skips Zione's cardholder-details endpoints, and an order refused for missing
  // details then points the user to Zione support. Only an explicit false turns it off.
  isCardholderDetailsEnabled: boolean;
  // Broadcast announcements in the UI (bell section, snackbar, banner, dialog). Default ON and a
  // remote KILL-SWITCH: only an explicit false hides them. UI-only: the worker keeps fetching and
  // verifying, and what it shows from a push is the server operator's to stop.
  isAnnouncementsEnabled: boolean;
  // Default OFF and ships dark. Kill switch for WRITING the gpw2 secret envelope
  // and for the on-unlock migration to it. Every release since the reader-only one
  // opens gpw2, so turning this off only stops new gpw2 writes. Read by the
  // background and the UI through the chrome.storage mirror; see
  // src/shared/utils/envelopeV2Flag.ts.
  isKeyEnvelopeV2Enabled: boolean;
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

const featureFlagsState = reactive<FeatureFlagsState>({
  flags: {
    swapEnabled: false,
    isGeroCardEnabled: false,
    isBlogEnabled: false,
    isHelpCenterEnabled: false,
    isPhysicalCardOrderingEnabled: false,
    isGoMiningEnabled: false,
    isBitcoinEnabled: false,
    isSolanaEnabled: false,
    isTrezorWebUsbEnabled: false,
    isPoolOperatorEnabled: false,
    isGovernanceEnabled: false,
    isGovernanceVotingEnabled: false,
    isRealFiEnabled: false,
    isRealFiStakingEnabled: false,
    isRealFiUsdrfSwapEnabled: false,
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
    isCip45Enabled: CIP45_DEFAULT_ENABLED,
    isLiveChatEnabled: false,
    isSubmitApiEnabled: false,
    isMidnightShieldedDeviceProvingEnabled: false,
    isGeroProverEnabled: false,
    isMidnightThreadedProvingEnabled: false,
    isCip113Enabled: false,
    isMidnightSponsoredFeesEnabled: false,
    isNftMarketEnabled: false,
    isMultiAccountEnabled: false,
    isVaultsEnabled: false,
    isCardholderDetailsEnabled: true,
    isAnnouncementsEnabled: true,
    isKeyEnvelopeV2Enabled: false,
    collateralTrustedDapps: [],
  },
  isInitialized: false,
  isLoading: false,
});

/**
 * Mirror flags for the background service worker (featureFlagMirror.ts).
 * featureFlagService is EventSource-based and cannot run in an MV3 service
 * worker, and featureFlagsStore is only initialized in UI contexts, so the
 * background (e.g. walletManager's cross-device bootstrap at login) reads
 * flag-gated decisions from the mirror instead of the in-memory store.
 */
function persistFlagsForBackground(): void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    void writeFeatureFlagMirror(plainStoreSnapshot({ ...featureFlagsState.flags })).catch(() => {});
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
      // After a failed first fetch the service keeps retrying (issue 1195):
      // load the real values once it gets them.
      if (!featureFlagService.isReady()) featureFlagService.onReady(() => this.loadFlags());
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
    featureFlagsState.flags.isHelpCenterEnabled = featureFlagService.getFlag('isHelpCenterEnabled', false);
    featureFlagsState.flags.isPhysicalCardOrderingEnabled = featureFlagService.getFlag('isPhysicalCardOrderingEnabled', false);
    featureFlagsState.flags.isGoMiningEnabled = featureFlagService.getFlag('isGoMiningEnabled', false);
    featureFlagsState.flags.isBitcoinEnabled = featureFlagService.getFlag('isBitcoinEnabled', false);
    featureFlagsState.flags.isSolanaEnabled = featureFlagService.getFlag('isSolanaEnabled', false);
    featureFlagsState.flags.isTrezorWebUsbEnabled = featureFlagService.getFlag('isTrezorWebUsbEnabled', false);
    featureFlagsState.flags.isPoolOperatorEnabled = featureFlagService.getFlag('isPoolOperatorEnabled', false);
    featureFlagsState.flags.isGovernanceEnabled = featureFlagService.getFlag('isGovernanceEnabled', false);
    featureFlagsState.flags.isGovernanceVotingEnabled = featureFlagService.getFlag('isGovernanceVotingEnabled', false);
    featureFlagsState.flags.isRealFiEnabled = featureFlagService.getFlag('isRealFiEnabled', false);
    featureFlagsState.flags.isRealFiStakingEnabled = featureFlagService.getFlag('isRealFiStakingEnabled', false);
    featureFlagsState.flags.isRealFiUsdrfSwapEnabled = featureFlagService.getFlag('isRealFiUsdrfSwapEnabled', false);
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
    // CIP-45 ships DARK (default false); mirrors isWalletConnectEnabled's gating pattern.
    featureFlagsState.flags.isCip45Enabled = featureFlagService.getFlag('isCip45Enabled', CIP45_DEFAULT_ENABLED);
    // Live support chat ships DARK (default false) until the Chatwoot inbox is staffed.
    featureFlagsState.flags.isLiveChatEnabled = featureFlagService.getFlag('isLiveChatEnabled', false);
    // Submit API ships DARK (default false); UI-only gate for the Settings dialog.
    featureFlagsState.flags.isSubmitApiEnabled = featureFlagService.getFlag('isSubmitApiEnabled', false);
    // Shielded on-device proving ships DARK (default false).
    featureFlagsState.flags.isMidnightShieldedDeviceProvingEnabled = featureFlagService.getFlag('isMidnightShieldedDeviceProvingEnabled', false);
    // Gero Prover ships DARK (default false).
    featureFlagsState.flags.isGeroProverEnabled = featureFlagService.getFlag('isGeroProverEnabled', false);
    // Threaded browser proving ships DARK (default false).
    featureFlagsState.flags.isMidnightThreadedProvingEnabled = featureFlagService.getFlag('isMidnightThreadedProvingEnabled', false);
    // CIP-113 Send ships DARK (default false); UI-only gate for the Send action.
    featureFlagsState.flags.isCip113Enabled = featureFlagService.getFlag('isCip113Enabled', false);
    // Station-paid Midnight fees ship DARK (default false); UI-only gate.
    featureFlagsState.flags.isMidnightSponsoredFeesEnabled = featureFlagService.getFlag('isMidnightSponsoredFeesEnabled', false);
    // NFT rescue ships DARK (default false); UI-only gate for the stuck-listings card.
    featureFlagsState.flags.isNftMarketEnabled = featureFlagService.getFlag('isNftMarketEnabled', false);
    // Multi-account ships DARK (default false); UI-only gate.
    featureFlagsState.flags.isMultiAccountEnabled = featureFlagService.getFlag('isMultiAccountEnabled', false);
    // GeroVault ships DARK (default false); UI-only gate for the routes and the nav item.
    featureFlagsState.flags.isVaultsEnabled = featureFlagService.getFlag('isVaultsEnabled', false);
    // Cardholder-details step ships ON; only an explicit false from the service turns it off.
    featureFlagsState.flags.isCardholderDetailsEnabled =
      featureFlagService.getFlag<boolean>('isCardholderDetailsEnabled', true) !== false;
    // Announcements ship ON; only an explicit false from the service hides them.
    featureFlagsState.flags.isAnnouncementsEnabled =
      featureFlagService.getFlag<boolean>('isAnnouncementsEnabled', true) !== false;
    // gpw2 writer + migration ships DARK; writers read this mirror before each write.
    featureFlagsState.flags.isKeyEnvelopeV2Enabled = featureFlagService.getFlag('isKeyEnvelopeV2Enabled', false);
    featureFlagsState.flags.collateralTrustedDapps = featureFlagService.getFlag<string[]>('collateralTrustedDapps', []);
    // Fallbacks (the service has no flags yet) would overwrite the background's
    // last known values with all-off; mirror only flags the server sent.
    if (featureFlagService.isReady()) persistFlagsForBackground();
  },

  /**
   * Subscribe to flag changes in real-time.
   */
  subscribeToFlagChanges(): void {
    featureFlagService.onFlagChange('isSwapEnabled', (newValue) => {
      featureFlagsState.flags['swapEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isGeroCardEnabled', (newValue) => {
      featureFlagsState.flags['isGeroCardEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isHelpCenterEnabled', (value) => {
      featureFlagsState.flags['isHelpCenterEnabled'] = value === true;
    });
    featureFlagService.onFlagChange('isBlogEnabled', (newValue) => {
      featureFlagsState.flags['isBlogEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isPhysicalCardOrderingEnabled', (newValue) => {
      featureFlagsState.flags['isPhysicalCardOrderingEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isGoMiningEnabled', (newValue) => {
      featureFlagsState.flags['isGoMiningEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isBitcoinEnabled', (newValue) => {
      featureFlagsState.flags['isBitcoinEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isSolanaEnabled', (newValue) => {
      featureFlagsState.flags['isSolanaEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isPoolOperatorEnabled', (newValue) => {
      featureFlagsState.flags['isPoolOperatorEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isGovernanceEnabled', (newValue) => {
      featureFlagsState.flags['isGovernanceEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isGovernanceVotingEnabled', (newValue) => {
      featureFlagsState.flags['isGovernanceVotingEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isRealFiEnabled', (newValue) => {
      featureFlagsState.flags['isRealFiEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isRealFiStakingEnabled', (newValue) => {
      featureFlagsState.flags['isRealFiStakingEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isRealFiUsdrfSwapEnabled', (newValue) => {
      featureFlagsState.flags['isRealFiUsdrfSwapEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isNexusWithdrawalEnabled', (newValue) => {
      featureFlagsState.flags['isNexusWithdrawalEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isNexusUnstakeEnabled', (newValue) => {
      featureFlagsState.flags['isNexusUnstakeEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isNexusDelegateEnabled', (newValue) => {
      featureFlagsState.flags['isNexusDelegateEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isNexusVoteDelegationEnabled', (newValue) => {
      featureFlagsState.flags['isNexusVoteDelegationEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isCrossDeviceSigningEnabled', (newValue) => {
      featureFlagsState.flags['isCrossDeviceSigningEnabled'] = newValue === true;
      // Mirror the live flip so the background picks it up on next login.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isCopilotEnabled', (newValue) => {
      featureFlagsState.flags['isCopilotEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isBitcoinGeroSyncEnabled', (newValue) => {
      featureFlagsState.flags['isBitcoinGeroSyncEnabled'] = newValue === true;
      // Mirror the live flip so the background picks it up on next login.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isMidnightConvertEnabled', (newValue) => {
      featureFlagsState.flags['isMidnightConvertEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isGoogleWalletEnabled', (newValue) => {
      featureFlagsState.flags['isGoogleWalletEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isWalletConnectEnabled', (newValue) => {
      featureFlagsState.flags['isWalletConnectEnabled'] = newValue === true;
      // Mirror the live flip so the background picks it up on next login/init.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isCip45Enabled', (newValue) => {
      featureFlagsState.flags['isCip45Enabled'] = newValue === true;
      // Mirror the live flip so the background picks it up on next login/init.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('isLiveChatEnabled', (newValue) => {
      featureFlagsState.flags['isLiveChatEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isSubmitApiEnabled', (newValue) => {
      featureFlagsState.flags['isSubmitApiEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isMidnightShieldedDeviceProvingEnabled', (newValue) => {
      featureFlagsState.flags['isMidnightShieldedDeviceProvingEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isGeroProverEnabled', (newValue) => {
      featureFlagsState.flags['isGeroProverEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isMidnightThreadedProvingEnabled', (newValue) => {
      featureFlagsState.flags['isMidnightThreadedProvingEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isCip113Enabled', (newValue) => {
      featureFlagsState.flags['isCip113Enabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isMidnightSponsoredFeesEnabled', (newValue) => {
      featureFlagsState.flags['isMidnightSponsoredFeesEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isNftMarketEnabled', (newValue) => {
      featureFlagsState.flags['isNftMarketEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isMultiAccountEnabled', (newValue) => {
      featureFlagsState.flags['isMultiAccountEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isVaultsEnabled', (newValue) => {
      featureFlagsState.flags['isVaultsEnabled'] = newValue === true;
    });
    featureFlagService.onFlagChange('isCardholderDetailsEnabled', (newValue) => {
      featureFlagsState.flags['isCardholderDetailsEnabled'] = newValue !== false;
    });
    featureFlagService.onFlagChange('isAnnouncementsEnabled', (newValue) => {
      featureFlagsState.flags['isAnnouncementsEnabled'] = newValue !== false;
    });
    featureFlagService.onFlagChange('isKeyEnvelopeV2Enabled', (newValue) => {
      featureFlagsState.flags['isKeyEnvelopeV2Enabled'] = newValue === true;
      // Mirror the live flip (on or off) so writers and the migration see it immediately.
      persistFlagsForBackground();
    });
    featureFlagService.onFlagChange('collateralTrustedDapps', (newValue) => {
      featureFlagsState.flags['collateralTrustedDapps'] = Array.isArray(newValue) ? newValue : [];
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

  /** Dashboard discovery and Blog-index migration only; public Help is always routable. */
  isHelpCenterEnabled(): boolean {
    return featureFlagsState.isInitialized && featureFlagsState.flags.isHelpCenterEnabled;
  },

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
   * Check if GoMining integration is enabled. Driven by the gero-sync
   * `isGoMiningEnabled` flag (default off); the Bitcoin pages also need
   * `isBitcoinEnabled`.
   */
  isGoMiningEnabled(): boolean {
    return featureFlagsState.flags.isGoMiningEnabled;
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
   * Whether the Solana chain is available. Driven by the gero-sync `isSolanaEnabled`
   * flag (default off), so Solana can ship dark and be turned on without a release.
   */
  isSolanaEnabled(): boolean {
    return featureFlagsState.flags.isSolanaEnabled;
  },

  /**
   * Check if Pool Operator dashboard is enabled
   */
  isPoolOperatorEnabled(): boolean {
    return featureFlagsState.flags.isPoolOperatorEnabled;
  },

  /**
   * Whether the Cardano governance surface is enabled.
   *
   * This is only the MASTER gate. Callers must AND it with
   * `networks.resolveGovernanceSupport(chain, network)` — see router.ts,
   * NavigationDrawer.vue and useGlobalSearch.ts, which all apply both.
   */
  isGovernanceEnabled(): boolean {
    return featureFlagsState.flags.isGovernanceEnabled;
  },

  /**
   * Whether CASTING governance votes is enabled — the CastVoteDialog and the
   * VoteCta on the action detail. Ships DARK (default false), separately from
   * {@link isGovernanceEnabled}: voting is a value-moving surface (a vote is a
   * signed, irreversible on-chain statement), so the read surface can go live
   * while vote casting is still being verified. Callers must AND this with
   * `isGovernanceEnabled` — the vote affordance only exists on a visible
   * governance surface.
   */
  isGovernanceVotingEnabled(): boolean {
    return featureFlagsState.flags.isGovernanceVotingEnabled;
  },

  /**
   * Check if the RealFi Earn surface is enabled.
   *
   * This is only the MASTER gate. Callers must AND it with
   * `networks.resolveRealFiSupport(chain, network)` — the flag says "the feature is
   * live", the network resolver says "this wallet's chain/network can reach it"
   * (Cardano preprod only today). The router dual-gates on both, matching the
   * NavigationDrawer item's own `enabled` condition.
   */
  isRealFiEnabled(): boolean {
    return featureFlagsState.flags.isRealFiEnabled;
  },

  /** In-wallet RealFi orders. Callers AND it with `isRealFiEnabled`. */
  isRealFiStakingEnabled(): boolean {
    return featureFlagsState.flags.isRealFiStakingEnabled;
  },

  /** In-wallet USDCx → USDrf swap on the Earn page; off until SundaeSwap V4 is promoted. */
  isRealFiUsdrfSwapEnabled(): boolean {
    return featureFlagsState.flags.isRealFiUsdrfSwapEnabled;
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
   * Check if the Gero Companion Assistant (AI chat + proactive feed) is enabled.
   * Ships DARK (default false). The Agent Dock ("Gero Companion") itself mounts
   * whenever EITHER this flag OR {@link isLiveChatEnabled} is on — see
   * options/App.vue and sidepanel/App.vue. With this flag off and live chat on,
   * the dock still mounts, support-only: the Assistant toggle segment renders
   * visible but disabled. With this flag on, the Assistant segment is enabled
   * (and, when live chat is off, the dock falls back to the legacy copilot-only
   * experience). The feed routes / nav entries on the dashboard and mini-gero
   * stay gated on this flag alone.
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
   * Check if CIP-45 (WebRTC dApp bridge) pairing/signing is enabled.
   * Ships DARK (default false), mirroring {@link isWalletConnectEnabled}: the
   * peerjs signaling connection stays uninitialized and the Connected dApps UI
   * hides the CIP-45 section until this is flipped ON, so gero-sync can hold or
   * kill CIP-45 without a client release.
   */
  isCip45Enabled(): boolean {
    return featureFlagsState.flags.isCip45Enabled;
  },

  /**
   * Check if the non-custodial live support chat is enabled.
   * Ships DARK (default false). The caller is the UI that renders the support
   * entry point: while it is hidden nothing calls the chat composable, so no
   * Chatwoot or Nexus traffic is generated. Lets gero-sync hold or kill live chat
   * without a client release.
   *
   * SUFFICIENT ON ITS OWN to mount the Agent Dock ("Gero Companion") — both
   * options/App.vue and sidepanel/App.vue mount it behind
   * `isCopilotEnabled() || isLiveChatEnabled()`. With {@link isCopilotEnabled}
   * off, that dock is support-only: it opens straight into Support and the
   * Assistant toggle segment renders visible but disabled. Flipping
   * isCopilotEnabled on as well enables the Assistant segment for that dock.
   */
  isLiveChatEnabled(): boolean {
    return featureFlagsState.flags.isLiveChatEnabled;
  },

  /**
   * Check if the Submit API setting is enabled.
   * Ships DARK (default false). Gates the UI only; the background router
   * honours a saved endpoint whatever this says.
   */
  isSubmitApiEnabled(): boolean {
    return featureFlagsState.flags.isSubmitApiEnabled;
  },

  /**
   * Prove Midnight private (shielded) sends on this device in Gero Cloud mode.
   * Ships DARK (default false); see the flag's declaration.
   */
  isMidnightShieldedDeviceProvingEnabled(): boolean {
    return featureFlagsState.flags.isMidnightShieldedDeviceProvingEnabled;
  },

  /**
   * Offer Gero Prover, the desktop helper that makes Midnight proofs on this
   * computer. Ships DARK (default false); see the flag's declaration.
   */
  isGeroProverEnabled(): boolean {
    return featureFlagsState.flags.isGeroProverEnabled;
  },

  /**
   * Prove in the browser on several processor threads, and offer "In this
   * browser" as a way to prove on this computer. Ships DARK (default false);
   * see the flag's declaration.
   */
  isMidnightThreadedProvingEnabled(): boolean {
    return featureFlagsState.flags.isMidnightThreadedProvingEnabled;
  },

  /** Gero Card cardholder-details step; on unless the flag service says false. */
  isCardholderDetailsEnabled(): boolean {
    return featureFlagsState.flags.isCardholderDetailsEnabled;
  },

  /**
   * Check if Gero's own Send of a CIP-113 programmable token is offered.
   * Ships DARK (default false). Gates the UI only; Send also needs a network
   * whose transfer scripts are configured (networks.resolveCip113TransferScripts).
   */
  isCip113Enabled(): boolean {
    return featureFlagsState.flags.isCip113Enabled;
  },

  /**
   * Whether the send screens offer Gero's fee station (Gero pays the DUST fee
   * for an ADA staker). Ships DARK (default false). Gates the UI only; the
   * offer also needs a network in MIDNIGHT_STATION_NETWORKS.
   */
  isMidnightSponsoredFeesEnabled(): boolean {
    return featureFlagsState.flags.isMidnightSponsoredFeesEnabled;
  },

  /**
   * Check if the NFT rescue is offered: finding listings and offers stuck at a closed
   * marketplace's contracts and cancelling them (Cardano mainnet only).
   * Ships DARK (default false). Gates the UI only; the background verifies every
   * transaction it signs whatever this says.
   */
  isNftMarketEnabled(): boolean {
    return featureFlagsState.flags.isNftMarketEnabled;
  },

  /**
   * Check if broadcast announcements are shown (the bell's "From Gero" rows, the snackbar, the
   * banner, the dialog and their settings). Default ON: a kill switch, off only on an explicit
   * `false`. Gates the UI only; the background keeps fetching and verifying whatever this says.
   */
  isAnnouncementsEnabled(): boolean {
    return featureFlagsState.flags.isAnnouncementsEnabled;
  },

  /**
   * Check if multi-account (accounts #1..N of one device) is enabled.
   * Ships DARK (default false). Gates the UI only.
   */
  isMultiAccountEnabled(): boolean {
    return featureFlagsState.flags.isMultiAccountEnabled;
  },

  /**
   * Check if GeroVault (multisig vaults) is offered: the /vaults routes and the
   * Vaults navigation item. Ships DARK (default false). Gates the UI only.
   */
  isVaultsEnabled(): boolean {
    return featureFlagsState.flags.isVaultsEnabled;
  },

  /**
   * Reset flags (disable all until re-initialized).
   */
  reset(): void {
    featureFlagsState.flags = {
      swapEnabled: false,
      isTrezorWebUsbEnabled: false,
      isGeroCardEnabled: false,
      isBlogEnabled: false,
      isHelpCenterEnabled: false,
      isPhysicalCardOrderingEnabled: false,
      isGoMiningEnabled: false,
      isBitcoinEnabled: false,
      isSolanaEnabled: false,
      isPoolOperatorEnabled: false,
      isGovernanceEnabled: false,
      isGovernanceVotingEnabled: false,
      isRealFiEnabled: false,
      isRealFiStakingEnabled: false,
      isRealFiUsdrfSwapEnabled: false,
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
      isCip45Enabled: CIP45_DEFAULT_ENABLED,
      isLiveChatEnabled: false,
      isSubmitApiEnabled: false,
      isMidnightShieldedDeviceProvingEnabled: false,
    isGeroProverEnabled: false,
    isMidnightThreadedProvingEnabled: false,
      isCip113Enabled: false,
      isMidnightSponsoredFeesEnabled: false,
      isNftMarketEnabled: false,
      isMultiAccountEnabled: false,
      isVaultsEnabled: false,
      isCardholderDetailsEnabled: true,
      isAnnouncementsEnabled: true,
      isKeyEnvelopeV2Enabled: false,
      collateralTrustedDapps: [],
    };
    featureFlagsState.isInitialized = false;
    featureFlagsState.isLoading = false;
  },
};

export default featureFlagsStore;
