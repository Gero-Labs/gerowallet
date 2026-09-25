import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// The real loading store: under vitest it is neither the background nor a
// browser context, so its setters only mutate `loadingState`, which is what
// these tests read. Its arm/release bookkeeping is part of what is under test.
import LoadingState, { loadingState } from '@/stores/loading';
import webSocketService from './websocket.service';

const BLOCK = { hash: 'b1', height: 100, slot: 1, epoch: 1, epoch_slot: 1, time: 1 };
/**
 * gero-sync's answer to a SUBSCRIBE (CatchUpService): it always carries the
 * subscription's `addresses`. A keep-alive SYNC_CHECK_OK carries only `block`.
 */
const ANSWER = { type: 'SYNC_CHECK_OK', block: BLOCK, addresses: ['addr_test1'], utxos: [], account: null };
const KEEP_ALIVE = { type: 'SYNC_CHECK_OK', block: BLOCK };

/**
 * The release waits for the handler's promise, then one macrotask (the loader
 * pass Dexie schedules at commit). Drain both.
 */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await vi.advanceTimersByTimeAsync(1);
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function open(onSync: (data: unknown) => unknown = vi.fn(), chain = 'CARDANO') {
  webSocketService.connect(chain, 'MAINNET', 'stake1test', 99, { onSync });
  const ws = FakeSocket.instances[FakeSocket.instances.length - 1];
  ws.onopen?.();
  return { ws, onSync };
}

const subscribes = (ws: FakeSocket) => ws.sent.map(s => JSON.parse(s)).filter(m => m.type === 'SUBSCRIBE');

describe('syncPending: "the list is last session\'s until gero-sync answers"', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    loadingState.syncPending = false;
    loadingState.loadingTxs = false;
    loadingState.connecting = false;
  });

  afterEach(() => {
    webSocketService.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('is armed when the socket opens, before `connecting` drops, and SUBSCRIBE goes out', () => {
    const arm = vi.spyOn(LoadingState, 'setSyncPending');
    const connecting = vi.spyOn(LoadingState, 'setConnecting');
    const { ws } = open();

    expect(subscribes(ws)).toHaveLength(1);
    expect(loadingState.syncPending).toBe(true);
    // Each setter is its own port message: arming after connecting=false left the
    // dashboard one frame with neither flag, in which an empty store read as "none".
    // Compare the ARM (true) against the DROP (false); connect() → close() clears
    // first, so the first setSyncPending call is not the arm.
    const armedAt = arm.mock.invocationCallOrder[arm.mock.calls.findIndex(call => call[0] === true)];
    const droppedAt = connecting.mock.invocationCallOrder[connecting.mock.calls.findIndex(call => call[0] === false)];
    expect(armedAt).toBeGreaterThan(0);
    expect(droppedAt).toBeGreaterThan(0);
    expect(armedAt).toBeLessThan(droppedAt);
  });

  it('clears on the SUBSCRIBE\'s SYNC_CHECK_OK: a wallet already at the tip is told so', async () => {
    const { ws, onSync } = open();
    ws.deliver(ANSWER);
    await settle();
    expect(loadingState.syncPending).toBe(false);
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('stays armed through a reconnect gap\'s SYNC batches and clears with the SYNC_CHECK_OK after them', async () => {
    // gero-sync pushes the transactions missed while logged out as plain SYNC
    // batches, then answers with SYNC_CHECK_OK. Releasing on the first batch
    // dropped the line while the rest of the gap was still on its way.
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }] });
    ws.deliver({ type: 'SYNC', block: { ...BLOCK, hash: 'b2', height: 101 }, transactions: [{ tx_hash: 't2' }] });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(2);
    expect(loadingState.syncPending).toBe(true);

    ws.deliver(ANSWER);
    await settle();
    expect(loadingState.syncPending).toBe(false);
  });

  it('is not released by a realtime block that lands before the answer', async () => {
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }] });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(loadingState.syncPending).toBe(true);
  });

  it('is not released by a keep-alive reply, blockless or not', async () => {
    const { ws, onSync } = open();
    ws.deliver({ type: 'SYNC_CHECK_OK' });
    ws.deliver(KEEP_ALIVE);
    await settle();
    // The block-stamped keep-alive still reaches the wallet (dashboard tip).
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(loadingState.syncPending).toBe(true);
  });

  it('is not released by the reply to a keep-alive sent before a resubscribe', async () => {
    const { ws } = open();
    ws.deliver(ANSWER);
    await settle();
    expect(loadingState.syncPending).toBe(false);

    webSocketService.resubscribe(0);
    ws.deliver(KEEP_ALIVE); // answers the SYNC_CHECK that went out before the SUBSCRIBE
    await settle();
    expect(loadingState.syncPending).toBe(true);

    ws.deliver(ANSWER);
    await settle();
    expect(loadingState.syncPending).toBe(false);
  });

  it('clears on a Bitcoin reconnect\'s single SYNC, which carries the addresses and is the answer', async () => {
    const { ws, onSync } = open(vi.fn(), 'BITCOIN');
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [], addresses: ['bc1qtest'] });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(loadingState.syncPending).toBe(false);
  });

  it('is released by the backstop when no answer ever comes', async () => {
    open();
    await vi.advanceTimersByTimeAsync(299_999);
    expect(loadingState.syncPending).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadingState.syncPending).toBe(false);
  });

  it('clears only once the answer has been APPLIED, not when it arrived', async () => {
    // onSync resolves after the transactions are written. Clearing on receipt
    // made "Checking for new transactions…" vanish a beat before the new row.
    let applied!: () => void;
    const onSync = vi.fn(() => new Promise<void>(resolve => { applied = resolve; }));
    const { ws } = open(onSync);

    ws.deliver(ANSWER);
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect(loadingState.syncPending).toBe(true);

    applied();
    await settle();
    expect(loadingState.syncPending).toBe(false);
  });

  it('waits for the loader pass the answer caused, so the rows land before the line drops', async () => {
    // The commit resolves onSync; Dexie then wakes the TransactionsLoader on a
    // timer queued at that commit, which holds loadingTxs while it writes the
    // store. The release must not overtake it.
    const { ws } = open();
    ws.deliver(ANSWER);
    for (let i = 0; i < 6; i++) await Promise.resolve();
    LoadingState.setLoadingTxs(true); // the loader pass starts, before our deferred release
    await settle();
    expect(loadingState.syncPending).toBe(true);

    LoadingState.setLoadingTxs(false); // rows are in the store
    expect(loadingState.syncPending).toBe(false);
  });

  it('stays armed through catch-up batches and clears with CATCH_UP_COMPLETE', async () => {
    const { ws, onSync } = open();
    void webSocketService.waitForSync();

    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't1' }], catch_up_total: 2, catch_up_sent: 1 });
    ws.deliver({ type: 'SYNC', block: BLOCK, transactions: [{ tx_hash: 't2' }], catch_up_total: 2, catch_up_sent: 2 });
    await settle();
    // Batches are held, not applied, so nothing has answered yet.
    expect(onSync).not.toHaveBeenCalled();
    expect(loadingState.syncPending).toBe(true);

    ws.deliver({ type: 'CATCH_UP_COMPLETE', block: BLOCK, totalTransactions: 2, addresses: ['addr_test1'] });
    await settle();
    expect(onSync).toHaveBeenCalledTimes(1);
    expect((onSync as ReturnType<typeof vi.fn>).mock.calls[0][0].transactions).toHaveLength(2);
    expect(loadingState.syncPending).toBe(false);
  });

  it('re-arms on resubscribe: a new SUBSCRIBE is a new first answer to wait for', async () => {
    const { ws } = open();
    ws.deliver(ANSWER);
    await settle();
    expect(loadingState.syncPending).toBe(false);

    webSocketService.resubscribe(0);
    expect(subscribes(ws)).toHaveLength(2);
    expect(loadingState.syncPending).toBe(true);
  });

  it('keeps a resubscribe made INSIDE the handler armed when that handler\'s answer is released', async () => {
    // setSync re-subscribes when gero-sync reports an address past the derived
    // credential window (funds received on it while logged out). The answer
    // that triggered it must not un-arm the new subscription on its way out.
    // Like setSync, it expands once: the re-catch-up already covers the new range.
    let expanded = false;
    const onSync = vi.fn(async () => {
      if (!expanded) {
        expanded = true;
        webSocketService.resubscribe(0);
      }
    });
    const { ws } = open(onSync);

    ws.deliver(ANSWER);
    await settle();
    expect(subscribes(ws)).toHaveLength(2);
    expect(loadingState.syncPending).toBe(true);

    // The answer to the NEW subscription releases it.
    ws.deliver(ANSWER);
    await settle();
    expect(loadingState.syncPending).toBe(false);
  });

  it('treats a duplicate-block answer as answered rather than leaving the flag armed', async () => {
    const answerSync = { type: 'SYNC', block: BLOCK, addresses: ['bc1qtest'] };
    const { ws } = open(vi.fn(), 'BITCOIN');
    ws.deliver(answerSync);
    await settle();
    webSocketService.resubscribe(99);
    expect(loadingState.syncPending).toBe(true);

    ws.deliver(answerSync); // same hash: skipped by the tip cache
    await settle();
    expect(loadingState.syncPending).toBe(false);
  });

  it('does not treat a duplicate plain block as the answer', async () => {
    const { ws } = open();
    ws.deliver({ type: 'SYNC', block: BLOCK });
    ws.deliver({ type: 'SYNC', block: BLOCK }); // same hash: skipped by the tip cache
    await settle();
    expect(loadingState.syncPending).toBe(true);
  });

  it('clears when the socket drops, and re-arms on the reconnect\'s SUBSCRIBE', () => {
    const { ws } = open();
    ws.onclose?.({ code: 1006, reason: '' });
    expect(loadingState.syncPending).toBe(false);

    vi.advanceTimersByTime(3000);
    const reconnected = FakeSocket.instances[FakeSocket.instances.length - 1];
    expect(reconnected).not.toBe(ws);
    reconnected.onopen?.();
    expect(subscribes(reconnected)).toHaveLength(1);
    expect(loadingState.syncPending).toBe(true);
  });

  it('clears on an intentional close (logout, wallet switch)', () => {
    open();
    webSocketService.close();
    expect(loadingState.syncPending).toBe(false);
  });

  it('clears when waitForSync gives up, so a silent socket cannot pin the indicator', async () => {
    open();
    void webSocketService.waitForSync(1000);
    expect(loadingState.syncPending).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(loadingState.syncPending).toBe(false);
  });
});
