import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { convertNexusUtxos } from './nexusUtxo';
import { getUtxos } from '@/chrome/serialization';
import { readCachedUtxoRows, serializeUtxoRows } from '@/chrome/utxoCache';
import { serializeValue } from '@/stores/walletStore';
import {
  HASH_ONLY_DATUM_UTXO,
  INLINE_DATUM_UTXOS,
  type MainnetDatumUtxo,
} from '@/shared/utils/__fixtures__/mainnetDatumUtxos';

/** The CIP-30 TransactionUnspentOutput of the UTxO as the chain holds it: [[txId, index], output]. */
const onChainCip30 = ({ nexusRow, outputCbor }: MainnetDatumUtxo): string =>
  `82825820${nexusRow.txHash}${Number(nexusRow.txIndex).toString(16).padStart(2, '0')}${outputCbor}`;

/** What CIP-30 getUtxos hands a dApp for these wallet UTxOs. */
const cip30 = (utxos: Cardano.Utxo[]): string[] =>
  getUtxos(undefined, undefined, utxos, null).map((utxo) => utxo.toCbor());

/** The walletStore round trip: every broadcast and every persisted write is this JSON. */
const throughStore = <T>(value: T): T => JSON.parse(JSON.stringify(value, serializeValue));

describe('convertNexusUtxos: inline datums', () => {
  it.each(INLINE_DATUM_UTXOS.map((f) => [`${f.nexusRow.txHash}#${f.nexusRow.txIndex}`, f] as const))(
    '%s serializes to the output the chain holds',
    (_, fixture) => {
      expect(cip30(convertNexusUtxos([fixture.nexusRow]))).toEqual([onChainCip30(fixture)]);
    },
  );

  it('drops the hash Nexus derives for an inline datum', () => {
    // On chain the output has only the datum. TransactionOutput.fromCore applies datumHash
    // after datum, so a hash left here turns the output into a datum-HASH output.
    for (const fixture of INLINE_DATUM_UTXOS) {
      const [[, txOut]] = convertNexusUtxos([fixture.nexusRow]);
      expect(txOut.datumHash).toBeUndefined();
    }
  });

  it('keeps the original bytes through the walletStore JSON round trip', () => {
    const converted = throughStore(convertNexusUtxos(INLINE_DATUM_UTXOS.map((f) => f.nexusRow)));
    expect(cip30(converted)).toEqual(INLINE_DATUM_UTXOS.map(onChainCip30));
  });

  it('keeps the original bytes through the per-wallet UTxO cache', () => {
    // The set a wallet logs in with, before gero-sync has pushed anything.
    const rows = serializeUtxoRows(convertNexusUtxos(INLINE_DATUM_UTXOS.map((f) => f.nexusRow)), 'spendable');
    expect(cip30(readCachedUtxoRows(structuredClone(rows)).utxos)).toEqual(INLINE_DATUM_UTXOS.map(onChainCip30));
  });

  it('reads the bare hex gero-sync puts on a UTxO it takes from a block', () => {
    // CardanoChainSync.toNexusShapedUtxo: yaci's Utxo carries the inline datum as a hex
    // string, the asset list as {unit, quantity} and no hash.
    const [fixture] = INLINE_DATUM_UTXOS;
    const row = fixture.nexusRow;
    const blockRow = {
      txHash: row.txHash,
      txIndex: row.txIndex,
      address: row.address,
      value: row.value,
      assetList: row.assets.map(({ unit, quantity }) => ({ unit, quantity })),
      datumHash: null,
      inlineDatum: fixture.datumCbor,
      referenceScript: null,
    };
    expect(cip30(convertNexusUtxos([blockRow]))).toEqual([onChainCip30(fixture)]);
  });

  it('reads the { bytes, json } datum of the account endpoint rows', () => {
    const [fixture] = INLINE_DATUM_UTXOS;
    const accountRow = { ...fixture.nexusRow, inlineDatum: { bytes: fixture.datumCbor, json: null } };
    expect(cip30(convertNexusUtxos([accountRow]))).toEqual([onChainCip30(fixture)]);
  });
});

describe('convertNexusUtxos: datum hashes', () => {
  it('keeps a hash-only datum as a hash', () => {
    const [[, txOut]] = convertNexusUtxos([HASH_ONLY_DATUM_UTXO.nexusRow]);
    expect(txOut.datumHash).toBe(HASH_ONLY_DATUM_UTXO.datumHash);
    expect(txOut.datum).toBeUndefined();
  });

  it('serializes a hash-only datum to the output the chain holds', () => {
    const converted = throughStore(convertNexusUtxos([HASH_ONLY_DATUM_UTXO.nexusRow]));
    expect(cip30(converted)).toEqual([onChainCip30(HASH_ONLY_DATUM_UTXO)]);
  });
});
