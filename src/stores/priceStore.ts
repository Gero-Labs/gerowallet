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

export interface BtcPriceData {
  lastPrice: number;
  volume24h: number;
  high24h: number;
  low24h: number;
  open24h: number;
  priceChange: number;
  priceChangePercentage: number;
  timestamp: number;
}

export interface PriceStore {
  adaUsd: PriceData | null;
  btcUsd: BtcPriceData | null;
  isConnected: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
}

const STORE_NAME = 'priceStore';
const context = getContextType();

// Create observable price store
export const priceStore = Vue.observable<PriceStore>({
  adaUsd: null,
  btcUsd: null,
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
  private currentChain: 'Cardano' | 'Bitcoin' = 'Cardano';

  /**
   * Initialize price service with Kraken WebSocket.
   * Subscribes to ADA/USD for Cardano wallets, XBT/USD for Bitcoin wallets.
   */
  async initialize(chain: 'Cardano' | 'Bitcoin' = 'Cardano'): Promise<void> {
    // Re-initialize if chain changed
    if (this.isInitialized && this.currentChain === chain) {
      this.registerTickerCallback(chain);
      return;
    }

    // Disconnect existing connection when switching chains
    if (this.isInitialized && this.currentChain !== chain) {
      this.disconnect();
    }

    this.currentChain = chain;

    try {
      priceStore.connectionStatus = 'connecting';
      broadcastFromBackground({ connectionStatus: 'connecting' });

      // Register ticker callback BEFORE connecting
      this.registerTickerCallback(chain);

      // Connect to Kraken WebSocket
      await krakenWebSocketService.connect();

      // Subscribe to the correct ticker pair for this wallet chain
      if (chain === 'Bitcoin') {
        krakenWebSocketService.subscribeToBtcUsd();
      } else {
        krakenWebSocketService.subscribeToAdaUsd();
      }

      this.isInitialized = true;

    } catch (error) {
      console.error('🦑 Failed to initialize price service:', error);
      priceStore.connectionStatus = 'error';
      priceStore.isConnected = false;
      broadcastFromBackground({ connectionStatus: 'error', isConnected: false });
    }
  }

  /**
   * Register ticker update callback for the given chain.
   * Extracted to support HMR re-registration.
   */
  private registerTickerCallback(chain: 'Cardano' | 'Bitcoin'): void {
    if (chain === 'Bitcoin') {
      krakenWebSocketService.onBtcTicker((ticker: BtcPriceData) => {
        Vue.set(priceStore, 'btcUsd', ticker);
        Vue.set(priceStore, 'isConnected', true);
        Vue.set(priceStore, 'connectionStatus', 'connected');
        broadcastFromBackground({
          btcUsd: ticker,
          isConnected: true,
          connectionStatus: 'connected'
        });
      });
    } else {
      krakenWebSocketService.onTicker((ticker: PriceData) => {
        Vue.set(priceStore, 'adaUsd', ticker);
        Vue.set(priceStore, 'isConnected', true);
        Vue.set(priceStore, 'connectionStatus', 'connected');
        broadcastFromBackground({
          adaUsd: ticker,
          isConnected: true,
          connectionStatus: 'connected'
        });
      });
    }

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
  async reconnect(chain: 'Cardano' | 'Bitcoin' = this.currentChain): Promise<void> {
    debugLog('🦑 Reconnecting price service...');
    this.disconnect();
    await this.initialize(chain);
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
    // Re-register callback if already initialized
    if (priceService['isInitialized']) {
      priceService['registerTickerCallback'](priceService['currentChain']);
    }
  });
}

export { priceService };
export default priceService;
