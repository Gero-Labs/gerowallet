import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_STALE_AFTER_MS,
  isSnapshotFresh,
  snapshotBalance,
  snapshotFor,
  toSnapshot,
  withSnapshot,
  withoutWallet,
  type DustSnapshot,
} from './midnightDustSnapshots';
import type { MidnightDustState } from './midnightTypes';

const NOW = 1_800_000_000_000;

function dust(current: bigint, cap = 5_000_000n): MidnightDustState {
  return { current, cap } as unknown as MidnightDustState;
}

function snap(over: Partial<DustSnapshot> = {}): DustSnapshot {
  return { walletId: 2, network: 'Mainnet', current: '4200', cap: '5000', at: NOW, ...over };
}

describe('toSnapshot', () => {
  it('captures balance and cap as decimal strings', () => {
    // chrome.storage cannot carry bigint, so they round-trip as strings.
    expect(toSnapshot(2, 'Mainnet', dust(4200n), NOW)).toEqual({
      walletId: 2, network: 'Mainnet', current: '4200', cap: '5000000', at: NOW,
    });
  });

  it('records a genuine zero', () => {
    expect(toSnapshot(2, 'Mainnet', dust(0n), NOW)?.current).toBe('0');
  });

  it('refuses to snapshot absent or malformed state', () => {
    // Recording a zero we merely failed to read would later render as
    // "no DUST" on a funded wallet.
    expect(toSnapshot(2, 'Mainnet', null, NOW)).toBeNull();
    expect(toSnapshot(2, 'Mainnet', undefined, NOW)).toBeNull();
    expect(toSnapshot(2, 'Mainnet', { current: '4200', cap: 5n } as unknown as MidnightDustState, NOW)).toBeNull();
  });

  it('survives a bigint beyond Number.MAX_SAFE_INTEGER', () => {
    const big = 9_007_199_254_740_993n;
    expect(toSnapshot(2, 'Mainnet', dust(big), NOW)?.current).toBe('9007199254740993');
  });
});

describe('snapshotFor', () => {
  it('returns a fresh same-network snapshot', () => {
    const map = withSnapshot({}, snap());
    expect(snapshotFor(map, 2, 'Mainnet', NOW)).not.toBeNull();
  });

  it('returns null for a wallet with no snapshot', () => {
    expect(snapshotFor({}, 2, 'Mainnet', NOW)).toBeNull();
  });

  it('never returns a snapshot from another network', () => {
    // DUST is per-network; a mainnet balance says nothing about preprod.
    const map = withSnapshot({}, snap({ network: 'Preprod' }));
    expect(snapshotFor(map, 2, 'Mainnet', NOW)).toBeNull();
  });

  it('returns null once stale rather than a misleading figure', () => {
    const map = withSnapshot({}, snap({ at: NOW - SNAPSHOT_STALE_AFTER_MS - 1 }));
    expect(snapshotFor(map, 2, 'Mainnet', NOW)).toBeNull();
    // The caller renders null as "not checked yet" — never as zero.
  });

  it('keeps a snapshot right up to the staleness boundary', () => {
    const map = withSnapshot({}, snap({ at: NOW - SNAPSHOT_STALE_AFTER_MS + 1 }));
    expect(snapshotFor(map, 2, 'Mainnet', NOW)).not.toBeNull();
  });
});

describe('map maintenance', () => {
  it('replaces a wallet snapshot rather than accumulating', () => {
    const map = withSnapshot(withSnapshot({}, snap({ current: '1' })), snap({ current: '2' }));
    expect(Object.keys(map)).toHaveLength(1);
    expect(map['2'].current).toBe('2');
  });

  it('keeps other wallets when one is removed', () => {
    const map = withSnapshot(withSnapshot({}, snap()), snap({ walletId: 3 }));
    const after = withoutWallet(map, 2);
    expect(after['2']).toBeUndefined();
    expect(after['3']).toBeDefined();
  });

  it('does not mutate the input map', () => {
    const before = withSnapshot({}, snap());
    withoutWallet(before, 2);
    expect(before['2']).toBeDefined();
  });
});

describe('snapshotBalance', () => {
  it('parses back to bigint', () => {
    expect(snapshotBalance(snap({ current: '4200' }))).toBe(4200n);
  });

  it('returns null rather than throwing on corrupt storage', () => {
    expect(snapshotBalance(snap({ current: 'not-a-number' }))).toBeNull();
  });
});

describe('isSnapshotFresh', () => {
  it('treats a just-taken snapshot as fresh', () => {
    expect(isSnapshotFresh(snap({ at: NOW }), NOW)).toBe(true);
  });

  it('treats a clock-skewed future snapshot as fresh, not stale', () => {
    // A snapshot from "the future" (device clock moved back) should not be
    // discarded — it is the most recent reading we have.
    expect(isSnapshotFresh(snap({ at: NOW + 60_000 }), NOW)).toBe(true);
  });
});
