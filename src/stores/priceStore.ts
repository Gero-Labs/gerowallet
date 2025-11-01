import Vue from 'vue';
import krakenWebSocketService from '@/services/krakenWebSocket.service';
import { debugLog } from '@/utils/debug';

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

// Create observable price store
export const priceStore = Vue.observable<PriceStore>({
  adaUsd: null,
  isConnected: false,
  connectionStatus: 'connecting'
});

class PriceService {
  private isInitialized = false;

  /**
   * Initialize price service with Kraken WebSocket
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      debugLog('🦑 Initializing price service...');
      priceStore.connectionStatus = 'connecting';
      // Set up ticker update handler
      krakenWebSocketService.onTicker((ticker: PriceData) => {
        priceStore.adaUsd = ticker;
        priceStore.isConnected = true;
        priceStore.connectionStatus = 'connected';
        debugLog('🦑 Price updated:', `$${ticker.lastPrice}`);
      });

      // Connect to Kraken WebSocket
      await krakenWebSocketService.connect();

      // Subscribe to ADA/USD ticker
      krakenWebSocketService.subscribeToAdaUsd();

      this.isInitialized = true;
      debugLog('🦑 Price service initialized successfully');

    } catch (error) {
      console.error('🦑 Failed to initialize price service:', error);
      priceStore.connectionStatus = 'error';
      priceStore.isConnected = false;
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

export { priceService };
export default priceService;
