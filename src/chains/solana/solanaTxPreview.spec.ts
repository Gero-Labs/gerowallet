import { describe, expect, it } from 'vitest';
import { base58Encode } from './solanaBase58';
import { buildSolanaTxPreview, solanaAccountsToWatch } from './solanaTxPreview';
import { SYSTEM_PROGRAM, TOKEN_PROGRAM, type SolanaStaticAnalysis } from './solanaTxInstructions';
import {
  lookupTableAddresses,
  parseSolanaAccounts,
  parseSolanaSimulation,
  quoteLamports,
  tokenAccountInfo,
  type SolanaRemoteAccount,
} from './solanaNexusAccounts';

const pk = (n: number) => base58Encode(new Uint8Array(32).fill(n));
const WALLET = pk(1);
const OTHER = pk(2);
const ACC_A = pk(3);
const MINT = pk(4);

const analysis = (over: Partial<SolanaStaticAnalysis> = {}): SolanaStaticAnalysis => ({
  instructions: [], warnings: [], programs: [SYSTEM_PROGRAM], unknownPrograms: [], feePayer: WALLET, feeLamports: 5000n, ...over,
});
const sol = (address: string, lamports: bigint, owner = SYSTEM_PROGRAM): SolanaRemoteAccount =>
  ({ address, exists: true, lamports, owner, program: null, parsed: null });
const token = (address: string, owner: string, amount: bigint, delegate?: string): SolanaRemoteAccount => ({
  address, exists: true, lamports: 2039280n, owner: TOKEN_PROGRAM, program: 'spl-token',
  parsed: { type: 'account', info: { mint: MINT, owner, tokenAmount: { amount: amount.toString(), decimals: 6 }, ...(delegate ? { delegate } : {}) } },
});
const missing = (address: string): SolanaRemoteAccount => ({ address, exists: false, lamports: null, owner: null, program: null, parsed: null });
const watched = (...accounts: string[]) => ({ accounts, complete: true });
const sim = (before: SolanaRemoteAccount[], after: SolanaRemoteAccount[] | null, success = true) =>
  ({ success, err: success ? null : { InstructionError: [0, 'x'] }, logs: [], unitsConsumed: 1, before, after });

describe('buildSolanaTxPreview', () => {
  it('reads the wallet’s SOL and token changes from before and after', () => {
    const p = buildSolanaTxPreview({
      wallet: WALLET, analysis: analysis(), instructionCount: 2, watched: watched(WALLET, ACC_A),
      simulation: sim([sol(WALLET, 10_000_000n), token(ACC_A, WALLET, 5_000_000n)], [sol(WALLET, 7_000_000n), token(ACC_A, WALLET, 2_500_000n)]),
    });
    expect(p.simulated).toBe(true);
    expect(p.solChange).toBe('-3000000');
    expect(p.tokenChanges).toEqual([{ mint: MINT, decimals: 6, change: '-2500000' }]);
    expect(p.warnings).toEqual([]);
    expect(p.requiresAcknowledgement).toBe(false);
  });

  it('counts a token account the transaction creates for the wallet as received', () => {
    const p = buildSolanaTxPreview({
      wallet: WALLET, analysis: analysis(), instructionCount: 1, watched: watched(WALLET, ACC_A),
      simulation: sim([sol(WALLET, 10n), missing(ACC_A)], [sol(WALLET, 10n), token(ACC_A, WALLET, 42n)]),
    });
    expect(p.tokenChanges).toEqual([{ mint: MINT, decimals: 6, change: '42' }]);
  });

  it('catches a CPI that hands the wallet’s token account to someone else, or sets a delegate', () => {
    const p = buildSolanaTxPreview({
      wallet: WALLET, analysis: analysis(), instructionCount: 1, watched: watched(WALLET, ACC_A, pk(5)),
      simulation: sim(
        [sol(WALLET, 10n), token(ACC_A, WALLET, 5n), token(pk(5), WALLET, 7n)],
        [sol(WALLET, 10n), token(ACC_A, OTHER, 5n), token(pk(5), WALLET, 7n, OTHER)],
      ),
    });
    expect(p.warnings.map((w) => w.code)).toEqual(['TOKEN_ACCOUNT_OWNER_CHANGED', 'TOKEN_DELEGATE_SET']);
    expect(p.tokenChanges).toEqual([{ mint: MINT, decimals: 6, change: '-5' }]);
    expect(p.requiresAcknowledgement).toBe(true);
  });

  it('catches the wallet account being reassigned to another program', () => {
    const p = buildSolanaTxPreview({
      wallet: WALLET, analysis: analysis(), instructionCount: 1, watched: watched(WALLET),
      simulation: sim([sol(WALLET, 10n)], [sol(WALLET, 10n, pk(9))]),
    });
    expect(p.warnings).toEqual([{ code: 'WALLET_OWNER_CHANGED', severity: 'critical', newOwner: pk(9) }]);
  });

  it('does not repeat what the instructions already flagged', () => {
    const p = buildSolanaTxPreview({
      wallet: WALLET,
      analysis: analysis({ warnings: [{ code: 'GIVES_TOKEN_AUTHORITY', severity: 'critical', account: ACC_A, newAuthority: OTHER }] }),
      instructionCount: 1, watched: watched(WALLET, ACC_A),
      simulation: sim([sol(WALLET, 10n), token(ACC_A, WALLET, 5n)], [sol(WALLET, 10n), token(ACC_A, OTHER, 5n)]),
    });
    expect(p.warnings.map((w) => w.code)).toEqual(['GIVES_TOKEN_AUTHORITY']);
  });

  it('says when the simulation failed or could not run, and shows no balance changes', () => {
    const failed = buildSolanaTxPreview({
      wallet: WALLET, analysis: analysis(), instructionCount: 1, watched: watched(WALLET), simulation: sim([sol(WALLET, 10n)], null, false),
    });
    expect([failed.simulated, failed.solChange, failed.warnings.map((w) => w.code)]).toEqual([false, null, ['SIMULATION_FAILED']]);
    const none = buildSolanaTxPreview({ wallet: WALLET, analysis: analysis(), instructionCount: 1, watched: watched(WALLET), simulation: null });
    expect(none.warnings.map((w) => w.code)).toEqual(['SIMULATION_UNAVAILABLE']);
  });

  it('lists unknown programs and an incomplete check, and the fee payer', () => {
    const p = buildSolanaTxPreview({
      wallet: WALLET, analysis: analysis({ unknownPrograms: [pk(8)], programs: [pk(8)], feePayer: OTHER }), instructionCount: 1,
      watched: { accounts: [WALLET], complete: false }, simulation: sim([sol(WALLET, 1n)], [sol(WALLET, 1n)]),
    });
    expect(p.warnings.map((w) => w.code)).toEqual(['NOT_ALL_ACCOUNTS_CHECKED', 'UNKNOWN_PROGRAMS']);
    expect(p.feePayerIsWallet).toBe(false);
    expect(p.programs).toEqual([{ address: pk(8), name: null }]);
  });
});

describe('solanaAccountsToWatch', () => {
  it('puts the wallet first, then the other writable accounts, capped', () => {
    const keys = [
      { address: WALLET, signer: true, writable: true, fromLookup: false },
      { address: ACC_A, signer: false, writable: true, fromLookup: false },
      { address: SYSTEM_PROGRAM, signer: false, writable: false, fromLookup: false },
    ];
    expect(solanaAccountsToWatch(keys, WALLET)).toEqual({ accounts: [WALLET, ACC_A], complete: true });
    const many = Array.from({ length: 40 }, (_, i) => ({ address: pk(100 + i), signer: false, writable: true, fromLookup: true }));
    const capped = solanaAccountsToWatch([keys[0], ...many], WALLET);
    expect([capped.accounts.length, capped.complete]).toEqual([32, false]);
  });
});

describe('Nexus account rows', () => {
  it('keeps lamports exact and checks the order', () => {
    expect(quoteLamports('{"lamports": 18446744073709551615}')).toBe('{"lamports":"18446744073709551615"}');
    const json = JSON.stringify({ slot: 1, accounts: [{ address: WALLET, exists: true, owner: SYSTEM_PROGRAM, executable: false, space: 0 }] })
      .replace('"exists":true', '"exists":true,"lamports":18446744073709551615');
    expect(parseSolanaAccounts(json, [WALLET])[0].lamports).toBe(18446744073709551615n);
    expect(() => parseSolanaAccounts(json, [OTHER])).toThrow('account order');
    expect(() => parseSolanaAccounts(json, [WALLET, OTHER])).toThrow('account count');
  });

  it('reads a failed simulation as having no after', () => {
    const json = JSON.stringify({ success: false, err: 'x', logs: ['l'], before: { slot: 1, accounts: [{ address: WALLET, exists: false }] }, after: null });
    const s = parseSolanaSimulation(json, [WALLET]);
    expect([s.success, s.after, s.logs]).toEqual([false, null, ['l']]);
  });

  it('reads token accounts and lookup tables only when they are what they claim', () => {
    expect(tokenAccountInfo(token(ACC_A, WALLET, 3n))).toMatchObject({ mint: MINT, owner: WALLET, amount: 3n, decimals: 6 });
    expect(tokenAccountInfo({ ...token(ACC_A, WALLET, 3n), program: 'other' })).toBeNull();
    const table: SolanaRemoteAccount = {
      address: pk(7), exists: true, lamports: 1n, owner: 'AddressLookupTab1e1111111111111111111111111', program: 'address-lookup-table',
      parsed: { type: 'lookupTable', info: { addresses: [ACC_A, MINT] } },
    };
    expect(lookupTableAddresses(table)).toEqual([ACC_A, MINT]);
    expect(lookupTableAddresses({ ...table, owner: SYSTEM_PROGRAM })).toBeNull();
    expect(lookupTableAddresses({ ...table, parsed: { info: { addresses: ['nope'] } } })).toBeNull();
  });
});
