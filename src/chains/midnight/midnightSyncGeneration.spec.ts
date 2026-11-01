import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { MidnightGenerationQueue, parseMidnightSyncIdentity, clearMidnightNetworkCheckpoints } from './midnightSyncGeneration';
import { midnightWalletStatesForTest, resetMidnightWalletStateDbForTest } from './midnightWalletStatePersistence';

const network = 'midnight-stagenet';
const stamp = (generation = 1) => ({ midnight_network: network, midnight_chain_generation: generation,
  midnight_genesis_hash: `0x${(generation === 1 ? 'ab' : 'cd').repeat(32)}` });

describe('Midnight generation replay', () => {
  it('rejects malformed and foreign metadata without resetting state', async () => {
    const queue = new MidnightGenerationQueue();
    const reset = vi.fn(); const apply = vi.fn();
    for (const data of [{}, { ...stamp(), midnight_network: 'midnight-mainnet' },
      { ...stamp(), midnight_chain_generation: 0 }, { ...stamp(), midnight_genesis_hash: false }]) {
      await queue.enqueue(data, network, () => null, () => true, reset, apply);
    }
    expect(reset).not.toHaveBeenCalled(); expect(apply).not.toHaveBeenCalled();
  });

  it('awaits a competing reset before replay and drops late old-generation data', async () => {
    const queue = new MidnightGenerationQueue();
    let current = parseMidnightSyncIdentity(stamp(), network);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const effects: string[] = [];
    const reset = vi.fn(async (identity) => { effects.push('reset'); await gate; current = identity; });
    const first = queue.enqueue(stamp(2), network, () => current, () => true, reset,
      async () => { effects.push('first'); });
    const second = queue.enqueue(stamp(2), network, () => current, () => true, reset,
      async () => { effects.push('second'); });
    await Promise.resolve();
    expect(effects).toEqual(['reset']);
    release(); await Promise.all([first, second]);
    await queue.enqueue(stamp(1), network, () => current, () => true, reset,
      async () => { effects.push('stale'); });
    expect(effects).toEqual(['reset', 'first', 'second']);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does not replay after wallet switch during reset or failed checkpoint cleanup', async () => {
    const queue = new MidnightGenerationQueue(); let active = true;
    const apply = vi.fn();
    await queue.enqueue(stamp(), network, () => null, () => active, async () => { active = false; }, apply);
    expect(apply).not.toHaveBeenCalled();
    await expect(queue.enqueue(stamp(), network, () => null, () => true,
      async () => { throw new Error('storage failed'); }, apply)).rejects.toThrow('storage failed');
    expect(apply).not.toHaveBeenCalled();
  });

  it('clears only the selected Midnight network and never other networks', async () => {
    resetMidnightWalletStateDbForTest();
    const row = (key: string) => ({ key, schemaVersion: 1, network: 'x', kind: 'dust' as const, serializedState: 's', savedAt: 0 });
    const table = midnightWalletStatesForTest();
    await table.clear();
    await table.bulkPut([
      row('midnight_wallet_state_stagenet_dust_x'),
      row('midnight_wallet_state_midnight-stagenet-ledger9-rc3_old'),
      row('midnight_wallet_state_preprod_dust_x'),
      row('midnight_wallet_state_mainnet_shielded_y'),
    ]);
    await clearMidnightNetworkCheckpoints(network);
    expect((await table.toArray()).map((r) => r.key).sort()).toEqual([
      'midnight_wallet_state_mainnet_shielded_y',
      'midnight_wallet_state_preprod_dust_x',
    ]);
  });
});
