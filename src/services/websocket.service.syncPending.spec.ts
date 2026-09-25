import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loading = vi.hoisted(() => ({
  setSyncPending: vi.fn(),
  setConnected: vi.fn(),
  setConnecting: vi.fn(),
  setText: vi.fn(),
  setProgress: vi.fn(),
  setLoading: vi.fn(),
  setRestoring: vi.fn(),
  setSyncing: vi.fn(),
  setLoadingTxs: vi.fn(),
  state: {},
}));
vi.mock('@/stores/loading', () => ({ default: loading, loadingState: loading.state }));
vi.mock('@/stores/midnightStore', () => ({ midnightStore: { chainIdentity: null, lastMidnightTxId: null } }));
vi.mock('@/services/crossDevice/proveProtocol', () => ({ PROVE_MESSAGE_TYPES: [] }));
vi.mock('@/utils/debug', () => ({ debugLog: () => undefined }));

/** A socket the test drives by hand: open, deliver frames, close. */
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

const BLOCK = { hash: 'b1', height: 100, slot: 1, epoch: 1, epoch_slot: 1, time: 1 };

/** The value of the most recent setSyncPending call, or undefined if none. */
const lastPending = () => loading.setSyncPending.mock.lastCall?.[0];

function open(onSync = vi.fn()) {
  webSocketService.connect('CARDANO', 'MAINNET', 'stake1test', 99, { onSync });
  const ws = FakeSocket.instances[FakeSocket.instances.length - 1];
  ws.onopen?.();
  return { ws, onSync };
}

describe('syncPending: "the list is last session\'s until gero-sync answers"', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    webSocketService.close();
    vi.useRealTimers();
  });

  it('is armed right after SUBSCRIBE goes out', () => {
    const { ws } = open();
    expect(JSON.parse(ws.sent[0]).type).toBe('SUBSCRIBE');
    expect(loading.setSyncPending).toHaveBeenCalledWith(true);
    expect(lastPending()).toBe(true);
  });

  it('clears on SYNC_CHECK_OK: a wallet already at the tip is told so', () => {
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC_CHECK_OK', block: BLOCK });
    expect(lastPending()).toBe(false);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('clears on a live SYNC', () => {
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }] });
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(lastPending()).toBe(false);
  });

  it('stays armed through catch-up batches and clears with CATCH_UP_COMPLETE', () => {
    const { ws, onSync } = open();
    void webSocketService.waitForSync();
    loading.setSyncPending.mockClear();

    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }], catch_up_total: 2, catch_up_sent: 1 });
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't2' }], catch_up_total: 2, catch_up_sent: 2 });
    // Batches are held, not applied, so nothing has answered yet.
    expect(onSync).not.toHaveBeenCalled();
    expect(loading.setSyncPending).not.toHaveBeenCalledWith(false);

    ws.deliver({ type: 'CATCH_UP_COMPLETE', block: BLOCK, totalTransactions: 2 });
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(onSync.mock.calls[0][0].transactions).toHaveLength(2);
    expect(lastPending()).toBe(false);
  });

  it('clears when the socket drops, and re-arms on the reconnect\'s SUBSCRIBE', () => {
    const { ws } = open();
    ws.onclose?.({ code: 1006, reason: '' });
    expect(lastPending()).toBe(false);

    vi.advanceTimersByTime(3000);
    const reconnected = FakeSocket.instances[FakeSocket.instances.length - 1];
    expect(reconnected).not.toBe(ws);
    reconnected.onopen?.();
    expect(JSON.parse(reconnected.sent[0]).type).toBe('SUBSCRIBE');
    expect(lastPending()).toBe(true);
  });

  it('clears on an intentional close (logout, wallet switch)', () => {
    open();
    webSocketService.close();
    expect(lastPending()).toBe(false);
  });

  it('clears when waitForSync gives up, so a silent socket cannot pin the indicator', () => {
    open();
    void webSocketService.waitForSync(1000);
    loading.setSyncPending.mockClear();
    vi.advanceTimersByTime(1000);
    expect(lastPending()).toBe(false);
  });
});
