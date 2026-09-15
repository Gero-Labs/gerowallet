// src/services/agent/decodeStakeTx.ts
//
// Pure adapter: maps a deserialized Cardano.Tx-shaped object to DecodedStakeTx.
//
// Field sources confirmed against the live codebase:
//   - cert.__typename  (SDK discriminant, e.g. 'StakeDelegation') -> kind
//   - cert.poolId      (bech32 pool id string) -> poolId
//   - withdrawal.stakeAddress (confirmed from useWithdrawal.ts line 63) -> stakeAddress
//   - withdrawal.quantity (bigint) -> quantity
//   - output.address (string) -> address
//   - output.value.coins (bigint) -> lovelace
//   - output.value.assets (Map<AssetId, bigint> | undefined) -> hasAssets
//   - tx.body.fee (bigint) -> fee
//
// Live-hardening follow-up (Gap 3): filter delegation certs to the user's OWN stake
// credential -- a hostile build could include a delegation cert for a different stake key.
// This requires the wallet stake credential at the call site (not available in this pure
// adapter). The Guardrail currently verifies the pool id but not the staking credential;
// add credential filtering in the orchestration layer (useAgentStaking) when wiring the
// Guardrail, passing the wallet's stake key hash for comparison.

import type { DecodedStakeTx, GovVote, StakeCert, StakeWithdrawal, StakeOutput } from './stakingGuardrail';

/** Minimal structural shape of a certificate inside a deserialized Cardano.Tx body. */
interface RawCert {
  __typename: string;
  poolId?: string;
}

/** Minimal structural shape of a withdrawal inside a deserialized Cardano.Tx body. */
interface RawWithdrawal {
  stakeAddress: string;
  quantity: bigint;
}

/** Minimal structural shape of an output value inside a deserialized Cardano.Tx body. */
interface RawValue {
  coins: bigint;
  assets?: Map<unknown, bigint> | null;
}

/** Minimal structural shape of a tx output inside a deserialized Cardano.Tx body. */
interface RawOutput {
  address: string;
  value: RawValue;
}

/** Minimal structural shape of one vote inside a voter group (Conway). */
interface RawVotingProcedureVote {
  actionId: { id: string; actionIndex: number };
  votingProcedure: { vote: number };
}

/** Minimal structural shape of one voter group in body.votingProcedures. */
interface RawVoterGroup {
  votes: RawVotingProcedureVote[];
}

/** Minimal structural shape of the body of a deserialized Cardano.Tx. */
interface RawTxBody {
  certificates?: RawCert[];
  withdrawals?: RawWithdrawal[];
  outputs: RawOutput[];
  fee: bigint;
  /** Conway voting procedures — absent on pre-Conway transactions. */
  votingProcedures?: RawVoterGroup[];
}

/**
 * The SDK's Cardano.Vote numeric enum: no = 0, yes = 1, abstain = 2. Mapped to
 * the Guardrail's string form; an unknown value maps to its decimal string so a
 * future enum member is still visible (and rejectable) rather than silently
 * normalized.
 */
const VOTE_NAMES: Record<number, string> = { 0: 'No', 1: 'Yes', 2: 'Abstain' };

/** Structural shape expected by toDecodedStakeTx -- mirrors Cardano.Tx from @cardano-sdk/core. */
export interface CardanoTxLike {
  body: RawTxBody;
}

/**
 * Map a deserialized Cardano.Tx (or compatible structural shape) to the Guardrail's
 * DecodedStakeTx. Keeps this layer pure -- no SDK imports, no side effects.
 *
 * @param tx - A deserialized Cardano.Tx object (e.g. from deserializeCardanoJsSdkTx).
 * @returns DecodedStakeTx ready for the staking Guardrail.
 */
export function toDecodedStakeTx(tx: CardanoTxLike): DecodedStakeTx {
  const certificates: StakeCert[] = (tx.body.certificates ?? []).map(
    (cert): StakeCert => ({
      kind: cert.__typename,
      poolId: cert.poolId,
    }),
  );

  const withdrawals: StakeWithdrawal[] = (tx.body.withdrawals ?? []).map(
    (w): StakeWithdrawal => ({
      stakeAddress: w.stakeAddress,
      quantity: w.quantity,
    }),
  );

  const outputs: StakeOutput[] = tx.body.outputs.map(
    (o): StakeOutput => ({
      address: o.address,
      lovelace: o.value.coins,
      hasAssets: !!(o.value.assets?.size),
    }),
  );

  // Flatten {voter, votes[]} groups into the Guardrail's GovVote[] shape.
  // Without this mapping, rejectVotesUnderStakingIntent() can never fire on a
  // real transaction — the guardrail would only ever see hand-built fixtures.
  // actionId uses the display form `txHash#index`, matching what the vote flow
  // declares in VoteExpectation.declaredActionIds.
  const votingProcedures: GovVote[] = (tx.body.votingProcedures ?? []).flatMap((group) =>
    (group.votes ?? []).map(
      (v): GovVote => ({
        actionId: `${v.actionId.id}#${v.actionId.actionIndex}`,
        vote: VOTE_NAMES[v.votingProcedure.vote] ?? String(v.votingProcedure.vote),
      }),
    ),
  );

  return {
    certificates,
    withdrawals,
    outputs,
    fee: tx.body.fee,
    ...(votingProcedures.length > 0 ? { votingProcedures } : {}),
  };
}
