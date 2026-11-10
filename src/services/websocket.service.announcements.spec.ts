import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/midnightStore', () => ({ midnightStore: { chainIdentity: null, lastMidnightTxId: null } }));
vi.mock('@/services/crossDevice/proveProtocol', () => ({ PROVE_MESSAGE_TYPES: [] }));
vi.mock('@/utils/debug', () => ({ debugLog: () => undefined }));

/** A socket the test drives by hand. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.OPEN;
  binaryType = '';
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = FakeSocket.CLOSED;
  }
  deliver(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}
vi.stubGlobal('WebSocket', FakeSocket);

import webSocketService from './websocket.service';

// The `ANNOUNCEMENTS` frame is a poke: the public feed's version number. It carries no content and
// must not touch sync state, whatever else a frame of that type claims to hold.
describe('the ANNOUNCEMENTS frame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });

  afterEach(() => {
    webSocketService.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function open() {
    const onSync = vi.fn(async () => undefined);
    const onRollback = vi.fn(async () => undefined);
    const onForceResync = vi.fn(async () => undefined);
    const onAnnouncements = vi.fn();
    webSocketService.connect('CARDANO', 'MAINNET', 'stake1test', 99, { onSync, onRollback, onForceResync, onAnnouncements });
    const ws = FakeSocket.instances[FakeSocket.instances.length - 1]!;
    ws.onopen?.();
    return { ws, onSync, onRollback, onForceResync, onAnnouncements };
  }

  it('hands on the version number and nothing else', () => {
    const { ws, onAnnouncements } = open();
    ws.deliver({ type: 'ANNOUNCEMENTS', seq: 7, title: 'Send your funds here', items: [{ payload: 'x' }], transactions: [{ hash: 'a' }] });
    expect(onAnnouncements).toHaveBeenCalledTimes(1);
    expect(onAnnouncements).toHaveBeenCalledWith(7);
  });

  it('is not sync data: no sync, rollback or resync handler runs', () => {
    const { ws, onSync, onRollback, onForceResync } = open();
    ws.deliver({ type: 'ANNOUNCEMENTS', seq: 7, block: { hash: 'b', height: 5 }, utxos: [], addresses: ['addr1'] });
    expect(onSync).not.toHaveBeenCalled();
    expect(onRollback).not.toHaveBeenCalled();
    expect(onForceResync).not.toHaveBeenCalled();
  });

  it('is ignored by a connection that has no handler for it', () => {
    webSocketService.connect('CARDANO', 'MAINNET', 'stake1test', 99, { onSync: vi.fn(async () => undefined) });
    const ws = FakeSocket.instances[FakeSocket.instances.length - 1]!;
    ws.onopen?.();
    expect(() => ws.deliver({ type: 'ANNOUNCEMENTS', seq: 7 })).not.toThrow();
  });
});
