/**
 * Strike v2 Market Data WebSocket
 *
 * Public, no authentication required.
 * URL: wss://api-v2.strikefinance.org/ws/price
 *
 * Protocol:
 *   Subscribe:   { method: "subscribe", channel: "<name>", symbol: "BTC-USD", id: N }
 *   Unsubscribe: { method: "unsubscribe", channel: "<name>", symbol: "BTC-USD", id: N }
 *   Ping:        { method: "ping", id: N }
 *   Pong:        { method: "pong", id: N }
 *
 * Channels:
 *   markprice        — Mark price + funding (per symbol, 3s)
 *   !markprice@arr   — Mark price for all symbols (3s)
 *   miniticker       — 24h mini ticker (per symbol, 1s)
 *   !miniticker@arr  — Mini ticker for all symbols (1s)
 *   depth            — Order book updates (per symbol, real-time)
 *   trade            — Trade executions (per symbol, real-time)
 *   kline_{interval} — Candlestick data (per symbol, real-time)
 *
 * Events arrive as JSON with "e" field identifying the type:
 *   markPriceUpdate, 24hrMiniTicker, depthUpdate, trade, kline
 *
 * Server pings every 54s, drops connection if no pong within 60s.
 */

import { ref } from 'vue';

const WS_URL =
  (import.meta.env.VITE_STRIKE_WS_URL as string | undefined) ??
  'wss://api-v2.strikefinance.org/ws/price';

type WsCallback = (data: unknown) => void;

// Subscription key: "channel:symbol" or just "channel" for global streams
interface Subscription {
  channel: string;
  symbol?: string;
  callbacks: Set<WsCallback>;
}

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let msgId = 0;
const connected = ref(false);
const subscriptions = new Map<string, Subscription>();

function subKey(channel: string, symbol?: string): string {
  return symbol ? `${channel}:${symbol}` : channel;
}

function nextId(): number {
  return ++msgId;
}

function send(msg: Record<string, unknown>): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendSubscribe(channel: string, symbol?: string): void {
  const msg: Record<string, unknown> = { method: 'subscribe', channel, id: nextId() };
  if (symbol) msg.symbol = symbol;
  send(msg);
}

function sendUnsubscribe(channel: string, symbol?: string): void {
  const msg: Record<string, unknown> = { method: 'unsubscribe', channel, id: nextId() };
  if (symbol) msg.symbol = symbol;
  send(msg);
}

function resubscribeAll(): void {
  for (const sub of subscriptions.values()) {
    if (sub.callbacks.size > 0) {
      sendSubscribe(sub.channel, sub.symbol);
    }
  }
}

function startPingInterval(): void {
  stopPingInterval();
  pingInterval = setInterval(() => send({ method: 'ping', id: nextId() }), 30_000);
}

function stopPingInterval(): void {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

function handleMessage(event: MessageEvent): void {
  const raw = event.data as string;
  if (!raw) return;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }

  // Server pong — ignore
  if (typeof data === 'object' && data !== null && (data as Record<string, unknown>).method === 'pong') return;
  // Subscribe/unsubscribe ack — ignore
  if (typeof data === 'object' && data !== null && 'result' in (data as Record<string, unknown>)) return;

  // Array events (e.g., !markprice@arr, !miniticker@arr)
  if (Array.isArray(data)) {
    // Route each item individually by event type "e" + symbol "s"
    for (const item of data) {
      routeEvent(item as Record<string, unknown>);
    }
    // Also fire the array channel callbacks with the full array
    const eventType = (data[0] as Record<string, unknown>)?.e as string;
    if (eventType === 'markPriceUpdate') {
      fireCallbacks('!markprice@arr', undefined, data);
    } else if (eventType === '24hrMiniTicker') {
      fireCallbacks('!miniticker@arr', undefined, data);
    }
    return;
  }

  // Single event
  if (typeof data === 'object' && data !== null) {
    routeEvent(data as Record<string, unknown>);
  }
}

function routeEvent(event: Record<string, unknown>): void {
  const eventType = event.e as string;
  const symbol = event.s as string | undefined;

  if (!eventType) return;

  // Map event type → channel name
  let channel: string | undefined;
  switch (eventType) {
    case 'markPriceUpdate': channel = 'markprice'; break;
    case '24hrMiniTicker': channel = 'miniticker'; break;
    case 'depthUpdate': channel = 'depth'; break;
    case 'trade': channel = 'trade'; break;
    case 'kline': {
      const interval = (event.k as Record<string, unknown>)?.i as string;
      if (interval) channel = `kline_${interval}`;
      break;
    }
  }

  if (channel && symbol) {
    fireCallbacks(channel, symbol, event);
  }
}

function fireCallbacks(channel: string, symbol: string | undefined, data: unknown): void {
  const key = subKey(channel, symbol);
  const sub = subscriptions.get(key);
  if (sub) {
    sub.callbacks.forEach(cb => cb(data));
  }
}

function connect(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected.value = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    resubscribeAll();
    startPingInterval();
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    connected.value = false;
    ws = null;
    stopPingInterval();
    reconnectTimer = setTimeout(connect, 5000);
  };

  ws.onerror = () => ws?.close();
}

function disconnect(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  stopPingInterval();
  if (ws) { ws.onclose = null; ws.close(); ws = null; }
  connected.value = false;
}

function subscribe(channel: string, symbol: string | undefined, callback: WsCallback): () => void {
  const key = subKey(channel, symbol);
  if (!subscriptions.has(key)) {
    subscriptions.set(key, { channel, symbol, callbacks: new Set() });
    sendSubscribe(channel, symbol);
  }
  subscriptions.get(key)!.callbacks.add(callback);

  return () => {
    const sub = subscriptions.get(key);
    if (sub) {
      sub.callbacks.delete(callback);
      if (sub.callbacks.size === 0) {
        subscriptions.delete(key);
        sendUnsubscribe(channel, symbol);
      }
    }
  };
}

let initialized = false;

export function useStrikeMarketWs() {
  if (!initialized) {
    initialized = true;
    connect();
  }

  return {
    connected,
    disconnect,

    // Per-symbol subscriptions
    subscribeMarkPrice: (symbol: string, cb: WsCallback) => subscribe('markprice', symbol, cb),
    subscribeMiniTicker: (symbol: string, cb: WsCallback) => subscribe('miniticker', symbol, cb),
    subscribeDepth: (symbol: string, cb: WsCallback) => subscribe('depth', symbol, cb),
    subscribeTrades: (symbol: string, cb: WsCallback) => subscribe('trade', symbol, cb),
    subscribeKline: (symbol: string, interval: string, cb: WsCallback) => subscribe(`kline_${interval}`, symbol, cb),

    // All-symbol subscriptions
    subscribeAllMarkPrices: (cb: WsCallback) => subscribe('!markprice@arr', undefined, cb),
    subscribeAllMiniTickers: (cb: WsCallback) => subscribe('!miniticker@arr', undefined, cb),

    // Low-level
    subscribe: (channel: string, symbol: string | undefined, cb: WsCallback) => subscribe(channel, symbol, cb),
  };
}
