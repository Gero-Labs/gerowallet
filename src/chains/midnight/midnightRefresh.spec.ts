import { describe, expect, it } from 'vitest';
import {
  REFRESH_OFFLINE_GRACE_MS, REFRESH_QUIET_MS, REFRESH_STALL_MS, REFRESH_TARGET_WAIT_MS, hasDataToKeep, refreshProgressOf, refreshReasonOf,
  refreshTargetOf, refreshVerdict, type MidnightRefreshTracker,
} from './midnightRefresh';
import type { MidnightBalances, MidnightTransaction } from './midnightTypes';

const EMPTY: MidnightBalances = { shieldedTokens: {}, nightShielded: 0n, nightUnshielded: 0n, nightRegistered: 0n, dust: 0n, dustGenerating: 0n };
const tx = (hash: string, timestamp: number, extra: Partial<MidnightTransaction> = {}): MidnightTransaction => ({
  hash, type: 'receive', token: 'NIGHT', amount: 1n, counterparty: '', timestamp, status: 'confirmed', fee: 0n, isShielded: false, ...extra,
});
const tracker = (extra: Partial<MidnightRefreshTracker> = {}): MidnightRefreshTracker => ({
  startedAt: 0, lastFrameAt: 0, lastTxAt: 0, target: 'aa'.repeat(32), sameChain: true, ...extra,
});

describe('what a refresh keeps', () => {
  it('anything on screen: a balance of any kind, or any history', () => {
    expect(hasDataToKeep(EMPTY, [])).toBe(false);
    expect(hasDataToKeep({ ...EMPTY, nightUnshielded: 1n }, [])).toBe(true);
    expect(hasDataToKeep({ ...EMPTY, dust: 1n }, [])).toBe(true);
    expect(hasDataToKeep({ ...EMPTY, shieldedTokens: { ['ab'.repeat(32)]: 2n } }, [])).toBe(true);
    expect(hasDataToKeep(EMPTY, [tx('aa', 1)])).toBe(true);
  });

  it('waits for the newest confirmed public row, never a pending or shielded one', () => {
    const rows = [
      tx(`0x${'AA'.repeat(32)}`, 10),
      tx('bb'.repeat(32), 30, { status: 'pending' }),
      tx('cc'.repeat(32), 40, { isShielded: true }),
      tx('dd'.repeat(32), 5),
    ];
    expect(refreshTargetOf(rows)).toBe('aa'.repeat(32));
    expect(refreshTargetOf([tx('bb', 1, { status: 'pending' })])).toBeNull();
  });
});

describe('reading the frames', () => {
  it('says "network upgrade" only when the sync identity says so', () => {
    expect(refreshReasonOf({ midnight_chain_generation_reason: 'network_upgrade' })).toBe('upgrade');
    expect(refreshReasonOf({ midnight_chain_generation_reason: 'reindex' })).toBeNull();
    expect(refreshReasonOf({ midnight_chain_generation_reason: 'chain_reset' })).toBeNull();
    expect(refreshReasonOf({})).toBeNull();
  });

  it('reads progress only when the sync service reports it, and never says 100% before the end', () => {
    expect(refreshProgressOf({ catch_up_sent: 42, catch_up_total: 100 })).toBe(42);
    expect(refreshProgressOf({ catch_up_sent: 100, catch_up_total: 100 })).toBe(99);
    expect(refreshProgressOf({ catch_up_sent: 5, catch_up_total: 0 })).toBeNull();
    expect(refreshProgressOf({})).toBeNull();
  });
});

describe('when the rebuild is complete', () => {
  it('same chain: once the newest old transaction is back', () => {
    expect(refreshVerdict(tracker(), [tx('11'.repeat(32), 1)], 1_000, true)).toBe('refreshing');
    expect(refreshVerdict(tracker(), [tx(`0x${'aa'.repeat(32)}`, 1)], 1_000, true)).toBe('done');
  });

  it('same chain: a slow replay is not mistaken for the end', () => {
    expect(refreshVerdict(tracker({ lastFrameAt: 50_000 }), [], REFRESH_QUIET_MS + 1, true)).toBe('refreshing');
    expect(refreshVerdict(tracker({ lastFrameAt: REFRESH_TARGET_WAIT_MS }), [], REFRESH_TARGET_WAIT_MS, true)).toBe('done');
  });

  it('a new chain, or nothing to wait for: once transactions stop arriving', () => {
    const fresh = tracker({ sameChain: false, lastFrameAt: REFRESH_QUIET_MS });
    expect(refreshVerdict(fresh, [], REFRESH_QUIET_MS - 1, true)).toBe('refreshing');
    expect(refreshVerdict(fresh, [], REFRESH_QUIET_MS, true)).toBe('done');
    expect(refreshVerdict(tracker({ target: null, lastFrameAt: REFRESH_QUIET_MS }), [], REFRESH_QUIET_MS, true)).toBe('done');
  });

  it('stalled: no frame at all for a while, or the socket is down; the old values stay', () => {
    expect(refreshVerdict(tracker(), [], REFRESH_STALL_MS, true)).toBe('stalled');
    expect(refreshVerdict(tracker({ lastFrameAt: 1_000 }), [], 1_000, false)).toBe('refreshing');
    expect(refreshVerdict(tracker({ lastFrameAt: 1_000 }), [], 1_000 + REFRESH_OFFLINE_GRACE_MS, false)).toBe('stalled');
    // A stall never counts as done, even past the quiet time.
    expect(refreshVerdict(tracker({ sameChain: false }), [], REFRESH_STALL_MS, true)).toBe('stalled');
  });
});
