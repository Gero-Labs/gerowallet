import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { getCollateral, getUtxos } from './serialization';
import { convertNexusUtxos } from '@/services/nexusUtxo';
import {
  HASH_ONLY_DATUM_UTXO,
  INLINE_DATUM_UTXOS,
  type MainnetDatumUtxo,
} from '@/shared/utils/__fixtures__/mainnetDatumUtxos';

/** The CIP-30 TransactionUnspentOutput of the UTxO as the chain holds it: [[txId, index], output]. */
const onChainCip30 = ({ nexusRow, outputCbor }: MainnetDatumUtxo): string =>
  `82825820${nexusRow.txHash}${Number(nexusRow.txIndex).toString(16).padStart(2, '0')}${outputCbor}`;

/** `[1, #6.24(bytes)]`: an inline datum over exactly these bytes. */
const inlineDatumOption = (datumCbor: string): string => {
  const length = datumCbor.length / 2;
  const head = length < 24 ? (0x40 + length).toString(16) : length < 256 ? `58${length.toString(16).padStart(2, '0')}` : `59${length.toString(16).padStart(4, '0')}`;
  return `8201d818${head}${datumCbor}`;
};

/**
 * A wallet UTxO in the shape versions before the inline-datum fix persisted: the provider's
 * datum as-is, plus the hash Nexus derives for it. It sits in users' IndexedDB and
 * walletStore until the next sync push replaces it.
 */
function storedBeforeFix({ nexusRow }: MainnetDatumUtxo, datum: unknown = nexusRow.inlineDatum): Cardano.Utxo {
  const address = nexusRow.address as Cardano.PaymentAddress;
  const assets = new Map(
    nexusRow.assets.map(({ unit, quantity }) => [Cardano.AssetId(unit), BigInt(quantity)]),
  );
  return [
    { txId: Cardano.TransactionId(nexusRow.txHash), index: nexusRow.txIndex, address },
    {
      address,
      value: { coins: BigInt(nexusRow.value), assets },
      datumHash: nexusRow.datumHash as Cardano.DatumHash,
      datum: datum as Cardano.PlutusData,
    },
  ];
}

const cip30 = (utxos: Cardano.Utxo[]): string[] =>
  getUtxos(undefined, undefined, utxos, null).map((utxo) => utxo.toCbor());

describe('getUtxos: datums', () => {
  it('writes a stored { bytes, value } inline datum inline, over its original bytes', () => {
    expect(cip30(INLINE_DATUM_UTXOS.map((f) => storedBeforeFix(f)))).toEqual(INLINE_DATUM_UTXOS.map(onChainCip30));
  });

  it('writes a stored bare-hex inline datum inline rather than as a datum hash', () => {
    // A string in TxOut.datum is what Datum.fromCore takes for a HASH.
    expect(cip30(INLINE_DATUM_UTXOS.map((f) => storedBeforeFix(f, f.datumCbor)))).toEqual(
      INLINE_DATUM_UTXOS.map(onChainCip30),
    );
  });

  it('keeps a hash-only datum as a hash', () => {
    expect(cip30([storedBeforeFix(HASH_ONLY_DATUM_UTXO, undefined)])).toEqual([onChainCip30(HASH_ONLY_DATUM_UTXO)]);
  });
});

describe('getCollateral: datums', () => {
  const [fixture] = INLINE_DATUM_UTXOS;

  // A pure-ADA UTxO at the wallet's own address can still carry a datum someone attached.
  const pureAda = (datum: unknown, datumHash?: Cardano.DatumHash): Cardano.Utxo => {
    const [txIn, txOut] = storedBeforeFix(fixture, datum);
    return [txIn, { ...txOut, value: { coins: 5_000_000n }, datumHash }];
  };

  it.each([
    ['as Nexus sent it, with its hash', () => pureAda(fixture.nexusRow.inlineDatum, fixture.datumHash as Cardano.DatumHash)],
    ['as bare hex from a block', () => pureAda(fixture.datumCbor)],
    ['as the wallet stores it', () => pureAda(convertNexusUtxos([fixture.nexusRow])[0][1].datum)],
  ])('writes a collateral UTxO datum stored %s inline, over its original bytes', async (_, utxo) => {
    const [collateral] = await getCollateral({}, [utxo()], { allowNexusFallback: false });
    expect(collateral).toContain(`02${inlineDatumOption(fixture.datumCbor)}`);
  });
});
