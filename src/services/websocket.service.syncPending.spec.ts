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

/** The clear waits for the handler's promise; drain the microtasks it takes. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function open(onSync: (data: unknown) => unknown = vi.fn()) {
  webSocketService.connect('CARDANO', 'MAINNET', 'stake1test', 99, { onSync });
  const ws = FakeSocket.instances[FakeSocket.instances.length - 1];
  ws.onopen?.();
  return { ws, onSync };
}

const subscribes = (ws: FakeSocket) => ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'SUBSCRIBE');

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

  it('is armed when the socket opens, before `connecting` drops, and SUBSCRIBE goes out', () => {
    const { ws } = open();
    expect(subscribes(ws)).toHaveLength(1);
    expect(lastPending()).toBe(true);
    // Each setter is its own port message: arming after connecting=false left the
    // dashboard one frame with neither flag, in which an empty store read as "none".
    const armed = loading.setSyncPending.mock.invocationCallOrder[0];
    const connectingDropped = loading.setConnecting.mock.invocationCallOrder.at(-1)!;
    expect(loading.setConnecting.mock.lastCall?.[0]).toBe(false);
    expect(armed).toBeLessThan(connectingDropped);
  });

  it('clears on SYNC_CHECK_OK: a wallet already at the tip is told so', async () => {
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC_CHECK_OK', block: BLOCK });
    await settle();
    expect(lastPending()).toBe(false);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('clears on a live SYNC', async () => {
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }] });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(lastPending()).toBe(false);
  });

  it('clears only once the answer has been APPLIED, not when it arrived', async () => {
    // onSync resolves after the transactions are written. Clearing on receipt
    // made "Checking for new transactions…" vanish a beat before the new row.
    let applied!: () => void;
    const onSync = vi.fn(() => new Promise<void>(resolve => { applied = resolve; }));
    const { ws } = open(onSync);
    loading.setSyncPending.mockClear();

    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }] });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(loading.setSyncPending).not.toHaveBeenCalled();

    applied();
    await settle();
    expect(lastPending()).toBe(false);
  });

  it('stays armed through catch-up batches and clears with CATCH_UP_COMPLETE', async () => {
    const { ws, onSync } = open();
    void webSocketService.waitForSync();
    loading.setSyncPending.mockClear();

    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }], catch_up_total: 2, catch_up_sent: 1 });
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't2' }], catch_up_total: 2, catch_up_sent: 2 });
    await settle();
    // Batches are held, not applied, so nothing has answered yet.
    expect(onSync).not.toHaveBeenCalled();
    expect(loading.setSyncPending).not.toHaveBeenCalledWith(false);

    ws.deliver({ type: 'CATCH_UP_COMPLETE', block: BLOCK, totalTransactions: 2 });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect((onSync as ReturnType<typeof vi.fn>).mock.calls[0][0].transactions).toHaveLength(2);
    expect(lastPending()).toBe(false);
  });

  it('re-arms on resubscribe: a new SUBSCRIBE is a new first answer to wait for', async () => {
    const { ws } = open();
    ws.deliver({ type: 'SYNC_CHECK_OK', block: BLOCK });
    await settle();
    expect(lastPending()).toBe(false);

    webSocketService.resubscribe(0);
    expect(subscribes(ws)).toHaveLength(2);
    expect(lastPending()).toBe(true);
  });

  it('clears when the socket drops, and re-arms on the reconnect\'s SUBSCRIBE', () => {
    const { ws } = open();
    ws.onclose?.({ code: 1006, reason: '' });
    expect(lastPending()).toBe(false);

    vi.advanceTimersByTime(3000);
    const reconnected = FakeSocket.instances[FakeSocket.instances.length - 1];
    expect(reconnected).not.toBe(ws);
    reconnected.onopen?.();
    expect(subscribes(reconnected)).toHaveLength(1);
    expect(lastPending()).toBe(true);
  });

  it('clears on an intentional close (logout, wallet switch)', () => {
    open();
    webSocketService.close();
    expect(lastPending()).toBe(false);
  });

  it('clears when waitForSync gives up, so a silent socket cannot pin the indicator', async () => {
    open();
    void webSocketService.waitForSync(1000);
    loading.setSyncPending.mockClear();
    vi.advanceTimersByTime(1000);
    await settle();
    expect(lastPending()).toBe(false);
  });
});
