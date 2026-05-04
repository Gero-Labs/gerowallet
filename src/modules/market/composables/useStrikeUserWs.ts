/**
 * Strike v2 User Data WebSocket
 *
 * URL: wss://api.strikefinance.org/ws/user-api
 *
 * Authentication flow:
 *   1. Connect to WebSocket
 *   2. Send session.logon with Ed25519 signature of "session.logon:{timestamp}:{apiKey}"
 *   3. On success (status 200), subscribe to "userstream" channel with account_id
 *
 * Events:
 *   ACCOUNT_UPDATE      — balance changes, position updates, deposits, withdrawals, funding
 *   ORDER_TRADE_UPDATE  — order lifecycle events and trade executions (fills)
 *
 * IMPORTANT: Server may batch multiple JSON events in a single frame separated by newline.
 * Must split on \n and parse each individually.
 *
 * Server pings every 54s, drops if no pong within 60s.
 */

import { ref } from 'vue';
import * as ed25519 from '@noble/ed25519';
import { hexToBytes, bytesToHex } from '@/api/strike-v2.auth';
import { debugLog } from '@/utils/debug';

const WS_URL =
  (import.meta.env.VITE_STRIKE_WS_USER_URL as string | undefined) ??
  'wss://api.strikefinance.org/ws/user-api';

type EventCallback = (data: unknown) => void;

// Keys for authentication (set via connectWithKeys)
let _publicKeyHex: string | null = null;
let _privateKeyHex: string | null = null;
let _accountId: string | null = null;

const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 60_000;

// Module-level singletons
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = RECONNECT_BASE_MS;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let msgId = 0;
const listeners = new Map<string, Set<EventCallback>>();
const connected = ref(false);
const authenticated = ref(false);

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

async function authenticate(): Promise<void> {
  if (!_publicKeyHex || !_privateKeyHex) return;

  const timestamp = Date.now();
  const message = `session.logon:${timestamp}:${_publicKeyHex}`;
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

function handleMessage(event: MessageEvent): void {
  const raw = event.data as string;
  if (!raw) return;

  // Server may batch multiple JSON events separated by newline
  const lines = raw.split('\n').filter(l => l.trim());

  for (const line of lines) {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    // Handle auth response
    if (parsed.status === 200 && (parsed.result as Record<string, unknown>)?.authenticated) {
      authenticated.value = true;
      _accountId = (parsed.result as Record<string, unknown>).account_id as string;
      subscribeUserStream();
      continue;
    }

    // Handle pong
    if (parsed.method === 'pong') continue;

    // Handle subscribe ack
    if ('result' in parsed && parsed.result === null) continue;

    // Handle errors
    if (parsed.e === 'error' || parsed.error) {
      debugLog('[Strike User WS] Error:', parsed.error || parsed);
      continue;
    }

    // Route events
    const eventType = parsed.e as string | undefined;
    if (eventType) {
      emit(eventType, parsed);
    }
  }
}

// ── Connection ──

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

  ws.onclose = () => {
    connected.value = false;
    authenticated.value = false;
    ws = null;
    stopPingInterval();
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  };

  ws.onerror = () => ws?.close();
}

function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  reconnectDelay = RECONNECT_BASE_MS;
  stopPingInterval();
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  connected.value = false;
  authenticated.value = false;
  _accountId = null;
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
    connectWithKeys,
    disconnect,
    subscribeVault,

    // Event listeners
    onAccountUpdate: (cb: EventCallback) => on('ACCOUNT_UPDATE', cb),
    onOrderUpdate: (cb: EventCallback) => on('ORDER_TRADE_UPDATE', cb),
    onAny: (cb: EventCallback) => on('*', cb),
  };
}
