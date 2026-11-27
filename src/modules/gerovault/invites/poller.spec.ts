// The fallback poll of the invitation screens: slow, paused while the page is deactivated or the
// document hidden, held back by a rate limit, and gone on stop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPoller, pauseWhileHidden } from './poller';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function poller(intervalMs = 60_000) {
  const run = vi.fn(async () => undefined);
  const state = { interval: intervalMs };
  const p = createPoller({ run, intervalMs: () => state.interval });
  return { p, run, state };
}

function fakeDocument(hidden = false) {
  const listeners = new Set<() => void>();
  const doc = {
    hidden,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); },
  };
  const set = (value: boolean) => { doc.hidden = value; for (const fn of listeners) fn(); };
  return { doc: doc as unknown as Document, set, listeners };
}

describe('createPoller', () => {
  it('reads once per interval, and an hour stays well under the 120 reads gero-sync allows', async () => {
    const { p, run } = poller();
    p.start();
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect(run).toHaveBeenCalledTimes(60);
  });

  it('sends nothing while paused and nothing after stop', async () => {
    const { p, run } = poller();
    p.start();
    p.pause('inactive');
    expect(p.active).toBe(false);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).not.toHaveBeenCalled();
    p.resume('inactive');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    p.stop();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stays paused until every reason is gone', async () => {
    const { p, run } = poller();
    p.start();
    p.pause('inactive');
    p.pause('hidden');
    p.resume('hidden');
    await vi.advanceTimersByTimeAsync(600_000);
    expect(run).not.toHaveBeenCalled();
    p.resume('inactive');
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('coming straight back does not read again: flicking between pages is no burst', async () => {
    const { p, run } = poller();
    p.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 20; i++) {
      p.pause('inactive');
      await vi.advanceTimersByTimeAsync(100);
      p.resume('inactive');
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    // The usual wait still ends where it would have.
    await vi.advanceTimersByTimeAsync(57_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('waits out a rate limit before the next read', async () => {
    const { p, run } = poller();
    p.start();
    p.holdUntil(Date.now() + 300_000);
    await vi.advanceTimersByTimeAsync(299_000);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(run).toHaveBeenCalledTimes(1);
    // A return to the page during the wait does not read either.
    p.holdUntil(Date.now() + 300_000);
    p.pause('inactive');
    await vi.advanceTimersByTimeAsync(10_000);
    p.resume('inactive');
    await vi.advanceTimersByTimeAsync(200_000);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('takes a new interval from now, and never overlaps a slow read', async () => {
    const { p, run, state } = poller();
    p.start();
    state.interval = 10_000;
    p.reschedule();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
    let release: () => void = () => undefined;
    run.mockImplementationOnce(() => new Promise<undefined>(resolve => { release = () => resolve(undefined); }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(run).toHaveBeenCalledTimes(2);
    release();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('keeps going after a read that failed', async () => {
    const { p, run } = poller();
    run.mockRejectedValueOnce(new Error('offline'));
    p.start();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('pauseWhileHidden', () => {
  it('pauses while the document is hidden and reads when it shows again', async () => {
    const { p, run } = poller();
    const { doc, set, listeners } = fakeDocument();
    p.start();
    const remove = pauseWhileHidden(p, doc);
    set(true);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).not.toHaveBeenCalled();
    set(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    remove();
    expect(listeners.size).toBe(0);
  });

  it('starts paused in a tab that is already hidden', async () => {
    const { p, run } = poller();
    const { doc } = fakeDocument(true);
    p.start();
    pauseWhileHidden(p, doc);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(run).not.toHaveBeenCalled();
  });
});
