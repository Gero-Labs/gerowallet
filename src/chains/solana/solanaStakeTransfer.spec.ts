// Native staking messages, checked against the official encoders (@solana-program/system and
// @solana-program/stake, through @solana/kit): the seeded stake account address, and every
// instruction's program, accounts, roles and data.
import { describe, expect, it } from 'vitest';
import { address, createAddressWithSeed, createNoopSigner, type Address } from '@solana/kit';
import { getCreateAccountWithSeedInstruction } from '@solana-program/system';
import {
  getDeactivateInstruction,
  getDelegateStakeInstruction,
  getInitializeInstruction,
  getWithdrawInstruction,
} from '@solana-program/stake';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';
import { decodeSolanaTransaction } from './solanaTxWire';
import { singleSignerTransaction } from './solanaTokenTransfer';
import { COMPUTE_BUDGET_PROGRAM_ID } from './solanaTransaction';
import {
  STAKE_ACCOUNT_SPACE,
  STAKE_CONFIG_ID,
  STAKE_CREATE_COMPUTE_UNITS,
  STAKE_PROGRAM_ID,
  addressWithSeed,
  buildDeactivateMessage,
  buildStakeMessage,
  buildWithdrawMessage,
  estimateStakeFee,
  stakeSeed,
} from './solanaStakeTransfer';

// Fixed test vector — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const OWNER = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const VOTE = 'CertusDeBmqN8ZawdkxK5kFGMwBXdudvWHYwtNgNhvLu';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

function decoded(message: Uint8Array) {
  const { message: m } = decodeSolanaTransaction(singleSignerTransaction(message));
  const writable = (i: number) => (i < m.numRequiredSignatures
    ? i < m.numRequiredSignatures - m.numReadonlySigned
    : i < m.staticKeys.length - m.numReadonlyUnsigned);
  return {
    signers: m.numRequiredSignatures,
    feePayer: m.staticKeys[0],
    instructions: m.instructions.map((ix) => ({
      program: m.staticKeys[ix.programIdIndex],
      accounts: ix.accountIndexes.map((i) => ({ address: m.staticKeys[i], writable: writable(i), signer: i < m.numRequiredSignatures })),
      data: Array.from(ix.data),
    })),
  };
}

function reference(ix: { programAddress: Address; accounts?: readonly { address: Address; role: number }[]; data?: ArrayLike<number> }) {
  return {
    program: ix.programAddress as string,
    accounts: (ix.accounts ?? []).map((a) => ({ address: a.address as string, writable: (a.role & 1) === 1, signer: (a.role & 2) === 2 })),
    data: Array.from(ix.data ?? []),
  };
}

/** Same accounts and data; no account has more authority than the program asks for, except the wallet. */
function expectMatches(ours: ReturnType<typeof decoded>['instructions'][number], ref: ReturnType<typeof reference>) {
  expect(ours.program).toBe(ref.program);
  expect(ours.data).toEqual(ref.data);
  expect(ours.accounts.map((a) => a.address)).toEqual(ref.accounts.map((a) => a.address));
  ours.accounts.forEach((a, i) => {
    if (ref.accounts[i].writable) expect(a.writable).toBe(true);
    if (ref.accounts[i].signer) expect(a.signer).toBe(true);
    if (a.address !== OWNER) {
      expect(a.signer).toBe(false);
      expect(a.writable).toBe(ref.accounts[i].writable);
    }
  });
}

const signer = createNoopSigner(address(OWNER));

describe('stake account address', () => {
  it.each([0, 1, 63])('derives what createAddressWithSeed derives (stake:%i)', async (i) => {
    const seed = stakeSeed(i);
    const expected = await createAddressWithSeed({ baseAddress: address(OWNER), programAddress: address(STAKE_PROGRAM_ID), seed });
    expect(addressWithSeed(OWNER, seed, STAKE_PROGRAM_ID)).toBe(expected);
  });

  it('refuses an index outside the seeds Gero tries, and a seed over 32 bytes', () => {
    expect(() => stakeSeed(64)).toThrow();
    expect(() => stakeSeed(-1)).toThrow();
    expect(() => addressWithSeed(OWNER, 'x'.repeat(33), STAKE_PROGRAM_ID)).toThrow();
  });
});

describe('stake', () => {
  const seed = stakeSeed(2);
  const stakeAccount = addressWithSeed(OWNER, seed, STAKE_PROGRAM_ID);
  const lamports = 1_002_282_880n;

  it('creates, initializes and delegates in the programs\' own layout, the wallet the only signer', () => {
    const message = buildStakeMessage({ owner: OWNER, seed, lamports, voteAccount: VOTE, recentBlockhash: BLOCKHASH });
    const { signers, feePayer, instructions } = decoded(message);
    expect(signers).toBe(1);
    expect(feePayer).toBe(OWNER);
    expect(instructions).toHaveLength(3);
    expectMatches(instructions[0], reference(getCreateAccountWithSeedInstruction({
      payer: signer, newAccount: address(stakeAccount), base: address(OWNER), seed,
      amount: lamports, space: STAKE_ACCOUNT_SPACE, programAddress: address(STAKE_PROGRAM_ID),
    })));
    expectMatches(instructions[1], reference(getInitializeInstruction({
      stake: address(stakeAccount),
      arg0: { staker: address(OWNER), withdrawer: address(OWNER) },
      arg1: { unixTimestamp: 0n, epoch: 0n, custodian: address('11111111111111111111111111111111') },
    })));
    expectMatches(instructions[2], reference(getDelegateStakeInstruction({
      stake: address(stakeAccount), vote: address(VOTE), unused: address(STAKE_CONFIG_ID), stakeAuthority: signer,
    })));
  });

  it('puts the compute budget first when a priority price is set', () => {
    const message = buildStakeMessage({ owner: OWNER, seed, lamports, voteAccount: VOTE, recentBlockhash: BLOCKHASH, computeUnitPriceMicroLamports: 1000n });
    const { instructions } = decoded(message);
    expect(instructions.map((ix) => ix.program)).toEqual([COMPUTE_BUDGET_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, '11111111111111111111111111111111', STAKE_PROGRAM_ID, STAKE_PROGRAM_ID]);
    expect(instructions[0].data[0]).toBe(2);
    expect(new DataView(Uint8Array.from(instructions[0].data).buffer).getUint32(1, true)).toBe(STAKE_CREATE_COMPUTE_UNITS);
    expect(estimateStakeFee('stake', 1000n)).toBe(5000n + 100n);
  });

  it('refuses nothing to stake', () => {
    expect(() => buildStakeMessage({ owner: OWNER, seed, lamports: 0n, voteAccount: VOTE, recentBlockhash: BLOCKHASH })).toThrow();
  });
});

describe('unstake and withdraw', () => {
  const stakeAccount = addressWithSeed(OWNER, stakeSeed(0), STAKE_PROGRAM_ID);

  it('deactivates with the wallet as staker', () => {
    const { instructions } = decoded(buildDeactivateMessage({ owner: OWNER, stakeAccount, recentBlockhash: BLOCKHASH }));
    expect(instructions).toHaveLength(1);
    expectMatches(instructions[0], reference(getDeactivateInstruction({ stake: address(stakeAccount), stakeAuthority: signer })));
  });

  it('withdraws to the wallet with the wallet as withdrawer', () => {
    const { instructions } = decoded(buildWithdrawMessage({ owner: OWNER, stakeAccount, lamports: 123_456n, recentBlockhash: BLOCKHASH }));
    expect(instructions).toHaveLength(1);
    expectMatches(instructions[0], reference(getWithdrawInstruction({
      stake: address(stakeAccount), recipient: address(OWNER), withdrawAuthority: signer, args: 123_456n,
    })));
  });

  it('refuses nothing to withdraw', () => {
    expect(() => buildWithdrawMessage({ owner: OWNER, stakeAccount, lamports: 0n, recentBlockhash: BLOCKHASH })).toThrow();
  });
});
