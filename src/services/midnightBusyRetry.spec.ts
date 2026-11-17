import { describe, expect, it, vi } from 'vitest';
import { MidnightApiError } from '@/api/midnightApiError';
import {
  MAX_AUTO_RESUBMITS,
  MidnightBusyCancelledError,
  MidnightTxExpiredError,
  submitWithBusyRetry,
} from './midnightBusyRetry';

vi.mock('@/plugins/i18n', () => ({ default: { t: (key: string) => key } }));

const busy = (retryAfter?: number) => new MidnightApiError('proverBusy', { status: 503, errorCode: 'MIDNIGHT_PROVER_BUSY', message: 'busy', retryAfter });
const SIGNED = 'signed-bytes';

/** A clock that only moves when the code under test sleeps. */
function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, sleep: vi.fn(async (ms: number) => { t += ms; }) };
}

describe('submitWithBusyRetry', () => {
  it('counts down from Retry-After and resubmits the same bytes, at most twice automatically', async () => {
    const submit = vi.fn(async (hex: string) => { void hex; throw busy(3); });
    const countdown: Array<number | null> = [];
    const onStillBusy = vi.fn(async () => 'cancel' as const);
    const c = clock();
    await expect(submitWithBusyRetry(() => submit(SIGNED), { ...c, onCountdown: (s) => countdown.push(s), onStillBusy }))
      .rejects.toBeInstanceOf(MidnightBusyCancelledError);
    expect(submit).toHaveBeenCalledTimes(1 + MAX_AUTO_RESUBMITS);
    expect(submit.mock.calls.every(([hex]) => hex === SIGNED)).toBe(true);
    expect(countdown).toEqual([3, 2, 1, null, 3, 2, 1, null]);
    expect(onStillBusy).toHaveBeenCalledOnce();
  });

  it('Try again resends the same bytes and succeeds', async () => {
    const submit = vi.fn()
      .mockRejectedValueOnce(busy(1)).mockRejectedValueOnce(busy(1)).mockRejectedValueOnce(busy(1))
      .mockResolvedValueOnce({ txHash: 'ok' });
    const onStillBusy = vi.fn(async () => 'retry' as const);
    await expect(submitWithBusyRetry(() => submit(SIGNED), { ...clock(), onStillBusy })).resolves.toEqual({ txHash: 'ok' });
    expect(submit).toHaveBeenCalledTimes(4);
    expect(submit.mock.calls.every(([hex]) => hex === SIGNED)).toBe(true);
  });

  it('waits 10 s without a Retry-After, and caps a long one', async () => {
    const c = clock();
    const submit = vi.fn().mockRejectedValueOnce(busy()).mockRejectedValueOnce(busy(3600)).mockResolvedValueOnce('ok');
    await submitWithBusyRetry(submit, c);
    expect(c.sleep).toHaveBeenCalledTimes(10 + 60);
  });

  it('stops when the time-to-live is near: expired, nothing sent', async () => {
    const c = clock(0);
    const submit = vi.fn().mockRejectedValue(busy(20));
    await expect(submitWithBusyRetry(submit, { ...c, ttlMs: 45_000 })).rejects.toBeInstanceOf(MidnightTxExpiredError);
    expect(submit).toHaveBeenCalledOnce();
    expect(c.sleep).not.toHaveBeenCalled();
  });

  it('passes any other error through untouched', async () => {
    const other = new MidnightApiError('server', { status: 500, message: 'boom' });
    await expect(submitWithBusyRetry(vi.fn().mockRejectedValue(other), clock())).rejects.toBe(other);
  });

  it('stops quietly once the send is no longer current', async () => {
    let current = true;
    const c = clock();
    c.sleep.mockImplementation(async () => { current = false; });
    const submit = vi.fn().mockRejectedValue(busy(5));
    await expect(submitWithBusyRetry(submit, { ...c, isCurrent: () => current })).rejects.toBeInstanceOf(MidnightBusyCancelledError);
    expect(submit).toHaveBeenCalledOnce();
  });

  it('without a prompt, reports the readable busy error after the automatic resubmits', async () => {
    const error = busy(1);
    await expect(submitWithBusyRetry(vi.fn().mockRejectedValue(error), clock())).rejects.toBe(error);
  });

  it('reports each wait and each new attempt, so the timeline can say which', async () => {
    const events: string[] = [];
    const submit = vi.fn(async () => { events.push('submit'); throw busy(1); });
    const onStillBusy = vi.fn(async () => { events.push('prompt'); return 'cancel' as const; });
    await expect(submitWithBusyRetry(submit, {
      ...clock(), onStillBusy, onWait: () => events.push('wait'), onAttempt: () => events.push('attempt'),
    })).rejects.toBeInstanceOf(MidnightBusyCancelledError);
    expect(events).toEqual(['submit', 'wait', 'attempt', 'submit', 'wait', 'attempt', 'submit', 'wait', 'prompt']);
  });

  it('Try again is a new attempt', async () => {
    const attempts = vi.fn();
    const submit = vi.fn()
      .mockRejectedValueOnce(busy(1)).mockRejectedValueOnce(busy(1)).mockRejectedValueOnce(busy(1))
      .mockResolvedValueOnce({ txHash: 'ok' });
    await submitWithBusyRetry(submit, { ...clock(), onStillBusy: async () => 'retry' as const, onAttempt: attempts });
    expect(attempts).toHaveBeenCalledTimes(MAX_AUTO_RESUBMITS + 1);
  });

  it('an aborted signal ends the countdown at once and leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      const abort = new AbortController();
      const countdown: Array<number | null> = [];
      const submit = vi.fn().mockRejectedValue(busy(10));
      const run = submitWithBusyRetry(submit, { signal: abort.signal, onCountdown: (n) => countdown.push(n) });
      const settled = expect(run).rejects.toBeInstanceOf(MidnightBusyCancelledError);
      await vi.advanceTimersByTimeAsync(2_500);
      abort.abort();
      await settled;
      expect(countdown).toEqual([10, 9, 8, null]);
      expect(vi.getTimerCount()).toBe(0);
      expect(submit).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
