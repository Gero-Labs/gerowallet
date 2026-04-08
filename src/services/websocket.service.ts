import { debugLog } from '@/utils/debug';
import LoadingState from '@/stores/loading';
import FIFOCache from 'tiny-fifo-cache';

interface WsSyncMessage {
  type: string;
  block?: { hash: string; height: number };
  [key: string]: unknown;
}

interface WsHandlers {
  onSync?: (data: WsSyncMessage) => Promise<void>;
  onRollback?: (data: WsSyncMessage) => Promise<void>;
}

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: WsHandlers = {};
  private stakeAddress: string | null = null;
  private chain: string | null = null;
  private network: string | null = null;
  private lastSyncedBlock: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private syncCheckTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt: number = 0;
  private tipCache = new FIFOCache(10);
  private intentionallyClosed = false;

  private readonly RECONNECT_DELAYS = [3000, 5000, 10000, 30000];
  private readonly SYNC_CHECK_INTERVAL = 120_000; // 2 minutes
  private readonly WS_BASE_URL = import.meta.env['VITE_SYNC_WS_URL'] || 'wss://sync.gerowallet.io';

  connect(
    chain: string,
    network: string,
    stakeAddress: string,
    lastSyncedBlock: number,
    handlers: WsHandlers
  ): void {
    this.close();
    this.chain = chain;
    this.network = network;
    this.stakeAddress = stakeAddress;
    this.lastSyncedBlock = lastSyncedBlock;
    this.handlers = handlers;
    this.intentionallyClosed = false;
    this.reconnectAttempt = 0;
    this.openConnection();
  }

  private openConnection(): void {
    if (this.intentionallyClosed) return;

    LoadingState.setConnecting(true);
    const url = `${this.WS_BASE_URL}/ws/sync`;
    debugLog('WebSocket connecting to', url);

    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      debugLog('WebSocket creation failed:', e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      debugLog('WebSocket connected');
      LoadingState.setConnected(true);
      LoadingState.setConnecting(false);
      LoadingState.setText('');
      this.reconnectAttempt = 0;

      this.send({
        type: 'SUBSCRIBE',
        chain: this.chain,
        network: this.network,
        address: this.stakeAddress,
        lastSyncedBlock: this.lastSyncedBlock,
      });

      this.startSyncCheck();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onclose = (event: CloseEvent) => {
      debugLog('WebSocket closed:', event.code, event.reason);
      LoadingState.setConnected(false);
      LoadingState.setConnecting(false);
      this.stopSyncCheck();

      if (!this.intentionallyClosed) {
        LoadingState.setText('Wallet is Disconnected from the Network.<br>Reconnecting ...');
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (event: Event) => {
      debugLog('WebSocket error:', event);
    };
  }

  private handleMessage(raw: string): void {
    try {
      const data: WsSyncMessage = JSON.parse(raw);
      const type = data.type;

      switch (type) {
        case 'SYNC':
          if (data.block?.hash && this.tipCache.get(data.block.hash)) {
            return;
          }
          if (data.block?.hash) {
            this.tipCache.put(data.block.hash, true);
          }
          if (data.block?.height) {
            this.lastSyncedBlock = data.block.height;
          }
          this.handlers.onSync?.(data);
          break;

        case 'ROLLBACK':
          this.handlers.onRollback?.(data);
          break;

        case 'SYNC_CHECK_OK':
          debugLog('SYNC_CHECK: caught up');
          break;

        default:
          debugLog('Unknown WebSocket message type:', type);
      }
    } catch (e) {
      debugLog('Failed to parse WebSocket message:', e);
    }
  }

  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private startSyncCheck(): void {
    this.stopSyncCheck();
    this.syncCheckTimer = setInterval(() => {
      this.send({
        type: 'SYNC_CHECK',
        address: this.stakeAddress,
        lastSyncedBlock: this.lastSyncedBlock,
      });
    }, this.SYNC_CHECK_INTERVAL);
  }

  private stopSyncCheck(): void {
    if (this.syncCheckTimer) {
      clearInterval(this.syncCheckTimer);
      this.syncCheckTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = this.RECONNECT_DELAYS[
      Math.min(this.reconnectAttempt, this.RECONNECT_DELAYS.length - 1)
    ];
    this.reconnectAttempt++;
    debugLog(`WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempt})`);
    this.reconnectTimer = setTimeout(() => this.openConnection(), delay);
  }

  close(): void {
    this.intentionallyClosed = true;
    this.stopSyncCheck();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.handlers = {};
    this.stakeAddress = null;
    this.chain = null;
    this.network = null;

  }

  updateLastSyncedBlock(block: number): void {
    this.lastSyncedBlock = block;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

const webSocketService = new WebSocketService();
export default webSocketService;
