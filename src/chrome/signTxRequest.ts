import type { Cardano } from '@cardano-sdk/core';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';

/**
 * The transaction a SIGN_TX request asks the worker to sign, parsed from its CBOR and from
 * nothing else. `WalletBg.signTx` signs `transaction.id` and its guards (CIP-113, the market's)
 * read `transaction.body`; both must describe the same bytes, which only holds when the id is
 * the hash of the body just parsed. A request carrying a transaction OBJECT instead (the old
 * `tx` field) would let its sender pick an id that does not belong to its body, so that field is
 * not read: a request without `txCbor` is refused.
 */
export function transactionFromSignRequest(data: unknown): Cardano.Tx {
  const txCbor = (data as { txCbor?: unknown } | null | undefined)?.txCbor;
  if (typeof txCbor !== 'string' || !txCbor) {
    throw new Error('No transaction data provided (txCbor is required)');
  }
  return deserializeCardanoJsSdkTx(txCbor);
}
