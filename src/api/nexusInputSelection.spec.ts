// Candidate selection for Nexus-built transactions.
//
// Nexus caps the `utxos` list of every build request (`@Size(max = 200)` on
// BuildTxRequest, MaxAdaRequest and the certificate/withdrawal requests), so the
// wallet has to decide which UTxOs a request carries. The rule under test: send
// everything when it fits; otherwise keep what the outputs need (holders of each
// required asset, largest holding first) and fill the rest with the largest
// lovelace, deterministically, and refuse up front when the required assets alone
// would not fit.
import { describe, expect, it } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import { InputLimitError, selectInputCandidates } from './nexusInputSelection';

const POLICY = 'a'.repeat(56);
const GERO = POLICY + '4745524f';
const BLANK_NAME = 'b'.repeat(56);
const TX = 'c'.repeat(64);

function utxo(
  index: number,
  lovelace: number | bigint | string,
  assets?: Map<string, bigint> | Record<string, bigint | string>,
  txId = TX,
): Cardano.Utxo {
  return [
    { txId, index },
    { address: 'addr1qtest', value: { coins: lovelace, assets } },
  ] as unknown as Cardano.Utxo;
}

const ref = (u: Cardano.Utxo) => `${u[0].txId}#${u[0].index}`;
const refs = (list: Cardano.Utxo[]) => list.map(ref);

describe('selectInputCandidates', () => {
  it('sends the whole set, in its own order, when it fits the limit', () => {
    const set = [utxo(0, 5), utxo(1, 1), utxo(2, 3)];
    const selection = selectInputCandidates(set, { limit: 3 });
    expect(selection.utxos).toBe(set);
    expect(selection.truncated).toBe(false);
    expect(selection.total).toBe(3);
    expect(selection.limit).toBe(3);
  });

  it('keeps the largest lovelace when the set is over the limit', () => {
    const set = [utxo(0, 1), utxo(1, 5), utxo(2, 3), utxo(3, 4), utxo(4, 2)];
    const selection = selectInputCandidates(set, { limit: 3 });
    expect(refs(selection.utxos)).toEqual([`${TX}#1`, `${TX}#3`, `${TX}#2`]);
    expect(selection.truncated).toBe(true);
    expect(selection.total).toBe(5);
  });

  it('picks the same candidates whatever order the wallet lists them in', () => {
    const set = [utxo(0, 1), utxo(1, 5), utxo(2, 3), utxo(3, 4), utxo(4, 2)];
    const shuffled = [set[3], set[0], set[4], set[2], set[1]];
    expect(refs(selectInputCandidates(shuffled, { limit: 3 }).utxos))
      .toEqual(refs(selectInputCandidates(set, { limit: 3 }).utxos));
  });

  it('compares lovelace numerically when coins come back from storage as strings', () => {
    const set = [utxo(0, '999'), utxo(1, '1000')];
    expect(refs(selectInputCandidates(set, { limit: 1 }).utxos)).toEqual([`${TX}#1`]);
  });

  it('keeps the holders of a required asset even when they are tiny', () => {
    const set = [
      utxo(0, 100_000_000),
      utxo(1, 100_000_000),
      utxo(2, 1_200_000, new Map([[GERO, BigInt(10)]])),
      utxo(3, 100_000_000),
      utxo(4, 100_000_000),
    ];
    const selection = selectInputCandidates(set, { limit: 3, requiredAssets: new Map([[GERO, BigInt(5)]]) });
    expect(refs(selection.utxos)).toContain(`${TX}#2`);
    expect(selection.utxos).toHaveLength(3);
  });

  it('covers a required quantity with the largest holdings first', () => {
    const set = [
      utxo(1, 2_000_000, new Map([[GERO, BigInt(2)]])),
      utxo(2, 2_000_000, new Map([[GERO, BigInt(7)]])),
      utxo(3, 2_000_000, new Map([[GERO, BigInt(3)]])),
    ];
    const selection = selectInputCandidates(set, { limit: 2, requiredAssets: new Map([[GERO, BigInt(8)]]) });
    expect(refs(selection.utxos)).toEqual([`${TX}#2`, `${TX}#3`]);
  });

  it('recognises holders whose asset map was flattened to a plain object', () => {
    const set = [
      utxo(0, 100_000_000),
      utxo(1, 100_000_000),
      utxo(2, 1_200_000, { [GERO]: '4' }),
    ];
    const selection = selectInputCandidates(set, { limit: 2, requiredAssets: new Map([[GERO, BigInt(4)]]) });
    expect(refs(selection.utxos)).toContain(`${TX}#2`);
  });

  it('treats a policy-only unit (empty asset name) as an asset like any other', () => {
    const set = [
      utxo(0, 100_000_000),
      utxo(1, 100_000_000),
      utxo(2, 1_200_000, new Map([[BLANK_NAME, BigInt(1)]])),
    ];
    const selection = selectInputCandidates(set, { limit: 2, requiredAssets: new Map([[BLANK_NAME, BigInt(1)]]) });
    expect(refs(selection.utxos)).toContain(`${TX}#2`);
  });

  it('refuses up front when the required assets alone need more inputs than the limit', () => {
    const set = [
      utxo(0, 2_000_000, new Map([[GERO, BigInt(1)]])),
      utxo(1, 2_000_000, new Map([[GERO, BigInt(1)]])),
      utxo(2, 2_000_000, new Map([[GERO, BigInt(1)]])),
    ];
    let thrown: unknown;
    try {
      selectInputCandidates(set, { limit: 2, requiredAssets: new Map([[GERO, BigInt(3)]]) });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InputLimitError);
    expect((thrown as InputLimitError).limit).toBe(2);
    expect((thrown as InputLimitError).total).toBe(3);
  });

  it('credits assets already held by chosen inputs before adding more holders', () => {
    // 200 inputs are needed for A, and one of them also carries the 1 B requested.
    // A 201st input holding 2 B must not be pulled in: that would breach the limit
    // although the first 200 already satisfy both assets.
    const A = POLICY + '41';
    const B = POLICY + '42';
    const set: Cardano.Utxo[] = [];
    for (let i = 0; i < 200; i++) {
      const held = new Map<string, bigint>([[A, BigInt(1)]]);
      if (i === 0) held.set(B, BigInt(1));
      set.push(utxo(i, 2_000_000, held));
    }
    set.push(utxo(200, 2_000_000, new Map([[B, BigInt(2)]])));
    set.push(utxo(201, 9_000_000));
    const selection = selectInputCandidates(set, {
      limit: 200,
      requiredAssets: new Map([[A, BigInt(200)], [B, BigInt(1)]]),
    });
    expect(selection.utxos).toHaveLength(200);
    expect(refs(selection.utxos)).not.toContain(`${TX}#200`);
  });

  it('does not refuse when the wallet simply lacks the asset; Nexus reports that shortfall', () => {
    const set = [utxo(0, 2_000_000, new Map([[GERO, BigInt(1)]])), utxo(1, 5_000_000)];
    const selection = selectInputCandidates(set, { limit: 1, requiredAssets: new Map([[GERO, BigInt(3)]]) });
    expect(refs(selection.utxos)).toEqual([`${TX}#0`]);
  });
});
