/**
 * PRIV-01 P-01: the Midnight shielded viewing key (`mn_shield-esk_…`, the
 * Zswap encryption secret key) must never reach gero-sync. With it the server
 * could read every incoming shielded note of the wallet, permanently. The
 * client never consumed that stream: private balances come from the
 * on-device private sync, which trial-decrypts the public zswap events.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sent: Array<Record<string, unknown>> = [];

class FakeWebSocket {
  static OPEN = 1;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) {
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

vi.mock('@/stores/midnightStore', () => ({
  midnightStore: { lastMidnightTxId: null, chainIdentity: null, utxos: [] },
  midnightActions: { setActive: () => {}, setNetworkStatus: () => {} },
}));
vi.mock('@/stores/loading', () => ({
  default: { setConnecting: () => {}, setConnected: () => {}, setText: () => {}, setProgress: () => {}, setSyncPending: () => {} },
  loadingState: {},
}));
vi.mock('@/utils/debug', () => ({ debugLog: () => {} }));
vi.mock('@/services/crossDevice/proveProtocol', () => ({ PROVE_MESSAGE_TYPES: [] }));

const flush = () => new Promise((r) => setTimeout(r, 5));
const VK = 'mn_shield-esk_test1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';

describe('SUBSCRIBE never carries the shielded viewing key', () => {
  let ws: typeof import('../websocket.service').default;

  beforeEach(async () => {
    sent.length = 0;
    vi.resetModules();
    ws = (await import('../websocket.service')).default;
  });
  afterEach(() => ws.close());

  it('on connect and on resubscribe, even if a stale caller still passes one', async () => {
    // A caller built against the old signature, which took the key positionally.
    const connect = ws.connect.bind(ws) as unknown as (...args: unknown[]) => void;
    connect('MIDNIGHT', 'midnight-mainnet', 'mn_addr1test', 0, {}, [], undefined, 7, VK, 3);
    await flush();
    ws.resubscribe(0);
    await flush();

    const subscribes = sent.filter((f) => f['type'] === 'SUBSCRIBE');
    expect(subscribes.length).toBe(2);
    for (const frame of subscribes) {
      expect(frame).not.toHaveProperty('midnightShieldedViewingKey');
      expect(frame).not.toHaveProperty('midnightShieldedLastIndex');
      expect(JSON.stringify(frame)).not.toContain('mn_shield-esk');
    }
  });
});

describe('the sync bootstrap does not read the viewing key', () => {
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

  it('walletManager starts Midnight sync without any viewing key', () => {
    const src = read('walletManager.service.ts');
    const start = src.indexOf('Open the gero-sync WebSocket bridge for this Midnight wallet.');
    const end = src.indexOf("Skipping gero-sync subscribe: no unshielded address");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, end);
    expect(block).toContain('midnightSyncService.start(walletBg.network, addresses, 0);');
    expect(block).not.toMatch(/getSessionViewingKey|zswapViewingKey|viewingKey/);
  });

  it('midnight-sync start() has no shielded opt-in', () => {
    const src = read('midnight-sync.service.ts');
    expect(src).not.toMatch(/shielded\?\.viewingKey|viewingKey: string/);
  });
});
