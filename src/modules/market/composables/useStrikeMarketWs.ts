import { ref } from 'vue';

const WS_URL = import.meta.env.VITE_STRIKE_WS_URL || 'wss://stream.strikefinance.org/ws';

type WsCallback = (data: unknown) => void;

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const connected = ref(false);
const subscriptions = new Map<string, Set<WsCallback>>();

function sendSubscribe(channel: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [channel], id: Date.now() }));
  }
}

function sendUnsubscribe(channel: string) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [channel], id: Date.now() }));
  }
}

function resubscribeAll() {
  subscriptions.forEach((callbacks, channel) => {
    if (callbacks.size > 0) {
      sendSubscribe(channel);
    }
  });
}

function handleMessage(event: MessageEvent) {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(event.data as string) as Record<string, unknown>;
  } catch {
    return;
  }

  // Route by stream field (e.g. "btcusdt@ticker") or by event type
  const stream = (data.stream as string) || (data.e as string) || null;
  if (!stream) return;

  const callbacks = subscriptions.get(stream);
  if (callbacks) {
    callbacks.forEach((cb) => cb(data.data !== undefined ? data.data : data));
  }
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected.value = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    resubscribeAll();
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    connected.value = false;
    ws = null;
    reconnectTimer = setTimeout(() => {
      connect();
    }, 5000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  connected.value = false;
}

function subscribe(channel: string, callback: WsCallback): () => void {
  if (!subscriptions.has(channel)) {
    subscriptions.set(channel, new Set());
    sendSubscribe(channel);
  }
  subscriptions.get(channel)!.add(callback);

  return () => {
    const callbacks = subscriptions.get(channel);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        subscriptions.delete(channel);
        sendUnsubscribe(channel);
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

  function subscribeTicker(symbol: string, cb: WsCallback): () => void {
    return subscribe(`${symbol.toLowerCase()}@ticker`, cb);
  }

  function subscribeOrderBook(symbol: string, cb: WsCallback): () => void {
    return subscribe(`${symbol.toLowerCase()}@depth`, cb);
  }

  function subscribeTrades(symbol: string, cb: WsCallback): () => void {
    return subscribe(`${symbol.toLowerCase()}@trade`, cb);
  }

  function subscribeMarkPrice(symbol: string, cb: WsCallback): () => void {
    return subscribe(`${symbol.toLowerCase()}@markPrice`, cb);
  }

  return {
    connected,
    subscribe,
    disconnect,
    subscribeTicker,
    subscribeOrderBook,
    subscribeTrades,
    subscribeMarkPrice,
  };
}
