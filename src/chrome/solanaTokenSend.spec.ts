// The worker's plan for an SPL token send (chrome/solanaTokenSend.ts): what it reads, what it
// refuses, and that the simulated balances must show exactly the transfer.
import { describe, expect, it, vi } from 'vitest';
import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import type { SolanaRemoteAccount, SolanaRemoteSimulation } from '@/chains/solana/solanaNexusAccounts';
import { decodeSolanaTransaction } from '@/chains/solana/solanaTxWire';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, associatedTokenAddress, singleSignerTransaction,
} from '@/chains/solana/solanaTokenTransfer';
import { SYSTEM_PROGRAM_ID } from '@/chains/solana/solanaTransaction';
import { planSolanaTokenSend, solanaTokenAccountInfos, solanaTokenQuote, type SolanaHolding } from './solanaTokenSend';

// Fixed test vectors — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const TO = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OTHER_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SOURCE = associatedTokenAddress(FROM, MINT, TOKEN_PROGRAM_ID);
const DEST = associatedTokenAddress(TO, MINT, TOKEN_PROGRAM_ID);
// An off-curve address (a program-derived one) nobody can sign for.
const PDA = associatedTokenAddress(TO, OTHER_MINT, TOKEN_PROGRAM_ID);

const missing = (address: string): SolanaRemoteAccount => ({ address, exists: false, lamports: null, owner: null, program: null, parsed: null });
const system = (address: string, lamports = 1_000_000_000n): SolanaRemoteAccount =>
  ({ address, exists: true, lamports, owner: SYSTEM_PROGRAM_ID, program: 'system', parsed: null });
const mintAccount = (program = TOKEN_PROGRAM_ID, extensions?: unknown[]): SolanaRemoteAccount => ({
  address: MINT, exists: true, lamports: 1_461_600n, owner: program, program: program === TOKEN_PROGRAM_ID ? 'spl-token' : 'spl-token-2022',
  parsed: { type: 'mint', info: { decimals: 6, isInitialized: true, ...(extensions ? { extensions } : {}) } },
});
const tokenAccount = (address: string, owner: string, amount: bigint, opts: { mint?: string; state?: string; program?: string } = {}): SolanaRemoteAccount => ({
  address, exists: true, lamports: 2_039_280n, owner: opts.program ?? TOKEN_PROGRAM_ID,
  program: (opts.program ?? TOKEN_PROGRAM_ID) === TOKEN_PROGRAM_ID ? 'spl-token' : 'spl-token-2022',
  parsed: { type: 'account', info: { mint: opts.mint ?? MINT, owner, state: opts.state ?? 'initialized', tokenAmount: { amount: amount.toString(), decimals: 6 } } },
});

const holdings: SolanaHolding[] = [{ mint: MINT, amount: '5000000', decimals: 6, tokenAccount: SOURCE, programId: TOKEN_PROGRAM_ID }];
const request = { mint: MINT, recipientAddress: TO, amount: '1250000', feeLevel: 'fast' };

/** Nexus answers from `chain`; the simulation moves `amount` and keeps `fee` back from it. */
function api(chain: Record<string, SolanaRemoteAccount>, sim: { success?: boolean; fee?: bigint; tamper?: bigint } = {}) {
  const read = (address: string) => chain[address] ?? missing(address);
  return {
    getFees: vi.fn(async () => ({ baseFeeLamportsPerSignature: 5000, slotsSampled: 150,
      prioritizationFeeMicroLamports: { min: 0, median: 1000, p75: 20000, p90: 50000, max: 1e6 } })),
    getChainTip: vi.fn(async () => ({ slot: 1, blockHeight: 1, blockhash: BLOCKHASH })),
    getAccounts: vi.fn(async (addresses: string[]) => addresses.map(read)),
    simulate: vi.fn(async (_tx: string, accounts: string[]): Promise<SolanaRemoteSimulation> => {
      const [from, source, destination] = accounts.map(read);
      const amount = 1_250_000n;
      const srcInfo = (source.parsed?.info as { tokenAmount: { amount: string } });
      const dstBefore = destination.exists ? BigInt((destination.parsed?.info as { tokenAmount: { amount: string } }).tokenAmount.amount) : 0n;
      if (sim.success === false) return { success: false, err: 'custom', logs: [], unitsConsumed: 1, before: [from, source, destination], after: null };
      return {
        success: true, err: null, logs: [], unitsConsumed: 30_000, before: [from, source, destination],
        after: [
          from,
          tokenAccount(accounts[1], FROM, BigInt(srcInfo.tokenAmount.amount) - amount + (sim.tamper ?? 0n), { program: source.owner as string }),
          tokenAccount(accounts[2], TO, dstBefore + amount - (sim.fee ?? 0n), { program: source.owner as string }),
        ],
      };
    }),
  };
}

const chain = (extra: Record<string, SolanaRemoteAccount> = {}) => ({
  [MINT]: mintAccount(), [SOURCE]: tokenAccount(SOURCE, FROM, 5_000_000n), [FROM]: system(FROM), [TO]: system(TO), ...extra,
});

const plan = (c: Record<string, SolanaRemoteAccount>, r: Record<string, unknown> = request, s: Parameters<typeof api>[1] = {}, h = holdings) =>
  planSolanaTokenSend({ publicKey: FROM }, r, h, api(c, s));

describe('planning a token send', () => {
  it('opens the recipient account when it has none, and reports the deposit and fee', async () => {
    const p = await plan(chain());
    expect(p).toMatchObject({ destination: DEST, recipient: TO, createsAccount: true, amount: 1_250_000n, received: 1_250_000n, rentLamports: 2_039_280n, decimals: 6 });
    expect(p.feeLamports).toBe(5000n + 2000n); // 20000 µL/CU on 100k CU
    const programs = decodeSolanaTransaction(singleSignerTransaction(p.message)).message;
    expect(programs.staticKeys).toContain(ASSOCIATED_TOKEN_PROGRAM_ID);
    expect(solanaTokenQuote(p)).toEqual({ mint: MINT, decimals: 6, amount: '1250000', received: '1250000', createsAccount: true, rentLamports: '2039280', feeLamports: '7000' });
    expect(solanaTokenAccountInfos(p)).toEqual([{ baseAddress: TO, tokenProgram: TOKEN_PROGRAM_ID, tokenMint: MINT, tokenAccount: DEST }]);
  });

  it('sends to an existing account without opening one, and reads a Token-2022 transfer fee from the simulation', async () => {
    const src = associatedTokenAddress(FROM, MINT, TOKEN_2022_PROGRAM_ID);
    const dst = associatedTokenAddress(TO, MINT, TOKEN_2022_PROGRAM_ID);
    const c = {
      ...chain(), [MINT]: mintAccount(TOKEN_2022_PROGRAM_ID, [{ extension: 'transferFeeConfig', state: {} }]),
      [src]: tokenAccount(src, FROM, 5_000_000n, { program: TOKEN_2022_PROGRAM_ID }), [dst]: tokenAccount(dst, TO, 7n, { program: TOKEN_2022_PROGRAM_ID }),
    };
    const p = await plan(c, request, { fee: 1250n }, [{ mint: MINT, amount: '5000000', decimals: 6, tokenAccount: src }]);
    expect(p).toMatchObject({ tokenProgram: TOKEN_2022_PROGRAM_ID, destination: dst, createsAccount: false, received: 1_248_750n, rentLamports: 0n });
    expect(decodeSolanaTransaction(singleSignerTransaction(p.message)).message.staticKeys).not.toContain(ASSOCIATED_TOKEN_PROGRAM_ID);
  });

  it('sends straight to a pasted token account of this mint', async () => {
    const pasted = tokenAccount(DEST, TO, 0n);
    const p = await plan(chain({ [DEST]: pasted }), { ...request, recipientAddress: DEST });
    expect(p).toMatchObject({ destination: DEST, recipient: TO, createsAccount: false });
  });

  it('takes the source from its own holdings, and its ATA when sync names no account', async () => {
    const p = await plan(chain(), request, {}, [{ mint: MINT, amount: '5000000', decimals: 6, programId: TOKEN_PROGRAM_ID }]);
    expect(decodeSolanaTransaction(singleSignerTransaction(p.message)).message.staticKeys).toContain(SOURCE);
    await expect(plan(chain(), request, {}, [])).rejects.toMatchObject({ code: 'TOKEN_UNKNOWN' });
  });

  it.each([
    ['a bad request', { ...request, amount: '1.5' }, 'INVALID_REQUEST'],
    ['a bad fee level', { ...request, feeLevel: 'ludicrous' }, 'INVALID_REQUEST'],
    ['the wallet itself', { ...request, recipientAddress: FROM }, 'SAME_ADDRESS'],
    ['not an address', { ...request, recipientAddress: 'nope' }, 'INVALID_ADDRESS'],
    ['zero', { ...request, amount: '0' }, 'INVALID_AMOUNT'],
    ['more than held', { ...request, amount: '6000000' }, 'TOKEN_BALANCE'],
  ])('refuses %s', async (_, r, code) => {
    await expect(plan(chain(), r as Record<string, unknown>)).rejects.toMatchObject({ code });
  });

  it('refuses a recipient that is not a wallet, or a token account of another token', async () => {
    await expect(plan(chain(), { ...request, recipientAddress: PDA })).rejects.toMatchObject({ code: 'RECIPIENT_NOT_WALLET' });
    const program = { ...system(TO), owner: ASSOCIATED_TOKEN_PROGRAM_ID };
    await expect(plan(chain({ [TO]: program }))).rejects.toMatchObject({ code: 'RECIPIENT_NOT_WALLET' });
    await expect(plan(chain({ [DEST]: tokenAccount(DEST, TO, 0n, { mint: OTHER_MINT }) }), { ...request, recipientAddress: DEST }))
      .rejects.toMatchObject({ code: 'RECIPIENT_WRONG_TOKEN' });
  });

  it('refuses frozen accounts and tokens whose issuer blocks plain transfers', async () => {
    await expect(plan(chain({ [SOURCE]: tokenAccount(SOURCE, FROM, 5_000_000n, { state: 'frozen' }) }))).rejects.toMatchObject({ code: 'TOKEN_FROZEN' });
    await expect(plan(chain({ [DEST]: tokenAccount(DEST, TO, 0n, { state: 'frozen' }) }))).rejects.toMatchObject({ code: 'TOKEN_FROZEN' });
    for (const ext of [
      { extension: 'nonTransferable' },
      { extension: 'transferHook', state: { programId: TOKEN_PROGRAM_ID } },
      { extension: 'pausableConfig', state: { paused: true } },
    ]) {
      await expect(plan(chain({ [MINT]: mintAccount(TOKEN_2022_PROGRAM_ID, [ext]) }))).rejects.toMatchObject({ code: 'TOKEN_NOT_TRANSFERABLE' });
    }
    // An unset hook is no hook.
    await expect(plan(chain({ [MINT]: mintAccount(TOKEN_PROGRAM_ID, [{ extension: 'transferHook', state: { programId: null } }]) }))).resolves.toBeTruthy();
  });

  it('refuses a source that is not the wallet’s account of this mint', async () => {
    await expect(plan(chain({ [SOURCE]: tokenAccount(SOURCE, TO, 5_000_000n) }))).rejects.toMatchObject({ code: 'TOKEN_UNKNOWN' });
    await expect(plan(chain({ [SOURCE]: tokenAccount(SOURCE, FROM, 5_000_000n, { mint: OTHER_MINT }) }))).rejects.toMatchObject({ code: 'TOKEN_UNKNOWN' });
    await expect(plan(chain({ [MINT]: system(MINT) }))).rejects.toMatchObject({ code: 'TOKEN_UNKNOWN' });
  });

  it('refuses what the simulation would not send, or does not show exactly', async () => {
    await expect(plan(chain(), request, { success: false })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan(chain({ [FROM]: system(FROM, 10_000n) }), request, { success: false })).rejects.toMatchObject({ code: 'INSUFFICIENT_SOL' });
    await expect(plan(chain(), request, { tamper: 1n })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan(chain(), request, { fee: 1_250_000n })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
  });

  it('refuses a pasted token account that a program address owns', async () => {
    const vault = tokenAccount(DEST, PDA, 0n);
    await expect(plan(chain({ [DEST]: vault }), { ...request, recipientAddress: DEST })).rejects.toMatchObject({ code: 'RECIPIENT_NOT_WALLET' });
  });

  it('holds a send to the cost and amount received the user reviewed', async () => {
    // Reviewed: fee 7000 + deposit 2039280, all 1250000 received.
    await expect(plan(chain(), { ...request, maxSolCost: '2046280', minReceived: '1250000' })).resolves.toBeTruthy();
    await expect(plan(chain(), { ...request, maxSolCost: '2046279' })).rejects.toMatchObject({ code: 'COST_CHANGED' });
    await expect(plan(chain(), { ...request, minReceived: '1250000' }, { fee: 1n })).rejects.toMatchObject({ code: 'COST_CHANGED' });
    await expect(plan(chain(), { ...request, maxSolCost: '-1' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('says LOOKUP_FAILED when Nexus cannot be read', async () => {
    const a = api(chain());
    a.getAccounts.mockRejectedValueOnce(new Error('down'));
    await expect(planSolanaTokenSend({ publicKey: FROM }, request, holdings, a)).rejects.toMatchObject({ code: 'LOOKUP_FAILED' });
  });
});
