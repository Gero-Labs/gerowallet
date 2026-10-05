import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { inlineDatumFromCbor } from './utxoCbor';
import { INLINE_DATUM_UTXOS } from './__fixtures__/mainnetDatumUtxos';

describe('inlineDatumFromCbor', () => {
  it('rejects CBOR that is not Plutus data', () => {
    expect(() => inlineDatumFromCbor(HexBlob('f6'))).toThrow();
  });

  it('comes out over its original bytes even through the SDK fromCore', () => {
    // The wallet's serializers do not go this way, but a stored UTxO handed straight to
    // TransactionOutput.fromCore must not be re-encoded or rejected.
    for (const { nexusRow, datumCbor, outputCbor } of INLINE_DATUM_UTXOS) {
      const [asset] = nexusRow.assets;
      const output = Serialization.TransactionOutput.fromCore({
        address: nexusRow.address as Cardano.PaymentAddress,
        value: {
          coins: BigInt(nexusRow.value),
          assets: new Map([[Cardano.AssetId(asset.unit), BigInt(asset.quantity)]]),
        },
        datum: inlineDatumFromCbor(HexBlob(datumCbor)),
      });
      expect(output.toCbor()).toBe(outputCbor);
    }
  });
});
