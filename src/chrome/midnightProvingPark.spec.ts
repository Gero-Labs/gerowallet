// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { DappProvingTarget } from '@/chains/midnight/midnightProvingTarget';
import { DAPP_PROVING_PARK_MS, ProvingPark, ProvingParkCancelled } from './midnightProvingPark';
import type { ParkAnswer, ParkDeps, ProvingParkPayload } from './midnightProvingPark';

const target: DappProvingTarget = { url: 'http://localhost:6300', source: 'default' };
class Down extends Error {}

function harness(opts: { preflight?: boolean[]; answers?: ParkAnswer[] } = {}) {
  const preflights = [...(opts.preflight ?? [])];
  const answers = [...(opts.answers ?? [])];
  const prompts: ProvingParkPayload[] = [];
  let clock = 1_000;
  const pendingResolvers: Array<(a: ParkAnswer) => void> = [];
  const deps: ParkDeps = {
    preflight: async () => (preflights.length ? preflights.shift()! : true),
    prompt: async (_ctx, payload) => {
      prompts.push(payload);
      if (answers.length) return answers.shift()!;
      return new Promise<ParkAnswer>((resolve) => { pendingResolvers.push(resolve); });
    },
    isUnreachable: (e) => e instanceof Down,
    now: () => clock,
  };
  return { deps, prompts, pendingResolvers, advance: (ms: number) => { clock += ms; }, park: new ProvingPark(deps) };
}

const ctx = (tabId = 1) => ({ origin: 'https://dapp.example', tabId, target });

describe('ProvingPark.run', () => {
  it('runs the op straight away when the server answers', async () => {
    const h = harness();
    const op = vi.fn(async () => 'proof');
    await expect(h.park.run(ctx(), op)).resolves.toBe('proof');
    expect(op).toHaveBeenCalledTimes(1);
    expect(h.prompts).toEqual([]);
  });

  it('prompts when the preflight fails and retries after the user says retry', async () => {
    const h = harness({ preflight: [false, true], answers: ['retry'] });
    const op = vi.fn(async () => 'proof');
    await expect(h.park.run(ctx(), op)).resolves.toBe('proof');
    expect(h.prompts).toEqual([{ website: 'https://dapp.example', url: target.url, source: 'default', detail: 'no answer from http://localhost:6300/health', attempt: 1 }]);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('prompts when the op fails with a network error, and counts attempts', async () => {
    const h = harness({ answers: ['retry', 'retry'] });
    let calls = 0;
    const op = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new Down(`network error contacting proof server /prove (${calls})`);
      return 'proof';
    });
    await expect(h.park.run(ctx(), op)).resolves.toBe('proof');
    expect(h.prompts.map((p) => [p.attempt, p.detail])).toEqual([
      [1, 'network error contacting proof server /prove (1)'],
      [2, 'network error contacting proof server /prove (2)'],
    ]);
  });

  it('rethrows non-network errors without prompting', async () => {
    const h = harness();
    const op = async () => { throw new Error('proof server /prove: HTTP 400'); };
    await expect(h.park.run(ctx(), op)).rejects.toThrow('HTTP 400');
    expect(h.prompts).toEqual([]);
  });

  it('turns cancel into ProvingParkCancelled carrying the detail', async () => {
    const h = harness({ preflight: [false], answers: ['cancel'] });
    const err = await h.park.run(ctx(), async () => 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProvingParkCancelled);
    expect((err as Error).message).toBe('no answer from http://localhost:6300/health');
  });

  it('shares one prompt between concurrent proofs of the same site', async () => {
    const h = harness({ preflight: [false, false, true, true] });
    const a = h.park.run(ctx(), async () => 'a');
    const b = h.park.run(ctx(), async () => 'b');
    await new Promise((r) => setTimeout(r, 0));
    expect(h.prompts).toHaveLength(1);
    expect(h.pendingResolvers).toHaveLength(1);
    h.pendingResolvers[0]('retry');
    await expect(a).resolves.toBe('a');
    await expect(b).resolves.toBe('b');
  });

  it('gives up after DAPP_PROVING_PARK_MS from the first failure', async () => {
    const h = harness({ preflight: [false, false] });
    // The user comes back to the prompt after the window has passed.
    h.deps.prompt = async (_c, payload) => { h.prompts.push(payload); h.advance(DAPP_PROVING_PARK_MS + 1); return 'retry'; };
    const err = await h.park.run(ctx(), async () => 'x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProvingParkCancelled);
    expect(h.prompts).toHaveLength(1);
  });

  it('cancelTab cancels the prompt parked for that tab', async () => {
    const h = harness({ preflight: [false] });
    const run = h.park.run(ctx(9), async () => 'x');
    await new Promise((r) => setTimeout(r, 0));
    h.park.cancelTab(9);
    await expect(run).rejects.toBeInstanceOf(ProvingParkCancelled);
  });

  it('treats a rejected prompt (panel error) as cancel', async () => {
    const h = harness({ preflight: [false] });
    h.deps.prompt = async () => { throw new Error('wallet_changed_during_request'); };
    await expect(h.park.run(ctx(), async () => 'x')).rejects.toBeInstanceOf(ProvingParkCancelled);
  });
});
