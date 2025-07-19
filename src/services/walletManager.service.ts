import { login, WalletBg } from '@/chrome/walletBg';

/**
 * WalletManager service to handle WalletBg instance lifecycle
 * Provides centralized management of wallet instances with proper cleanup
 */
export class WalletManager {
  private static instance: WalletManager;
  private walletBg: WalletBg | null = null;
  private currentWalletId: number | null = null;

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
   * Set or create a wallet instance
   * @param walletData - Wallet data to create instance from
   * @returns WalletBg instance or null if failed
   */
  async setWallet(walletData: any): Promise<WalletBg | null> {
    try {
      // Clean up existing wallet if different
      if (this.walletBg && this.currentWalletId !== walletData.id) {
        await this.clearWallet();
      }

      // Create new wallet instance if needed
      if (!this.walletBg || this.currentWalletId !== walletData.id) {
        console.log('Creating new WalletBg instance for wallet:', walletData.id);
        this.walletBg = await login(walletData);
        this.currentWalletId = walletData.id;
      }

      return this.walletBg;
    } catch (error) {
      console.error('Error setting wallet:', error);
      await this.clearWallet();
      return null;
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
   * Get current wallet ID
   * @returns Current wallet ID or null
   */
  getCurrentWalletId(): number | null {
    return this.currentWalletId;
  }

  /**
   * Clear and cleanup current wallet instance
   */
  async clearWallet(): Promise<void> {
    try {
      if (this.walletBg) {
        console.log('Cleaning up WalletBg instance for wallet:', this.currentWalletId);
        await this.walletBg.logout();
        this.walletBg = null;
        this.currentWalletId = null;
      }
    } catch (error) {
      console.error('Error during wallet cleanup:', error);
      // Force cleanup even if logout fails
      this.walletBg = null;
      this.currentWalletId = null;
    }
  }

  /**
   * Check if wallet is currently active
   * @returns True if wallet instance exists
   */
  isWalletActive(): boolean {
    return this.walletBg !== null;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  static resetInstance(): void {
    if (WalletManager.instance) {
      WalletManager.instance.clearWallet();
      WalletManager.instance = null as any;
    }
  }
}

// Export singleton instance for convenience
export const walletManager = WalletManager.getInstance();

// TypeScript declarations for global properties
declare global {
  var walletManager: WalletManager;
  var wallet: WalletBg | null; // Read-only getter via walletManager
}