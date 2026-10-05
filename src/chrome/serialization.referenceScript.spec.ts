import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { getUtxos } from './serialization';
import { MAINNET_PLUTUS_V3, PREVIEW_NATIVE_BEFORE, PREVIEW_PLUTUS_V2 } from '@/shared/utils/__fixtures__/referenceScripts';

const ADDRESS = 'addr_test1qpdmx56dml9qtej5vxhejju492w9pfv7j9270wjh0pfe9hdzqxa4r35qhuqx29n693k4gqukhk3lfw37xkp4egvh6raq4d4rzj' as Cardano.PaymentAddress;

/** A UTxO as the wallet stores it, with whatever it was given as the reference script. */
function storedUtxo(scriptReference: unknown): Cardano.Utxo {
  return [
    { txId: 'e2aa6c4bfa99562f0c6219a2dc1bb439a9cfb954113f9dc3bda96fe926771e25' as Cardano.TransactionId, index: 1, address: ADDRESS },
    { address: ADDRESS, value: { coins: 2_000_000n }, scriptReference: scriptReference as Cardano.Script },
  ];
}

/**
 * CIP-30 getUtxos over a wallet holding a UTxO with a reference script. Wallets store what
 * gero-sync pushed: Nexus's object, or, for block rows, the CIP-33 hex string. Handed either
 * as-is, cardano-js-sdk threw "Unexpected Plutus language version" and the whole call failed.
 */
describe('getUtxos with a reference-script UTxO', () => {
  it("serializes Nexus's reference script as the one on chain", () => {
    const nexus = { hash: PREVIEW_PLUTUS_V2.hash, size: PREVIEW_PLUTUS_V2.size, type: 'plutusV2', bytes: PREVIEW_PLUTUS_V2.bytes, json: null };

    const [utxo] = getUtxos(undefined, undefined, [storedUtxo(nexus)], undefined);

    const scriptRef = utxo.output().scriptRef();
    expect(scriptRef?.hash()).toBe(PREVIEW_PLUTUS_V2.hash);
    // The TxOut carries the CIP-33 script exactly as yaci-store stores it for this output.
    expect(scriptRef?.toCbor()).toBe(PREVIEW_PLUTUS_V2.cip33);
  });

  it("serializes a gero-sync block row's CIP-33 hex string", () => {
    const [utxo] = getUtxos(undefined, undefined, [storedUtxo(MAINNET_PLUTUS_V3.cip33)], undefined);

    expect(utxo.output().scriptRef()?.toCbor()).toBe(MAINNET_PLUTUS_V3.cip33);
  });

  it('still serves the UTxO, without a script, when the script cannot be rebuilt', () => {
    // Koios sends a native script as JSON only; nothing here can vouch for its bytes.
    const koios = { hash: PREVIEW_NATIVE_BEFORE.hash, size: null, type: 'timelock', bytes: null, json: PREVIEW_NATIVE_BEFORE.koiosJson };

    const utxos = getUtxos(undefined, undefined, [storedUtxo(koios)], undefined);

    expect(utxos).toHaveLength(1);
    expect(utxos[0].output().scriptRef()).toBeUndefined();
  });
});
