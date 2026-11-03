import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';

const mocks = vi.hoisted(() => ({ build: vi.fn() }));
vi.mock('./nexus-tx-api', () => ({
  nexusTxApi: { buildTransferTx: mocks.build },
  cardanoUtxoToNexusInput: (utxo: Cardano.Utxo) => ({ txHash: utxo[0].txId, outputIndex: utxo[0].index, lovelace: String(utxo[1].value.coins) }),
}));
vi.mock('@cardano-sdk/core', () => ({ Serialization: { Transaction: { fromCbor: (cbor: string) => ({ toCore: () => JSON.parse(cbor) }) } } }));
vi.mock('@cardano-sdk/util', () => ({ HexBlob: (value: string) => value }));

import i18n from '@/plugins/i18n';
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
    expect(built.mergeCbors.map((cbor) => JSON.parse(cbor).id)).toEqual(['merge-a', 'merge-c']);
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

  it('stops asking Nexus once a build fails', async () => {
    mocks.build
      .mockImplementation(async (request: { utxos: { txHash: string }[] }) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return merged(`merge-${request.utxos[0].txHash}`, 1);
      })
      .mockImplementationOnce(async () => {
        throw new Error('nexus down');
      });
    const batches = Array.from({ length: 10 }, (_, n) => [utxo(`x${n}`, 5), utxo(`y${n}`, 5)]);
    await expect(buildSweep({ batches, direct: [] }, context)).rejects.toThrow('nexus down');
    // The builds already in flight finish after the rejection; none may start after it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mocks.build.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('refuses a merge with more than one output', async () => {
    mocks.build.mockImplementation(async () => ({
      tx_cbor: JSON.stringify({ id: 'merge-a', body: { outputs: [{ address: 'own', value: { coins: 1 } }, { address: 'own', value: { coins: 2 } }], fee: '170' } }),
    }));
    await expect(buildSweep(plan, context)).rejects.toThrow(String(i18n.t('txGuard.builtTxMismatch')));
  });

  it('reports each merge as it is built', async () => {
    // The first merge answers last: the count still rises by one per merge.
    mocks.build.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return merged('merge-x0', 1);
    });
    const batches = Array.from({ length: 3 }, (_, n) => [utxo(`x${n}`, 5), utxo(`y${n}`, 5)]);
    const reported: [number, number][] = [];
    await buildSweep({ batches, direct: [] }, { ...context, onMergeBuilt: (built, total) => reported.push([built, total]) });
    expect(reported).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('does not report a merge it refuses', async () => {
    mocks.build.mockImplementation(async () => ({
      tx_cbor: JSON.stringify({ id: 'merge-c', body: { outputs: [{ address: 'own', value: { coins: 1 } }, { address: 'own', value: { coins: 2 } }], fee: '170' } }),
    })).mockImplementationOnce(async () => merged('merge-a', 130));
    const onMergeBuilt = vi.fn();
    await expect(buildSweep(plan, { ...context, onMergeBuilt })).rejects.toThrow(String(i18n.t('txGuard.builtTxMismatch')));
    expect(onMergeBuilt.mock.calls).toEqual([[1, 2]]);
  });
});
