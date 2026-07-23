import { Cardano } from '@cardano-sdk/core';

/**
 * Throw if `tx` violates any POOL_REGISTRATION_AS_OWNER rule the Ledger app
 * enforces (ledgerjs `.../parsing/transaction.js:301-321`), so we fail in JS
 * before the device rejects it.
 *
 * `Cardano.TxIn` (the type of `tx.body.inputs`) only carries `{ txId, index }`
 * — inputs reference UTxOs and are resolved separately, they don't carry an
 * `address` field. So the caller must resolve each input to its bech32
 * address (e.g. via the wallet's UTxO set) and pass them as `inputAddresses`,
 * in the same order as `tx.body.inputs`.
 *
 * `ledgerAddresses` = the wallet's own (Ledger/device-owned) bech32
 * addresses; none of them may appear as an input or output.
 */
export function assertOwnerModeShape(
  tx: Cardano.Tx,
  ledgerAddresses: Set<string>,
  inputAddresses: string[],
): void {
  const certs = tx.body.certificates ?? [];
  if (certs.length !== 1) throw new Error('owner-mode/multiple-certs');
  if (certs[0].__typename !== Cardano.CertificateType.PoolRegistration) {
    throw new Error('owner-mode/not-pool-reg');
  }

  for (const address of inputAddresses) {
    if (ledgerAddresses.has(address)) throw new Error('owner-mode/device-input');
  }
  for (const out of tx.body.outputs) {
    if (ledgerAddresses.has(out.address as unknown as string)) throw new Error('owner-mode/device-output');
  }
  if (tx.body.withdrawals && tx.body.withdrawals.length > 0) throw new Error('owner-mode/withdrawals');
  if (tx.body.mint && tx.body.mint.size > 0) throw new Error('owner-mode/mint');
}
