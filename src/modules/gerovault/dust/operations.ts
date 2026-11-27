/**
 * The stake and DUST operations a native vault signs, each a named shape read from the bytes.
 *
 * - `stake_register`: the Conway registration certificate (with its deposit) of the vault's stake
 *   credential, paid from the vault.
 * - `dust_register`: one mapping token minted under the DUST mapping validator and locked at the
 *   validator with the datum `DustMappingDatum { Script(vault stake credential), DUST address }`,
 *   with a withdrawal from the vault's reward account and collateral from one key-held wallet.
 * - `dust_deregister`: the registration UTxO spent and its token burned, the same withdrawal and
 *   collateral; optionally with the Conway deregistration certificate of the stake credential in
 *   the same transaction, which returns the deposit to the vault.
 * - `stake_deregister`: the Conway deregistration certificate alone, with a withdrawal of any
 *   rewards left.
 *
 * Every operation spends vault inputs only (and, for `dust_deregister`, exactly the registration
 * UTxO), pays everything back to the vault's full address, names no required signers and no
 * reference inputs, and runs no script but the vault's two native scripts and the pinned mapping
 * validator. Anything else that carries a certificate, a withdrawal, a mint, collateral or a script
 * data hash is refused: the sheet names it rather than approximate it.
 *
 * The two DUST operations take collateral from the proposer's own wallet, and every signer's device
 * checks it before any key is opened: exactly one collateral input, not at a script (so never a
 * vault) address, holding ADA only; the total collateral stated and at most the ledger minimum plus
 * 1 ADA; the collateral return to that input's own address. None of the vault's funds are
 * collateral, and the vault pays the fee.
 *
 * Pure: the background imports it.
 */
import type { CertificateView, CollateralView, OutputView, ProvenInputView, VaultTxSummary } from '@/shared/gerovault/decode';
import type { VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import {
  BURN_EX_UNITS,
  BURN_REDEEMER_CBOR,
  CREATE_EX_UNITS,
  CREATE_REDEEMER_CBOR,
  SPEND_EX_UNITS,
  SPEND_REDEEMER_CBOR,
  decodeScriptMappingDatum,
  dustAddressOf,
  mappingValidatorFor,
  MAX_OPERATION_INPUTS,
  type MappingValidator,
} from './mappingValidator';
import { sortedInputIndex, type OperationRedeemer } from './scriptData';

export interface StakeRegisterOperation {
  readonly kind: 'stake_register';
  /** The deposit the certificate states, paid from the vault and returned on deregistration. */
  readonly depositLovelace: bigint;
}

export interface DustRegisterOperation {
  readonly kind: 'dust_register';
  /** The DUST address the datum names, bech32m, never shortened. */
  readonly dustAddress: string;
  readonly dustAddressHex: string;
  /** The registration output's position. */
  readonly registrationOutput: number;
  /** ADA locked with the registration, returned to the vault when it is removed. */
  readonly lockedLovelace: bigint;
  /** The withdrawal from the vault's reward account (its whole balance, zero when it never earned). */
  readonly withdrawalLovelace: bigint;
  readonly collateral: CollateralView;
}

export interface DustDeregisterOperation {
  readonly kind: 'dust_deregister';
  /** The registration UTxO this removes. */
  readonly registration: { readonly txId: string; readonly index: number };
  readonly dustAddress: string;
  readonly dustAddressHex: string;
  /** The ADA the registration held, back to the vault. */
  readonly releasedLovelace: bigint;
  readonly withdrawalLovelace: bigint;
  /** Set when the transaction also deregisters the stake credential: the deposit it returns. */
  readonly stakeRefundLovelace: bigint | null;
  readonly collateral: CollateralView;
}

export interface StakeDeregisterOperation {
  readonly kind: 'stake_deregister';
  readonly refundLovelace: bigint;
  /** Rewards withdrawn in the same transaction; zero when it withdraws none. */
  readonly withdrawalLovelace: bigint;
}

export type VaultOperation = StakeRegisterOperation | DustRegisterOperation | DustDeregisterOperation | StakeDeregisterOperation;
export type VaultOperationKind = VaultOperation['kind'];

/**
 * Why a transaction with operation fields is not one of the operations:
 * - `operation_unknown`: its certificates, withdrawals, mint and collateral make no operation.
 * - `operation_other_credential`: a certificate, withdrawal or registration datum names another credential.
 * - `operation_output`: an output other than change to the vault (and the registration output).
 * - `registration_output_invalid`: the registration output is not exactly the validator's address,
 *   ADA plus the one token, and the datum this wallet writes.
 * - `registration_input_invalid`: the spent registration is not one with this vault's credential.
 * - `operation_other_script`: the body spends from, mints under or withdraws for a script other than
 *   the vault's two native scripts and the pinned mapping validator.
 * - `collateral_shape`: a Plutus operation without collateral or with more than one collateral input,
 *   collateral on an operation that runs no script, or no collateral percentage to check it with.
 * - `collateral_at_vault`: a collateral input sits at a script address, a vault's included.
 * - `collateral_not_ada`: a collateral input holds anything but ADA.
 * - `collateral_total_missing`: the body states no total collateral (key 17).
 * - `collateral_total_too_high`: the total collateral is above the ledger minimum plus 1 ADA.
 * - `collateral_return_elsewhere`: there is no collateral return, or it pays another address than the
 *   collateral input's own.
 * - `script_data_hash_shape`: a Plutus operation without the script data hash, or one where no script runs.
 * - `operation_unavailable`: the vault's network has no mapping validator in this release.
 */
export type OperationRefusalCode =
  | 'operation_unknown'
  | 'operation_other_credential'
  | 'operation_other_script'
  | 'operation_output'
  | 'registration_output_invalid'
  | 'registration_input_invalid'
  | 'collateral_shape'
  | 'collateral_at_vault'
  | 'collateral_not_ada'
  | 'collateral_total_missing'
  | 'collateral_total_too_high'
  | 'collateral_return_elsewhere'
  | 'script_data_hash_shape'
  | 'operation_unavailable';

/** A collateral above the ledger minimum by more than this is refused. */
export const COLLATERAL_TOLERANCE_LOVELACE = 1_000_000n;

/** The ledger's minimum total collateral: the fee times the collateral percentage, rounded up. */
export function ledgerMinimumCollateral(fee: bigint, collateralPercentage: number): bigint {
  return (fee * BigInt(collateralPercentage) + 99n) / 100n;
}

export interface ReadOperationOptions {
  /** The protocol's collateral percentage. Without it a Plutus operation is refused. */
  readonly collateralPercentage?: number;
}

export interface OperationRefusal {
  readonly code: OperationRefusalCode;
  readonly path: string;
  readonly detail?: string;
}

export type OperationReading =
  | { readonly status: 'operation'; readonly operation: VaultOperation }
  | { readonly status: 'refused'; readonly refusals: readonly OperationRefusal[] };

/** Whether a summary carries any field only an operation may: certificates, withdrawals, mint, collateral, a script data hash. */
export function hasOperationFields(summary: VaultTxSummary): boolean {
  return summary.certificates.length > 0
    || summary.withdrawals.length > 0
    || summary.mint.length > 0
    || summary.collateral !== null
    || summary.scriptDataHash !== null;
}

const isVaultStake = (credential: { kind: string; hash: string }, context: VaultSpendContext) =>
  credential.kind === 'script' && credential.hash === context.stakeScriptHash;

function isRegistrationToken(output: OutputView, validator: MappingValidator): boolean {
  const tokens = output.value.tokens;
  return tokens.length === 1 && tokens[0].policyId === validator.scriptHash && tokens[0].assetNameHex === '' && tokens[0].quantity === 1n;
}

/**
 * Reads the operation a summary is, against this device's vault record. Inputs, outputs and the
 * expiry are the sheet's own rules (`review.ts`); here are the rules of each operation's fields.
 */
export function readOperation(summary: VaultTxSummary, context: VaultSpendContext, options: ReadOperationOptions = {}): OperationReading {
  const refusals: OperationRefusal[] = [];
  const refuse = (code: OperationRefusalCode, path: string, detail?: string) => refusals.push(detail === undefined ? { code, path } : { code, path, detail });
  const done = (operation: VaultOperation): OperationReading => (refusals.length > 0 ? { status: 'refused', refusals } : { status: 'operation', operation });

  // The scripts the body runs: the vault's payment and stake scripts, and the pinned validator only.
  const pinned = mappingValidatorFor(context.network);
  const allowed = new Set([context.paymentScriptHash, context.stakeScriptHash, ...(pinned ? [pinned.scriptHash] : [])]);
  summary.inputs.forEach((input, i) => {
    const payment = input.output.address.payment;
    if (payment.kind === 'script' && !allowed.has(payment.hash)) refuse('operation_other_script', `body.0[${i}]`);
  });
  summary.mint.forEach((token, i) => { if (!allowed.has(token.policyId)) refuse('operation_other_script', `body.9[${i}]`); });
  summary.withdrawals.forEach((withdrawal, i) => {
    const credential = withdrawal.rewardAccount.credential;
    if (credential.kind === 'script' && !allowed.has(credential.hash)) refuse('operation_other_script', `body.5[${i}]`);
  });
  summary.certificates.forEach((cert, i) => {
    if (cert.credential.kind === 'script' && !allowed.has(cert.credential.hash)) refuse('operation_other_script', `body.4[${i}]`);
  });

  const certificates = summary.certificates;
  certificates.forEach((cert: CertificateView, i) => {
    if (!isVaultStake(cert.credential, context)) refuse('operation_other_credential', `body.4[${i}]`);
  });
  summary.withdrawals.forEach((withdrawal, i) => {
    if (!isVaultStake(withdrawal.rewardAccount.credential, context)) refuse('operation_other_credential', `body.5[${i}]`);
  });
  if (summary.withdrawals.length > 1) refuse('operation_unknown', 'body.5', 'withdrawals');
  if (refusals.length > 0) return { status: 'refused', refusals };
  const withdrawal = summary.withdrawals[0]?.lovelace ?? null;

  const conway = (kind: CertificateView['kind']) => certificates.length === 1 && certificates[0].kind === kind && 'form' in certificates[0] && certificates[0].form === 'conway';
  const registers = conway('stake_registration');
  const deregisters = conway('stake_deregistration');
  if (certificates.length > 0 && !registers && !deregisters) return { status: 'refused', refusals: [{ code: 'operation_unknown', path: 'body.4', detail: 'certificates' }] };

  const minted = summary.mint;
  const plutus = minted.length > 0;
  if (!plutus) {
    if (summary.collateral) refuse('collateral_shape', 'body.13', 'no_script');
    if (summary.scriptDataHash !== null) refuse('script_data_hash_shape', 'body.11', 'no_script');
    if (refusals.length > 0) return { status: 'refused', refusals };
    if (registers && withdrawal === null) {
      const cert = certificates[0] as Extract<CertificateView, { kind: 'stake_registration' }>;
      return done({ kind: 'stake_register', depositLovelace: cert.deposit.lovelace });
    }
    if (deregisters) {
      const cert = certificates[0] as Extract<CertificateView, { kind: 'stake_deregistration' }>;
      return done({ kind: 'stake_deregister', refundLovelace: cert.refund.lovelace, withdrawalLovelace: withdrawal ?? 0n });
    }
    return { status: 'refused', refusals: [{ code: 'operation_unknown', path: 'body', detail: 'shape' }] };
  }

  // A mint: only the mapping validator's token, one at a time.
  const validator = mappingValidatorFor(context.network);
  if (!validator) return { status: 'refused', refusals: [{ code: 'operation_unavailable', path: 'body.9' }] };
  const token = minted.length === 1 && minted[0].policyId === validator.scriptHash && minted[0].assetNameHex === '' ? minted[0].quantity : 0n;
  if (token !== 1n && token !== -1n) return { status: 'refused', refusals: [{ code: 'operation_unknown', path: 'body.9', detail: 'mint' }] };
  if (withdrawal === null) refuse('operation_unknown', 'body.5', 'no_withdrawal');
  // The validator's cost grows with the inputs; past this the declared budgets may not cover it.
  if (summary.inputs.length > MAX_OPERATION_INPUTS + 1) refuse('operation_unknown', 'body.0', 'too_many_inputs');
  if (summary.scriptDataHash === null) refuse('script_data_hash_shape', 'body.11', 'missing');
  // Collateral: exactly one ADA-only input of a key-held wallet, the total stated and at most the
  // ledger minimum plus 1 ADA, the return to that input's own address.
  const collateral = summary.collateral;
  if (!collateral) refuse('collateral_shape', 'body.13', 'missing');
  else {
    if (collateral.inputs.length !== 1) refuse('collateral_shape', 'body.13', 'inputs');
    if (collateral.inputs.some(input => input.output.address.payment.kind === 'script')) refuse('collateral_at_vault', 'body.13');
    if (collateral.inputs.some(input => input.output.value.tokens.length > 0)) refuse('collateral_not_ada', 'body.13');
    const total = collateral.totalCollateral;
    if (total === null) refuse('collateral_total_missing', 'body.17');
    else if (!Number.isSafeInteger(options.collateralPercentage) || (options.collateralPercentage ?? 0) <= 0) refuse('collateral_shape', 'body.17', 'parameters_unknown');
    else if (total > ledgerMinimumCollateral(summary.fee, options.collateralPercentage!) + COLLATERAL_TOLERANCE_LOVELACE) refuse('collateral_total_too_high', 'body.17');
    const back = collateral.collateralReturn;
    if (!back || collateral.inputs.length === 0 || back.address.hex !== collateral.inputs[0].output.address.hex) refuse('collateral_return_elsewhere', 'body.16');
  }
  if (token === 1n && certificates.length > 0) refuse('operation_unknown', 'body.4', 'certificates');
  if (token === -1n && registers) refuse('operation_unknown', 'body.4', 'certificates');
  if (refusals.length > 0 || !collateral || withdrawal === null) return { status: 'refused', refusals };

  if (token === 1n) {
    const atValidator = summary.outputs.map((output, index) => ({ output, index })).filter(({ output }) => output.address.payment.kind === 'script' && output.address.payment.hash === validator.scriptHash);
    const registration = atValidator.length === 1 ? atValidator[0] : undefined;
    const datum = registration?.output.datum?.kind === 'inline' ? decodeScriptMappingDatum(registration.output.datum.cborHex) : null;
    if (!registration || registration.output.address.hex !== validator.addressHex || !isRegistrationToken(registration.output, validator)
      || registration.output.referenceScript !== null || !datum) {
      return { status: 'refused', refusals: [{ code: 'registration_output_invalid', path: registration ? `body.1[${registration.index}]` : 'body.1' }] };
    }
    if (datum.scriptHash !== context.stakeScriptHash) return { status: 'refused', refusals: [{ code: 'operation_other_credential', path: `body.1[${registration.index}].datum` }] };
    return done({
      kind: 'dust_register',
      dustAddress: dustAddressOf(context.network, datum.dustAddressHex),
      dustAddressHex: datum.dustAddressHex,
      registrationOutput: registration.index,
      lockedLovelace: registration.output.value.lovelace,
      withdrawalLovelace: withdrawal,
      collateral,
    });
  }

  const spent = summary.inputs.filter((input: ProvenInputView) => input.output.address.payment.kind === 'script' && input.output.address.payment.hash === validator.scriptHash);
  const registration = spent.length === 1 ? spent[0] : undefined;
  const datum = registration?.output.datum?.kind === 'inline' ? decodeScriptMappingDatum(registration.output.datum.cborHex) : null;
  if (!registration || registration.output.address.hex !== validator.addressHex || !isRegistrationToken(registration.output, validator) || !datum) {
    return { status: 'refused', refusals: [{ code: 'registration_input_invalid', path: 'body.0' }] };
  }
  if (datum.scriptHash !== context.stakeScriptHash) return { status: 'refused', refusals: [{ code: 'operation_other_credential', path: 'body.0', detail: 'registration' }] };
  const refund = deregisters ? (certificates[0] as Extract<CertificateView, { kind: 'stake_deregistration' }>).refund.lovelace : null;
  return done({
    kind: 'dust_deregister',
    registration: { txId: registration.txId, index: registration.index },
    dustAddress: dustAddressOf(context.network, datum.dustAddressHex),
    dustAddressHex: datum.dustAddressHex,
    releasedLovelace: registration.output.value.lovelace,
    withdrawalLovelace: withdrawal,
    stakeRefundLovelace: refund,
    collateral,
  });
}

/** Whether an input is the one an operation may spend besides the vault's own. */
export function isOperationInput(operation: VaultOperation | undefined, input: Pick<ProvenInputView, 'txId' | 'index'>): boolean {
  return operation?.kind === 'dust_deregister' && operation.registration.txId === input.txId && operation.registration.index === input.index;
}

/** Whether an output is the one an operation may make besides change to the vault. */
export function isOperationOutput(operation: VaultOperation | undefined, index: number): boolean {
  return operation?.kind === 'dust_register' && operation.registrationOutput === index;
}

/** What the witness set must carry beyond the owners' payment signatures. */
export interface WitnessPlan {
  /** Each signer also signs with their stake key (a separate stake script). */
  readonly stake: boolean;
  /** The stake script goes in the witness set. */
  readonly stakeScript: boolean;
  /** The mapping validator and its redeemers go in the witness set. */
  readonly plutus: boolean;
  /** The key hash that holds the collateral: its signature goes in too. */
  readonly collateralPayer: string | null;
}

/** A plain spend: payment signatures and the payment script only. */
export const PLAIN_SPEND_PLAN: WitnessPlan = Object.freeze({ stake: false, stakeScript: false, plutus: false, collateralPayer: null });

/** The witness plan of an operation on this vault. Every operation needs the stake credential's authority. */
export function witnessPlanOf(operation: VaultOperation | undefined, context: Pick<VaultSpendContext, 'sharedStakeCredential'>): WitnessPlan {
  if (!operation) return PLAIN_SPEND_PLAN;
  const plutus = operation.kind === 'dust_register' || operation.kind === 'dust_deregister';
  return Object.freeze({
    stake: !context.sharedStakeCredential,
    stakeScript: !context.sharedStakeCredential,
    plutus,
    collateralPayer: plutus ? operation.collateral.payer.hash : null,
  });
}

/** The redeemers of an operation, from the body's own inputs. Empty for an operation that runs no script. */
export function operationRedeemers(operation: VaultOperation | undefined, inputs: readonly { readonly txId: string; readonly index: number }[]): OperationRedeemer[] {
  if (operation?.kind === 'dust_register') return [{ purpose: 'mint', index: 0, dataCbor: CREATE_REDEEMER_CBOR, exUnits: CREATE_EX_UNITS }];
  if (operation?.kind === 'dust_deregister') {
    const index = sortedInputIndex(inputs, operation.registration.txId, operation.registration.index);
    return [
      { purpose: 'spend', index, dataCbor: SPEND_REDEEMER_CBOR, exUnits: SPEND_EX_UNITS },
      { purpose: 'mint', index: 0, dataCbor: BURN_REDEEMER_CBOR, exUnits: BURN_EX_UNITS },
    ];
  }
  return [];
}
