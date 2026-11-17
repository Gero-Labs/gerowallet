// Issue 1471: the sync service starts "Refreshing" at a chain reset, keeps it
// through a partial replay, flags a stall, and ends it once the rebuild is done.
// Drives the real handleSync -> generation queue -> store path; only the socket
// and the Nexus tip read are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ connect: vi.fn(), resubscribe: vi.fn() }));
vi.mock('@/services/websocket.service', () => ({ default: { connect: h.connect, close: vi.fn(), resubscribe: h.resubscribe } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getLatestBlock: async () => ({ height: 10, hash: 'ab'.repeat(32), time: 1_788_996_846 }) }) }));
vi.mock('@/chains/midnight/midnightSyncGeneration', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/chains/midnight/midnightSyncGeneration')>(),
  clearMidnightNetworkCheckpoints: async () => undefined,
}));

import service from '@/services/midnight-sync.service';
import { midnightActions, midnightStore } from '@/stores/midnightStore';
import { Network } from '@/models/types';
import { REFRESH_QUIET_MS, REFRESH_STALL_MS, REFRESH_TARGET_WAIT_MS } from '@/chains/midnight/midnightRefresh';

const ME = 'mn_addr_stagenet1test';
const GENESIS = `0x${'cd'.repeat(32)}`;
const identity = (generation: number, genesis = GENESIS) => ({
  midnight_network: 'midnight-stagenet', midnight_chain_generation: generation, midnight_genesis_hash: genesis,
});
const receive = (hash: string, value: string, index: number, at: number) => ({
  tx_hash: hash, tx_timestamp: at,
  utxo: {
    unshielded_created_outputs: [{ owner: ME, value, token_type: '0'.repeat(64), intent_hash: `intent-${hash.slice(0, 4)}`, output_index: index }],
    unshielded_spent_outputs: [],
  },
});
const OLD = 'aa'.repeat(32);
const flush = () => vi.advanceTimersByTimeAsync(0);
const sync = async (data: Record<string, unknown>) => {
  await h.connect.mock.lastCall![4].onSync({ type: 'SYNC', ...data });
  await flush();
};

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  service.stop();
  midnightActions.resetChainState({ network: 'midnight-stagenet', generation: 1, genesisHash: GENESIS });
  midnightActions.endRefresh();
  midnightStore.chainIdentity = null;
  h.connect.mockClear();
  service.start(Network.STAGENET, { unshielded: ME, shielded: '', dust: '' });
  await flush();
  // Generation 1: a funded wallet with history.
  await sync({ ...identity(1), transactions: [receive(OLD, '5000000', 0, 1_700_000_000_000)] });
  expect(midnightStore.balances.nightUnshielded).toBe(5_000_000n);
});
afterEach(() => { service.stop(); vi.useRealTimers(); });

describe('a chain reset on a funded wallet', () => {
  it('refreshes over the old values until the newest old transaction is back, then ends', async () => {
    await sync({ ...identity(2), midnight_chain_generation_reason: 'network_upgrade' });
    expect(midnightStore.refreshing).toMatchObject({ reason: 'upgrade', stalled: false });
    expect(midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(5_000_000n);

    // An older transaction comes back first: still refreshing.
    await sync({ ...identity(2), transactions: [receive('bb'.repeat(32), '1000000', 1, 1_699_000_000_000)] });
    expect(midnightStore.refreshing).not.toBeNull();

    // The newest one from before the reset is back: done, in one step.
    await sync({ ...identity(2), transactions: [receive(OLD, '5000000', 0, 1_700_000_000_000)] });
    expect(midnightStore.refreshing).toBeNull();
    expect(midnightStore.refreshSnapshot).toBeNull();
    expect(midnightStore.balances.nightUnshielded).toBe(6_000_000n);
  });

  it('says it is stalled when nothing arrives, keeps the old values, and recovers on the next frame', async () => {
    await sync(identity(2));
    await vi.advanceTimersByTimeAsync(REFRESH_STALL_MS + 5_000);
    expect(midnightStore.refreshing?.stalled).toBe(true);
    expect(midnightStore.refreshSnapshot?.balances.nightUnshielded).toBe(5_000_000n);
    await sync(identity(2));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(midnightStore.refreshing?.stalled).toBe(false);
  });

  it('keep-alives hold it open through a slow replay, until the wait for the old transaction runs out', async () => {
    await sync(identity(2));
    for (let t = 0; t < REFRESH_TARGET_WAIT_MS - 30_000; t += 25_000) {
      await vi.advanceTimersByTimeAsync(25_000);
      await sync(identity(2));
    }
    expect(midnightStore.refreshing).not.toBeNull();
    for (let t = 0; t < 60_000; t += 25_000) {
      await vi.advanceTimersByTimeAsync(25_000);
      await sync(identity(2));
    }
    expect(midnightStore.refreshing).toBeNull();
  });

  it('a new chain (another genesis) ends once transactions stop arriving', async () => {
    await sync(identity(2, `0x${'ef'.repeat(32)}`));
    expect(midnightStore.refreshing).not.toBeNull();
    await vi.advanceTimersByTimeAsync(REFRESH_QUIET_MS + 5_000);
    expect(midnightStore.refreshing).toBeNull();
  });

  it('a forced resync refreshes over the old values too', async () => {
    service.forceResync();
    await flush();
    expect(midnightStore.refreshSnapshot?.transactions.map((t) => t.hash)).toEqual([OLD]);
    expect(midnightStore.transactions).toEqual([]);
    await sync({ ...identity(1), transactions: [receive(OLD, '5000000', 0, 1_700_000_000_000)] });
    expect(midnightStore.refreshing).toBeNull();
  });

  it('stopping the wallet clears the check timer', async () => {
    await sync(identity(2));
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
