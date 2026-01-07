import { WalletBg, alarmListener } from '@/chrome/walletBg';
import LoadingState from '@/stores/loading';
import WalletStore, { walletStore } from '@/stores/walletStore';
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
import { Cardano } from '@cardano-sdk/core';
import zkFoldApi from '@/api/zkFoldApi';

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
          btSupported: walletBg.btSupported,
          xfp: walletBg.xfp,
        });
        LoadingState.setText('Restoring wallet...');
        await this.initializeWallet(walletBg);

        this.walletBg = walletBg;
        this.currentWalletId = wallet.id;

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
        let walletBg: WalletBg
        if (wallet.type === WalletType.Google) {
          const smartBaseAddress: Cardano.Address = await zkFoldApi.walletAddress(wallet.userId)
          walletBg = new WalletBg(wallet, smartBaseAddress.toBech32())
        } else {
          walletBg = new WalletBg(wallet);
        }
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
      //   zkFoldApi.walletAddress(walletBg.userId).then(res => {
      //     if (res['status'] !== 200) {
      //       throw new Error('Failed to get address');
      //     }
      //     walletBg.baseAddress = res['data']['address'];
      //   })
      // );
    }

    LoadingState.setText('Loading blockchain data...');
    walletBg.loadGenesis();

    const promises2: any[] = [];
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

    promises.push(
      walletBg.startSync(),
      walletBg.loadConfig(),
      walletBg.loadAccount(),
      walletBg.loadContacts(),
      walletBg.loadConnectedDapps(),
      walletBg.loadTransactions()
    );

    const chain: string = Object.keys(Blockchain).find(key => Blockchain[key] === walletBg.chain);
    const network: string = Object.keys(Network).find(key => Network[key] === walletBg.network);
    let address: string;
    if (walletBg.isEnterpriseAddress() || walletBg.type === WalletType.Google) {
      address = walletBg.baseAddress;
    } else {
      address = walletBg.stakeAddress;
    }

    // Force close existing connection if any to ensure fresh authentication
    ablyService.close();

    ablyService.setAuthParams(chain, network, address);
    ablyService.setApi(walletBg.api);

    // OPTIMIZATION: Connect to Ably completely in background - don't block login at all
    // Ably will handle reconnection and message buffering automatically
    (async () => {
      ablyService.connect();

      // Wait for connection to be established (non-blocking, happens in background)
      const maxWaitTime = 10000; // 10-second max
      const startTime = Date.now();
      while (ablyService['client']?.connection?.state !== 'connected' && Date.now() - startTime < maxWaitTime) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      if (ablyService['client']?.connection?.state !== 'connected') {
        console.warn('⚠️ Ably connection not established after timeout, will retry automatically');
        return; // Don't subscribe if not connected
      } else {
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
    await Promise.all(promises);

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
   * Lock the current wallet
   * Keeps WalletBg instance intact for CIP-30 functionality
   * User must unlock with PIN/Pattern/Spending Password + 2FA (not supported for now) to access UI
   */
  async lock(): Promise<void> {
    try {
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

    if (unlockMethod === 'password') {
      // Spending password unlock method
      if (useWalletBg) {
        // Post-login: use walletBg instance
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

        unlockValid = this.walletBg.verifySpendingPassword(unlockCredential as string);
      } else {
        // Pre-login: load wallet from database
        const { getAllWallets } = await import('@/db/gero-db');
        const walletsMap = await getAllWallets();
        const wallet = walletsMap[walletId];

        if (!wallet || wallet.type !== WalletType.Normal) {
          throw new Error('Password unlock is only supported for Normal wallets');
        }

        const encryptedPrivateKey = wallet.encryptedPrivateKey;
        if (!encryptedPrivateKey || !unlockCredential) {
          throw new Error('Encrypted private key not found or password not provided');
        }

        // Verify password by attempting to decrypt
        try {
          const { decryptWithPassword } = await import('@/shared/utils/crypto');
          decryptWithPassword(unlockCredential as string, encryptedPrivateKey);
          unlockValid = true;
        } catch (error) {
          unlockValid = false;
        }
      }
    } else if (unlockCredential === 'passkey-authenticated') {
      // Check if PassKey authentication was used (credential is a special string)
      // PassKey verification handled by WebAuthn in the UI
      // If we reach here, PassKey verification already passed
      unlockValid = true;
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
