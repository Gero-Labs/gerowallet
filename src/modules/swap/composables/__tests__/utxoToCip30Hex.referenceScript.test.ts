import { describe, expect, it } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { utxoToCip30Hex } from '../utxoToCip30Hex';
import { PREVIEW_NATIVE_AT_LEAST } from '@/shared/utils/__fixtures__/referenceScripts';

const ADDRESS = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj' as Cardano.PaymentAddress;

describe('utxoToCip30Hex with a reference script', () => {
  it("writes Nexus's native reference script into the output (swap signer, Strike deposit)", () => {
    const nexus = { hash: PREVIEW_NATIVE_AT_LEAST.hash, size: PREVIEW_NATIVE_AT_LEAST.bytes.length / 2, type: 'native', bytes: PREVIEW_NATIVE_AT_LEAST.bytes, value: null };
    const utxo: Cardano.Utxo = [
      { txId: 'e2aa6c4bfa99562f0c6219a2dc1bb439a9cfb954113f9dc3bda96fe926771e25' as Cardano.TransactionId, index: 0, address: ADDRESS },
      { address: ADDRESS, value: { coins: 2_000_000n }, scriptReference: nexus as unknown as Cardano.Script },
    ];

    const parsed = Serialization.TransactionUnspentOutput.fromCbor(utxoToCip30Hex(utxo) as never);

    expect(parsed.output().scriptRef()?.hash()).toBe(PREVIEW_NATIVE_AT_LEAST.hash);
    expect(parsed.output().scriptRef()?.toCbor()).toBe(PREVIEW_NATIVE_AT_LEAST.cip33);
  });
});
