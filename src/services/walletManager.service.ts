import { WalletBg, alarmListener } from '@/chrome/walletBg';
import LoadingState from '@/stores/loading';
import WalletStore, { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType, Wallet } from '@/models/types';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import TapToolsStore from '@/stores/tapToolsStore';
import webSocketService, { type WsSyncMessage } from '@/services/websocket.service';
import { Mutex, withTimeout } from 'async-mutex';
import { clearDbCache } from '@/db/wallet-db';
import MusicStore from '@/stores/musicStore';
import NetworkStore from '@/stores/networkStore';
import { debugLog } from '@/utils/debug';
import { Cardano } from '@cardano-sdk/core';
import zkSmartWalletApi from '@/api/zkSmartWalletApi';
import { bootstrapCrossDeviceSigning } from '@/services/crossDevice/crossDeviceBootstrap';
import type { CrossDeviceSigning } from '@/services/crossDevice/crossDeviceSigning.service';
import {
  loadRemoteSigningSettings,
  saveRemoteSigningSettings,
} from '@/services/crossDevice/crossDeviceSettings';
import {
  loadOrCreateDeviceIdentity,
  type StoredDeviceIdentity,
} from '@/services/crossDevice/deviceIdentityStore';
import { isDeviceIdConsistent } from '@/services/crossDevice/deviceIdentity';
import { verifyDeviceRegisterProof, buildDeviceRegisterSubject } from '@/services/crossDevice/registerProof';
import { loadDeviceRegisterProof, saveDeviceRegisterProof } from '@/services/crossDevice/deviceProofStore';
import { mintPairingNonce, consumePairingNonce, peekPairingNonce } from '@/services/crossDevice/pairingNonceStore';
import { buildPairingQrPayload, type PairingQrPayload } from '@/services/crossDevice/pairingQr';
import type { DeviceRegisterProof, PairConfirm } from '@/services/crossDevice/protocol';
import {
  defaultRemoteSigningSettings,
  isDeviceTrusted,
  setEnabled as trustSetEnabled,
  setPolicy as trustSetPolicy,
  trustDevice as trustAddDevice,
  untrustDevice as trustRemoveDevice,
  soleSignerDeviceId,
  REQUIRE_PROOF_TO_PAIR,
  type RemoteSigningSettings,
  type SigningPolicy,
} from '@/services/crossDevice/crossDeviceTrust';
import type { DeviceInfo } from '@/services/crossDevice/protocol';
import { mpcSessionCache } from '@/chrome/mpcSessionCache';
import { mpcLoginShareCache } from '@/chrome/mpcLoginShareCache';

/**
 * WalletManager service to handle wallet login/logout and lifecycle management
 * Provides centralized management of wallet instances with proper cleanup
 */
export class WalletManager {
  private static instance: WalletManager;
  private walletBg: WalletBg | null = null;
  private currentWalletId: number | null = null;
  private pendingSyncPromise: Promise<void> | null = null;
  // Cross-device signing bridge handles (null unless the feature flag is on).
  private crossDevice: ReturnType<typeof bootstrapCrossDeviceSigning> = null;
  // Per-wallet remote-signing settings (trust list + policy), loaded on login.
  // The bootstrap's trust predicates read this live, so trust/untrust/policy
  // changes take effect without a re-bootstrap.
  private remoteSigning: RemoteSigningSettings = defaultRemoteSigningSettings();
  // Stable relay-auth identity for this browser install (persisted), so pins made
  // by a sibling device survive a re-login instead of churning every session.
  private crossDeviceIdentity: StoredDeviceIdentity | null = null;
  // Cached wallet-control proof for the CURRENT wallet, produced once at enable
  // time (needs auth) and re-sent on every DEVICE_REGISTER via getProof.
  private crossDeviceProof: DeviceRegisterProof | null = null;
  // Last device paired via QR scan, for the settings dialog's success poll. Set by
  // handlePairConfirm on a successful pin; cleared on read (getPairingStatus) so a
  // reopen never re-fires a stale success.
  private lastPairedDevice: { deviceId: string; label: string; at: number } | null = null;

  // Mutex declarations for sync operations
  public tipMutex = withTimeout(new Mutex(), 2 * 60_000);
  // public syncMutex = withTimeout(new Mutex(), 2 * 60_000);

  private constructor() {}

  /**
   * Get a singleton instance of WalletManager
   */
  static getInstance(): WalletManager {
    if (!WalletManager.instance) {
      WalletManager.instance = new WalletManager();
    }
    return WalletManager.instance;
  }

  /**
   * Get the current wallet background instance
   * @returns WalletBg instance or null if not logged in
   */
  getWalletBg(): WalletBg | null {
    return this.walletBg;
  }

  /**
   * Login and Restore with a wallet
   * @param wallet - Wallet data to login with
   * @returns WalletBg instance or null if failed
   */
  async restore(wallet): Promise<WalletBg | null> {
    debugLog('WalletManager: Starting restore process');
    LoadingState.setText('Restoring wallet instance...');
    LoadingState.setLoading(true);

    try {
      // Clean up an existing wallet if different. On a SWITCH, only clear the
      // outgoing wallet's MPC caches (logout(false)) — the incoming wallet's key
      // may already be reconstructed (auth-then-switch) and must survive.
      if (this.walletBg && this.currentWalletId !== wallet.id) {
        await this.logout(false);
      }

      // Create a new wallet instance if needed
      if (!this.walletBg || this.currentWalletId !== wallet.id) {
        debugLog('Creating new WalletBg instance for wallet:', wallet.id);

        // Clear wallet store data immediately to prevent cross-wallet contamination
        WalletStore.clearForWalletSwitch();
        TapToolsStore.clear();

        const walletBg: WalletBg = new WalletBg(wallet);
        WalletStore.setLoggedWallet({
          id: walletBg.id,
          name: walletBg.name,
          icon: walletBg.icon,
          type: walletBg.type,
          theme: walletBg.theme,
          order: walletBg.order,
          chain: walletBg.chain,
          network: walletBg.network,
          publicKey: walletBg.publicKey,
          provider: walletBg.provider,
          encryptedPrivateKey: walletBg.encryptedPrivateKey,
          passwordLastUpdate: walletBg.passwordLastUpdate,
          userId: walletBg?.userId,
          encryptedMnemonic: walletBg?.encryptedMnemonic,
          baseAddress: walletBg.baseAddress,
          stakeAddress: walletBg.stakeAddress,
          token: walletBg.token,
          btSupported: walletBg.btSupported,
          xfp: walletBg.xfp,
          // PRF encryption fields
          encryptionMethod: walletBg.encryptionMethod,
          prfEncryptedPrivateKey: walletBg.prfEncryptedPrivateKey,
          prfEncryptedMnemonic: walletBg.prfEncryptedMnemonic,
          webAuthnCredentialId: walletBg.webAuthnCredentialId,
          mpcPrfSaltId: walletBg.mpcPrfSaltId,
        });

        // MPC wallets: lock when the reconstructed root key isn't cached this
        // session (see login()), so restore/switch never exposes an MPC wallet
        // without a fresh unlock (Google + passkey/spending password).
        if (wallet.encryptionMethod === 'mpc') {
          WalletStore.setLocked(!mpcSessionCache.get(wallet.id));
        }

        LoadingState.setText('Restoring wallet...');
        // Set currentWalletId BEFORE initializeWallet: it loads THIS wallet's
        // remote-signing settings via loadRemoteSigningSettings(currentWalletId). If the
        // id isn't set yet, the load is skipped and the pinned devices + enable state
        // come back empty on every restart (and a wallet switch would leak the prior
        // wallet's trust list). The catch below resets it to null on failure.
        this.currentWalletId = wallet.id;
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;

        await walletBg.syncService.resync();

        LoadingState.setText('Wallet ready');

        // Initialize lastActivityTimestamp for auto-lock functionality
        await this.initializeLastActivityTimestamp(wallet.id);

        debugLog('Wallet login successful for wallet:', wallet.id);
        return walletBg;
      }
      return this.walletBg;
    } catch (error) {
      LoadingState.setText('Wallet initialization failed');
      console.error('Error during wallet login:', error);
      await this.logout();
      throw error;
    }
  }

  /**
   * Login with a wallet
   * @param wallet - Wallet data to log in with
   * @returns WalletBg instance or null if failed
   */
  async login(wallet): Promise<WalletBg | null> {
    debugLog('WalletManager: Starting login process');
    // Set syncing flag BEFORE setLoggedWallet — prevents router from navigating to dashboard
    WalletStore.setSyncing(true);
    LoadingState.setRestoring(true);
    LoadingState.setText('Creating wallet instance...');
    LoadingState.setLoading(true);

    try {
      // Clean up an existing wallet if different. On a SWITCH, only clear the
      // outgoing wallet's MPC caches (logout(false)) — the incoming wallet's key
      // may already be reconstructed (auth-then-switch) and must survive.
      if (this.walletBg && this.currentWalletId !== wallet.id) {
        await this.logout(false);
      }

      // Create a new wallet instance if needed
      if (!this.walletBg || this.currentWalletId !== wallet.id) {
        // Clear wallet store data immediately to prevent cross-wallet contamination
        WalletStore.clearForWalletSwitch();
        // NOTE: do NOT clear mpcSessionCache / mpcLoginShareCache here. Login runs
        // right AFTER UNLOCK_MPC_WALLET has populated them for THIS wallet, so
        // clearing here would wipe the just-established session (breaking signing
        // and forcing a fresh Google sign-in on the next unlock). Both caches are
        // keyed by walletId and the OUTGOING wallet is cleared by logout() above
        // on a switch, so there is no cross-wallet leakage to defend against here.
        TapToolsStore.clear();
        let walletBg: WalletBg
        if (wallet.type === WalletType.Google && wallet.encryptionMethod !== 'mpc') {
          // Legacy smart-contract Google wallet: address is fetched from
          // the contract. MPC Sign-in-with-Google wallets are also type===Google
          // but are normal HD wallets (real CIP-1852 xpub) — construct them the
          // same way as Normal wallets (no smart-contract address).
          const smartBaseAddress: Cardano.Address = await zkSmartWalletApi.walletAddress(wallet.userId)
          walletBg = new WalletBg(wallet, smartBaseAddress.toBech32())
        } else {
          walletBg = new WalletBg(wallet);
        }

        // Debug: Check WalletBg instance has PRF fields
        console.log('🔍 [WalletManager] WalletBg PRF fields after construction:', {
          encryptionMethod: walletBg.encryptionMethod,
          hasPrfEncryptedPrivateKey: !!walletBg.prfEncryptedPrivateKey,
          hasPrfEncryptedMnemonic: !!walletBg.prfEncryptedMnemonic,
          hasWebAuthnCredentialId: !!walletBg.webAuthnCredentialId,
        });

        WalletStore.setLoggedWallet({
          id: walletBg.id,
          name: walletBg.name,
          icon: walletBg.icon,
          type: walletBg.type,
          theme: walletBg.theme,
          order: walletBg.order,
          chain: walletBg.chain,
          network: walletBg.network,
          publicKey: walletBg.publicKey,
          provider: walletBg.provider,
          encryptedPrivateKey: walletBg.encryptedPrivateKey,
          passwordLastUpdate: walletBg.passwordLastUpdate,
          userId: walletBg?.userId,
          encryptedMnemonic: walletBg?.encryptedMnemonic,
          baseAddress: walletBg.baseAddress,
          stakeAddress: walletBg.stakeAddress,
          token: walletBg.token,
          btSupported: walletBg.btSupported,
          xfp: walletBg.xfp,
          // PRF encryption fields
          encryptionMethod: walletBg.encryptionMethod,
          prfEncryptedPrivateKey: walletBg.prfEncryptedPrivateKey,
          prfEncryptedMnemonic: walletBg.prfEncryptedMnemonic,
          webAuthnCredentialId: walletBg.webAuthnCredentialId,
          mpcPrfSaltId: walletBg.mpcPrfSaltId,
        });

        // MPC wallets: the reconstructed root key lives only in mpcSessionCache.
        // If it's absent (e.g. switching to this wallet from the picker, or a fresh
        // session), LOCK so the unlock flow (Google + passkey/spending password)
        // runs before any access — otherwise a switch would silently expose the
        // wallet with no re-authentication. If the key IS present (the options
        // pre-login unlock reconstructed it before sending LOGIN), stay unlocked.
        if (wallet.encryptionMethod === 'mpc') {
          WalletStore.setLocked(!mpcSessionCache.get(wallet.id));
        }

        LoadingState.setText('Initializing wallet...');

        // Check if this is a first-time restore (no cached data).
        // Bitcoin and Midnight don't use the Cardano sync table.
        const isCardanoChain =
          walletBg.chain !== Blockchain.BITCOIN &&
          walletBg.chain !== Blockchain.MIDNIGHT;
        const lastSyncInfo = isCardanoChain ? await walletBg.getLastSyncInfo() : {};
        const isFirstRestore = !lastSyncInfo;

        // If first restore, prepare sync promise BEFORE connecting WebSocket (avoids race)
        if (isFirstRestore) {
          webSocketService.pauseSyncCheck();
          this.pendingSyncPromise = webSocketService.waitForSync();
        }

        // Set currentWalletId BEFORE initializeWallet: it loads THIS wallet's
        // remote-signing settings via loadRemoteSigningSettings(currentWalletId). If the
        // id isn't set yet, the load is skipped and the pinned devices + enable state
        // come back empty on every restart (and a wallet switch would leak the prior
        // wallet's trust list). The catch below resets it to null on failure.
        this.currentWalletId = wallet.id;
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;

        // Wait for gero-sync catch-up to complete on first restore
        if (isFirstRestore && this.pendingSyncPromise) {
          const startTime = Date.now();
          LoadingState.setProgress(5);
          LoadingState.setText('Restoring wallet data...');
          await this.pendingSyncPromise;
          this.pendingSyncPromise = null;
          webSocketService.resumeSyncCheck();
          const elapsed = Date.now() - startTime;
          if (elapsed < 1500) {
            await new Promise(r => setTimeout(r, 1500 - elapsed));
          }
          LoadingState.setProgress(0);
        }

        // Clear syncing/restoring — allows router + WalletsListLogin to navigate
        WalletStore.setSyncing(false);
        LoadingState.setRestoring(false);
        LoadingState.setText('Wallet ready');

        // Initialize lastActivityTimestamp for auto-lock functionality
        await this.initializeLastActivityTimestamp(wallet.id);

        debugLog('Wallet login successful for wallet:', wallet.id);
        return walletBg;
      }

      return this.walletBg;
    } catch (error) {
      LoadingState.setText('Wallet initialization failed');
      console.error('Error during wallet login:', error);
      await this.logout();
      throw error;
    } finally {
      LoadingState.setLoading(false);
    }
  }

  /**
   * Initialize wallet instance with all necessary data and services
   * @param walletBg - WalletBg instance to initialize
   */
  private async initializeWallet(walletBg: WalletBg): Promise<void> {
    LoadingState.setText('Setting up wallet address...');
    const promises = [];
    console.log('walletBg', walletBg)
    if (walletBg.type === WalletType.Google) {
      // promises.push(
      //   zkSmartWalletApi.walletAddress(walletBg.userId).then(res => {
      //     if (res['status'] !== 200) {
      //       throw new Error('Failed to get address');
      //     }
      //     walletBg.baseAddress = res['data']['address'];
      //   })
      // );
    }

    LoadingState.setText('Loading blockchain data...');

    // Chain-specific initialization
    if (walletBg.chain === Blockchain.BITCOIN) {
      // Bitcoin wallet initialization
      debugLog('🔶 Initializing Bitcoin wallet');
      LoadingState.setText('Loading Bitcoin wallet...');

      // Fetch Bitcoin UTXOs and update store
      await walletBg.syncBitcoinWallet();

      // Fetch Bitcoin transaction history
      LoadingState.setText('Loading Bitcoin transactions...');
      await walletBg.syncBitcoinTransactions();

      // Load wallet-specific data
      promises.push(
        walletBg.loadConfig(),
        walletBg.loadContacts(),
        walletBg.loadConnectedDapps()
      );
    } else if (walletBg.chain === Blockchain.MIDNIGHT) {
      // Midnight wallet initialization. Cardano-specific (genesis, epoch params,
      // assets, rewards) is skipped — Midnight runs through a separate
      // SDK + indexer. Addresses were derived at wallet creation/restore
      // and stored on the wallet record; here we hydrate midnightStore and
      // open the gero-sync WebSocket against the unshielded address.
      debugLog('🌙 Initializing Midnight wallet');
      LoadingState.setText('Loading Midnight wallet...');

      // Hydrate midnightStore with the persisted addresses so the dashboard
      // (MidnightHoldingsTable, ReceiveDialog) can render immediately.
      const { midnightActions } = await import('@/stores/midnightStore');
      let addresses: {
        unshielded: string;
        shielded: string;
        dust: string;
        publicKeyHex?: string;
        addressHex?: string;
        zswapViewingKey?: string;
        cardanoXpub?: string;
        cardanoBaseAddress?: string;
        cardanoStakeAddress?: string;
        cardanoPaymentKeyHashHex?: string;
      } = { unshielded: '', shielded: '', dust: '' };
      try {
        const parsed = walletBg.publicKey ? JSON.parse(walletBg.publicKey) : null;
        if (parsed && typeof parsed === 'object') {
          addresses = {
            unshielded: parsed.unshielded ?? '',
            shielded: parsed.shielded ?? '',
            dust: parsed.dust ?? '',
            publicKeyHex: parsed.publicKeyHex,
            addressHex: parsed.addressHex,
            zswapViewingKey: parsed.zswapViewingKey,
            cardanoXpub: parsed.cardanoXpub,
            cardanoBaseAddress: parsed.cardanoBaseAddress,
            cardanoStakeAddress: parsed.cardanoStakeAddress,
            cardanoPaymentKeyHashHex: parsed.cardanoPaymentKeyHashHex,
          };
        }
      } catch (e) {
        debugLog('🌙 Failed to parse Midnight addresses from wallet record:', e);
      }
      midnightActions.setActive(addresses);

      // Open the gero-sync WebSocket bridge for this Midnight wallet. The
      // service translates SYNC / CATCH_UP_COMPLETE / ROLLBACK / FORCE_RESYNC
      // into midnightStore actions. Skip if the address derivation failed.
      if (addresses.unshielded) {
        const { default: midnightSyncService } = await import('@/services/midnight-sync.service');
        // Opt into shielded sync only if the wallet record carries a viewing
        // key in the form the indexer's connect(viewingKey) mutation accepts:
        // bech32m with HRP `mn_shield-esk_` (see the a3f76f1f fix). Wallets
        // created before that fix stored the raw-hex or `mn_shield-epk_` form,
        // which the indexer rejects with "cannot bech32m-decode viewing key" —
        // enabling shielded sync for those just spams the indexer with failing
        // connect() calls every reconcile. Gate on the correct prefix so legacy
        // wallets fall back to unshielded-only cleanly. They regain shielded
        // sync once their viewing key is re-derived (recreate the wallet, or
        // the future in-place viewing-key heal).
        // Privacy: log only the boolean/validity, never the key itself.
        const vk = addresses.zswapViewingKey;
        const vkIsValid = typeof vk === 'string' && vk.startsWith('mn_shield-esk_');
        const shielded = vkIsValid
          ? { viewingKey: vk, lastIndex: null }
          : undefined;
        if (shielded) {
          debugLog('🌙 Midnight sync: starting with shielded subscription enabled');
        } else if (vk) {
          debugLog('🌙 Midnight sync: viewing key is legacy form (not mn_shield-esk_) — shielded sync disabled until re-derivation; unshielded-only for now');
        }
        midnightSyncService.start(walletBg.network, addresses, 0, shielded);
      } else {
        debugLog('🌙 Skipping gero-sync subscribe: no unshielded address on wallet record');
      }

      promises.push(
        walletBg.loadConfig(),
        walletBg.loadContacts(),
        walletBg.loadConnectedDapps()
      );
    } else {
      // Cardano wallet initialization (existing logic)
      walletBg.loadGenesis();

      const promises2 = [];
      promises2.push(
        walletBg.loadAssets(),
        walletBg.loadEpochParams()
      );
      if (networks.resolveStakingSupport(walletBg.chain, walletBg.network)) {
        promises2.push(
          walletBg.loadRewards()
        );
      }
      await Promise.all(promises2);

      LoadingState.setText('Loading wallet data...');

      // Load holdings from cached UTxOs and keys immediately — no need to wait for transactions or gero-sync
      await Promise.all([walletBg.loadCachedUtxos(), walletBg.loadCachedKeys()]);

      promises.push(
        walletBg.loadConfig(),
        walletBg.loadAccount(),
        walletBg.loadContacts(),
        walletBg.loadConnectedDapps(),
        walletBg.loadTransactions()
      );
    }

    const chain: string = Object.keys(Blockchain).find(key => Blockchain[key] === walletBg.chain);
    const network: string = Object.keys(Network).find(key => Network[key] === walletBg.network);
    let address: string;
    // MPC Google wallets are normal HD wallets — sync on the stake address like
    // any other wallet. Only legacy Google wallets sync on baseAddress.
    if (walletBg.isEnterpriseAddress() || (walletBg.type === WalletType.Google && walletBg.encryptionMethod !== 'mpc')) {
      address = walletBg.baseAddress;
    } else {
      address = walletBg.stakeAddress;
    }

    // --- WebSocket sync (replaces Ably) ---
    // Midnight uses its own bridge (midnightSyncService) — wired separately
    // once the SDK can produce the unshielded address required to subscribe.
    if (walletBg.chain !== Blockchain.BITCOIN && walletBg.chain !== Blockchain.MIDNIGHT) {
      const lastSyncInfo = await walletBg.getLastSyncInfo();
      const lastSyncedBlock = lastSyncInfo?.height || 0;
      const credentials = walletBg.derivePaymentCredentials();

      // Cross-device signing bridge (ships DARK behind isCrossDeviceSigningEnabled).
      // Returns null and does nothing when the flag is off, so the handlers below
      // are unchanged and no relay message crosses the wire. When on, it wires the
      // WS transport and publishes a DEVICE_REGISTER for this device.
      // The flag is read from chrome.storage.local (mirrored by the UI's
      // featureFlagsStore) because the EventSource-based flag service cannot run in
      // this background service worker.
      // Per-wallet remote-signing settings (opt-in + trusted devices + policy).
      if (this.currentWalletId != null) {
        this.remoteSigning = await loadRemoteSigningSettings(this.currentWalletId);
      }
      if (!this.crossDeviceIdentity) {
        this.crossDeviceIdentity = await loadOrCreateDeviceIdentity();
      }
      // Load this device's cached wallet-control proof for this wallet (if produced).
      this.crossDeviceProof = await loadDeviceRegisterProof(
        this.crossDeviceIdentity.deviceId,
        walletBg.stakeAddress,
      );
      const serverFlagOn = await this.isCrossDeviceSigningEnabled();
      this.crossDevice?.dispose();
      this.crossDevice = bootstrapCrossDeviceSigning({
        label: 'Gero Extension',
        hasSigningKey: true,
        identity: this.crossDeviceIdentity,
        // Both the server flag AND this wallet's opt-in must be on.
        enabled: serverFlagOn && this.remoteSigning.enabled,
        // Live trust gates: only paired devices may approve/answer.
        isRequesterTrusted: (id, pk) => isDeviceTrusted(this.remoteSigning, id, pk),
        isResponderTrusted: (id, pk) => isDeviceTrusted(this.remoteSigning, id, pk),
        // Cached proof, re-sent on every register (produced once at enable-time).
        getProof: () => this.crossDeviceProof ?? undefined,
        // QR pairing: a frame-verified PAIR_CONFIRM -> nonce consume + proof verify + pin.
        onPairConfirm: (frame) => void this.handlePairConfirm(frame),
      });

      webSocketService.connect(chain, network, address, lastSyncedBlock, {
        // Always a LIVE closure, never a static `undefined`. The socket outlives
        // the bridge, which is rebuilt when remote signing is toggled on/off after
        // login (reconfigureCrossDevice) WITHOUT a reconnect. Reading this.crossDevice
        // at call time routes inbound DEVICES/SIGN_* frames to whatever bridge exists
        // now (or a no-op when null). A conditional `undefined` here froze the handler
        // to the connect-time state, so enabling post-login left inbound frames
        // falling through to the "unknown type" branch (empty device registry).
        onCrossDeviceMessage: (raw: unknown) => this.crossDevice?.onCrossDeviceMessage(raw),
        // Publish DEVICE_REGISTER after the socket opens + SUBSCRIBE, on every
        // (re)connect. No-op when the feature is off (crossDevice is null).
        onSocketOpen: () => this.crossDevice?.register(),
        onSync: async (data: WsSyncMessage) => {
          await this.tipMutex.runExclusive(async () => {
            await walletBg.syncService.setSync(data);
          });
        },
        onRollback: async (data: WsSyncMessage) => {
          debugLog('Rollback received:', data);
          const rollbackToSlot = data['rollbackToSlot'];
          if (typeof rollbackToSlot === 'number') {
            await walletBg.syncService.handleRollback(rollbackToSlot);
          }
        },
        onForceResync: async () => {
          debugLog('Force resync: clearing sync state and resubscribing via gero-sync');
          const startTime = Date.now();
          LoadingState.setRestoring(true);
          LoadingState.setProgress(5);
          LoadingState.setText('Syncing wallet data...');
          webSocketService.pauseSyncCheck();
          try {
            const db = await walletBg.getDb();
            await db.table('sync').clear();
            await db.table('transactions').clear();
            await db.table('account').clear();
            const syncPromise = webSocketService.waitForSync();
            webSocketService.resubscribe(0);
            await syncPromise;
            // Ensure overlay is visible for at least 1.5s so user sees progress
            const elapsed = Date.now() - startTime;
            if (elapsed < 1500) {
              await new Promise(r => setTimeout(r, 1500 - elapsed));
            }
          } finally {
            LoadingState.setProgress(0);
            LoadingState.setRestoring(false);
            LoadingState.setText('');
            webSocketService.resumeSyncCheck();
          }
          debugLog('Force resync complete');
        },
      }, credentials);
    } else {
      debugLog(`Skipping Cardano gero-sync WebSocket for ${walletBg.chain} wallet`);
    }

    // Wait for all initialization promises to complete
    LoadingState.setText('Initializing wallet...');
    await Promise.all(promises);

    LoadingState.setText('Wallet initialization complete');

    // Start periodic sync for Bitcoin wallets
    if (walletBg.chain === Blockchain.BITCOIN) {
      debugLog('🔄 Starting Bitcoin periodic sync...');
      walletBg.startBitcoinPeriodicSync();
    }

    // OPTIMIZATION: Load non-critical data in background after wallet is ready
    // This improves perceived performance by not blocking the login flow
    // DexHunter swap tokens (~17ms), blacklist policies (~9ms), BringCache (~349ms)
    setTimeout(async () => {
      if (networks.resolveSwapSupport(walletBg.chain, walletBg.network)) {
        // Load DexHunter tokens first - this provides verification status
        await TokenMetadataStore.loadTokens().catch(err => console.warn('Failed to load DexHunter tokens:', err));

        // Re-resolve assets after DexHunter tokens are loaded to update verified status
        const utxos = walletStore.utxos;
        if (utxos && utxos.length > 0) {
          walletBg.setAssets(utxos as Cardano.Utxo[]);
        }

        TokenMetadataStore.loadBlacklistPolicies().catch(err => console.warn('Failed to load blacklist policies:', err));
      }
    }, 100); // Small delay to ensure wallet is fully initialized
  }

  /**
   * Logout current wallet and cleanup all resources
   */
  // `clearAllMpcCaches` is true for an explicit logout (wipe every wallet's MPC
  // session), but the internal logout that `login()` performs on a wallet SWITCH
  // passes false: the auth-then-switch flow reconstructs the INCOMING wallet's key
  // into mpcSessionCache BEFORE this runs, so a blanket clearAll would wipe the
  // target's just-authenticated session and re-lock it. On a switch we only clear
  // the OUTGOING wallet's caches.
  async logout(clearAllMpcCaches = true): Promise<void> {

    try {
      // Clear cached MPC root-key bytes and login shares for the logged-out wallet
      // (or all wallets on an explicit logout) — never survive a logout.
      if (clearAllMpcCaches) {
        mpcSessionCache.clearAll();
        await mpcLoginShareCache.clearAll();
      } else if (this.currentWalletId !== null) {
        mpcSessionCache.clear(this.currentWalletId);
        await mpcLoginShareCache.clear(this.currentWalletId);
      }

      // Clear database cache for the current wallet to prevent data leakage
      if (this.currentWalletId !== null) {
        debugLog('Clearing database cache for wallet:', this.currentWalletId);
        clearDbCache(this.currentWalletId);
      }

      // Close extension popups and cleanup subscriptions
      this.closeAllOtherExtensionPopups();
      // Clean up alarms
      if (chrome?.alarms?.onAlarm?.hasListeners()) {
        chrome.alarms.onAlarm.removeListener(alarmListener);
      }

      // Clean up WebSocket service
      try {
        webSocketService.close();
        console.log('WebSocket service closed successfully');
      } catch (wsError) {
        console.warn('Failed to cleanup WebSocket service during logout:', wsError);
      }

      // Stop the Midnight sync bridge if it was active. This shuts down its
      // gero-sync subscription and clears midnightStore.
      try {
        const { default: midnightSyncService } = await import('@/services/midnight-sync.service');
        if (midnightSyncService.isActive()) {
          midnightSyncService.stop();
        }
      } catch (midnightError) {
        console.warn('Failed to stop midnight sync during logout:', midnightError);
      }

      // Tear down the cross-device signing bridge (no-op when the flag is off).
      try {
        this.crossDevice?.dispose();
        this.crossDevice = null;
        // Reset ALL per-wallet cross-device state so nothing from the previous wallet
        // can leak into the next one (defense-in-depth: even if the load-order fix
        // regressed, a switch must never carry the prior wallet's trust list / proof /
        // enable state, which would auto-enable the feature for the wrong wallet and
        // authorize the wrong phone). Re-loaded per-wallet on the next login. The
        // relay-auth identity is per-install and intentionally NOT reset here.
        this.remoteSigning = defaultRemoteSigningSettings();
        this.crossDeviceProof = null;
        this.lastPairedDevice = null;
      } catch (xdError) {
        console.warn('Failed to cleanup cross-device signing during logout:', xdError);
      }

      // Clean up store messaging service
      try {
        const { storeMessaging } = await import('@/services/storeMessaging.service');
        if (storeMessaging && typeof storeMessaging.destroy === 'function') {
          storeMessaging.destroy();
          console.log('Store messaging service cleaned up successfully');
        }
      } catch (storeMessagingError) {
        console.warn('Failed to cleanup store messaging service during logout:', storeMessagingError);
      }

      // Note: Don't send a logout message to the background since this method
      // is already called FROM the background logout handler

      // Clear Chrome storage
      if (chrome?.storage) {
        try {
          await Promise.all([
            chrome.storage.local.remove('loggedWallet'),
          ]);
        } catch (storageError) {
          console.warn('Failed to clear Chrome storage during logout:', storageError);
        }
      }

      // Stop Bitcoin periodic sync before clearing wallet data
      try {
        if (this.walletBg && this.walletBg.chain === Blockchain.BITCOIN) {
          this.walletBg.stopBitcoinPeriodicSync();
          debugLog('Bitcoin periodic sync stopped during logout');
        }
      } catch (syncError) {
        console.warn('Failed to stop Bitcoin sync during logout:', syncError);
      }

      // Clear wallet store data
      try {
        WalletStore.logout();
        TapToolsStore.clear();
        NetworkStore.reset(); //TODO Reset only on network change
        await MusicStore.logout();
      } catch (storeError) {
        console.warn('Failed to logout from wallet store:', storeError);
      }

      // Reset service state
      try {
        if (this.walletBg && typeof this.walletBg.unsubscribeAll === 'function') {
          this.walletBg.unsubscribeAll();
        }
      } catch (walletBgError) {
        console.warn('Failed to unsubscribe from walletBg during logout:', walletBgError);
      }
      this.walletBg = null;
      this.currentWalletId = null;

      // Dispatch logout event
      try {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent('gero:logout', {
              bubbles: true,
              cancelable: true,
              composed: false,
            })
          );
        }
      } catch (eventError) {
        console.warn('Failed to dispatch logout event:', eventError);
      }

      debugLog('WalletManager: Logout completed successfully');
    } catch (error) {
      console.error('Error during wallet logout:', error);
      // Force cleanup even if logout fails
      if (clearAllMpcCaches) {
        mpcSessionCache.clearAll();
        await mpcLoginShareCache.clearAll();
      } else if (this.currentWalletId !== null) {
        mpcSessionCache.clear(this.currentWalletId);
        await mpcLoginShareCache.clear(this.currentWalletId);
      }
      if (this.currentWalletId !== null) {
        clearDbCache(this.currentWalletId);
      }
      this.walletBg?.unsubscribeAll();
      this.walletBg = null;
      this.currentWalletId = null;
      WalletStore.logout();
      TapToolsStore.clear();
      await MusicStore.logout();
    }
  }

  /**
   * Lock the current wallet
   * Keeps WalletBg instance intact for CIP-30 functionality
   * User must unlock with PIN/Pattern/Spending Password + 2FA (not supported for now) to access UI
   */
  async lock(): Promise<void> {
    try {
      // Clear cached MPC root-key bytes — signing an MPC wallet after a lock
      // requires re-unlock, same as PRF wallets require a fresh WebAuthn prompt.
      mpcSessionCache.clearAll();
      // NOTE: deliberately DO NOT clear mpcLoginShareCache here. Keeping the
      // login share across a lock lets the still-logged-in wallet be re-unlocked
      // with only the device secret (passkey/spending password) — no repeat
      // Google sign-in — while re-auth (the passkey/password) is still required.
      // It is dropped on logout / wallet switch and on browser close (it lives in
      // chrome.storage.session, which survives service-worker restarts).
      // Set locked state
      WalletStore.setLocked(true);
      // Note: Don't clear auto-lock-check alarm - it continues running to check when wallet is unlocked again
      debugLog('WalletManager: Wallet locked successfully');
    } catch (error) {
      console.error('Error locking wallet:', error);
      throw error;
    }
  }

  /**
   * Shared verification logic for unlock credentials
   * Verifies PIN, Pattern, Password, and optional 2FA (PassKey verification handled by WebAuthn in UI)
   * @param walletId - Wallet ID to verify against
   * @param unlockCredential - PIN, pattern, password, or PassKey credential signal
   * @param totpCode - Optional TOTP code if 2FA is enabled
   * @param password - Spending password to decrypt security data
   * @param providedUnlockMethod - Optional unlock method override (for PassKey)
   * @param useWalletBg - If true, use walletBg for password verification (post-login); if false, use database (pre-login)
   * @returns True if verification successful
   */
  private async verifyUnlockCredentials(
    walletId: number,
    unlockCredential: string | number[],
    totpCode?: string,
    password?: string,
    providedUnlockMethod?: string,
    useWalletBg: boolean = false
  ): Promise<boolean> {
    // Import security utilities
    const { verifyPin, verifyPattern, verifyTotpCode, decryptSecurityData } = await import('@/shared/utils/security');
    const { getDb } = await import('@/db/wallet-db');

    // Get security config from wallet database
    const db = await getDb(walletId);
    const configTable = db.table('config');

    const unlockMethodConfig = await configTable.where({ key: 'unlockMethod' }).first();
    const twoFactorConfig = await configTable.where({ key: 'twoFactorEnabled' }).first();

    // Use provided unlock method (for PassKey override) or read from database
    const unlockMethod = providedUnlockMethod || unlockMethodConfig?.value;

    if (!unlockMethod) {
      // No unlock method set, verification succeeds
      return true;
    }

    // Verify unlock credential based on method
    let unlockValid = false;

    // Check for browser-verified credentials first (PassKey, PRF lock password).
    // These signal strings indicate verification already happened in the browser UI context.
    // Background cannot independently re-verify because:
    // - PassKey: WebAuthn requires user activation (popup), not available in service worker
    // - Lock password: @noble/hashes PBKDF2 produces different results in service worker vs browser
    //   context due to crypto polyfill mismatches (Buffer handling in separate Vite bundles)
    // Trust boundary: these signals arrive via chrome.runtime messaging (sendToBackgroundFromOptions),
    // which is same-origin extension-only. The background handler (addToOptions) only accepts messages
    // from the extension's options/popup pages, not from content scripts or injected page scripts.
    // DApp connection relay in background.ts uses a separate message handler (addToPopup) that does
    // not route to this unlock flow.
    // Defense-in-depth: lockpassword-verified requires encryptionMethod === 'prf' to prevent
    // a normal wallet from bypassing spending password verification if this signal is sent by mistake.
    // If encryptionMethod lookup fails (DB error → undefined), browserVerified is false and the code
    // falls through to the normal password branch, which safely fails when trying to decrypt with
    // the literal string 'lockpassword-verified' as a spending password.
    // Cache walletsMap for reuse in the pre-login password path below (avoids duplicate DB read).
    let cachedWalletsMap: Record<number, Wallet> | null = null;
    let encryptionMethod = walletStore.loggedWallet?.encryptionMethod;
    if (!encryptionMethod) {
      const { getAllWallets } = await import('@/db/gero-db');
      cachedWalletsMap = await getAllWallets();
      encryptionMethod = cachedWalletsMap[walletId]?.encryptionMethod;
    }
    const browserVerified =
      (unlockCredential === 'passkey-authenticated') ||
      (unlockCredential === 'lockpassword-verified' && unlockMethod === 'password' && encryptionMethod === 'prf');
    if (browserVerified) {
      unlockValid = true;
    } else if (unlockMethod === 'password') {
      if (encryptionMethod === 'prf') {
        // PRF wallet: verify against lockPasswordHash in DB (defense-in-depth).
        // Normally PRF wallets arrive as 'lockpassword-verified' (browser-verified above),
        // but this branch catches edge cases where the browser failed to detect PRF status.
        const lockPasswordHashConfig = await configTable.where({ key: 'lockPasswordHash' }).first();
        if (!lockPasswordHashConfig?.value) {
          throw new Error('Lock password not configured for PRF wallet');
        }
        unlockValid = await verifyPin(unlockCredential as string, lockPasswordHashConfig.value);
      } else if (useWalletBg) {
        // NORMAL WALLET - Post-login: use walletBg instance
        if (!this.walletBg || !walletStore.loggedWallet) {
          throw new Error('Wallet instance not available for password verification');
        }

        const walletType = walletStore.loggedWallet.type;
        if (walletType !== WalletType.Normal) {
          console.warn('Password unlock not supported for wallet type:', walletType);
          throw new Error('Password unlock is only supported for Normal wallets');
        }

        const encryptedPrivateKey = walletStore.loggedWallet.encryptedPrivateKey;
        if (!encryptedPrivateKey || !unlockCredential) {
          throw new Error('Encrypted private key not found or password not provided');
        }

        unlockValid = await this.walletBg.verifySpendingPassword(unlockCredential as string);
      } else {
        // NORMAL WALLET - Pre-login: load wallet from database (reuse cached map if available)
        if (!cachedWalletsMap) {
          const { getAllWallets } = await import('@/db/gero-db');
          cachedWalletsMap = await getAllWallets();
        }
        const wallet = cachedWalletsMap[walletId];

        if (!wallet || wallet.type !== WalletType.Normal) {
          throw new Error('Password unlock is only supported for Normal wallets');
        }

        const encryptedPrivateKey = wallet.encryptedPrivateKey;
        if (!encryptedPrivateKey || !unlockCredential) {
          throw new Error('Encrypted private key not found or password not provided');
        }

        // Verify password by attempting to decrypt
        try {
          const { decrypt, decryptWithPassword } = await import('@/shared/utils/crypto');
          const decrypted = decrypt(encryptedPrivateKey, unlockCredential as string);
          decryptWithPassword(unlockCredential as string, JSON.parse(decrypted));
          unlockValid = true;
        } catch (error) {
          unlockValid = false;
        }
      }
    } else if (unlockMethod === 'pin') {
      // Check for new format (pinHash) or old format (encryptedPinHash)
      const pinHashConfig = await configTable.where({ key: 'pinHash' }).first();
      const encryptedPinHashConfig = await configTable.where({ key: 'encryptedPinHash' }).first();

      if (pinHashConfig) {
        // New format: PIN hash is stored directly (unencrypted)
        unlockValid = await verifyPin(unlockCredential as string, pinHashConfig.value);
      } else if (encryptedPinHashConfig && password) {
        // Old format: PIN hash is encrypted with password
        const pinHash = decryptSecurityData(encryptedPinHashConfig.value, password) as string;
        unlockValid = await verifyPin(unlockCredential as string, pinHash);
      } else {
        throw new Error('PIN configuration not found');
      }
    } else if (unlockMethod === 'pattern') {
      // Pattern hash is stored directly (unencrypted)
      const patternHashConfig = await configTable.where({ key: 'encryptedPatternHash' }).first();
      if (!patternHashConfig) {
        throw new Error('Pattern configuration not found');
      }

      // Verify pattern directly (no decryption needed)
      unlockValid = await verifyPattern(unlockCredential as number[], patternHashConfig.value);
    }

    if (!unlockValid) {
      return false;
    }

    // Verify 2FA if enabled
    if (twoFactorConfig && twoFactorConfig.value === true) {
      if (!totpCode || !password) {
        throw new Error('2FA enabled but TOTP code or password not provided');
      }

      const totpSecretConfig = await configTable.where({ key: 'encryptedTotpSecret' }).first();
      if (!totpSecretConfig) {
        throw new Error('TOTP secret not found');
      }

      const totpSecret = decryptSecurityData(totpSecretConfig.value, password) as string;
      const totpValid = verifyTotpCode(totpCode, totpSecret);

      if (!totpValid) {
        return false;
      }
    }

    return true;
  }

  /**
   * Unlock the wallet with PIN/Pattern/Password + optional 2FA (PassKey handled in UI via WebAuthn)
   * @param unlockCredential - PIN, pattern, password, or PassKey credential signal
   * @param totpCode - Optional TOTP code if 2FA is enabled
   * @param password - Spending password to decrypt security data
   * @returns True if unlock successful
   */
  async unlock(unlockCredential: string | number[], totpCode?: string, password?: string, providedUnlockMethod?: string): Promise<boolean> {
    debugLog('WalletManager: Starting unlock process');

    try {
      if (!this.walletBg || !walletStore.loggedWallet) {
        throw new Error('No wallet to unlock');
      }

      // Verify credentials using shared method (with walletBg for password verification)
      const isValid = await this.verifyUnlockCredentials(
        walletStore.loggedWallet.id,
        unlockCredential,
        totpCode,
        password,
        providedUnlockMethod,
        true // Use walletBg for password verification
      );

      if (!isValid) {
        console.warn('Invalid unlock credential');
        return false;
      }

      // Unlock successful - restore keys and clear locked state
      WalletStore.setLocked(false);

      // Initialize lastActivityTimestamp for auto-lock functionality
      await this.initializeLastActivityTimestamp(walletStore.loggedWallet.id);

      // Start auto-lock timer
      await this.startAutoLockTimer();

      debugLog('WalletManager: Wallet unlocked successfully');
      return true;
    } catch (error) {
      console.error('Error unlocking wallet:', error);
      return false;
    }
  }

  /**
   * Verify pre-login unlock credentials for a wallet (without logging in)
   * This is used for the pre-login security check
   */
  async verifyPreLoginUnlock(walletId: number, unlockCredential: string | number[], totpCode?: string, password?: string, providedUnlockMethod?: string): Promise<boolean> {
    debugLog('WalletManager: Starting pre-login unlock verification');

    try {
      // Verify credentials using shared method (without walletBg, loads from database)
      const isValid = await this.verifyUnlockCredentials(
        walletId,
        unlockCredential,
        totpCode,
        password,
        providedUnlockMethod,
        false // Don't use walletBg, load from database instead
      );

      if (isValid) {
        debugLog('WalletManager: Pre-login unlock verification successful');
      } else {
        console.warn('Invalid pre-login unlock credential');
      }

      return isValid;
    } catch (error) {
      console.error('Error verifying pre-login unlock:', error);
      return false;
    }
  }

  /**
   * Start the auto-lock timer based on wallet configuration
   */
  private async startAutoLockTimer(): Promise<void> {
    try {
      if (!walletStore.loggedWallet) return;

      const { getDb } = await import('@/db/wallet-db');
      const db = await getDb(walletStore.loggedWallet.id);
      const configTable = db.table('config');

      const autoLockConfig = await configTable.where({ key: 'autoLockMinutes' }).first();

      if (autoLockConfig && autoLockConfig.value > 0) {
        const minutes = autoLockConfig.value;

        // Create Chrome alarm for auto-lock
        chrome.alarms.create('auto-lock', {
          delayInMinutes: minutes
        });

        debugLog(`Auto-lock timer set for ${minutes} minutes`);
      }
    } catch (error) {
      console.warn('Failed to start auto-lock timer:', error);
    }
  }

  /**
   * Initialize lastActivityTimestamp for auto-lock functionality
   * Called when wallet logs in or unlocks
   */
  private async initializeLastActivityTimestamp(walletId: number): Promise<void> {
    try {
      const { getDb } = await import('@/db/wallet-db');
      const db = await getDb(walletId);
      const configTable = db.table('config');

      const now = Date.now();
      await configTable.put({ key: 'lastActivityTimestamp', value: now });
      debugLog(`⏱️ Initialized lastActivityTimestamp: ${new Date(now).toISOString()}`);
    } catch (error) {
      console.warn('Failed to initialize lastActivityTimestamp:', error);
    }
  }

  /**
   * Get current wallet instance
   * @returns Current WalletBg instance or null
   */
  getWallet(): WalletBg | null {
    return this.walletBg;
  }

  /**
   * Get the cross-device signing bridge (requester side), or null when the
   * feature is off. Used by the REQUEST_CROSS_DEVICE_SIGNATURE background
   * handler to hand an unsigned tx to another device for signing.
   */
  getCrossDeviceSigning(): CrossDeviceSigning | null {
    return this.crossDevice?.signing ?? null;
  }

  /**
   * The deviceId to route a SIGN_REQUEST to (the `to` field), or null to broadcast.
   * Resolves from the PERSISTED trusted-device list (not the live DEVICES snapshot),
   * returning the single signing-capable pinned device whether it is online OR
   * offline. Targeting the offline case is what lets the relay APNs-wake a locked
   * phone (a broadcast never triggers the wake, which is gated on a `to`); an offline
   * target with no push token just times out fail-closed, never misdelivers. With >1
   * pinned signer we broadcast (a device picker is a later refinement); with 0 there
   * is nothing to target.
   *
   * Resolving from the pinned list (vs the live snapshot) also fixes a latent bug:
   * stale-duplicate relay sessions inflated the online signer count past 1, so the
   * old live-snapshot logic returned null (broadcast) even when the phone was the
   * only real signer — which is why the first locked-phone wake test broadcast
   * instead of targeting. The pinned list holds one entry per deviceId regardless of
   * how many sockets the relay reports. The pinned deviceId MUST equal the id iOS
   * uses in DEVICE_REGISTER (the relay PushTargetStore key) for the wake lookup to
   * hit — see the cross-repo key contract (commit f5cae184).
   */
  getDefaultCrossDeviceTarget(): string | null {
    return soleSignerDeviceId(this.remoteSigning);
  }

  // ---- QR pairing (scan-to-pair) -------------------------------------------

  /**
   * Build the QR payload the desktop renders in Remote Signing settings: this
   * device's relay-auth identity + wallet-control proof + a freshly minted single-use
   * nonce. Returns null when the wallet can't be paired (no cached proof yet / no
   * stake). The phone scans it, verifies the proof out of band, pins us, and replies
   * with a signed PAIR_CONFIRM echoing the nonce. The QR path HARD-REQUIRES the proof
   * (the payload carries it), so a wallet with no proof simply can't render a QR.
   */
  async buildPairingQrPayload(): Promise<PairingQrPayload | null> {
    const ownStake = this.walletBg?.stakeAddress;
    const identity = this.crossDeviceIdentity;
    if (!ownStake || !identity || !this.crossDeviceProof) return null;
    const now = Math.floor(Date.now() / 1000);
    const { nonce, exp } = await mintPairingNonce(ownStake, now, (n) => {
      const b = new Uint8Array(n);
      globalThis.crypto.getRandomValues(b);
      return b;
    });
    return buildPairingQrPayload({
      deviceId: identity.deviceId,
      pubKey: identity.pubKeyHex,
      stake: ownStake,
      proof: this.crossDeviceProof,
      nonce,
      exp,
    });
  }

  /**
   * Handle a frame-verified inbound PAIR_CONFIRM. The signing service already checked
   * the Ed25519 subject sig against frame.pubKey and that `to` == this device. This
   * enforces the WALLET binding + single-use, fail-closed:
   *
   *   1. Verify the phone's wallet-control proof against OUR stake (frame.stakeAddress
   *      is advisory — used only to reconstruct the subject the service verified). This
   *      is THE binding: an attacker on another wallet can sign a valid frame but cannot
   *      forge a proof tying their key to our stake key-hash. Pass ownStake, NEVER
   *      frame.stakeAddress / frame.proof.stakeAddress (that would be a tautology).
   *   2. Only then consume the single-use nonce (atomic burn). Deliberately AFTER the
   *      proof: consuming first would let anyone who photographed the QR burn the nonce
   *      with a bad-proof frame (its own-key sig passes the service check) and DoS the
   *      real pair. Proof-first drops that frame without touching the nonce, so the real
   *      phone still pairs; single-use/replay protection is unchanged (a replayed valid
   *      frame re-verifies the proof but the nonce is already used -> rejected).
   *   3. Pin verified:true. isDeviceIdConsistent kept as defense-in-depth (iOS uses the
   *      same sha256(pubKey)[0:16] deviceId rule as us).
   */
  async handlePairConfirm(frame: PairConfirm): Promise<void> {
    try {
      const ownStake = this.walletBg?.stakeAddress;
      if (!ownStake || this.walletBg?.chain !== Blockchain.CARDANO) return;
      if (!this.remoteSigning.enabled) return; // feature must be on for this wallet
      const now = Math.floor(Date.now() / 1000);

      // 0. Cheap, NON-CONSUMING early reject: no live matching nonce (e.g. no QR is
      //    displayed) => drop before the expensive proof verify. The desktop deviceId
      //    is public, so an untrusted relay could otherwise flood self-signed frames to
      //    force unbounded COSE/blake2b/Ed25519 work. Non-consuming, so it does NOT
      //    reintroduce the photographed-QR nonce-burn DoS; the consume in step 2 is the
      //    authoritative single-use gate.
      if (!(await peekPairingNonce(frame.nonce, ownStake, now))) {
        debugLog('QR pair rejected: no live nonce (flood/early reject)');
        return;
      }

      // 1. Wallet-control proof — the authoritative binding (verify vs OUR stake).
      const proofOk = await verifyDeviceRegisterProof(
        frame.proof,
        { deviceId: frame.from, pubKey: frame.pubKey },
        ownStake,
      );
      if (!proofOk) { debugLog('QR pair rejected: wallet-control proof invalid'); return; }

      // 2. Single-use nonce (bound to our wallet, MV3-durable). Burned here on success;
      //    proof-first so a photographed-QR bad-proof frame can't burn it. Authoritative.
      const nonceOk = await consumePairingNonce(frame.nonce, ownStake, now);
      if (!nonceOk) { debugLog('QR pair rejected: nonce invalid/used/expired'); return; }

      // 3. Defense-in-depth id/key check, then pin verified.
      if (!isDeviceIdConsistent(frame.from, frame.pubKey)) { debugLog('QR pair rejected: id/key mismatch'); return; }
      const label = frame.label || 'Paired device';
      this.remoteSigning = trustAddDevice(
        this.remoteSigning,
        {
          deviceId: frame.from,
          pubKey: frame.pubKey,
          label,
          platform: frame.platform || 'ios',
          verified: true,
          hasSigningKey: frame.hasSigningKey ?? true,
        },
        now,
      );
      await this.persistRemoteSigning();
      this.lastPairedDevice = { deviceId: frame.from, label, at: Date.now() };
      debugLog('QR pair: pinned', frame.from, `(${label})`);

      // Cosmetic: tell the phone we pinned it too, so it shows its own confirmed tick
      // instead of degrading after ~2.4s. Best-effort — trust is already committed; a
      // dropped ack never un-pairs. Signed with our relay-auth key; the phone verifies
      // it against the desktop pubKey it pinned from the QR.
      await this.crossDevice?.signing.sendPairAck(frame.from, frame.nonce);
    } catch (e) {
      debugLog('QR pair: handlePairConfirm error', e);
    }
  }

  /**
   * Poll target for the settings QR dialog: the last device paired via QR scan, then
   * clears it so a reopen never re-fires a stale success.
   */
  getPairingStatus(): { deviceId: string; label: string; at: number } | null {
    const last = this.lastPairedDevice;
    this.lastPairedDevice = null;
    return last;
  }

  // ---- Remote-signing settings API (backing the Security settings UI) -------

  /** Current per-wallet remote-signing settings (enable, policy, trusted devices). */
  getRemoteSigningSettings(): RemoteSigningSettings {
    return this.remoteSigning;
  }

  /**
   * Devices currently visible in the relay registry, each tagged with whether it
   * is this device and whether it is trusted. Empty when the bridge is off.
   */
  getCrossDeviceDevices(): Array<{ device: DeviceInfo; trusted: boolean; isSelf: boolean }> {
    const selfId = this.crossDevice?.selfDeviceId ?? null;
    const devices = this.crossDevice?.getDevices() ?? [];
    return devices.map((device) => ({
      device,
      trusted: isDeviceTrusted(this.remoteSigning, device.deviceId, device.pubKey),
      isSelf: device.deviceId === selfId,
    }));
  }

  /** Persist the current settings mirror to this wallet's db. */
  private async persistRemoteSigning(): Promise<void> {
    if (this.currentWalletId != null) {
      await saveRemoteSigningSettings(this.currentWalletId, this.remoteSigning);
    }
  }

  /** Turn remote signing on/off for this wallet, restarting the bridge accordingly. */
  async setRemoteSigningEnabled(enabled: boolean): Promise<RemoteSigningSettings> {
    this.remoteSigning = trustSetEnabled(this.remoteSigning, enabled);
    await this.persistRemoteSigning();
    await this.reconfigureCrossDevice();
    return this.remoteSigning;
  }

  /** Set the signing policy (ask | require_remote). No re-bootstrap needed. */
  async setCrossDevicePolicy(policy: SigningPolicy): Promise<RemoteSigningSettings> {
    this.remoteSigning = trustSetPolicy(this.remoteSigning, policy);
    await this.persistRemoteSigning();
    return this.remoteSigning;
  }

  /** Pair (trust) a device currently visible in the registry, pinning its pubKey. */
  async trustCrossDevice(deviceId: string): Promise<RemoteSigningSettings> {
    const found = this.crossDevice?.getDevices().find((d) => d.deviceId === deviceId);
    if (!found) return this.remoteSigning; // not visible; nothing to pin
    // Fail closed: refuse to pin a device whose id does not derive from its key
    // (a relay listing an attacker key under a plausible id/label).
    if (!isDeviceIdConsistent(found.deviceId, found.pubKey)) {
      debugLog('cross-device: refusing to pin id/key mismatch for', found.deviceId);
      return this.remoteSigning;
    }
    // If the device supplied a wallet-control proof, it MUST verify against this
    // wallet's reward address (a present-but-invalid proof is always a rejection).
    // When REQUIRE_PROOF_TO_PAIR is off (current rollout state) an ABSENT proof
    // falls back to SAS + pin; when it flips on (coordinated with iOS) a missing
    // proof is also rejected. See crossDeviceTrust.ts REQUIRE_PROOF_TO_PAIR.
    let proofVerified = false;
    if (found.proof) {
      const ownStake = this.walletBg?.stakeAddress ?? '';
      const ok = await verifyDeviceRegisterProof(
        found.proof,
        { deviceId: found.deviceId, pubKey: found.pubKey },
        ownStake,
      );
      if (!ok) {
        debugLog('cross-device: refusing to pin — wallet-control proof invalid for', found.deviceId);
        return this.remoteSigning;
      }
      proofVerified = true;
    } else if (REQUIRE_PROOF_TO_PAIR) {
      debugLog('cross-device: refusing to pin — no wallet-control proof (fail-closed)', found.deviceId);
      return this.remoteSigning;
    }
    this.remoteSigning = trustAddDevice(
      this.remoteSigning,
      {
        deviceId: found.deviceId,
        pubKey: found.pubKey,
        label: found.label,
        platform: found.platform,
        verified: proofVerified,
        // Persist signing-capability so the Send gate + offline to-targeting can
        // recognise this device as a signer without it being online.
        hasSigningKey: found.hasSigningKey,
      },
      Math.floor(Date.now() / 1000),
    );
    await this.persistRemoteSigning();
    return this.remoteSigning;
  }

  /** Untrust a device. Its future requests/responses are dropped again. */
  async untrustCrossDevice(deviceId: string): Promise<RemoteSigningSettings> {
    this.remoteSigning = trustRemoveDevice(this.remoteSigning, deviceId);
    await this.persistRemoteSigning();
    return this.remoteSigning;
  }

  /**
   * Rebuild the cross-device bridge from the current server flag + per-wallet
   * settings without a full re-login. Used when the user toggles remote signing
   * on/off. If the socket is already open, re-register immediately (onSocketOpen
   * won't fire again for an existing connection).
   */
  private async reconfigureCrossDevice(): Promise<void> {
    const serverFlagOn = await this.isCrossDeviceSigningEnabled();
    if (!this.crossDeviceIdentity) {
      this.crossDeviceIdentity = await loadOrCreateDeviceIdentity();
    }
    this.crossDevice?.dispose();
    this.crossDevice = bootstrapCrossDeviceSigning({
      label: 'Gero Extension',
      hasSigningKey: true,
      identity: this.crossDeviceIdentity,
      enabled: serverFlagOn && this.remoteSigning.enabled,
      isRequesterTrusted: (id, pk) => isDeviceTrusted(this.remoteSigning, id, pk),
      isResponderTrusted: (id, pk) => isDeviceTrusted(this.remoteSigning, id, pk),
      getProof: () => this.crossDeviceProof ?? undefined,
      onPairConfirm: (frame) => void this.handlePairConfirm(frame),
    });
    if (this.crossDevice && webSocketService.isConnected()) {
      this.crossDevice.register();
    }
  }

  /**
   * Produce this device's wallet-control proof: sign the DEVICE_REGISTER subject
   * with the wallet's STAKE key (CIP-8 signData over the reward address), cache it
   * for this (identity, wallet), and re-register so it rides immediately. Called
   * from the enable flow where the user has just authenticated (password / PRF
   * privateKeyBytes). Returns true on success; a wrong password / cancelled
   * biometric throws inside signData and yields false (the caller leaves the
   * wallet not enabled). Only for Cardano software wallets with a stake address.
   */
  async produceDeviceRegisterProof(auth: { password?: string; privateKeyBytes?: Uint8Array }): Promise<boolean> {
    try {
      const walletBg = this.walletBg;
      if (!walletBg || walletBg.chain !== Blockchain.CARDANO) return false;
      const stakeAddress = walletBg.stakeAddress;
      if (!stakeAddress || !stakeAddress.startsWith('stake1')) return false; // no reward addr (enterprise/BTC)
      if (!this.crossDeviceIdentity) {
        this.crossDeviceIdentity = await loadOrCreateDeviceIdentity();
      }
      const subject = buildDeviceRegisterSubject(
        this.crossDeviceIdentity.deviceId,
        this.crossDeviceIdentity.pubKeyHex,
        stakeAddress,
      );
      const subjectBytes = new TextEncoder().encode(subject);
      let payloadHex = '';
      for (let i = 0; i < subjectBytes.length; i++) payloadHex += subjectBytes[i].toString(16).padStart(2, '0');
      const { signature, key } = await walletBg.signData(
        stakeAddress,
        payloadHex,
        auth.password ?? '',
        0,
        WalletStore.state.keys,
        auth.privateKeyBytes,
      );
      const proof: DeviceRegisterProof = { coseSign1: signature, coseKey: String(key), stakeAddress };
      await saveDeviceRegisterProof(this.crossDeviceIdentity.deviceId, stakeAddress, proof);
      this.crossDeviceProof = proof;
      // Re-send now so the relay + siblings get the proof without a reconnect.
      if (this.crossDevice && webSocketService.isConnected()) {
        this.crossDevice.register();
      }
      return true;
    } catch (e) {
      debugLog('produceDeviceRegisterProof failed:', e);
      return false;
    }
  }

  /**
   * Read isCrossDeviceSigningEnabled from chrome.storage.local. The UI's
   * featureFlagsStore mirrors flags there because the EventSource-based flag
   * service cannot initialize in this background service worker. Defaults to
   * false (feature dark) if storage is empty or unreadable.
   */
  private async isCrossDeviceSigningEnabled(): Promise<boolean> {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) {
        return false;
      }
      const flags = await new Promise<Record<string, unknown>>((resolve) => {
        chrome.storage.local.get('featureFlags', (result) => {
          resolve((result?.['featureFlags'] as Record<string, unknown>) ?? {});
        });
      });
      return flags['isCrossDeviceSigningEnabled'] === true;
    } catch {
      return false;
    }
  }

  /**
   * Close all other extension popup windows
   * TODO Close sideBar
   */
  private closeAllOtherExtensionPopups(): void {
    if (typeof chrome !== 'undefined' && chrome.windows) {
      chrome.windows.getCurrent(function (currentWindow) {
        const currentId = currentWindow.id;
        chrome.windows.getAll(function (windows) {
          windows.forEach(function (window) {
            if (window.id !== currentId && window.type === 'popup') {
              chrome.windows.remove(window.id!);
            }
          });
        });
      });
    }
  }
}

// Export singleton instance for convenience
export const walletManager = WalletManager.getInstance();
