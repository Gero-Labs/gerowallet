/**
 * Pins the Midnight resume-cursor contract on the SUBSCRIBE frame.
 *
 * A null `midnightLastTxId` passed to `connect()` is an INSTRUCTION ("replay
 * from scratch"), not a missing value. midnight-sync.service passes null when
 * the wallet has a stored cursor but no preserved UTxOs, which is the only way
 * to rebuild a balance from transaction deltas.
 *
 * Both SUBSCRIBE paths used to live-read `midnightStore.lastMidnightTxId` over
 * the top of that null. Observed on mainnet 2026-09-07: the wallet logged
 * "forcing full replay" and "resume cursor=null", then sent
 * `midnightLastTxId=136562`. gero-sync answered SYNC_CHECK "caught up" and
 * never replayed, so USDM and NIGHT stayed invisible indefinitely.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture every frame the service sends, without a real socket.
const sent: Array<Record<string, unknown>> = [];

let lastSocket: FakeWebSocket;

class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
    lastSocket = this;
    // Fire onopen asynchronously, as a real socket would.
    setTimeout(() => this.onopen?.(), 0);
  }
  send(raw: string) {
    sent.push(JSON.parse(raw));
  }
  close() {
    /* no-op */
  }
}

vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);

// The store the override reads from. `lastMidnightTxId` is the stale cursor.
const midnightStoreMock: { lastMidnightTxId: number | null } = { lastMidnightTxId: null };
vi.mock('@/stores/midnightStore', () => ({
  midnightStore: midnightStoreMock,
  midnightActions: {},
}));

// Default export, matching `import LoadingState from '@/stores/loading'`.
vi.mock('@/stores/loading', () => ({
  default: {
    setConnecting: () => {},
    setConnected: () => {},
    setText: () => {},
    setProgress: () => {},
  },
  loadingState: {},
}));

vi.mock('@/utils/debug', () => ({ debugLog: () => {} }));

vi.mock('@/services/crossDevice/proveProtocol', () => ({ PROVE_MESSAGE_TYPES: [] }));

const flush = () => new Promise((r) => setTimeout(r, 5));

async function subscribeFrame(): Promise<Record<string, unknown>> {
  await flush();
  const frame = sent.find((f) => f['type'] === 'SUBSCRIBE');
  expect(frame, 'no SUBSCRIBE frame was sent').toBeTruthy();
  return frame!;
}

describe('Midnight resume cursor on SUBSCRIBE', () => {
  let ws: typeof import('../websocket.service').default;

  beforeEach(async () => {
    sent.length = 0;
    vi.resetModules();
    ws = (await import('../websocket.service')).default;
  });

  afterEach(() => ws.close());

  it('honours a caller null even when the store still holds a cursor', async () => {
    // The exact production state: cursor banked, UTxO set empty.
    midnightStoreMock.lastMidnightTxId = 136562;

    ws.connect('MIDNIGHT', 'midnight-mainnet', 'mn_addr1test', 0, {}, undefined, undefined, null);

    const frame = await subscribeFrame();
    // Must be null. Sending 136562 tells gero-sync "already caught up" and the
    // replay that rebuilds the balance never happens.
    expect(frame['midnightLastTxId']).toBeNull();
  });

  it('still refreshes a caller-supplied cursor that the store has advanced', async () => {
    // The behaviour the live-read exists for: a reconnect must not replay
    // history the wallet already applied.
    midnightStoreMock.lastMidnightTxId = 136562;

    ws.connect('MIDNIGHT', 'midnight-mainnet', 'mn_addr1test', 0, {}, undefined, undefined, 100);

    const frame = await subscribeFrame();
    expect(frame['midnightLastTxId']).toBe(136562);
  });

  it('sends the caller cursor when the store has none', async () => {
    midnightStoreMock.lastMidnightTxId = null;

    ws.connect('MIDNIGHT', 'midnight-mainnet', 'mn_addr1test', 0, {}, undefined, undefined, 42);

    const frame = await subscribeFrame();
    expect(frame['midnightLastTxId']).toBe(42);
  });

  it('forwards a blockless Midnight acknowledgment for generation validation', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    ws.connect('MIDNIGHT', 'midnight-stagenet', 'mn_addr_stagenet1test', 0, { onSync });
    await flush();
    const frame = { type: 'SYNC_CHECK_OK', midnight_network: 'midnight-stagenet',
      midnight_chain_generation: 1, midnight_genesis_hash: '0x' + 'ab'.repeat(32) };
    lastSocket.onmessage?.({ data: JSON.stringify(frame) });
    await flush();
    expect(onSync).toHaveBeenCalledWith({ ...frame, type: 'SYNC' });
  });

  it('keeps Cardano blockless acknowledgments out of its wallet state handler', async () => {
    const onSync = vi.fn().mockResolvedValue(undefined);
    ws.connect('CARDANO', 'preprod', 'stake_test1test', 0, { onSync });
    await flush();
    lastSocket.onmessage?.({ data: JSON.stringify({ type: 'SYNC_CHECK_OK' }) });
    await flush();
    expect(onSync).not.toHaveBeenCalled();
  });

});
