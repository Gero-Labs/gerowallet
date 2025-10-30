import { WalletBg, alarmListener } from '@/chrome/walletBg';
import LoadingState from '@/stores/loading';
import WalletStore, { walletStore } from '@/stores/walletStore';
import zkFoldApi from '@/api/zk-fold.api';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType, Tip } from '@/models/types';
import DexHunterStore from '@/stores/dexHunterStore';
import BringStore from '@/stores/bringStore';
import TapToolsStore from '@/stores/tapToolsStore';
import ablyService from '@/services/ably.service';
import * as Ably from 'ably';
import { Mutex, withTimeout } from 'async-mutex';
import { clearDbCache } from '@/db/wallet-db';
import MusicStore from '@/stores/musicStore';
import NetworkStore from '@/stores/networkStore';
import { debugLog } from '@/utils/debug';

/**
 * WalletManager service to handle wallet login/logout and lifecycle management
 * Provides centralized management of wallet instances with proper cleanup
 */
export class WalletManager {
  private static instance: WalletManager;
  private walletBg: WalletBg | null = null;
  private currentWalletId: number | null = null;

  // Mutex declarations for sync operations
  public tipMutex = withTimeout(new Mutex(), 2 * 60_000);
  public syncMutex = withTimeout(new Mutex(), 2 * 60_000);

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
  async restore(wallet: any): Promise<WalletBg | null> {
    debugLog('WalletManager: Starting restore process');
    LoadingState.setText('Restoring wallet instance...');
    LoadingState.setLoading(true);

    try {
      // Clean up an existing wallet if different
      if (this.walletBg && this.currentWalletId !== wallet.id) {
        await this.logout();
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
        });
        LoadingState.setText('Restoring wallet...');
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;
        this.currentWalletId = wallet.id;

        await walletBg.syncService.resync();

        LoadingState.setText('Wallet ready');

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
  async login(wallet: any): Promise<WalletBg | null> {
    debugLog('WalletManager: Starting login process');
    LoadingState.setText('Creating wallet instance...');
    LoadingState.setLoading(true);

    try {
      // Clean up an existing wallet if different
      if (this.walletBg && this.currentWalletId !== wallet.id) {
        await this.logout();
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
        });
        LoadingState.setText('Initializing wallet...');
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;
        this.currentWalletId = wallet.id;

        // OPTIMIZATION: Use REST sync on login to get tip immediately
        // This prevents "Cannot read properties of null (reading 'slot')" errors
        // when trying to send transactions before Ably sync completes
        LoadingState.setText('Syncing wallet data...');
        await this.walletBg.syncService.syncViaRest().catch(err => {
          console.warn('REST sync failed during login (non-critical):', err);
          // Fall back to regular Ably sync if REST fails
        });

        LoadingState.setText('Wallet ready');

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
    const perfStart = performance.now();
    console.log('⏱️ PERF: initializeWallet START');

    LoadingState.setText('Setting up wallet address...');
    const promises = [];

    if (walletBg.type === WalletType.Google) {
      const googleStart = performance.now();
      promises.push(
        zkFoldApi.walletAddress(walletBg.userId).then(res => {
          console.log(`⏱️ PERF: zkFoldApi.walletAddress took ${performance.now() - googleStart}ms`);
          if (res['status'] !== 200) {
            throw new Error('Failed to get address');
          }
          walletBg.baseAddress = res['data']['address'];
        })
      );
    }

    LoadingState.setText('Loading blockchain data...');
    const genesisStart = performance.now();
    walletBg.loadGenesis();
    console.log(`⏱️ PERF: loadGenesis took ${performance.now() - genesisStart}ms`);

    const promises2: any[] = [];
    const assetsStart = performance.now();
    promises2.push(
      walletBg.loadAssets().then(() => console.log(`⏱️ PERF: loadAssets took ${performance.now() - assetsStart}ms`)),
      walletBg.loadEpochParams().then(() => console.log(`⏱️ PERF: loadEpochParams took ${performance.now() - assetsStart}ms`))
    );
    if (networks.resolveStakingSupport(walletBg.chain, walletBg.network)) {
      const rewardsStart = performance.now();
      promises2.push(
        walletBg.loadRewards().then(() => console.log(`⏱️ PERF: loadRewards took ${performance.now() - rewardsStart}ms`))
      );
    }

    // OPTIMIZATION: Defer non-critical data to load in background after wallet initialization
    // This reduces blocking time during login by ~366ms (349ms BringCache + 17ms DexHunter)
    const blockchainDataStart = performance.now();
    await Promise.all(promises2);
    console.log(`⏱️ PERF: Promise.all(blockchain data) took ${performance.now() - blockchainDataStart}ms`);

    LoadingState.setText('Loading wallet data...');
    const startSyncStart = performance.now();
    const loadConfigStart = performance.now();
    const loadAccountStart = performance.now();
    const loadContactsStart = performance.now();
    const loadDappsStart = performance.now();
    const loadTxStart = performance.now();

    promises.push(
      walletBg.startSync().then(() => console.log(`⏱️ PERF: startSync took ${performance.now() - startSyncStart}ms`)),
      walletBg.loadConfig().then(() => console.log(`⏱️ PERF: loadConfig took ${performance.now() - loadConfigStart}ms`)),
      walletBg.loadAccount().then(() => console.log(`⏱️ PERF: loadAccount took ${performance.now() - loadAccountStart}ms`)),
      walletBg.loadContacts().then(() => console.log(`⏱️ PERF: loadContacts took ${performance.now() - loadContactsStart}ms`)),
      walletBg.loadConnectedDapps().then(() => console.log(`⏱️ PERF: loadConnectedDapps took ${performance.now() - loadDappsStart}ms`)),
      walletBg.loadTransactions().then(() => console.log(`⏱️ PERF: loadTransactions took ${performance.now() - loadTxStart}ms`))
    );

    const chain: string = Object.keys(Blockchain).find(key => Blockchain[key] === walletBg.chain);
    const network: string = Object.keys(Network).find(key => Network[key] === walletBg.network);
    let address: string;
    if (walletBg.isEnterpriseAddress()) {
      address = walletBg.baseAddress;
    } else {
      address = walletBg.stakeAddress;
    }

    debugLog('🔍 Wallet initialization debug:', {
      chain,
      network,
      address,
      baseAddress: walletBg.baseAddress,
      stakeAddress: walletBg.stakeAddress,
      isEnterpriseAddress: walletBg.isEnterpriseAddress(),
    });

    debugLog('🔐 Setting up Ably service for wallet switch:', {
      walletId: walletBg.id,
      chain,
      network,
      address,
      baseAddress: walletBg.baseAddress,
      stakeAddress: walletBg.stakeAddress,
    });
    debugLog('🔐 Ably service current state before setup:', {
      connectionState: ablyService['client']?.connection?.state,
      hasAuthParams: !!ablyService['authParams'],
      currentAuthParams: ablyService['authParams'],
      hasApi: !!ablyService['api'],
      apiChain: ablyService['api']?.chain,
      apiNetwork: ablyService['api']?.network,
    });

    // Force close existing connection if any to ensure fresh authentication
    ablyService.close();
    debugLog('🔐 Closed existing Ably connection, setting new auth params...');

    ablyService.setAuthParams(chain, network, address);
    ablyService.setApi(walletBg.api);
    debugLog('📡 New API instance details:', {
      chain: walletBg.api.chain,
      network: walletBg.api.network,
      provider: walletBg.api.provider,
    });
    debugLog('📡 Connecting to Ably service...');

    // OPTIMIZATION: Connect to Ably completely in background - don't block login at all
    // Ably will handle reconnection and message buffering automatically
    (async () => {
      const ablyStart = performance.now();
      ablyService.connect();

      // Wait for connection to be established (non-blocking, happens in background)
      const maxWaitTime = 10000; // 10-second max
      const startTime = Date.now();
      while (ablyService['client']?.connection?.state !== 'connected' && Date.now() - startTime < maxWaitTime) {
        debugLog('⏳ Waiting for Ably connection... Current state:', ablyService['client']?.connection?.state);
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (ablyService['client']?.connection?.state !== 'connected') {
        console.warn('⚠️ Ably connection not established after timeout, will retry automatically');
        return; // Don't subscribe if not connected
      } else {
        console.log(`⏱️ PERF: Ably connection took ${performance.now() - ablyStart}ms`);
        debugLog('✅ Ably connection established');
      }

      // TODO: Private channel subscription - Reserved for future push notifications
      // Use cases: Multisig signatures, price alerts, governance updates
      // Commented out for now since sync is handled via REST API
      /*
      try {
        await ablyService.subscribeToPrivateChannel(address, {
          onMessage: async (msg: Ably.InboundMessage) => {
            // TODO: Implement notification handlers
            switch (msg.name) {
              case 'MULTISIG_UPDATE':
                // Handle multisig signature notifications
                break;
              case 'PRICE_ALERT':
                // Handle price alert notifications
                break;
              default:
                debugLog('📬 Unhandled message on private channel:', msg);
            }
          }
        });
        console.log('✅ Subscribed to Ably private channel');
      } catch (error: any) {
        console.warn('⚠️ Failed to subscribe to private channel (non-critical):', error.message || error);
      }
      */

      // Subscribe to group channel (in background)
      try {
        await ablyService.subscribeToGroupChannel(chain, network, {
          onTip: async (msg: Ably.InboundMessage) => {
            try {
              const tip = JSON.parse(msg.data)?.data as Tip;

              // Quick validation checks before logging
              if (ablyService.isTipProcessed(tip.hash) || !tip.epoch) {
                return;
              }

              // Validate tip is newer than current tip before processing
              const currentTip = NetworkStore.state.tip;
              if (currentTip && tip.height <= currentTip.blockNo) {
                return; // Silent skip - tip is older or same as current
              }

              // Also check if we already requested sync for this tip height
              const lastSyncInfo = await walletBg.getLastSyncInfo();
              if (lastSyncInfo && tip.height <= lastSyncInfo['height']) {
                return; // Silent skip - already synced to this height or beyond
              }

              // Mark as processed BEFORE starting sync to prevent duplicates
              ablyService.markTipAsProcessed(tip.hash);

              debugLog('TIP', tip);

              // Acquire mutex and process tip
              await this.tipMutex.runExclusive(async () => {
                await walletBg.syncService.sync(tip);
              });
            } catch (e) {
              console.error(e);
            }
          },
        });
        console.log('✅ Subscribed to Ably group channel');
      } catch (error: any) {
        console.warn('⚠️ Failed to subscribe to group channel (non-critical):', error.message || error);
      }
    })(); // Execute immediately but don't await - fully non-blocking

    // Wait for all initialization promises to complete
    LoadingState.setText('Initializing wallet...');
    const promiseAllStart = performance.now();
    await Promise.all(promises);
    console.log(`⏱️ PERF: Final Promise.all(promises) took ${performance.now() - promiseAllStart}ms`);
    console.log(`⏱️ PERF: TOTAL initializeWallet took ${performance.now() - perfStart}ms`);

    LoadingState.setText('Wallet initialization complete');

    // OPTIMIZATION: Load non-critical data in background after wallet is ready
    // This improves perceived performance by not blocking the login flow
    // DexHunter swap tokens (~17ms), blacklist policies (~9ms), BringCache (~349ms)
    setTimeout(async () => {
      if (networks.resolveSwapSupport(walletBg.chain, walletBg.network)) {
        // Load DexHunter tokens first - this provides verification status
        await DexHunterStore.loadTokens().catch(err => console.warn('Failed to load DexHunter tokens:', err));

        // Re-resolve assets after DexHunter tokens are loaded to update verified status
        const utxos = walletStore.utxos;
        if (utxos && utxos.length > 0) {
          walletBg.setAssets(utxos);
        }

        DexHunterStore.loadBlacklistPolicies().catch(err => console.warn('Failed to load blacklist policies:', err));
      }
      if (networks.resolveCashbackSupport(walletBg.chain, walletBg.network)) {
        BringStore.loadBringCache(walletBg.baseAddress).catch(err => console.warn('Failed to load Bring cache:', err));
      }
    }, 100); // Small delay to ensure wallet is fully initialized
  }

  /**
   * Logout current wallet and cleanup all resources
   */
  async logout(): Promise<void> {
    debugLog('WalletManager: Starting logout process');

    try {
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

      // Clean up Ably service
      try {
        if (ablyService && typeof ablyService.unsubscribeAll === 'function') {
          ablyService.unsubscribeAll();
        }
        if (ablyService && typeof ablyService.close === 'function') {
          ablyService.close();
          console.log('Ably service closed successfully');
        }
      } catch (ablyError) {
        console.warn('Failed to cleanup Ably service during logout:', ablyError);
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

      // Stop sync intervals before clearing wallet data
      try {
        if (this.walletBg) {
          this.walletBg.endSync();
          debugLog('WalletBg sync intervals cleared during logout');
        }
      } catch (syncError) {
        console.warn('Failed to end sync during logout:', syncError);
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
   * Get current wallet instance
   * @returns Current WalletBg instance or null
   */
  getWallet(): WalletBg | null {
    return this.walletBg;
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
