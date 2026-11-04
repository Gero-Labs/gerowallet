/**
 * The ledger identifiers of a serialized Midnight transaction: what the
 * wallet polls the indexer with when a submit's reply is lost
 * (midnightSubmitRecovery.ts). Identifiers are fixed when the transaction is
 * built and survive proving and binding unchanged, so the identifiers of the
 * signed-but-unproven hex Gero Cloud receives find the proven transaction it
 * submits. Background only (loads the ledger WASM). Best-effort: undefined
 * when the bytes cannot be read, never a failed send.
 */

import { hexToBytes } from './midnightTxBuilder';
import { midnightLedgerVersion } from './midnightLedger';
import { normalizeMidnightTxHash } from './midnightTxHash';

type IdentifiedTx = { identifiers(): string[] };
type Deserialize = { deserialize(s: string, p: string, b: string, raw: Uint8Array): IdentifiedTx };

export async function midnightTxIdentifiers(txHex: string, network: string, proven: boolean): Promise<string[] | undefined> {
  try {
    const ledgerMod = midnightLedgerVersion(network) === 9
      ? await import('@midnightntwrk/ledger-v9')
      : await import('@midnight-ntwrk/ledger-v8');
    const [proof, binding] = proven ? ['proof', 'binding'] : ['pre-proof', 'pre-binding'];
    const tx = (ledgerMod.Transaction as unknown as Deserialize).deserialize('signature', proof, binding, hexToBytes(txHex));
    const ids = tx.identifiers().map(normalizeMidnightTxHash).filter((id) => id.length > 0);
    return ids.length > 0 ? ids : undefined;
  } catch {
    return undefined;
  }
}
