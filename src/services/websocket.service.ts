import { debugLog } from '@/utils/debug';
import LoadingState from '@/stores/loading';
import FIFOCache from 'tiny-fifo-cache';

interface WsSyncBlock {
  hash: string;
  height: number;
  // Cardano-only fields. Bitcoin block payloads omit these (or send 0).
  // gero-sync populates them via EpochSlotCalculator on the server side, so the wallet
  // can render the dashboard top bar progress and the sign popup TTL relative time
  // without needing a separate tip query.
  slot?: number;
  epoch?: number;
  epoch_slot?: number;
  time?: number;
}

export interface WsSyncMessage {
  type: string;
  block?: WsSyncBlock;
  [key: string]: unknown;
}

interface WsHandlers {
  onSync?: (data: WsSyncMessage) => Promise<void>;
  onRollback?: (data: WsSyncMessage) => Promise<void>;
  onForceResync?: () => Promise<void>;
  // Cross-device signing bridge (ships DARK behind isCrossDeviceSigningEnabled).
  // Purely additive: when unset, cross-device message types fall through to the
  // existing "unknown type" default and nothing else changes. See
  // docs/plans/2026-06-29-cross-device-signing-bridge.md.
  onCrossDeviceMessage?: (raw: unknown) => void;
  /**
   * Fired inside onopen, immediately after SUBSCRIBE is sent, on the initial connect
   * and every reconnect. The socket is guaranteed OPEN and SUBSCRIBE precedes anything
   * sent from here on the same ordered stream. Used to publish the cross-device
   * DEVICE_REGISTER (which the relay rejects if it arrives before SUBSCRIBE).
   */
  onSocketOpen?: () => void;
}

// Relay message types routed to the cross-device signing bridge. The first six are
// the CrossDeviceMessageType wire messages (src/services/crossDevice/protocol.ts);
// WAKE_PENDING is a relay CONTROL frame (unsigned, not a CrossDeviceMessage) that the
// signing service special-cases in handleInbound — it MUST be allow-listed here too or
// the requester never learns the target was offline and never re-issues on wake.
const CROSS_DEVICE_MESSAGE_TYPES = [
  'DEVICE_REGISTER',
  'DEVICES',
  'DEVICE_REGISTER_ACK',
  'SIGN_REQUEST',
  'SIGN_RESPONSE',
  'PAIR_CONFIRM',
  'WAKE_PENDING',
];

class WebSocketService {
  private ws: WebSocket | null = null;
  private handlers: WsHandlers = {};
  private stakeAddress: string | null = null;
  private credentials: string[] | null = null;
  private chain: string | null = null;
  private network: string | null = null;
  private lastSyncedBlock: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private syncCheckTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectAttempt: number = 0;
  private tipCache = new FIFOCache(10);
  private intentionallyClosed = false;
  private syncResolve: (() => void) | null = null;
  private catchingUp = false;
  private pendingTxBatches: WsSyncMessage[] = [];

  private readonly RECONNECT_DELAYS = [3000, 5000, 10000, 30000];
  // SYNC_CHECK doubles as the MV3 keep-alive. The service worker is torn down
  // after 30s idle; a WebSocket send/receive resets that idle timer (Chrome 116+),
  // so pinging every 25s keeps the worker AND the socket alive. Without it the
  // worker recycled every ~30-42s, re-running login and, for cross-device,
  // evicting + re-registering this device on the relay so siblings saw it flap in
  // and out. SYNC_CHECK is idempotent + relay-handled, so this needs no relay
  // change; it also keeps sync fresher. Must stay < 30s.
  private readonly SYNC_CHECK_INTERVAL = 25_000;
  private readonly WS_BASE_URL = import.meta.env['VITE_SYNC_WS_URL'] || 'wss://sync.gerowallet.io';

  connect(
    chain: string,
    network: string,
    stakeAddress: string,
    lastSyncedBlock: number,
    handlers: WsHandlers,
    credentials?: string[]
  ): void {
    this.close();
    this.chain = chain;
    this.network = network;
    this.stakeAddress = stakeAddress;
    this.lastSyncedBlock = lastSyncedBlock;
    this.handlers = handlers;
    this.credentials = credentials || null;
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
      debugLog('🔌 WebSocket connected');
      LoadingState.setConnected(true);
      LoadingState.setConnecting(false);
      LoadingState.setText('');
      this.reconnectAttempt = 0;

      debugLog(`📤 SUBSCRIBE: chain=${this.chain} network=${this.network} address=${this.stakeAddress} lastSyncedBlock=${this.lastSyncedBlock}`);
      this.send({
        type: 'SUBSCRIBE',
        chain: this.chain,
        network: this.network,
        address: this.stakeAddress,
        lastSyncedBlock: this.lastSyncedBlock,
        credentials: this.credentials,
        platform: 'extension',
      });

      // Socket is OPEN and SUBSCRIBE has been queued on this ordered stream. Let
      // subscribers (e.g. cross-device DEVICE_REGISTER) send now, after SUBSCRIBE.
      this.handlers.onSocketOpen?.();

      this.startSyncCheck();
    };

    this.ws.binaryType = 'arraybuffer';
    this.ws.onmessage = async (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        // Gzip-compressed binary frame — decompress
        const ds = new DecompressionStream('gzip');
        const writer = ds.writable.getWriter();
        writer.write(new Uint8Array(event.data));
        writer.close();
        const reader = ds.readable.getReader();
        const chunks: Uint8Array[] = [];
        let done = false;
        while (!done) {
          const result = await reader.read();
          if (result.value) chunks.push(result.value);
          done = result.done;
        }
        const decoded = new TextDecoder().decode(
          chunks.length === 1 ? chunks[0] : await new Blob(chunks as unknown as BlobPart[]).arrayBuffer().then(b => new Uint8Array(b))
        );
        this.handleMessage(decoded);
      } else {
        this.handleMessage(event.data);
      }
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

      // Cross-device signing bridge: forward relay messages to the injected
      // handler and return before the sync switch. The relay sends DEVICES to
      // every subscriber (broadcast on SUBSCRIBE), so these types appear on the
      // wire even with the feature off; walletManager wires a live closure that
      // no-ops when no bridge exists, keeping them out of the "unknown type"
      // branch. SYNC/ROLLBACK/FORCE_RESYNC handling is unchanged.
      if (this.handlers.onCrossDeviceMessage && CROSS_DEVICE_MESSAGE_TYPES.includes(type)) {
        this.handlers.onCrossDeviceMessage(data);
        return;
      }

      switch (type) {
        case 'SYNC': {
          const txCount = Array.isArray(data['transactions']) ? data['transactions'].length : 0;
          const blockHeight = data.block?.height || 0;
          debugLog(`📥 SYNC received: ${txCount} tx(s), block ${blockHeight}`);

          if (this.catchingUp) {
            // During catch-up, accumulate batches — don't write to DB yet
            this.pendingTxBatches.push(data);
            // Update progress bar
            const total = data['catch_up_total'] as number;
            const sent = data['catch_up_sent'] as number;
            debugLog(`📊 Progress: ${sent}/${total}`);
            if (total && sent) {
              const pct = Math.round((sent / total) * 90); // 0-90%, last 10% for processing
              LoadingState.setProgress(pct);
              LoadingState.setText(`Syncing wallet data...<br><span style="font-size: 12px; opacity: 0.7">${sent}/${total} transactions</span>`);
            }
            debugLog(`📦 Accumulated batch (${this.pendingTxBatches.length} batches so far)`);
          } else {
            // Normal real-time sync — process immediately
            if (data.block?.hash && this.tipCache.get(data.block.hash)) {
              debugLog('⏭️ Duplicate block hash, skipping');
              return;
            }
            if (data.block?.hash) {
              this.tipCache.put(data.block.hash, true);
            }
            if (data.block?.height) {
              this.lastSyncedBlock = data.block.height;
            }
            this.handlers.onSync?.(data);
          }
          break;
        }

        case 'CATCH_UP_COMPLETE': {
          LoadingState.setProgress(95);
          LoadingState.setText('Processing transactions...');
          const block = data.block as { height: number; hash: string; slot: number; epoch: number; time: number } | undefined;
          debugLog(`✅ Catch-up complete: ${data['totalTransactions']} transactions up to block ${block?.height}`);

          // Combine accumulated batches (if any) into one SYNC payload
          const allTransactions = this.pendingTxBatches.flatMap(batch =>
            Array.isArray(batch['transactions']) ? batch['transactions'] : []
          );
          const lastBatch = this.pendingTxBatches[this.pendingTxBatches.length - 1];

          // Always pass through UTxOs, addresses, account from CATCH_UP_COMPLETE
          const combinedPayload: WsSyncMessage = {
            ...(lastBatch || {}),
            type: 'SYNC',
            transactions: allTransactions.length > 0 ? allTransactions : undefined,
            block: block || { height: (data['blockHeight'] as number) || 0, hash: '' },
            utxos: data['utxos'],
            addresses: data['addresses'],
            account: data['account'],
          };
          debugLog(`📤 Processing ${allTransactions.length} transactions + ${(data['utxos'] as unknown[])?.length || 0} UTxOs`);
          this.lastSyncedBlock = block?.height || (data['blockHeight'] as number) || 0;
          this.handlers.onSync?.(combinedPayload);
          this.pendingTxBatches = [];

          this.catchingUp = false;
          LoadingState.setProgress(100);
          if (this.syncResolve) { this.syncResolve(); this.syncResolve = null; }
          break;
        }

        case 'ROLLBACK':
          debugLog(`⚠️ ROLLBACK to slot ${data['rollbackToSlot']}`);
          this.handlers.onRollback?.(data);
          break;

        case 'SYNC_CHECK_OK':
          debugLog('✅ SYNC_CHECK: caught up');
          // SYNC_CHECK_OK may include utxos, addresses, account (on initial connect)
          // and/or block (always, post tip-cache fix in gero-sync). Forward whenever
          // there's anything actionable so the dashboard tooltip can update from the
          // periodic keep-alive even when no UTxOs are attached.
          //
          // IMPORTANT: type goes AFTER the spread — otherwise data.type ('SYNC_CHECK_OK')
          // overwrites it and setSync's `type === 'SYNC'` guard rejects the message.
          if (data['utxos'] || data['addresses'] || data['account'] || data['block']) {
            this.handlers.onSync?.({ ...data, type: 'SYNC' } as WsSyncMessage);
          }
          if (this.syncResolve) { this.syncResolve(); this.syncResolve = null; }
          break;

        case 'FORCE_RESYNC':
          debugLog('🔄 Force resync requested by admin');
          this.lastSyncedBlock = 0;
          this.handlers.onForceResync?.();
          break;

        default:
          debugLog('❓ Unknown WebSocket message type:', type);
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

  /**
   * Public passthrough for sending an arbitrary message over the existing
   * socket. Used by the cross-device signing transport adapter (wsTransport.ts)
   * to publish relay messages. Thin wrapper over the private `send`; obeys the
   * same OPEN-socket guard, so it is a no-op when disconnected.
   */
  sendRaw(msg: object): void {
    this.send(msg);
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

  pauseSyncCheck(): void {
    this.stopSyncCheck();
  }

  resumeSyncCheck(): void {
    this.startSyncCheck();
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

  /**
   * Re-send SUBSCRIBE with a new lastSyncedBlock.
   * Used for force resync (lastSyncedBlock=0) to trigger full catch-up via gero-sync.
   */
  resubscribe(lastSyncedBlock: number, expandedCredentials?: string[]): void {
    if (expandedCredentials) {
      this.credentials = expandedCredentials;
    }
    debugLog(`🔄 Resubscribing with lastSyncedBlock=${lastSyncedBlock} credentials=${this.credentials?.length || 0}`);
    this.lastSyncedBlock = lastSyncedBlock;
    this.send({
      type: 'SUBSCRIBE',
      chain: this.chain,
      network: this.network,
      address: this.stakeAddress,
      lastSyncedBlock,
      credentials: this.credentials,
      platform: 'extension',
    });
  }

  /**
   * Returns a promise that resolves when CATCH_UP_COMPLETE or SYNC_CHECK_OK arrives.
   * Safety timeout prevents infinite wait if connection drops silently.
   */
  waitForSync(timeoutMs = 300000): Promise<void> {
    debugLog(`⏳ Waiting for sync...`);
    this.catchingUp = true;
    this.pendingTxBatches = [];
    return new Promise<void>((resolve) => {
      this.syncResolve = resolve;
      setTimeout(() => {
        if (this.syncResolve === resolve) {
          debugLog('⏰ waitForSync timed out');
          // Flush any pending batches accumulated during catch-up
          if (this.pendingTxBatches.length > 0) {
            const allTransactions = this.pendingTxBatches.flatMap(batch =>
              Array.isArray(batch['transactions']) ? batch['transactions'] : []
            );
            const lastBatch = this.pendingTxBatches[this.pendingTxBatches.length - 1];
            const combinedPayload: WsSyncMessage = {
              ...lastBatch,
              transactions: allTransactions,
              block: lastBatch.block,
            };
            debugLog(`📤 Timeout flush: processing ${allTransactions.length} transactions`);
            this.handlers.onSync?.(combinedPayload);
            this.pendingTxBatches = [];
          }
          this.catchingUp = false;
          this.syncResolve = null;
          resolve();
        }
      }, timeoutMs);
    });
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
    this.credentials = null;
    this.chain = null;
    this.network = null;
    this.catchingUp = false;
    this.pendingTxBatches = [];
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
