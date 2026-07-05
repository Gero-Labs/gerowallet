// src/services/agent/decodeSwapTx.ts
import type { DecodedTx, DecodedOutput } from './swapGuardrail';

/**
 * Minimal structural type for the Cardano.Tx shape we rely on.
 *
 * Verified against src/popup/modules/views/SignTx.vue and
 * src/chrome/cardanoJsSdkCbor.ts (deserializeCardanoJsSdkTx -> Serialization.Transaction.toCore()):
 *   - output.address  : string (already bech32; used directly in Set.has() in SignTx.vue line 346)
 *   - output.value.coins : bigint (lovelace)
 *   - output.value.assets: Map<string, bigint> where each key is the concatenated
 *     policyId+assetNameHex string (Cardano.AssetId branded type, NO dot separator).
 *     Confirmed by serialization.ts line 72: Cardano.AssetId(amt.unit).
 */
interface CardanoTxLike {
  body: {
    outputs: Array<{
      address: string;
      value: { coins: bigint; assets?: Map<string, bigint> };
    }>;
  };
}

/**
 * Map a deserialized Cardano.Tx to the Guardrail's DecodedTx.
 *
 * @param tx - Already-deserialized Cardano.Tx (caller runs deserializeCardanoJsSdkTx).
 *   Kept separate so this stays a pure, unit-testable function with no SDK import.
 * @param splitAssetId - Converts a concatenated AssetId (policyId+assetNameHex, 56+ chars)
 *   into the `${policyId}.${assetName}` dot-key format the Guardrail expects.
 *   Default splits at position 56 (standard 28-byte policyId = 56 hex chars).
 */
export function toDecodedTx(
  tx: CardanoTxLike,
  splitAssetId: (assetId: string) => string = (id) => `${id.slice(0, 56)}.${id.slice(56)}`,
): DecodedTx {
  const outputs: DecodedOutput[] = tx.body.outputs.map((o) => {
    const assets: Record<string, bigint> = {};
    if (o.value.assets) {
      for (const [assetId, qty] of o.value.assets.entries()) {
        assets[splitAssetId(assetId)] = qty;
      }
    }
    return { address: o.address, lovelace: o.value.coins, assets };
  });
  return { outputs };
}
