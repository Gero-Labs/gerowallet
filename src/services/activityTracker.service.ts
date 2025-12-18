/**
 * Activity Tracker Service
 *
 * Monitors user activity and updates the lastActivityTimestamp in the database.
 * This is used for auto-lock functionality - the wallet automatically locks
 * after a period of inactivity based on the configured auto-lock timer.
 *
 * Activity is considered when:
 * 1. The wallet tab is visible/active (using Page Visibility API)
 * 2. User interacts with the page (mouse, keyboard, touch, scroll)
 */

import { getDb } from '@/db/wallet-db';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';

class ActivityTrackerService {
  private isTracking = false;
  private debounceTimeout: number | null = null;
  private visibilityIntervalId: number | null = null;
  private lastUpdate = 0;
  private readonly UPDATE_INTERVAL = 10000; // Update every 10 seconds max
  private readonly VISIBILITY_UPDATE_INTERVAL = 30000; // Update every 30 seconds when tab is visible

  /**
   * Start tracking user activity
   */
  public start(): void {
    if (this.isTracking) {
      debugLog('⏱️ Activity tracker already running');
      return;
    }

    debugLog('⏱️ Starting activity tracker');
    this.isTracking = true;
    this.updateLastActivity(); // Update immediately on start

    // Listen for user activity events (for when tab is visible)
    window.addEventListener('mousemove', this.handleActivity);
    window.addEventListener('mousedown', this.handleActivity);
    window.addEventListener('keydown', this.handleActivity);
    window.addEventListener('scroll', this.handleActivity);
    window.addEventListener('touchstart', this.handleActivity);

    // Listen for tab visibility changes
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Start visibility-based updates if tab is currently visible
    if (!document.hidden) {
      this.startVisibilityUpdates();
    }
  }

  /**
   * Stop tracking user activity
   */
  public stop(): void {
    if (!this.isTracking) {
      return;
    }

    debugLog('⏱️ Stopping activity tracker');
    this.isTracking = false;

    // Remove event listeners
    window.removeEventListener('mousemove', this.handleActivity);
    window.removeEventListener('mousedown', this.handleActivity);
    window.removeEventListener('keydown', this.handleActivity);
    window.removeEventListener('scroll', this.handleActivity);
    window.removeEventListener('touchstart', this.handleActivity);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);

    // Clear any pending updates
    if (this.debounceTimeout) {
      clearTimeout(this.debounceTimeout);
      this.debounceTimeout = null;
    }

    // Stop visibility-based updates
    this.stopVisibilityUpdates();
  }

  /**
   * Handle activity event (debounced)
   */
  private handleActivity = (): void => {
    if (!this.isTracking) return;

    // Debounce: only update if enough time has passed since last update
    const now = Date.now();
    if (now - this.lastUpdate < this.UPDATE_INTERVAL) {
      // Still within debounce window, schedule update for later
      if (this.debounceTimeout) {
        clearTimeout(this.debounceTimeout);
      }
      this.debounceTimeout = window.setTimeout(() => {
        this.updateLastActivity();
      }, this.UPDATE_INTERVAL);
      return;
    }

    // Enough time has passed, update immediately
    this.updateLastActivity();
  };

  /**
   * Handle tab visibility changes
   */
  private handleVisibilityChange = (): void => {
    if (!this.isTracking) return;

    if (document.hidden) {
      // Tab is hidden - stop periodic updates
      debugLog('⏱️ Tab hidden, stopping visibility-based updates');
      this.stopVisibilityUpdates();
    } else {
      // Tab is visible - check if wallet should be locked immediately
      // (in case the lock time passed while tab was closed)
      debugLog('⏱️ Tab visible, checking auto-lock status');
      this.checkAutoLockImmediate();

      // Then start periodic updates and update activity timestamp
      this.updateLastActivity();
      this.startVisibilityUpdates();
    }
  };

  /**
   * Trigger an immediate auto-lock check in the background script
   */
  private async checkAutoLockImmediate(): Promise<void> {
    try {
      // Import Messaging dynamically to avoid circular dependencies
      const { Messaging } = await import('@/chrome/messaging');
      const { MessageTypes } = await import('@/models/MessageTypes');

      // Send message to background to check auto-lock immediately
      // Use sendToBackgroundFromOptions since CHECK_AUTO_LOCK is registered with addToOptions
      await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.CHECK_AUTO_LOCK,
        data: {}
      });
    } catch (error) {
      console.error('❌ Failed to trigger auto-lock check:', error);
    }
  }

  /**
   * Start periodic activity updates while tab is visible
   */
  private startVisibilityUpdates(): void {
    // Clear any existing interval first
    this.stopVisibilityUpdates();

    // Update periodically while tab is visible
    this.visibilityIntervalId = window.setInterval(() => {
      if (!document.hidden && this.isTracking) {
        debugLog('⏱️ Updating activity (tab visible)');
        this.updateLastActivity();
      }
    }, this.VISIBILITY_UPDATE_INTERVAL);

    debugLog(`⏱️ Started visibility-based updates (every ${this.VISIBILITY_UPDATE_INTERVAL / 1000}s)`);
  }

  /**
   * Stop periodic activity updates
   */
  private stopVisibilityUpdates(): void {
    if (this.visibilityIntervalId) {
      clearInterval(this.visibilityIntervalId);
      this.visibilityIntervalId = null;
      debugLog('⏱️ Stopped visibility-based updates');
    }
  }

  /**
   * Update lastActivityTimestamp in the database
   */
  private async updateLastActivity(): Promise<void> {
    try {
      const wallet = walletStore.loggedWallet;
      if (!wallet) {
        debugLog('⏱️ No wallet logged in, skipping activity update');
        return;
      }

      const now = Date.now();
      this.lastUpdate = now;

      const db = await getDb(wallet.id);
      const configTable = db.table('config');

      await configTable.put({ key: 'lastActivityTimestamp', value: now });
      debugLog(`⏱️ Updated lastActivityTimestamp: ${new Date(now).toISOString()}`);
    } catch (error) {
      console.error('❌ Failed to update activity timestamp:', error);
    }
  }

  /**
   * Force an immediate update (useful when wallet is unlocked)
   */
  public updateNow(): void {
    this.updateLastActivity();
  }
}

// Export singleton instance
export const activityTracker = new ActivityTrackerService();
