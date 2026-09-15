// src/chrome/utxoCache.spec.ts
//
// The per-wallet `utxos` table is what the balance is rebuilt from after an MV3 worker
// restart. It used to hold the spendable half only, so a restart restored a wallet whose
// CIP-113 lovelace was locked but no longer known to be locked — and the stake-level
// `controlled_amount` was applied unadjusted. These tests pin the two properties that
// makes the restore correct: both halves survive the round trip, and a cache written
// before the tag existed is recognisable as not carrying the programmable half.
import { describe, it, expect } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { serializeUtxoRows, readCachedUtxoRows, type CachedUtxoRow } from './utxoCache';

const TX_ID = '0'.repeat(63) + '1';
const OTHER_TX_ID = '0'.repeat(63) + '2';
const POLICY = 'a'.repeat(56);
const UNIT = `${POLICY}${Buffer.from('GERO').toString('hex')}`;
const ADDRESS = 'addr_test1qown';
const PLB_ADDRESS = 'addr_test1qprogrammable';

function utxo(txId: string, address: string, coins: bigint, assets?: [string, bigint][]): Cardano.Utxo {
  return [
    {
      txId: Cardano.TransactionId(txId),
      index: 0,
      address: address as Cardano.PaymentAddress,
    },
    {
      address: address as Cardano.PaymentAddress,
      value: {
        coins,
        assets: assets ? new Map(assets.map(([u, q]) => [Cardano.AssetId(u), q])) : undefined,
      },
    },
  ] as Cardano.Utxo;
}

describe('serializeUtxoRows', () => {
  it('tags every row with the half it came from', () => {
    const rows = serializeUtxoRows([utxo(TX_ID, PLB_ADDRESS, 2_000_000n)], 'programmable');

    expect(rows).toHaveLength(1);
    expect(rows[0].partition).toBe('programmable');
  });

  it('writes amounts as strings so a bigint survives structured clone', () => {
    const rows = serializeUtxoRows([utxo(TX_ID, ADDRESS, 2_000_000n, [[UNIT, 42n]])], 'spendable');

    expect(rows[0].coins).toBe('2000000');
    expect(rows[0].assets).toEqual([{ unit: UNIT, quantity: '42' }]);
  });
});

describe('readCachedUtxoRows', () => {
  it('round-trips a UTxO back to the shape applyUtxos consumes', () => {
    const original = utxo(TX_ID, ADDRESS, 2_000_000n, [[UNIT, 42n]]);

    const { utxos } = readCachedUtxoRows(serializeUtxoRows([original], 'spendable'));

    expect(utxos).toHaveLength(1);
    const [txIn, txOut] = utxos[0];
    expect(txIn.txId).toBe(TX_ID);
    expect(txIn.index).toBe(0);
    expect(txOut.address).toBe(ADDRESS);
    expect(txOut.value.coins).toBe(2_000_000n);
    expect(txOut.value.assets?.get(Cardano.AssetId(UNIT))).toBe(42n);
  });

  it('leaves assets undefined when the UTxO carries none', () => {
    const { utxos } = readCachedUtxoRows(serializeUtxoRows([utxo(TX_ID, ADDRESS, 2_000_000n)], 'spendable'));

    expect(utxos[0][1].value.assets).toBeUndefined();
  });

  // The partition is re-derived by classifyUtxoAddress on the way back in, exactly as it
  // is for a live push, so both halves have to come back in one list — the tag records
  // that the cache knows about the split, not which side a row is on.
  it('restores both halves into a single list', () => {
    const rows = [
      ...serializeUtxoRows([utxo(TX_ID, ADDRESS, 2_000_000n)], 'spendable'),
      ...serializeUtxoRows([utxo(OTHER_TX_ID, PLB_ADDRESS, 5_000_000n)], 'programmable'),
    ];

    const { utxos } = readCachedUtxoRows(rows);

    expect(utxos.map(([, out]) => out.address)).toEqual([ADDRESS, PLB_ADDRESS]);
  });

  it('reports the partition as known when the rows carry the tag', () => {
    const rows = serializeUtxoRows([utxo(TX_ID, ADDRESS, 2_000_000n)], 'spendable');

    expect(readCachedUtxoRows(rows).partitionKnown).toBe(true);
  });

  // A cache written by a build that persisted the spendable half only. Aggregating the
  // programmable state from it would report zero locked lovelace and clear the refusal
  // index that loadProgrammableRefs() just restored, so it must be recognisable.
  it('reports the partition as unknown for a cache written before the tag existed', () => {
    const legacy: CachedUtxoRow[] = [
      { txId: TX_ID, index: 0, address: ADDRESS, coins: '2000000', assets: [] },
    ];

    expect(readCachedUtxoRows(legacy).partitionKnown).toBe(false);
  });

  it('reports the partition as unknown for an empty cache', () => {
    expect(readCachedUtxoRows([]).partitionKnown).toBe(false);
  });
});
