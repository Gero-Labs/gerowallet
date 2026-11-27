/**
 * Display helpers of the spend screens: amounts, token names, times and the text keys of codes.
 * Pure, so the views stay thin and the mapping is tested.
 */
import { formatLovelaceAsAda } from '@/shared/utils/format';
import { backupPathOpensAtMs, displayLabel, type VaultNetwork } from '@/shared/gerovault';
import type { TokenAmount } from '@/shared/gerovault/decode';
import { VaultSpendError, type VaultSpendErrorCode } from './errors';
import type { SpendRefusalCode, SpendWarningCode } from './review';
import type { WitnessRefusalReason } from './witnesses';
import type { VaultSpendParticipant } from './vaultSpendContext';
import type { VaultSpendUnavailable } from './useVaultSpend';

/** Lovelace as an ADA figure with every digit kept: `12,500.25`. */
export function adaText(lovelace: bigint): string {
  return formatLovelaceAsAda(lovelace);
}

/** A token's name: its bytes as text when they are printable ASCII, otherwise its hex. */
export function tokenName(token: Pick<TokenAmount, 'assetNameHex'>): string {
  const hex = token.assetNameHex;
  if (hex.length === 0) return '';
  const bytes = hex.match(/../g)?.map(pair => parseInt(pair, 16)) ?? [];
  return bytes.every(b => b >= 0x20 && b < 0x7f) ? String.fromCharCode(...bytes) : hex;
}

/** The time a slot starts, in Unix milliseconds (Shelley slots last one second), or undefined. */
export function slotTimeMs(network: VaultNetwork, slot: number): number | undefined {
  // The recovery package's slot clock: the time of an absolute slot on the vault's network.
  return backupPathOpensAtMs(network, slot);
}

/** A participant's name as stored (through `displayLabel`), or the numbered fallback key's value. */
export function participantName(participant: Pick<VaultSpendParticipant, 'label'>, fallback: string): string {
  return participant.label !== undefined ? displayLabel(participant.label) : fallback;
}

const ERROR_KEYS: Readonly<Record<VaultSpendErrorCode, string>> = {
  VAULT_INVALID: 'gerovault.spend.state.invalid',
  VAULT_NOT_ACCEPTED: 'gerovault.spend.state.notAccepted',
  NETWORK_CLOSED: 'gerovault.spend.state.networkClosed',
  NOT_AN_OWNER: 'gerovault.spend.state.notOwner',
  NO_RECIPIENT: 'gerovault.spend.error.noRecipient',
  INVALID_RECIPIENT: 'gerovault.spend.error.invalidRecipient',
  INVALID_AMOUNT: 'gerovault.spend.error.invalidAmount',
  BELOW_MIN_ADA: 'gerovault.spend.error.belowMinAda',
  INSUFFICIENT_FUNDS: 'gerovault.spend.error.insufficientFunds',
  FEE_TOO_HIGH: 'gerovault.spend.error.feeTooHigh',
  PARAMS_UNAVAILABLE: 'gerovault.spend.error.paramsUnavailable',
  SOURCE_UNAVAILABLE: 'gerovault.spend.error.sourceUnavailable',
  BUNDLE_INVALID: 'gerovault.spend.error.bundleInvalid',
  BUNDLE_OTHER_VAULT: 'gerovault.spend.error.bundleOtherVault',
  WITNESS_INVALID: 'gerovault.spend.error.witnessInvalid',
  NOT_AT_THRESHOLD: 'gerovault.spend.error.notAtThreshold',
  UNSUPPORTED_WALLET: 'gerovault.spend.error.unsupportedWallet',
  WRONG_PASSWORD: 'gerovault.spend.error.wrongPassword',
  KEY_MISMATCH: 'gerovault.spend.error.keyMismatch',
  SCRIPT_DATA_MISMATCH: 'gerovault.dust.error.scriptDataMismatch',
  OPERATION_UNAVAILABLE: 'gerovault.dust.error.unavailable',
  STAKE_ALREADY_REGISTERED: 'gerovault.dust.error.stakeAlreadyRegistered',
  STAKE_NOT_REGISTERED: 'gerovault.dust.error.stakeNotRegistered',
  DUST_ALREADY_REGISTERED: 'gerovault.dust.error.dustAlreadyRegistered',
  DUST_NOT_REGISTERED: 'gerovault.dust.error.dustNotRegistered',
  INVALID_DUST_ADDRESS: 'gerovault.dust.error.invalidDustAddress',
  NO_COLLATERAL: 'gerovault.dust.error.noCollateral',
};

/** The text key of a spend error code. */
export function errorKey(code: VaultSpendErrorCode): string {
  return ERROR_KEYS[code] ?? 'gerovault.spend.error.generic';
}

const REFUSAL_KEYS: Partial<Record<SpendRefusalCode, string>> = {
  input_unresolved: 'gerovault.spend.refusal.inputUnresolved',
  input_not_vault: 'gerovault.spend.refusal.inputNotVault',
  not_a_plain_spend: 'gerovault.spend.refusal.notAPlainSpend',
  vault_output_datum: 'gerovault.spend.refusal.vaultOutputDatum',
  vault_output_script: 'gerovault.spend.refusal.vaultOutputScript',
  no_expiry: 'gerovault.spend.refusal.noExpiry',
  expired: 'gerovault.spend.refusal.expired',
  expiry_too_far: 'gerovault.spend.refusal.expiryTooFar',
  validity_start_future: 'gerovault.spend.refusal.validityStartFuture',
  validity_start_too_old: 'gerovault.spend.refusal.validityStartTooOld',
  fee_above_limit: 'gerovault.spend.refusal.feeAboveLimit',
  network_mismatch: 'gerovault.spend.refusal.networkMismatch',
  bundle_other_vault: 'gerovault.spend.refusal.otherVault',
  value_not_balanced: 'gerovault.spend.refusal.notBalanced',
  operation_unknown: 'gerovault.dust.refusal.unknown',
  operation_other_credential: 'gerovault.dust.refusal.otherCredential',
  operation_output: 'gerovault.dust.refusal.output',
  registration_output_invalid: 'gerovault.dust.refusal.registrationOutput',
  registration_input_invalid: 'gerovault.dust.refusal.registrationInput',
  collateral_shape: 'gerovault.dust.refusal.collateral',
  script_data_hash_shape: 'gerovault.dust.refusal.scriptDataHash',
  operation_unavailable: 'gerovault.dust.refusal.unavailable',
};

/**
 * The text key of a refusal. Codes without their own text share the generic one, which names the
 * code: until a rule renders a field, the sheet refuses it rather than approximate it.
 */
export function refusalKey(code: SpendRefusalCode): string {
  return REFUSAL_KEYS[code] ?? 'gerovault.spend.refusal.generic';
}

const WARNING_KEYS: Readonly<Record<SpendWarningCode, string>> = {
  fee_high: 'gerovault.spend.warning.feeHigh',
  vault_script_other_stake: 'gerovault.spend.warning.vaultScriptOtherStake',
  output_datum: 'gerovault.spend.warning.outputDatum',
  output_script: 'gerovault.spend.warning.outputScript',
};

export function warningKey(code: SpendWarningCode): string {
  return WARNING_KEYS[code];
}

const WITNESS_KEYS: Readonly<Record<WitnessRefusalReason, string>> = {
  malformed: 'gerovault.spend.witness.malformed',
  other_vault: 'gerovault.spend.witness.otherVault',
  other_network: 'gerovault.spend.witness.otherNetwork',
  other_body: 'gerovault.spend.witness.otherBody',
  signer_unknown: 'gerovault.spend.witness.signerUnknown',
  signer_not_owner: 'gerovault.spend.witness.signerNotOwner',
  key_not_in_script: 'gerovault.spend.witness.keyNotInScript',
  key_not_signer: 'gerovault.spend.witness.keyNotSigner',
  not_needed: 'gerovault.spend.witness.notNeeded',
  stake_missing: 'gerovault.dust.witness.stakeMissing',
  bad_signature: 'gerovault.spend.witness.badSignature',
};

/** The text key of why a witness file was refused. */
export function witnessReasonKey(reason: string | undefined): string {
  return (reason && (WITNESS_KEYS as Record<string, string>)[reason]) || 'gerovault.spend.witness.malformed';
}

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** The text of an error thrown by the spend modules; anything else is the generic text. */
export function errorText(error: unknown, t: Translate): string {
  if (!(error instanceof VaultSpendError)) return t('gerovault.spend.error.generic');
  if (error.code === 'BELOW_MIN_ADA' && error.detail && /^[0-9]+$/.test(error.detail)) {
    return t(errorKey(error.code), { amount: adaText(BigInt(error.detail)) });
  }
  if (error.code === 'WITNESS_INVALID') return t(witnessReasonKey(error.detail));
  return t(errorKey(error.code));
}

const UNAVAILABLE_KEYS: Readonly<Record<VaultSpendUnavailable, string>> = {
  no_wallet: 'gerovault.spend.state.noWallet',
  not_found: 'gerovault.spend.state.notFound',
  store: 'gerovault.spend.state.store',
  network_closed: 'gerovault.spend.state.networkClosed',
  not_accepted: 'gerovault.spend.state.notAccepted',
  not_owner: 'gerovault.spend.state.notOwner',
  invalid: 'gerovault.spend.state.invalid',
  no_reader: 'gerovault.spend.unavailable',
};

/** The text key of why a vault cannot be spent from here. `noReader` names the screen's own "not available yet". */
export function unavailableKey(reason: VaultSpendUnavailable, noReader = 'gerovault.spend.unavailable'): string {
  return reason === 'no_reader' ? noReader : UNAVAILABLE_KEYS[reason];
}
