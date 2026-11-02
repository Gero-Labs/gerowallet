import { describe, expect, it } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import { chainedPrerequisites, ownOutputsAsUtxos, planMerges, SweepChainError } from './sweepPlan';

const txId = (n: number) => n.toString(16).padStart(64, '0');
function utxo(n: number, lovelace: number, assets?: Map<string, bigint>): Cardano.Utxo {
  return [{ txId: txId(n), index: 0 }, { address: 'addr1qown', value: { coins: BigInt(lovelace), assets } }] as unknown as Cardano.Utxo;
}
const refs = (list: Cardano.Utxo[]) => list.map(([txIn]) => `${txIn.txId}#${txIn.index}`);
const TOKEN = 'a'.repeat(56) + '4745524f';

describe('planMerges', () => {
  it('plans nothing when the wallet fits one request', () => {
    expect(planMerges([utxo(1, 5), utxo(2, 5)], 2)).toBeNull();
  });

  it('brings the support case (2,144 UTxOs) to one payment of exactly 200 inputs', () => {
    const wallet = Array.from({ length: 2144 }, (_, n) => utxo(n, 1_200_000 + n));
    const plan = planMerges(wallet)!;
    expect(plan.batches).toHaveLength(10);
    expect(plan.batches.every((batch) => batch.length >= 2 && batch.length <= 200)).toBe(true);
    expect(plan.direct.length + plan.batches.length).toBe(200);
    expect(new Set(refs([...plan.batches.flat(), ...plan.direct])).size).toBe(2144);
  });

  it('merges the smallest UTxOs and leaves the largest for the payment', () => {
    const plan = planMerges([utxo(1, 9), utxo(2, 1), utxo(3, 8), utxo(4, 2), utxo(5, 7)], 4)!;
    expect(refs(plan.batches.flat())).toEqual(refs([utxo(2, 1), utxo(4, 2)]));
    expect(refs(plan.direct)).toEqual(refs([utxo(5, 7), utxo(3, 8), utxo(1, 9)]));
  });

  it('orders by lovelace even when coins arrive as strings', () => {
    const stringUtxo = (n: number, coins: string) =>
      [{ txId: txId(n), index: 0 }, { address: 'addr1qown', value: { coins } }] as unknown as Cardano.Utxo;
    const plan = planMerges([stringUtxo(1, '9'), stringUtxo(2, '1'), stringUtxo(3, '8'), stringUtxo(4, '2'), stringUtxo(5, '7')], 4)!;
    expect(refs(plan.batches.flat())).toEqual(refs([utxo(2, 1), utxo(4, 2)]));
    expect(refs(plan.direct)).toEqual(refs([utxo(5, 7), utxo(3, 8), utxo(1, 9)]));
  });

  it('keeps every token holder in the payment and never merges one', () => {
    const holder = utxo(9, 1, new Map([[TOKEN, 5n]]));
    const plan = planMerges([holder, utxo(1, 3), utxo(2, 4), utxo(3, 5), utxo(4, 6)], 4)!;
    expect(refs(plan.batches.flat())).not.toContain(refs([holder])[0]);
    expect(refs(plan.direct)).toContain(refs([holder])[0]);
  });

  it('gives up when token holders leave too few UTxOs to merge', () => {
    const holders = [1, 2, 3, 4].map((n) => utxo(n, 2, new Map([[TOKEN, 1n]])));
    expect(planMerges([...holders, utxo(5, 2), utxo(6, 2)], 3)).toBeNull();
  });

  it('spreads the merged UTxOs evenly over the batches', () => {
    const plan = planMerges(Array.from({ length: 12 }, (_, n) => utxo(n, 10 + n)), 4)!;
    // k = ceil(8 / 3) = 3 merges of 11 UTxOs: 4, 4, 3.
    expect(plan.batches.map((batch) => batch.length)).toEqual([4, 4, 3]);
    expect(plan.direct.length + plan.batches.length).toBe(4);
  });
});

describe('ownOutputsAsUtxos', () => {
  it('turns the outputs at the own address into UTxOs of that transaction', () => {
    const tx = { id: 'merge-tx', body: { outputs: [
      { address: 'addr1qown', value: { coins: 5n } },
      { address: 'addr1qelse', value: { coins: 1n } },
      { address: 'addr1qown', value: { coins: 2n } },
    ] } } as unknown as Cardano.Tx;
    const own = ownOutputsAsUtxos(tx, 'addr1qown');
    expect(own.map(([txIn, txOut]) => [txIn.txId, txIn.index, txOut.value.coins]))
      .toEqual([['merge-tx', 0, 5n], ['merge-tx', 2, 2n]]);
    expect(own.map(([txIn]) => txIn.address)).toEqual(['addr1qown', 'addr1qown']);
  });
});

describe('chainedPrerequisites', () => {
  const tx = (id: string, spends: string[] = []) =>
    ({ id, body: { inputs: spends.map((spent) => ({ txId: spent, index: 0 })) } }) as unknown as Cardano.Tx;
  const idOf = (cbor: string) => JSON.parse(cbor).id as string;

  it('returns each merge the payment spends, in order, with its bytes', () => {
    expect(chainedPrerequisites(tx('pay', ['m1', 'm2']), ['{"id":"m1"}', '{"id":"m2"}'], idOf))
      .toEqual([{ id: 'm1', cbor: '{"id":"m1"}' }, { id: 'm2', cbor: '{"id":"m2"}' }]);
  });

  it('refuses a merge the payment does not spend', () => {
    expect(() => chainedPrerequisites(tx('pay', ['m1']), ['{"id":"m1"}', '{"id":"m2"}'], idOf)).toThrow(SweepChainError);
  });

  it('refuses the same merge twice', () => {
    expect(() => chainedPrerequisites(tx('pay', ['m1']), ['{"id":"m1"}', '{"id":"m1"}'], idOf)).toThrow(SweepChainError);
  });
});
