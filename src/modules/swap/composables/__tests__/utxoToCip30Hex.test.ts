import { describe, it, expect } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { utxoToCip30Hex } from '../utxoToCip30Hex';
import { convertNexusUtxos } from '@/services/nexusUtxo';
import {
  HASH_ONLY_DATUM_UTXO,
  INLINE_DATUM_UTXOS,
  type MainnetDatumUtxo,
} from '@/shared/utils/__fixtures__/mainnetDatumUtxos';

/** The CIP-30 TransactionUnspentOutput of the UTxO as the chain holds it: [[txId, index], output]. */
const onChainCip30 = ({ nexusRow, outputCbor }: MainnetDatumUtxo): string =>
  `82825820${nexusRow.txHash}${Number(nexusRow.txIndex).toString(16).padStart(2, '0')}${outputCbor}`;

describe('utxoToCip30Hex: datums', () => {
  it('writes an inline datum inline, over its original bytes', () => {
    const utxos = convertNexusUtxos(INLINE_DATUM_UTXOS.map((f) => f.nexusRow));
    expect(utxos.map(utxoToCip30Hex)).toEqual(INLINE_DATUM_UTXOS.map(onChainCip30));
  });

  it('ignores the hash stored beside an inline datum by earlier versions', () => {
    const [fixture] = INLINE_DATUM_UTXOS;
    const [[txIn, txOut]] = convertNexusUtxos([fixture.nexusRow]);
    const storedBeforeFix: Cardano.Utxo = [
      txIn,
      { ...txOut, datum: fixture.nexusRow.inlineDatum as unknown as Cardano.PlutusData, datumHash: fixture.datumHash as Cardano.DatumHash },
    ];
    expect(utxoToCip30Hex(storedBeforeFix)).toBe(onChainCip30(fixture));
  });

  it('keeps a hash-only datum as a hash', () => {
    const [utxo] = convertNexusUtxos([HASH_ONLY_DATUM_UTXO.nexusRow]);
    expect(utxoToCip30Hex(utxo)).toBe(onChainCip30(HASH_ONLY_DATUM_UTXO));
  });
});

describe('utxoToCip30Hex', () => {
  it('round-trips a minimal Cardano.Utxo to a non-empty cbor hex string', () => {
    const address = 'addr_test1qpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5ewvxwdrt70qlcpeeagscasafhffqsxy36t90ldv06wqrk2qum8x5w' as Cardano.PaymentAddress;
    const utxo: Cardano.Utxo = [
      { txId: '0'.repeat(64) as Cardano.TransactionId, index: 0, address },
      {
        address,
        value: { coins: 5_000_000n },
      },
    ];

    const hex = utxoToCip30Hex(utxo);

    expect(typeof hex).toBe('string');
    expect(hex.length).toBeGreaterThan(0);
    // Must round-trip back into a valid TransactionUnspentOutput.
    const parsed = Serialization.TransactionUnspentOutput.fromCbor(hex as never);
    expect(parsed.input().index()).toBe(0n);
  });

  it('reconstructs a plain-object assets map (post chrome.storage round-trip) into a Map', () => {
    const assetId = 'a'.repeat(56) + 'b'.repeat(8);
    const address = 'addr_test1qpu5vlrf4xkxv2qpwngf6cjhtw542ayty80v8dyr49rf5ewvxwdrt70qlcpeeagscasafhffqsxy36t90ldv06wqrk2qum8x5w' as Cardano.PaymentAddress;
    const utxo: Cardano.Utxo = [
      { txId: '1'.repeat(64) as Cardano.TransactionId, index: 1, address },
      {
        address,
        value: { coins: 2_000_000n, assets: { [assetId]: '42' } } as never,
      },
    ];

    const hex = utxoToCip30Hex(utxo);

    expect(typeof hex).toBe('string');
    expect(hex.length).toBeGreaterThan(0);
  });
});
