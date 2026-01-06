import Vue from 'vue';
import krakenWebSocketService from '@/services/krakenWebSocket.service';
import { debugLog } from '@/utils/debug';
import { getContextType } from '@/utils/storageSync';
import storeMessaging from '@/services/storeMessaging.service';
import backgroundStoreMessaging from '@/chrome/storeMessagingBg';

interface PriceData {
  lastPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  open24h: number;
  priceChange: number;
  priceChangePercentage: number;
  timestamp: number;
  source: string;
}

export interface PriceStore {
  adaUsd: PriceData | null;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
}

const STORE_NAME = 'priceStore';
const context = getContextType();

// Create observable price store
export const priceStore = Vue.observable<PriceStore>({
  adaUsd: null,
  isConnected: false,
  connectionStatus: 'disconnected'
});

/**
 * Broadcast store updates from background to browser contexts
 */
function broadcastFromBackground(updates: Partial<PriceStore>) {
  if (context === 'background') {
    backgroundStoreMessaging.broadcastUpdate(STORE_NAME, updates);
  }
}

// Subscribe to store updates in browser context
if (context === 'browser') {
  storeMessaging.subscribe(STORE_NAME, (updates: Partial<PriceStore>) => {
    Object.assign(priceStore, updates);
  });
}

class PriceService {
  private isInitialized = false;

  /**
   * Initialize price service with Kraken WebSocket
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      // Re-register the ticker callback in case of HMR
      this.registerTickerCallback();
      return;
    }

    try {
      priceStore.connectionStatus = 'connecting';
      broadcastFromBackground({ connectionStatus: 'connecting' });

      // Register ticker callback BEFORE connecting
      // This ensures we can receive the connected status from the first ticker
      this.registerTickerCallback();

      // Connect to Kraken WebSocket
      await krakenWebSocketService.connect();

      // Subscribe to ADA/USD ticker
      krakenWebSocketService.subscribeToAdaUsd();

      this.isInitialized = true;

    } catch (error) {
      console.error('🦑 Failed to initialize price service:', error);
      priceStore.connectionStatus = 'error';
      priceStore.isConnected = false;
      broadcastFromBackground({ connectionStatus: 'error', isConnected: false });
    }
  }

  /**
   * Register ticker update callback
   * Extracted to support HMR re-registration
   */
  private registerTickerCallback(): void {
    krakenWebSocketService.onTicker((ticker: PriceData) => {
      Vue.set(priceStore, 'adaUsd', ticker);
      Vue.set(priceStore, 'isConnected', true);
      Vue.set(priceStore, 'connectionStatus', 'connected');
      // Broadcast to browser context
      broadcastFromBackground({
        adaUsd: ticker,
        isConnected: true,
        connectionStatus: 'connected'
      });
    });

    // If Kraken is already connected, set status immediately
    if (krakenWebSocketService.getConnectionStatus()) {
      Vue.set(priceStore, 'connectionStatus', 'connected');
      Vue.set(priceStore, 'isConnected', true);
      broadcastFromBackground({ connectionStatus: 'connected', isConnected: true });
    }
  }

  /**
   * Disconnect price service (e.g., on wallet switch or logout)
   */
  disconnect(): void {
    debugLog('🦑 Disconnecting price service...');

    krakenWebSocketService.disconnect();

    // Reset price store
    priceStore.adaUsd = null;
    priceStore.isConnected = false;
    priceStore.connectionStatus = 'disconnected';
    broadcastFromBackground({
      adaUsd: null,
      isConnected: false,
      connectionStatus: 'disconnected'
    });

    this.isInitialized = false;
    debugLog('🦑 Price service disconnected');
  }

  /**
   * Reconnect price service (e.g., after wallet switch)
   */
  async reconnect(): Promise<void> {
    debugLog('🦑 Reconnecting price service...');
    this.disconnect();
    await this.initialize();
  }

  /**
   * Get current ADA/USD price
   */
  getCurrentPrice(): number | null {
    return priceStore.adaUsd?.lastPrice || null;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): string {
    return priceStore.connectionStatus;
  }

  /**
   * Check if service is connected
   */
  isConnected(): boolean {
    return priceStore.isConnected && krakenWebSocketService.getConnectionStatus();
  }
}

// Create singleton instance
const priceService = new PriceService();

// Handle HMR (Hot Module Replacement) - re-register callback with updated priceStore instance
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    debugLog('🦑 PriceStore HMR: Re-registering ticker callback...');
    // Re-register callback if already initialized
    if (priceService['isInitialized']) {
      priceService['registerTickerCallback']();
    }
  });
}

export { priceService };
export default priceService;
