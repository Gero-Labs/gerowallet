// Stake, Unstake and Withdraw: what the worker reads, what it refuses, the simulated bounds.
import { describe, expect, it, vi } from 'vitest';
import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import type { SolanaRemoteAccount, SolanaRemoteSimulation } from '@/chains/solana/solanaNexusAccounts';
import { decodeSolanaTransaction } from '@/chains/solana/solanaTxWire';
import { singleSignerTransaction } from '@/chains/solana/solanaTokenTransfer';
import { SYSTEM_PROGRAM_ID } from '@/chains/solana/solanaTransaction';
import { STAKE_PROGRAM_ID, addressWithSeed, stakeSeed } from '@/chains/solana/solanaStakeTransfer';
import { STAKE_KEEP_LAMPORTS, type SolanaStakeAccount, type SolanaValidator } from '@/chains/solana/solanaStaking';
import { planSolanaStake } from './solanaStake';

// Fixed test vectors — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const OTHER = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const NODE = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const RESERVE = 2_282_880n;
const MIN = 1_000_000_000n;
const SOL = 1_000_000_000n;
const STAKE0 = addressWithSeed(OWNER, stakeSeed(0), STAKE_PROGRAM_ID);
const STAKE1 = addressWithSeed(OWNER, stakeSeed(1), STAKE_PROGRAM_ID);

const validator = (fields: Partial<SolanaValidator> = {}): SolanaValidator => ({
  votePubkey: VOTE, nodePubkey: NODE, name: 'Certus', website: null, iconUrl: null, details: null,
  commission: 5, activatedStake: 10n * SOL, delinquent: false, lastEpochCredits: 1, ...fields,
});
const stakeAccount = (fields: Partial<SolanaStakeAccount> = {}): SolanaStakeAccount => ({
  address: STAKE0, state: 'active', role: 'both', lamports: 2n * SOL + RESERVE, rentExemptReserve: RESERVE,
  staker: OWNER, withdrawer: OWNER, voter: VOTE, delegatedStake: 2n * SOL, activeStake: 2n * SOL, activatingStake: 0n,
  deactivatingStake: 0n, activationEpoch: 1, deactivationEpoch: null, withdrawableLamports: 0n, lockedUp: false, ...fields,
});
const sys = (address: string, lamports: bigint): SolanaRemoteAccount => ({ address, exists: true, lamports, owner: SYSTEM_PROGRAM_ID, program: 'system', parsed: null });
const stakeRow = (address: string, lamports: bigint): SolanaRemoteAccount => ({ address, exists: true, lamports, owner: STAKE_PROGRAM_ID, program: 'stake', parsed: null });
const missing = (address: string): SolanaRemoteAccount => ({ address, exists: false, lamports: null, owner: null, program: null, parsed: null });

interface Opts {
  validators?: SolanaValidator[];
  accounts?: SolanaStakeAccount[];
  used?: string[];
  onChain?: SolanaRemoteAccount;
  success?: boolean;
  /** Simulated lamports after, per account asked (default: what the action should do). */
  after?: (accounts: string[], before: SolanaRemoteAccount[]) => SolanaRemoteAccount[];
}

function api(opts: Opts = {}) {
  const wallet = sys(OWNER, 10n * SOL);
  const chain = (a: string): SolanaRemoteAccount => {
    if (a === OWNER) return wallet;
    if (opts.used?.includes(a)) return stakeRow(a, SOL);
    if (opts.onChain && a === opts.onChain.address) return opts.onChain;
    return missing(a);
  };
  return {
    getFees: vi.fn(async () => ({ baseFeeLamportsPerSignature: 5000, slotsSampled: 1, prioritizationFeeMicroLamports: { min: 0, median: 0, p75: 0, p90: 0, max: 0 } })),
    getChainTip: vi.fn(async () => ({ slot: 1, blockHeight: 1, blockhash: BLOCKHASH })),
    getAccounts: vi.fn(async (addresses: string[]) => addresses.map(chain)),
    getStakeInfo: vi.fn(async () => ({ epoch: 700, slotIndex: 10, slotsInEpoch: 432_000, minimumDelegation: MIN, rentExemptReserve: RESERVE })),
    getValidators: vi.fn(async () => ({ epoch: 700, validators: opts.validators ?? [validator()] })),
    getStakes: vi.fn(async () => ({ epoch: 700, accounts: opts.accounts ?? [stakeAccount()], truncated: false, dropped: 0 })),
    simulate: vi.fn(async (_tx: string, accounts: string[]): Promise<SolanaRemoteSimulation> => {
      const before = accounts.map(chain);
      if (opts.success === false) return { success: false, err: 'x', logs: [], unitsConsumed: 1, before, after: null };
      return { success: true, err: null, logs: [], unitsConsumed: 1, before, after: opts.after ? opts.after(accounts, before) : before };
    }),
  };
}

/** The simulated state of a stake of `lamports`: the wallet pays it, its reserve and the fee. */
const staked = (lamports: bigint) => (accounts: string[]) => [
  sys(OWNER, 10n * SOL - lamports - RESERVE - 5000n), stakeRow(accounts[1], lamports + RESERVE),
];

const stake = (lamports: bigint, extra: Record<string, unknown> = {}) =>
  ({ action: 'stake', voteAccount: VOTE, lamports: lamports.toString(), feeLevel: 'standard', ...extra });

describe('stake', () => {
  it('opens the first unused stake:N account, delegates and holds to the simulation', async () => {
    const p = await planSolanaStake({ publicKey: OWNER }, stake(2n * SOL), api({ used: [STAKE0], after: staked(2n * SOL) }), 10n * SOL);
    expect(p).toMatchObject({ action: 'stake', stakeAccount: STAKE1, voteAccount: VOTE, lamports: 2n * SOL, reserveLamports: RESERVE, feeLamports: 5000n });
    const m = decodeSolanaTransaction(singleSignerTransaction(p.message)).message;
    expect(m.numRequiredSignatures).toBe(1);
    expect(m.staticKeys).toEqual(expect.arrayContaining([OWNER, STAKE1, VOTE, STAKE_PROGRAM_ID]));
  });

  it.each([
    ['a validator Nexus does not list', { validators: [] }, 'VALIDATOR_UNKNOWN'],
    ['a delinquent validator', { validators: [validator({ delinquent: true })] }, 'VALIDATOR_DELINQUENT'],
  ])('refuses %s', async (_, opts, code) => {
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL), api({ ...opts, after: staked(2n * SOL) }), 10n * SOL)).rejects.toMatchObject({ code });
  });

  it('refuses less than the minimum delegation, more than the balance, and leaving too little for later fees', async () => {
    const a = api({ after: staked(2n * SOL) });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(MIN - 1n), a, 10n * SOL)).rejects.toMatchObject({ code: 'STAKE_BELOW_MINIMUM' });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(10n * SOL), a, 10n * SOL)).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS' });
    const justTooMuch = 10n * SOL - RESERVE - 5000n - STAKE_KEEP_LAMPORTS + 1n;
    await expect(planSolanaStake({ publicKey: OWNER }, stake(justTooMuch), a, 10n * SOL)).rejects.toMatchObject({ code: 'STAKE_KEEP_SOL' });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL), a, null)).rejects.toMatchObject({ code: 'BALANCE_UNKNOWN' });
  });

  it('refuses a simulation that fails, funds the account wrongly or costs the wallet more', async () => {
    const plan = (opts: Opts, extra = {}) => planSolanaStake({ publicKey: OWNER }, stake(2n * SOL, extra), api(opts), 10n * SOL);
    await expect(plan({ success: false })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan({ after: (accounts) => [staked(2n * SOL)(accounts)[0], stakeRow(accounts[1], 2n * SOL)] })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan({ after: (accounts) => [sys(OWNER, SOL), stakeRow(accounts[1], 2n * SOL + RESERVE)] })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan({ after: staked(2n * SOL) }, { maxSolCost: (2n * SOL).toString() })).rejects.toMatchObject({ code: 'COST_CHANGED' });
  });

  it('refuses a malformed request', async () => {
    const a = api({ after: staked(2n * SOL) });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL, { voteAccount: 'nope' }), a, 10n * SOL)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL, { lamports: '1.5' }), a, 10n * SOL)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL, { action: 'merge' }), a, 10n * SOL)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL, { feeLevel: 'max' }), a, 10n * SOL)).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('says LOOKUP_FAILED when Nexus cannot answer', async () => {
    const a = api({ after: staked(2n * SOL) });
    a.getValidators.mockRejectedValueOnce(new Error('503'));
    await expect(planSolanaStake({ publicKey: OWNER }, stake(2n * SOL), a, 10n * SOL)).rejects.toMatchObject({ code: 'LOOKUP_FAILED' });
  });
});

describe('unstake', () => {
  const request = { action: 'unstake', stakeAccount: STAKE0, feeLevel: 'standard' };
  const onChain = stakeRow(STAKE0, 2n * SOL + RESERVE);
  const feeOnly = (accounts: string[]) => [sys(OWNER, 10n * SOL - 5000n), ...accounts.slice(1).map((a) => stakeRow(a, 0n))];

  it('deactivates an active stake the wallet is staker of, for the fee only', async () => {
    const p = await planSolanaStake({ publicKey: OWNER }, request, api({ onChain, after: feeOnly }));
    expect(p).toMatchObject({ action: 'unstake', stakeAccount: STAKE0, voteAccount: VOTE, lamports: 2n * SOL, feeLamports: 5000n });
  });

  it.each([
    ['an account Nexus does not list for the wallet', { accounts: [] }, 'STAKE_UNKNOWN'],
    ['an account the chain does not show as a stake account', { onChain: sys(STAKE0, SOL) }, 'STAKE_UNKNOWN'],
    ['a stake already cooling down', { accounts: [stakeAccount({ state: 'deactivating' })] }, 'STAKE_NOT_ACTIVE'],
    ['a stake whose staker is someone else', { accounts: [stakeAccount({ role: 'withdrawer', staker: OTHER })] }, 'STAKE_NOT_ACTIVE'],
  ])('refuses %s', async (_, opts, code) => {
    await expect(planSolanaStake({ publicKey: OWNER }, request, api({ onChain, after: feeOnly, ...opts }))).rejects.toMatchObject({ code });
  });

  it('refuses a simulation that costs more than the fee', async () => {
    const after = (accounts: string[]) => [sys(OWNER, 10n * SOL - 5001n), ...accounts.slice(1).map((a) => stakeRow(a, 0n))];
    await expect(planSolanaStake({ publicKey: OWNER }, request, api({ onChain, after }))).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });
});

describe('withdraw', () => {
  const request = { action: 'withdraw', stakeAccount: STAKE0, feeLevel: 'standard' };
  const inactive = stakeAccount({ state: 'inactive', activeStake: 0n, withdrawableLamports: 2n * SOL + RESERVE });
  const onChain = stakeRow(STAKE0, 2n * SOL + RESERVE);
  const withdrawn = (lamports: bigint) => (accounts: string[]) => [sys(OWNER, 10n * SOL + lamports - 5000n), stakeRow(accounts[1], 2n * SOL + RESERVE - lamports)];

  it('withdraws everything withdrawable to the wallet', async () => {
    const p = await planSolanaStake({ publicKey: OWNER }, request, api({ accounts: [inactive], onChain, after: withdrawn(2n * SOL + RESERVE) }));
    expect(p).toMatchObject({ action: 'withdraw', lamports: 2n * SOL + RESERVE, feeLamports: 5000n });
  });

  it.each([
    ['nothing withdrawable', [stakeAccount()], 'STAKE_NOT_WITHDRAWABLE'],
    ['a locked-up account', [{ ...inactive, lockedUp: true }], 'STAKE_NOT_WITHDRAWABLE'],
    ['an account whose withdrawer is someone else', [{ ...inactive, role: 'staker' as const, withdrawer: OTHER }], 'STAKE_NOT_WITHDRAWABLE'],
  ])('refuses %s', async (_, accounts, code) => {
    await expect(planSolanaStake({ publicKey: OWNER }, request, api({ accounts, onChain, after: withdrawn(2n * SOL) }))).rejects.toMatchObject({ code });
  });

  it('refuses a simulation in which the wallet gets less than the withdrawal less the fee', async () => {
    const after = (accounts: string[]) => [sys(OWNER, 10n * SOL + SOL), stakeRow(accounts[1], SOL + RESERVE)];
    await expect(planSolanaStake({ publicKey: OWNER }, request, api({ accounts: [inactive], onChain, after }))).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });

  it('holds the send to the reviewed amount', async () => {
    await expect(planSolanaStake({ publicKey: OWNER }, { ...request, minReceived: (3n * SOL).toString() },
      api({ accounts: [inactive], onChain, after: withdrawn(2n * SOL + RESERVE) }))).rejects.toMatchObject({ code: 'COST_CHANGED' });
  });
});
