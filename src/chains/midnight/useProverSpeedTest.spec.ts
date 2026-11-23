// "Speed on this computer": which provers are measured, in what order, and
// what a row says when a prover is not available here.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  calls: [] as string[],
  browser: { false: { proveMs: 7900, threads: 1 }, true: { proveMs: 1900, threads: 8 } } as Record<string, unknown>,
  helper: { proveMs: 600, accelerated: false } as unknown,
  connection: 'connected',
}));

vi.mock('./geroProverState', async () => {
  const { ref } = await import('vue');
  const geroProverSnapshot = ref<unknown>({ connection: 'connected' });
  return {
    geroProverSnapshot,
    askBrowserSelfTest: vi.fn(async (threaded: boolean) => {
      fake.calls.push(`browser:${threaded}`);
      const result = fake.browser[String(threaded)];
      if (result instanceof Error) throw result;
      return result;
    }),
    askGeroProver: vi.fn(async (request: { action: string }) => {
      fake.calls.push(`helper:${request.action}`);
      if (fake.helper instanceof Error) throw fake.helper;
      return { snapshot: geroProverSnapshot.value, selfTest: fake.helper };
    }),
  };
});

import { geroProverSnapshot } from './geroProverState';
import { resetProverSpeedTestForTests, useProverSpeedTest } from './useProverSpeedTest';

beforeEach(() => {
  resetProverSpeedTestForTests();
  fake.calls = [];
  fake.browser = { false: { proveMs: 7900, threads: 1 }, true: { proveMs: 1900, threads: 8 } };
  fake.helper = { proveMs: 600, accelerated: false };
  (geroProverSnapshot as { value: unknown }).value = { connection: 'connected' };
});

describe('useProverSpeedTest', () => {
  it('lists only what is on offer, the standard prover always', () => {
    expect(useProverSpeedTest(() => ({ browser: false, helper: false })).rows.value.map((r) => r.id)).toEqual(['standard']);
    expect(useProverSpeedTest(() => ({ browser: true, helper: false })).rows.value.map((r) => r.id)).toEqual(['standard', 'threaded']);
    expect(useProverSpeedTest(() => ({ browser: true, helper: true })).rows.value.map((r) => r.id)).toEqual(['standard', 'threaded', 'helper']);
  });

  it('measures one prover after another, warm, and names the fastest', async () => {
    const test = useProverSpeedTest(() => ({ browser: true, helper: true }));
    expect(test.measured.value).toBe(false);
    await test.run();
    // Each is proved twice: the first proof also loads the prover and its keys.
    expect(fake.calls).toEqual([
      'browser:false', 'browser:false', 'browser:true', 'browser:true', 'helper:selfTest', 'helper:selfTest',
    ]);
    expect(test.rows.value.map((r) => r.state)).toEqual([
      { status: 'done', ms: 7900, threads: 1 },
      { status: 'done', ms: 1900, threads: 8 },
      { status: 'done', ms: 600 },
    ]);
    expect(test.fastest.value).toBe('helper');
    expect(test.slowestMs.value).toBe(7900);
    expect(test.measured.value).toBe(true);
    expect(test.running.value).toBe(false);
  });

  it('does not show a second single-thread row when this browser cannot run threads', async () => {
    fake.browser['true'] = { proveMs: 7800, threads: 1, threadsUnavailable: 'no-shared-memory' };
    const test = useProverSpeedTest(() => ({ browser: true, helper: false }));
    await test.run();
    expect(test.rows.value[1].state).toEqual({ status: 'unavailable' });
    // One measured row: nothing to call fastest.
    expect(test.fastest.value).toBeNull();
  });

  it('does not start a helper that is not set up', async () => {
    (geroProverSnapshot as { value: unknown }).value = { connection: 'not-found' };
    const test = useProverSpeedTest(() => ({ browser: false, helper: true }));
    await test.run();
    expect(fake.calls).toEqual(['browser:false', 'browser:false']);
    expect(test.rows.value[1].state).toEqual({ status: 'unavailable' });
  });

  it('marks a prover that fails and still measures the rest', async () => {
    fake.browser['true'] = new Error('worker stopped');
    const test = useProverSpeedTest(() => ({ browser: true, helper: true }));
    await test.run();
    expect(test.rows.value.map((r) => r.state.status)).toEqual(['done', 'failed', 'done']);
    expect(test.fastest.value).toBe('helper');
  });

  it('keeps that Gero Prover made its test proof on the graphics processor', async () => {
    fake.helper = { proveMs: 190, accelerated: true };
    const test = useProverSpeedTest(() => ({ browser: false, helper: true }));
    await test.run();
    expect(test.rows.value[1].state).toEqual({ status: 'done', ms: 190, accelerated: true });
  });
});
