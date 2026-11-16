import { afterEach, describe, expect, it } from 'vitest';
import { loadDustSpendCheckpoint, saveDustSpendCheckpoint } from './midnightDustSpendCheckpoint';
import { setMidnightWalletStateStore, type StoredWalletState } from './midnightWalletStatePersistence';
import type { DustSpendCheckpoint } from './midnightDustLightSync';

function memoryStore() {
  const rows = new Map<string, StoredWalletState>();
  setMidnightWalletStateStore({
    get: async key => rows.get(key),
    put: async row => { rows.set(row.key, row); },
    delete: async key => { rows.delete(key); },
    deleteByPrefixes: async prefixes => { [...rows.keys()].filter(k => prefixes.some(p => k.startsWith(p))).forEach(k => rows.delete(k)); },
  });
  return rows;
}

const identity = { network: 'midnight-mainnet', chain_generation: 2, genesis_hash: `0x${'ab'.repeat(32)}` };
const seed = new Uint8Array(32).fill(7);
const checkpoint: DustSpendCheckpoint = { checkedThrough: 3_474_000, heads: { '5:aa': {
  initialValue: '1', owner: '2', nonce: '3', seq: 4, ctime: 1_794_000_000_000, backingNight: 'aa'.repeat(32), mtIndex: '6',
} } };

describe('DUST spend checkpoint store', () => {
  afterEach(() => setMidnightWalletStateStore(null));

  it('reads back what it saved, for the same seed, network and chain', async () => {
    memoryStore();
    await saveDustSpendCheckpoint('mainnet', seed, identity, checkpoint);
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toEqual(checkpoint);
    expect(await loadDustSpendCheckpoint('preprod', seed, identity)).toBeNull();
    expect(await loadDustSpendCheckpoint('mainnet', new Uint8Array(32).fill(8), identity)).toBeNull();
  });

  it('ignores a checkpoint from another chain generation or genesis', async () => {
    memoryStore();
    await saveDustSpendCheckpoint('mainnet', seed, identity, checkpoint);
    expect(await loadDustSpendCheckpoint('mainnet', seed, { ...identity, chain_generation: 3 })).toBeNull();
    expect(await loadDustSpendCheckpoint('mainnet', seed, { ...identity, genesis_hash: `0x${'cd'.repeat(32)}` })).toBeNull();
  });

  it('keys rows by a hash of the seed, never the seed itself, and stores no seed bytes', async () => {
    const rows = memoryStore();
    await saveDustSpendCheckpoint('mainnet', seed, identity, checkpoint);
    const [row] = [...rows.values()];
    expect(row.key.startsWith('midnight_wallet_state_mainnet_dust-light9_')).toBe(true);
    expect(row.key).not.toContain('07'.repeat(8));
    expect(row.serializedState).not.toContain('07'.repeat(8));
  });

  it('treats an unreadable row as no checkpoint', async () => {
    const rows = memoryStore();
    await saveDustSpendCheckpoint('mainnet', seed, identity, checkpoint);
    const [key] = rows.keys();
    rows.set(key, { ...rows.get(key)!, serializedState: '{not json' });
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toBeNull();
  });
});
