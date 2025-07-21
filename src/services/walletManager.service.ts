import { WalletBg } from '@/chrome/walletBg';
import LoadingState from '@/stores/loading';
import WalletStore from '@/stores/walletStore';
import { STORAGE } from '@/chrome/config';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import zkFoldApi from '@/api/zk-fold.api';
import networks from '@/utils/networks';
import { Blockchain, Network, WalletType, Tip } from '@/models/types';
import DexHunterStore from '@/stores/dexHunterStore';
import BringStore from '@/stores/bringStore';
import ablyService from '@/services/ably.service';
import * as Ably from 'ably';
import { Mutex, withTimeout } from 'async-mutex';

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
   * Get singleton instance of WalletManager
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
    console.log('WalletManager: Starting login process');
    LoadingState.setText('Creating wallet instance...');
    LoadingState.setLoading(true);

    try {
      // Clean up existing wallet if different
      if (this.walletBg && this.currentWalletId !== wallet.id) {
        await this.logout();
      }

      // Create new wallet instance if needed
      if (!this.walletBg || this.currentWalletId !== wallet.id) {
        console.log('Creating new WalletBg instance for wallet:', wallet.id);

        const walletBg: WalletBg = new WalletBg(wallet);
        WalletStore.setLoggedWallet(walletBg);

        LoadingState.setText('Initializing wallet...');
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;
        this.currentWalletId = wallet.id;

        LoadingState.setText('Wallet ready');
        LoadingState.setLoading(false);

        console.log('Wallet login successful for wallet:', wallet.id);
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

    console.log('🔍 Wallet initialization debug:', {
      chain,
      network,
      address,
      baseAddress: walletBg.baseAddress,
      stakeAddress: walletBg.stakeAddress,
      isEnterpriseAddress: walletBg.isEnterpriseAddress()
    });

    console.log('🔐 Setting up Ably service:', { chain, network, address });
    ablyService.setAuthParams(chain, network, address);
    ablyService.setApi(walletBg.api);
    console.log('📡 Connecting to Ably service...');
    ablyService.connect();

    promises.push(
      ablyService.subscribeToPrivateChannel(address, {
        onSync: async (msg: Ably.InboundMessage) => {
          console.log('🔄 SYNC message received on private channel!', msg);
          try {
            if (this.syncMutex.isLocked()) {
              console.log('⏳ Sync mutex is locked, skipping');
              return;
            }
            this.syncMutex.runExclusive(async () => {
              LoadingState.setText('');
              LoadingState.setConnected(true);
              LoadingState.setSyncing(true);
              const syncObject = JSON.parse(msg.data);
              console.log('📊 Processing sync object:', syncObject);
              if (!ablyService.isTipProcessed(syncObject.block.hash)) {
                ablyService.markTipAsProcessed(syncObject.block.hash);
              }
              await walletBg.setSync(syncObject);
              LoadingState.setSyncing(false);
            });
          } catch (e) {
            console.error('❌ Error processing sync message:', e);
          } finally {
            LoadingState.setRestoring(false);
          }
        },
        onMessage: async (msg: Ably.InboundMessage) => {
          console.log('📬 General message received on private channel:', msg);
        }
      })
    );

    // Subscribe to group channel
    promises.push(
      ablyService.subscribeToGroupChannel(chain, network, {
        onTip: async (msg: Ably.InboundMessage) => {
          try {
            if (this.tipMutex.isLocked()) {
              console.log('⏳ Tip mutex is locked, skipping');
              return;
            }
            const tip = JSON.parse(msg.data)?.data as Tip;
            console.log('TIP', tip);
            if (ablyService.isTipProcessed(tip.hash) || !tip.epoch) {
              return;
            }
            this.tipMutex.runExclusive(() => {
              walletBg.sync(tip);
            })
              .catch(err => {
                console.error('TIP processing failed', err);
              });
          } catch (e) {
            console.error(e);
          }
        }
      })
    );

    // Wait for all initialization promises to complete
    LoadingState.setText('Finalizing wallet setup...');
    await Promise.all(promises);

    LoadingState.setText('Wallet initialization complete');
  }

  /**
   * Logout current wallet and cleanup all resources
   */
  async logout(): Promise<void> {
    console.log('WalletManager: Starting logout process');

    try {
      // Close extension popups and cleanup subscriptions
      this.closeAllOtherExtensionPopups();

      // Clean up alarms
      if (chrome?.alarms?.onAlarm?.hasListeners()) {
        const { alarmListener } = await import('@/chrome/walletBg');
        chrome.alarms.onAlarm.removeListener(alarmListener);
      }

      // Clean up Ably service
      ablyService.unsubscribeAll();
      ablyService.close();

      // Send logout message to background
      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.LOGOUT,
        data: {},
      });

      // Clear Chrome storage
      if (chrome?.storage) {
        await Promise.all([
          chrome.storage.local.remove(STORAGE.whitelisted),
          chrome.storage.local.remove('loggedWallet'),
          chrome.storage.local.set({ [STORAGE.utxos]: new Map() }),
          chrome.storage.local.set({ [STORAGE.addresses]: new Set() }),
        ]);
      }

      // Clear wallet store data
      WalletStore.logout();

      // Reset service state
      this.walletBg.unsubscribeAll();
      this.walletBg = null;
      this.currentWalletId = null;

      // Dispatch logout event
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('gero:logout', {
          bubbles: true,
          cancelable: true,
          composed: false,
        }));
      }

      console.log('WalletManager: Logout completed successfully');
    } catch (error) {
      console.error('Error during wallet logout:', error);
      // Force cleanup even if logout fails
      this.walletBg?.unsubscribeAll();
      this.walletBg = null;
      this.currentWalletId = null;
      WalletStore.logout();
    }
  }

  /**
   * Set or create a wallet instance (legacy method for backward compatibility)
   * @param walletData - Wallet data to create instance from
   * @returns WalletBg instance or null if failed
   */
  async setWallet(walletData: any): Promise<WalletBg | null> {
    return await this.login(walletData);
  }

  /**
   * Get current wallet instance
   * @returns Current WalletBg instance or null
   */
  getWallet(): WalletBg | null {
    return this.walletBg;
  }

  /**
   * Get current wallet ID
   * @returns Current wallet ID or null
   */
  getCurrentWalletId(): number | null {
    return this.currentWalletId;
  }

  /**
   * Clear and cleanup current wallet instance (legacy method)
   */
  async clearWallet(): Promise<void> {
    await this.logout();
  }

  /**
   * Check if wallet is currently active
   * @returns True if wallet instance exists
   */
  isWalletActive(): boolean {
    return this.walletBg !== null;
  }

  /**
   * Close all other extension popup windows
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

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    if (WalletManager.instance) {
      WalletManager.instance.logout();
      WalletManager.instance = null as any;
    }
  }
}

// Export singleton instance for convenience
export const walletManager = WalletManager.getInstance();
