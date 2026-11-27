/**
 * Native staking from the logged Solana account (extension pages only): `SOLANA_STAKE_QUOTE`,
 * `SOLANA_STAKE` and, for a hardware wallet, `PREPARE_SOLANA_STAKE` followed by the send's own
 * `SUBMIT_SOLANA_SEND`.
 *
 * The page names the action and only what the user chose: a validator's vote account and an
 * amount (Stake), or one of the account's stake accounts (Unstake, Withdraw), plus a fee level.
 * The worker reads everything else itself, fresh, and refuses unless:
 *
 * - **Stake**: the vote account is in Nexus's validator list and not delinquent; the amount is at
 *   least the minimum delegation; the account keeps `STAKE_KEEP_LAMPORTS` after the stake, its
 *   reserve and the fee (to pay for a later Unstake and Withdraw). The new stake account is the
 *   first unused `stake:N` address derived from the wallet (`CreateAccountWithSeed`), so the
 *   wallet is the only signer and owns it as staker and withdrawer, with no lockup. The
 *   simulation must show exactly the stake plus its reserve in a Stake-program account, and the
 *   wallet paying at most that plus the fee.
 * - **Unstake**: Nexus lists the stake account with the wallet as staker, active or activating,
 *   and the chain shows it owned by the Stake program. The simulation may cost the fee only.
 * - **Withdraw**: Nexus lists it with the wallet as withdrawer, not locked up, with lamports to
 *   withdraw; the whole withdrawable amount goes back to the wallet. The simulation must show the
 *   wallet receiving it, less the fee.
 *
 * As for a token send, the page passes the reviewed limits back (`maxSolCost`, and `minReceived`
 * for a withdrawal) and the worker holds the send to them.
 */
import { SolanaApi } from '@/api/solana-api';
import WalletStore from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import { isValidSolanaAddress } from '@/chains/solana/solanaKeyManager';
import { parseRawAmount } from '@/chains/solana/solanaAmount';
import { MAX_TRANSACTION_BYTES } from '@/chains/solana/solanaTransaction';
import { singleSignerTransaction } from '@/chains/solana/solanaTokenTransfer';
import { priorityPriceFor } from '@/chains/solana/solanaSendRules';
import {
  addressWithSeed,
  buildDeactivateMessage,
  buildStakeMessage,
  buildWithdrawMessage,
  estimateStakeFee,
  MAX_STAKE_SEEDS,
  STAKE_PROGRAM_ID,
  stakeSeed,
  type SolanaStakeAction,
} from '@/chains/solana/solanaStakeTransfer';
import { STAKE_KEEP_LAMPORTS, stakeActions, type SolanaStakeAccount } from '@/chains/solana/solanaStaking';
import type { SolanaRemoteAccount, SolanaRemoteSimulation } from '@/chains/solana/solanaNexusAccounts';
import { bytesToBase64 } from '@/chrome/solanaDappTx';
import { holdToReview, senderPaysAtMost, SolanaTokenSendError, type SolanaTokenSendRequest } from '@/chrome/solanaTokenSend';
import {
  holdSolanaMessageForSignature,
  SolanaSendError,
  submitSignedSolana,
  type SolanaSendWallet,
} from '@/chrome/solanaSend';

export type SolanaStakeRefusal =
  | 'VALIDATOR_UNKNOWN'
  | 'VALIDATOR_DELINQUENT'
  | 'STAKE_BELOW_MINIMUM'
  | 'STAKE_KEEP_SOL'
  | 'STAKE_UNKNOWN'
  | 'STAKE_NOT_ACTIVE'
  | 'STAKE_NOT_WITHDRAWABLE';

export type SolanaStakeApi = Pick<SolanaApi,
  'getFees' | 'getChainTip' | 'getAccounts' | 'simulate' | 'getStakes' | 'getValidators' | 'getStakeInfo'>;

export interface SolanaStakeRequest {
  action?: unknown;
  voteAccount?: unknown;
  /** Stake: lamports to delegate (the reserve comes on top). Decimal string. */
  lamports?: unknown;
  stakeAccount?: unknown;
  feeLevel?: unknown;
  maxSolCost?: unknown;
  minReceived?: unknown;
}

export interface SolanaStakePlan {
  action: SolanaStakeAction;
  message: Uint8Array;
  stakeAccount: string;
  /** Stake: the validator delegated to. Unstake / Withdraw: the account's validator, if any. */
  voteAccount: string | null;
  /** Stake: lamports delegated. Withdraw: lamports withdrawn. Unstake: the account's active stake. */
  lamports: bigint;
  /** Stake: the new account's rent-exempt reserve, paid on top of the stake. */
  reserveLamports: bigint;
  feeLamports: bigint;
}

/** What the review shows. Lamports as decimal strings. */
export interface SolanaStakeQuote {
  action: SolanaStakeAction;
  stakeAccount: string;
  voteAccount: string | null;
  lamports: string;
  reserveLamports: string;
  feeLamports: string;
}

function refuse(code: SolanaStakeRefusal | 'INVALID_REQUEST' | 'BALANCE_UNKNOWN' | 'INSUFFICIENT_FUNDS' | 'LOOKUP_FAILED' | 'SIMULATION_FAILED'): never {
  throw new SolanaSendError(code);
}

function requireSolana(wallet: SolanaSendWallet | null | undefined): SolanaSendWallet {
  if (!wallet || wallet.chain !== Blockchain.SOLANA) throw new SolanaSendError('NOT_SOLANA');
  return wallet;
}

function knownBalance(): bigint | null {
  const lamports = WalletStore.state.solana?.lamports;
  return lamports == null ? null : parseRawAmount(lamports);
}

async function read<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch {
    return refuse('LOOKUP_FAILED');
  }
}

/** The action's message, checked and simulated against what the worker reads itself. */
export async function planSolanaStake(
  sender: { publicKey: string },
  request: SolanaStakeRequest,
  api: SolanaStakeApi,
  balance: bigint | null = knownBalance(),
): Promise<SolanaStakePlan> {
  const { action, feeLevel } = request;
  if (action !== 'stake' && action !== 'unstake' && action !== 'withdraw') refuse('INVALID_REQUEST');
  if (feeLevel !== 'standard' && feeLevel !== 'fast') refuse('INVALID_REQUEST');
  const owner = sender.publicKey;
  const fees = await api.getFees().catch(() => undefined);
  const priority = priorityPriceFor(feeLevel, fees?.prioritizationFeeMicroLamports);
  const feeLamports = estimateStakeFee(action, priority);
  const plan = action === 'stake'
    ? await planStake(owner, request, api, balance, priority, feeLamports)
    : await planExisting(owner, action, request, api, priority, feeLamports);
  if (singleSignerTransaction(plan.message).length > MAX_TRANSACTION_BYTES) refuse('SIMULATION_FAILED');
  return plan;
}

async function planStake(
  owner: string,
  request: SolanaStakeRequest,
  api: SolanaStakeApi,
  balance: bigint | null,
  priority: bigint,
  feeLamports: bigint,
): Promise<SolanaStakePlan> {
  const { voteAccount, lamports: raw } = request;
  if (typeof voteAccount !== 'string' || !isValidSolanaAddress(voteAccount)) refuse('INVALID_REQUEST');
  if (typeof raw !== 'string' || !/^\d{1,20}$/.test(raw)) refuse('INVALID_REQUEST');
  const lamports = BigInt(raw);

  const seeds = Array.from({ length: MAX_STAKE_SEEDS }, (_, i) => stakeSeed(i));
  const candidates = seeds.map((seed) => addressWithSeed(owner, seed, STAKE_PROGRAM_ID));
  const [info, { validators }, accounts] = await Promise.all([
    read(api.getStakeInfo()),
    read(api.getValidators()),
    read(api.getAccounts([owner, ...candidates])),
  ]);
  const validator = validators.find((v) => v.votePubkey === voteAccount);
  if (!validator) refuse('VALIDATOR_UNKNOWN');
  if (validator.delinquent) refuse('VALIDATOR_DELINQUENT');
  if (lamports < info.minimumDelegation || lamports <= 0n) refuse('STAKE_BELOW_MINIMUM');

  const reserve = info.rentExemptReserve;
  const deposit = lamports + reserve;
  if (balance === null) refuse('BALANCE_UNKNOWN');
  const remaining = balance - deposit - feeLamports;
  if (remaining < 0n) refuse('INSUFFICIENT_FUNDS');
  if (remaining < STAKE_KEEP_LAMPORTS) refuse('STAKE_KEEP_SOL');

  // The first `stake:N` address nobody has used: CreateAccountWithSeed fails on a used one.
  const free = accounts.slice(1).findIndex((account) => !account.exists);
  if (free < 0) refuse('LOOKUP_FAILED');
  const seed = seeds[free];
  const stakeAccount = candidates[free];

  const tip = await read(api.getChainTip());
  const message = buildStakeMessage({ owner, seed, lamports: deposit, voteAccount, recentBlockhash: tip.blockhash, computeUnitPriceMicroLamports: priority });
  const simulation = await simulate(api, message, [owner, stakeAccount], accounts[0], feeLamports + deposit);
  const created = simulation.after?.[1];
  if (!created?.exists || created.owner !== STAKE_PROGRAM_ID || created.lamports !== deposit) refuse('SIMULATION_FAILED');
  holdToReview(request as SolanaTokenSendRequest, deposit + feeLamports, lamports);
  return { action: 'stake', message, stakeAccount, voteAccount, lamports, reserveLamports: reserve, feeLamports };
}

async function planExisting(
  owner: string,
  action: 'unstake' | 'withdraw',
  request: SolanaStakeRequest,
  api: SolanaStakeApi,
  priority: bigint,
  feeLamports: bigint,
): Promise<SolanaStakePlan> {
  const { stakeAccount } = request;
  if (typeof stakeAccount !== 'string' || !isValidSolanaAddress(stakeAccount) || stakeAccount === owner) refuse('INVALID_REQUEST');
  const [stakes, [senderAccount, onChain]] = await Promise.all([
    read(api.getStakes(owner)),
    read(api.getAccounts([owner, stakeAccount])),
  ]);
  const listed: SolanaStakeAccount | undefined = stakes.accounts.find((a) => a.address === stakeAccount);
  if (!listed || !onChain.exists || onChain.owner !== STAKE_PROGRAM_ID) refuse('STAKE_UNKNOWN');
  const allowed = stakeActions(listed, owner);
  const tip = await read(api.getChainTip());
  const common = { owner, stakeAccount, recentBlockhash: tip.blockhash, computeUnitPriceMicroLamports: priority };

  if (action === 'unstake') {
    if (!allowed.unstake) refuse('STAKE_NOT_ACTIVE');
    const message = buildDeactivateMessage(common);
    await simulate(api, message, [owner], senderAccount, feeLamports);
    holdToReview(request as SolanaTokenSendRequest, feeLamports, 0n);
    return { action, message, stakeAccount, voteAccount: listed.voter, lamports: listed.activeStake + listed.activatingStake, reserveLamports: 0n, feeLamports };
  }

  if (!allowed.withdraw) refuse('STAKE_NOT_WITHDRAWABLE');
  const lamports = listed.withdrawableLamports;
  if (onChain.lamports === null || onChain.lamports < lamports) refuse('STAKE_NOT_WITHDRAWABLE');
  const message = buildWithdrawMessage({ ...common, lamports });
  // The wallet gains the withdrawal less the fee: it may "spend" at most fee - lamports (a gain).
  const simulation = await simulate(api, message, [owner, stakeAccount], senderAccount, feeLamports - lamports);
  const left = simulation.after?.[1];
  if (left?.exists && left.lamports !== null && onChain.lamports - left.lamports !== lamports) refuse('SIMULATION_FAILED');
  holdToReview(request as SolanaTokenSendRequest, feeLamports, lamports);
  return { action, message, stakeAccount, voteAccount: listed.voter, lamports, reserveLamports: 0n, feeLamports };
}

/** Simulates the exact message; it must succeed and the wallet may lose at most `bound`. */
async function simulate(
  api: SolanaStakeApi,
  message: Uint8Array,
  accounts: string[],
  senderAccount: SolanaRemoteAccount,
  bound: bigint,
): Promise<SolanaRemoteSimulation> {
  const simulation = await read(api.simulate(bytesToBase64(singleSignerTransaction(message)), accounts));
  if (!simulation.success || !simulation.after || simulation.after.length !== accounts.length) refuse('SIMULATION_FAILED');
  senderPaysAtMost(simulation, senderAccount, bound);
  return simulation;
}

export function solanaStakeQuote(plan: SolanaStakePlan): SolanaStakeQuote {
  return {
    action: plan.action,
    stakeAccount: plan.stakeAccount,
    voteAccount: plan.voteAccount,
    lamports: plan.lamports.toString(),
    reserveLamports: plan.reserveLamports.toString(),
    feeLamports: plan.feeLamports.toString(),
  };
}

/** What the action would do, for the review (`SOLANA_STAKE_QUOTE`). Nothing is held. */
export async function quoteSolanaStake(
  wallet: SolanaSendWallet | null | undefined,
  request: SolanaStakeRequest,
  api: SolanaStakeApi = new SolanaApi(requireSolana(wallet).network),
): Promise<SolanaStakeQuote> {
  return solanaStakeQuote(await planSolanaStake(requireSolana(wallet), request, api));
}

/** Stake, Unstake or Withdraw from a password or PassKey wallet (`SOLANA_STAKE`): plan, sign, submit. */
export async function sendSolanaStake(
  wallet: SolanaSendWallet | null | undefined,
  request: SolanaStakeRequest & { password?: unknown; privateKeyBytes?: unknown },
  api: SolanaStakeApi & Pick<SolanaApi, 'submit'> = new SolanaApi(requireSolana(wallet).network),
): Promise<{ signature: string }> {
  const sender = requireSolana(wallet);
  const { password, privateKeyBytes } = request;
  if (password !== undefined && typeof password !== 'string') refuse('INVALID_REQUEST');
  if (privateKeyBytes !== undefined && !Array.isArray(privateKeyBytes)) refuse('INVALID_REQUEST');
  if (!sender.signSolanaSendMessage) throw new SolanaSendError('NOT_SOLANA');
  const prfSecret = privateKeyBytes ? new Uint8Array(privateKeyBytes as number[]) : undefined;
  let transaction: Uint8Array;
  let signature: Uint8Array;
  try {
    const plan = await planSolanaStake(sender, request, api);
    signature = await sender.signSolanaSendMessage(plan.message, password as string | undefined, prfSecret);
    transaction = singleSignerTransaction(plan.message, signature);
  } catch (error) {
    // senderPaysAtMost / holdToReview speak in token-send codes, which pages map the same way.
    if (error instanceof SolanaSendError || error instanceof SolanaTokenSendError) throw error;
    // A wrong password, a refused PassKey or a mismatched record: the page shows its own text.
    throw Object.assign(new SolanaSendError('BUILD_FAILED'), { cause: error });
  } finally {
    prfSecret?.fill(0);
    if (Array.isArray(privateKeyBytes)) privateKeyBytes.fill(0);
  }
  return submitSignedSolana(api, transaction, signature);
}

/** The message a hardware wallet signs (`PREPARE_SOLANA_STAKE`), held for `SUBMIT_SOLANA_SEND`. */
export async function prepareSolanaHardwareStake(
  wallet: SolanaSendWallet | null | undefined,
  request: SolanaStakeRequest,
  api: SolanaStakeApi = new SolanaApi(requireSolana(wallet).network),
  now = Date.now(),
): Promise<{ message: number[] }> {
  const sender = requireSolana(wallet);
  const plan = await planSolanaStake(sender, request, api);
  holdSolanaMessageForSignature(sender, plan.message, now);
  return { message: Array.from(plan.message) };
}
