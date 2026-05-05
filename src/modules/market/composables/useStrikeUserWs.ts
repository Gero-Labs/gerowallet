/**
 * Strike v2 User Data WebSocket
 *
 * URL: wss://api.strikefinance.org/ws/user-api
 *
 * Authentication flow:
 *   1. Connect to WebSocket
 *   2. Send `session.logon` with Ed25519 signature of the canonical payload
 *      `apiKey={publicKey}&timestamp={timestampMs}` signed by the API wallet
 *      private key. Timestamp is Unix milliseconds.
 *   3. On success (status 200, result.authenticated=true), subscribe to the
 *      `userstream` channel with account_id.
 *
 * Events:
 *   ACCOUNT_UPDATE      — balance changes, position updates, deposits, withdrawals, funding
 *   ORDER_TRADE_UPDATE  — order lifecycle events and trade executions (fills)
 *   strategyUpdate      — TWAP / bracket strategy status changes
 *
 * IMPORTANT: Server may batch multiple JSON events in a single text frame
 * separated by newline characters. We split on `\n` and parse each line.
 *
 * Server pings every 54s, drops if no pong within 60s.
 *
 * Reconnect: exponential backoff 5s base, 60s max. Auth-error close codes
 * (1008, 4001, 4003, 4401, 4403) skip reconnect. Tab visibility events
 * trigger an immediate reconnect attempt if the socket is not OPEN.
 *
 * Order updates are batched on a 300ms timer to handle rapid replace-order
 * sequences and avoid UI thrash from partial fills.
 *
 * Position state is merged by `symbol+positionSide` key. Closed positions
 * (size near zero) are removed.
 */

import { ref } from 'vue';
import * as ed25519 from '@noble/ed25519';
import { hexToBytes, bytesToHex } from '@/api/strike-v2.auth';
import { debugLog } from '@/utils/debug';

const WS_URL =
  (import.meta.env['VITE_STRIKE_WS_USER_URL'] as string | undefined) ??
  'wss://api.strikefinance.org/ws/user-api';

type EventCallback = (data: unknown) => void;

// ── Types (raw envelope shapes from the server) ──

interface OrderTradeUpdateData {
  s: string;          // symbol
  c: string;          // client order id
  S: 'BUY' | 'SELL';
  o: string;          // order type
  f?: string;         // time in force
  q: string;          // original size
  p: string;          // original price
  X: string;          // status
  x: string;          // execution type
  i: number;          // order id
  z?: string;         // cumulative filled
  l?: string;         // last filled qty
  L?: string;         // last filled price
  n?: string;         // commission
  N?: string;         // commission asset
  t?: number;         // trade id (0 = preview)
  m?: boolean;        // is maker
  R?: boolean;        // reduce only
  sp?: string;        // stop price
  wt?: string;        // working type
  cp?: boolean;       // close position
  AP?: string;        // activation price
  CR?: string;        // callback rate
  rp?: string;        // realized profit
  T?: number;         // tx time
  E: number;          // event time
}

interface PositionUpdate {
  s: string;          // symbol
  pa: string;         // position amount (signed)
  ep: string;         // entry price
  mt: 'cross' | 'isolated';
  ib?: string;        // isolated balance
  ps: 'LONG' | 'SHORT' | 'BOTH';
  i?: string;         // position id
}

interface BalanceUpdate {
  a: string;
  wb: string;
  cw: string;
  bc: string;
}

interface AccountUpdateData {
  e?: string;
  E?: number;
  T?: number;
  r?: string;
  B?: BalanceUpdate[];
  P?: PositionUpdate[];
  event_type?: string;
  event_data?: Record<string, unknown>;
}

interface StrategyUpdateData {
  account_id: string;
  strategy_id: string;
  market: string;
  status: 'pending' | 'active' | 'cancelling' | 'completed' | 'expired' | 'cancelled' | 'failed' | 'liquidated';
  side: 'BUY' | 'SELL';
  filled_size: string;
  total_size: string;
  duration_sec: number;
  slices_fired: number;
  nominal_slices: number;
  last_error?: string;
  completed_at_ms?: number | null;
}

const FINAL_ORDER_STATUSES = new Set([
  'FILLED', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED',
]);
const AUTH_ERROR_CODES = new Set<number>([1008, 4001, 4003, 4401, 4403]);

// Keys for authentication (set via connectWithKeys)
let _publicKeyHex: string | null = null;
let _privateKeyHex: string | null = null;
let _accountId: string | null = null;

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;
const ORDER_BATCH_MS = 300;

// Module-level singletons
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_BASE_MS;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let msgId = 0;
let visibilityHandler: (() => void) | null = null;

// Order update batching
let orderBatchTimer: ReturnType<typeof setTimeout> | null = null;
let orderBatch: OrderTradeUpdateData[] = [];

// Reactive state
const listeners = new Map<string, Set<EventCallback>>();
const connected = ref(false);
const authenticated = ref(false);
const positionsMap = ref<Map<string, PositionUpdate>>(new Map());
const openOrdersMap = ref<Map<number, OrderTradeUpdateData>>(new Map());

function nextId(): number { return ++msgId; }

function send(msg: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function startPingInterval(): void {
  if (pingInterval) clearInterval(pingInterval);
  pingInterval = setInterval(() => send({ method: 'ping', id: nextId() }), 30_000);
}

function stopPingInterval(): void {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

// ── Authentication ──

/**
 * Build the canonical auth message per the strike-userstream spec:
 * `apiKey=<PUBLIC_KEY_HEX>&timestamp=<TIMESTAMP_MS>` signed with Ed25519.
 */
async function authenticate(): Promise<void> {
  if (!_publicKeyHex || !_privateKeyHex) return;

  const timestamp = Date.now();
  const message = `apiKey=${_publicKeyHex}&timestamp=${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);
  const privateKeyBytes = hexToBytes(_privateKeyHex);
  const signatureBytes = await ed25519.signAsync(messageBytes, privateKeyBytes);
  const signature = bytesToHex(signatureBytes);

  send({
    method: 'session.logon',
    params: {
      apiKey: _publicKeyHex,
      signature,
      timestamp,
    },
    id: nextId(),
  });
}

function subscribeUserStream(): void {
  if (!_accountId) return;
  send({
    method: 'subscribe',
    channel: 'userstream',
    account_id: _accountId,
    id: nextId(),
  });
}

// ── Message handling ──

function emit(eventType: string, data: unknown): void {
  listeners.get(eventType)?.forEach(cb => cb(data));
  listeners.get('*')?.forEach(cb => cb(data));
}

function flushOrderBatch(): void {
  // Deduplicate by orderId, keep most recent by event time E.
  const deduped = new Map<number, OrderTradeUpdateData>();
  for (const u of orderBatch) {
    const existing = deduped.get(u.i);
    if (!existing || u.E > existing.E) {
      deduped.set(u.i, u);
    }
  }

  for (const u of deduped.values()) {
    const status = String(u.X).toUpperCase();
    if (FINAL_ORDER_STATUSES.has(status)) {
      openOrdersMap.value.delete(u.i);
    } else {
      openOrdersMap.value.set(u.i, u);
    }
    // Re-emit individual updates downstream so listeners can render fills.
    emit('ORDER_TRADE_UPDATE', { e: 'ORDER_TRADE_UPDATE', data: u });
  }

  // Trigger reactivity (Map mutation alone won't re-render)
  // eslint-disable-next-line no-self-assign
  openOrdersMap.value = new Map(openOrdersMap.value);

  orderBatch = [];
  orderBatchTimer = null;
  emit('ORDER_BATCH_FLUSH', { count: deduped.size });
}

function queueOrderUpdate(update: OrderTradeUpdateData): void {
  orderBatch.push(update);
  if (orderBatchTimer) clearTimeout(orderBatchTimer);
  orderBatchTimer = setTimeout(flushOrderBatch, ORDER_BATCH_MS);
}

function applyAccountUpdate(update: AccountUpdateData): void {
  // Vault / non-position event: pass through unchanged.
  if (update.event_type) {
    emit('ACCOUNT_UPDATE', { e: 'ACCOUNT_UPDATE', data: update });
    return;
  }

  for (const pos of update.P ?? []) {
    const key = `${pos.s}-${pos.ps}`;
    const size = Math.abs(parseFloat(pos.pa));

    if (size < 1e-12) {
      positionsMap.value.delete(key);
    } else {
      positionsMap.value.set(key, pos);
      // If the position flipped, clean up the opposite side if it's now empty.
      const opposite = pos.ps === 'LONG' ? 'SHORT' : pos.ps === 'SHORT' ? 'LONG' : null;
      if (opposite) {
        const oppKey = `${pos.s}-${opposite}`;
        const oppPos = positionsMap.value.get(oppKey);
        if (oppPos && Math.abs(parseFloat(oppPos.pa)) < 1e-12) {
          positionsMap.value.delete(oppKey);
        }
      }
    }
  }

  // Trigger reactivity
  positionsMap.value = new Map(positionsMap.value);
  emit('ACCOUNT_UPDATE', { e: 'ACCOUNT_UPDATE', data: update });
}

function handleMessage(event: MessageEvent): void {
  const raw = event.data as string;
  if (!raw) return;

  // Server may batch multiple JSON events separated by newline.
  for (const lineRaw of String(raw).split('\n')) {
    const line = lineRaw.trim();
    if (!line) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // Auth response
    const result = parsed['result'] as Record<string, unknown> | null | undefined;
    if (parsed['status'] === 200 && result && result['authenticated'] === true) {
      authenticated.value = true;
      _accountId = (result['account_id'] as string) ?? _accountId;
      subscribeUserStream();
      continue;
    }

    // Pong
    if (parsed['method'] === 'pong') continue;

    // Subscribe ack
    if ('result' in parsed && parsed['result'] === null) continue;

    // Errors
    if (parsed['e'] === 'error' || parsed['error']) {
      debugLog('[Strike User WS] Error:', parsed['error'] || parsed);
      continue;
    }

    const eventType = parsed['e'] as string | undefined;
    if (!eventType) continue;

    switch (eventType) {
      case 'ORDER_TRADE_UPDATE': {
        const data = parsed['data'] as OrderTradeUpdateData | undefined;
        if (data) queueOrderUpdate(data);
        break;
      }
      case 'ACCOUNT_UPDATE': {
        const data = parsed['data'] as AccountUpdateData | undefined;
        if (data) applyAccountUpdate(data);
        break;
      }
      case 'strategyUpdate': {
        const data = parsed['data'] as StrategyUpdateData | undefined;
        if (data) emit('strategyUpdate', { e: 'strategyUpdate', data });
        break;
      }
      default:
        emit(eventType, parsed);
    }
  }
}

// ── Connection ──

function setupVisibilityHandler(): void {
  if (visibilityHandler || typeof document === 'undefined') return;
  visibilityHandler = (): void => {
    if (
      document.visibilityState === 'visible' &&
      ws?.readyState !== WebSocket.OPEN &&
      _publicKeyHex && _privateKeyHex
    ) {
      reconnectDelay = RECONNECT_BASE_MS;
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      connect();
    }
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

function teardownVisibilityHandler(): void {
  if (!visibilityHandler || typeof document === 'undefined') return;
  document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
}

function connect(): void {
  if (!_publicKeyHex || !_privateKeyHex) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected.value = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectDelay = RECONNECT_BASE_MS;
    startPingInterval();
    // Authenticate immediately after connection
    authenticate();
  };

  ws.onmessage = handleMessage;

  ws.onclose = (event) => {
    connected.value = false;
    authenticated.value = false;
    ws = null;
    stopPingInterval();

    // Skip reconnect on auth-error codes — credentials need to be refreshed.
    if (AUTH_ERROR_CODES.has(event.code)) {
      debugLog('[Strike User WS] Auth error close code, not reconnecting:', event.code);
      return;
    }

    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  };

  ws.onerror = () => ws?.close();
}

function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectDelay = RECONNECT_BASE_MS;
  if (orderBatchTimer) { clearTimeout(orderBatchTimer); orderBatchTimer = null; }
  orderBatch = [];
  stopPingInterval();
  teardownVisibilityHandler();
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  connected.value = false;
  authenticated.value = false;
  _accountId = null;
  _privateKeyHex = null;
  _publicKeyHex = null;
  positionsMap.value = new Map();
  openOrdersMap.value = new Map();
}

// ── Public API ──

function on(eventType: string, cb: EventCallback): () => void {
  if (!listeners.has(eventType)) listeners.set(eventType, new Set());
  listeners.get(eventType)!.add(cb);
  return () => listeners.get(eventType)?.delete(cb);
}

/**
 * Connect with Strike API keys. Call after user authenticates.
 */
function connectWithKeys(publicKeyHex: string, privateKeyHex: string): void {
  _publicKeyHex = publicKeyHex;
  _privateKeyHex = privateKeyHex;
  _accountId = null;
  setupVisibilityHandler();
  connect();
}

/**
 * Subscribe to a vault's public userstream (no auth required).
 */
function subscribeVault(vaultId: string): void {
  send({
    method: 'subscribe',
    channel: 'userstream',
    vault_id: vaultId,
    id: nextId(),
  });
}

export function useStrikeUserWs() {
  return {
    connected,
    authenticated,
    positionsMap,
    openOrdersMap,
    connectWithKeys,
    disconnect,
    subscribeVault,

    // Event listeners
    onAccountUpdate: (cb: EventCallback) => on('ACCOUNT_UPDATE', cb),
    onOrderUpdate: (cb: EventCallback) => on('ORDER_TRADE_UPDATE', cb),
    onStrategyUpdate: (cb: EventCallback) => on('strategyUpdate', cb),
    onAny: (cb: EventCallback) => on('*', cb),
  };
}
