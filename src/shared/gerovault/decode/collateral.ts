import { sameCredential, type CredentialView } from './address';
import type { DecodeContext } from './context';
import type { ProvenInputView } from './inputs';
import type { OutputView } from './outputs';
import { ValueSum } from './value';

/**
 * Collateral (body keys 13, 16 and 17), modelled as what one wallet can lose: if a script
 * fails, the ledger keeps the collateral inputs less the collateral return, and nothing else
 * happens. The inputs' values are proven like any other input.
 *
 * Rules, each a refusal:
 * - every collateral input is locked by one and the same payment key (`collateral_input_script_locked`,
 *   `collateral_multiple_payers`): that key's wallet is the one at risk;
 * - only lovelace can be lost (`collateral_loss_not_ada`): any token in the inputs must come back
 *   in a return that pays that same payment key;
 * - a return or a total needs inputs, the return cannot exceed them, and a stated total must be
 *   exactly what the inputs less the return give (`collateral_inconsistent`).
 *
 * `maxLossLovelace` is the most the payer's wallet can lose: what the ledger keeps, plus the
 * return itself when the return pays someone else.
 */

export interface CollateralView {
  inputs: ProvenInputView[];
  /** The payment key every collateral input is locked by: the wallet the collateral comes from. */
  payer: CredentialView;
  collateralReturn: OutputView | null;
  /** Total collateral as the body states it (key 17), or null when it does not. */
  totalCollateral: bigint | null;
  /** Lovelace the ledger keeps if a script fails: the collateral inputs less the return. */
  forfeitLovelace: bigint;
  /** Whether the return's payment credential is the payer's. */
  returnPaysPayer: boolean;
  /** At most this much lovelace leaves the payer's wallet if a script fails. */
  maxLossLovelace: bigint;
}

export interface CollateralFields {
  inputs: ProvenInputView[];
  collateralReturn: OutputView | null;
  totalCollateral: bigint | null;
  /** Paths of the three fields, for refusals. */
  paths: { inputs: string; collateralReturn: string; totalCollateral: string };
}

/** The collateral view, or null when the body has no collateral field. Refusals go to `ctx`. */
export function collateralView(fields: CollateralFields, ctx: DecodeContext): CollateralView | null {
  const { inputs, collateralReturn, totalCollateral, paths } = fields;
  if (inputs.length === 0) {
    if (collateralReturn) ctx.refusals.add('collateral_inconsistent', paths.collateralReturn, 'return_without_inputs');
    if (totalCollateral !== null) ctx.refusals.add('collateral_inconsistent', paths.totalCollateral, 'total_without_inputs');
    return null;
  }

  let payer: CredentialView | null = null;
  let refused = false;
  inputs.forEach((input, i) => {
    const credential = input.output.address.payment;
    if (credential.kind === 'script') {
      ctx.refusals.add('collateral_input_script_locked', `${paths.inputs}[${i}]`);
      refused = true;
    } else if (payer && !sameCredential(payer, credential)) {
      ctx.refusals.add('collateral_multiple_payers', `${paths.inputs}[${i}]`);
      refused = true;
    } else {
      payer = credential;
    }
  });
  if (refused || !payer) return null;
  const payerCredential: CredentialView = payer;

  // What the ledger keeps: the inputs less the return, per asset.
  const kept = new ValueSum();
  for (const input of inputs) kept.add(input.output.value);
  if (collateralReturn) kept.add(collateralReturn.value, -1n);
  const returnPaysPayer = !!collateralReturn && sameCredential(collateralReturn.address.payment, payerCredential);

  if (kept.lovelace() < 0n || kept.nonZeroTokens().some((unit) => kept.quantity(unit) < 0n)) {
    ctx.refusals.add('collateral_inconsistent', paths.collateralReturn, 'return_exceeds_inputs');
    return null;
  }
  if (kept.nonZeroTokens().length > 0 || (collateralReturn && !returnPaysPayer && collateralReturn.value.tokens.length > 0)) {
    ctx.refusals.add('collateral_loss_not_ada', paths.inputs);
    return null;
  }
  const forfeitLovelace = kept.lovelace();
  if (totalCollateral !== null && totalCollateral !== forfeitLovelace) {
    ctx.refusals.add('collateral_inconsistent', paths.totalCollateral, 'total_mismatch');
    return null;
  }
  const maxLossLovelace = forfeitLovelace + (collateralReturn && !returnPaysPayer ? collateralReturn.value.lovelace : 0n);
  return {
    inputs,
    payer: payerCredential,
    collateralReturn,
    totalCollateral,
    forfeitLovelace,
    returnPaysPayer,
    maxLossLovelace,
  };
}
