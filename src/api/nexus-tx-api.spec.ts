import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { cardanoUtxoToNexusInput } from './nexus-tx-api';
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
