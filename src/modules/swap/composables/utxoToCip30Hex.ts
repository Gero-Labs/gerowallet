import { Cardano, Serialization } from '@cardano-sdk/core';

/**
 * Serialise a wallet UTxO to a CIP-30 hex TransactionUnspentOutput — the format
 * expected by native-signer / co-signing flows (Strike's POST /v2/deposit/build-tx
 * `utxos` field, and the swap widget's native signer `getUtxos()`). Reconstructs the
 * asset Map first (chrome.storage round-trips Map -> plain object, which fromCore
 * can't read). Mirrors getUtxos() in src/chrome/serialization.ts.
 *
 * Extracted from useStrikeDeposit.ts so both Strike deposit and the native swap
 * signer (useNativeSwapSigner.ts) share a single implementation.
 */
export function utxoToCip30Hex(utxo: Cardano.Utxo): string {
  let value = utxo[1].value;
  if (value?.assets && !(value.assets instanceof Map)) {
    const assetsMap = new Map<Cardano.AssetId, bigint>();
    Object.entries(value.assets as Record<string, unknown>).forEach(([assetId, qty]) => {
      assetsMap.set(assetId as Cardano.AssetId, BigInt(qty as string | number | bigint));
    });
    value = { coins: BigInt(value.coins), assets: assetsMap };
  } else if (value) {
    value = { coins: BigInt(value.coins), assets: value.assets || undefined };
  }
  return String(
    Serialization.TransactionUnspentOutput.fromCore([
      { txId: utxo[0].txId, index: utxo[0].index },
      {
        address: utxo[1].address,
        value,
        datumHash: utxo[1].datumHash,
        datum: utxo[1].datum,
        scriptReference: utxo[1].scriptReference,
      },
    ]).toCbor(),
  );
}
