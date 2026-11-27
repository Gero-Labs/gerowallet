/**
 * Codes of `VaultSpendError`. A screen maps each to text; tests compare them.
 *
 * - `VAULT_INVALID`: the stored record does not give the scripts and keys it claims.
 * - `VAULT_NOT_ACCEPTED`: a candidate vault is never spent from or signed for.
 * - `NETWORK_CLOSED`: the vault's network is not open in this release, or is not the wallet's.
 * - `NOT_AN_OWNER`: this wallet holds no owner key of the vault (a backup holder's path comes later).
 * - `NO_RECIPIENT`, `INVALID_RECIPIENT`, `INVALID_AMOUNT`, `BELOW_MIN_ADA`: the form.
 * - `INSUFFICIENT_FUNDS`: the vault's UTxOs do not cover the outputs and the fee.
 * - `FEE_TOO_HIGH`: the fee would be above the native vault bound.
 * - `PARAMS_UNAVAILABLE`: no protocol parameters or chain tip to build with.
 * - `SOURCE_UNAVAILABLE`: a creating transaction could not be fetched or does not hash to its id.
 * - `BUNDLE_INVALID`, `BUNDLE_OTHER_VAULT`: an unsigned bundle that is malformed or not this vault's.
 * - `WITNESS_INVALID`: a witness file this vault and body cannot accept (`detail` says why).
 * - `NOT_AT_THRESHOLD`: assembly before enough owners signed.
 * - `UNSUPPORTED_WALLET`: this wallet type cannot sign a vault spend yet.
 * - `WRONG_PASSWORD`: the spending password was refused (or is in a back-off wait).
 * - `KEY_MISMATCH`: the key derived at this wallet's index is not the one the vault holds.
 * - `SCRIPT_DATA_MISMATCH`: a DUST operation's redeemers, rebuilt here, do not give the script data
 *   hash the owners signed (or there is no cost model to check it with).
 * - `OPERATION_UNAVAILABLE`: the vault's network has no DUST mapping validator in this release.
 * - `STAKE_ALREADY_REGISTERED`, `STAKE_NOT_REGISTERED`: the stake credential's state on chain does
 *   not allow the operation (registering twice; a DUST registration before the stake one).
 * - `DUST_ALREADY_REGISTERED`: a DUST registration for this stake credential already exists; the
 *   wallet never builds a second one. `DUST_NOT_REGISTERED`: there is none to remove.
 * - `INVALID_DUST_ADDRESS`: not a DUST address of the vault's network.
 * - `NO_COLLATERAL`: the proposer's wallet has no ADA-only UTxO to put up as collateral.
 */
export type VaultSpendErrorCode =
  | 'VAULT_INVALID'
  | 'VAULT_NOT_ACCEPTED'
  | 'NETWORK_CLOSED'
  | 'NOT_AN_OWNER'
  | 'NO_RECIPIENT'
  | 'INVALID_RECIPIENT'
  | 'INVALID_AMOUNT'
  | 'BELOW_MIN_ADA'
  | 'INSUFFICIENT_FUNDS'
  | 'FEE_TOO_HIGH'
  | 'PARAMS_UNAVAILABLE'
  | 'SOURCE_UNAVAILABLE'
  | 'BUNDLE_INVALID'
  | 'BUNDLE_OTHER_VAULT'
  | 'WITNESS_INVALID'
  | 'NOT_AT_THRESHOLD'
  | 'UNSUPPORTED_WALLET'
  | 'WRONG_PASSWORD'
  | 'KEY_MISMATCH'
  | 'SCRIPT_DATA_MISMATCH'
  | 'OPERATION_UNAVAILABLE'
  | 'STAKE_ALREADY_REGISTERED'
  | 'STAKE_NOT_REGISTERED'
  | 'DUST_ALREADY_REGISTERED'
  | 'DUST_NOT_REGISTERED'
  | 'INVALID_DUST_ADDRESS'
  | 'NO_COLLATERAL';

export class VaultSpendError extends Error {
  readonly code: VaultSpendErrorCode;
  /** A machine-readable detail, never text for a user (a field name, a refusal reason, a minimum). */
  readonly detail?: string;

  constructor(code: VaultSpendErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'VaultSpendError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function spendError(code: VaultSpendErrorCode, message: string, detail?: string): never {
  throw new VaultSpendError(code, message, detail);
}
