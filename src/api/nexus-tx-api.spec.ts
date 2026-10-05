import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { cardanoUtxoToNexusInput, NEXUS_MAX_INPUTS, nexusErrorMessage, walletUtxosToNexusInputs } from './nexus-tx-api';
import { convertNexusUtxos } from '@/services/nexusUtxo';
import { HASH_ONLY_DATUM_UTXO, INLINE_DATUM_UTXOS } from '@/shared/utils/__fixtures__/mainnetDatumUtxos';

describe('cardanoUtxoToNexusInput: datums', () => {
  const [fixture] = INLINE_DATUM_UTXOS;
  const [[txIn, txOut]] = convertNexusUtxos([fixture.nexusRow]);

  it.each([
    ['as the wallet stores it', txOut.datum],
    ['as Nexus sent it', fixture.nexusRow.inlineDatum],
    ['as bare hex from a block', fixture.datumCbor],
  ])('sends an inline datum stored %s as its original CBOR hex, without a hash', (_, datum) => {
    const input = cardanoUtxoToNexusInput([
      txIn,
      { ...txOut, datum: datum as Cardano.PlutusData, datumHash: fixture.datumHash as Cardano.DatumHash },
    ]);
    expect(input.inlineDatum).toBe(fixture.datumCbor);
    expect(input.dataHash).toBeUndefined();
  });

  it('sends a hash-only datum as its hash', () => {
    const [utxo] = convertNexusUtxos([HASH_ONLY_DATUM_UTXO.nexusRow]);
    const input = cardanoUtxoToNexusInput(utxo);
    expect(input.dataHash).toBe(HASH_ONLY_DATUM_UTXO.datumHash);
    expect(input.inlineDatum).toBeUndefined();
  });
});

// Nexus refuses a build request carrying more than NEXUS_MAX_INPUTS UTxOs (HTTP 400
// "Validation failed", before coin selection runs), so the shared mapper is the
// one place every flow goes through to stay under it.
describe('walletUtxosToNexusInputs: Nexus input limit', () => {
  const many = (count: number): Cardano.Utxo[] => Array.from({ length: count }, (_, i) => ([
    { txId: 'd'.repeat(64), index: i },
    { address: 'addr1qtest', value: { coins: BigInt(1_000_000 + i) } },
  ] as unknown as Cardano.Utxo));

  it('never sends more inputs than Nexus accepts', () => {
    expect(walletUtxosToNexusInputs(many(NEXUS_MAX_INPUTS + 50))).toHaveLength(NEXUS_MAX_INPUTS);
  });

  it('keeps the largest UTxOs when it has to drop some', () => {
    const inputs = walletUtxosToNexusInputs(many(NEXUS_MAX_INPUTS + 50));
    const smallest = Math.min(...inputs.map((input) => Number(input.lovelace)));
    expect(smallest).toBe(1_000_000 + 50);
  });

  it('sends a small wallet untouched', () => {
    expect(walletUtxosToNexusInputs(many(3))).toHaveLength(3);
  });
});

describe('nexusErrorMessage', () => {
  it('appends the validation details Nexus puts beside its generic message', () => {
    expect(nexusErrorMessage({ message: 'Validation failed', validationErrors: ['utxos: Maximum 200 UTXOs allowed per request'] }))
      .toBe('Validation failed: utxos: Maximum 200 UTXOs allowed per request');
  });

  it('passes a plain message through untouched', () => {
    expect(nexusErrorMessage({ message: 'Insufficient input in transaction.' })).toBe('Insufficient input in transaction.');
  });

  it('returns undefined when the body carries no message', () => {
    expect(nexusErrorMessage({})).toBeUndefined();
    expect(nexusErrorMessage(undefined)).toBeUndefined();
  });
});
