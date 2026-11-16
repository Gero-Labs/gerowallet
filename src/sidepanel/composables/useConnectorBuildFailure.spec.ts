import { describe, expect, it } from 'vitest';
import { useConnectorBuildFailure } from './useConnectorBuildFailure';
import { MidnightErrorCode } from '@/chrome/config';

const marked = (buildFailure: string) => Object.assign(new Error('build failed'), { buildFailure });

/** A panel showing one request at a time; `show` moves it on, as the queue does. */
function panel(first = 'A') {
  let current: string | undefined = first;
  const failure = useConnectorBuildFailure(() => current);
  return { ...failure, show: (id: string | undefined) => { current = id; } };
}

/** A build of the current request that the test fails or completes later. */
function deferred() {
  let settle!: { reject: (e: unknown) => void; resolve: (v: string) => void };
  const promise = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  return { promise, ...settle };
}

describe('useConnectorBuildFailure', () => {
  it('a decline with no build is a plain Rejected', () => {
    expect(panel().decline('this transfer', 'User declined the transfer request'))
      .toEqual({ code: MidnightErrorCode.Rejected, reason: 'User declined the transfer request' });
  });

  it('a wrong password, then a decline, is still Rejected', async () => {
    const p = panel();
    await expect(p.record(() => Promise.reject(new Error('Wrong password')))).rejects.toThrow('Wrong password');
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });

  it.each([
    ['InternalError', MidnightErrorCode.InternalError, 'The wallet could not build this transfer'],
    ['InsufficientFunds', MidnightErrorCode.InsufficientFunds, 'The wallet cannot cover this transfer'],
  ])('a %s build failure, then a decline, says why', async (mark, code, reason) => {
    const p = panel();
    await expect(p.record(() => Promise.reject(marked(mark)))).rejects.toThrow('build failed');
    expect(p.decline('this transfer', 'declined')).toEqual({ code, reason });
  });

  it('a decline uses the failure up', async () => {
    const p = panel();
    await expect(p.record(() => Promise.reject(marked('InternalError')))).rejects.toThrow();
    p.decline('this transfer', 'declined');
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });

  it('a mark it does not know is no mark', async () => {
    const p = panel();
    await expect(p.record(() => Promise.reject(marked('Rejected')))).rejects.toThrow();
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });

  it('a build that fails after the user moved on says nothing about the next request', async () => {
    const p = panel('A');
    const build = deferred();
    const running = p.record(() => build.promise);
    // The user declines A while it builds; the queue shows B.
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
    p.show('B');
    build.reject(marked('InsufficientFunds'));
    await expect(running).rejects.toThrow();
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });

  it('a late failure of the previous request does not overwrite the current one\'s', async () => {
    const p = panel('A');
    const buildA = deferred();
    const runningA = p.record(() => buildA.promise);
    p.decline('this transfer', 'declined');
    p.show('B');
    await expect(p.record(() => Promise.reject(marked('InsufficientFunds')))).rejects.toThrow();
    buildA.reject(marked('InternalError'));
    await expect(runningA).rejects.toThrow();
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.InsufficientFunds);
  });

  it('a failure belongs to its request, not to whatever is shown at the decline', async () => {
    const p = panel('A');
    await expect(p.record(() => Promise.reject(marked('InternalError')))).rejects.toThrow();
    p.show('B');
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });

  it('a successful retry clears the failure', async () => {
    const p = panel();
    await expect(p.record(() => Promise.reject(marked('InternalError')))).rejects.toThrow();
    await expect(p.record(() => Promise.resolve('tx'))).resolves.toBe('tx');
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });

  it('a mistyped password on the retry keeps the earlier build failure', async () => {
    const p = panel();
    await expect(p.record(() => Promise.reject(marked('InsufficientFunds')))).rejects.toThrow();
    await expect(p.record(() => Promise.reject(new Error('Wrong password')))).rejects.toThrow();
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.InsufficientFunds);
  });

  it('no request shown records nothing', async () => {
    const p = panel();
    p.show(undefined);
    await expect(p.record(() => Promise.reject(marked('InternalError')))).rejects.toThrow();
    p.show('A');
    expect(p.decline('this transfer', 'declined').code).toBe(MidnightErrorCode.Rejected);
  });
});
