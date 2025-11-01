/**
 * Kraken WebSocket Service for real-time ADA/USD market data
 * Replaces the Binance API for Strike Finance integration
 */
import { debugLog } from '@/utils/debug';

interface KrakenTickerData {
  a: [string, string, string]; // ask [price, whole_lot_volume, lot_volume]
  b: [string, string, string]; // bid [price, whole_lot_volume, lot_volume]
  c: [string, string]; // last trade closed [price, lot_volume]
  v: [string, string]; // volume [today, last_24_hours]
  p: [string, string]; // volume weighted average price [today, last_24_hours]
  t: [number, number]; // number of trades [today, last_24_hours]
  l: [string, string]; // low [today, last_24_hours]
  h: [string, string]; // high [today, last_24_hours]
  o: [string, string]; // open [today, last_24_hours]
}

interface KrakenMessage {
  event?: string;
  status?: string;
  errorMessage?: string;
  pair?: string;
  subscription?: {
    name: string;
  };
  channelID?: number;
  channelName?: string;
  [key: number]: any; // For ticker data arrays
}

class KrakenWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 5000; // 5 seconds
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private subscriptions: Set<string> = new Set();
  private onTickerUpdate: ((ticker: any) => void) | null = null;
  private lastTickerTime = 0;
  private tickerRequestInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    debugLog('🦑 Kraken WebSocket Service initialized');
  }

  /**
   * Connect to Kraken WebSocket API
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        //@ts-ignore
        const wsUrl = (import.meta.env.VITE_KRAKEN_WS_URL || 'wss://ws.kraken.com').replace(/['"]/g, '');
        debugLog('🦑 🔧 WebSocket URL:', wsUrl);
        debugLog('🦑 🔌 Creating WebSocket connection...');
        this.ws = new WebSocket(wsUrl);
        debugLog('🦑 📡 WebSocket instance created, setting up event handlers...');

        this.ws.onopen = () => {
          debugLog('🦑 ✅ Successfully connected to Kraken WebSocket');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startPing();
          this.startTickerMonitoring();
          resolve();
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          debugLog('🦑 ❌ Disconnected from Kraken WebSocket:', event.code, event.reason);
          this.isConnected = false;
          this.stopPing();
          this.stopTickerMonitoring();

          // Attempt reconnection if not a normal closure
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('🦑 ❌ Kraken WebSocket error details:', {
            error,
            readyState: this.ws?.readyState,
            url: wsUrl,
            isConnected: this.isConnected
          });
          if (!this.isConnected) {
            reject(error);
          }
        };

      } catch (error) {
        console.error('🦑 ❌ Failed to create Kraken WebSocket connection:', error);
        reject(error);
      }
    });
  }

  /**
   * Subscribe to ADA/USD ticker updates
   */
  subscribeToAdaUsd(): void {
    if (!this.isConnected || !this.ws) {
      console.warn('🦑 ⚠️ Cannot subscribe - not connected to Kraken WebSocket');
      return;
    }

    const subscription = {
      event: 'subscribe',
      pair: ['ADA/USD'],
      subscription: {
        name: 'ticker'
      }
    };

    debugLog('🦑 📡 Subscribing to ADA/USD ticker:', subscription);
    this.ws.send(JSON.stringify(subscription));
    this.subscriptions.add('ADA/USD');
  }

  /**
   * Set callback for ticker updates
   */
  onTicker(callback: (ticker: any) => void): void {
    this.onTickerUpdate = callback;
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: string): void {
    try {
      const message: KrakenMessage | any[] = JSON.parse(data);


      // Handle system messages (objects)
      if (typeof message === 'object' && !Array.isArray(message)) {
        this.handleSystemMessage(message as KrakenMessage);
        return;
      }

      // Handle ticker data (arrays)
      if (Array.isArray(message) && message.length >= 4) {
        this.handleTickerData(message);
        return;
      }

    } catch (error) {
      console.error('🦑 ❌ Failed to parse Kraken message:', error, data);
    }
  }

  /**
   * Handle system messages (subscription confirmations, errors, etc.)
   */
  private handleSystemMessage(message: KrakenMessage): void {
    if (message.event === 'subscriptionStatus') {
      if (message.status === 'error') {
        console.error('🦑 ❌ Subscription error:', message.errorMessage);
      }
    }
  }

  /**
   * Handle ticker data arrays
   * Format: [channelID, tickerData, channelName, pair]
   */
  private handleTickerData(data: any[]): void {
    if (data.length < 4) return;

    const [_channelID, tickerData, channelName, pair] = data;

    if (channelName === 'ticker' && pair === 'ADA/USD') {
      this.lastTickerTime = Date.now();
      const ticker = this.parseTickerData(tickerData);

      if (this.onTickerUpdate) {
        this.onTickerUpdate(ticker);
      }
    }
  }

  /**
   * Parse Kraken ticker data into our format
   */
  private parseTickerData(data: KrakenTickerData): any {
    const lastPrice = parseFloat(data.c[0]); // Last trade price
    const volume24h = parseFloat(data.v[1]); // 24h volume
    const high24h = parseFloat(data.h[1]); // 24h high
    const low24h = parseFloat(data.l[1]); // 24h low
    const open24h = parseFloat(data.o[1]); // 24h open

    // Calculate price change percentage
    const priceChange = lastPrice - open24h;
    const priceChangePercent = open24h !== 0 ? (priceChange / open24h) * 100 : 0;

    return {
      lastPrice,
      volume24h,
      high24h,
      low24h,
      open24h,
      priceChange,
      priceChangePercentage: priceChangePercent,
      timestamp: Date.now(),
      source: 'kraken'
    };
  }

  /**
   * Start periodic ping to keep connection alive
   */
  private startPing(): void {
    this.pingInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send(JSON.stringify({ event: 'ping' }));
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Stop periodic ping
   */
  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Start monitoring ticker updates and request fresh data periodically
   */
  private startTickerMonitoring(): void {
    this.tickerRequestInterval = setInterval(() => {
      const timeSinceLastUpdate = Date.now() - this.lastTickerTime;

      if (timeSinceLastUpdate > 120000) {
        if (this.isConnected && this.subscriptions.has('ADA/USD')) {
          this.subscribeToAdaUsd();
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Stop ticker monitoring
   */
  private stopTickerMonitoring(): void {
    if (this.tickerRequestInterval) {
      clearInterval(this.tickerRequestInterval);
      this.tickerRequestInterval = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1); // Exponential backoff

    setTimeout(() => {
      if (this.reconnectAttempts <= this.maxReconnectAttempts) {
        this.connect()
          .then(() => {
            setTimeout(() => this.subscribeToAdaUsd(), 1000);
          })
          .catch(() => {
            // Silent fail, will retry
          });
      }
    }, delay);
  }

  /**
   * Disconnect from Kraken WebSocket
   */
  disconnect(): void {
    this.isConnected = false;
    this.stopPing();
    this.stopTickerMonitoring();

    if (this.ws) {
      this.ws.close(1000, 'Normal closure');
      this.ws = null;
    }

    this.subscriptions.clear();
    this.onTickerUpdate = null;
  }

  /**
   * Get connection status
   */
  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Get active subscriptions
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }
}

// Create singleton instance
const krakenWebSocketService = new KrakenWebSocketService();

export default krakenWebSocketService;
