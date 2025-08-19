import { WalletBg, alarmListener } from '@/chrome/walletBg';
import LoadingState from '@/stores/loading';
import WalletStore from '@/stores/walletStore';
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
   * Login with a wallet
   * @param wallet - Wallet data to login with
   * @returns WalletBg instance or null if failed
   */
  async login(wallet: any): Promise<WalletBg | null> {
    console.debug('WalletManager: Starting login process');
    LoadingState.setText('Creating wallet instance...');
    LoadingState.setLoading(true);

    try {
      // Clean up existing wallet if different
      if (this.walletBg && this.currentWalletId !== wallet.id) {
        await this.logout();
      }

      // Create new wallet instance if needed
      if (!this.walletBg || this.currentWalletId !== wallet.id) {
        console.debug('Creating new WalletBg instance for wallet:', wallet.id);

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
          token: walletBg.token
        });
        LoadingState.setText('Initializing wallet...');
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;
        this.currentWalletId = wallet.id;

        LoadingState.setText('Wallet ready');

        console.debug('Wallet login successful for wallet:', wallet.id);
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
    const promises = []

    if (walletBg.type === WalletType.Google) {
      promises.push(zkFoldApi.walletAddress(walletBg.userId).then(res => {
        if (res['status'] !== 200) {
          throw new Error('Failed to get address');
        }
        walletBg.baseAddress = res['data']['address']
      }))
    }

    LoadingState.setText('Loading blockchain data...');
    walletBg.loadGenesis()
    const promises2: any[] = []
    promises2.push(walletBg.loadAssets(), walletBg.loadEpochParams())
    if (networks.resolveStakingSupport(walletBg.chain, walletBg.network)) {
      promises2.push(walletBg.loadPools())
      promises2.push(walletBg.loadRewards())
    }
    if (networks.resolveSwapSupport(walletBg.chain, walletBg.network)) {
      promises2.push(walletBg.loadDReps())
    }
    if (networks.resolveSwapSupport(walletBg.chain, walletBg.network)) {
      promises2.push(DexHunterStore.loadTokens())
      promises2.push(DexHunterStore.loadBlacklistPolicies())
    }
    if (networks.resolveCashbackSupport(walletBg.chain, walletBg.network)) {
      promises2.push(BringStore.loadBringCache(walletBg.baseAddress))
    }
    await Promise.all(promises2)

    LoadingState.setText('Loading wallet data...');
    promises.push(
      walletBg.startSync(),
      walletBg.loadConfig(),
      walletBg.loadAccount(),
      walletBg.loadContacts(),
      walletBg.loadConnectedDapps(),
      walletBg.loadTransactions(),
    )

    const chain = Object.keys(Blockchain).find(key => Blockchain[key] === walletBg.chain);
    const network = Object.keys(Network).find(key => Network[key] === walletBg.network);
    let address: string;
    if (walletBg.isEnterpriseAddress()) {
      address = walletBg.baseAddress;
    } else {
      address = walletBg.stakeAddress;
    }

    console.debug('🔍 Wallet initialization debug:', {
      chain,
      network,
      address,
      baseAddress: walletBg.baseAddress,
      stakeAddress: walletBg.stakeAddress,
      isEnterpriseAddress: walletBg.isEnterpriseAddress()
    });

    console.debug('🔐 Setting up Ably service for wallet switch:', {
      walletId: walletBg.id,
      chain,
      network,
      address,
      baseAddress: walletBg.baseAddress,
      stakeAddress: walletBg.stakeAddress
    });
    console.debug('🔐 Ably service current state before setup:', {
      connectionState: ablyService['client']?.connection?.state,
      hasAuthParams: !!ablyService['authParams'],
      currentAuthParams: ablyService['authParams'],
      hasApi: !!ablyService['api'],
      apiChain: ablyService['api']?.chain,
      apiNetwork: ablyService['api']?.network
    });

    // Force close existing connection if any to ensure fresh authentication
    ablyService.close();
    console.debug('🔐 Closed existing Ably connection, setting new auth params...');

    ablyService.setAuthParams(chain, network, address);
    ablyService.setApi(walletBg.api);
    console.debug('📡 New API instance details:', {
      chain: walletBg.api.chain,
      network: walletBg.api.network,
      provider: walletBg.api.provider
    });
    console.debug('📡 Connecting to Ably service...');
    ablyService.connect();

    // Wait longer for authentication to complete before subscribing
    // This ensures the auth callback has time to fetch a fresh token
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.debug('🔐 Connection state after delay:', ablyService['client']?.connection?.state);

    // Additional check - wait for connection to be established
    const maxWaitTime = 10000; // 10-second max
    const startTime = Date.now();
    while (ablyService['client']?.connection?.state !== 'connected' && (Date.now() - startTime) < maxWaitTime) {
      console.debug('⏳ Waiting for Ably connection... Current state:', ablyService['client']?.connection?.state);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (ablyService['client']?.connection?.state !== 'connected') {
      console.warn('⚠️ Ably connection not established after timeout, proceeding anyway');
    } else {
      console.debug('✅ Ably connection established, proceeding with subscriptions');
    }

    promises.push(
      ablyService.subscribeToPrivateChannel(address, {
        onSync: async (msg: Ably.InboundMessage) => {
          console.debug('SYNC::🔄 SYNC message received on private channel!', msg);
          try {
            if (this.syncMutex.isLocked()) {
              console.debug('SYNC::⏳ Sync mutex is locked, skipping');
              return;
            }
            this.syncMutex.runExclusive(async () => {
              LoadingState.setText('');
              LoadingState.setSyncing(true);
              const syncObject = JSON.parse(msg.data);
              console.debug('SYNC::📊 Processing sync object:', syncObject);
              if (!ablyService.isTipProcessed(syncObject.block.hash)) {
                ablyService.markTipAsProcessed(syncObject.block.hash);
              }
              await walletBg.syncService.setSync(syncObject);
              LoadingState.setSyncing(false);
            });
          } catch (e) {
            console.error('SYNC::❌ Error processing sync message:', e);
          }
        },
        onMessage: async (msg: Ably.InboundMessage) => {
          console.debug('SYNC::📬 General message received on private channel:', msg);
        }
      }).catch(error => {
        console.warn('SYNC::⚠️ Failed to subscribe to private channel (non-critical):', error.message || error);
        // Continue wallet initialization even if Ably private channel fails
      })
    );

    // Subscribe to group channel
    promises.push(
      ablyService.subscribeToGroupChannel(chain, network, {
        onTip: async (msg: Ably.InboundMessage) => {
          try {
            if (this.tipMutex.isLocked()) {
              console.debug('⏳ Tip mutex is locked, skipping');
              return;
            }
            const tip = JSON.parse(msg.data)?.data as Tip;
            console.debug('TIP', tip);
            if (ablyService.isTipProcessed(tip.hash) || !tip.epoch) {
              return;
            }
            this.tipMutex.runExclusive(() => {
              walletBg.syncService.sync(tip);
            })
              .catch(err => {
                console.error('TIP processing failed', err);
              });
          } catch (e) {
            console.error(e);
          }
        }
      }).catch(error => {
        console.warn('⚠️ Failed to subscribe to group channel (non-critical):', error.message || error);
        // Continue wallet initialization even if Ably group channel fails
      })
    );

    // Wait for all initialization promises to complete
    LoadingState.setText('Initializing wallet...');
    await Promise.all(promises);

    LoadingState.setText('Wallet initialization complete');
  }

  /**
   * Logout current wallet and cleanup all resources
   */
  async logout(): Promise<void> {
    console.debug('WalletManager: Starting logout process');

    try {
      // Clear database cache for current wallet to prevent data leakage
      if (this.currentWalletId !== null) {
        console.debug('Clearing database cache for wallet:', this.currentWalletId);
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

      // Note: Don't send logout message to background since this method
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
          window.dispatchEvent(new CustomEvent('gero:logout', {
            bubbles: true,
            cancelable: true,
            composed: false,
          }));
        }
      } catch (eventError) {
        console.warn('Failed to dispatch logout event:', eventError);
      }

      console.debug('WalletManager: Logout completed successfully');
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
      chrome.windows.getCurrent(function(currentWindow) {
        const currentId = currentWindow.id;
        chrome.windows.getAll(function(windows) {
          windows.forEach(function(window) {
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
