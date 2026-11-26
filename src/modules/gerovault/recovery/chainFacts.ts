/**
 * The chain facts a restore shows (spec 6.8): read from the chain reader for the package's network,
 * never required, never proof. For a native vault, whether value sits at its address and whether
 * the chain ran one of its scripts; for a Plutus vault, the UTxOs at its address for the state token.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import type { VaultChainReader } from '@/modules/gerovault/contracts';
import type { RecoveryChainFacts, RecoveryChainUtxo, VaultNetwork } from '@/shared/gerovault';

/** How many of the address's newest transactions are read for revealed scripts. */
export const REVEALED_SCRIPT_SCAN = 20;

/** The native scripts a transaction's witness set reveals, CBOR hex. Unreadable bytes reveal none. */
export function revealedNativeScripts(txCborHex: string): string[] {
  try {
    const scripts = Serialization.Transaction.fromCbor(HexBlob(txCborHex)).witnessSet().nativeScripts();
    return scripts ? scripts.values().map(s => s.toCbor()) : [];
  } catch {
    return [];
  }
}

/**
 * A native vault's chain facts at `address`: `funded` from its UTxOs, and the scripts revealed by
 * its newest transactions. A read that fails leaves that fact out (shown as unknown), never
 * refuses the restore.
 */
export async function nativeChainFacts(
  reader: VaultChainReader,
  network: VaultNetwork,
  address: string,
  signal?: AbortSignal,
): Promise<RecoveryChainFacts & { readonly read: { readonly utxos: boolean; readonly history: boolean } }> {
  const [utxos, history] = await Promise.allSettled([
    reader.utxos(address, { signal }),
    reader.history(address, { signal, page: 1, pageSize: REVEALED_SCRIPT_SCAN }),
  ]);
  const funded = utxos.status === 'fulfilled' ? utxos.value.length > 0 : undefined;
  let revealedScripts: string[] = [];
  let used: boolean | undefined;
  if (history.status === 'fulfilled') {
    const hashes = history.value.slice(0, REVEALED_SCRIPT_SCAN).map(h => h.txHash);
    if (hashes.length > 0) {
      try {
        const found = await reader.txCbor(hashes);
        revealedScripts = [...found.values()].flatMap(revealedNativeScripts);
      } catch {
        revealedScripts = [];
      }
    } else {
      used = false;
    }
  }
  return {
    network,
    ...(funded !== undefined ? { funded } : {}),
    ...(used !== undefined ? { used } : {}),
    revealedScripts,
    read: { utxos: utxos.status === 'fulfilled', history: history.status === 'fulfilled' },
  };
}

/** UTxOs at a Plutus vault's address in the shape the restore reads for its state token. */
export async function plutusChainUtxos(reader: VaultChainReader, address: string, signal?: AbortSignal): Promise<RecoveryChainUtxo[]> {
  const rows = await reader.utxos(address, { signal });
  return rows.map(([, out]) => ({
    address: out.address,
    assets: [...(out.value.assets ?? new Map<Cardano.AssetId, bigint>())].map(([id, quantity]) => ({
      policyId: Cardano.AssetId.getPolicyId(id),
      assetName: Cardano.AssetId.getAssetName(id),
      quantity,
    })),
  }));
}
