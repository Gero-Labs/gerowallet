import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ connect: vi.fn(), latest: vi.fn() }));
vi.mock('@/services/websocket.service', () => ({ default: { connect: h.connect, close: vi.fn() } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({ getLatestBlock: h.latest }) }));
import service from '@/services/midnight-sync.service';
import { midnightStore, midnightActions } from '@/stores/midnightStore';
import { Network } from '@/models/types';
import { isMidnightDataPaused } from '@/chains/midnight/midnightDataFreshness';

const block = { height: 392767, hash: 'ab'.repeat(32), time: 1788996846001 };
const identity = { midnight_network: 'midnight-preview', midnight_chain_generation: 1,
  midnight_genesis_hash: '0x' + 'cd'.repeat(32) };
const addresses = { unshielded: 'mn_addr_preview1test', shielded: '', dust: '' };
const flush = () => vi.advanceTimersByTimeAsync(0);
const start = () => service.start(Network.PREVIEW, addresses);
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
  midnightActions.resetChainState({ network: 'midnight-preview', generation: 1, genesisHash: identity.midnight_genesis_hash });
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

  it('stores a seconds-shaped block time from the latest-block route as milliseconds, stamped as seen now', async () => {
    // `/api/blocks/latest` `time` is epoch seconds.
    const seconds = Math.floor(Date.now() / 1000) - 6;
    h.latest.mockResolvedValue({ ...block, time: seconds });
    start(); await flush();
    expect(midnightStore.tip.timestamp).toBe(seconds * 1000);
    expect(midnightStore.tip.observedAt).toBe(Date.now());
  });

  it('keeps a milliseconds-shaped block time from a sync frame as milliseconds', async () => {
    start(); await flush(); await sync(); await flush();
    const ms = Date.now() - 6_000;
    await sync({ block: { ...block, height: block.height + 2, time: ms } }); await flush();
    expect(midnightStore.tip.height).toBe(block.height + 2);
    expect(midnightStore.tip.timestamp).toBe(ms);
    expect(midnightStore.tip.observedAt).toBe(Date.now());
  });

  describe('a transaction frame names its own block, not the tip', () => {
    const twoDaysAgo = () => Date.now() - 2 * 24 * 3600_000;
    const replayed = (height: number, time = twoDaysAgo()) => sync({
      block: { hash: 'ee'.repeat(32), height, time },
      transactions: [{ tx_hash: 'ff'.repeat(32), midnight_tx_id: 7 }],
    });
    const paused = () => isMidnightDataPaused(midnightStore.tip, Date.now());

    const fresh = () => ({ ...block, time: Math.floor(Date.now() / 1000) - 6 });

    it('a replayed old transaction never moves the tip back or reads as paused', async () => {
      h.latest.mockResolvedValue(fresh());
      start(); await flush(); await sync(); await flush();
      expect(midnightStore.tip.observedAt).toBe(Date.now());
      const tip = { ...midnightStore.tip };
      await replayed(block.height - 40_000); await flush();
      expect(midnightStore.tip).toEqual(tip);
      expect(isMidnightDataPaused(midnightStore.tip, Date.now())).toBe(false);
    });

    it('with no tip known yet, its block is shown unstamped: unknown age, never paused', async () => {
      start(); await flush();
      // The identity frame clears the tip and asks Nexus again; that read is out while the replay lands.
      const pending = deferred(); h.latest.mockReturnValue(pending.promise);
      await sync(); await flush();
      expect(midnightStore.tip.hash).toBeNull();
      await replayed(block.height - 40_000); await flush();
      expect(midnightStore.tip.height).toBe(block.height - 40_000);
      expect(midnightStore.tip.observedAt).toBeUndefined();
      expect(isMidnightDataPaused(midnightStore.tip, Date.now())).toBe(false);
      pending.resolve(fresh()); await flush();
      expect(midnightStore.tip.height).toBe(block.height);
      expect(midnightStore.tip.observedAt).toBe(Date.now());
    });

    it('a keep-alive carrying a days-old block still reads as paused (the chain really stopped)', async () => {
      start(); await flush(); await sync(); await flush();
      await sync({ block: { ...block, height: block.height + 1, time: twoDaysAgo() } }); await flush();
      expect(paused()).toBe(true);
    });

    it('a stopped chain still reads as paused when the replay lands before the first tip read', async () => {
      start(); await flush();
      const pending = deferred(); h.latest.mockReturnValue(pending.promise);
      await sync(); await flush();
      await replayed(block.height); await flush();
      expect(paused()).toBe(false);
      // Nexus confirms the same height, and that block is two days old: the chain stopped there.
      pending.resolve({ ...block, time: Math.floor(twoDaysAgo() / 1000) }); await flush();
      expect(midnightStore.tip.observedAt).toBe(Date.now());
      expect(paused()).toBe(true);
    });

    it('a live transaction above the tip moves it forward unstamped; the next keep-alive stamps it', async () => {
      h.latest.mockResolvedValue(fresh());
      start(); await flush(); await sync(); await flush();
      const liveTime = Date.now() - 6_000;
      await replayed(block.height + 1, liveTime); await flush();
      expect(midnightStore.tip.height).toBe(block.height + 1);
      expect(midnightStore.tip.observedAt).toBeUndefined();
      await sync({ block: { hash: 'ee'.repeat(32), height: block.height + 1, time: liveTime } }); await flush();
      expect(midnightStore.tip.observedAt).toBe(Date.now());
      expect(paused()).toBe(false);
    });

    it('a transaction at the tip height leaves the stamped tip as it is', async () => {
      h.latest.mockResolvedValue(fresh());
      start(); await flush(); await sync(); await flush();
      const tip = { ...midnightStore.tip };
      await replayed(block.height); await flush();
      expect(midnightStore.tip).toEqual(tip);
    });
  });

  it('a keep-alive below the known tip is ignored (gero-sync replaying blocks it missed)', async () => {
    h.latest.mockResolvedValue({ ...block, time: Math.floor(Date.now() / 1000) - 6 });
    start(); await flush(); await sync(); await flush();
    const tip = { ...midnightStore.tip };
    await sync({ block: { hash: 'ee'.repeat(32), height: block.height - 200, time: Date.now() - 20 * 60_000 } }); await flush();
    expect(midnightStore.tip).toEqual(tip);
    expect(isMidnightDataPaused(midnightStore.tip, Date.now())).toBe(false);
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
