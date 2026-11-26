/**
 * Why the vault decoder will not describe a transaction. The codes are stable: a screen maps them
 * to text, tests and other clients compare them. Add a code rather than reuse one for a new reason.
 */
export const REFUSAL_CODES = [
  // ── the transaction as a whole ──
  /** The bytes are not a Conway transaction `[body, witnesses, isValid, auxiliaryData]`. */
  'tx_undecodable',
  /** `isValid` is false: submitting it forfeits the collateral and does nothing else. */
  'tx_marked_invalid',
  /** Auxiliary data (metadata) or its hash: no rule renders it yet. */
  'auxiliary_data_unsupported',

  // ── the body map ──
  /** A body key no rule names: a later era's field, or not a field at all. */
  'body_key_unknown',
  /** The same body key twice: decoders disagree on which one counts. */
  'body_key_duplicate',
  /** A field every transaction carries (inputs, outputs, fee) is absent. */
  'body_key_missing',
  /** A field is present but does not have the shape its rule reads. */
  'field_malformed',
  /** A variant of an address, credential, datum option or script that no rule names. */
  'variant_unknown',
  /** An output map key other than address, value, datum option and reference script. */
  'output_field_unknown',

  // ── fields refused by name ──
  /** A protocol parameter update proposal (body key 6, gone since Conway). */
  'protocol_update_unsupported',
  /** Minting or burning (body key 9). */
  'mint_unsupported',
  /** A script data hash (body key 11): a Plutus script runs. Plutus vault transitions come with the validators. */
  'plutus_transition_unsupported',
  /** Governance votes (body key 19). */
  'governance_vote_unsupported',
  /** Governance proposals (body key 20). */
  'governance_proposal_unsupported',
  /** The current treasury value or a treasury donation (body keys 21, 22). */
  'treasury_unsupported',

  // ── certificates ──
  /** A stake pool registration or retirement. */
  'certificate_pool_unsupported',
  /** A vote delegation, alone or combined with a stake delegation or registration. */
  'certificate_vote_delegation_unsupported',
  /** A DRep or constitutional committee certificate. */
  'certificate_governance_unsupported',
  /** Any other certificate tag, including the pre-Conway genesis delegation and MIR certificates. */
  'certificate_unknown',
  /** A pre-Conway stake (de)registration, which states no deposit, and no stake key deposit was given. */
  'deposit_unknown',

  // ── addresses and network ──
  /** An address, reward account or body network id for another network than the expected one. */
  'network_mismatch',
  /** A Byron (bootstrap) address. */
  'address_byron_unsupported',
  /** A pointer address. */
  'address_pointer_unsupported',
  /** Bytes that are not an address of the kind the field holds (a reward account as an output, a bad length). */
  'address_invalid',

  // ── inputs ──
  /** An input, collateral input or reference input whose creating transaction was not proven. */
  'input_unresolved',
  /** A reference input that is also spent. */
  'reference_input_spent',

  // ── consistency ──
  /** Inputs, withdrawals and refunds do not equal outputs, fee and deposits, per asset. */
  'value_not_balanced',
  /** The fee is above the limit the caller set. */
  'fee_above_limit',
  /** A collateral input locked by a script. */
  'collateral_input_script_locked',
  /** Collateral inputs locked by more than one payment credential: no single wallet bears the loss. */
  'collateral_multiple_payers',
  /** Tokens could be lost with the collateral. */
  'collateral_loss_not_ada',
  /** Collateral return or total without collateral inputs, or a total that is not what the inputs and return give. */
  'collateral_inconsistent',
] as const;

export type RefusalCode = (typeof REFUSAL_CODES)[number];

export interface Refusal {
  code: RefusalCode;
  /** Where in the transaction, e.g. `body.4[1]` or `body.0[2].address`. */
  path: string;
  /** A machine-readable detail (never text for a user), e.g. the unknown key or the failure kind. */
  detail?: string;
}

/** Thrown by a field reader when the bytes do not have the shape it reads; caught per field. */
export class FieldRefusal extends Error {
  readonly refusal: Refusal;
  constructor(code: RefusalCode, path: string, detail?: string) {
    super(`${code} at ${path}${detail ? ` (${detail})` : ''}`);
    this.name = 'FieldRefusal';
    this.refusal = detail === undefined ? { code, path } : { code, path, detail };
  }
}

/** The refusals one decode collects. */
export class Refusals {
  readonly list: Refusal[] = [];

  add(code: RefusalCode, path: string, detail?: string): void {
    this.list.push(detail === undefined ? { code, path } : { code, path, detail });
  }

  get size(): number {
    return this.list.length;
  }

  /**
   * Run `read`; a {@link FieldRefusal} it throws is recorded and undefined returned. Any other
   * error (the SDK's CBOR reader on malformed bytes) is `field_malformed` at `path`.
   */
  guard<T>(path: string, read: () => T): T | undefined {
    try {
      return read();
    } catch (e) {
      if (e instanceof FieldRefusal) this.list.push(e.refusal);
      else this.add('field_malformed', path, 'cbor');
      return undefined;
    }
  }
}
