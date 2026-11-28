/**
 * Nexus's staking answers (Gero-Labs/nexus#1799), read strictly: `GET /api/sol/addresses/{a}/stakes`,
 * `GET /api/sol/validators` and `GET /api/sol/stake/info`. A row that is not what it should be is
 * dropped (lists) or throws (single answers); amounts stay exact `bigint`s.
 *
 * Validator names, websites, icons and details are what each validator published about itself:
 * self-declared third-party text. Pages show them as text, never as verified, always next to the
 * vote account.
 */
import { isValidSolanaAddress } from './solanaKeyManager';

export type SolanaStakeState = 'initialized' | 'activating' | 'active' | 'deactivating' | 'inactive';
export type SolanaStakeRole = 'staker' | 'withdrawer' | 'both';

export interface SolanaStakeAccount {
  address: string;
  state: SolanaStakeState;
  role: SolanaStakeRole;
  lamports: bigint;
  rentExemptReserve: bigint;
  staker: string;
  withdrawer: string;
  voter: string | null;
  delegatedStake: bigint | null;
  activeStake: bigint;
  activatingStake: bigint;
  deactivatingStake: bigint;
  activationEpoch: number | null;
  deactivationEpoch: number | null;
  withdrawableLamports: bigint;
  lockedUp: boolean;
}

export interface SolanaStakes {
  epoch: number;
  accounts: SolanaStakeAccount[];
  truncated: boolean;
  /** Rows Nexus sent that could not be read (not shown). */
  dropped: number;
}

export interface SolanaValidator {
  votePubkey: string;
  nodePubkey: string;
  name: string | null;
  website: string | null;
  iconUrl: string | null;
  details: string | null;
  commission: number;
  activatedStake: bigint;
  delinquent: boolean;
  lastEpochCredits: number;
}

export interface SolanaStakeInfo {
  epoch: number;
  slotIndex: number;
  slotsInEpoch: number;
  minimumDelegation: bigint;
  rentExemptReserve: bigint;
}

const STATES: readonly SolanaStakeState[] = ['initialized', 'activating', 'active', 'deactivating', 'inactive'];
const ROLES: readonly SolanaStakeRole[] = ['staker', 'withdrawer', 'both'];
const MAX_TEXT = 300;

export class SolanaStakingShapeError extends Error {
  constructor(what: string) {
    super(`Unexpected Nexus staking answer: ${what}`);
    this.name = 'SolanaStakingShapeError';
  }
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SolanaStakingShapeError(what);
  return value as Record<string, unknown>;
}

function lamports(value: unknown, what: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) throw new SolanaStakingShapeError(what);
  const n = BigInt(value);
  if (n > 0xffff_ffff_ffff_ffffn) throw new SolanaStakingShapeError(what);
  return n;
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new SolanaStakingShapeError(what);
  return value;
}

function address(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isValidSolanaAddress(value)) throw new SolanaStakingShapeError(what);
  return value;
}

function optional<T>(value: unknown, read: (v: unknown) => T): T | null {
  return value === null || value === undefined ? null : read(value);
}

/** Third-party text: a string of bounded length, or null. Rendered as text only. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function readStakeAccount(value: unknown): SolanaStakeAccount {
  const v = record(value, 'stake account');
  const state = v['state'];
  const role = v['role'];
  if (!STATES.includes(state as SolanaStakeState)) throw new SolanaStakingShapeError('state');
  if (!ROLES.includes(role as SolanaStakeRole)) throw new SolanaStakingShapeError('role');
  if (typeof v['lockedUp'] !== 'boolean') throw new SolanaStakingShapeError('lockedUp');
  const account: SolanaStakeAccount = {
    address: address(v['address'], 'address'),
    state: state as SolanaStakeState,
    role: role as SolanaStakeRole,
    lamports: lamports(v['lamports'], 'lamports'),
    rentExemptReserve: lamports(v['rentExemptReserve'], 'rentExemptReserve'),
    staker: address(v['staker'], 'staker'),
    withdrawer: address(v['withdrawer'], 'withdrawer'),
    voter: optional(v['voter'], (x) => address(x, 'voter')),
    delegatedStake: optional(v['delegatedStake'], (x) => lamports(x, 'delegatedStake')),
    activeStake: lamports(v['activeStake'] ?? '0', 'activeStake'),
    activatingStake: lamports(v['activatingStake'] ?? '0', 'activatingStake'),
    deactivatingStake: lamports(v['deactivatingStake'] ?? '0', 'deactivatingStake'),
    activationEpoch: optional(v['activationEpoch'], (x) => count(x, 'activationEpoch')),
    deactivationEpoch: optional(v['deactivationEpoch'], (x) => count(x, 'deactivationEpoch')),
    withdrawableLamports: lamports(v['withdrawableLamports'], 'withdrawableLamports'),
    lockedUp: v['lockedUp'],
  };
  if (account.withdrawableLamports > account.lamports) throw new SolanaStakingShapeError('withdrawable above balance');
  // A delegated account names its validator; an undelegated one is only `initialized`.
  if ((account.state === 'initialized') !== (account.voter === null)) throw new SolanaStakingShapeError('voter');
  return account;
}

/**
 * `GET /api/sol/addresses/{owner}/stakes`. Every row must name `owner` in the role it claims;
 * a row that does not is dropped with the unreadable ones.
 */
export function parseSolanaStakes(value: unknown, owner: string): SolanaStakes {
  const v = record(value, 'stakes');
  if (!Array.isArray(v['accounts'])) throw new SolanaStakingShapeError('accounts');
  const accounts: SolanaStakeAccount[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const row of v['accounts']) {
    try {
      const account = readStakeAccount(row);
      const staker = account.staker === owner;
      const withdrawer = account.withdrawer === owner;
      const claimed = account.role === 'both' ? staker && withdrawer : account.role === 'staker' ? staker : withdrawer;
      if (!claimed || seen.has(account.address)) throw new SolanaStakingShapeError('role');
      seen.add(account.address);
      accounts.push(account);
    } catch {
      dropped++;
    }
  }
  return { epoch: count(v['epoch'], 'epoch'), accounts, truncated: v['truncated'] === true, dropped };
}

/** `GET /api/sol/validators`. An unreadable row is dropped. */
export function parseSolanaValidators(value: unknown): { epoch: number; validators: SolanaValidator[] } {
  const v = record(value, 'validators');
  if (!Array.isArray(v['validators'])) throw new SolanaStakingShapeError('validators');
  const validators: SolanaValidator[] = [];
  const seen = new Set<string>();
  for (const row of v['validators']) {
    try {
      const r = record(row, 'validator');
      const commission = count(r['commission'], 'commission');
      if (commission > 100) throw new SolanaStakingShapeError('commission');
      if (typeof r['delinquent'] !== 'boolean') throw new SolanaStakingShapeError('delinquent');
      const validator: SolanaValidator = {
        votePubkey: address(r['votePubkey'], 'votePubkey'),
        nodePubkey: address(r['nodePubkey'], 'nodePubkey'),
        name: text(r['name']),
        website: httpsUrl(r['website']),
        iconUrl: httpsUrl(r['iconUrl']),
        details: text(r['details']),
        commission,
        activatedStake: lamports(r['activatedStake'], 'activatedStake'),
        delinquent: r['delinquent'],
        lastEpochCredits: count(r['lastEpochCredits'] ?? 0, 'lastEpochCredits'),
      };
      if (seen.has(validator.votePubkey)) continue;
      seen.add(validator.votePubkey);
      validators.push(validator);
    } catch {
      // An unreadable validator is not offered.
    }
  }
  return { epoch: count(v['epoch'], 'epoch'), validators };
}

/** `GET /api/sol/stake/info`. */
export function parseSolanaStakeInfo(value: unknown): SolanaStakeInfo {
  const v = record(value, 'stake info');
  const info: SolanaStakeInfo = {
    epoch: count(v['epoch'], 'epoch'),
    slotIndex: count(v['slotIndex'], 'slotIndex'),
    slotsInEpoch: count(v['slotsInEpoch'], 'slotsInEpoch'),
    minimumDelegation: lamports(v['minimumDelegation'], 'minimumDelegation'),
    rentExemptReserve: lamports(v['rentExemptReserve'], 'rentExemptReserve'),
  };
  if (info.slotsInEpoch === 0 || info.slotIndex > info.slotsInEpoch) throw new SolanaStakingShapeError('epoch progress');
  if (info.rentExemptReserve === 0n || info.rentExemptReserve > MAX_STAKE_RESERVE_LAMPORTS) throw new SolanaStakingShapeError('reserve');
  return info;
}

/**
 * Ceiling on the rent-exempt reserve Nexus may name for a 200-byte stake account. The real figure is
 * (128 + 200) bytes × 3480 lamports × 2 years = 2,282,880; anything far above it is not believed,
 * since the stake planner would move it into the new account on Nexus's word.
 */
export const MAX_STAKE_RESERVE_LAMPORTS = 10_000_000n;

/** Lamports the wallet keeps after staking, for the fees of a later Unstake and Withdraw. */
export const STAKE_KEEP_LAMPORTS = 5_000_000n;

/** What a stake account offers the wallet now. */
export function stakeActions(account: SolanaStakeAccount, owner: string): { unstake: boolean; withdraw: boolean } {
  return {
    unstake: account.staker === owner && (account.state === 'active' || account.state === 'activating'),
    // Nexus's figure already keeps back whatever is still staked (and the reserve while it is).
    withdraw: account.withdrawer === owner && !account.lockedUp && account.withdrawableLamports > 0n,
  };
}

/** Lamports a stake account holds for the wallet, staked or not (its whole balance). */
export function totalStakedLamports(accounts: readonly SolanaStakeAccount[]): bigint {
  return accounts.reduce((sum, account) => sum + account.lamports, 0n);
}

/** Lamports earning rewards this epoch. */
export function totalActiveLamports(accounts: readonly SolanaStakeAccount[]): bigint {
  return accounts.reduce((sum, account) => sum + account.activeStake, 0n);
}

/**
 * How a stake account's validator is named on screen: the name it published (self-declared), else
 * its vote account shortened; an em dash for an account that is not delegated.
 */
export function stakeValidatorName(account: SolanaStakeAccount, byVote: ReadonlyMap<string, SolanaValidator>): string {
  if (!account.voter) return '—';
  return byVote.get(account.voter)?.name ?? `${account.voter.slice(0, 6)}…${account.voter.slice(-6)}`;
}

/** The i18n key of a stake account's state. */
export function stakeStateKey(state: SolanaStakeState): string {
  return `solana.staking.state.${state}`;
}
