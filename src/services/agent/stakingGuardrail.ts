// src/services/agent/stakingGuardrail.ts
export interface StakeCert { kind: string; poolId?: string }
export interface StakeWithdrawal { stakeAddress: string; quantity: bigint }
export interface StakeOutput { address: string; lovelace: bigint; hasAssets: boolean }
/** One decoded Conway vote from body.votingProcedures, flattened across voter groups. */
export interface GovVote { actionId: string; vote: string }
export interface DecodedStakeTx {
  certificates: StakeCert[];
  withdrawals: StakeWithdrawal[];
  outputs: StakeOutput[];
  fee: bigint;
  /** Conway body.votingProcedures — absent/empty on pre-Conway decodes. */
  votingProcedures?: GovVote[];
}
export interface DelegateExpectation { ownAddresses: string[]; targetPoolId: string; maxFeeLovelace: bigint }
export interface WithdrawExpectation { ownAddresses: string[]; stakeAddress: string; withdrawableAmount: bigint; maxFeeLovelace: bigint }
export interface VoteExpectation { ownAddresses: string[]; declaredActionIds: string[]; maxFeeLovelace: bigint }
export interface StakeVerdict { ok: boolean; reasons: string[] }

const DELEG_KINDS = new Set(['StakeDelegation', 'StakeVoteDelegation', 'StakeVoteRegistrationDelegation', 'StakeRegistrationDelegation', 'VoteDelegation', 'VoteRegistrationDelegation']);

/**
 * A vote is a signed, irreversible governance statement — a staking intent
 * never authorizes one. Any votingProcedures under a delegate/withdraw
 * intent is a hard reject, whatever else the transaction contains.
 */
function rejectVotesUnderStakingIntent(tx: DecodedStakeTx, reasons: string[]): void {
  if ((tx.votingProcedures ?? []).length > 0) {
    reasons.push('This transaction casts a governance vote, which was not part of the staking request.');
  }
}

function foreignLovelace(tx: DecodedStakeTx, own: Set<string>): { ada: bigint; tokens: boolean } {
  let ada = 0n;
  let tokens = false;
  for (const o of tx.outputs) {
    if (own.has(o.address)) continue;
    ada += o.lovelace;
    if (o.hasAssets) tokens = true;
  }
  return { ada, tokens };
}

/** Verify a delegation tx: one delegation cert to the intended pool, no withdrawal, no foreign outflow beyond fee. */
export function verifyDelegateTx(tx: DecodedStakeTx, exp: DelegateExpectation): StakeVerdict {
  const reasons: string[] = [];
  const own = new Set(exp.ownAddresses);
  const deleg = tx.certificates.find((c) => DELEG_KINDS.has(c.kind));
  if (!deleg || !deleg.poolId) reasons.push('No delegation certificate found in this transaction.');
  else if (deleg.poolId !== exp.targetPoolId) reasons.push('This would delegate to a different pool than you asked for.');
  if (tx.withdrawals.length > 0) reasons.push('A delegation should not also withdraw rewards.');
  rejectVotesUnderStakingIntent(tx, reasons);
  const f = foreignLovelace(tx, own);
  if (f.tokens) reasons.push('This delegation would send tokens out of your wallet.');
  if (f.ada > exp.maxFeeLovelace) reasons.push('More ADA would leave your wallet than the expected fee.');
  return { ok: reasons.length === 0, reasons };
}

/** Verify a rewards withdrawal: withdrawal of the own stake address, within the withdrawable amount, no delegation cert, no foreign outflow. */
export function verifyWithdrawTx(tx: DecodedStakeTx, exp: WithdrawExpectation): StakeVerdict {
  const reasons: string[] = [];
  const own = new Set(exp.ownAddresses);
  const w = tx.withdrawals.find((x) => x.stakeAddress === exp.stakeAddress);
  if (!w) reasons.push('This transaction does not withdraw your staking rewards.');
  else if (w.quantity > exp.withdrawableAmount) reasons.push('The withdrawal amount exceeds your available rewards.');
  if (tx.certificates.some((c) => DELEG_KINDS.has(c.kind))) reasons.push('A rewards withdrawal should not change your pool delegation.');
  rejectVotesUnderStakingIntent(tx, reasons);
  const f = foreignLovelace(tx, own);
  if (f.tokens) reasons.push('This withdrawal would send tokens out of your wallet.');
  if (f.ada > exp.maxFeeLovelace) reasons.push('Your rewards would leave to an address that is not yours.');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Verify a governance vote tx: votes only on the declared action ids, no
 * delegation change, no withdrawal, no foreign outflow beyond fee. Action ids
 * are compared as opaque strings — the caller decodes and declares them in the
 * same canonical form.
 */
export function verifyVoteTx(tx: DecodedStakeTx, exp: VoteExpectation): StakeVerdict {
  const reasons: string[] = [];
  const own = new Set(exp.ownAddresses);
  const votes = tx.votingProcedures ?? [];
  const declared = new Set(exp.declaredActionIds);
  if (votes.length === 0) reasons.push('No governance vote found in this transaction.');
  for (const v of votes) {
    if (!declared.has(v.actionId)) {
      reasons.push('This transaction votes on a governance action you did not ask for.');
      break;
    }
  }
  if (tx.certificates.some((c) => DELEG_KINDS.has(c.kind))) reasons.push('A governance vote should not change your pool delegation.');
  if (tx.withdrawals.length > 0) reasons.push('A governance vote should not also withdraw rewards.');
  const f = foreignLovelace(tx, own);
  if (f.tokens) reasons.push('This vote would send tokens out of your wallet.');
  if (f.ada > exp.maxFeeLovelace) reasons.push('More ADA would leave your wallet than the expected fee.');
  return { ok: reasons.length === 0, reasons };
}
