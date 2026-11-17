// Issue 1470: the lookup of sends kept through a chain reset, through the real
// sync pipeline. Only an indexer that answers twice in a row that it doesn't
// have the send, with its latest block past the send's time to live, lists it
// as "didn't go through"; anything else is no verdict and is asked again later.
// The retry timer goes with the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ connect: vi.fn(), graphql: vi.fn() }));
vi.mock('@/services/websocket.service', () => ({ default: { connect: h.connect, close: vi.fn(), resubscribe: vi.fn() } }));
vi.mock('@/api/midnight-api', () => ({
  getMidnightApi: () => ({ getLatestBlock: async () => ({ height: 10, hash: 'ab'.repeat(32), time: 1_788_996_846 }), graphql: h.graphql }),
}));
vi.mock('@/chains/midnight/midnightSyncGeneration', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/chains/midnight/midnightSyncGeneration')>(),
  clearMidnightNetworkCheckpoints: async () => undefined,
}));

import service from '@/services/midnight-sync.service';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import { Network } from '@/models/types';
import { notIncludedAfterReset, pendingLookupDeadline } from '@/chains/midnight/midnightPendingSends';

const ME = 'mn_addr_stagenet1test';
const GENESIS = `0x${'cd'.repeat(32)}`;
const identity = (generation: number, genesis = GENESIS) => ({
  midnight_network: 'midnight-stagenet', midnight_chain_generation: generation, midnight_genesis_hash: genesis,
});
const SENT = 'aa'.repeat(32);
const TARGET = 'bb'.repeat(32);
const transfer = (hash: string) => ({
  tx_hash: hash, tx_timestamp: 1_700_000_000_000,
  utxo: { unshielded_created_outputs: [{ owner: ME, value: '40000000', token_type: '0'.repeat(64), intent_hash: `r-${hash.slice(0, 4)}`, output_index: 0 }],
    unshielded_spent_outputs: [] },
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const sync = async (data: Record<string, unknown>) => { await h.connect.mock.lastCall![4].onSync({ type: 'SYNC', ...data }); await flush(); };
let sentAt = 0;
const pending = (shielded = false) => {
  sentAt = Date.now();
  midnightActions.applyTransaction({
    hash: SENT, type: 'send', token: 'NIGHT', amount: 40_000_000n, counterparty: 'mn_addr_stagenet1other',
    timestamp: sentAt, status: 'pending', fee: 0n, isShielded: shielded, ledgerHash: true,
  });
};
const answer = (blockTs: unknown) => ({ transactions: [], block: blockTs === null ? null : { height: 10, timestamp: blockTs } });
const listed = () => notIncludedAfterReset(midnightStore.transactions).map((t) => t.hash);
/** Reset (same genesis), then the target comes back: the rebuild ends and the lookup runs. */
async function resetAndRebuild() {
  await sync({ ...identity(2), midnight_chain_generation_reason: 'network_upgrade' });
  await sync({ ...identity(2), transactions: [transfer(TARGET)] });
  await flush(); await flush();
  expect(midnightStore.refreshing).toBeNull();
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  service.stop();
  midnightActions.resetChainState({ network: 'midnight-stagenet', generation: 1, genesisHash: GENESIS });
  midnightActions.endRefresh();
  midnightStore.transactions = [];
  midnightStore.chainIdentity = null;
  h.connect.mockClear();
  h.graphql.mockReset().mockImplementation(async () => answer(null));
  service.start(Network.STAGENET, { unshielded: ME, shielded: '', dust: '' });
  await flush();
  await sync({ ...identity(1), transactions: [transfer(TARGET)] });
  h.graphql.mockClear();
});
afterEach(() => { service.stop(); vi.useRealTimers(); });

describe('the indexer\'s answer', () => {
  it('no match and a block past the deadline, twice in a row, lists it', async () => {
    h.graphql.mockImplementation(async () => answer(sentAt + 7 * 60_000 + 1));
    pending();
    await resetAndRebuild();
    // The second ask is sent after the first answer: its list is read from an
    // indexer already past the deadline (midnightPendingSends.ts checkPendingTx).
    expect(h.graphql).toHaveBeenCalledTimes(2);
    expect(listed()).toEqual([SENT]);
  });

  it('a second answer that finds the send decides: it went through', async () => {
    h.graphql
      .mockImplementationOnce(async () => answer(sentAt + 7 * 60_000 + 1))
      .mockImplementationOnce(async () => ({ transactions: [{ __typename: 'RegularTransaction', hash: SENT, transactionResult: { status: 'SUCCESS' } }], block: { height: 11, timestamp: sentAt + 8 * 60_000 } }));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
    expect(midnightStore.transactions.find((t) => t.hash === SENT)?.status).toBe('confirmed');
  });

  it('a second answer that fails is no verdict', async () => {
    h.graphql
      .mockImplementationOnce(async () => answer(sentAt + 7 * 60_000 + 1))
      .mockRejectedValueOnce(new Error('Network Error'))
      .mockImplementation(async () => answer(null));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
    expect(midnightStore.transactions.find((t) => t.hash === SENT)?.status).toBe('pending');
  });

  it('a block exactly at the deadline is not past it', async () => {
    h.graphql.mockImplementation(async () => answer(sentAt + 7 * 60_000));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
  });

  it('a block older than the deadline: not listed; retried after the deadline; listed only once a block is past it', async () => {
    h.graphql.mockImplementation(async () => answer(Date.now() - 60 * 60_000)); // an indexer an hour behind
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
    expect(h.graphql).toHaveBeenCalledTimes(1);
    // First retry no earlier than the deadline + 30 s (by this clock).
    await vi.advanceTimersByTimeAsync(pendingLookupDeadline({ timestamp: sentAt, isShielded: false }) - Date.now() + 29_000);
    expect(h.graphql).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.graphql).toHaveBeenCalledTimes(2);
    expect(listed()).toEqual([]); // still behind
    h.graphql.mockImplementation(async () => answer(Date.now()));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(listed()).toEqual([SENT]);
  });

  it('a null block: not listed (no verdict)', async () => {
    h.graphql.mockImplementation(async () => answer(null));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
    expect(midnightStore.transactions.find((t) => t.hash === SENT)?.status).toBe('pending');
  });

  it('a block with a non-numeric timestamp (string) is no verdict', async () => {
    h.graphql.mockImplementation(async () => answer(String(Date.now() + 60 * 60_000)));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
  });

  it('a block time in seconds past the deadline is read as such', async () => {
    h.graphql.mockImplementation(async () => answer(Math.floor((sentAt + 8 * 60_000) / 1000)));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([SENT]);
  });

  it('shielded: past the unshielded deadline but not the shielded one is no verdict', async () => {
    h.graphql.mockImplementation(async () => answer(sentAt + 20 * 60_000));
    pending(true);
    await resetAndRebuild();
    expect(h.graphql).toHaveBeenCalledTimes(1);
    expect(listed()).toEqual([]);
    h.graphql.mockImplementation(async () => answer(sentAt + 32 * 60_000 + 1));
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(listed()).toEqual([SENT]);
  });

  it('an answer with GraphQL errors (thrown by api.graphql) is unknown', async () => {
    h.graphql.mockRejectedValue(new Error('GraphQL errors: [{"message":"Unknown field block"}]'));
    pending();
    await resetAndRebuild();
    expect(listed()).toEqual([]);
  });
});

describe('the retry timer', () => {
  it('stop() while a retry is armed: no lookup afterwards', async () => {
    h.graphql.mockRejectedValue(new Error('down'));
    pending();
    await resetAndRebuild();
    expect(h.graphql).toHaveBeenCalledTimes(1);
    service.stop();
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(h.graphql).toHaveBeenCalledTimes(1);
  });

  it('stop() while a lookup is in flight: no retry armed when it settles', async () => {
    let release!: (v: unknown) => void;
    h.graphql.mockImplementation(() => new Promise((r) => { release = r; }));
    pending();
    await sync({ ...identity(2), midnight_chain_generation_reason: 'network_upgrade' });
    await sync({ ...identity(2), transactions: [transfer(TARGET)] });
    expect(h.graphql).toHaveBeenCalledTimes(1);
    service.stop();
    release(answer(Date.now() + 60 * 60_000)); // would have been notFound
    await flush(); await flush();
    expect(listed()).toEqual([]); // a stopped session settles nothing
    h.graphql.mockRejectedValue(new Error('down'));
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    expect(h.graphql).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a new session mid-backoff (stop + start): one lookup at start, the old timer never fires, backoff restarts', async () => {
    h.graphql.mockRejectedValue(new Error('down'));
    pending();
    await resetAndRebuild();
    await vi.advanceTimersByTimeAsync(30_000 + 60_000 + 1_000); // two retries in
    expect(h.graphql).toHaveBeenCalledTimes(3);
    service.stop();
    service.start(Network.STAGENET, { unshielded: ME, shielded: '', dust: '' });
    await flush(); await flush(); await flush();
    expect(h.graphql).toHaveBeenCalledTimes(4); // start looks it up once
    await vi.advanceTimersByTimeAsync(29_000);
    expect(h.graphql).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.graphql).toHaveBeenCalledTimes(5); // 30 s: the backoff restarted
  });

  it('start() again without stop() mid-backoff: no duplicate timers', async () => {
    h.graphql.mockRejectedValue(new Error('down'));
    pending();
    await resetAndRebuild();
    service.start(Network.STAGENET, { unshielded: ME, shielded: '', dust: '' });
    await flush(); await flush(); await flush();
    const after = h.graphql.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3 * 60 * 60_000);
    // the first lookup + start's lookup + 6 retries at most
    expect(h.graphql.mock.calls.length - after).toBeLessThanOrEqual(6);
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
