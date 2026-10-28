/**
 * The Cardano SUBSCRIBE carries `programmableAddresses`: the CIP-113 addresses owned by the
 * wallet's payment keys, which sit under other reward addresses than the stake-address
 * anchor and which gero-sync therefore only returns when named. The field must stay off
 * every other payload, and connect() takes it in the positional slot that once carried the
 * Midnight shielded viewing key, so a stale caller must never get a key onto the wire.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const PLB_A = 'addr_test1zzl9nam4pfweg7akf8ns646dqenermp55807u2sg0jz3rcluv4246g24wfxyh5h92y3ygwz0qxk3cuy0pnmqy68gus9q08s664';
const PLB_B = 'addr_test1zzl9nam4pfweg7akf8ns646dqenermp55807u2sg0jz3rcevhsjvks3yz0qvrlaml9uh50xj4d7k4pv2nqv6jlvt6zhq77vjar';
const STAKE = 'stake_test1uqktcfxtggjp8sxpl7alj7t68nf2klt2sk9fsxdf0k9aptstuezkc';

describe('SUBSCRIBE programmableAddresses', () => {
  let ws: typeof import('../websocket.service').default;
  const subscribes = () => sent.filter((f) => f['type'] === 'SUBSCRIBE');

  beforeEach(async () => {
    sent.length = 0;
    vi.resetModules();
    ws = (await import('../websocket.service')).default;
  });
  afterEach(() => ws.close());

  it('sends them on connect and keeps them on a plain resubscribe', async () => {
    ws.connect('CARDANO', 'Preprod', STAKE, 0, {}, [], undefined, undefined, [PLB_A]);
    await flush();
    ws.resubscribe(0);
    await flush();

    expect(subscribes().map((f) => f['programmableAddresses'])).toEqual([[PLB_A], [PLB_A]]);
    expect(subscribes()[0]['credentials']).toEqual([]);
  });

  it('replaces the set when a resubscribe passes a new one', async () => {
    ws.connect('CARDANO', 'Preprod', STAKE, 0, {}, [], undefined, undefined, [PLB_A]);
    await flush();
    ws.resubscribe(0, [], [PLB_A, PLB_B]);
    await flush();

    expect(subscribes()[1]['programmableAddresses']).toEqual([PLB_A, PLB_B]);
  });

  it('leaves the field off the payload when there are none', async () => {
    ws.connect('CARDANO', 'Preprod', STAKE, 0, {}, ['ab'.repeat(28)]);
    await flush();
    ws.resubscribe(0, undefined, []);
    await flush();

    expect(subscribes()).toHaveLength(2);
    for (const frame of subscribes()) expect(frame).not.toHaveProperty('programmableAddresses');
  });

  it('never sends them, or a stale viewing key, on a Midnight subscription', async () => {
    const connect = ws.connect.bind(ws) as unknown as (...args: unknown[]) => void;
    connect('MIDNIGHT', 'midnight-mainnet', 'mn_addr1test', 0, {}, [], undefined, 7, 'mn_shield-esk_test1qqqq');
    await flush();
    ws.resubscribe(0, undefined, [PLB_A]);
    await flush();

    expect(subscribes()).toHaveLength(2);
    for (const frame of subscribes()) {
      expect(frame).not.toHaveProperty('programmableAddresses');
      expect(JSON.stringify(frame)).not.toContain('mn_shield-esk');
    }
  });

  it('forgets them when the socket is torn down', async () => {
    ws.connect('CARDANO', 'Preprod', STAKE, 0, {}, [], undefined, undefined, [PLB_A]);
    await flush();
    ws.close();
    sent.length = 0;
    ws.connect('CARDANO', 'Preprod', STAKE, 0, {}, []);
    await flush();

    expect(subscribes()[0]).not.toHaveProperty('programmableAddresses');
  });
});
