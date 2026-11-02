import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('./nexus-tx-api', () => ({
  nexusTxApi: { buildTransferTx: mocks.build },
  cardanoUtxoToNexusInput: (utxo: Cardano.Utxo) => ({ txHash: utxo[0].txId, outputIndex: utxo[0].index, lovelace: String(utxo[1].value.coins) }),
}));
vi.mock('@cardano-sdk/core', () => ({ Serialization: { Transaction: { fromCbor: (cbor: string) => ({ toCore: () => JSON.parse(cbor) }) } } }));
vi.mock('@cardano-sdk/util', () => ({ HexBlob: (value: string) => value }));

import { buildSweep } from './sweepBuild';
import type { MergePlan } from './sweepPlan';

const utxo = (id: string, coins: number) => [{ txId: id, index: 0 }, { address: 'own', value: { coins } }] as unknown as Cardano.Utxo;
const context = { ownAddress: 'own', network: 'PREPROD' as const, walletNetwork: 'Preprod' };
const merged = (id: string, coins: number) =>
  ({ tx_cbor: JSON.stringify({ id, body: { outputs: [{ address: 'own', value: { coins } }], fee: '170' } }) });

beforeEach(() => {
  mocks.build.mockReset().mockImplementation(async (request: { utxos: { txHash: string; lovelace: string }[] }) => {
    const total = request.utxos.reduce((sum, input) => sum + Number(input.lovelace), 0);
    return merged(`merge-${request.utxos[0].txHash}`, total - 170);
  });
});

describe('buildSweep', () => {
  const plan: MergePlan = {
    batches: [[utxo('a', 100), utxo('b', 200)], [utxo('c', 300), utxo('d', 400)]],
    direct: [utxo('e', 900)],
  };

  it('builds one merge per batch, paying all of it to the own address', async () => {
    await buildSweep(plan, context);
    expect(mocks.build).toHaveBeenCalledTimes(2);
    expect(mocks.build.mock.calls[0]).toEqual([{
      outputs: [{ address: 'own', lovelace: '0' }],
      changeAddress: 'own',
      utxos: [{ txHash: 'a', outputIndex: 0, lovelace: '100' }, { txHash: 'b', outputIndex: 0, lovelace: '200' }],
      network: 'PREPROD',
      selectAll: true,
    }, 'Preprod']);
  });

  it('returns the merges in plan order with their outputs, total fee and UTxO count', async () => {
    // The first merge answers last: the order must follow the plan, not the network.
    mocks.build.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return merged('merge-a', 130);
    });
    const built = await buildSweep(plan, context);
    expect(built.merges.map((tx) => tx.id)).toEqual(['merge-a', 'merge-c']);
    expect(built.mergeOutputs.map(([txIn]) => txIn.txId)).toEqual(['merge-a', 'merge-c']);
    expect(built.mergeFee).toBe(340n);
    expect(built.direct).toBe(plan.direct);
    expect(built.utxoCount).toBe(5);
  });

  it('never has more than three builds in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    mocks.build.mockImplementation(async (request: { utxos: { txHash: string }[] }) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return merged(`merge-${request.utxos[0].txHash}`, 1);
    });
    const batches = Array.from({ length: 10 }, (_, n) => [utxo(`x${n}`, 5), utxo(`y${n}`, 5)]);
    await buildSweep({ batches, direct: [] }, context);
    expect(peak).toBe(3);
  });
});
