// Gero Sync SOLANA on the shared WebSocket state machine (gero-sync docs/solana-wire.md).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/midnightStore', () => ({ midnightStore: { chainIdentity: null, lastMidnightTxId: null } }));
vi.mock('@/services/crossDevice/proveProtocol', () => ({ PROVE_MESSAGE_TYPES: [] }));
vi.mock('@/utils/debug', () => ({ debugLog: () => undefined }));

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

const ADDRESS = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';

function open(cursor = 312345000) {
  const onSync = vi.fn(async () => {});
  webSocketService.connect('SOLANA', 'DEVNET', ADDRESS, cursor, { onSync });
  const ws = FakeSocket.instances[FakeSocket.instances.length - 1];
  ws.onopen?.();
  return { ws, onSync };
}

const sentOfType = (ws: FakeSocket, type: string) => ws.sent.map((s) => JSON.parse(s)).filter((m) => m.type === type);
const cursorOf = () => (webSocketService as unknown as { lastSyncedBlock: number }).lastSyncedBlock;

describe('Gero Sync SOLANA', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
  });

  afterEach(() => {
    webSocketService.close();
    vi.useRealTimers();
  });

  it('subscribes by address with the slot cursor, and nothing Cardano or Midnight', () => {
    const { ws } = open();
    expect(sentOfType(ws, 'SUBSCRIBE')).toEqual([
      { type: 'SUBSCRIBE', chain: 'SOLANA', network: 'DEVNET', address: ADDRESS, lastSyncedBlock: 312345000, platform: 'extension' },
    ]);
  });

  it('re-subscribes in the same shape (FORCE_RESYNC → cursor 0)', () => {
    const { ws } = open();
    webSocketService.resubscribe(0);
    expect(sentOfType(ws, 'SUBSCRIBE').at(-1)).toEqual(
      { type: 'SUBSCRIBE', chain: 'SOLANA', network: 'DEVNET', address: ADDRESS, lastSyncedBlock: 0, platform: 'extension' });
  });

  it('a catch-up keeps the snapshot and leaves the cursor at the newest delivered slot, not the tip', () => {
    const { ws, onSync } = open();
    ws.deliver({
      type: 'CATCH_UP_COMPLETE', chain: 'SOLANA', totalTransactions: 0, addresses: [ADDRESS],
      account: { controlled_amount: '1500000000' },
      solana_lamports: '1500000000', solana_tokens: [], solana_slot: 312345712,
      block: { height: 312345712, slot: 312345712, hash: 'tip', time: 1731456010 },
    });
    expect(onSync).toHaveBeenCalledTimes(1);
    const payload = (onSync.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ type: 'SYNC', solana_lamports: '1500000000', solana_tokens: [], solana_slot: 312345712 });
    expect(cursorOf()).toBe(312345000);
  });

  it('a realtime SYNC advances the cursor to its slot, and the keep-alive carries it', async () => {
    const { ws } = open();
    ws.deliver({
      type: 'SYNC', chain: 'SOLANA', success: true,
      block: { height: 312345700, slot: 312345700, hash: null, time: 1731456000 },
      transactions: [{ tx_hash: 'sig', block_height: 312345700, absolute_slot: 312345700, tx_timestamp: 1731456000, solana_success: true }],
      solana_lamports: '1', solana_slot: 312345712,
    });
    expect(cursorOf()).toBe(312345700);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(sentOfType(ws, 'SYNC_CHECK').at(-1)).toMatchObject({ lastSyncedBlock: 312345700, address: ADDRESS });
  });
});
