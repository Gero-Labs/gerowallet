// The min-UTxO rule of the Gero market, in one place.
//
// The wallet holds a payee output of a buy to `max(due, min-UTxO)` (verifyBuy.ts) and leaves a
// royalty out of a new listing when its output could not hold it (royalties.ts). Both mean the same
// thing by min-UTxO, so both read it here: the ledger's `(160 + serialised size) * coinsPerUtxoByte`
// (Babbage), measured on the CANONICAL encoding of the output with the protocol parameter capped at
// the reviewed ceiling.
//
// Canonical, not the builder's bytes: a datum padded with empty chunks of an indefinite-length byte
// string means the same value, costs thousands of lovelace per byte, and would turn a "min-UTxO
// top-up" into a payment of tens of ADA to a payee. Re-encoding drops the padding, a non-minimal
// integer head and any other non-canonical form. The honest case is unchanged: a seller output with
// a 32-byte tag is 108 bytes, 268 * 4310 = 1,155,080 lovelace. A builder whose encoding is larger
// than canonical is refused by verifyBuy (a false refusal that fails closed).
//
// Capped, never above DEFAULT_COINS_PER_UTXO_BYTE (4310, the value on mainnet, preprod and preview
// since Babbage): a larger figure would make a verifier demand more than the ledger does, so an
// inflated one in the store could talk it into accepting overpayment. A lower figure only makes a
// buy built under the real one fail the check (and, were it signed, the ledger's own rule), which
// is safe.

import { Serialization, type Cardano } from '@cardano-sdk/core';
import { DEFAULT_COINS_PER_UTXO_BYTE } from '@/shared/utils/txIntentGuard';

/** The ledger charges 160 bytes of overhead per output on top of its serialised size (Babbage). */
export const MIN_UTXO_OVERHEAD_BYTES = 160n;

/**
 * The protocol parameter min-UTxO is measured with: the live one, never above the reviewed
 * ceiling, and the ceiling itself when there is none. Null for a figure that cannot be used (not a
 * bigint, zero or negative); the caller decides what that means (verifyBuy refuses, the royalty
 * choice falls back to the ceiling).
 */
export function effectiveCoinsPerUtxoByte(live: bigint | undefined): bigint | null {
  const cpb = live ?? DEFAULT_COINS_PER_UTXO_BYTE;
  if (typeof cpb !== 'bigint' || cpb <= 0n) return null;
  return cpb > DEFAULT_COINS_PER_UTXO_BYTE ? DEFAULT_COINS_PER_UTXO_BYTE : cpb;
}

/**
 * The least ADA `out` may hold: `(160 + size) * coinsPerUtxoByte` over the output's canonical
 * encoding, its coin included. `coinsPerUtxoByte` is the caller's, already through
 * `effectiveCoinsPerUtxoByte`.
 */
export function minUtxoOf(out: Cardano.TxOut, coinsPerUtxoByte: bigint): bigint {
  const canonical = Serialization.TransactionOutput.fromCore(out).toCbor();
  return (MIN_UTXO_OVERHEAD_BYTES + BigInt(canonical.length / 2)) * coinsPerUtxoByte;
}
