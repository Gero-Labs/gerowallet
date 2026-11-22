import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDustSpendCheckpoints, dustSpendCheckpointWriter, loadDustSpendCheckpoint, saveDustSpendCheckpoint } from './midnightDustSpendCheckpoint';
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

  it('keys the row before its first await, so wiping the seed right after the call changes nothing', async () => {
    memoryStore();
    const wiped = seed.slice();
    const saving = saveDustSpendCheckpoint('mainnet', wiped, identity, checkpoint);
    wiped.fill(0);
    await saving;
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toEqual(checkpoint);
  });

  it('clears the checkpoint of every wallet on one network, and nothing else', async () => {
    const rows = memoryStore();
    const other = new Uint8Array(32).fill(9);
    await saveDustSpendCheckpoint('mainnet', seed, identity, checkpoint);
    await saveDustSpendCheckpoint('mainnet', other, identity, checkpoint);
    await saveDustSpendCheckpoint('preprod', seed, identity, checkpoint);
    rows.set('midnight_wallet_state_mainnet_dust_x', { ...rows.values().next().value!, key: 'midnight_wallet_state_mainnet_dust_x', kind: 'dust' as never });
    await clearDustSpendCheckpoints('mainnet');
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toBeNull();
    expect(await loadDustSpendCheckpoint('mainnet', other, identity)).toBeNull();
    expect(await loadDustSpendCheckpoint('preprod', seed, identity)).toEqual(checkpoint);
    expect(rows.has('midnight_wallet_state_mainnet_dust_x')).toBe(true);
  });

  it('treats an unreadable row as no checkpoint', async () => {
    const rows = memoryStore();
    await saveDustSpendCheckpoint('mainnet', seed, identity, checkpoint);
    const [key] = rows.keys();
    rows.set(key, { ...rows.get(key)!, serializedState: '{not json' });
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toBeNull();
  });
});

/** A store whose writes finish only when the test lets them, in the order the test chooses. */
function heldStore() {
  const rows = new Map<string, StoredWalletState>();
  const held: { row: StoredWalletState; finish: () => void; fail: () => void }[] = [];
  setMidnightWalletStateStore({
    get: async key => rows.get(key),
    put: row => new Promise<void>((resolve, reject) => held.push({
      row, finish: () => { rows.set(row.key, row); resolve(); }, fail: () => reject(new Error('quota')),
    })),
    delete: async key => { rows.delete(key); },
    deleteByPrefixes: async () => {},
  });
  return held;
}
const at = (checkedThrough: number): DustSpendCheckpoint => ({ ...checkpoint, checkedThrough });

describe('DUST spend checkpoint writer: the saves of one build', () => {
  afterEach(() => setMidnightWalletStateStore(null));

  it('are stored one at a time in the order made, so the last one stays', async () => {
    const held = heldStore();
    const save = dustSpendCheckpointWriter('mainnet', seed, identity);
    const saves = [save(at(100)), save(at(200)), save(at(300))];
    for (const through of [100, 200, 300]) {
      await vi.waitFor(() => expect(held).toHaveLength(1));
      expect(JSON.parse(held[0].row.serializedState).checkpoint.checkedThrough).toBe(through);
      held.shift()!.finish();
    }
    await Promise.all(saves);
    expect(held).toHaveLength(0);
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toEqual(at(300));
  });

  it('keep the order asked, not the highest block: a lower checkpoint made later replaces a higher one', async () => {
    const held = heldStore();
    const save = dustSpendCheckpointWriter('mainnet', seed, identity);
    const saves = [save(at(300)), save(at(100))];
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() => expect(held).toHaveLength(1));
      held.shift()!.finish();
    }
    await Promise.all(saves);
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toEqual(at(100));
  });

  it('key the row when the writer is made, so wiping the seed while saves are queued changes nothing', async () => {
    const held = heldStore();
    const wiped = seed.slice();
    const save = dustSpendCheckpointWriter('mainnet', wiped, identity);
    const saves = [save(at(100)), save(at(300))];
    wiped.fill(0);
    for (let i = 0; i < 2; i++) {
      await vi.waitFor(() => expect(held).toHaveLength(1));
      held.shift()!.finish();
    }
    await Promise.all(saves);
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toEqual(at(300));
    expect(await loadDustSpendCheckpoint('mainnet', wiped, identity)).toBeNull();
  });

  it('go on after a write the store refuses', async () => {
    const held = heldStore();
    const save = dustSpendCheckpointWriter('mainnet', seed, identity);
    const saves = [save(at(100)), save(at(300))];
    await vi.waitFor(() => expect(held).toHaveLength(1));
    held.shift()!.fail();
    await vi.waitFor(() => expect(held).toHaveLength(1));
    held.shift()!.finish();
    await expect(Promise.all(saves)).resolves.toEqual([undefined, undefined]);
    expect(await loadDustSpendCheckpoint('mainnet', seed, identity)).toEqual(at(300));
  });
});
