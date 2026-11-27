import { describe, expect, it, vi } from 'vitest';
import { nexusScriptEvaluator, readStakeAccount } from './dustChain';

describe('the Nexus evaluator', () => {
  it('reads each redeemer the node measured, in either field style, on the vault\'s network', async () => {
    const post = vi.fn(async () => ({ data: [
      { redeemerTag: 'spend', index: 0, exUnits: { mem: 79_118, steps: 26_357_885 } },
      { redeemer_tag: 'mint', index: 0, ex_units: { memory: 44_921, cpu: 17_920_479 } },
    ] }));
    const evaluate = nexusScriptEvaluator('preprod', { post } as never);
    expect(await evaluate('84a0a0f5f6')).toEqual([
      { purpose: 'spend', index: 0, memory: 79_118, steps: 26_357_885 },
      { purpose: 'mint', index: 0, memory: 44_921, steps: 17_920_479 },
    ]);
    expect(post).toHaveBeenCalledWith('/api/transactions/evaluate', { cbor: '84a0a0f5f6' }, { params: { network: 'cardano-preprod' } });
  });

  it('throws on an answer it cannot read, so the builder refuses', async () => {
    await expect(nexusScriptEvaluator('preprod', { post: async () => ({ data: { error: 'no' } }) } as never)('00')).rejects.toThrow();
    await expect(nexusScriptEvaluator('preprod', { post: async () => ({ data: [{ redeemerTag: 'mint' }] }) } as never)('00')).rejects.toThrow();
    await expect(nexusScriptEvaluator('preprod', { post: async () => { throw new Error('400'); } } as never)('00')).rejects.toThrow();
  });
});

describe('the stake account read', () => {
  it('reads registration, rewards and deposit, and an unknown address as not registered', async () => {
    const get = vi.fn(async () => ({ data: { registered: true, withdrawable_amount: '1234', deposit: '2000000' } }));
    expect(await readStakeAccount('preprod', 'stake_test1x', { get } as never)).toEqual({ registered: true, rewards: 1234n, deposit: 2_000_000n });
    const missing = Object.assign(new Error('404'), { isAxiosError: true, response: { status: 404 } });
    expect(await readStakeAccount('preprod', 'stake_test1x', { get: async () => { throw missing; } } as never)).toEqual({ registered: false, rewards: 0n });
    expect(await readStakeAccount('preprod', 'stake_test1x', { get: async () => ({ data: {} }) } as never)).toEqual({ registered: null, rewards: 0n });
  });
});
