// src/services/support/actionCable.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSupportCable, type CableSocket, type SupportCableState } from './actionCable';
import type { SupportApiMessage } from '@/api/chatwootSupport.client';

class FakeSocket implements CableSocket {
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }

  /** Drive a server frame in (objects are JSON-stringified like the real socket). */
  emit(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }
  open(): void {
    this.onopen?.();
  }
  drop(): void {
    this.onclose?.();
  }
}

function harness(overrides: Partial<Parameters<typeof createSupportCable>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const messages: SupportApiMessage[] = [];
  const states: SupportCableState[] = [];
  const reconnected = vi.fn();
  const cable = createSupportCable({
    pubsubToken: 'tok-1',
    url: 'wss://support.example.test/cable',
    onMessage: (m) => messages.push(m),
    onState: (s) => states.push(s),
    onReconnected: reconnected,
    socketFactory: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    retryDelaysMs: [1000, 2000],
    ...overrides,
  });
  return { cable, sockets, messages, states, reconnected };
}

/** Bring a cable to the fully-subscribed state and return the live socket. */
function bringUp(h: ReturnType<typeof harness>): FakeSocket {
  h.cable.connect();
  const socket = h.sockets[h.sockets.length - 1];
  socket.open();
  socket.emit({ type: 'welcome' });
  socket.emit({ type: 'confirm_subscription', identifier: '{}' });
  return socket;
}

function messageFrame(data: Record<string, unknown>) {
  return { identifier: '{"channel":"RoomChannel"}', message: { event: 'message.created', data } };
}

describe('support ActionCable', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the RoomChannel subscribe frame (identifier is a JSON string) after welcome', () => {
    const h = harness();
    h.cable.connect();
    const socket = h.sockets[0];
    socket.open();
    expect(socket.sent).toEqual([]); // nothing before welcome — ActionCable handshake order
    socket.emit({ type: 'welcome' });
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0])).toEqual({
      command: 'subscribe',
      identifier: JSON.stringify({ channel: 'RoomChannel', pubsub_token: 'tok-1' }),
    });
  });

  it('reports connecting then connected once the subscription is confirmed', () => {
    const h = harness();
    bringUp(h);
    expect(h.states).toEqual(['connecting', 'connected']);
    expect(h.cable.isConnected()).toBe(true);
  });

  it('ignores ping frames (no state churn, no messages)', () => {
    const h = harness();
    const socket = bringUp(h);
    socket.emit({ type: 'ping', message: 1700000000 });
    socket.emit({ type: 'ping', message: 1700000003 });
    expect(h.states).toEqual(['connecting', 'connected']);
    expect(h.messages).toEqual([]);
  });

  it('dispatches an agent message.created with its sender name', () => {
    const h = harness();
    const socket = bringUp(h);
    socket.emit(
      messageFrame({ id: 11, content: 'how can I help?', message_type: 1, created_at: 1700000001, sender: { name: 'Ada' } }),
    );
    expect(h.messages).toEqual([
      { id: 11, role: 'agent', text: 'how can I help?', agentName: 'Ada', createdAt: 1700000001000 },
    ]);
  });

  it("dispatches the user's own echoed message as role 'user'", () => {
    const h = harness();
    const socket = bringUp(h);
    socket.emit(messageFrame({ id: 12, content: 'gm', message_type: 0, created_at: 1700000002 }));
    expect(h.messages).toEqual([{ id: 12, role: 'user', text: 'gm', agentName: undefined, createdAt: 1700000002000 }]);
  });

  it('drops activity events (message_type 2) and private agent notes', () => {
    const h = harness();
    const socket = bringUp(h);
    socket.emit(messageFrame({ id: 13, content: 'Conversation resolved', message_type: 2, created_at: 1700000003 }));
    socket.emit(messageFrame({ id: 14, content: 'internal', message_type: 1, created_at: 1700000004, private: true }));
    expect(h.messages).toEqual([]);
  });

  it('ignores unknown events and malformed frames without throwing', () => {
    const h = harness();
    const socket = bringUp(h);
    expect(() => {
      socket.emit({ identifier: 'x', message: { event: 'conversation.typing_on', data: {} } });
      socket.emit({ type: 'something_new' });
      socket.emit('not json at all');
      socket.emit({ identifier: 'x', message: { event: 'message.created' } });
    }).not.toThrow();
    expect(h.messages).toEqual([]);
    expect(h.states).toEqual(['connecting', 'connected']);
  });

  it('reconnects with capped exponential backoff and fills the gap on re-subscribe', () => {
    const h = harness();
    const first = bringUp(h);
    first.drop();
    expect(h.states[h.states.length - 1]).toBe('reconnecting');
    expect(h.sockets).toHaveLength(1); // waits for the backoff delay

    vi.advanceTimersByTime(1000);
    expect(h.sockets).toHaveLength(2);
    const second = h.sockets[1];
    second.open();
    second.emit({ type: 'welcome' });
    expect(h.reconnected).not.toHaveBeenCalled(); // only after the subscription is live
    second.emit({ type: 'confirm_subscription' });
    expect(h.reconnected).toHaveBeenCalledTimes(1);
    expect(h.states[h.states.length - 1]).toBe('connected');
  });

  it('goes unavailable after the retry budget is exhausted, and no further sockets are opened', () => {
    const h = harness();
    const first = bringUp(h);
    first.drop();
    vi.advanceTimersByTime(1000);
    h.sockets[1].drop();
    vi.advanceTimersByTime(2000);
    h.sockets[2].drop();
    vi.advanceTimersByTime(60_000);
    expect(h.states[h.states.length - 1]).toBe('unavailable');
    expect(h.sockets).toHaveLength(3);
  });

  it('a successful reconnect resets the retry budget', () => {
    const h = harness();
    bringUp(h).drop();
    vi.advanceTimersByTime(1000);
    const second = h.sockets[1];
    second.open();
    second.emit({ type: 'welcome' });
    second.emit({ type: 'confirm_subscription' });
    second.drop();
    // Budget was reset, so the first (1000ms) delay applies again.
    vi.advanceTimersByTime(1000);
    expect(h.sockets).toHaveLength(3);
  });

  it('close() is intentional: closes the socket and never reconnects', () => {
    const h = harness();
    const socket = bringUp(h);
    h.cable.close();
    expect(socket.closed).toBe(true);
    expect(h.cable.isConnected()).toBe(false);
    socket.drop();
    vi.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('connect() is idempotent while a socket is live', () => {
    const h = harness();
    bringUp(h);
    h.cable.connect();
    h.cable.connect();
    expect(h.sockets).toHaveLength(1);
  });

  it('ignores message.created for a different conversation on the same contact', () => {
    let active: number | undefined = 42;
    const h = harness({ activeConversationId: () => active });
    const socket = bringUp(h);
    socket.emit(messageFrame({ id: 1, content: 'mine', message_type: 1, created_at: 1, conversation_id: 42 }));
    socket.emit(messageFrame({ id: 2, content: 'someone else', message_type: 1, created_at: 2, conversation_id: 99 }));
    expect(h.messages.map((m) => m.id)).toEqual([1]);

    // Frames are scoped at dispatch time: the conversation is created lazily, so
    // the id can still be unknown when the cable comes up.
    active = undefined;
    socket.emit(messageFrame({ id: 3, content: 'unscoped', message_type: 1, created_at: 3, conversation_id: 99 }));
    expect(h.messages.map((m) => m.id)).toEqual([1, 3]);
  });

  it('does not filter frames that carry no conversation_id', () => {
    const h = harness({ activeConversationId: () => 42 });
    const socket = bringUp(h);
    socket.emit(messageFrame({ id: 4, content: 'no scope field', message_type: 1, created_at: 4 }));
    expect(h.messages.map((m) => m.id)).toEqual([4]);
  });

  it('close() cancels the watchdog — no reconnect after an intentional close', () => {
    const h = harness({ pingTimeoutMs: 12_000 });
    const socket = bringUp(h);
    h.cable.close();
    const statesAfterClose = h.states.length;
    vi.advanceTimersByTime(120_000);
    expect(h.sockets).toHaveLength(1);
    expect(socket.closed).toBe(true);
    expect(h.states).toHaveLength(statesAfterClose); // watchdog never fired
  });

  it('gives up on a socket that never opens and retries', () => {
    const h = harness({ connectTimeoutMs: 8_000 });
    h.cable.connect();
    const socket = h.sockets[0];
    expect(h.states).toEqual(['connecting']);
    vi.advanceTimersByTime(8_000); // never fired onopen
    expect(socket.closed).toBe(true);
    expect(h.states[h.states.length - 1]).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('forces a reconnect when the server stops pinging', () => {
    const h = harness({ pingTimeoutMs: 12_000 });
    const socket = bringUp(h);
    socket.emit({ type: 'ping', message: 1 });
    vi.advanceTimersByTime(11_000);
    expect(h.sockets).toHaveLength(1);
    vi.advanceTimersByTime(2_000); // ping window elapsed -> treat as dead
    expect(socket.closed).toBe(true);
    expect(h.states[h.states.length - 1]).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('times out an unconfirmed subscription even while the server keeps pinging', () => {
    const h = harness({ pingTimeoutMs: 12_000 });
    h.cable.connect();
    const socket = h.sockets[0];
    socket.open();
    socket.emit({ type: 'welcome' });
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(3_000);
      socket.emit({ type: 'ping', message: i });
    }
    vi.advanceTimersByTime(3_000);
    expect(socket.closed).toBe(true);
    expect(h.cable.isConnected()).toBe(false);
    expect(h.states[h.states.length - 1]).toBe('reconnecting');
    vi.advanceTimersByTime(1_000);
    expect(h.sockets).toHaveLength(2);
  });
});
