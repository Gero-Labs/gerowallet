import { Cardano } from '@cardano-sdk/core';
import { toTransactionUnspentOutput } from '@/shared/utils/utxoCbor';

/**
 * Serialise a wallet UTxO to a CIP-30 hex TransactionUnspentOutput — the format
 * expected by native-signer / co-signing flows (Strike's POST /v2/deposit/build-tx
 * `utxos` field, and the swap widget's native signer `getUtxos()`). Same serializer as
 * getUtxos() in src/chrome/serialization.ts: it rebuilds the asset Map (chrome.storage
 * round-trips Map -> plain object, which fromCore can't read) and writes the datum as
 * the chain holds it.
 *
 * Extracted from useStrikeDeposit.ts so both Strike deposit and the native swap
 * signer (useNativeSwapSigner.ts) share a single implementation.
 */
export function utxoToCip30Hex(utxo: Cardano.Utxo): string {
  return String(toTransactionUnspentOutput(utxo).toCbor());
}
