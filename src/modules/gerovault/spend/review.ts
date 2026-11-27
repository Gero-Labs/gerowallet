/**
 * The approval sheet's content, computed on this device from the body and from inputs proven by
 * hash, never from a server's word.
 *
 * First the shared decoder (`decodeVaultTransaction`) reads every field of the body, proves each
 * input from the bundle's creating transactions (offline) and refuses what it cannot render. Then
 * the rules of a phase 1 vault spend apply, each compared with values read from this device's own
 * vault record:
 *
 * - every input is locked by the vault's payment script;
 * - the transaction is a plain spend, or exactly one of the stake and DUST operations of
 *   `dust/operations.ts`: certificates, withdrawals, a mint, collateral and a script data hash are
 *   read only as such an operation, and refused in any other shape; reference inputs and required
 *   signers are always refused;
 * - an operation pays nothing out: every output is change to the vault, except the registration
 *   output of a DUST registration, and the only input that is not the vault's is the registration
 *   a DUST deregistration removes;
 * - change is only an output to the vault's full address, as derived here, and it carries no
 *   datum and no reference script; the same holds for an output to another vault this wallet has
 *   accepted, shown as moving to that vault;
 * - an output to the vault's payment script under another stake key is shown as leaving the vault;
 * - the fee is at most the native bound (the decoder refuses above it), with a warning above
 *   the warning level;
 * - the transaction expires, not after seven days from now, and has not expired yet;
 * - a validity start, when there is one, is not ahead of the tip by more than a small tolerance and
 *   not further back than the expiry window: the sheet shows it.
 *
 * The result is either a complete review or every refusal found: never a partial sheet.
 */
import { decodeVaultTransaction } from '@/shared/gerovault/decode';
import type { OutputView, Refusal, RefusalCode, TokenAmount, ValueView, VaultTxSummary } from '@/shared/gerovault/decode';
import type { UnsignedTxBundle, VaultRecord } from '@/modules/gerovault/contracts';
import { mappingValidatorFor } from '@/modules/gerovault/dust/mappingValidator';
import {
  hasOperationFields,
  isOperationInput,
  isOperationOutput,
  readOperation,
  type OperationRefusalCode,
  type VaultOperation,
} from '@/modules/gerovault/dust/operations';
import { MAX_VALIDITY_SLOTS, NATIVE_FEE_MAX_LOVELACE, NATIVE_FEE_WARN_LOVELACE, VALIDITY_START_TOLERANCE_SLOTS } from './constants';
import { bundleTxSource, unsignedTransaction } from './bundle';
import { vaultBaseAddress, type VaultSpendContext } from './vaultSpendContext';

/** Refusals of the vault rules, added to the decoder's own. */
export type VaultSpendRefusalCode =
  /** The bundle names another vault, or another network. */
  | 'bundle_other_vault'
  /** An input is not locked by this vault's payment script. */
  | 'input_not_vault'
  /** Reference inputs or required signers: neither a plain spend nor an operation. */
  | 'not_a_plain_spend'
  /** Change to the vault (or an output to another accepted vault) that carries a datum. */
  | 'vault_output_datum'
  /** Change to the vault (or an output to another accepted vault) that carries a reference script. */
  | 'vault_output_script'
  /** The transaction has no expiry slot. */
  | 'no_expiry'
  /** Its expiry slot is already past. */
  | 'expired'
  /** Its expiry slot is more than seven days ahead. */
  | 'expiry_too_far'
  /** Its validity start is ahead of the tip by more than the tolerance. */
  | 'validity_start_future'
  /** Its validity start is further back than the expiry window. */
  | 'validity_start_too_old';

export type SpendRefusalCode = RefusalCode | VaultSpendRefusalCode | OperationRefusalCode;

export interface SpendRefusal {
  readonly code: SpendRefusalCode;
  readonly path: string;
  readonly detail?: string;
}

/** Warnings the sheet shows next to what they are about. They never block signing. */
export type SpendWarningCode =
  /** The fee is above the warning level. */
  | 'fee_high'
  /** An output goes to the vault's payment script under someone else's stake key. */
  | 'vault_script_other_stake'
  /** An external output carries a datum. */
  | 'output_datum'
  /** An external output carries a reference script. */
  | 'output_script';

export interface SpendWarning {
  readonly code: SpendWarningCode;
  /** The output it is about, by index, when it is about one. */
  readonly output?: number;
}

/**
 * - `external`: leaves the vault, to the full address shown.
 * - `vault_script_other_stake`: the vault's payment script with another stake key; it leaves the vault.
 * - `other_vault`: another vault this wallet has accepted; it leaves this vault too.
 * - `change`: back to this vault's full address.
 * - `dust_registration`: the DUST registration output, locked at the mapping validator until the
 *   registration is removed.
 */
export type ReviewOutputKind = 'external' | 'vault_script_other_stake' | 'other_vault' | 'change' | 'dust_registration';

export interface ReviewOutput {
  readonly index: number;
  readonly kind: ReviewOutputKind;
  /** The complete bech32 address. Never shortened. */
  readonly address: string;
  readonly value: ValueView;
  /** For `other_vault`: that vault's id and local name. */
  readonly vault?: { readonly vaultId: string; readonly name?: string };
  readonly hasDatum: boolean;
  readonly hasReferenceScript: boolean;
}

export interface SpendReviewReady {
  readonly status: 'ready';
  readonly txId: string;
  /** Inputs proven from their creating transactions; every input is. */
  readonly inputCount: number;
  readonly outputs: readonly ReviewOutput[];
  /** What leaves the vault: every non-change output plus the fee. */
  readonly leaves: ValueView;
  /** What returns to the vault's full address. */
  readonly change: ValueView;
  readonly fee: bigint;
  readonly invalidHereafter: number;
  readonly invalidBefore: number | null;
  readonly warnings: readonly SpendWarning[];
  readonly summary: VaultTxSummary;
  /** The stake or DUST operation this is; absent for a plain spend. */
  readonly operation?: VaultOperation;
}

export interface SpendReviewRefused {
  readonly status: 'refused';
  readonly txId: string | null;
  readonly refusals: readonly SpendRefusal[];
}

export type SpendReview = SpendReviewReady | SpendReviewRefused;

/** Another vault this wallet has accepted, for "moves to vault X". */
export interface KnownVault {
  readonly vaultId: string;
  readonly name?: string;
  /** Its full address, raw bytes as lowercase hex. */
  readonly baseAddressHex: string;
}

/** The other accepted vaults of `records`, as the sheet names them: every one but `vaultId`. */
export function knownVaultsOf(records: readonly VaultRecord[], vaultId: string): KnownVault[] {
  return records
    .filter(other => other.vaultId !== vaultId && other.status === 'accepted')
    .map(other => ({
      vaultId: other.vaultId,
      ...(other.name !== undefined ? { name: other.name } : {}),
      baseAddressHex: vaultBaseAddress(other.network, other.paymentScriptHash, other.stakeScriptHash).hex,
    }));
}

export interface ReviewOptions {
  /** The current slot (the wallet's chain tip). Null when unknown: the sheet then refuses. */
  readonly currentSlot: number | null;
  /** Other vaults this wallet has accepted. */
  readonly knownVaults?: readonly KnownVault[];
}

class TokenSum {
  lovelace = 0n;
  private readonly tokens = new Map<string, TokenAmount>();

  add(value: ValueView, sign: 1n | -1n = 1n): void {
    this.lovelace += value.lovelace * sign;
    for (const token of value.tokens) {
      const key = `${token.policyId}.${token.assetNameHex}`;
      const quantity = (this.tokens.get(key)?.quantity ?? 0n) + token.quantity * sign;
      this.tokens.set(key, { policyId: token.policyId, assetNameHex: token.assetNameHex, quantity });
    }
  }

  view(): ValueView {
    return { lovelace: this.lovelace, tokens: [...this.tokens.values()].filter(token => token.quantity !== 0n) };
  }
}

function classify(output: OutputView, context: VaultSpendContext, known: readonly KnownVault[]): Pick<ReviewOutput, 'kind' | 'vault'> {
  if (output.address.hex === context.baseAddressHex) return { kind: 'change' };
  const other = known.find(vault => vault.vaultId !== context.vaultId && vault.baseAddressHex === output.address.hex);
  if (other) return { kind: 'other_vault', vault: { vaultId: other.vaultId, ...(other.name !== undefined ? { name: other.name } : {}) } };
  if (output.address.payment.kind === 'script' && output.address.payment.hash === context.paymentScriptHash) return { kind: 'vault_script_other_stake' };
  return { kind: 'external' };
}

/** Applies the vault rules to a decoded summary. Exported for tests; the sheet calls `reviewBundle`. */
export function reviewSummary(summary: VaultTxSummary, context: VaultSpendContext, options: ReviewOptions): SpendReview {
  const refusals: SpendRefusal[] = [];
  const warnings: SpendWarning[] = [];
  const refuse = (code: SpendRefusalCode, path: string, detail?: string) => refusals.push(detail === undefined ? { code, path } : { code, path, detail });

  const isOperation = hasOperationFields(summary);
  let operation: VaultOperation | undefined;
  if (isOperation) {
    const reading = readOperation(summary, context);
    if (reading.status === 'operation') operation = reading.operation;
    else for (const refusal of reading.refusals) refuse(refusal.code, refusal.path, refusal.detail);
  }
  const isVaultInput = (input: VaultTxSummary['inputs'][number]) =>
    input.output.address.payment.kind === 'script' && input.output.address.payment.hash === context.paymentScriptHash;
  summary.inputs.forEach((input, i) => {
    if (!isVaultInput(input) && !isOperationInput(operation, input)) refuse('input_not_vault', `body.0[${i}]`);
  });
  if (summary.referenceInputs.length > 0) refuse('not_a_plain_spend', 'body.18', 'reference_inputs');
  if (summary.requiredSigners.length > 0) refuse('not_a_plain_spend', 'body.14', 'required_signers');

  const expiry = summary.validity.invalidHereafter;
  if (expiry === null) refuse('no_expiry', 'body.3');
  else if (options.currentSlot === null || !Number.isSafeInteger(options.currentSlot)) refuse('expired', 'body.3', 'tip_unknown');
  else if (Number(expiry) <= options.currentSlot) refuse('expired', 'body.3');
  else if (Number(expiry) - options.currentSlot > MAX_VALIDITY_SLOTS) refuse('expiry_too_far', 'body.3');

  const start = summary.validity.invalidBefore;
  if (start !== null && options.currentSlot !== null && Number.isSafeInteger(options.currentSlot)) {
    if (Number(start) > options.currentSlot + VALIDITY_START_TOLERANCE_SLOTS) refuse('validity_start_future', 'body.8');
    else if (options.currentSlot - Number(start) > MAX_VALIDITY_SLOTS) refuse('validity_start_too_old', 'body.8');
  }

  const known = options.knownVaults ?? [];
  const outputs: ReviewOutput[] = summary.outputs.map((output, index) => {
    const hasDatum = output.datum !== null;
    const hasReferenceScript = output.referenceScript !== null;
    if (isOperation) {
      // An operation pays nothing out: change to the vault, and the registration output it locks.
      const registration = isOperationOutput(operation, index);
      if (!registration && output.address.hex !== context.baseAddressHex) refuse('operation_output', `body.1[${index}]`);
      else if (!registration && hasDatum) refuse('vault_output_datum', `body.1[${index}]`);
      else if (!registration && hasReferenceScript) refuse('vault_output_script', `body.1[${index}]`);
      return { index, kind: registration ? 'dust_registration' : 'change', address: output.address.bech32, value: output.value, hasDatum, hasReferenceScript };
    }
    const { kind, vault } = classify(output, context, known);
    if (kind === 'change' || kind === 'other_vault') {
      if (hasDatum) refuse('vault_output_datum', `body.1[${index}]`);
      if (hasReferenceScript) refuse('vault_output_script', `body.1[${index}]`);
    } else {
      if (kind === 'vault_script_other_stake') warnings.push({ code: 'vault_script_other_stake', output: index });
      if (hasDatum) warnings.push({ code: 'output_datum', output: index });
      if (hasReferenceScript) warnings.push({ code: 'output_script', output: index });
    }
    return { index, kind, address: output.address.bech32, value: output.value, ...(vault ? { vault } : {}), hasDatum, hasReferenceScript };
  });
  if (summary.fee > NATIVE_FEE_WARN_LOVELACE) warnings.push({ code: 'fee_high' });

  if (refusals.length > 0) return { status: 'refused', txId: summary.txId, refusals };

  const leaves = new TokenSum();
  const change = new TokenSum();
  for (const input of summary.inputs) if (isVaultInput(input)) leaves.add(input.output.value);
  for (const output of outputs) {
    if (output.kind !== 'change') continue;
    leaves.add(output.value, -1n);
    change.add(output.value);
  }
  return {
    status: 'ready',
    txId: summary.txId,
    inputCount: summary.inputs.length,
    outputs,
    leaves: leaves.view(),
    change: change.view(),
    fee: summary.fee,
    invalidHereafter: Number(expiry),
    invalidBefore: summary.validity.invalidBefore === null ? null : Number(summary.validity.invalidBefore),
    warnings,
    summary,
    ...(operation ? { operation } : {}),
  };
}

function fromDecoder(refusal: Refusal): SpendRefusal {
  return refusal.detail === undefined ? { code: refusal.code, path: refusal.path } : { code: refusal.code, path: refusal.path, detail: refusal.detail };
}

/**
 * The approval sheet for a bundle: decoded offline from the bundle's own creating transactions,
 * then held to the vault rules. Call `parseUnsignedBundle` first; this also refuses a bundle for
 * another vault.
 */
export async function reviewBundle(bundle: UnsignedTxBundle, context: VaultSpendContext, options: ReviewOptions): Promise<SpendReview> {
  if (bundle.vaultId !== context.vaultId || bundle.network !== context.network) {
    return { status: 'refused', txId: bundle.txId, refusals: [{ code: 'bundle_other_vault', path: 'bundle' }] };
  }
  // The DUST mapping validator's token is the one mint a vault signs; with it the script data hash is read.
  const validator = mappingValidatorFor(context.network);
  const decoded = await decodeVaultTransaction(unsignedTransaction(bundle.bodyCbor), {
    networkId: context.networkId,
    inputSources: [bundleTxSource(bundle)],
    maxFeeLovelace: NATIVE_FEE_MAX_LOVELACE,
    ...(validator ? { plutusMintPolicies: [validator.scriptHash] } : {}),
  });
  if (decoded.status === 'refused') return { status: 'refused', txId: decoded.txId, refusals: decoded.refusals.map(fromDecoder) };
  if (decoded.summary.txId !== bundle.txId) return { status: 'refused', txId: decoded.summary.txId, refusals: [{ code: 'tx_undecodable', path: 'bundle', detail: 'tx_id' }] };
  return reviewSummary(decoded.summary, context, options);
}
