/**
 * Native staking messages, hand-encoded like the transfers so the bytes a user signs stay
 * reviewable; the worker simulates each exact message before anyone signs. Checked against
 * `@solana-program/system` and `@solana-program/stake` in the spec.
 *
 * - **Stake**: System `CreateAccountWithSeed` (the stake account's address comes from the
 *   wallet, a seed and the Stake program, so the wallet is the only signer: hardware wallets sign
 *   it like any transfer), Stake `Initialize` with the wallet as staker and withdrawer and no
 *   lockup, then `DelegateStake` to the vote account.
 * - **Unstake**: `Deactivate`. The stake cools down over the following epoch(s).
 * - **Withdraw**: `Withdraw` of the given lamports back to the wallet.
 *
 * Every message: the wallet signs and pays, compute budget first when a priority price is set.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { solanaAddressToBytes } from './solanaKeyManager';
import { base58Decode, base58Encode } from './solanaBase58';
import { COMPUTE_BUDGET_PROGRAM_ID, LAMPORTS_PER_SIGNATURE, SYSTEM_PROGRAM_ID, compactU16 } from './solanaTransaction';

export const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';
export const STAKE_CONFIG_ID = 'StakeConfig11111111111111111111111111111111';
export const SYSVAR_RENT_ID = 'SysvarRent111111111111111111111111111111111';
export const SYSVAR_CLOCK_ID = 'SysvarC1ock11111111111111111111111111111111';
export const SYSVAR_STAKE_HISTORY_ID = 'SysvarStakeHistory1111111111111111111111111';

/** StakeStateV2's size: what CreateAccountWithSeed allocates. */
export const STAKE_ACCOUNT_SPACE = 200n;
/** Seeds tried for a new stake account: `stake:0` … (the convention Ledger Live and Solflare use). */
export const STAKE_SEED_PREFIX = 'stake:';
export const MAX_STAKE_SEEDS = 64;

/**
 * Compute limits, billed on the limit when a priority price is set. The Stake program runs as a
 * BPF program now, which costs more than the old native one; the worker simulates, so a message
 * that needs more is refused rather than signed.
 */
export const STAKE_CREATE_COMPUTE_UNITS = 100_000;
export const STAKE_DEACTIVATE_COMPUTE_UNITS = 30_000;
export const STAKE_WITHDRAW_COMPUTE_UNITS = 30_000;

const SYSTEM_CREATE_ACCOUNT_WITH_SEED = 3;
const STAKE_INITIALIZE = 0;
const STAKE_DELEGATE = 2;
const STAKE_WITHDRAW = 4;
const STAKE_DEACTIVATE = 5;
const SET_COMPUTE_UNIT_LIMIT = 2;
const SET_COMPUTE_UNIT_PRICE = 3;
const MAX_SEED_BYTES = 32;
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

export type SolanaStakeAction = 'stake' | 'unstake' | 'withdraw';

export function stakeComputeUnits(action: SolanaStakeAction): number {
  if (action === 'stake') return STAKE_CREATE_COMPUTE_UNITS;
  return action === 'unstake' ? STAKE_DEACTIVATE_COMPUTE_UNITS : STAKE_WITHDRAW_COMPUTE_UNITS;
}

/** The network fee of a staking message: one signature plus the priority fee (rounded up). */
export function estimateStakeFee(action: SolanaStakeAction, computeUnitPriceMicroLamports: bigint): bigint {
  const units = BigInt(stakeComputeUnits(action));
  const priority = computeUnitPriceMicroLamports > 0n ? (computeUnitPriceMicroLamports * units + 999_999n) / 1_000_000n : 0n;
  return LAMPORTS_PER_SIGNATURE + priority;
}

/** `Pubkey::create_with_seed(base, seed, owner)`: sha256(base ‖ seed ‖ owner), no curve check. */
export function addressWithSeed(base: string, seed: string, owner: string): string {
  const seedBytes = new TextEncoder().encode(seed);
  if (seedBytes.length > MAX_SEED_BYTES) throw new Error('A seed is at most 32 bytes');
  const ownerBytes = solanaAddressToBytes(owner);
  if (equalBytes(ownerBytes.slice(-PDA_MARKER.length), PDA_MARKER)) throw new Error('Illegal owner');
  return base58Encode(sha256(concat(solanaAddressToBytes(base), seedBytes, ownerBytes)));
}

export function stakeSeed(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_STAKE_SEEDS) throw new Error('Stake seed index out of range');
  return `${STAKE_SEED_PREFIX}${index}`;
}

interface Common {
  /** The wallet: the only signer, the fee payer and every authority. */
  owner: string;
  recentBlockhash: string;
  computeUnitPriceMicroLamports?: bigint;
}

/** Creates a stake account at `addressWithSeed(owner, seed, Stake)`, initializes it and delegates it. */
export function buildStakeMessage(params: Common & {
  seed: string;
  /** Lamports moved into the stake account: the stake plus its rent-exempt reserve. */
  lamports: bigint;
  voteAccount: string;
}): Uint8Array {
  if (params.lamports <= 0n) throw new Error('Nothing to stake');
  const stakeAccount = addressWithSeed(params.owner, params.seed, STAKE_PROGRAM_ID);
  const seedBytes = new TextEncoder().encode(params.seed);
  const owner = solanaAddressToBytes(params.owner);
  return compile(params, STAKE_CREATE_COMPUTE_UNITS, [
    {
      program: SYSTEM_PROGRAM_ID,
      accounts: [w(params.owner, true), w(stakeAccount)],
      data: concat(u32le(SYSTEM_CREATE_ACCOUNT_WITH_SEED), owner, u64le(BigInt(seedBytes.length)), seedBytes,
        u64le(params.lamports), u64le(STAKE_ACCOUNT_SPACE), solanaAddressToBytes(STAKE_PROGRAM_ID)),
    },
    {
      program: STAKE_PROGRAM_ID,
      accounts: [w(stakeAccount), r(SYSVAR_RENT_ID)],
      // Authorized { staker, withdrawer }, Lockup { unix_timestamp: 0, epoch: 0, custodian: default }
      data: concat(u32le(STAKE_INITIALIZE), owner, owner, u64le(0n), u64le(0n), new Uint8Array(32)),
    },
    {
      program: STAKE_PROGRAM_ID,
      accounts: [w(stakeAccount), r(params.voteAccount), r(SYSVAR_CLOCK_ID), r(SYSVAR_STAKE_HISTORY_ID), r(STAKE_CONFIG_ID), r(params.owner, true)],
      data: u32le(STAKE_DELEGATE),
    },
  ]);
}

/** Deactivates a stake account the wallet is the staker of. */
export function buildDeactivateMessage(params: Common & { stakeAccount: string }): Uint8Array {
  return compile(params, STAKE_DEACTIVATE_COMPUTE_UNITS, [{
    program: STAKE_PROGRAM_ID,
    accounts: [w(params.stakeAccount), r(SYSVAR_CLOCK_ID), r(params.owner, true)],
    data: u32le(STAKE_DEACTIVATE),
  }]);
}

/** Withdraws `lamports` from a stake account the wallet is the withdrawer of, back to the wallet. */
export function buildWithdrawMessage(params: Common & { stakeAccount: string; lamports: bigint }): Uint8Array {
  if (params.lamports <= 0n) throw new Error('Nothing to withdraw');
  return compile(params, STAKE_WITHDRAW_COMPUTE_UNITS, [{
    program: STAKE_PROGRAM_ID,
    accounts: [w(params.stakeAccount), w(params.owner), r(SYSVAR_CLOCK_ID), r(SYSVAR_STAKE_HISTORY_ID), r(params.owner, true)],
    data: concat(u32le(STAKE_WITHDRAW), u64le(params.lamports)),
  }]);
}

interface Meta { address: string; writable: boolean; signer: boolean }
interface Ix { program: string; accounts: Meta[]; data: Uint8Array }

const w = (address: string, signer = false): Meta => ({ address, writable: true, signer });
const r = (address: string, signer = false): Meta => ({ address, writable: false, signer });

/**
 * A legacy message with the wallet as the only signer: accounts ordered writable signer (the
 * wallet), writable, then read-only (programs included), each listed once with its widest role.
 */
function compile(common: Common, units: number, body: Ix[]): Uint8Array {
  const price = common.computeUnitPriceMicroLamports ?? 0n;
  const instructions: Ix[] = price > 0n ? [
    { program: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: concat(Uint8Array.of(SET_COMPUTE_UNIT_LIMIT), u32le(units)) },
    { program: COMPUTE_BUDGET_PROGRAM_ID, accounts: [], data: concat(Uint8Array.of(SET_COMPUTE_UNIT_PRICE), u64le(price)) },
    ...body,
  ] : body;

  const roles = new Map<string, { writable: boolean; signer: boolean }>([[common.owner, { writable: true, signer: true }]]);
  const note = (meta: Meta) => {
    const role = roles.get(meta.address) ?? { writable: false, signer: false };
    roles.set(meta.address, { writable: role.writable || meta.writable, signer: role.signer || meta.signer });
  };
  for (const ix of instructions) {
    ix.accounts.forEach(note);
    note(r(ix.program));
  }
  for (const [address, role] of roles) {
    if (role.signer && address !== common.owner) throw new Error('Only the wallet signs a staking message');
  }
  const writable = [...roles].filter(([a, role]) => a !== common.owner && role.writable).map(([a]) => a);
  const readonly = [...roles].filter(([, role]) => !role.writable).map(([a]) => a);
  const accounts = [common.owner, ...writable, ...readonly];
  const at = (address: string) => accounts.indexOf(address);

  const blockhash = base58Decode(common.recentBlockhash);
  if (blockhash.length !== 32) throw new Error('A recent blockhash is 32 bytes');
  return concat(
    Uint8Array.of(1, 0, readonly.length),
    compactU16(accounts.length),
    ...accounts.map(solanaAddressToBytes),
    blockhash,
    compactU16(instructions.length),
    ...instructions.map((ix) => concat(
      Uint8Array.of(at(ix.program)),
      compactU16(ix.accounts.length),
      Uint8Array.from(ix.accounts.map((meta) => at(meta.address))),
      compactU16(ix.data.length),
      ix.data,
    )),
  );
}

function u32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, true);
  return out;
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
