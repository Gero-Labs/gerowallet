/**
 * Rails ActionCable client for the Chatwoot support inbox (`wss://…/cable`).
 *
 * <p>Deliberately hand-rolled instead of pulling in `@rails/actioncable`: the
 * protocol we need is four frame types, and the extension already ships its own
 * WebSocket plumbing (see `src/services/websocket.service.ts`) rather than a
 * socket framework.
 *
 * <p>Protocol (verified against the live instance):
 * <ul>
 *   <li>server → {@code {"type":"welcome"}} on connect; the client only subscribes
 *       AFTER this, per the ActionCable handshake.</li>
 *   <li>client → {@code {"command":"subscribe","identifier":"<json string>"}} where
 *       the identifier is a JSON-encoded STRING (double-encoded on the wire).</li>
 *   <li>server → {@code {"type":"confirm_subscription"}} once the stream is live,
 *       then {@code {"type":"ping"}} roughly every 3s.</li>
 *   <li>server → {@code {identifier, message:{event:"message.created", data:{…}}}}
 *       for chat traffic. Any other event is ignored.</li>
 * </ul>
 *
 * <p>Nothing here is logged: the pubsub token is a bearer credential for the
 * conversation stream.
 */

import {
  normalizeChatwootMessage,
  SUPPORT_CABLE_URL,
  type RawChatwootMessage,
  type SupportApiMessage,
} from '@/api/chatwootSupport.client';
import { debugLog } from '@/utils/debug';

/** Connection states the cable reports. `idle` is owned by the composable, not the cable. */
export type SupportCableState = 'connecting' | 'connected' | 'reconnecting' | 'unavailable';

/** The slice of WebSocket the cable uses — lets tests inject a fake socket. */
export interface CableSocket {
  send(data: string): void;
  close(): void;
  onopen: ((...args: unknown[]) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((...args: unknown[]) => void) | null;
  onerror: ((...args: unknown[]) => void) | null;
}

export interface SupportCableOptions {
  /** Chatwoot contact `pubsub_token` — the stream credential. Never logged. */
  pubsubToken: string;
  /** Cable endpoint; defaults to the support origin's `/cable`. */
  url?: string;
  /**
   * The conversation the thread is currently showing, read at dispatch time (it
   * is created lazily, after the cable may already be up). A broadcast for any
   * OTHER conversation on this contact is ignored outright in v1 — not shown and
   * not counted as unread — because the UI has nowhere to put it.
   */
  activeConversationId?: () => number | undefined;
  /** Fired for every renderable message.created (activity + private notes dropped). */
  onMessage: (message: SupportApiMessage) => void;
  onState: (state: SupportCableState) => void;
  /**
   * Fired after a RE-subscribe (never on the first one). Messages broadcast while
   * the socket was down are not replayed, so the composable refetches history here.
   */
  onReconnected?: () => void;
  socketFactory?: (url: string) => CableSocket;
  /** Capped exponential backoff. Exhausting the list ends in `unavailable`. */
  retryDelaysMs?: number[];
  /** Treat the socket as dead if the server goes quiet for this long (pings are ~3s). */
  pingTimeoutMs?: number;
  /** Give up on a socket that never fires `onopen` (captive portal, black hole). */
  connectTimeoutMs?: number;
}

export interface SupportCable {
  /** Idempotent: no-op while a socket is live or a reconnect is scheduled. */
  connect(): void;
  /** Intentional teardown — cancels reconnects. A later connect() starts fresh. */
  close(): void;
  isConnected(): boolean;
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const DEFAULT_PING_TIMEOUT_MS = 20000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10000;

function defaultSocketFactory(url: string): CableSocket {
  return new WebSocket(url) as unknown as CableSocket;
}

interface CableFrame {
  type?: string;
  identifier?: string;
  message?: { event?: string; data?: unknown };
}

export function createSupportCable(options: SupportCableOptions): SupportCable {
  const url = options.url || SUPPORT_CABLE_URL;
  const makeSocket = options.socketFactory || defaultSocketFactory;
  const retryDelays = options.retryDelaysMs?.length ? options.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  const pingTimeoutMs = options.pingTimeoutMs ?? DEFAULT_PING_TIMEOUT_MS;
  const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const subscribeFrame = JSON.stringify({
    command: 'subscribe',
    identifier: JSON.stringify({ channel: 'RoomChannel', pubsub_token: options.pubsubToken }),
  });

  let socket: CableSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // One watchdog covers both dead phases: a socket that never opens (armed at
  // connect time) and an open socket that stops pinging (re-armed on every frame).
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let subscribed = false;
  let hasSubscribedBefore = false;
  let closedByUs = false;
  let exhausted = false;

  function clearTimers(): void {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearWatchdog();
  }

  function clearWatchdog(): void {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function detach(): void {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    socket = null;
  }

  function armWatchdog(timeoutMs: number, reason: string): void {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      // A socket that never opened, or an open one that stopped pinging, can sit
      // there indefinitely — drop it and let the normal backoff path bring it back.
      debugLog(`supportChat: cable ${reason}, forcing reconnect`);
      dropAndScheduleReconnect();
    }, timeoutMs);
  }

  function dropAndScheduleReconnect(): void {
    const current = socket;
    detach();
    try {
      current?.close();
    } catch {
      /* already closing */
    }
    scheduleReconnect();
  }

  function scheduleReconnect(): void {
    if (closedByUs || reconnectTimer) return;
    subscribed = false;
    clearWatchdog();
    if (attempt >= retryDelays.length) {
      exhausted = true;
      options.onState('unavailable');
      return;
    }
    const delay = retryDelays[attempt];
    attempt += 1;
    options.onState('reconnecting');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      open();
    }, delay);
  }

  function handleFrame(raw: unknown): void {
    let frame: CableFrame;
    try {
      frame = typeof raw === 'string' ? (JSON.parse(raw) as CableFrame) : (raw as CableFrame);
    } catch {
      return; // not JSON — nothing actionable
    }
    if (!frame || typeof frame !== 'object') return;

    switch (frame.type) {
      case 'welcome':
        socket?.send(subscribeFrame);
        armWatchdog(pingTimeoutMs, 'went quiet');
        return;
      case 'ping':
        // Heartbeats prove only that the socket is open, not that RoomChannel
        // accepted our token. A missing confirmation must still time out.
        if (subscribed) armWatchdog(pingTimeoutMs, 'went quiet');
        return;
      case 'confirm_subscription': {
        subscribed = true;
        attempt = 0;
        armWatchdog(pingTimeoutMs, 'went quiet');
        options.onState('connected');
        if (hasSubscribedBefore) options.onReconnected?.();
        hasSubscribedBefore = true;
        return;
      }
      case 'reject_subscription':
      case 'disconnect':
        dropAndScheduleReconnect();
        return;
      default:
        break;
    }

    if (frame.message?.event !== 'message.created') return; // unknown event -> ignore
    const data = frame.message.data as RawChatwootMessage | undefined;
    // A contact can hold several conversations (an agent may open a new one).
    // The dock renders exactly one, so anything else is dropped entirely in v1 —
    // showing it would be wrong and counting it unread would badge a thread the
    // user cannot open. Frames without a conversation_id are not filtered.
    const active = options.activeConversationId?.();
    if (
      active !== undefined &&
      typeof data?.conversation_id === 'number' &&
      data.conversation_id !== active
    ) {
      return;
    }
    const message = normalizeChatwootMessage(data);
    if (message) options.onMessage(message);
  }

  function open(): void {
    closedByUs = false;
    options.onState(attempt === 0 ? 'connecting' : 'reconnecting');
    let next: CableSocket;
    try {
      next = makeSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = next;
    // Armed BEFORE the socket can open: without this a socket that never fires
    // onopen would leave the cable stuck in `connecting` forever.
    armWatchdog(connectTimeoutMs, 'never opened');
    next.onopen = () => armWatchdog(pingTimeoutMs, 'opened but stayed silent');
    next.onmessage = (event) => handleFrame(event?.data);
    next.onclose = () => {
      if (socket !== next) return;
      detach();
      scheduleReconnect();
    };
    next.onerror = () => {
      if (socket !== next) return;
      detach();
      try {
        next.close();
      } catch {
        /* already closing */
      }
      scheduleReconnect();
    };
  }

  return {
    connect(): void {
      if (socket || reconnectTimer) return;
      if (exhausted) {
        // A later enter()/send() is allowed to retry after the budget ran out.
        exhausted = false;
        attempt = 0;
      }
      open();
    },
    close(): void {
      closedByUs = true;
      clearTimers();
      subscribed = false;
      attempt = 0;
      const current = socket;
      detach();
      try {
        current?.close();
      } catch {
        /* already closing */
      }
    },
    isConnected(): boolean {
      return subscribed;
    },
  };
}
