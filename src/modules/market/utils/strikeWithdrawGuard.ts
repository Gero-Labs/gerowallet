import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { verifyTxIntent, type TxIntentViolation } from '@/shared/utils/txIntentGuard';

/**
 * A Strike withdraw quote can carry a transaction the user funds: a min-UTxO
 * output at Strike's validator, which Strike submits once the wallet signs it.
 * Strike builds that transaction, so it is checked before signing: one output
 * to the quoted validator (a script address), bounded to a min-UTxO amount and
 * carrying no tokens; every other output back to the wallet; no certificate,
 * withdrawal, mint or collateral; a capped fee.
 *
 * Tolerances: the validator output's exact lovelace (its min-UTxO, up to
 * {@link STRIKE_VALIDATOR_OUTPUT_MAX_LOVELACE}) and its datum, which the wallet
 * has no reviewed schema for; the inputs, which Strike selects (outputs, fee and
 * collateral are bounded, so an input can only add to what returns to the wallet).
 *
 * The validator itself is only known from the quote: the Strike constants in
 * transactionClassifier.ts are the v1 perpetuals contract, used to label
 * history, and nothing ties them to the V2 withdraw validator. Pinning the
 * address and the datum needs Strike's published V2 withdraw validator (script
 * hash per network) and its datum schema, reviewed into a constant here the way
 * DUST_MAPPING_VALIDATOR is.
 */

/** A min-UTxO output with a datum costs about 1-2 ADA; more than this is not a min-UTxO. */
export const STRIKE_VALIDATOR_OUTPUT_MAX_LOVELACE = 5_000_000n;

export type StrikeWithdrawTxViolation = TxIntentViolation | 'validatorNotScript' | 'undecodable';

function isScriptAddress(address: string): boolean {
  try {
    const parsed = Cardano.Address.fromBech32(address.trim());
    const props = parsed.getProps();
    return props.paymentPart?.type === Cardano.CredentialType.ScriptHash;
  } catch {
    return false;
  }
}

/** Every way the quote's transaction departs from a min-UTxO funding of `validatorAddress`; empty when it matches. */
export function verifyStrikeWithdrawTx(
  txCborHex: string,
  expectation: { validatorAddress: string | undefined; ownAddresses: Iterable<string>; ownKeyHashes: Iterable<string> },
): StrikeWithdrawTxViolation[] {
  const { validatorAddress } = expectation;
  if (!validatorAddress || !isScriptAddress(validatorAddress)) return ['validatorNotScript'];
  let tx: Cardano.Tx;
  try {
    tx = Serialization.Transaction.fromCbor(HexBlob(txCborHex)).toCore();
  } catch {
    return ['undecodable'];
  }
  return verifyTxIntent(tx, {
    outputs: [],
    boundedOutputs: [{ address: validatorAddress, maxLovelace: STRIKE_VALIDATOR_OUTPUT_MAX_LOVELACE }],
    ownAddresses: expectation.ownAddresses,
    requiredSigners: expectation.ownKeyHashes,
  });
}
