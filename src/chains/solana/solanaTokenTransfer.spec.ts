// SPL token transfers, checked against the official encoders (@solana-program/token, through
// @solana/kit): the associated token account address, and every instruction's program,
// accounts, roles and data.
import { describe, expect, it } from 'vitest';
import { address, createNoopSigner, type Address } from '@solana/kit';
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
} from '@solana-program/token';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';
import { decodeSolanaTransaction } from './solanaTxWire';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_TRANSFER_COMPUTE_UNITS,
  TOKEN_TRANSFER_WITH_ACCOUNT_COMPUTE_UNITS,
  associatedTokenAddress,
  buildTokenTransferMessage,
  estimateTokenTransferFee,
  singleSignerTransaction,
} from './solanaTokenTransfer';
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from './solanaTransaction';

// Fixed test vector — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const TO = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';

const ata = async (owner: string, mint: string, tokenProgram: string) =>
  (await findAssociatedTokenPda({ owner: address(owner), mint: address(mint), tokenProgram: address(tokenProgram) }))[0] as string;

/** Our decoded instructions as {program, accounts, writable, signer, data}. */
function decoded(message: Uint8Array) {
  const { message: m } = decodeSolanaTransaction(singleSignerTransaction(message));
  const writable = (i: number) => (i < m.numRequiredSignatures
    ? i < m.numRequiredSignatures - m.numReadonlySigned
    : i < m.staticKeys.length - m.numReadonlyUnsigned);
  return m.instructions.map((ix) => ({
    program: m.staticKeys[ix.programIdIndex],
    accounts: ix.accountIndexes.map((i) => ({ address: m.staticKeys[i], writable: writable(i), signer: i < m.numRequiredSignatures })),
    data: Array.from(ix.data),
  }));
}

/** A kit instruction in the same shape (role bit 1 = writable, bit 2 = signer). */
function reference(ix: { programAddress: Address; accounts?: readonly { address: Address; role: number }[]; data?: ArrayLike<number> }) {
  return {
    program: ix.programAddress as string,
    accounts: (ix.accounts ?? []).map((a) => ({ address: a.address as string, writable: (a.role & 1) === 1, signer: (a.role & 2) === 2 })),
    data: Array.from(ix.data ?? []),
  };
}

/** Our roles may only be wider than the reference's (the payer is a writable signer anyway). */
function expectMatches(ours: ReturnType<typeof decoded>[number], ref: ReturnType<typeof reference>) {
  expect(ours.program).toBe(ref.program);
  expect(ours.data).toEqual(ref.data);
  expect(ours.accounts.map((a) => a.address)).toEqual(ref.accounts.map((a) => a.address));
  ours.accounts.forEach((a, i) => {
    if (ref.accounts[i].writable) expect(a.writable).toBe(true);
    if (ref.accounts[i].signer) expect(a.signer).toBe(true);
    // Never more authority than the token program asks for, except the fee payer.
    if (a.address !== FROM) {
      expect(a.signer).toBe(false);
      expect(a.writable).toBe(ref.accounts[i].writable);
    }
  });
}

describe('associated token accounts', () => {
  it.each([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])('derives the address the ATA program uses (%s)', async (program) => {
    expect(associatedTokenAddress(FROM, USDC, program)).toBe(await ata(FROM, USDC, program));
    expect(associatedTokenAddress(TO, USDC, program)).toBe(await ata(TO, USDC, program));
  });

  it('refuses a program that is not a token program', () => {
    expect(() => associatedTokenAddress(FROM, USDC, SYSTEM_PROGRAM_ID)).toThrow();
  });
});

describe('token transfer message', () => {
  const base = async (program = TOKEN_PROGRAM_ID) => ({
    from: FROM,
    source: await ata(FROM, USDC, program),
    destination: await ata(TO, USDC, program),
    mint: USDC,
    tokenProgram: program,
    amount: 1_250_000n,
    decimals: 6,
    recentBlockhash: BLOCKHASH,
  });

  it.each([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID])('a transfer to an existing account is one TransferChecked (%s)', async (program) => {
    const params = await base(program);
    const ixs = decoded(buildTokenTransferMessage(params));
    expect(ixs).toHaveLength(1);
    expectMatches(ixs[0], reference(getTransferCheckedInstruction({
      source: address(params.source), mint: address(USDC), destination: address(params.destination),
      authority: createNoopSigner(address(FROM)), amount: params.amount, decimals: 6,
    }, { programAddress: address(program) })));
  });

  it('opens the recipient account first, with a priority price', async () => {
    const params = { ...(await base()), createDestinationFor: TO, computeUnitPriceMicroLamports: 20_000n };
    const ixs = decoded(buildTokenTransferMessage(params));
    expect(ixs.map((ix) => ix.program)).toEqual([COMPUTE_BUDGET_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID]);
    // SetComputeUnitLimit(100000), SetComputeUnitPrice(20000).
    expect(ixs[0].data).toEqual([2, 0xa0, 0x86, 0x01, 0x00]);
    expect(ixs[1].data).toEqual([3, 0x20, 0x4e, 0, 0, 0, 0, 0, 0]);
    expectMatches(ixs[2], reference(getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(address(FROM)), ata: address(params.destination), owner: address(TO), mint: address(USDC),
      systemProgram: address(SYSTEM_PROGRAM_ID), tokenProgram: address(TOKEN_PROGRAM_ID),
    })));
    expectMatches(ixs[3], reference(getTransferCheckedInstruction({
      source: address(params.source), mint: address(USDC), destination: address(params.destination),
      authority: createNoopSigner(address(FROM)), amount: params.amount, decimals: 6,
    })));
    const { message } = decodeSolanaTransaction(singleSignerTransaction(buildTokenTransferMessage(params)));
    expect(message.staticKeys[0]).toBe(FROM);
    expect(message.recentBlockhash).toBe(BLOCKHASH);
  });

  it('refuses what the token program would refuse or nobody meant', async () => {
    const params = await base();
    expect(() => buildTokenTransferMessage({ ...params, amount: 0n })).toThrow();
    expect(() => buildTokenTransferMessage({ ...params, amount: 1n << 64n })).toThrow();
    expect(() => buildTokenTransferMessage({ ...params, decimals: 256 })).toThrow();
    expect(() => buildTokenTransferMessage({ ...params, destination: params.source })).toThrow();
    expect(() => buildTokenTransferMessage({ ...params, tokenProgram: SYSTEM_PROGRAM_ID })).toThrow();
    expect(() => buildTokenTransferMessage({ ...params, createDestinationFor: FROM })).toThrow();
  });

  it('prices the fee on the limit the message asks for', () => {
    expect(estimateTokenTransferFee(0n, false)).toBe(5000n);
    expect(estimateTokenTransferFee(20_000n, false)).toBe(5000n + (20_000n * BigInt(TOKEN_TRANSFER_COMPUTE_UNITS)) / 1_000_000n);
    expect(estimateTokenTransferFee(20_000n, true)).toBe(5000n + (20_000n * BigInt(TOKEN_TRANSFER_WITH_ACCOUNT_COMPUTE_UNITS)) / 1_000_000n);
    expect(estimateTokenTransferFee(1n, false)).toBe(5001n);
  });
});
