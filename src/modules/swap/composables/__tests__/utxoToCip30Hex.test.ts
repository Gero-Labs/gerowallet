import { describe, it, expect } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { utxoToCip30Hex } from '../utxoToCip30Hex';

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
