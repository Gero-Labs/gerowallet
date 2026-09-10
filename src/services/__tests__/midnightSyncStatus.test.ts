import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ connect: vi.fn(), latest: vi.fn() }));
vi.mock('@/services/websocket.service', () => ({ default: { connect: h.connect, close: vi.fn() } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getLatestBlock: h.latest }) }));
import service from '@/services/midnight-sync.service';
import { midnightStore, midnightActions } from '@/stores/midnightStore';
import { Network } from '@/models/types';

const block = { height: 392767, hash: 'ab'.repeat(32), time: 1788996846001 };
const identity = { midnight_network: 'midnight-stagenet', midnight_chain_generation: 1,
  midnight_genesis_hash: '0x' + 'cd'.repeat(32) };
const addresses = { unshielded: 'mn_addr_stagenet1test', shielded: '', dust: '' };
const flush = () => vi.advanceTimersByTimeAsync(0);
const start = () => service.start(Network.STAGENET, addresses);
const sync = (data: Record<string, unknown> = {}) => h.connect.mock.lastCall![4].onSync({ type: 'SYNC', ...identity, ...data });
function deferred() {
  let resolve!: (value: typeof block) => void;
  const promise = new Promise<typeof block>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-10T00:00:00Z'));
  service.stop();
  midnightActions.resetChainState({ network: 'midnight-stagenet', generation: 1, genesisHash: identity.midnight_genesis_hash });
  midnightStore.chainIdentity = null;
  h.connect.mockClear();
  h.latest.mockReset().mockResolvedValue(block);
});
afterEach(() => { service.stop(); vi.useRealTimers(); });

describe('Midnight network status recovery', () => {
  it('restores the tip when the first identity message clears a successful bootstrap', async () => {
    start(); await flush();
    expect(midnightStore.tip.height).toBe(block.height);
    await sync(); await flush();
    expect(h.latest).toHaveBeenCalledTimes(2);
    expect(midnightStore.tip.height).toBe(block.height);
    expect(midnightStore.lastSync).toBe(Date.now());
  });

  it('retries a failed Nexus request without another wallet event', async () => {
    h.latest.mockRejectedValueOnce(new Error('temporary outage'));
    start(); await flush();
    expect(midnightStore.tip.hash).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(midnightStore.tip.height).toBe(block.height);
    expect(midnightStore.lastSync).toBeNull();
  });

  it('does not call a successful chain-tip lookup a successful wallet sync', async () => {
    start(); await flush();
    expect(midnightStore.lastSync).toBeNull();
    expect(midnightStore.networkStatus).toBe('connecting');
  });

  it('records the receipt time of a validated sync even without a block', async () => {
    start(); await flush(); await sync(); await flush();
    await vi.advanceTimersByTimeAsync(1000);
    await sync();
    expect(midnightStore.lastSync).toBe(Date.now());
    expect(midnightStore.lastSync).not.toBe(block.time);
  });

  it('refuses to mark an unvalidated or stale-generation message as synced', async () => {
    start(); await flush();
    await sync({ midnight_chain_generation: undefined });
    expect(midnightStore.lastSync).toBeNull();
    await sync({ midnight_chain_generation: 2 });
    const lastSync = midnightStore.lastSync;
    await vi.advanceTimersByTimeAsync(1000);
    await sync();
    expect(midnightStore.lastSync).toBe(lastSync);
  });

  it('discards a request spanning a generation reset, then recovers', async () => {
    const old = deferred(); h.latest.mockReturnValueOnce(old.promise);
    start(); await flush(); await sync();
    old.resolve(block); await flush();
    expect(midnightStore.tip.hash).toBeNull();
    h.latest.mockResolvedValue({ ...block, height: 0 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(midnightStore.tip.height).toBe(0);
    expect(midnightStore.tip.hash).toBe(block.hash);
  });

  it('does not let a slow Nexus response overwrite a newer WS tip', async () => {
    start(); await flush(); await sync(); await flush();
    const old = deferred(); h.latest.mockReturnValueOnce(old.promise);
    await vi.advanceTimersByTimeAsync(30_000);
    await sync({ block: { ...block, height: block.height + 1 } });
    old.resolve(block); await flush();
    expect(midnightStore.tip.height).toBe(block.height + 1);
  });

  it('ignores height-only catch-up cursors instead of erasing a known block', async () => {
    start(); await flush(); await sync(); await flush();
    await sync({ block: { height: 0 } });
    expect(midnightStore.tip.height).toBe(block.height);
    expect(midnightStore.tip.timestamp).toBe(block.time);
  });

  it('keeps the last known block when a later Nexus refresh fails', async () => {
    start(); await flush();
    h.latest.mockRejectedValue(new Error('offline'));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(midnightStore.tip.height).toBe(block.height);
  });

  it('does not overlap requests when Nexus is slow', async () => {
    const pending = deferred(); h.latest.mockReturnValue(pending.promise);
    start(); await flush(); await vi.advanceTimersByTimeAsync(90_000);
    expect(h.latest).toHaveBeenCalledTimes(1);
    pending.resolve(block); await flush();
  });

  it('stops polling and discards pending results on logout', async () => {
    const pending = deferred(); h.latest.mockReturnValueOnce(pending.promise);
    start(); await flush(); service.stop();
    const tip = { ...midnightStore.tip };
    pending.resolve(block); await vi.advanceTimersByTimeAsync(90_000);
    expect(h.latest).toHaveBeenCalledTimes(1);
    expect(midnightStore.tip).toEqual(tip);
  });

  it('discards responses and callbacks from the previous wallet session', async () => {
    const old = deferred(); h.latest.mockReturnValueOnce(old.promise);
    start(); await flush();
    const oldSync = h.connect.mock.lastCall![4].onSync;
    service.start(Network.PREPROD, { ...addresses, unshielded: 'mn_addr_preprod1test' });
    h.latest.mockResolvedValue({ ...block, height: 15 });
    await flush(); old.resolve(block); await flush();
    await oldSync({ type: 'SYNC', ...identity, block });
    expect(midnightStore.tip.height).toBe(15);
    expect(midnightStore.lastSync).toBeNull();
  });

  it.each([-1, 1.5, NaN, Infinity])('rejects invalid block height %s', async height => {
    h.latest.mockResolvedValue({ ...block, height });
    start(); await flush();
    expect(midnightStore.tip.hash).toBeNull();
  });
});
