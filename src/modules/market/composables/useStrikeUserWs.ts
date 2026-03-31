import { ref } from 'vue';
import { hasStrikeApiKeys } from '@/api/strike-v2.client';

type EventCallback = (data: unknown) => void;

const STRIKE_USER_WS_URL =
  (import.meta.env.VITE_STRIKE_WS_USER_URL as string | undefined) ??
  'wss://stream.strikefinance.org/ws/user';

// Module-level singletons
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Map<string, Set<EventCallback>>();

const connected = ref(false);

function getOrCreateListenerSet(eventType: string): Set<EventCallback> {
  if (!listeners.has(eventType)) {
    listeners.set(eventType, new Set());
  }
  return listeners.get(eventType)!;
}

function emit(eventType: string, data: unknown): void {
  listeners.get(eventType)?.forEach((cb) => cb(data));
  listeners.get('*')?.forEach((cb) => cb(data));
}

function handleMessage(event: MessageEvent): void {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(event.data as string);
  } catch {
    return;
  }
  const eventType = (parsed.e ?? parsed.type) as string | undefined;
  if (eventType) {
    emit(eventType, parsed);
  }
}

function connect(listenKey?: string): void {
  if (!hasStrikeApiKeys()) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const url = listenKey ? `${STRIKE_USER_WS_URL}?listenKey=${listenKey}` : STRIKE_USER_WS_URL;

  ws = new WebSocket(url);

  ws.onopen = () => {
    connected.value = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    connected.value = false;
    ws = null;
    reconnectTimer = setTimeout(() => connect(listenKey), 5000);
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
  connected.value = false;
}

function subscribe(eventType: string, cb: EventCallback): () => void {
  getOrCreateListenerSet(eventType).add(cb);
  return () => {
    listeners.get(eventType)?.delete(cb);
  };
}

function onAccountUpdate(cb: EventCallback): () => void {
  return subscribe('ACCOUNT_UPDATE', cb);
}

function onOrderUpdate(cb: EventCallback): () => void {
  return subscribe('ORDER_TRADE_UPDATE', cb);
}

function onPositionUpdate(cb: EventCallback): () => void {
  return subscribe('POSITION_UPDATE', cb);
}

function onBalanceUpdate(cb: EventCallback): () => void {
  return subscribe('BALANCE_UPDATE', cb);
}

function onAny(cb: EventCallback): () => void {
  return subscribe('*', cb);
}

export function useStrikeUserWs() {
  return {
    connected,
    connect,
    disconnect,
    onAccountUpdate,
    onOrderUpdate,
    onPositionUpdate,
    onBalanceUpdate,
    onAny,
  };
}
