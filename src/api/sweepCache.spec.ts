// Merges are built once and kept while they still apply, so pressing Max again, typing an
// amount or a payment arriving does not rebuild them (each build counts against the
// server's request limit). Here the request limit is 4, so the numbers stay small.
import { describe, expect, it } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import { combineSweeps, createSweepCache } from './sweepCache';
import type { BuiltSweep } from './sweepBuild';

const LIMIT = 4;
const FRESH = 60_000;
const NOW = 1_000_000;
const WALLET = 'wallet-1:Mainnet';
const txId = (n: number) => n.toString(16).padStart(64, '0');
const utxo = (n: number, lovelace = 1_000_000 + n) =>
  [{ txId: txId(n), index: 0 }, { address: 'own', value: { coins: BigInt(lovelace) } }] as unknown as Cardano.Utxo;
const refs = (list: Cardano.Utxo[]) => list.map(([txIn]) => `${txIn.txId}#${txIn.index}`);

/** A sweep as buildSweep returns it: one merge of `merged` into one output, the rest direct. */
function builtSweep(merged: Cardano.Utxo[], direct: Cardano.Utxo[], id = 'merge-a'): BuiltSweep {
  return {
    merges: [{ id, body: { inputs: merged.map(([txIn]) => txIn), outputs: [], fee: 200n } } as unknown as Cardano.Tx],
    mergeCbors: [`cbor-${id}`],
    mergeOutputs: [[{ txId: id, index: 0 }, { address: 'own', value: { coins: 3_000_000n } }] as unknown as Cardano.Utxo],
    direct,
    mergeFee: 200n,
    utxoCount: merged.length + direct.length,
  };
}

// Six UTxOs, limit 4: one merge of the three smallest, three left to spend directly.
const wallet = Array.from({ length: 6 }, (_, n) => utxo(n));
const merged = wallet.slice(0, 3);
const direct = wallet.slice(3);

describe('createSweepCache().nextStep', () => {
  it('needs nothing for a wallet one request carries', () => {
    expect(createSweepCache().nextStep(WALLET, wallet.slice(0, 4), NOW, FRESH, LIMIT)).toBeNull();
  });

  it('plans every merge when nothing was built before', () => {
    const step = createSweepCache().nextStep(WALLET, wallet, NOW, FRESH, LIMIT)!;
    expect(step.kept).toBeNull();
    expect(refs(step.plan!.batches.flat())).toEqual(refs(merged));
  });

  it('keeps the merges built before while every UTxO they spend is still there', () => {
    const cache = createSweepCache();
    cache.remember(WALLET, builtSweep(merged, direct), NOW - 1_000);
    const step = cache.nextStep(WALLET, wallet, NOW, FRESH, LIMIT)!;
    expect(step.plan).toBeNull();
    expect(step.kept?.builtAt).toBe(NOW - 1_000);
    expect(step.kept?.built.mergeCbors).toEqual(['cbor-merge-a']);
    expect(refs(step.kept!.built.direct)).toEqual(refs(direct));
  });

  it('adds a UTxO that arrived since to the payment when it still fits', () => {
    const cache = createSweepCache();
    // Built when the wallet held five: one merge of three, two direct, room for one more.
    cache.remember(WALLET, builtSweep(wallet.slice(0, 3), wallet.slice(3, 5)), NOW - 1_000);
    const step = cache.nextStep(WALLET, wallet, NOW, FRESH, LIMIT)!;
    expect(step.plan).toBeNull();
    expect(refs(step.kept!.built.direct)).toEqual(refs(wallet.slice(3, 6)));
    expect(step.kept!.built.utxoCount).toBe(6);
  });

  it('plans only one more merge, from the smallest, when arrivals push the payment past the limit', () => {
    const cache = createSweepCache();
    cache.remember(WALLET, builtSweep(merged, direct), NOW - 1_000);
    const arrived = utxo(6, 500_000);
    const step = cache.nextStep(WALLET, [...wallet, arrived], NOW, FRESH, LIMIT)!;
    expect(step.kept?.built.mergeCbors).toEqual(['cbor-merge-a']);
    expect(step.plan!.batches).toHaveLength(1);
    // The new UTxO and the smallest one left direct are merged.
    expect(refs(step.plan!.batches[0])).toEqual(refs([arrived, wallet[3]]));
    // Kept merge output, new merge output, and what stays direct: exactly the limit.
    expect(step.plan!.direct.length + step.plan!.batches.length + 1).toBe(LIMIT);
  });

  it('plans afresh when a UTxO a kept merge spends is gone', () => {
    const cache = createSweepCache();
    cache.remember(WALLET, builtSweep(merged, direct), NOW - 1_000);
    const step = cache.nextStep(WALLET, [...wallet.slice(1), utxo(7)], NOW, FRESH, LIMIT)!;
    expect(step.kept).toBeNull();
    expect(step.plan).not.toBeNull();
  });

  it('never keeps a merge whose inputs it cannot read', () => {
    const cache = createSweepCache();
    const unreadable = builtSweep(merged, direct);
    (unreadable.merges[0] as unknown as { body: { inputs?: unknown } }).body.inputs = undefined;
    cache.remember(WALLET, unreadable, NOW - 1_000);
    expect(cache.nextStep(WALLET, wallet, NOW, FRESH, LIMIT)!.kept).toBeNull();
  });

  it('plans afresh once the kept merges are too old, or for another wallet', () => {
    const cache = createSweepCache();
    cache.remember(WALLET, builtSweep(merged, direct), NOW - FRESH);
    expect(cache.nextStep(WALLET, wallet, NOW, FRESH, LIMIT)!.kept).toBeNull();
    cache.remember(WALLET, builtSweep(merged, direct), NOW - 1_000);
    expect(cache.nextStep('wallet-2:Mainnet', wallet, NOW, FRESH, LIMIT)!.kept).toBeNull();
  });
});

describe('combineSweeps', () => {
  it('sends the kept merges first, then the new ones, with the fees added', () => {
    const kept = builtSweep(merged, direct, 'merge-a');
    const added = builtSweep([wallet[3], wallet[4]], [wallet[5]], 'merge-b');
    const combined = combineSweeps(kept, added, 6);
    expect(combined.mergeCbors).toEqual(['cbor-merge-a', 'cbor-merge-b']);
    expect(combined.mergeOutputs.map(([txIn]) => txIn.txId)).toEqual(['merge-a', 'merge-b']);
    expect(combined.merges.map((tx) => tx.id)).toEqual(['merge-a', 'merge-b']);
    expect(refs(combined.direct)).toEqual(refs([wallet[5]]));
    expect(combined.mergeFee).toBe(400n);
    expect(combined.utxoCount).toBe(6);
  });
});
