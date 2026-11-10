// Issue 1470 through the real sync pipeline: a pending send survives a chain
// reset; only once the rebuild has ended does the background look it up, and
// only a send the lookup doesn't find goes to the "didn't go through" card.
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
import { notIncludedAfterReset } from '@/chains/midnight/midnightPendingSends';
import { REFRESH_QUIET_MS } from '@/chains/midnight/midnightRefresh';

const ME = 'mn_addr_stagenet1test';
const GENESIS = `0x${'cd'.repeat(32)}`;
const identity = (generation: number, genesis = GENESIS) => ({
  midnight_network: 'midnight-stagenet', midnight_chain_generation: generation, midnight_genesis_hash: genesis,
});
const SENT = 'aa'.repeat(32);
const transfer = (hash: string, mine: 'in' | 'out', value = '40000000') => ({
  tx_hash: hash, tx_timestamp: 1_700_000_000_000,
  utxo: mine === 'out'
    ? { unshielded_created_outputs: [{ owner: 'mn_addr_stagenet1other', value, token_type: '0'.repeat(64), intent_hash: 'i', output_index: 0 }],
      unshielded_spent_outputs: [{ owner: ME, value, token_type: '0'.repeat(64), intent_hash: 'p', output_index: 0 }] }
    : { unshielded_created_outputs: [{ owner: ME, value, token_type: '0'.repeat(64), intent_hash: `r-${hash.slice(0, 4)}`, output_index: 0 }],
      unshielded_spent_outputs: [] },
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const sync = async (data: Record<string, unknown>) => { await h.connect.mock.lastCall![4].onSync({ type: 'SYNC', ...data }); await flush(); };
const pending = (ledgerHash: boolean) => midnightActions.applyTransaction({
  hash: SENT, type: 'send', token: 'NIGHT', amount: 40_000_000n, counterparty: 'mn_addr_stagenet1other',
  timestamp: Date.now(), status: 'pending', fee: 0n, isShielded: false, ...(ledgerHash ? { ledgerHash: true } : {}),
});

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  service.stop();
  midnightActions.resetChainState({ network: 'midnight-stagenet', generation: 1, genesisHash: GENESIS });
  midnightActions.endRefresh();
  midnightStore.transactions = [];
  midnightStore.chainIdentity = null;
  h.connect.mockClear();
  h.graphql.mockReset().mockResolvedValue({ transactions: [] });
  service.start(Network.STAGENET, { unshielded: ME, shielded: '', dust: '' });
  await flush();
  await sync({ ...identity(1), transactions: [transfer('bb'.repeat(32), 'in')] });
});
afterEach(() => { service.stop(); vi.useRealTimers(); });

describe('a pending send across a chain reset', () => {
  it('survives the reset, marked with the upgrade as its cause, and reads "Not confirmed"', async () => {
    pending(true);
    await sync({ ...identity(2), midnight_chain_generation_reason: 'network_upgrade' });
    const kept = midnightStore.transactions.find((t) => t.hash === SENT);
    expect(kept).toMatchObject({ status: 'pending', ledgerHash: true, beforeReset: { upgrade: true } });
    expect(notIncludedAfterReset(midnightStore.transactions)).toEqual([]);
  });

  it('confirmed by the rebuilt history: shown once, as confirmed, never looked up, never in the card', async () => {
    pending(true);
    await sync(identity(2));
    await sync({ ...identity(2), transactions: [transfer(SENT, 'out')] });
    expect(midnightStore.transactions.filter((t) => t.hash === SENT).map((t) => t.status)).toEqual(['confirmed']);
    await vi.advanceTimersByTimeAsync(REFRESH_QUIET_MS * 30);
    expect(notIncludedAfterReset(midnightStore.transactions)).toEqual([]);
  });

  it('no lookup while the rebuild runs; once it ends, a send the indexer cannot find goes to the card', async () => {
    pending(true);
    await sync(identity(2, `0x${'ef'.repeat(32)}`)); // a new chain: done after the quiet time
    expect(midnightStore.refreshing).not.toBeNull();
    expect(h.graphql).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(REFRESH_QUIET_MS + 5_000);
    expect(midnightStore.refreshing).toBeNull();
    expect(h.graphql).toHaveBeenCalledWith(expect.stringContaining('offset: {hash: $hash}'), { hash: SENT });
    expect(notIncludedAfterReset(midnightStore.transactions).map((t) => t.hash)).toEqual([SENT]);
  });

  it('a send the lookup finds is settled, not listed', async () => {
    h.graphql.mockResolvedValue({ transactions: [{ __typename: 'RegularTransaction', hash: SENT, transactionResult: { status: 'SUCCESS' } }] });
    pending(true);
    await sync(identity(2, `0x${'ef'.repeat(32)}`));
    await vi.advanceTimersByTimeAsync(REFRESH_QUIET_MS + 5_000);
    expect(midnightStore.transactions.find((t) => t.hash === SENT)?.status).toBe('confirmed');
    expect(notIncludedAfterReset(midnightStore.transactions)).toEqual([]);
  });

  it('a send keyed by the extrinsic hash is never looked up and never claimed as not included', async () => {
    pending(false);
    await sync(identity(2, `0x${'ef'.repeat(32)}`));
    await vi.advanceTimersByTimeAsync(REFRESH_QUIET_MS + 5_000);
    expect(h.graphql).not.toHaveBeenCalled();
    expect(midnightStore.transactions.find((t) => t.hash === SENT)?.status).toBe('pending');
    expect(notIncludedAfterReset(midnightStore.transactions)).toEqual([]);
  });

  it('a forced resync keeps it too', () => {
    pending(true);
    service.forceResync();
    expect(midnightStore.transactions.map((t) => t.hash)).toEqual([SENT]);
  });
});
