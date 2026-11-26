import type { RefusalCode } from './refusals';

/**
 * Every transaction body key the Conway ledger defines, and what the vault decoder does with it.
 * A key present in a body is either decoded by its rule or refused by name; a key not in this
 * table (10, 12, anything a later era adds) is `body_key_unknown`. Nothing is skipped.
 */

export type BodyField =
  | 'inputs'
  | 'outputs'
  | 'fee'
  | 'ttl'
  | 'certificates'
  | 'withdrawals'
  | 'validity_start'
  | 'collateral_inputs'
  | 'required_signers'
  | 'network_id'
  | 'collateral_return'
  | 'total_collateral'
  | 'reference_inputs';

export type BodyKeyRule =
  | { key: number; name: string; decode: BodyField }
  | { key: number; name: string; refuse: RefusalCode };

export const BODY_KEY_RULES: readonly BodyKeyRule[] = [
  { key: 0, name: 'inputs', decode: 'inputs' },
  { key: 1, name: 'outputs', decode: 'outputs' },
  { key: 2, name: 'fee', decode: 'fee' },
  { key: 3, name: 'ttl', decode: 'ttl' },
  { key: 4, name: 'certificates', decode: 'certificates' },
  { key: 5, name: 'withdrawals', decode: 'withdrawals' },
  { key: 6, name: 'update', refuse: 'protocol_update_unsupported' },
  { key: 7, name: 'auxiliary_data_hash', refuse: 'auxiliary_data_unsupported' },
  { key: 8, name: 'validity_interval_start', decode: 'validity_start' },
  { key: 9, name: 'mint', refuse: 'mint_unsupported' },
  { key: 11, name: 'script_data_hash', refuse: 'plutus_transition_unsupported' },
  { key: 13, name: 'collateral_inputs', decode: 'collateral_inputs' },
  { key: 14, name: 'required_signers', decode: 'required_signers' },
  { key: 15, name: 'network_id', decode: 'network_id' },
  { key: 16, name: 'collateral_return', decode: 'collateral_return' },
  { key: 17, name: 'total_collateral', decode: 'total_collateral' },
  { key: 18, name: 'reference_inputs', decode: 'reference_inputs' },
  { key: 19, name: 'voting_procedures', refuse: 'governance_vote_unsupported' },
  { key: 20, name: 'proposal_procedures', refuse: 'governance_proposal_unsupported' },
  { key: 21, name: 'current_treasury_value', refuse: 'treasury_unsupported' },
  { key: 22, name: 'donation', refuse: 'treasury_unsupported' },
];

const BY_KEY = new Map(BODY_KEY_RULES.map((rule) => [rule.key, rule]));

/** The rule for a body key, or undefined: the key is unknown and refuses. */
export function bodyKeyRule(key: bigint): BodyKeyRule | undefined {
  return key <= 0xffn ? BY_KEY.get(Number(key)) : undefined;
}

/** Keys every body carries. */
export const REQUIRED_BODY_KEYS: readonly number[] = [0, 1, 2];
