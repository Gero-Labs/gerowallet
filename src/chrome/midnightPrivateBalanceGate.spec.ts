// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { MidnightErrorCode } from '@/chrome/config';
import {
  GATE_REASON_STOPPED,
  GATE_REASON_WALLET_CHANGED,
  PrivateBalanceGate,
} from './midnightPrivateBalanceGate';
import type { GateDeps, GateOutcome, PrivateSyncStatus } from './midnightPrivateBalanceGate';

/** Deterministic deps: tests flip `state` and call `tick()` instead of waiting on timers. */
function harness(initial: Partial<{ status: PrivateSyncStatus; identity: string | undefined; balances: Record<string, bigint> }> = {}) {
  const state = {
    status: initial.status ?? 'idle' as PrivateSyncStatus,
    identity: 'identity' in initial ? initial.identity : 'w1:preprod',
    balances: initial.balances ?? {},
  };
  const timers = new Map<number, () => void>();
  let seq = 0;
  const deps: GateDeps = {
    status: () => state.status,
    balances: () => state.balances,
    identity: () => state.identity,
    setInterval: (fn) => { seq += 1; timers.set(seq, fn); return seq; },
    clearInterval: (handle) => { timers.delete(handle as number); },
  };
  const tick = () => { for (const fn of [...timers.values()]) fn(); };
  return { state, deps, timers, tick, gate: new PrivateBalanceGate(deps) };
}

function collector() {
  const outcomes: GateOutcome[] = [];
  return { outcomes, waiter: (o: GateOutcome) => { outcomes.push(o); } };
}

describe('PrivateBalanceGate', () => {
  it('reports only the first joiner as first and settles everyone once with the balances', () => {
    const h = harness({ status: 'syncing', balances: { aa: 5n, bb: 0n } });
    const a = collector();
    const b = collector();
    expect(h.gate.join('k', 1, a.waiter)).toEqual({ first: true });
    expect(h.gate.join('k', 1, b.waiter)).toEqual({ first: false });
    h.gate.awaitSynced('k');
    h.tick();
    expect(a.outcomes).toEqual([]);
    h.state.status = 'synced';
    h.tick();
    h.tick();
    expect(a.outcomes).toEqual([{ ok: true, balances: { aa: '5' } }]);
    expect(b.outcomes).toEqual([{ ok: true, balances: { aa: '5' } }]);
    expect(h.timers.size).toBe(0);
    expect(h.gate.size).toBe(0);
  });

  it('answers immediately when the sync finished while the prompt was open', () => {
    const h = harness({ status: 'synced', balances: { aa: 1n } });
    const a = collector();
    h.gate.join('k', 1, a.waiter);
    h.gate.awaitSynced('k');
    expect(a.outcomes).toEqual([{ ok: true, balances: { aa: '1' } }]);
    expect(h.timers.size).toBe(0);
  });

  it('fails with InternalError when the sync gives up', () => {
    const h = harness({ status: 'syncing' });
    const a = collector();
    h.gate.join('k', 1, a.waiter);
    h.gate.awaitSynced('k');
    h.state.status = 'error';
    h.tick();
    expect(a.outcomes).toEqual([{ ok: false, code: MidnightErrorCode.InternalError, reason: GATE_REASON_STOPPED }]);
  });

  it('fails with Disconnected when the wallet locks, switches, or the session is cleared', () => {
    const locked = harness({ status: 'syncing' });
    const a = collector();
    locked.gate.join('k', 1, a.waiter);
    locked.gate.awaitSynced('k');
    locked.state.identity = undefined;
    locked.tick();
    expect(a.outcomes).toEqual([{ ok: false, code: MidnightErrorCode.Disconnected, reason: GATE_REASON_WALLET_CHANGED }]);

    const switched = harness({ status: 'syncing' });
    const b = collector();
    switched.gate.join('k', 1, b.waiter);
    switched.gate.awaitSynced('k');
    switched.state.identity = 'w2:preprod';
    switched.tick();
    expect(b.outcomes[0]).toMatchObject({ ok: false, code: MidnightErrorCode.Disconnected });

    const cleared = harness({ status: 'syncing' });
    const c = collector();
    cleared.gate.join('k', 1, c.waiter);
    cleared.gate.awaitSynced('k');
    cleared.state.status = 'idle';
    cleared.tick();
    expect(c.outcomes[0]).toMatchObject({ ok: false, code: MidnightErrorCode.Disconnected });
  });

  it('keeps waiting on idle when no scan was seen yet (passkey wallet before unlock)', () => {
    const h = harness({ status: 'idle' });
    const a = collector();
    h.gate.join('k', 1, a.waiter);
    h.gate.awaitSynced('k');
    h.tick();
    expect(a.outcomes).toEqual([]);
    h.state.status = 'syncing';
    h.tick();
    h.state.status = 'synced';
    h.tick();
    expect(a.outcomes[0]).toMatchObject({ ok: true });
  });

  it('remembers a declined tab until it is cleared', () => {
    const h = harness();
    expect(h.gate.isDeclined(7)).toBe(false);
    h.gate.declineTab(7);
    expect(h.gate.isDeclined(7)).toBe(true);
    expect(h.gate.isDeclined(8)).toBe(false);
    h.gate.clearTab(7);
    expect(h.gate.isDeclined(7)).toBe(false);
  });

  it('dropTab settles only the groups that have no other tab left', () => {
    const h = harness({ status: 'syncing' });
    const a = collector();
    const b = collector();
    const c = collector();
    h.gate.join('site-a', 1, a.waiter);
    h.gate.join('site-a', 2, b.waiter);
    h.gate.join('site-b', 1, c.waiter);
    h.gate.awaitSynced('site-a');
    h.gate.awaitSynced('site-b');
    h.gate.dropTab(1);
    expect(c.outcomes).toEqual([{ ok: false, code: MidnightErrorCode.Disconnected, reason: GATE_REASON_WALLET_CHANGED }]);
    expect(a.outcomes).toEqual([]);
    expect(h.gate.size).toBe(1);
    h.gate.dropTab(2);
    expect(a.outcomes[0]).toMatchObject({ ok: false });
    expect(h.gate.size).toBe(0);
  });

  it('settle is idempotent and a throwing waiter does not starve the others', () => {
    const h = harness({ status: 'syncing' });
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = collector();
    h.gate.join('k', 1, bad);
    h.gate.join('k', 1, good.waiter);
    h.gate.settle('k', { ok: false, code: MidnightErrorCode.Rejected, reason: 'no' });
    h.gate.settle('k', { ok: false, code: MidnightErrorCode.Rejected, reason: 'no' });
    expect(bad).toHaveBeenCalledTimes(1);
    expect(good.outcomes).toHaveLength(1);
  });
});
